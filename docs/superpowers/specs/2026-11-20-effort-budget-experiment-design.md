# Effort budget and a separate repair turn for GPT Luna: design

**Date:** 2026-11-20 · **Status:** approved by the product owner 2026-11-20 (arms, bar, $1.50 cap) ·
**Follows:** [first experiment](2026-11-11-info-repair-experiment-design.md),
[warnings-first follow-up](2026-11-12-info-repair-followup-design.md),
[report](../../product/info-repair-experiment.md)

## Why

The warnings-first follow-up showed that with info findings in the same repair turn, GPT Luna fixes
encryption at rest (VR-008) and drops the harder multi-AZ change (VR-018): of 16 drafts with VR-018
and info findings to send, today's message fixed VR-018 in 14 and the warnings-first message in 6.
Luna's repair turn went back to errors and warnings only (PR #51).

The same dev.to reader (Gautam K) proposed two things, and the owner committed publicly (15 Nov) to
run them and report the result, pass or fail:

1. **Effort budget, not count:** vary how many info findings go in the repair message and watch
   whether the VR-018 fix is dropped as the list grows.
2. **A separate turn:** send VR-018 alone in its own repair turn, so the structural change never
   competes with cheap edits; only drafts with VR-018 pay for the extra turn.

The second is the one that could ship: if it keeps VR-018 fixes and still clears encryption, Luna
gets the encryption gain without the availability cost.

## What the existing data says (checked 2026-11-20)

- **The old drafts can't be reused.** Runs save each draft's parsed project only. A repair continues
  the model conversation (`repairDraft` needs the draft's messages and raw text, and the extraction
  input), which wasn't saved. "Same drafts" therefore means what it meant before: every arm repairs
  from one fresh draft per job.
- **Four info findings never happen on Luna drafts with VR-018.** Across the 110 Luna drafts of
  11–12 Nov, the 43 with VR-018 had 0–2 of the five repairable info findings to send (one had 3).
  Reaching 4 would mean inventing findings, which measures something else. The dose arms are 0, 1
  and 2; the public reply says why 4 was dropped.

## Goal

Decide whether Luna's repair becomes "VR-018 alone first, then everything else including info
findings" (arm S), and describe how the VR-018 fix rate responds to 0, 1 and 2 info findings.

## Non-goals

- Haiku and Flash-Lite.
- A blind review (deterministic metrics only, as in the follow-up). If S passes but changes designs
  in ways the metrics miss, a review is a separate decision.
- Changing rules or severities.
- Shipping S in the app. If S passes, switching Luna is its own PR with its own review.
- A "two plain turns" control. See Limits.

## Method

`pnpm --filter @cloudarchitect/eval effort-budget`: GPT Luna only, the same 22 scenarios, 5 repeats
(110 jobs). Each job runs extraction and one first draft, then every arm repairs from that draft. The
arms run concurrently.

| Arm   | Repair                                                                                                                                                                                                                                                                                                        |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0** | Today's message: errors and warnings only (arm W of the earlier runs).                                                                                                                                                                                                                                        |
| **1** | Errors and warnings plus 1 of the draft's repairable info findings.                                                                                                                                                                                                                                           |
| **2** | Errors and warnings plus 2 of them.                                                                                                                                                                                                                                                                           |
| **S** | If the draft has VR-018: turn 1 sends the VR-018 findings alone. Turn 2 sends what the validator finds on turn 1's result: errors, warnings and the five repairable info rules (arm I's set, plain message); skipped if there is nothing to send. Drafts without VR-018 get a single turn with that same set. |

- **Repairable info findings** are the five rules of the earlier runs (`INFO_RULES_TO_REPAIR`:
  VR-005, VR-007, VR-008, VR-013, VR-024).
- **Which ones arms 1 and 2 send:** a seeded shuffle per job (seed from scenario and repeat, the same
  for both arms), with arm 1 taking the first and arm 2 the first two. So arm 2 is always a superset
  of arm 1, and the choice doesn't depend on the rule type. A draft with fewer eligible findings sends
  what it has, making the same request as a lower arm; the record notes that.
- **Messages:** `repairMessageFor` for every turn (the plain wording). Only the list changes between
  arms.

**Per arm and job, recorded:** VR-018 present in the draft and in the final design, info findings
sent, errors + warnings in the final design, info findings in the final design, left unfixed
(first-draft errors and warnings still present), regressions, collateral changes against the draft,
turns, cost and latency.

**Subsets used by the analysis:**

- **VR-018 drafts:** the draft has VR-018 (about 43 expected).
- **Dose subset:** VR-018 drafts with at least 2 eligible info findings (about 18 expected).

## The bar, written before the run

**S replaces today's repair for Luna if all of these hold.** The comparison is S vs arm 0, paired,
with 90% bootstrap intervals as before.

1. Repairable info findings per design drop by at least a third, clearly (the interval excludes
   zero).
2. Errors + warnings per design are not higher: point estimate ≤ 0.
3. On VR-018 drafts, S fixes VR-018 at least as often as arm 0.
4. Warnings left unfixed per design are not higher: point estimate ≤ 0.
5. Collateral changes stay within the noise floor, and regressions are not clearly up (as before).
6. The extra cost per design is stated, with the share of designs that pay for a second turn.

**If S fails,** nothing changes: Luna keeps errors and warnings only. The result goes in the report
and the reply as measured.

**The dose arms decide nothing.** The prediction is written down first: if the effort-budget idea
holds, the VR-018 fix rate on the dose subset falls at each step (arm 0 ≥ arm 1 ≥ arm 2), with arm 0
above arm 2 by at least 3 drafts. The result is reported as supported, partly supported or not
supported, with counts, and no significance claim; the subset is small.

## Limits, named in advance

- **S gets two turns on VR-018 drafts.** If S wins, part of the gain may come from the extra turn
  rather than from isolating VR-018. A "two plain turns" arm would separate the two. It was left out
  to keep the run near $1, and the report says so.
- **Small subsets.** The dose subset is about 18 drafts.
- **Fresh drafts.** These are new drafts, so their counts are not comparable one-to-one with the
  11–12 Nov runs, only within this run.

## Cost and approvals

Two arms cost about $0.0055 per Luna job. Four arms plus S's second turn on about 40% of drafts come
to about $0.0085 per job, so 110 jobs ≈ $0.95. Run with `--max-usd 1.50`. The paid run waits for an
explicit yes in chat; a cap hit or a re-run needs a new yes.

## Deliverables

1. This design, committed before the run.
2. Tooling (one PR):
   - `effort-budget` runner and `effort-budget-report` checker;
   - a new job module reusing `armFindings`, `diffDesigns`, `leftUnfixed`, `regressions`,
     `noiseFloor` logic and `repairMessageFor`;
   - unit tests for arm selection (nesting, seeding, fewer-than-k drafts), S's turn logic (VR-018
     first, turn 2 recomputed, single turn without VR-018) and the bar check.

   The existing `info-repair` commands stay unchanged, so earlier runs still reproduce.

3. The run, and a "Follow-up 2: effort budget and a separate turn" section in
   `docs/product/info-repair-experiment.md`, including the cost table and the reproduce commands.
4. A reply to Gautam in the dev.to thread with the result, and a candidate for dev.to article 4
   (30 Nov).

## Left to the builder

- Whether the new job module generalizes `info-repair-job.ts`'s two arms or stands beside it (a
  generalization must keep old records readable).
- The seeded shuffle's exact seed function (`rng` and `shuffle` from `packets.ts` exist).
- The report's layout, following `info-repair-followup.ts`.

## Calls made without the owner

1. Dose 4 is dropped because Luna drafts don't have 4 findings to send; it's replaced by an honest
   note in the reply.
2. Turn 2 of S uses arm I's plain message with the findings recomputed after turn 1, the way the
   app's repair loop works.
3. 5 repeats (110 jobs) instead of 3, to get roughly 40 VR-018 drafts.
4. No "two plain turns" control; named as a limit.
5. Separate `effort-budget` commands instead of more flags on `info-repair`.
