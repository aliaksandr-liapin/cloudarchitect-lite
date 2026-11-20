# Effort budget and separate-turn experiment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the GPT Luna experiment tooling: four repair arms (0, 1 and 2 info findings, and S = VR-018 alone first), run from one draft per job, plus a checker that applies the pre-registered bar.

**Architecture:** A new arms module picks what each arm sends. A new job module runs extraction and a draft once, then the four arms concurrently (S may take two turns). A projection maps "arm 0 vs arm X" onto the existing two-arm `InfoRepairRecord` shape, so `summarizeModel`, `evaluateCriteria` and `noiseFloor` from `info-repair-stats.ts` are reused unchanged. The runner and report scripts mirror `info-repair.ts` and `info-repair-followup.ts`. Existing `info-repair*` files are not modified.

**Tech Stack:** TypeScript (ESM), vitest, tsx scripts in `eval/`, `@cloudarchitect/generator` (`draftArchitecture`, `repairDraft`, `repairMessageFor`), `@cloudarchitect/domain`.

**Spec:** `docs/superpowers/specs/2026-11-20-effort-budget-experiment-design.md`

## Global Constraints

- Never make a paid API call while building. Tests use a fake `LlmClient`. The real run happens only after the owner's explicit yes, with `--max-usd 1.50`.
- `--max-usd` is required by the runner. There is one shared `Budget`, and the runner stops when the budget is exhausted (`cutShort`).
- Defaults: `--models gpt-luna`, `--repeats 5`, `--concurrency 4`.
- Repairable info rules are exactly `INFO_RULES_TO_REPAIR` (VR-005, VR-007, VR-008, VR-013, VR-024), imported from `info-repair-arms.ts`. They are not copied.
- Every repair message is built with `repairMessageFor(findings)`, the plain wording.
- Arm S turn 2 sends `armFindings(turn1Result.findings, 'I')`, i.e. the findings recomputed on turn 1's design.
- `info-repair*.ts` files keep their behaviour, so old runs still reproduce.
- Console output shows ids, counts, cost and latency only. Results go to `eval/results/live/<runId>/` (git-ignored).
- Run prettier on any `docs/` file you touch (`pnpm format:check` runs in CI).
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **S turn 1 fails schema validation on a VR-018 draft.** Arm S is recorded as failed (`ok:false`), the other three arms are unaffected, and the job stays `ok`. Tested in Task 2.
2. **S turn 1 leaves nothing to send.** Turn 2 is skipped (`turns: 1`), and the final design is turn 1's design. Tested in Task 2.
3. **A draft with 0 or 1 eligible info findings.** Arms 1 and 2 send what exists, and `sameRequestAs` names the lowest arm with the identical request, so these jobs feed the noise floor and are excluded from the dose subset. Tested in Tasks 1–2.
4. **A draft with no errors, warnings or eligible info.** Every arm makes no call and keeps the draft (`repaired: false`, `turns: 0`); nothing crashes. Tested in Task 2.
5. **Records with failed jobs or failed arms** in the report. These are filtered out of paired comparisons and counted in the failure lines, and the bar evaluates without throwing. Tested in Task 3.

---

### Task 1: Arm selection

**Files:**

- Create: `eval/src/effort-budget-arms.ts`
- Test: `eval/src/effort-budget-arms.test.ts`

**Interfaces:**

- Consumes: `INFO_RULES_TO_REPAIR`, `armFindings` from `./info-repair-arms.js`; `rng`, `shuffle` from `./packets.js`; `repairMessageFor` from `@cloudarchitect/generator`; `Finding` from `@cloudarchitect/domain`.
- Produces:
  - `type EbArm = '0' | '1' | '2' | 'S'`
  - `const EB_ARMS: readonly EbArm[] = ['0', '1', '2', 'S']`
  - `seedFor(scenarioId: string, repeat: number): number`, a stable 32-bit hash of `${scenarioId}#${repeat}`.
  - `eligibleInfo(findings: Finding[]): Finding[]`: info findings whose `ruleId` is in `INFO_RULES_TO_REPAIR`, in validator order.
  - `pickInfo(findings: Finding[], k: number, seed: number): Finding[]`: `shuffle(eligibleInfo(findings), rng(seed)).slice(0, k)`.
  - `doseFindings(findings: Finding[], k: 0 | 1 | 2, seed: number): Finding[]`: errors and warnings (validator order), then `pickInfo(…, k, seed)`.
  - `hasVr018(findings: Finding[]): boolean`
  - `vr018Only(findings: Finding[]): Finding[]`
  - `doseMessage(findings: Finding[], k: 0 | 1 | 2, seed: number): string | undefined`: `repairMessageFor(doseFindings(…))`, or undefined when the list is empty.

- [ ] **Step 1: Write the failing tests** in `effort-budget-arms.test.ts`. Build findings with a small local helper (`{ ruleId, severity, message, ... }`, copying the shape used in `info-repair-arms.test.ts`).

```ts
it('arm 2 is a superset of arm 1 and both use the same seed', () => {
  const fs = [warn('VR-018'), info('VR-008'), info('VR-005'), info('VR-007')];
  const seed = seedFor('orders', 1);
  const one = pickInfo(fs, 1, seed);
  const two = pickInfo(fs, 2, seed);
  expect(one).toHaveLength(1);
  expect(two).toHaveLength(2);
  expect(two[0]).toBe(one[0]);
});
it('seedFor is stable and differs across repeats', () => {
  expect(seedFor('orders', 1)).toBe(seedFor('orders', 1));
  expect(seedFor('orders', 1)).not.toBe(seedFor('orders', 2));
});
it('ignores info rules outside the five (VR-015) and sends what exists when fewer than k', () => {
  const fs = [warn('VR-018'), info('VR-015'), info('VR-008')];
  expect(pickInfo(fs, 2, 1).map((f) => f.ruleId)).toEqual(['VR-008']);
});
it('dose 0 equals the W arm list', () => {
  const fs = [err('VR-001'), warn('VR-018'), info('VR-008')];
  expect(doseFindings(fs, 0, 1)).toEqual(armFindings(fs, 'W'));
});
it('errors and warnings come before info in a dose list', () => {
  const fs = [info('VR-008'), warn('VR-018')];
  expect(doseFindings(fs, 1, 1).map((f) => f.severity)).toEqual(['warning', 'info']);
});
it('vr018Only keeps every VR-018 finding and nothing else', () => {
  const fs = [warn('VR-018', 'alb1'), warn('VR-004'), warn('VR-018', 'alb2')];
  expect(vr018Only(fs)).toHaveLength(2);
  expect(hasVr018(fs)).toBe(true);
  expect(hasVr018([warn('VR-004')])).toBe(false);
});
it('doseMessage is undefined when nothing is sent', () => {
  expect(doseMessage([info('VR-015')], 2, 1)).toBeUndefined();
});
```

- [ ] **Step 2: Run and see them fail**

Run: `pnpm --filter @cloudarchitect/eval exec vitest run src/effort-budget-arms.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement `eval/src/effort-budget-arms.ts`** with the signatures above. For `seedFor`, use FNV-1a over the string's UTF-16 code units, returned as an unsigned 32-bit number.

- [ ] **Step 4: Run and see them pass**

Same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add eval/src/effort-budget-arms.ts eval/src/effort-budget-arms.test.ts
git commit -m "feat(eval): effort-budget arm selection (seeded, nested info picks; VR-018 first turn)"
```

---

### Task 2: The job (four arms from one draft) and its two-arm projection

**Files:**

- Create: `eval/src/effort-budget-job.ts`
- Test: `eval/src/effort-budget-job.test.ts`

**Interfaces:**

- Consumes:
  - Task 1's exports;
  - `ArmResult`, `InfoRepairRecord` (types) from `./info-repair-job.js`;
  - `draftArchitecture`, `repairDraft`, `GenerationError`, `Draft` from `@cloudarchitect/generator`;
  - `diffDesigns`, `classifyChanges`, `regressions`, `leftUnfixed` from `./design-diff.js`;
  - `scoreCandidate` from `./harness.js`;
  - `extractWithAnswers`, `meteredClient`, `Budget` from `./live-common.js`;
  - `countByRule` from `./rule-hits.js`;
  - `graphContentHash` from `@cloudarchitect/domain`.
- Produces:
  - `interface EbArmResult extends ArmResult { turns: 0 | 1 | 2; infoSent: number; vr018Fixed?: boolean; finalHash?: string; request: string[] }`. `request` holds the messages sent, in order (empty when no call). `vr018Fixed` is set only when the draft had VR-018 and the arm is ok.
  - `interface EffortBudgetRecord { scenarioId; model; repeat; ok; error?; firstDraftFindingsByRule?; eligibleInfo: number; hasVr018: boolean; sameRequestAs: Record<EbArm, EbArm>; arms?: Record<EbArm, EbArmResult>; costUsd; latencyMs; calls }`. `sameRequestAs[x]` is the first arm in `EB_ARMS` order whose `request` equals x's (itself if none earlier).
  - `runEffortBudgetJob(llm, catalog, scenario, model, repeat, save: (name: 'draft' | EbArm | 'S1', project) => void, saveRejectedDraft?: (text: string) => void): Promise<EffortBudgetRecord>`. `'S1'` saves S's turn-1 design when a second turn follows.
  - `toPairRecord(r: EffortBudgetRecord, arm: Exclude<EbArm, '0'>): InfoRepairRecord`. W = arm 0, I = `arm`; `infoSent` = arm's `infoSent`; `sameRequest` = `sameRequestAs[arm] === '0'`; `differ` from `finalHash`; `armsDiff` omitted. With this mapping the existing `summarizeModel(records.map(r => toPairRecord(r, 'S')), …)` compares S with arm 0.

- [ ] **Step 1: Write the failing tests** with a fake `LlmClient`. Copy the request/response fake and the `scenario`/`extraction`/`graph` helpers from `info-repair-job.test.ts`, and add a graph variant that fires VR-018: an ALB in one subnet/AZ. Use the VR-018 fixture in `packages/domain/src/domain.test.ts` for the minimal shape. The fake returns responses keyed on the last user message, so each arm's call is distinguishable.

  Test cases:
  - `'runs four arms from one draft: one extraction, one draft call'`: the fake counts draft calls, `expect(draftCalls).toBe(1)`, and `Object.keys(r.arms!)` equals `['0','1','2','S']`.
  - `'S sends VR-018 alone first, then the recomputed I set'`: S `request[0]` mentions VR-018 and not VR-004; `request[1]` is `repairMessageFor(armFindings(turn1Findings, 'I'))`; `turns === 2`.
  - `'S skips turn 2 when turn 1 leaves nothing to send'`: turn 1 returns a clean design, so `turns === 1` and `request.length === 1`.
  - `'S without VR-018 is one turn with the I set'`: `turns === 1`, and `request[0] === repairMessageFor(armFindings(draftFindings, 'I'))`.
  - `'S turn-1 schema failure fails only S'`: the fake returns invalid JSON for the VR-018-only message, so `r.ok === true`, `r.arms!.S.ok === false`, and arms 0/1/2 are ok.
  - `'no findings to send: no calls, every arm keeps the draft'`: `turns === 0` for all, `repaired === false`, and only extraction and draft calls were made.
  - `'sameRequestAs maps arms 1 and 2 to 0 when the draft has no eligible info'`.
  - `'toPairRecord maps arm 0 to W and S to I'`: `pair.arms!.W === r.arms!['0']`, `pair.arms!.I === r.arms!.S`, and `pair.sameRequest === (r.sameRequestAs.S === '0')`.
  - `'vr018Fixed is true when the final design no longer has VR-018'`.
  - `'cost of S includes the draft and both turns'`: `r.arms!.S.costUsd > r.arms!['0'].costUsd` when S made two calls.

- [ ] **Step 2: Run and see them fail**

Run: `pnpm --filter @cloudarchitect/eval exec vitest run src/effort-budget-job.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `eval/src/effort-budget-job.ts`.** Follow `runInfoRepairJob`'s structure: local meter, extraction, draft, `Promise.allSettled` over the arms, and a thrown non-`GenerationError` failing the job.
  - Arms 0, 1 and 2 use `doseMessage(draft.findings, k, seedFor(scenario.id, repeat))`.
  - S runs `repairDraft` with `repairMessageFor(vr018Only(draft.findings))` when `hasVr018`. Turn 2 then runs `repairDraft(…, turn1, repairMessageFor(armFindings(turn1.findings, 'I')))` when that list is non-empty. Without VR-018, S makes one call with `armFindings(draft.findings, 'I')`.
  - For every arm, diff and classify against the original draft. `classifyChanges` gets every finding the arm sent, all turns combined.
  - `unfixed` and `regressions` compare the draft's findings with the final ones.
  - `costUsd` = extraction + `sumMicro(final.usage)`, because `repairDraft` carries the earlier usage forward.
  - `infoSent` counts the info findings in the arm's sent lists, all turns combined.
  - Leave `info-repair-job.ts` unchanged. A small private helper inside the new file, duplicating its ~25-line arm body, is acceptable. Do not export or refactor the old one.

- [ ] **Step 4: Run and see them pass**

Same command, then `pnpm --filter @cloudarchitect/eval exec vitest run` (the whole eval suite stays green). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add eval/src/effort-budget-job.ts eval/src/effort-budget-job.test.ts
git commit -m "feat(eval): effort-budget job: four repair arms from one draft, S takes VR-018 first"
```

---

### Task 3: Runner, bar check and dose verdict

**Files:**

- Create: `eval/src/effort-budget.ts` (runner, paid)
- Create: `eval/src/effort-budget-report.ts` (checker, free)
- Test: `eval/src/effort-budget-report.test.ts`
- Modify: `eval/package.json` (scripts `"effort-budget": "tsx src/effort-budget.ts"`, `"effort-budget-report": "tsx src/effort-budget-report.ts"`)

**Interfaces:**

- Consumes: Task 2's `EffortBudgetRecord`, `toPairRecord` and `runEffortBudgetJob`; `summarizeModel`, `evaluateCriteria`, `CriterionResult`, `pairedBootstrap`, `isClear` from `./info-repair-stats.js`.
- Produces:
  - `separateTurnCriteria(records: EffortBudgetRecord[], model: string, seed: number): CriterionResult[]`, ids 1–6, matching the spec's bar:
    1. `evaluateCriteria(...)` criterion 1 on the S projection (info except VR-015, as in the earlier runs).
    2. `diff.errorsWarnings.mean <= 0`.
    3. On VR-018 drafts where arms 0 and S are both ok: S fixed count ≥ arm 0 fixed count.
    4. Paired mean of `unfixed(S) − unfixed(0)` ≤ 0.
    5. The existing criteria 3 and 4 combined (collateral within the noise floor, regressions not clearly up), as in `followupCriteria`.
    6. Informational: extra cost per design, plus the share of jobs where S used 2 turns.
  - `separateTurnPasses(c: CriterionResult[]): boolean`: criteria 1–5 all `met === true`.
  - `doseCounts(records, model): { drafts: number; fixed: Record<'0' | '1' | '2', number> }` over the dose subset: job ok; arms 0, 1 and 2 ok; draft has VR-018; `eligibleInfo >= 2`.
  - `doseVerdict(c): 'supported' | 'partly supported' | 'not supported'`:
    - supported: `fixed['0'] >= fixed['1'] >= fixed['2']` and `fixed['0'] - fixed['2'] >= 3`;
    - partly supported: `fixed['0'] > fixed['2']` otherwise;
    - not supported: `fixed['0'] <= fixed['2']`.

- [ ] **Step 1: Write the failing tests** in `effort-budget-report.test.ts`. Build `EffortBudgetRecord`s with a local factory (`mk({ hasVr018, eligibleInfo, arms: { '0': {...}, S: {...} } })`); no LLM is involved.
  - `'criterion 3 compares VR-018 fixes on VR-018 drafts only'`: 3 VR-018 drafts, 0 fixes 2 and S fixes 3, so met. Swap the numbers and it's not met.
  - `'criterion 4 fails when S leaves more unfixed'`.
  - `'failed arms are excluded from pairs and do not throw'`: one record with `S.ok === false`, one with `ok === false`; `separateTurnCriteria` returns 6 results.
  - `'dose subset needs VR-018 and at least 2 eligible info findings'`: `doseCounts(...).drafts` counts only those.
  - `doseVerdict` table: `{0:10,1:8,2:6}` → supported; `{0:10,1:11,2:8}` → partly supported; `{0:6,1:7,2:6}` → not supported; `{0:7,1:6,2:5}` → partly supported (falls, but by only 2).
  - `'separateTurnPasses ignores criterion 6'`.

- [ ] **Step 2: Run and see them fail**

Run: `pnpm --filter @cloudarchitect/eval exec vitest run src/effort-budget-report.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `effort-budget-report.ts`.** Export the functions above. When the file runs as a script (same `import.meta.url` guard as `info-repair-followup.ts`), take `<absolute run dir> [--model gpt-luna] [--seed 1]` and print:
  - jobs, paired jobs and failures per arm;
  - per arm: errors + warnings, info, unfixed per design, VR-008 and VR-018 counts in final designs, and cost per design;
  - VR-018 fix counts on VR-018 drafts for every arm;
  - the dose subset counts and verdict;
  - each criterion (`met` / `NOT met` and detail);
  - the final line: `Result: S replaces today's repair for Luna.` or `Result: S fails; Luna keeps errors and warnings only.`

- [ ] **Step 4: Implement `effort-budget.ts`.** Mirror `info-repair.ts`:
  - options: `--models` (default `gpt-luna`), `--repeats` (default `5`), `--scenarios`, `--concurrency` (default `4`), `--max-usd` (required); no `--info-message`;
  - the same key check and `Budget`;
  - output files: `${model}-${scenario}-${repeat}.${name}.project.json`, plus `.rejected.txt`, `records.json` and `summary.json` (`runId`, `repeats`, `scenarios`, `models`, `maxUsd`, `spentUsd`, `cutShort`, `experiment: 'effort-budget'`);
  - a per-job console line with `0/1/2/S` pass marks, `S turns`, `info eligible`, `VR-018 yes/no`, cost and latency.

  Update the file header comment to say it makes PAID API calls.

- [ ] **Step 5: Add the two scripts to `eval/package.json`**, then run the tests and the full CI.

Run: `pnpm --filter @cloudarchitect/eval exec vitest run`, then `pnpm run ci`. Expected: all pass.

- [ ] **Step 6: Check that the runner refuses to start uncapped (no API call is made)**

Run: `pnpm --filter @cloudarchitect/eval effort-budget`. Expected: it exits with `--max-usd is required`. Don't run it with `--max-usd`.

- [ ] **Step 7: Commit**

```bash
git add eval/src/effort-budget.ts eval/src/effort-budget-report.ts eval/src/effort-budget-report.test.ts eval/package.json
git commit -m "feat(eval): effort-budget runner and pre-registered bar check"
```

---

### After the build (not part of this plan's execution)

The paid run waits for the owner's explicit yes in chat:
`pnpm --filter @cloudarchitect/eval effort-budget --max-usd 1.50`, then `effort-budget-report <absolute run dir>`. After that come the report section "Follow-up 2: effort budget and a separate turn" in `docs/product/info-repair-experiment.md` (with cost and reproduce lines) and the dev.to reply. Those are written from the actual numbers in a separate step.
