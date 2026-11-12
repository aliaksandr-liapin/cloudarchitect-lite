# Info findings in the repair turn — experiment

**Date:** 2026-11-12 · **Design:** [spec](../superpowers/specs/2026-11-11-info-repair-experiment-design.md), [follow-up spec](../superpowers/specs/2026-11-12-info-repair-followup-design.md) · **Generation run:** `eval/results/live/2026-11-12T04-56-18-173Z` (local, git-ignored) · **Reviews and full report:** `eval/reviews/info-repair-2026-11-12/`

The generator runs one repair turn for the economical models: it sends the validator's findings back to the model and asks for a corrected design. Today it sends only errors and warnings. Info findings — no encryption at rest (VR-008), no monitoring (VR-007), Lambda to RDS without RDS Proxy (VR-005), components not linked to a requirement (VR-013), cost drivers without a requirement (VR-024) — are never shown to the model, so they stay in the final design.

The question: if the repair turn also gets the info findings, do they go away, and does the model start changing things nobody asked it to change?

## Result

**Not adopted for any model.** GPT Luna met the six criteria below and was adopted on main, but a reader asked where its extra single-AZ warnings came from: its repair turn left availability warnings unfixed when info findings were in the message. A pre-registered follow-up with a warnings-first message did not fix that ([Follow-up](#follow-up-warnings-left-unfixed-gpt-luna)), so the change was withdrawn before any release. No model sends info findings; Haiku and Flash-Lite were never changed.

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

## Limits

- **Small samples.** 44 designs per model and 10 reviewed pairs. One reviewed design moves a blind median by one step (1/14 of a point). Haiku's blind-score miss is that size, and its head-to-head preferences point the other way; criterion 5 was set to use the blind score, so the result stands as recorded.
- **Four Haiku jobs failed** (both `regulated-portal` scenarios, both repeats): the connection was cut off during the first draft, so neither arm ran. They are left out of the paired comparison and count as not passed in both arms.
- **The noise floor is lenient.** Criterion 3 compares the lower end of the collateral interval with the per-job noise floor, which is generous; for Luna the floor rests on 10 jobs.
- **What is counted as a change.** Configuration edits (encryption settings, the VR-008 fix itself) are not counted; a renamed element counts as removed plus added; an added node attached to another added node counts as collateral, which errs against arm I.
- **Reviewer retries.** In the first pass the Claude reviewer returned incomplete answers for 5 packets on near-identical design pairs (one design reviewed twice, the others skipped), and 3 calls lost their connection. One retry of those 8 calls succeeded, and every design has three reviewers. One Claude answer listed a design twice; the first entry was kept. Raw answers are in `review-*.raw.json`.
- **Reviewers are models**, as in the [0.3 benchmark](phase3-provider-benchmark.md).

## Cost

| Activity | Spent |
|---|---|
| Smoke run (1 scenario × 3 models) | $0.05 |
| Generation run (132 jobs) | $1.56 |
| Blind review, first pass | $4.28 |
| Blind review, retry of 8 calls | $0.99 |
| Follow-up run (66 Luna jobs, no review) | $0.37 |
| **Total** | **$7.25** |

The product owner approved the run and the retry; each command was capped with `--max-usd`.

## Reproduce

```sh
pnpm --filter @cloudarchitect/eval info-repair --repeats 2 --max-usd 2.50
pnpm --filter @cloudarchitect/eval review --arms <runId> --per-model 10 --seed 1 --max-usd 7.00
pnpm --filter @cloudarchitect/eval info-repair-report <runId> --review <absolute path to eval/reviews/info-repair-YYYY-MM-DD>
# Follow-up
pnpm --filter @cloudarchitect/eval info-repair --models gpt-luna --repeats 3 --info-message prioritized --max-usd 1.20
pnpm --filter @cloudarchitect/eval info-repair-followup <absolute path to eval/results/live/<runId>>
```

The full generated report is `eval/reviews/info-repair-2026-11-12/report.md`.
