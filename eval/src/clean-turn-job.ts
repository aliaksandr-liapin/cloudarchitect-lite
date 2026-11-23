/**
 * One job of the continued-vs-clean second turn experiment
 * (docs/superpowers/specs/2026-11-23-clean-turn-experiment-design.md). Extraction and a first draft
 * run once. Turn 1 runs once per branch and is shared; only turn 2 differs between a continued arm
 * (the whole conversation) and a fresh arm (request + turn 1's design + the new message).
 *
 * - 0: today's repair (errors and warnings), one turn.
 * - R: an independent second call of arm 0's request, only for the collateral noise floor.
 * - KC / KF: arm 0's turn, then the five repairable info findings left on its result.
 * - SC / SF: VR-018 alone, then arm I's set recomputed on that result; without VR-018 one turn
 *   with arm I's set.
 *
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
  repairDraftFresh,
  repairMessageFor,
  type CallUsage,
  type Draft,
  type GenerateInput,
  type LlmClient,
} from '@cloudarchitect/generator';
import {
  classifyChanges,
  diffDesigns,
  leftUnfixed,
  regressions,
  type Change,
} from './design-diff.js';
import { eligibleInfo, hasVr018, vr018Only } from './effort-budget-arms.js';
import type { ArmJobRecord, EbArmResult } from './effort-budget-job.js';
import { scoreCandidate, type Scenario } from './harness.js';
import { armFindings } from './info-repair-arms.js';
import type { ArmResult } from './info-repair-job.js';
import { Budget, extractWithAnswers, meteredClient } from './live-common.js';
import { countByRule } from './rule-hits.js';

export type CtArm = '0' | 'R' | 'KC' | 'KF' | 'SC' | 'SF';
export const CT_ARMS: readonly CtArm[] = ['0', 'R', 'KC', 'KF', 'SC', 'SF'];
/** The arms the bar can pick (SC is the control for SF; R only measures noise). */
export const CT_CANDIDATES = ['KC', 'KF', 'SF'] as const satisfies readonly CtArm[];

export interface CleanTurnRecord extends ArmJobRecord<CtArm> {
  /** Repairable info findings in the draft (the five rules). */
  eligibleInfo: number;
  /** KC and KF made separate turn-2 calls (continued vs fresh); false when they share a design. */
  kSplit: boolean;
  /** SC and SF made separate turn-2 calls. */
  sSplit: boolean;
}

export type CtSaveName = 'draft' | CtArm | 'S1';

/** Where an arm stands: the design so far and what was sent, or a failed call. */
interface Chain {
  current: Draft;
  request: string[];
  sent: Finding[];
  turns: 0 | 1 | 2;
  error?: GenerationError;
}

type Mode = 'continued' | 'fresh';

const sumMicro = (usage: CallUsage[]) => usage.reduce((a, u) => a + u.costMicroUsd, 0);

function countByKind(changes: Change[]): ArmResult['changesByKind'] {
  const out: ArmResult['changesByKind'] = {};
  for (const c of changes) out[c.kind] = (out[c.kind] ?? 0) + 1;
  return out;
}

/** The five repairable info findings only (K's second turn). */
export const infoOnly = (findings: Finding[]): Finding[] => eligibleInfo(findings);

/** Settle every promise, then rethrow the first rejection, so cost and saves are final. */
async function all<T>(ps: Promise<T>[]): Promise<T[]> {
  const settled = await Promise.allSettled(ps);
  const failure = settled.find((r) => r.status === 'rejected');
  if (failure) throw failure.reason;
  return settled.map((r) => (r as PromiseFulfilledResult<T>).value);
}

export async function runCleanTurnJob(
  llm: LlmClient,
  catalog: CatalogSnapshot,
  scenario: Scenario,
  model: ModelChoice,
  repeat: number,
  save: (name: CtSaveName, project: Project) => void,
  /** Receives the model's rejected text when the first draft fails schema validation. */
  saveRejectedDraft: (text: string) => void = () => {},
): Promise<CleanTurnRecord> {
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
    const input: GenerateInput = step.input;
    const extractionMicro = sumMicro(step.usage);
    let draft: Draft;
    try {
      draft = await draftArchitecture(metered, catalog, input);
    } catch (err) {
      if (err instanceof GenerationError) saveRejectedDraft(meter.lastText);
      throw err;
    }
    const draftDoneMs = Date.now() - started;
    save('draft', draft.project);
    const draftHasVr018 = hasVr018(draft.findings);

    const start: Chain = { current: draft, request: [], sent: [], turns: 0 };
    /** One more turn on `c`; a failed chain stays failed, an empty list makes no call. */
    const send = async (c: Chain, list: Finding[], mode: Mode = 'continued'): Promise<Chain> => {
      if (c.error || !list.length) return c;
      const message = repairMessageFor(list);
      const next = {
        request: [...c.request, message],
        sent: [...c.sent, ...list],
        turns: (c.turns + 1) as 1 | 2,
      };
      try {
        const repair = mode === 'fresh' ? repairDraftFresh : repairDraft;
        return { ...next, current: await repair(metered, catalog, input, c.current, message) };
      } catch (err) {
        if (!(err instanceof GenerationError)) throw err;
        return { ...next, current: c.current, error: err };
      }
    };
    /** Turn 2 in both modes from one shared chain; one call when the two contexts are identical. */
    const branch = async (c: Chain, list: Finding[]): Promise<[Chain, Chain, boolean]> => {
      if (c.error || !list.length) return [c, c, false];
      if (c.turns === 0) {
        const one = await send(c, list);
        return [one, one, false];
      }
      const [cont, fresh] = await all([send(c, list), send(c, list, 'fresh')]);
      return [cont!, fresh!, true];
    };

    const kBranch = async (): Promise<[Chain, Chain, Chain, boolean]> => {
      const t1 = await send(start, armFindings(draft.findings, 'W'));
      const [kc, kf, split] = await branch(t1, infoOnly(t1.current.findings));
      return [t1, kc, kf, split];
    };
    const sBranch = async (): Promise<[Chain, Chain, boolean]> => {
      if (!draftHasVr018) {
        const one = await send(start, armFindings(draft.findings, 'I'));
        return [one, one, false];
      }
      const t1 = await send(start, vr018Only(draft.findings));
      const next = t1.error ? [] : armFindings(t1.current.findings, 'I');
      if (next.length) save('S1', t1.current.project);
      return branch(t1, next);
    };
    const replica = () => send(start, armFindings(draft.findings, 'W'));

    const [k, s, r] = await all<unknown>([kBranch(), sBranch(), replica()]);
    const [zero, kc, kf, kSplit] = k as Awaited<ReturnType<typeof kBranch>>;
    const [sc, sf, sSplit] = s as Awaited<ReturnType<typeof sBranch>>;
    const chains: Record<CtArm, Chain> = {
      '0': zero,
      R: r as Chain,
      KC: kc,
      KF: kf,
      SC: sc,
      SF: sf,
    };

    const latencyMs = Date.now() - started;
    const result = (arm: CtArm): EbArmResult => {
      const c = chains[arm];
      const infoSent = c.sent.filter((f) => f.severity === 'info').length;
      if (c.error) {
        return {
          ok: false,
          error: c.error.message,
          repaired: true,
          targeted: 0,
          collateral: 0,
          changesByKind: {},
          regressions: 0,
          unfixed: 0,
          score: scoreCandidate(scenario, null),
          costUsd: (extractionMicro + sumMicro(c.error.usage)) / 1e6,
          latencyMs,
          turns: c.turns,
          infoSent,
          request: c.request,
        };
      }
      save(arm, c.current.project);
      const changes = c.turns ? diffDesigns(draft.project, c.current.project) : [];
      const { targeted, collateral } = classifyChanges(changes, c.sent, {
        before: draft.project,
        after: c.current.project,
      });
      return {
        ok: true,
        repaired: c.turns > 0,
        findingsByRule: countByRule(c.current.findings),
        targeted: targeted.length,
        collateral: collateral.length,
        changesByKind: countByKind(changes),
        regressions: regressions(draft.findings, c.current.findings).length,
        unfixed: leftUnfixed(draft.findings, c.current.findings).length,
        score: scoreCandidate(scenario, c.current.project),
        costUsd: (extractionMicro + sumMicro(c.current.usage)) / 1e6,
        latencyMs: c.turns ? latencyMs : draftDoneMs,
        turns: c.turns,
        infoSent,
        ...(draftHasVr018 ? { vr018Fixed: !hasVr018(c.current.findings) } : {}),
        finalHash: graphContentHash(c.current.project),
        request: c.request,
      };
    };
    const arms = Object.fromEntries(CT_ARMS.map((a) => [a, result(a)])) as Record<
      CtArm,
      EbArmResult
    >;
    // Only R repeats another arm's request as a separate call; shared designs are not noise.
    const sameRequestAs = Object.fromEntries(CT_ARMS.map((a) => [a, a])) as Record<CtArm, CtArm>;
    if (zero.turns > 0) sameRequestAs.R = '0';

    return {
      ...base,
      ok: true,
      firstDraftFindingsByRule: countByRule(draft.findings),
      eligibleInfo: eligibleInfo(draft.findings).length,
      hasVr018: draftHasVr018,
      kSplit,
      sSplit,
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
      kSplit: false,
      sSplit: false,
      ...done(),
    };
  }
}
