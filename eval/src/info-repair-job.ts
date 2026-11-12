/**
 * One paired job of the info-repair experiment: extraction and a first draft run once, then two
 * repairs start from that same draft. Arm W sends errors and warnings (today's app behavior);
 * arm I also sends five info rules. Each arm's design is scored and diffed against the draft.
 */
import {
  graphContentHash,
  type CatalogSnapshot,
  type ModelChoice,
  type Project,
} from '@cloudarchitect/domain';
import {
  draftArchitecture,
  GenerationError,
  repairDraft,
  type CallUsage,
  type Draft,
  type LlmClient,
} from '@cloudarchitect/generator';
import {
  classifyChanges,
  diffDesigns,
  regressions,
  type Change,
  type ChangeKind,
} from './design-diff.js';
import { scoreCandidate, type Scenario, type ScenarioResult } from './harness.js';
import { armFindings, messageFor, type Arm } from './info-repair-arms.js';
import { Budget, extractWithAnswers, meteredClient, type CallRecord } from './live-common.js';
import { countByRule, type FindingsByRule } from './rule-hits.js';

export interface ArmResult {
  ok: boolean;
  error?: string;
  /** A repair call was made in this arm. */
  repaired: boolean;
  /** Final design of this arm. */
  findingsByRule?: FindingsByRule;
  targeted: number;
  collateral: number;
  changesByKind: Partial<Record<ChangeKind, number>>;
  regressions: number;
  score?: ScenarioResult;
  /** Extraction + draft + this arm's repair. */
  costUsd: number;
}

export interface InfoRepairRecord {
  scenarioId: string;
  model: ModelChoice;
  repeat: number;
  /** False when extraction or the draft failed. */
  ok: boolean;
  error?: string;
  firstDraftFindingsByRule?: FindingsByRule;
  /** Info findings in arm I's message. */
  infoSent: number;
  /** Both arms sent an identical message (a noise-floor job). */
  sameRequest: boolean;
  /** The two arms' final designs differ (graphContentHash). False when either arm failed. */
  differ: boolean;
  /** Structural changes between W's and I's final designs. Undefined when either arm failed;
   * analyses must filter on arms.W.ok && arms.I.ok. */
  armsDiff?: number;
  arms?: { W: ArmResult; I: ArmResult };
  /** Everything spent on the job, both repairs included. */
  costUsd: number;
  latencyMs: number;
  calls: CallRecord[];
}

type SaveName = 'draft' | 'W' | 'I';

const sumMicro = (usage: CallUsage[]) => usage.reduce((a, u) => a + u.costMicroUsd, 0);

function countByKind(changes: Change[]): Partial<Record<ChangeKind, number>> {
  const out: Partial<Record<ChangeKind, number>> = {};
  for (const c of changes) out[c.kind] = (out[c.kind] ?? 0) + 1;
  return out;
}

export async function runInfoRepairJob(
  llm: LlmClient,
  catalog: CatalogSnapshot,
  scenario: Scenario,
  model: ModelChoice,
  repeat: number,
  save: (name: SaveName, project: Project) => void,
): Promise<InfoRepairRecord> {
  const started = Date.now();
  // Local meter only: the caller's client enforces any spend cap.
  const { llm: metered, meter } = meteredClient(llm, new Budget(Infinity));
  const base = { scenarioId: scenario.id, model, repeat };
  const done = () => ({
    costUsd: meter.jobMicro / 1e6,
    latencyMs: Date.now() - started,
    calls: meter.calls,
  });
  try {
    const step = await extractWithAnswers(metered, scenario, model);
    const extractionMicro = sumMicro(step.usage);
    const draft = await draftArchitecture(metered, catalog, step.input);
    save('draft', draft.project);

    const runArm = async (arm: Arm): Promise<{ result: ArmResult; final: Project | null }> => {
      const message = messageFor(arm, draft.findings);
      const sent = armFindings(draft.findings, arm);
      let repaired: Draft;
      if (message === undefined) repaired = draft;
      else {
        try {
          repaired = await repairDraft(metered, catalog, step.input, draft, message);
        } catch (err) {
          if (!(err instanceof GenerationError)) throw err;
          return {
            final: null,
            result: {
              ok: false,
              error: err.message,
              repaired: true,
              targeted: 0,
              collateral: 0,
              changesByKind: {},
              regressions: 0,
              score: scoreCandidate(scenario, null),
              costUsd: (extractionMicro + sumMicro(err.usage)) / 1e6,
            },
          };
        }
        save(arm, repaired.project);
      }
      if (message === undefined) save(arm, draft.project);
      const changes = message === undefined ? [] : diffDesigns(draft.project, repaired.project);
      const { targeted, collateral } = classifyChanges(changes, sent);
      return {
        final: repaired.project,
        result: {
          ok: true,
          repaired: message !== undefined,
          findingsByRule: countByRule(repaired.findings),
          targeted: targeted.length,
          collateral: collateral.length,
          changesByKind: countByKind(changes),
          regressions: regressions(draft.findings, repaired.findings).length,
          score: scoreCandidate(scenario, repaired.project),
          costUsd: (extractionMicro + sumMicro(repaired.usage)) / 1e6,
        },
      };
    };

    // Let both arms finish before deciding, so cost, calls and saves are final when we return.
    const settled = await Promise.allSettled([runArm('W'), runArm('I')]);
    const failure = settled.find((r) => r.status === 'rejected');
    if (failure) throw failure.reason;
    const [w, i] = settled.map(
      (r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof runArm>>>).value,
    ) as [Awaited<ReturnType<typeof runArm>>, Awaited<ReturnType<typeof runArm>>];
    const messageW = messageFor('W', draft.findings);
    const infoSent = armFindings(draft.findings, 'I').filter((f) => f.severity === 'info').length;
    const both = w.final && i.final ? { w: w.final, i: i.final } : null;
    return {
      ...base,
      ok: true,
      firstDraftFindingsByRule: countByRule(draft.findings),
      infoSent,
      sameRequest: messageW !== undefined && messageW === messageFor('I', draft.findings),
      differ: both ? graphContentHash(both.w) !== graphContentHash(both.i) : false,
      ...(both ? { armsDiff: diffDesigns(both.w, both.i).length } : {}),
      arms: { W: w.result, I: i.result },
      ...done(),
    };
  } catch (err) {
    return {
      ...base,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      infoSent: 0,
      sameRequest: false,
      differ: false,
      ...done(),
    };
  }
}
