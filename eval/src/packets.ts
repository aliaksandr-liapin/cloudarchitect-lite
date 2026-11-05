/**
 * Blind review packets and aggregation for the three-provider reviewer panel.
 *
 * A packet shows three scenarios; each has the user's request, the enabled priorities, the
 * clarification answers and two anonymous designs (A and B) rendered by one neutral renderer. The
 * key (kept apart from the packets) maps every A and B back to a model. Nothing here calls a provider.
 */
import { awsCatalog } from '@cloudarchitect/catalog';
import { toggleRequirements, YOU_DECIDE, type Project } from '@cloudarchitect/domain';
import { PRICES } from '@cloudarchitect/generator';
import { z } from 'zod';
import type { Scenario } from './harness.js';

// --- Review output (the Gate A review JSON) ---

export const DIMENSIONS = [
  'requirementCoverage',
  'serviceFitness',
  'connectionCorrectness',
  'securityBaseline',
  'reliabilityOperability',
  'costAwareness',
  'explanationAccuracy',
] as const;

/**
 * Plain number: Anthropic rejects minimum/maximum on integers, and `.int()` emits safe-integer bounds.
 * Integers in 0-3 are checked in `validateReviewOutput`.
 */
const Score = z.number();

/** Closed objects, arrays, enums, numbers, strings and booleans only (OpenAI strict mode). */
export const ReviewOutput = z.object({
  reviews: z.array(
    z.object({
      scenario: z.string(),
      design: z.enum(['A', 'B']),
      scores: z.object({
        requirementCoverage: Score,
        serviceFitness: Score,
        connectionCorrectness: Score,
        securityBaseline: Score,
        reliabilityOperability: Score,
        costAwareness: Score,
        explanationAccuracy: Score,
      }),
      criticalDefect: z.boolean(),
      defects: z.array(
        z.object({
          severity: z.enum(['minor', 'major', 'critical']),
          description: z.string(),
          evidence: z.string(),
        }),
      ),
      summary: z.string(),
    }),
  ),
  preference: z.array(
    z.object({ scenario: z.string(), better: z.enum(['A', 'B', 'tie']), why: z.string() }),
  ),
});
export type ReviewOutput = z.infer<typeof ReviewOutput>;

// --- Packets ---

export type DesignInput = Pick<Project, 'requirements' | 'containers' | 'nodes' | 'edges'>;

export interface DesignRun {
  model: string;
  scenarioId: string;
  repeat: number;
  project: DesignInput;
}

export interface Packet {
  id: string;
  scenarios: string[];
  markdown: string;
}

export interface DesignRef {
  model: string;
  repeat: number;
}
/** packet id -> scenario id -> which design is A and which is B. */
export type Key = Record<string, Record<string, { A: DesignRef; B: DesignRef }>>;

/**
 * Partner model per model: economical models pair with Haiku, best-quality models with Sonnet;
 * the two Claude models pair with each other (Gate A).
 */
export const DEFAULT_PAIRS: Record<string, string> = {
  haiku: 'sonnet',
  sonnet: 'haiku',
  'gpt-luna': 'haiku',
  'gemini-flash-lite': 'haiku',
  'gpt-sol': 'sonnet',
  'gemini-argon': 'sonnet',
};

const SCENARIOS_PER_PACKET = 3;

/** Strings that must never appear in a packet. */
export const LEAK_PATTERN = /haiku|sonnet|gpt|gemini|claude|openai|google|anthropic/i;

export function findLeaks(markdown: string): string[] {
  return [...new Set(markdown.match(new RegExp(LEAK_PATTERN, 'gi')) ?? [])].map((m) =>
    m.toLowerCase(),
  );
}

/** Small seeded PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(xs: T[], rand: () => number): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Renders one design in a provider-independent form: ids are renumbered, generator metadata is left out. */
export function renderDesign(p: DesignInput): string {
  const reqId = new Map(p.requirements.map((r, i) => [r.id, `R${i + 1}`]));
  const nodeId = new Map(p.nodes.map((n, i) => [n.id, `N${i + 1}`]));
  const boxId = new Map(p.containers.map((c, i) => [c.id, `C${i + 1}`]));
  const label = new Map<string, string>([
    ...p.nodes.map((n) => [n.id, n.label] as const),
    ...p.containers.map((c) => [c.id, c.label] as const),
  ]);
  const refs = (ids: string[]) =>
    ids
      .map((id) => reqId.get(id))
      .filter((x): x is string => !!x)
      .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  const out: string[] = ['**Requirements**', ''];
  for (const r of p.requirements)
    out.push(`- ${reqId.get(r.id)} [${r.type}, ${r.status}] ${r.text}`);

  out.push('', '**Containers** (tree)', '');
  const children = (parent?: string) => p.containers.filter((c) => c.parentId === parent);
  const known = new Set(p.containers.map((c) => c.id));
  const tree = (parent: string | undefined, depth: number) => {
    for (const c of parent === undefined
      ? p.containers.filter((x) => !x.parentId || !known.has(x.parentId))
      : children(parent)) {
      const sub = c.properties?.subnetType ? `, ${c.properties.subnetType}` : '';
      out.push(`${'  '.repeat(depth)}- ${c.label} (${c.kind}${sub}) [${boxId.get(c.id)}]`);
      tree(c.id, depth + 1);
    }
  };
  tree(undefined, 0);
  if (!p.containers.length) out.push('- (none)');

  out.push('', '**Nodes**', '');
  for (const n of p.nodes) {
    const kind = n.external
      ? `EXTERNAL ${n.external.kind}: ${n.external.name}`
      : n.unresolved
        ? `UNRESOLVED service: ${n.unresolved.name}`
        : `service: ${awsCatalog.services.find((s) => s.id === n.serviceId)?.displayName ?? 'unknown service'}`;
    out.push(`- **${n.label}** [${nodeId.get(n.id)}] - ${kind}`);
    if (n.purpose) out.push(`  - purpose: ${n.purpose}`);
    const why = n.rationale ?? n.unresolved?.rationale;
    if (why) out.push(`  - rationale: ${why}`);
    if (n.containerId && label.has(n.containerId))
      out.push(`  - placed in: ${label.get(n.containerId)}`);
    for (const [k, v] of Object.entries(n.configuration ?? {}).sort(([a], [b]) =>
      a.localeCompare(b),
    ))
      out.push(`  - configuration ${k}: ${v}`);
    const sat = refs(n.requirementIds);
    if (sat.length) out.push(`  - satisfies: ${sat.join(', ')}`);
  }

  out.push('', '**Edges**', '');
  for (const e of p.edges) {
    const proto = e.protocol ? `, ${e.protocol}` : '';
    out.push(
      `- ${label.get(e.source) ?? e.source} -> ${label.get(e.target) ?? e.target} (${e.kind}${proto})${e.label ? `: ${e.label}` : ''}`,
    );
    if (e.authNotes) out.push(`  - auth: ${e.authNotes}`);
    const sat = refs(e.requirementIds);
    if (sat.length) out.push(`  - satisfies: ${sat.join(', ')}`);
  }
  return out.join('\n');
}

const RUBRIC = `## Rubric

Score each design on seven dimensions, each 0-3 (0 = critical defect, 3 = production-grade for an MVP-level design).

| Dimension              | What is checked                                                              |
| ---------------------- | ---------------------------------------------------------------------------- |
| requirementCoverage    | All explicit requirements are reflected; assumptions are marked              |
| serviceFitness         | Service choices are justified; nothing redundant or expensive without reason |
| connectionCorrectness  | Direction, semantics, protocols and integrations are correct                 |
| securityBaseline       | Auth, least privilege, private data not public, encryption                   |
| reliabilityOperability | Error handling, DLQs, observability, fault tolerance                         |
| costAwareness          | No obvious overspend; serverless/managed where appropriate                   |
| explanationAccuracy    | Rationale and connection descriptions are technically correct                |

**Critical defect:** any dimension scored 0, or any incorrect technical statement that would lead the user to an insecure or non-working solution.

**Defect severities:** \`minor\` (cosmetic or small improvement), \`major\` (a real weakness or wrong detail that a careful architect would fix before building), \`critical\` (see above).

**Documentation rule:** every \`major\` or \`critical\` defect must cite an official AWS documentation or Well-Architected URL in its \`evidence\` field. A claim you cannot support with documentation should be recorded as \`minor\`.

---
`;

function scenarioSection(s: Scenario, a: DesignInput, b: DesignInput): string {
  const priorities = toggleRequirements(s.toggles).map((r) => `- ${r.text}`);
  const given = Object.entries(s.answers).filter(([, v]) => v && v !== YOU_DECIDE);
  const answers = given.length
    ? `The tool asked the user clarifying questions (listed among the requirements of each design). The user's answers (topic: answer), and "You decide" for every topic not listed:\n\n${given.map(([k, v]) => `- ${k}: ${v}`).join('\n')}`
    : 'The tool asked the user up to three clarifying questions (listed among the requirements of each design). The user answered "You decide" to every question, so the architect chose.';
  return [
    `## Scenario: ${s.id}`,
    '',
    '**User prompt**',
    '',
    ...s.prompt.split('\n').map((l) => `> ${l}`),
    '',
    '**Enabled priorities** (chosen by the user with one-click toggles)',
    '',
    ...(priorities.length ? priorities : ['- (none)']),
    '',
    '**Clarification answers given**',
    '',
    answers,
    '',
    '### Design A',
    '',
    renderDesign(a),
    '',
    '### Design B',
    '',
    renderDesign(b),
    '',
  ].join('\n');
}

/** Models whose pairs (against Haiku) form the economical tier; every other pair is best-quality. */
export const ECONOMICAL_MODELS = new Set(['gpt-luna', 'gemini-flash-lite']);

export function buildPackets(input: {
  runs: DesignRun[];
  scenarios: Scenario[];
  seed: number;
  pairs?: Record<string, string>;
  /** Use only designs from this repeat number. */
  repeat?: number;
  /** Scenario ids for economical pairs (and for best-quality pairs when `baseScenarios` is absent). */
  onlyScenarios?: string[];
  /** Scenario ids for best-quality pairs (best-quality models, and the Haiku-Sonnet pair). */
  baseScenarios?: string[];
}): { packets: Packet[]; key: Key } {
  const pairs = input.pairs ?? DEFAULT_PAIRS;
  const known = new Set(input.scenarios.map((s) => s.id));
  for (const list of [input.onlyScenarios, input.baseScenarios]) {
    const unknown = list?.filter((id) => !known.has(id)) ?? [];
    if (unknown.length) throw new Error(`Unknown scenarios: ${unknown.join(', ')}`);
  }
  const economicalIds = input.onlyScenarios ? new Set(input.onlyScenarios) : undefined;
  const bestIds = input.baseScenarios ? new Set(input.baseScenarios) : economicalIds;
  const allRuns = input.runs;
  input = {
    ...input,
    runs: input.repeat === undefined ? allRuns : allRuns.filter((r) => r.repeat === input.repeat),
  };
  const rand = rng(input.seed);
  const scenarioById = new Map(input.scenarios.map((s) => [s.id, s]));
  const find = (model: string, scenarioId: string, repeat: number) => {
    const cands = input.runs
      .filter((r) => r.model === model && r.scenarioId === scenarioId)
      .sort((a, b) => a.repeat - b.repeat);
    return cands.find((r) => r.repeat === repeat) ?? cands[0];
  };

  // One entry per unordered design pair, in a stable order before shuffling.
  const seen = new Set<string>();
  const entries: { scenario: Scenario; x: DesignRun; y: DesignRun }[] = [];
  const ordered = [...input.runs].sort(
    (a, b) =>
      a.scenarioId.localeCompare(b.scenarioId) ||
      a.model.localeCompare(b.model) ||
      a.repeat - b.repeat,
  );
  for (const x of ordered) {
    const partner = pairs[x.model];
    const scenario = scenarioById.get(x.scenarioId);
    if (!partner || partner === x.model || !scenario) continue;
    const y = find(partner, x.scenarioId, x.repeat);
    if (!y) continue;
    const tier =
      ECONOMICAL_MODELS.has(x.model) || ECONOMICAL_MODELS.has(y.model) ? economicalIds : bestIds;
    if (tier && !tier.has(x.scenarioId)) continue;
    const id = [x, y]
      .map((d) => `${d.model}#${d.repeat}`)
      .sort()
      .join('|')
      .concat(`@${x.scenarioId}`);
    if (seen.has(id)) continue;
    seen.add(id);
    entries.push({ scenario, x, y });
  }

  // Random order, then fill packets with distinct scenarios, three per packet.
  const groups: (typeof entries)[] = [];
  for (const e of shuffle(entries, rand)) {
    const g = groups.find(
      (g) => g.length < SCENARIOS_PER_PACKET && !g.some((o) => o.scenario.id === e.scenario.id),
    );
    if (g) g.push(e);
    else groups.push([e]);
  }

  const key: Key = {};
  const packets = groups.map((g, i) => {
    const id = `g${i + 1}`;
    key[id] = {};
    const sections = g.map((e) => {
      const [a, b] = rand() < 0.5 ? [e.x, e.y] : [e.y, e.x];
      key[id]![e.scenario.id] = {
        A: { model: a.model, repeat: a.repeat },
        B: { model: b.model, repeat: b.repeat },
      };
      return scenarioSection(e.scenario, a.project, b.project);
    });
    const ids = g.map((e) => e.scenario.id);
    return {
      id,
      scenarios: ids,
      markdown: [
        `# Review packet, group ${i + 1}`,
        '',
        `Scenarios in this packet: ${ids.join(', ')}. Read \`reviewer-instructions.md\` for the task and the output format.`,
        '',
        RUBRIC,
        sections.join('\n'),
      ].join('\n'),
    };
  });
  return { packets, key };
}

// --- Aggregation ---

/** One reviewer's output for one packet. */
export interface PanelReview {
  reviewer: string;
  packetId: string;
  output: ReviewOutput;
}

export interface ModelSummary {
  /** Median over the model's designs of each design's median-of-reviewers score. */
  blindScore: number;
  designs: number;
  /** Fewest reviewers that scored any of the model's designs in any packet. */
  minReviewers: number;
  /** Share of designs that a majority of their reviewers flagged with a critical defect. */
  criticalDefectRate: number;
  /** Sum over designs of the median (over reviewers) number of major defects. */
  majorDefects: number;
}

export interface PanelSummary {
  models: Record<string, ModelSummary>;
  /** "<winner> over <loser>" -> number of pairings where a majority of reviewers preferred it. */
  preferences: Record<string, number>;
  ties: number;
  /** False when any design was scored by fewer than `expectedReviewers` reviewers. */
  complete: boolean;
  /** Design id (`model#repeat@scenario`) -> fewest reviewers over its packets. */
  reviewersPerDesign: Record<string, number>;
}

export const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length
    ? s.length % 2
      ? s[(s.length - 1) / 2]!
      : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2
    : 0;
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Score of one design = mean of the 7 rubric dimensions. */
export const designScore = (scores: Record<(typeof DIMENSIONS)[number], number>) =>
  mean(DIMENSIONS.map((d) => scores[d]));

/**
 * Per design (model, scenario, repeat) and packet: median of the reviewers. A design that sits in
 * several packets (a model paired with more than one partner) is averaged across them. Per model:
 * median over its designs.
 */
export function aggregate(key: Key, reviews: PanelReview[], expectedReviewers = 3): PanelSummary {
  interface Slot {
    scores: number[];
    critical: boolean[];
    majors: number[];
  }
  // design id -> packet id -> slot
  const designs = new Map<string, { model: string; slots: Map<string, Slot> }>();
  const prefVotes = new Map<string, { votes: Record<string, number> }>();

  for (const r of reviews) {
    const packetKey = key[r.packetId];
    if (!packetKey) continue;
    for (const rv of r.output.reviews) {
      const entry = packetKey[rv.scenario];
      if (!entry) continue;
      const ref = entry[rv.design];
      const id = `${ref.model}#${ref.repeat}@${rv.scenario}`;
      const d = designs.get(id) ?? { model: ref.model, slots: new Map() };
      designs.set(id, d);
      const slot = d.slots.get(r.packetId) ?? { scores: [], critical: [], majors: [] };
      d.slots.set(r.packetId, slot);
      slot.scores.push(designScore(rv.scores));
      slot.critical.push(rv.criticalDefect);
      slot.majors.push(rv.defects.filter((x) => x.severity === 'major').length);
    }
    for (const p of r.output.preference) {
      const entry = packetKey[p.scenario];
      if (!entry) continue;
      const id = `${r.packetId}@${p.scenario}`;
      const v = prefVotes.get(id) ?? { votes: { A: 0, B: 0, tie: 0 } };
      prefVotes.set(id, v);
      v.votes[p.better] = (v.votes[p.better] ?? 0) + 1;
    }
  }

  const perModel = new Map<
    string,
    { scores: number[]; critical: number[]; majors: number; minReviewers: number }
  >();
  const reviewersPerDesign: Record<string, number> = {};
  for (const [designId, d] of designs) {
    const slots = [...d.slots.values()];
    const count = Math.min(...slots.map((s) => s.scores.length));
    reviewersPerDesign[designId] = count;
    const m = perModel.get(d.model) ?? { scores: [], critical: [], majors: 0, minReviewers: count };
    m.minReviewers = Math.min(m.minReviewers, count);
    perModel.set(d.model, m);
    m.scores.push(mean(slots.map((s) => median(s.scores))));
    m.critical.push(
      mean(slots.map((s) => (s.critical.filter(Boolean).length * 2 > s.critical.length ? 1 : 0))) >
        0.5
        ? 1
        : 0,
    );
    m.majors += Math.round(mean(slots.map((s) => median(s.majors))));
  }

  const models: Record<string, ModelSummary> = {};
  for (const [model, m] of [...perModel].sort(([a], [b]) => a.localeCompare(b)))
    models[model] = {
      blindScore: median(m.scores),
      designs: m.scores.length,
      minReviewers: m.minReviewers,
      criticalDefectRate: mean(m.critical),
      majorDefects: m.majors,
    };

  const preferences: Record<string, number> = {};
  let ties = 0;
  for (const [id, v] of prefVotes) {
    const [packetId, scenario] = id.split('@') as [string, string];
    const entry = key[packetId]![scenario]!;
    const a = v.votes.A ?? 0;
    const b = v.votes.B ?? 0;
    if (a === b) {
      ties++;
      continue;
    }
    const [win, lose] = a > b ? [entry.A.model, entry.B.model] : [entry.B.model, entry.A.model];
    preferences[`${win} over ${lose}`] = (preferences[`${win} over ${lose}`] ?? 0) + 1;
  }
  const complete = Object.values(reviewersPerDesign).every((n) => n >= expectedReviewers);
  return { models, preferences, ties, complete, reviewersPerDesign };
}

// --- Review validation and spend reservation ---

/**
 * Checks one reviewer answer against its packet: exactly one review per scenario and design, one
 * preference per scenario, nothing for a scenario outside the packet. Throws otherwise.
 */
export function validateReviewOutput(output: ReviewOutput, scenarios: string[]): void {
  const expected = new Set(scenarios);
  const seen = new Set<string>();
  for (const r of output.reviews) {
    const id = `${r.scenario}/${r.design}`;
    if (!expected.has(r.scenario)) throw new Error(`unexpected review ${id}`);
    if (seen.has(id)) throw new Error(`duplicate review ${id}`);
    seen.add(id);
    for (const d of DIMENSIONS) {
      const v = r.scores[d];
      if (!Number.isInteger(v) || v < 0 || v > 3) throw new Error(`score out of range ${id} ${d}`);
    }
  }
  for (const s of scenarios)
    for (const d of ['A', 'B'])
      if (!seen.has(`${s}/${d}`)) throw new Error(`missing review ${s}/${d}`);
  const prefs = new Set<string>();
  for (const p of output.preference) {
    if (!expected.has(p.scenario)) throw new Error(`unexpected preference ${p.scenario}`);
    if (prefs.has(p.scenario)) throw new Error(`duplicate preference ${p.scenario}`);
    prefs.add(p.scenario);
  }
}

/**
 * Worst-case cost of one call in micro-USD, reserved while the call is in flight: the whole
 * request at 3 characters per token (a conservative estimate) plus `maxTokens` at the output price.
 */
export function estimateCallMicroUsd(
  model: string,
  system: string,
  user: string,
  maxTokens: number,
): number {
  const p = (PRICES as Record<string, { input: number; output: number }>)[model];
  if (!p) throw new Error(`Unknown model ${model}`);
  const inputTokens = Math.ceil((system.length + user.length) / 3);
  return Math.ceil(inputTokens * p.input + maxTokens * p.output);
}

/** Whether a call may start: spend so far plus calls in flight plus this call stays within the cap. */
export const withinCap = (spent: number, reserved: number, estimate: number, cap: number) =>
  spent + reserved + estimate <= cap;

// --- Resume ---

/** Parses a saved review file; undefined unless it is a valid answer for the packet's scenarios. */
export function acceptSaved(text: string, scenarios: string[]): ReviewOutput | undefined {
  try {
    const parsed = ReviewOutput.safeParse(JSON.parse(text));
    if (!parsed.success) return undefined;
    validateReviewOutput(parsed.data, scenarios);
    return parsed.data;
  } catch {
    return undefined;
  }
}

/** (reviewer, packet) pairs still to call, in reviewer order then packet order. */
export function missingCalls(
  reviewers: string[],
  packetIds: string[],
  have: Set<string>,
): { reviewer: string; packetId: string }[] {
  return reviewers.flatMap((reviewer) =>
    packetIds
      .filter((packetId) => !have.has(`${reviewer}/${packetId}`))
      .map((packetId) => ({ reviewer, packetId })),
  );
}

/** Packet ids whose saved text differs from the rebuilt one, or that exist on only one side. */
export function packetMismatches(saved: Record<string, string>, built: Packet[]): string[] {
  const ids = new Set([...Object.keys(saved), ...built.map((p) => p.id)]);
  const byId = new Map(built.map((p) => [p.id, p.markdown]));
  return [...ids].filter((id) => saved[id] !== byId.get(id)).sort();
}
