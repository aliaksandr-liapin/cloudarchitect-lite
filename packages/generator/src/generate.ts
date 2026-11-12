import {
  graphContentHash,
  modelOption,
  Project,
  toggleRequirements,
  validateProject,
  YOU_DECIDE,
  type CatalogSnapshot,
  type DesignToggles,
  type Finding,
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
  /** Validator findings on the first draft, before any repair turn (for the eval). */
  firstDraftFindings: Finding[];
  repairTurnsUsed: number;
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

export const repairMessage = (list: string) =>
  `The deterministic validator reported these findings on your architecture:\n${list}\n\nReturn the complete corrected architecture. Fix every error. Fix each warning, or keep it only if it is intentional and say why in assumptions. Do not change anything else.`;

/** The repair message when info findings are sent too: one added sentence on how to treat them. */
export const infoRepairMessage = (list: string) =>
  `The deterministic validator reported these findings on your architecture:\n${list}\n\nReturn the complete corrected architecture. Fix every error. Fix each warning, or keep it only if it is intentional and say why in assumptions. Apply each info finding if it fits the requirements; otherwise leave it and say why in assumptions. Do not change anything else.`;

/** Findings the repair turn sends: every error and warning, plus info findings of `infoRules`. */
export function repairFindings(findings: Finding[], infoRules: readonly string[] = []): Finding[] {
  return findings.filter(
    (f) => f.severity !== 'info' || (f.ruleId !== undefined && infoRules.includes(f.ruleId)),
  );
}

/** The repair message for `sent`: the info variant only when an info finding is among them. */
export function repairMessageFor(sent: Finding[]): string {
  const list = formatFindings(sent);
  return sent.some((f) => f.severity === 'info') ? infoRepairMessage(list) : repairMessage(list);
}

/**
 * Experimental repair message (not used by the app yet): errors and warnings in their own list
 * first, info findings in a second list that the model applies only after the first is handled.
 * With no info finding it is exactly `repairMessageFor`.
 */
export function prioritizedRepairMessage(sent: Finding[]): string {
  const info = sent.filter((f) => f.severity === 'info');
  if (info.length === 0) return repairMessageFor(sent);
  const rest = sent.filter((f) => f.severity !== 'info');
  return [
    'The deterministic validator reported these findings on your architecture.',
    ...(rest.length ? ['', 'Errors and warnings:', formatFindings(rest)] : []),
    '',
    'Lower priority (info findings):',
    formatFindings(info),
    '',
    'Return the complete corrected architecture. Fix every error. Fix each warning, or keep it only if it is intentional and say why in assumptions. Only then apply each info finding, if it fits the requirements and does not undo an error or warning fix; otherwise leave it and say why in assumptions. Do not change anything else.',
  ].join('\n');
}

type Message = { role: 'user' | 'assistant'; content: string };

/** One architecture the model produced, with the conversation and cost that led to it. */
export interface Draft {
  project: Project;
  text: string;
  messages: Message[];
  usage: CallUsage[];
  findings: Finding[];
}

/** One list line per finding, with ids (not only labels) so the model can find the element to change. */
export function formatFindings(findings: Finding[]): string {
  return findings
    .map((f) =>
      [
        `- [${f.ruleId ?? 'structural'} ${f.severity}] ${f.explanation}`,
        f.remediation && `Fix: ${f.remediation}`,
        f.nodeIds?.length && `(nodes: ${f.nodeIds.join(', ')})`,
        f.edgeIds?.length && `(edges: ${f.edgeIds.join(', ')})`,
      ]
        .filter(Boolean)
        .join(' '),
    )
    .join('\n');
}

/** One model call over `messages`; `priorUsage` is copied, never mutated. */
async function build(
  llm: LlmClient,
  catalog: CatalogSnapshot,
  input: GenerateInput,
  messages: Message[],
  priorUsage: CallUsage[],
): Promise<Draft> {
  const option = modelOption(input.model);
  const contract = contractFor(catalog);
  const requirements = buildRequirements(input);
  const usage = [...priorUsage];
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
  return {
    project: parsed.data,
    text: res.text,
    messages: [...messages],
    usage,
    findings: validateProject(parsed.data, catalog),
  };
}

/** The first model call: one user message, no repair. */
export function draftArchitecture(
  llm: LlmClient,
  catalog: CatalogSnapshot,
  input: GenerateInput,
): Promise<Draft> {
  const messages: Message[] = [
    { role: 'user', content: userMessage(input, buildRequirements(input)) },
  ];
  return build(llm, catalog, input, messages, []);
}

/** One repair call on top of `draft`; `draft` is left untouched. */
export function repairDraft(
  llm: LlmClient,
  catalog: CatalogSnapshot,
  input: GenerateInput,
  draft: Draft,
  message: string,
): Promise<Draft> {
  const messages: Message[] = [
    ...draft.messages,
    { role: 'assistant', content: draft.text },
    { role: 'user', content: message },
  ];
  return build(llm, catalog, input, messages, draft.usage);
}

export async function generateArchitecture(
  llm: LlmClient,
  catalog: CatalogSnapshot,
  input: GenerateInput,
): Promise<GenerateResult> {
  const option = modelOption(input.model);
  let out = await draftArchitecture(llm, catalog, input);
  const firstDraftFindings = out.findings;
  let repairTurnsUsed = 0;
  for (let turn = 0; turn < option.repairTurns; turn++) {
    const issues = repairFindings(out.findings, option.repairInfoRules);
    if (!issues.length) break;
    out = await repairDraft(llm, catalog, input, out, repairMessageFor(issues));
    repairTurnsUsed++;
  }

  const project = out.project;
  project.generation = { ...project.generation!, contentHash: graphContentHash(project) };
  return { project, usage: out.usage, firstDraftFindings, repairTurnsUsed };
}
