import {
  graphContentHash,
  modelOption,
  Project,
  toggleRequirements,
  validateProject,
  YOU_DECIDE,
  type CatalogSnapshot,
  type DesignToggles,
  type GapTopic,
  type ModelChoice,
  type Question,
  type Requirement,
} from '@cloudarchitect/domain';
import { contractFor, toProject } from './contract.js';
import { GenerationError, parseOutput, type CallUsage, type LlmClient } from './llm.js';
import { callUsage } from './prices.js';

export interface GenerateInput {
  prompt: string;
  toggles: DesignToggles;
  model: ModelChoice;
  name: string;
  requirements: Requirement[];
  assumptions: string[];
  questions: Question[];
  answers: Partial<Record<GapTopic, string>>;
  signal?: AbortSignal;
  now?: Date;
}

export interface GenerateResult {
  project: Project;
  usage: CallUsage[];
}

/** Room for adaptive thinking plus the JSON answer, so thinking cannot truncate the output. */
const MAX_TOKENS = 32000;
const EFFORT = 'low';

/** Given requirements, then one per clarification question, then one per enabled toggle. */
export function buildRequirements(
  input: Pick<GenerateInput, 'requirements' | 'questions' | 'answers' | 'toggles'>,
): Requirement[] {
  const clarified = input.questions.map((q): Requirement => {
    const answer = input.answers[q.topic];
    const decided = !answer || answer === YOU_DECIDE;
    return {
      id: `C-${q.topic}`,
      text: decided ? `${q.text} (decided by the architect)` : `${q.text} ${answer}`,
      type: 'functional',
      status: decided ? 'inferred' : 'confirmed',
      provenance: 'clarification',
    };
  });
  return [...input.requirements, ...clarified, ...toggleRequirements(input.toggles)];
}

function userMessage(input: GenerateInput, requirements: Requirement[]): string {
  return [
    input.prompt,
    '',
    'REQUIREMENTS (fixed). Every node and edge must reference these ids or the ids of your inferredRequirements:',
    ...requirements.map((r) => `- ${r.id}: ${r.text}`),
    ...(input.assumptions.length
      ? ['', 'ASSUMPTIONS already made:', ...input.assumptions.map((a) => `- ${a}`)]
      : []),
  ].join('\n');
}

const repairMessage = (list: string) =>
  `The deterministic validator reported these findings on your architecture:\n${list}\n\nReturn the complete corrected architecture. Fix every error. Fix each warning, or keep it only if it is intentional and say why in assumptions. Do not change anything else.`;

export async function generateArchitecture(
  llm: LlmClient,
  catalog: CatalogSnapshot,
  input: GenerateInput,
): Promise<GenerateResult> {
  const option = modelOption(input.model);
  const contract = contractFor(catalog);
  const requirements = buildRequirements(input);
  const messages: { role: 'user' | 'assistant'; content: string }[] = [
    { role: 'user', content: userMessage(input, requirements) },
  ];
  const usage: CallUsage[] = [];

  const build = async () => {
    const res = await llm({
      model: option.model,
      system: contract.system,
      maxTokens: MAX_TOKENS,
      effort: EFFORT,
      format: contract.format,
      messages: [...messages],
      signal: input.signal,
    });
    usage.push(callUsage(option.model, res.usage));
    const generation = parseOutput(res.text, contract.schema, usage);
    const draft = toProject(generation, {
      name: input.name,
      requirements,
      catalog,
      generation: {
        toggles: input.toggles,
        model: input.model,
        generatedAt: (input.now ?? new Date()).toISOString(),
        contentHash: '',
      },
    });
    const parsed = Project.safeParse(draft);
    if (!parsed.success) throw new GenerationError('schema_invalid', usage);
    return { text: res.text, project: parsed.data };
  };

  let out = await build();
  for (let turn = 0; turn < option.repairTurns; turn++) {
    const issues = validateProject(out.project, catalog).filter((f) => f.severity !== 'info');
    if (!issues.length) break;
    const list = issues
      .map((f) => `- [${f.ruleId ?? 'structural'} ${f.severity}] ${f.explanation}`)
      .join('\n');
    messages.push(
      { role: 'assistant', content: out.text },
      { role: 'user', content: repairMessage(list) },
    );
    out = await build();
  }

  const project = out.project;
  project.generation = { ...project.generation!, contentHash: graphContentHash(project) };
  return { project, usage };
}
