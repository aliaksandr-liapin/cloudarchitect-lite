import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import {
  GapTopic,
  Requirement,
  toggleLabels,
  type DesignToggles,
  type Question,
} from '@cloudarchitect/domain';
import { z } from 'zod';
import { GenerationError, type CallUsage, type LlmClient } from './llm.js';
import { costMicroUsd, EXTRACTION_MODEL } from './prices.js';

/** The topic enum depends on the enabled toggles, so the schema is built per call. */
export function extractionSchema(topics: GapTopic[]) {
  return z.object({
    name: z.string().describe('Short project name'),
    requirements: z.array(
      z.object({
        id: z.string().describe('Short unique id such as R1, R2'),
        text: z.string(),
        type: z.enum(['functional', 'non-functional', 'constraint']),
        status: z.enum(['confirmed', 'inferred']),
      }),
    ),
    assumptions: z.array(z.string()),
    questions: z.array(
      z.object({
        topic: z.enum(topics as [GapTopic, ...GapTopic[]]),
        text: z.string(),
        suggestions: z.array(z.string()).describe('2 to 4 concrete answers'),
      }),
    ),
  });
}

/** Full-topic schema, used for typing. */
export const Extraction = extractionSchema([...GapTopic.options]);

export interface ExtractInput {
  prompt: string;
  toggles: DesignToggles;
  signal?: AbortSignal;
}

export interface ExtractResult {
  name: string;
  requirements: Requirement[];
  assumptions: string[];
  questions: Question[];
  usage: CallUsage[];
}

const MAX_QUESTIONS = 3;

export function allowedTopics(t: DesignToggles): GapTopic[] {
  const skipAvailability = Boolean(t.highAvailability || t.disasterRecovery);
  return GapTopic.options.filter((x) => !(skipAvailability && x === 'availability-target'));
}

function systemPrompt(topics: GapTopic[], toggles: DesignToggles): string {
  const decided = toggleLabels(toggles);
  return [
    'You turn a short description of a cloud application into structured requirements for an AWS architecture.',
    "Extract confirmed requirements (stated by the user) and inferred requirements (implied), staying close to the user's wording.",
    `Ask clarifying questions only about these gap topics: ${topics.join(', ')}.`,
    'Ask only where best practice says the request is incomplete or very broad and the answer would change the architecture.',
    'Each question gets 2 to 4 concrete suggestions. No filler questions. Ask zero questions when the request is clear.',
    decided.length
      ? `These design choices are already decided; do not ask about them: ${decided.join(', ')}.`
      : 'No design choices have been pre-selected.',
  ].join('\n');
}

export async function extract(llm: LlmClient, input: ExtractInput): Promise<ExtractResult> {
  const topics = allowedTopics(input.toggles);
  const schema = extractionSchema(topics);
  const res = await llm({
    model: EXTRACTION_MODEL,
    system: systemPrompt(topics, input.toggles),
    maxTokens: 4000,
    format: zodOutputFormat(schema),
    messages: [{ role: 'user', content: input.prompt }],
    signal: input.signal,
  });
  const usage: CallUsage[] = [
    {
      model: EXTRACTION_MODEL,
      usage: res.usage,
      costMicroUsd: costMicroUsd(EXTRACTION_MODEL, res.usage),
    },
  ];

  let raw: unknown;
  try {
    raw = JSON.parse(res.text);
  } catch {
    throw new GenerationError('schema_invalid', usage);
  }
  // Validate against the full topic list so one disallowed question is dropped, not fatal.
  const parsed = Extraction.safeParse(raw);
  if (!parsed.success) throw new GenerationError('schema_invalid', usage);

  const seen = new Set<GapTopic>();
  const questions: Question[] = [];
  for (const q of parsed.data.questions) {
    if (!topics.includes(q.topic) || seen.has(q.topic) || questions.length >= MAX_QUESTIONS)
      continue;
    seen.add(q.topic);
    questions.push(q);
  }
  return {
    name: parsed.data.name,
    requirements: parsed.data.requirements.map((r) => ({ ...r, provenance: 'ai' as const })),
    assumptions: parsed.data.assumptions,
    questions,
    usage,
  };
}
