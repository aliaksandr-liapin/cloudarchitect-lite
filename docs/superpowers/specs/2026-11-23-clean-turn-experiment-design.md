# Continued vs clean second repair turn for GPT Luna: design

**Date:** 2026-11-23 · **Status:** approved by the product owner 2026-11-23 (arms, bar, $1.50 cap); run done the same day ·
**Follows:** [effort-budget design](2026-11-20-effort-budget-experiment-design.md),
[report, follow-up 2](../../product/info-repair-experiment.md#follow-up-2-effort-budget-and-a-separate-turn-gpt-luna)

## Why

In the effort-budget run, arm S (VR-018 alone in its own turn, then everything else) fixed VR-018
more often than today's repair, but left VR-003 unfixed in 7 designs instead of 2. It failed the bar
by one finding in 110 designs. In all six designs involved, VR-003 was in the first draft and
survived S's second turn.

The dev.to reader who proposed S (Gautam K) then asked whether the second turn saw the first. It
did: `repairDraft` continues one conversation, so S's second turn carried the request, the first
draft, the VR-018 message and the fixed design. S changed two things at once: what each turn had
to do, and how much context the second turn carried. His suggestion (22 Nov): run the same turn
fresh, with only the design and the findings, "so effort is the only variable". The owner agreed
publicly: "same design, same message, one arm in the running conversation and one in a fresh turn.
Same drafts, so it pairs one to one. If I run it, the numbers go in this thread."

A note on the wording: in S, the VR-018 message is already the first repair turn, right after the
draft, so its context can't get much shorter. The turn whose context grew is S's second turn,
where VR-003 was lost. So the test keeps everything up to the second turn identical and changes
only the second turn's context.

The same split answers the candidate the report named next, **two turns split by severity**
(errors and warnings first, info findings after), in both versions.

## Goal

1. **Context (descriptive):** with the same design and the same findings to fix, does a fresh
   second turn leave fewer errors and warnings unfixed than a continued one?
2. **Decision:** does any two-turn repair replace today's single turn for Luna?

## Non-goals

- Haiku, Flash-Lite, and a blind review (deterministic metrics only, as in both follow-ups).
- Changing rules, severities or the repair wording.
- Shipping. If a candidate passes, switching Luna is its own PR with its own review.
- The dose arms of the last run (that question is answered).

## Method

`pnpm --filter @cloudarchitect/eval clean-turn`: GPT Luna only, the same 22 scenarios, 5 repeats
(110 jobs). Each job runs extraction and one first draft. Turn 1 runs once per branch and is shared;
only turn 2 differs between the continued and the fresh arm, so every pair starts turn 2 from the
same design with the same message.

| Arm    | Turn 1 (shared within the branch)                                                                  | Turn 2                                                                         |
| ------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **0**  | Today's message: errors and warnings.                                                              | none (today's repair, the baseline)                                            |
| **R**  | Arm 0's request again, as a separate call.                                                         | none (noise only, never a candidate)                                           |
| **KC** | Arm 0's turn (the same request, run once).                                                         | The five repairable info findings left on turn 1's result, **continued**       |
| **KF** | Arm 0's turn.                                                                                      | The same findings, **fresh**                                                   |
| **SC** | VR-018 drafts: VR-018 alone. Other drafts: one turn with errors, warnings and the five info rules. | VR-018 drafts: what the validator finds on turn 1 (arm I's set), **continued** |
| **SF** | The same turn 1.                                                                                   | The same findings, **fresh**                                                   |

- **Continued** is today's `repairDraft`: the whole conversation so far plus the new message.
- **Fresh** is three messages: the original request with the fixed requirements (the first user
  message), turn 1's design as the assistant's answer, and the new message. It drops the first draft
  and the turn-1 message, nothing else. The system prompt, model, effort and output format are the
  same.
- **No turn 2** when there is nothing to send. Then the continued and fresh arms are the same
  design, and the record says so. When turn 1 made no call (the draft had no errors or warnings),
  KC's and KF's turn 2 is the first repair, its two contexts are identical, and it runs once.
- **Messages:** `repairMessageFor` for every turn (plain wording). The K turn 2 list holds info
  findings only; S's turn 2 list is unchanged from the last run.
- **SC repeats last run's arm S** on new drafts, so it also shows how stable that result was.
- **R measures noise.** Because turn 1 is shared, no two arms here make separate identical calls,
  and the earlier runs took the collateral noise floor from exactly such pairs. R repeats arm 0's
  request as an independent call on every job where arm 0 made one; the noise floor for criterion 5
  is the mean collateral difference between arm 0 and R (about 87 jobs).

**Recorded per arm and job,** as in the last run: final errors + warnings, info findings, VR-018
fixed, left unfixed (first-draft errors and warnings still present), regressions, collateral
changes against the draft, turns, cost, latency, and the messages sent.

## The bar, written before the run

**Context verdict (decides nothing, prediction written first).** On VR-018 drafts where S took two
turns and both SC and SF succeeded, sum the first-draft errors and warnings left unfixed:

- **supported** (context matters) if SF leaves at least 3 fewer than SC;
- **not supported** if SF leaves as many as SC or more;
- **partly supported** otherwise.

The same sums for KC vs KF are reported next to it, without a verdict. No significance claim; the
subset is about 40 drafts.

**Decision.** Three candidates are compared with arm 0, each paired, with 90% bootstrap intervals,
on the same six criteria as the last run:

1. Info findings per design (every info finding except VR-015) drop by at least a third, clearly.
2. Errors + warnings per design are not higher: point estimate ≤ 0.
3. On VR-018 drafts, the candidate fixes VR-018 at least as often as arm 0 (a failed arm counts as
   not fixed).
4. Errors and warnings left unfixed per design are not higher: point estimate ≤ 0.
5. Collateral changes stay within the noise floor (from arm R), and regressions are not clearly up.
6. The extra cost per design is stated, with the share of designs that pay for a second turn.

The candidates are **KC**, **KF** and **SF**. SC is not one: it failed this bar on 20 Nov, and
running it again until it passes would make the bar worthless. It is the control for SF.

- **None passes:** nothing changes; Luna keeps errors and warnings only.
- **One passes:** it becomes the proposal for Luna, in its own PR.
- **More than one passes:** the one with fewer errors + warnings per design; on a tie, the cheaper.

Testing three candidates instead of one makes a lucky pass more likely. The bar is strict on
errors and warnings (point estimate, not interval), which limits that, and the report names it.

## Limits, named in advance

- **Fresh drops more than length.** It also drops the turn-1 message, so the model no longer sees
  what it was asked before. That's the point of the test, but it means "context" here is "history",
  not a number of tokens.
- **K's turn 1 is arm 0.** KC and KF can only lose on errors and warnings through turn 2. That
  makes criteria 2–4 a test of "does the info turn undo warning fixes", which is the risk for K.
- **Small subsets.** About 43 VR-018 drafts; about 84 jobs with info left after arm 0.
- **Fresh drafts.** Counts compare within this run only.

## Cost and approvals

The last run averaged about $0.0015 per call. This one makes about 7 calls per job (extraction,
draft, arm 0, its replica R, K turn 2 twice on most jobs, S turn 1, S turn 2 twice on VR-018
drafts), so 110 jobs ≈ $1.10–1.25, with continued turns a little longer than fresh ones. Run with
`--max-usd 1.50`. The paid run waits for an explicit yes in chat; a cap hit or a re-run needs a new yes.

## Deliverables

1. This design, committed before the run.
2. Tooling (one PR):
   - `repairDraftFresh` in the generator, beside `repairDraft`, marked experimental (the app does
     not use it);
   - `clean-turn` runner and `clean-turn-report` checker, reusing the effort-budget arm results,
     `toPairRecord`-style pairing and the six-criteria check, generalized to any candidate arm;
   - unit tests: fresh message layout, shared turn 1, skipped turn 2, the identical-context case,
     the replica R and its noise pairing,
     costs, the context verdict and the choice between passing candidates.
3. The run, and a "Follow-up 3: continued vs clean second turn" section in
   `docs/product/info-repair-experiment.md`, with cost and reproduce commands.
4. The reply in the dev.to thread, pass or fail, and the result folded into dev.to article 4
   (draft in the launch folder, planned for 1 Dec).

## Calls made without the owner

1. The test changes S's second turn, not the VR-018 turn (see the note under Why), and the reply
   says so.
2. The severity split's turn 2 sends info findings only; errors and warnings had their own turn.
3. Fresh keeps the original request and requirements: without them the model can't keep
   requirement links, and every design would fail on that instead.
4. Three candidates, with a tie-break fixed in advance.
5. 5 repeats (110 jobs), as before.
6. Arm R, an extra call per job (about $0.13), so criterion 5 has a real noise floor.

## Confirmation run (added 2026-11-23, after the first run, before the second)

**Why.** SF passed in run `2026-11-23T17-42-38-611Z` (errors + warnings per design 0.33 → 0.17).
But the control SC moved by about 0.13 against arm 0 between the 20 Nov and 23 Nov runs, nearly the
size of SF's lead. One run is not enough to change the app. The owner approved a confirmation run
the same day.

**Method.** `pnpm --filter @cloudarchitect/eval clean-turn --arms 0,SF --max-usd 1.00`: arms 0 and
SF only, GPT Luna, the same 22 scenarios, 5 repeats, new drafts. Arm R is skipped; criterion 5 uses
the noise floor of the first run (3.78 from 89 jobs, `PRIOR_NOISE` in `clean-turn-report.ts`).
About 4–5 calls per job, so about $0.65–0.75.

**Bar, fixed before the run.** SF is confirmed if it meets criteria 1–5 against arm 0, unchanged
from above. If confirmed, switching Luna's repair to SF is the next pull request, with its own review.
If not, nothing changes, and the report shows both runs side by side, with the first run's pass
recorded as not confirmed.
