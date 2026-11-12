# Info findings in the repair turn — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An eval-only experiment that repairs each first draft twice (today's errors+warnings, and with info findings too), measures findings, collateral changes, regressions, blind score and cost, and produces a report with a recommendation.

**Architecture:** The generator's single `generateArchitecture` is split into exported steps (`draftArchitecture`, `repairDraft`) that it composes with unchanged behavior. A new eval script runs extraction + draft once per job and both repair arms from that draft, saving all three designs. Pure modules do the structural diff, the arm rules and the statistics; the existing review panel gets an "arms" pairing mode; a report script prints the tables and the six criteria.

**Tech Stack:** TypeScript (Node 26, ESM), pnpm workspace, vitest, zod; existing provider adapters in `@cloudarchitect/generator`.

**Spec:** `docs/superpowers/specs/2026-11-11-info-repair-experiment-design.md`

## Global Constraints

- The app's generation behavior does not change: `generateArchitecture` sends only `error` and `warning` findings, with today's `repairMessage` text, and existing generator tests stay green unmodified.
- Models: `haiku`, `gpt-luna`, `gemini-flash-lite`; 22 scenarios × 2 repeats = 44 jobs per model.
- Info rules sent in arm I: `VR-005`, `VR-007`, `VR-008`, `VR-013`, `VR-024`. `VR-015` is never sent and is excluded from criterion 1's info count (reported separately).
- Arm I repair message (exact): `The deterministic validator reported these findings on your architecture:\n{list}\n\nReturn the complete corrected architecture. Fix every error. Fix each warning, or keep it only if it is intentional and say why in assumptions. Apply each info finding if it fits the requirements; otherwise leave it and say why in assumptions. Do not change anything else.`
- Statistics: paired bootstrap over jobs, 90% interval, 2000 resamples, seeded; a difference is "clear" only if the interval excludes zero. Noise floor pooled across models when a model has fewer than 10 same-request jobs.
- Blind review: 10 pairs per model (30), seed 1, packets of three, three reviewers.
- Paid runs only after the owner's yes in chat; caps: generation `--max-usd 2.50`, review `--max-usd 7.00`. A cap hit or re-run needs a new yes.
- No tests make paid calls; `pnpm run ci` stays offline. Never read or print the repo-root `.env`; keys load through the existing loader. Console output carries ids, counts, cost and latency only, never model text.
- Results under `eval/results/live/<runId>/` and `eval/reviews/info-repair-<date>/` (git-ignored as today). Public docs in English.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A job whose draft fails (schema-invalid, transport error, cap) → recorded `ok: false` without arms; stats count it as a failed job for both arms and nothing crashes. A job where only one arm's repair is schema-invalid → that arm is `ok: false` (not passed, no diff), the other arm is still used. _(Task 4 test `runInfoRepairJob records a failed arm without dropping the job`; Task 5 test `summarizeModel counts failed jobs and failed arms`.)_
2. Ids renamed by the repair, or an edge whose endpoint node was removed → counted as remove + add, never a crash or `undefined` key. _(Task 3 test `diffDesigns treats a renamed node as removed plus added`.)_
3. Findings that name only requirements (VR-012) or nothing at all → a dropped requirement link is targeted when the finding names that requirement; findings with no ids target nothing. _(Task 3 test `classifyChanges uses requirementIds for dropped links`.)_
4. No same-request jobs for any model → noise floor reported as unavailable and criterion 3 falls back to the plain clear-difference test. _(Task 5 test `noiseFloor is undefined when no same-request jobs exist`.)_
5. Spend cap reached mid-run → the run is marked `cutShort`, and the report prints "partial run" and no recommendation. _(Task 6 test `report refuses a recommendation for a partial run`.)_

---

### Task 1: Split the generator into draft and repair steps

**Files:**

- Modify: `packages/generator/src/generate.ts`
- Test: `packages/generator/src/generate.test.ts`

**Interfaces:**

- Produces (exported from `@cloudarchitect/generator`):
  - `interface Draft { project: Project; text: string; messages: { role: 'user' | 'assistant'; content: string }[]; usage: CallUsage[]; findings: Finding[] }`
  - `draftArchitecture(llm: LlmClient, catalog: CatalogSnapshot, input: GenerateInput): Promise<Draft>` — extraction is not included; one model call; `findings = validateProject(project, catalog)`; `messages` is the conversation so far (the user message only).
  - `formatFindings(findings: Finding[]): string` — today's list formatting (rule id, severity, explanation, `Fix:`, nodes, edges), one line per finding.
  - `repairMessage(list: string): string` — today's text, now exported.
  - `repairDraft(llm, catalog, input: GenerateInput, draft: Draft, message: string): Promise<Draft>` — appends `{assistant: draft.text}` and `{user: message}` to a copy of `draft.messages`, makes one call, returns a new `Draft` (new `messages`, `usage` = draft.usage + this call, `findings` re-validated). Never mutates `draft`.
  - `generateArchitecture` keeps its signature and `GenerateResult`; it composes the two steps with the existing `severity !== 'info'` filter and `option.repairTurns` loop, then sets `contentHash`.

- [ ] **Step 1: Write the failing tests** in `generate.test.ts`:
  - `draftArchitecture returns the first draft, its findings and one usage entry` — with `fake(graph(false))`: `findings` contains a `VR-004` finding; `usage.length === 1`; `messages.length === 1`.
  - `repairDraft repairs from the given draft without mutating it` — call `repairDraft` twice on the same draft with different messages; both requests (captured by `fake`) have 3 messages, the last being each message; `draft.messages.length` is still 1; each result's `usage.length === 2`.
  - `generateArchitecture never sends info findings to repair` — a graph whose only findings are info (e.g. a data store with no encryption config) makes exactly one call and `repairTurnsUsed === 0`.
- [ ] **Step 2: Run** `pnpm --filter @cloudarchitect/generator test` — expected: the new tests fail (`draftArchitecture is not a function`).
- [ ] **Step 3: Implement** the interfaces above in `generate.ts`; move today's `build()` body into a private helper used by both steps.
- [ ] **Step 4: Run** `pnpm --filter @cloudarchitect/generator test` — expected: all tests pass, existing ones unmodified.
- [ ] **Step 5: Commit** `refactor(generator): export draft and repair steps (behavior unchanged)`.

### Task 2: Arm rules, review sampling

**Files:**

- Create: `eval/src/info-repair-arms.ts`
- Test: `eval/src/info-repair-arms.test.ts`

**Interfaces:**

- Produces:
  - `type Arm = 'W' | 'I'`
  - `const INFO_RULES_TO_REPAIR = ['VR-005', 'VR-007', 'VR-008', 'VR-013', 'VR-024'] as const`
  - `armFindings(findings: Finding[], arm: Arm): Finding[]` — W: severity error|warning; I: W plus info findings whose `ruleId` is in `INFO_RULES_TO_REPAIR`. Order preserved.
  - `infoRepairMessage(list: string): string` — the exact arm I text from Global Constraints.
  - `messageFor(arm: Arm, findings: Finding[]): string | undefined` — `undefined` when `armFindings` is empty (no repair); W uses `repairMessage(formatFindings(...))`, I uses `infoRepairMessage(formatFindings(...))`.
  - `sampleReviewJobs<T extends { model: string; differ: boolean; infoSent: number }>(jobs: T[], perModel: number, seed: number): T[]` — per model, only `differ` jobs; those with `infoSent > 0` first, each group shuffled with the seeded PRNG; take `perModel`.
- Consumes: `formatFindings`, `repairMessage` (Task 1); `rng`, `shuffle` from `eval/src/packets.ts` (export them there).

- [ ] **Step 1: Write the failing tests:**
  - `armFindings W keeps errors and warnings only`; `armFindings I adds the five info rules but never VR-015`.
  - `infoRepairMessage matches the spec text` (full string equality with the Global Constraints text, `{list}` = `- x`).
  - `messageFor returns undefined when the arm has nothing to send` (info-only VR-015 draft → both arms `undefined`; info-only VR-008 draft → W `undefined`, I defined).
  - `sampleReviewJobs takes jobs with info first, is stable for a seed, and skips identical pairs`.
- [ ] **Step 2: Run** `pnpm --filter @cloudarchitect/eval test info-repair-arms` — expected FAIL (module not found).
- [ ] **Step 3: Implement** the interfaces; export `rng` and `shuffle` from `packets.ts` without changing them.
- [ ] **Step 4: Run** `pnpm --filter @cloudarchitect/eval test` — expected PASS.
- [ ] **Step 5: Commit** `feat(eval): arm rules and review sampling for the info-repair experiment`.

### Task 3: Structural diff, targeted vs collateral, regressions

**Files:**

- Create: `eval/src/design-diff.ts`
- Test: `eval/src/design-diff.test.ts`

**Interfaces:**

- Produces:
  - `type ChangeKind = 'node-added' | 'node-removed' | 'service-changed' | 'edge-added' | 'edge-removed' | 'edge-rewired' | 'container-moved' | 'requirement-link-dropped'`
  - `interface Change { kind: ChangeKind; nodeIds: string[]; edgeIds: string[]; requirementId?: string }` — edge changes carry the edge id and both endpoint ids (before and after, for rewired) in `nodeIds`.
  - `diffDesigns(before: Project, after: Project): Change[]` — by element id. A node's "service" is `serviceId`, else `unresolved:<name>`, else `external:<kind>:<name>`. `container-moved`: `containerId` differs. `requirement-link-dropped`: one change per (element, requirement id) present before and absent after, on nodes and edges that exist in both. Positions, sizes, labels, purposes, configuration and containers themselves are ignored.
  - `classifyChanges(changes: Change[], sent: Finding[]): { targeted: Change[]; collateral: Change[] }` — targeted if any `nodeIds`/`edgeIds` intersect the sent findings' ids, or `requirementId` is in a sent finding's `requirementIds`.
  - `findingKey(f: Finding): string` — `ruleId ?? 'structural'`, severity, sorted `nodeIds`, sorted `edgeIds`, joined by `|`.
  - `regressions(firstDraft: Finding[], repaired: Finding[]): Finding[]` — repaired findings whose key is not among the first draft's.

- [ ] **Step 1: Write the failing tests** (small hand-built projects):
  - `diffDesigns reports no changes for identical designs, and ignores positions and labels`.
  - `diffDesigns detects each change kind` — one assertion per kind.
  - `diffDesigns treats a renamed node as removed plus added` — and an edge to the old id counts as edge-removed + edge-added without throwing.
  - `classifyChanges marks an edge change targeted when a finding names either endpoint`.
  - `classifyChanges uses requirementIds for dropped links` — VR-012-style finding with only `requirementIds`.
  - `regressions ignores findings present in the first draft and reports new ones`.
- [ ] **Step 2: Run** `pnpm --filter @cloudarchitect/eval test design-diff` — expected FAIL.
- [ ] **Step 3: Implement** `design-diff.ts`.
- [ ] **Step 4: Run** `pnpm --filter @cloudarchitect/eval test` — expected PASS.
- [ ] **Step 5: Commit** `feat(eval): structural design diff with targeted and collateral changes`.

### Task 4: The paired job runner and its CLI

**Files:**

- Create: `eval/src/info-repair-job.ts` (job logic, testable with a fake LLM)
- Create: `eval/src/live-common.ts` (shared with `live.ts`: provider clients from env/.env, scenario loading, the cap-checked LLM wrapper)
- Create: `eval/src/info-repair.ts` (CLI)
- Modify: `eval/src/live.ts` (use `live-common.ts`; behavior and output unchanged), `eval/package.json` (script `"info-repair": "tsx src/info-repair.ts"`)
- Test: `eval/src/info-repair-job.test.ts`

**Interfaces:**

- Consumes: Task 1 steps, Task 2 `armFindings`/`messageFor`, Task 3 diff functions, `extract`, `scoreCandidate`, `countByRule`.
- Produces (records in `eval/results/live/<runId>/records.json`, read by Tasks 5 and 6):

```ts
interface ArmResult {
  ok: boolean;
  error?: string;
  repaired: boolean; // a repair call was made in this arm
  findingsByRule?: FindingsByRule; // final design of this arm
  targeted: number;
  collateral: number;
  changesByKind: Partial<Record<ChangeKind, number>>;
  regressions: number;
  score?: ScenarioResult;
  costUsd: number; // extraction + draft + this arm's repair
}
interface InfoRepairRecord {
  scenarioId: string;
  model: ModelChoice;
  repeat: number;
  ok: boolean;
  error?: string; // false when extraction or the draft failed
  firstDraftFindingsByRule?: FindingsByRule;
  infoSent: number; // info findings in arm I's message
  sameRequest: boolean; // both arms sent an identical message (noise-floor job)
  differ: boolean; // the two arms' final designs differ (graphContentHash)
  armsDiff?: number; // structural changes between W's and I's final designs
  arms?: { W: ArmResult; I: ArmResult };
  costUsd: number;
  latencyMs: number;
  calls: { model: string; stopReason: string | null; outputTokens: number; costUsd: number }[];
}
```

- `runInfoRepairJob(llm: LlmClient, catalog: CatalogSnapshot, scenario: Scenario, model: ModelChoice, repeat: number, save: (name: 'draft' | 'W' | 'I', project: Project) => void): Promise<InfoRepairRecord>` — extraction and answers as in `live.ts`; `draftArchitecture`; per arm `messageFor`: `undefined` → the arm's design is the draft (`repaired: false`, zero changes); else `repairDraft` (W and I run concurrently). A `GenerationError` in one arm sets that arm `ok: false` with `score: scoreCandidate(s, null)`. `sameRequest` when both messages are defined and equal.
- CLI: `pnpm --filter @cloudarchitect/eval info-repair [--models haiku,gpt-luna,gemini-flash-lite] [--repeats 2] [--scenarios id,id] [--concurrency 4] --max-usd <n>`; saves `outputs/<model>-<scenario>-<repeat>.<draft|W|I>.project.json`; writes `records.json` and `summary.json` (`runId`, `maxUsd`, `spentUsd`, `cutShort`); console line per job: model, scenario, repeat, W/I pass, infoSent, cost, latency.

- [ ] **Step 1: Write the failing tests** with a scripted fake `LlmClient` (extraction answer, then draft, then repair answers):
  - `runInfoRepairJob repairs both arms from the same draft` — both repair requests contain the draft text as the assistant message; arm I's user message contains `Apply each info finding`, arm W's does not.
  - `runInfoRepairJob skips the W repair for an info-only draft` — 3 calls total (extraction, draft, I); `arms.W.repaired === false`, `arms.W.collateral === 0`.
  - `runInfoRepairJob marks identical requests as sameRequest` — a draft with a warning and no info.
  - `runInfoRepairJob records a failed arm without dropping the job` — arm I returns invalid JSON: `ok: true`, `arms.I.ok === false`, `arms.W.ok === true`.
  - `runInfoRepairJob records a failed draft as ok false without arms`.
- [ ] **Step 2: Run** `pnpm --filter @cloudarchitect/eval test info-repair-job` — expected FAIL.
- [ ] **Step 3: Implement** `info-repair-job.ts`, extract `live-common.ts` from `live.ts`, write the CLI.
- [ ] **Step 4: Run** `pnpm --filter @cloudarchitect/eval test && pnpm --filter @cloudarchitect/eval typecheck && pnpm --filter @cloudarchitect/eval eval` — expected PASS. `live.ts` is not run (it would make paid calls); its refactor is checked by typecheck and by review of the diff: same CLI options, same records and summary fields, same console lines.
- [ ] **Step 5: Commit** `feat(eval): paired info-repair job runner and CLI`.

### Task 5: Statistics and criteria

**Files:**

- Create: `eval/src/info-repair-stats.ts`
- Test: `eval/src/info-repair-stats.test.ts`

**Interfaces:**

- Consumes: `InfoRepairRecord` (Task 4).
- Produces:
  - `pairedBootstrap(diffs: number[], seed: number, resamples = 2000): { mean: number; lo: number; hi: number }` — 90% percentile interval of the mean.
  - `isClear(ci: { lo: number; hi: number }): boolean` — `lo > 0 || hi < 0`.
  - `jobMetrics(r: InfoRepairRecord, arm: Arm): { info: number; vr015: number; errorsWarnings: number; passed: 0 | 1; collateral: number; targeted: number; regressions: number; costUsd: number }` — `info` counts info findings in the arm's final design excluding VR-015; a failed job or failed arm counts `passed: 0` and contributes no diff numbers (it is left out of the paired diffs for changes and findings, and counted in `failed`).
  - `noiseFloor(records: InfoRepairRecord[], model: string): { value?: number; pooled: boolean; jobs: number }` — mean `armsDiff` over `sameRequest` jobs; pooled over all models when the model has fewer than 10; `value` undefined when none exist at all.
  - `summarizeModel(records, model, seed): ModelArmSummary` — per arm means for each metric, failed jobs and failed arms counts, paired bootstrap of I−W for info, errorsWarnings, passed, collateral, regressions, costUsd; `noiseFloor`.
  - `evaluateCriteria(s: ModelArmSummary, blind?: { W: number; I: number }): { id: 1 | 2 | 3 | 4 | 5 | 6; met: boolean | undefined; detail: string }[]` —
    1: `meanI.info <= (2/3) * meanW.info` and the info diff is clear;
    2: neither errorsWarnings nor passed is clearly worse for I;
    3: not (`collateral` diff `lo` > noise floor); with no noise floor, not clearly higher;
    4: regressions not clearly higher;
    5: `blind.I >= blind.W` (`met: undefined` when no blind data);
    6: always `met: true`, detail = extra cost per design in USD.
  - `recommend(criteria): boolean` — 1–5 all `true`.

- [ ] **Step 1: Write the failing tests:**
  - `pairedBootstrap is deterministic for a seed and brackets the mean`.
  - `isClear needs the interval to exclude zero`.
  - `summarizeModel counts failed jobs and failed arms`.
  - `noiseFloor pools across models below 10 same-request jobs`; `noiseFloor is undefined when no same-request jobs exist`.
  - `evaluateCriteria fails criterion 1 when info drops by less than a third`; `fails criterion 3 when collateral rises beyond the noise floor`; `recommend needs criteria 1-5`.
- [ ] **Step 2: Run** `pnpm --filter @cloudarchitect/eval test info-repair-stats` — expected FAIL.
- [ ] **Step 3: Implement** `info-repair-stats.ts` (bootstrap uses the seeded `rng` from `packets.ts`).
- [ ] **Step 4: Run** `pnpm --filter @cloudarchitect/eval test` — expected PASS.
- [ ] **Step 5: Commit** `feat(eval): statistics and decision criteria for the info-repair experiment`.

### Task 6: Blind review of arms, and the report script

**Files:**

- Modify: `eval/src/review.ts` (new `--arms <runId>` mode), `eval/src/packets.ts` (only the exports from Task 2, if not done)
- Create: `eval/src/info-repair-report.ts`; `eval/package.json` script `"info-repair-report": "tsx src/info-repair-report.ts"`
- Test: `eval/src/info-repair-report.test.ts` (pure `renderReport`), extend `eval/src/packets.test.ts`

**Interfaces:**

- Consumes: Tasks 2, 4, 5; `buildPackets`, `aggregate`.
- `review.ts --arms <runId> [--per-model 10] [--seed 1] --max-usd <n>`: loads that run's `W` and `I` designs as `DesignRun`s with model names `<model>~W` / `<model>~I`, keeps jobs chosen by `sampleReviewJobs(records, perModel, seed)`, passes `pairs` mapping `<model>~W` ↔ `<model>~I`, and writes to `eval/reviews/info-repair-<date>/`. Resume, cap and failure handling as today. Other modes unchanged.
- `renderReport(input: { records: InfoRepairRecord[]; summary: { cutShort: boolean; spentUsd: number }; blind?: Record<string, { blindScore: number }>; seed: number }): string` — Markdown: per model a table (arm W, arm I, I−W with 90% interval) for info (excl. VR-015), VR-015, errors+warnings, pass rate, targeted, collateral, regressions, cost per design; the noise floor (and whether pooled); a rule table per arm (`ruleHitTable`); the six criteria with met/not met; the recommendation per model, or "partial run: no recommendation" when `cutShort`.
- CLI: `pnpm --filter @cloudarchitect/eval info-repair-report <runId> [--review <dir>]` prints `renderReport` output.

- [ ] **Step 1: Write the failing tests:**
  - `buildPackets pairs the two arms of one job` (packets.test.ts) — runs named `haiku~W`/`haiku~I`, `pairs` map; one entry per job; the key maps A/B back to the arm names.
  - `renderReport prints the criteria and a recommendation per model`.
  - `report refuses a recommendation for a partial run`.
  - `renderReport shows "no blind data" for criterion 5 when no review is given`.
- [ ] **Step 2: Run** `pnpm --filter @cloudarchitect/eval test` — expected FAIL.
- [ ] **Step 3: Implement** the review mode, `renderReport` and the CLI.
- [ ] **Step 4: Run** `pnpm run ci` at the repo root — expected PASS (lint, typecheck, tests, build; no paid calls). Then `pnpm --filter @cloudarchitect/eval review --arms <a fixture run> --packets-only` on a small hand-made run directory under the scratchpad (copy of two jobs) — expected: packet count printed, no calls.
- [ ] **Step 5: Commit** `feat(eval): blind review of repair arms and the experiment report`; open the PR (owner merges). The PR body states that no paid run has happened yet.

### Task 7: Paid run and report (after the owner's yes)

**Files:**

- Create: `docs/product/info-repair-experiment.md`
- Modify: `docs/product/phase3-provider-benchmark.md` (one link line), `CHANGELOG.md` (`[Unreleased]` → Added: the experiment script and report)

- [ ] **Step 1: Ask the owner in chat** for one yes covering: smoke run (1 scenario × 3 models, `--repeats 1 --max-usd 0.10`), full run (`--max-usd 2.50`), review (`--per-model 10 --max-usd 7.00`); estimate ~$6.70. Stop here until the yes.
- [ ] **Step 2: Smoke run:** `pnpm --filter @cloudarchitect/eval info-repair --scenarios myblog --repeats 1 --max-usd 0.10` — expected: 3 jobs, all `ok`, three project files per job, cost under $0.10.
- [ ] **Step 3: Full run:** `pnpm --filter @cloudarchitect/eval info-repair --max-usd 2.50` — expected: 132 jobs, `cutShort: false`. If cut short or more than 5 jobs fail: stop and report to the owner.
- [ ] **Step 4: Review:** `pnpm --filter @cloudarchitect/eval review --arms <runId> --per-model 10 --seed 1 --max-usd 7.00` — expected: 10 packets, 30 calls, `complete: true`.
- [ ] **Step 5: Report:** `pnpm --filter @cloudarchitect/eval info-repair-report <runId> --review eval/reviews/info-repair-<date>` → write `docs/product/info-repair-experiment.md`: the question (with Gautam's public commitment quoted), method, the generated tables, the exact arm I message, caveats (one run per design, 10 reviewed pairs per model, the noise floor), the recommendation, and the commands to reproduce. Link it from the benchmark report; add the CHANGELOG line.
- [ ] **Step 6: Run** `pnpm run ci` — expected PASS. **Commit** `docs: info findings in the repair turn — results`; push; PR for the owner.
- [ ] **Step 7: Draft the dev.to reply** for Gautam's thread (owner's voice, headline numbers, link to the report) in chat for the owner to post.

### Task 8 (only if recommended and the owner agrees): change the app

Separate branch and PR: `generateArchitecture` sends the recommended info rules (per the report, per model if so) with the arm I message; generator tests updated; CHANGELOG `[Unreleased]` → Changed. Planned in detail only after the owner's decision.
