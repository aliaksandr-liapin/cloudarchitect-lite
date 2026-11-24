/**
 * One job of the effort-budget experiment
 * (docs/superpowers/specs/2026-11-20-effort-budget-experiment-design.md): extraction and a first
 * draft run once, then four arms repair from that same draft, concurrently. Arms 0/1/2 send errors
 * and warnings plus 0/1/2 repairable info findings. Arm S sends VR-018 alone first, then what the
 * validator finds on that result (errors, warnings, five info rules); without VR-018 it is one turn.
 * Every arm is scored and diffed against the draft.
 */
import {
  graphContentHash,
  type CatalogSnapshot,
  type Finding,
  type ModelChoice,
  type Project,
} from '@cloudarchitect/domain';
import {
  draftArchitecture,
  GenerationError,
  repairDraft,
  repairMessageFor,
  type CallUsage,
  type Draft,
  type LlmClient,
} from '@cloudarchitect/generator';
import {
  classifyChanges,
  diffDesigns,
  leftUnfixed,
  regressions,
  type Change,
} from './design-diff.js';
import {
  doseFindings,
  EB_ARMS,
  eligibleInfo,
  hasVr018,
  seedFor,
  vr018Only,
  type EbArm,
} from './effort-budget-arms.js';
import { scoreCandidate, type Scenario } from './harness.js';
import { armFindings } from './info-repair-arms.js';
import type { ArmResult, InfoRepairRecord } from './info-repair-job.js';
import { Budget, extractWithAnswers, meteredClient, type CallRecord } from './live-common.js';
import { countByRule, type FindingsByRule } from './rule-hits.js';

export interface EbArmResult extends ArmResult {
  /** Repair calls this arm made (S: up to 2). */
  turns: 0 | 1 | 2;
  /** Info findings sent across all turns. */
  infoSent: number;
  /** Set only when the draft had VR-018 and the arm succeeded: the final design has none. */
  vr018Fixed?: boolean;
  /** graphContentHash of the final design (absent when the arm failed). */
  finalHash?: string;
  /** The messages sent, in order; empty when no call was made. */
  request: string[];
}

/** One job with named repair arms, each repaired from the same first draft. */
export interface ArmJobRecord<A extends string> {
  scenarioId: string;
  model: ModelChoice;
  repeat: number;
  /** False when extraction or the draft failed. */
  ok: boolean;
  error?: string;
  firstDraftFindingsByRule?: FindingsByRule;
  hasVr018: boolean;
  /**
   * For each arm, the first arm (in the experiment's arm order) that made the identical,
   * separate calls; an arm maps to itself when it shares no request with an earlier arm.
   */
  sameRequestAs?: Record<A, A>;
  arms?: Record<A, EbArmResult>;
  /** Everything spent on the job, every arm included. */
  costUsd: number;
  latencyMs: number;
  calls: CallRecord[];
}

/** The arm names of a record type. */
export type ArmOf<R> = R extends ArmJobRecord<infer A> ? A : never;

export interface EffortBudgetRecord extends ArmJobRecord<EbArm> {
  /** Repairable info findings in the draft (the five rules). */
  eligibleInfo: number;
}

export type EbSaveName = 'draft' | EbArm | 'S1';

const sumMicro = (usage: CallUsage[]) => usage.reduce((a, u) => a + u.costMicroUsd, 0);

function countByKind(changes: Change[]): ArmResult['changesByKind'] {
  const out: ArmResult['changesByKind'] = {};
  for (const c of changes) out[c.kind] = (out[c.kind] ?? 0) + 1;
  return out;
}

const DOSE: Record<'0' | '1' | '2', 0 | 1 | 2> = { '0': 0, '1': 1, '2': 2 };

export async function runEffortBudgetJob(
  llm: LlmClient,
  catalog: CatalogSnapshot,
  scenario: Scenario,
  model: ModelChoice,
  repeat: number,
  save: (name: EbSaveName, project: Project) => void,
  /** Receives the model's rejected text when the first draft fails schema validation. */
  saveRejectedDraft: (text: string) => void = () => {},
): Promise<EffortBudgetRecord> {
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
    let draft: Draft;
    try {
      draft = await draftArchitecture(metered, catalog, step.input);
    } catch (err) {
      if (err instanceof GenerationError) saveRejectedDraft(meter.lastText);
      throw err;
    }
    const draftDoneMs = Date.now() - started;
    save('draft', draft.project);
    const seed = seedFor(scenario.id, repeat);
    const draftHasVr018 = hasVr018(draft.findings);

    const runArm = async (arm: EbArm): Promise<EbArmResult> => {
      const request: string[] = [];
      const sentAll: Finding[] = [];
      let current = draft;
      let turns: 0 | 1 | 2 = 0;
      const repairStarted = Date.now();
      const latencyMs = () => draftDoneMs + (Date.now() - repairStarted);
      const infoSent = () => sentAll.filter((f) => f.severity === 'info').length;
      const send = async (list: Finding[]) => {
        const message = repairMessageFor(list);
        request.push(message);
        sentAll.push(...list);
        current = await repairDraft(metered, catalog, step.input, current, message);
        turns = (turns + 1) as 1 | 2;
      };

      try {
        if (arm !== 'S') {
          const list = doseFindings(draft.findings, DOSE[arm], seed);
          if (list.length) await send(list);
        } else if (draftHasVr018) {
          await send(vr018Only(draft.findings));
          const next = armFindings(current.findings, 'I');
          if (next.length) {
            save('S1', current.project);
            await send(next);
          }
        } else {
          const list = armFindings(draft.findings, 'I');
          if (list.length) await send(list);
        }
      } catch (err) {
        if (!(err instanceof GenerationError)) throw err;
        return {
          ok: false,
          error: err.message,
          repaired: true,
          targeted: 0,
          collateral: 0,
          changesByKind: {},
          regressions: 0,
          unfixed: 0,
          score: scoreCandidate(scenario, null),
          costUsd: (extractionMicro + sumMicro(err.usage)) / 1e6,
          latencyMs: latencyMs(),
          turns,
          infoSent: infoSent(),
          request,
        };
      }

      const armLatencyMs = latencyMs();
      save(arm, current.project);
      const changes = turns ? diffDesigns(draft.project, current.project) : [];
      const { targeted, collateral } = classifyChanges(changes, sentAll, {
        before: draft.project,
        after: current.project,
      });
      return {
        ok: true,
        repaired: turns > 0,
        findingsByRule: countByRule(current.findings),
        targeted: targeted.length,
        collateral: collateral.length,
        changesByKind: countByKind(changes),
        regressions: regressions(draft.findings, current.findings).length,
        unfixed: leftUnfixed(draft.findings, current.findings).length,
        score: scoreCandidate(scenario, current.project),
        costUsd: (extractionMicro + sumMicro(current.usage)) / 1e6,
        latencyMs: armLatencyMs,
        turns,
        infoSent: infoSent(),
        ...(draftHasVr018 ? { vr018Fixed: !hasVr018(current.findings) } : {}),
        finalHash: graphContentHash(current.project),
        request,
      };
    };

    // Let every arm finish before deciding, so cost, calls and saves are final when we return.
    const settled = await Promise.allSettled(EB_ARMS.map(runArm));
    const failure = settled.find((r) => r.status === 'rejected');
    if (failure) throw failure.reason;
    const results = settled.map((r) => (r as PromiseFulfilledResult<EbArmResult>).value);
    const arms = Object.fromEntries(EB_ARMS.map((a, i) => [a, results[i]!])) as Record<
      EbArm,
      EbArmResult
    >;
    const key = (a: EbArm) => JSON.stringify(arms[a].request);
    const sameRequestAs = Object.fromEntries(
      EB_ARMS.map((a) => [a, EB_ARMS.find((b) => key(b) === key(a))!]),
    ) as Record<EbArm, EbArm>;

    return {
      ...base,
      ok: true,
      firstDraftFindingsByRule: countByRule(draft.findings),
      eligibleInfo: eligibleInfo(draft.findings).length,
      hasVr018: draftHasVr018,
      sameRequestAs,
      arms,
      ...done(),
    };
  } catch (err) {
    return {
      ...base,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      eligibleInfo: 0,
      hasVr018: false,
      ...done(),
    };
  }
}

/**
 * "`base` (arm 0) vs `arm`" in the two-arm shape of the info-repair experiment (W = arm 0, I = `arm`), so
 * `summarizeModel`, `evaluateCriteria` and `noiseFloor` apply unchanged.
 */
export function toPairRecord<R extends ArmJobRecord<string>>(
  r: R,
  arm: ArmOf<R>,
  base = '0' as ArmOf<R>,
): InfoRepairRecord {
  const w = r.arms?.[base];
  const i = r.arms?.[arm];
  return {
    scenarioId: r.scenarioId,
    model: r.model,
    repeat: r.repeat,
    ok: r.ok,
    ...(r.error !== undefined ? { error: r.error } : {}),
    ...(r.firstDraftFindingsByRule ? { firstDraftFindingsByRule: r.firstDraftFindingsByRule } : {}),
    infoSent: i?.infoSent ?? 0,
    // Identical *repairs* only: a job where neither arm made a call is not noise (as in the earlier runs).
    sameRequest: r.sameRequestAs?.[arm] === base && (w?.request.length ?? 0) > 0,
    differ: Boolean(w?.finalHash && i?.finalHash && w.finalHash !== i.finalHash),
    ...(w && i ? { arms: { W: w, I: i } } : {}),
    costUsd: r.costUsd,
    latencyMs: r.latencyMs,
    calls: r.calls,
  };
}
