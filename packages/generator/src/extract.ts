import {
  GapTopic,
  Question,
  Requirement,
  toggleLabels,
  type DesignToggles,
} from '@cloudarchitect/domain';
import { z } from 'zod';
import { jsonOutputFormat, parseOutput, type CallUsage, type LlmClient } from './llm.js';
import { callUsage } from './prices.js';

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
/** Limits of the domain `Question` / `Requirement` schemas and of `ContinueRequest`, which `/continue` re-validates. */
const MAX_SUGGESTIONS = 4;
const MAX_QUESTION_CHARS = 500;
const MAX_SUGGESTION_CHARS = 120;
const MAX_REQUIREMENT_CHARS = 2000;
const MAX_REQUIREMENTS = 100;
const MAX_ID_CHARS = 128;
/** Prefixes of the clarification and toggle requirements the generator adds itself. */
const RESERVED_ID = /^[CT]-/;

type RawExtraction = z.infer<typeof Extraction>;

/** Trims, truncates and drops suggestions so every kept question parses as a domain `Question`. */
function normaliseQuestion(q: RawExtraction['questions'][number]): Question | null {
  const suggestions = q.suggestions
    .map((x) => x.trim().slice(0, MAX_SUGGESTION_CHARS))
    .filter(Boolean)
    .slice(0, MAX_SUGGESTIONS);
  const parsed = Question.safeParse({
    topic: q.topic,
    text: q.text.trim().slice(0, MAX_QUESTION_CHARS),
    suggestions,
  });
  return parsed.success ? parsed.data : null;
}

/**
 * Drops empty requirements, truncates long ones and gives duplicate, reserved (`C-`/`T-`) or
 * invalid ids the first free `R<n>`, so the list passes `ContinueRequest` when sent back.
 */
function normaliseRequirements(raw: RawExtraction['requirements']): Requirement[] {
  const kept = raw
    .map((r) => ({ ...r, id: r.id.trim(), text: r.text.trim().slice(0, MAX_REQUIREMENT_CHARS) }))
    .filter((r) => r.text)
    .slice(0, MAX_REQUIREMENTS);
  const valid = (id: string) => id.length > 0 && id.length <= MAX_ID_CHARS && !RESERVED_ID.test(id);
  const used = new Set(kept.map((r) => r.id).filter(valid));
  const claimed = new Set<string>();
  let n = 1;
  const freeId = () => {
    while (used.has(`R${n}`)) n++;
    used.add(`R${n}`);
    return `R${n}`;
  };
  return kept.map((r) => {
    const id = valid(r.id) && !claimed.has(r.id) ? r.id : freeId();
    claimed.add(id);
    return Requirement.parse({ ...r, id, provenance: 'ai' });
  });
}

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

export async function extract(
  llm: LlmClient,
  input: ExtractInput,
  model: string,
): Promise<ExtractResult> {
  const topics = allowedTopics(input.toggles);
  const schema = extractionSchema(topics);
  const res = await llm({
    model,
    system: systemPrompt(topics, input.toggles),
    maxTokens: 4000,
    effort: 'low',
    format: jsonOutputFormat(schema),
    messages: [{ role: 'user', content: input.prompt }],
    signal: input.signal,
  });
  const usage: CallUsage[] = [callUsage(model, res.usage)];
  // Validate against the full topic list so one disallowed question is dropped, not fatal.
  const data = parseOutput(res.text, Extraction, usage);

  const seen = new Set<GapTopic>();
  const questions: Question[] = [];
  for (const q of data.questions) {
    if (!topics.includes(q.topic) || seen.has(q.topic) || questions.length >= MAX_QUESTIONS)
      continue;
    const question = normaliseQuestion(q);
    if (!question) continue;
    seen.add(q.topic);
    questions.push(question);
  }
  return {
    name: data.name,
    requirements: normaliseRequirements(data.requirements),
    assumptions: data.assumptions,
    questions,
    usage,
  };
}
