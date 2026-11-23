# Info findings in the repair turn — experiment

**Date:** 2026-11-12 · **Design:** [spec](../superpowers/specs/2026-11-11-info-repair-experiment-design.md), [follow-up spec](../superpowers/specs/2026-11-12-info-repair-followup-design.md), [follow-up 2 spec](../superpowers/specs/2026-11-20-effort-budget-experiment-design.md), [follow-up 3 spec](../superpowers/specs/2026-11-23-clean-turn-experiment-design.md) · **Generation run:** `eval/results/live/2026-11-12T04-56-18-173Z` (local, git-ignored) · **Reviews and full report:** `eval/reviews/info-repair-2026-11-12/`

The generator runs one repair turn for the economical models: it sends the validator's findings back to the model and asks for a corrected design. Today it sends only errors and warnings. Info findings — no encryption at rest (VR-008), no monitoring (VR-007), Lambda to RDS without RDS Proxy (VR-005), components not linked to a requirement (VR-013), cost drivers without a requirement (VR-024) — are never shown to the model, so they stay in the final design.

The question: if the repair turn also gets the info findings, do they go away, and does the model start changing things nobody asked it to change?

## Result

**Not adopted for any model.** GPT Luna met the six criteria below and was adopted on main, but a reader asked where its extra single-AZ warnings came from: its repair turn left availability warnings unfixed when info findings were in the message. A pre-registered follow-up with a warnings-first message did not fix that ([Follow-up](#follow-up-warnings-left-unfixed-gpt-luna)), so the change was withdrawn before any release. No model sends info findings; Haiku and Flash-Lite were never changed. A second follow-up tried the reader's own fix, the single-AZ warning in a repair turn of its own ([Follow-up 2](#follow-up-2-effort-budget-and-a-separate-turn-gpt-luna)); it missed the bar by one finding in 110 designs, so nothing changed. A third follow-up separated the two things that turn had changed, the work per turn and the context it carried ([Follow-up 3](#follow-up-3-continued-vs-clean-second-turn-gpt-luna)): the same two turns with a **fresh** second turn passed every criterion and halved errors and warnings per design (0.33 → 0.17). A confirmation run on new drafts passed again (0.41 → 0.25). Switching Luna's repair to it is the next pull request.

| Model | Info findings per design (W → I) | Unrequested changes | New findings | Blind score (W → I) | Recommendation |
|---|---|---|---|---|---|
| GPT-6 Luna | 1.23 → 0.00 | no clear difference | no clear difference | 2.36 → 2.43 | send info findings, **withdrawn** after the follow-up |
| Claude Haiku 5.5 | 0.40 → 0.00 | no clear difference | no clear difference | 2.43 → 2.36 | keep today's repair turn |
| Gemini 3.5 Flash-Lite | 0.07 → 0.00 | no clear difference | no clear difference | 1.93 → 1.93 | keep today's repair turn |

- **Info findings disappear when the model is told about them.** GPT Luna left encryption at rest out of 31 of 44 final designs with today's repair turn, and out of none when the finding was sent.
- **No clear rise in unrequested changes or in new findings** for any model. The extra cost is under $0.001 per design.
- **Luna meets all six criteria** set before the run. **Haiku misses one:** its blind score is one step lower with info findings (2.36 vs 2.43), even though the reviewers preferred the info-repair design in 8 of 10 head-to-head pairs. The bar was fixed in advance, so the recommendation for Haiku is to keep today's behavior. **Flash-Lite** rarely produces info findings (2 of 44 drafts), so there is nothing to measure.

## Method

- **Models:** the three economical models, the ones with a repair turn: `haiku`, `gpt-luna`, `gemini-flash-lite`. 22 scenarios × 2 repeats = 44 jobs per model, 132 in all.
- **Two repairs from the same first draft.** Each job runs extraction and the first draft once. Two repair turns then start from that draft:
  - **Arm W** (today): errors and warnings, the production repair message.
  - **Arm I**: errors, warnings and the info findings VR-005, VR-007, VR-008, VR-013 and VR-024. VR-015 (component not in the verified catalog) is never sent: an unresolved component is often the right answer, and asking to fix it invites invented services. It is counted separately.
  - Because both arms repair the same draft, differences come from the repair turn, not from first-draft luck.
- **Arm I repair message**, exactly:

  > The deterministic validator reported these findings on your architecture:
  > {list}
  >
  > Return the complete corrected architecture. Fix every error. Fix each warning, or keep it only if it is intentional and say why in assumptions. Apply each info finding if it fits the requirements; otherwise leave it and say why in assumptions. Do not change anything else.

- **Unrequested changes.** Each repaired design is compared with its first draft by element id: nodes added or removed, a node's service changed, edges added, removed or rewired, nodes moved between containers, requirement links dropped. A change is *targeted* if it touches an element a sent finding names (or an element the finding asks for, such as CloudWatch for "no monitoring"); every other change is *collateral*. Configuration edits (such as turning on encryption), labels and positions are not counted.
- **New findings (regressions):** findings in the repaired design that were not in the first draft.
- **Noise floor.** When a draft has no info finding to send, both arms send the identical request. The difference between those two answers shows how much a repair varies by chance.
- **Statistics:** per job, all 44 jobs per model; paired bootstrap, 2000 resamples, 90% interval, seed 1. A difference is "clear" only when the interval excludes zero.
- **Blind review:** the 0.3 benchmark panel (one Claude, one OpenAI and one Gemini reviewer, seven rubric dimensions scored 0–3, design names hidden), comparing arm W with arm I of the same job. 10 pairs per model, 30 in all, drawn with seed 1 from jobs where the arms differ, preferring jobs whose draft had info findings. Ten packets of three pairs.

## Criteria (fixed before the run)

Send info findings to repair, per model, only if, compared with arm W:

1. info findings per final design drop clearly, by at least a third;
2. errors and warnings per design and the pass rate do not clearly get worse;
3. collateral changes are no higher than arm W's plus the noise floor;
4. new findings do not clearly rise;
5. the blind score is not lower;
6. the extra cost is stated.

| Criterion | Haiku | GPT Luna | Flash-Lite |
|---|---|---|---|
| 1. Info drops by a third | met (−0.40 [−0.68, −0.17]) | met (−1.23 [−1.43, −1.02]) | **not met** (−0.07 [−0.20, 0.00], too few findings) |
| 2. Errors, warnings, pass rate | met | met | met |
| 3. Collateral changes | met (−0.25 [−0.72, 0.23]) | met (−0.11 [−1.66, 1.34]) | met (−0.41 [−1.48, 0.23]) |
| 4. New findings | met | met | met |
| 5. Blind score not lower | **not met** (2.36 vs 2.43) | met (2.43 vs 2.36) | met (1.93 vs 1.93) |
| 6. Extra cost per design | $0.0001 | $0.0003 | $0.0002 |
| **Recommendation** | keep W | **adopt I** | keep W |

Intervals are I − W per design, 90%.

## Results per model

Means per design over 44 jobs (Haiku: 40, see Limits). * marks a clear difference.

| Metric | Haiku W | Haiku I | Luna W | Luna I | Flash-Lite W | Flash-Lite I |
|---|---|---|---|---|---|---|
| Info findings (excl. VR-015) | 0.40 | 0.00 * | 1.23 | 0.00 * | 0.07 | 0.00 |
| Errors + warnings | 0.33 | 0.38 | 0.39 | 0.50 | 0.75 | 0.66 |
| Pass rate | 86% | 86% | 82% | 82% | 50% | 52% |
| Targeted changes | 0.72 | 0.50 | 0.93 | 1.39 | 0.36 | 0.52 |
| Collateral changes | 1.02 | 0.78 | 2.41 | 2.30 | 1.07 | 0.66 |
| New findings | 0.15 | 0.10 | 0.07 | 0.02 | 0.00 | 0.02 |
| Cost per design (repair arms) | $0.0067 | $0.0068 | $0.0037 | $0.0040 * | $0.0146 | $0.0148 |
| Median latency per design | 50 s | 49 s | 57 s | 58 s | 11 s | 11 s |
| Noise floor (collateral) | 1.43 (23 jobs) | | 4.70 (10 jobs) | | 0.90 (39 jobs) | |
| Blind score (median, 0–3) | 2.43 | 2.36 | 2.36 | 2.43 | 1.93 | 1.93 |
| Head-to-head preferences | 2 | 8 | 1 | 9 | 5 | 4 |
| Major defects (10 designs) | 16 | 16 | 10 | 9 | 26 | 24 |

Info findings in the final designs, by rule:

| Rule | Haiku W → I | Luna W → I | Flash-Lite W → I |
|---|---|---|---|
| VR-008 Data store without encryption at rest | 8/40 → 0 | 31/44 → 0 | 1/44 → 0 |
| VR-005 Lambda to RDS/Aurora without RDS Proxy | — | 3/44 → 0 | — |
| VR-015 Component not in the verified catalog (not sent) | 13/40 → 13/40 | 9/44 → 9/44 | 3/44 → 3/44 |

One warning moved more than the others: Luna's VR-018 (load balancer in a single availability zone) went from 6 to 10 of 44 designs with info findings. The total of errors and warnings is not clearly higher (0.39 → 0.50, interval [−0.02, 0.27]), but it is the number to watch if Luna's repair turn changes.

## Follow-up: warnings left unfixed (GPT Luna)

**Question** (from a dev.to reader): Luna's VR-018 (load balancer in a single availability zone) rose from 6 to 10 of 44 designs with info findings. Did that happen in the designs where info findings were sent?

**In the first run, yes.** All 4 extra cases were designs where info findings were sent, and all 4 already had VR-018 in the first draft. Of the 11 drafts with VR-018 and at least one info finding to send, arm W fixed VR-018 in 7 and arm I in 3. The "new findings" measure missed this because it only counts findings absent from the draft; the follow-up adds **left unfixed** (first-draft errors and warnings still in the final design).

**Follow-up run** (`eval/results/live/2026-11-12T21-57-04-510Z`, local): Luna only, 22 scenarios × 3 repeats = 66 jobs, all paired. Arm W is today's message; arm P sends the same findings with errors and warnings first and the info findings in a second, lower-priority list, applied "only then". The bar was committed before the run ([follow-up spec](../superpowers/specs/2026-11-12-info-repair-followup-design.md)).

| Criterion (P vs W) | Result |
|---|---|
| 1. Info findings drop by a third, clearly | met: 1.44 → 0.03 per design, diff −1.41 [−1.61, −1.21] |
| 2. Errors + warnings not higher (mean ≤ 0) | **not met**: 0.23 → 0.27, diff 0.05 [−0.11, 0.18] |
| 3. VR-018 fixed at least as often as W | **not met**: of 16 drafts with VR-018 and info sent, W fixed 14, P fixed 6 |
| 4. Collateral within noise, regressions not clearly up | met: collateral diff 0.12 [−0.82, 1.27] vs noise floor 3.31; regressions −0.11 [−0.23, −0.02] |
| 5. Extra cost | +$0.0001 per design |

Encryption at rest was missing from 51 of 66 final designs with today's message and from 1 with P. VR-018 was in 5 of 66 with today's message and in 12 with P. First-draft errors and warnings left unfixed: 0.14 per design with today's message, 0.27 with P.

**Decision** (fixed before the run): P fails criteria 2 and 3, so GPT Luna returns to today's repair turn. Putting the warnings first did not help; with info findings in the same turn, Luna fixes encryption and drops the harder multi-AZ change. For a single repair turn, sending only errors and warnings is the better trade: the product ranks warnings above info findings.

## Follow-up 2: effort budget and a separate turn (GPT Luna)

**Questions** (from the same reader): does Luna drop the single-AZ fix (VR-018) more often as more info findings join the repair message? And does sending VR-018 **alone in its own repair turn** keep that fix while still clearing the info findings?

**Run** (`eval/results/live/2026-11-20T16-14-28-965Z`, local): Luna only, 22 scenarios × 5 repeats = 110 jobs, all 110 complete, no failed arm. Every arm repaired from the same first draft:

- **0:** today's message (errors and warnings).
- **1, 2:** the same plus 1 or 2 info findings, picked by a seeded shuffle per job (arm 2 always includes arm 1's pick).
- **S:** VR-018 alone first, then what the validator finds on that result (errors, warnings and the five info rules) in a second turn. Drafts without VR-018 get one turn with that set.

A dose of 4 info findings was planned and dropped before the run: no Luna draft with VR-018 in the earlier runs had 4 to send. The bar was committed before the run ([spec](../superpowers/specs/2026-11-20-effort-budget-experiment-design.md)).

**Dose (descriptive, prediction written first).** On the 24 drafts with VR-018 and at least 2 info findings to send, VR-018 was fixed in 15 with no info finding in the message, 11 with one and 7 with two. The prediction (the fix rate falls at each step, by at least 3 drafts overall) is **supported**. Across all 43 VR-018 drafts: 26, 23 and 14.

| 110 designs per arm | Arm 0 | Arm 1 | Arm 2 | Arm S |
|---|---|---|---|---|
| Errors + warnings per design | 0.34 | 0.39 | 0.48 | 0.35 |
| Info findings per design (VR-015 excluded) | 1.39 | 0.61 | 0.09 | 0.01 |
| Designs missing encryption at rest (VR-008) | 82 | 57 | 9 | 0 |
| Designs with VR-018 at the end | 17 | 20 | 29 | 12 |
| VR-018 fixed (of 43 drafts) | 26 | 23 | 14 | 31 |
| Errors and warnings left unfixed per design | 0.33 | 0.35 | 0.44 | 0.27 |
| Cost per design | $0.0037 | $0.0040 | $0.0039 | $0.0046 |

| Criterion (S vs arm 0) | Result |
|---|---|
| 1. Info findings drop by a third, clearly | met: 1.39 → 0.01, diff −1.38 [−1.53, −1.24] |
| 2. Errors + warnings not higher (mean ≤ 0) | **not met**: 0.34 → 0.35, diff 0.01 [−0.10, 0.12] |
| 3. VR-018 fixed at least as often | met: 31 vs 26 of 43 drafts (no failed arm) |
| 4. Errors and warnings left unfixed not higher | met: 0.33 → 0.27, diff −0.05 [−0.17, 0.06] |
| 5. Collateral within noise, regressions not clearly up | met: collateral −1.63 [−3.13, −0.29] vs noise floor 0.22 (pooled, 9 jobs); regressions 0.01 [−0.08, 0.09] |
| 6. Extra cost | +$0.0009 per design; S took a second turn in 43 of 110 jobs |

**Decision** (fixed before the run): S fails criterion 2, so Luna keeps errors and warnings only. The miss is one finding in 110 designs, but the bar said "not higher", and it is higher.

**Where the extra finding came from.** S ended with 5 fewer VR-018 (17 → 12) and 5 more VR-003, public API without stated authentication (2 → 7), plus one more missing dead-letter queue (VR-004, 7 → 8). S's 7 VR-003 findings sit in 6 designs; in all 6 the finding was already in the first draft and survived S's second turn, which carried the info findings. Arm 0 fixed it in all 6. The single-AZ fix was protected by its own turn, and the next warning in the queue took its place.

**What this says.** The dose result and the VR-003 trade point the same way: in one turn, Luna does a limited amount of work, and cheap info fixes (encryption is one setting) crowd out harder warning fixes. It is not specific to VR-018. Isolating one warning moves the problem to the next one. The candidate that follows is two turns split by severity, all errors and warnings first and info findings only after, which this run did not test.

## Follow-up 3: continued vs clean second turn (GPT Luna)

**Question** (from the same reader): in follow-up 2, arm S's second turn continued the whole conversation (request, first draft, VR-018 message, fixed design), so it changed two things at once: how much work each turn had and how much context the second turn carried. With the same design and the same findings, does a **fresh** second turn do better than a continued one? And does any two-turn repair beat today's single turn?

**Run** (`eval/results/live/2026-11-23T17-42-38-611Z`, local): Luna only, 22 scenarios × 5 repeats = 110 jobs, all 110 complete, no failed arm. Turn 1 runs once per branch and is shared; only turn 2's context differs. A fresh turn is three messages: the original request with the requirements, turn 1's design as the model's answer, and the new message.

- **0:** today's repair (errors and warnings). **R:** the same request again as an independent call, used only for the collateral noise floor.
- **KC / KF:** arm 0's turn, then the five repairable info findings left on its result, continued / fresh.
- **SC / SF:** VR-018 alone, then what the validator finds on that result (errors, warnings, five info rules), continued / fresh. Drafts without VR-018 get one turn with that set, so SC and SF differ only on VR-018 drafts.

The candidates were KC, KF and SF; SC (follow-up 2's arm S on new drafts) was the control. The bar and the tie-break were committed before the run ([spec](../superpowers/specs/2026-11-23-clean-turn-experiment-design.md)).

| 110 designs per arm | 0 | R | KC | KF | SC | SF |
|---|---|---|---|---|---|---|
| Errors + warnings per design | 0.33 | 0.30 | 0.35 | 0.33 | 0.21 | **0.17** |
| Info findings per design (VR-015 excluded) | 1.54 | 1.54 | 0.03 | 0.01 | 0.01 | 0.02 |
| Designs missing encryption at rest (VR-008) | 85 | 85 | 0 | 0 | 1 | 1 |
| Designs with VR-018 at the end | 17 | 15 | 17 | 17 | 10 | **5** |
| VR-018 fixed (of 44 drafts) | 28 | 30 | 28 | 28 | 34 | **39** |
| Designs with VR-003 at the end | 2 | 4 | 2 | 2 | 3 | 3 |
| Errors and warnings left unfixed per design | 0.31 | 0.23 | 0.33 | 0.31 | 0.20 | **0.16** |
| Cost per design | $0.0038 | $0.0037 | $0.0050 | $0.0050 | $0.0047 | $0.0047 |

**Context (descriptive, prediction written first).** On the 42 VR-018 drafts where S took two turns, the continued second turn left 14 first-draft errors and warnings unfixed and the fresh one 10. The prediction (fresh leaves at least 3 fewer) is **supported**. For the severity split (71 jobs with two turns) the counts were 30 and 28, with no verdict set in advance.

| Criterion (vs arm 0) | KC | KF | SF |
|---|---|---|---|
| 1. Info findings drop by a third, clearly | met (1.54 → 0.03) | met (→ 0.01) | met (→ 0.02) |
| 2. Errors + warnings not higher (mean ≤ 0) | **not met**: +0.02 [0.00, 0.05] | met: 0.00 | met: −0.15 [−0.25, −0.07] |
| 3. VR-018 fixed at least as often (28 of 44) | met: 28 | met: 28 | met: **39** |
| 4. Errors and warnings left unfixed not higher | **not met**: +0.02 | met: 0.00 | met: −0.15 [−0.24, −0.06] |
| 5. Collateral within noise, regressions not clearly up | met | met | met: collateral −0.66 [−1.79, 0.33] vs noise floor 3.78 (89 jobs); regressions −0.03 |
| 6. Extra cost | +$0.0012, two turns in 71 of 110 | +$0.0012, 71 of 110 | +$0.0010, two turns in 42 of 110 |

**Decision** (fixed before the run): KF and SF pass, KC fails. Of the two, SF has fewer errors and warnings per design (0.17 vs 0.33), so **SF becomes the proposal for Luna**: on a draft with VR-018, send VR-018 alone, then send the remaining errors, warnings and the five info rules in a fresh turn. Drafts without VR-018 get one turn with that set. Switching the app is its own pull request with its own review.

**What this says.**

- **The second turn's history cost fixes.** With identical work and an identical starting design, the fresh turn fixed more: SF ended with VR-018 in 5 designs against SC's 10, and left 4 fewer findings unfixed on the drafts where the two differed. Follow-up 2's "budget" was partly context.
- **The severity split adds info fixes without hurting warnings, and without helping them.** KF matched arm 0 on errors and warnings exactly and cleared encryption at rest from 85 designs to 0. KC lost a little (0.35), in the same direction as SC vs SF.
- **SC did better here than arm S did in follow-up 2** (errors + warnings 0.21 vs arm 0's 0.33, where S had 0.35 vs 0.34). Same arm, new drafts: its gap to arm 0 moved by about 0.13 between two runs of 110 jobs, nearly the size of SF's lead (−0.15). So a confirmation run was set up before changing anything (below). The fresh-vs-continued comparison is paired within this run and does not depend on that swing.

### Confirmation run

**Run** (`eval/results/live/2026-11-23T19-29-46-728Z`, local): arms 0 and SF only, new drafts, 110 jobs, all complete, no failed arm. The bar (criteria 1–5 unchanged, the noise floor taken from the first run because arm R was skipped) was committed before the run ([spec, "Confirmation run"](../superpowers/specs/2026-11-23-clean-turn-experiment-design.md#confirmation-run-added-2026-11-23-after-the-first-run-before-the-second)).

| 110 designs per arm | First run: 0 | First run: SF | Confirmation: 0 | Confirmation: SF |
|---|---|---|---|---|
| Errors + warnings per design | 0.33 | 0.17 | 0.41 | **0.25** |
| Errors and warnings left unfixed per design | 0.31 | 0.16 | 0.47 | **0.25** |
| VR-018 fixed (of VR-018 drafts) | 28 of 44 | 39 of 44 | 17 of 42 | **38 of 42** |
| Designs missing encryption at rest (VR-008) | 85 | 1 | 93 | **1** |
| Cost per design | $0.0038 | $0.0047 | $0.0038 | $0.0046 |

**Confirmed.** SF meets criteria 1–5 again: errors + warnings diff −0.16 [−0.28, −0.05], VR-018 fixed 38 vs 17 of 42, left unfixed −0.23 [−0.41, −0.05], collateral −1.53 [−3.47, 0.23] against the 3.78 floor, regressions −0.05. Extra cost $0.0008 per design; 40 of 110 jobs took a second turn.

Arm 0 moved more between the two runs than SF did (VR-018 fixed 28 of 44, then 17 of 42), and SF fixed VR-018 in 39 of 44 and 38 of 42. With a fresh second turn, the single-AZ fix stops depending on what else is in the queue.

## Limits

- **Small samples.** 44 designs per model and 10 reviewed pairs. One reviewed design moves a blind median by one step (1/14 of a point). Haiku's blind-score miss is that size, and its head-to-head preferences point the other way; criterion 5 was set to use the blind score, so the result stands as recorded.
- **Four Haiku jobs failed** (both `regulated-portal` scenarios, both repeats): the connection was cut off during the first draft, so neither arm ran. They are left out of the paired comparison and count as not passed in both arms.
- **The noise floor is lenient.** Criterion 3 compares the lower end of the collateral interval with the per-job noise floor, which is generous; for Luna the floor rests on 10 jobs.
- **What is counted as a change.** Configuration edits (encryption settings, the VR-008 fix itself) are not counted; a renamed element counts as removed plus added; an added node attached to another added node counts as collateral, which errs against arm I.
- **Reviewer retries.** In the first pass the Claude reviewer returned incomplete answers for 5 packets on near-identical design pairs (one design reviewed twice, the others skipped), and 3 calls lost their connection. One retry of those 8 calls succeeded, and every design has three reviewers. One Claude answer listed a design twice; the first entry was kept. Raw answers are in `review-*.raw.json`.
- **Run-to-run swings in follow-ups 2 and 3.** The same arms moved between runs by more than the one-finding margin that decided follow-up 2, which is why SF got a confirmation run. The collateral noise floor from arm R (3.78) is wide, so criterion 5 is lenient.
- **Reviewers are models**, as in the [0.3 benchmark](phase3-provider-benchmark.md).

## Cost

| Activity | Spent |
|---|---|
| Smoke run (1 scenario × 3 models) | $0.05 |
| Generation run (132 jobs) | $1.56 |
| Blind review, first pass | $4.28 |
| Blind review, retry of 8 calls | $0.99 |
| Follow-up run (66 Luna jobs, no review) | $0.37 |
| Follow-up 2 run (110 Luna jobs, four arms, no review) | $1.01 |
| Follow-up 3 run (110 Luna jobs, six arms, no review) | $1.14 |
| Follow-up 3 confirmation (110 Luna jobs, arms 0 and SF) | $0.67 |
| **Total** | **$10.07** |

The product owner approved the run and the retry; each command was capped with `--max-usd`.

## Reproduce

```sh
pnpm --filter @cloudarchitect/eval info-repair --repeats 2 --max-usd 2.50
pnpm --filter @cloudarchitect/eval review --arms <runId> --per-model 10 --seed 1 --max-usd 7.00
pnpm --filter @cloudarchitect/eval info-repair-report <runId> --review <absolute path to eval/reviews/info-repair-YYYY-MM-DD>
# Follow-up
pnpm --filter @cloudarchitect/eval info-repair --models gpt-luna --repeats 3 --info-message prioritized --max-usd 1.20
pnpm --filter @cloudarchitect/eval info-repair-followup <absolute path to eval/results/live/<runId>>
# Follow-up 2
pnpm --filter @cloudarchitect/eval effort-budget --max-usd 1.50
pnpm --filter @cloudarchitect/eval effort-budget-report <absolute path to eval/results/live/<runId>>
# Follow-up 3
pnpm --filter @cloudarchitect/eval clean-turn --max-usd 1.50
pnpm --filter @cloudarchitect/eval clean-turn --arms 0,SF --max-usd 1.00
pnpm --filter @cloudarchitect/eval clean-turn-report <absolute path to eval/results/live/<runId>>
```

The full generated report is `eval/reviews/info-repair-2026-11-12/report.md`.
