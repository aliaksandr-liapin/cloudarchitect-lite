# Info findings in the repair turn: experiment — design

**Date:** 2026-11-11 · **Status:** draft for the product owner's review

## Why

The generator sends validator findings back to the model for one repair turn, but only errors and warnings (`packages/generator/src/generate.ts`, `severity !== 'info'`). Info findings (VR-005, VR-007, VR-008, VR-013, VR-015, VR-024) are never shown to the model, so a model that skips encryption at rest (VR-008: GPT Luna in 32 of 44 designs in the 0.3 benchmark) keeps that gap in its final design.

A dev.to reader (Gautam K, on "How I stop an LLM from inventing cloud services") asked two questions: would sending info findings into the repair turn clean those designs up, and would it make the model change things nobody asked it to change? The owner promised him numbers in that thread in the second half of November, and publicly described the measurement (quoted below).

## Goals

1. Measure, for the three economical models (`haiku`, `gpt-luna`, `gemini-flash-lite`, the ones with `repairTurns: 1`), what changes when the repair turn also receives info findings:
   - info findings per final design (overall and per rule),
   - error and warning findings per final design, and the pass rate,
   - **collateral changes** per repaired design (changes to elements no finding pointed at),
   - **regressions**: findings in the repaired design that were not in the first draft,
   - blind-review quality, from the existing three-provider reviewer panel,
   - cost and latency per design.
2. A short written report with a recommendation: change the app's repair turn or not.
3. A reply for Gautam's dev.to thread with the headline numbers.

## Non-goals

- The best-quality models (`sonnet`, `gpt-sol`, `gemini-argon`); they have `repairTurns: 0`, so nothing is repaired.
- More than one repair turn, or new rules or severities.
- Changing the app. If the report recommends it, that's a separate pull request after the owner agrees (owner: "the changes could be applied if you recommend").

## Anti-goals (a failure even if it technically works)

- An experiment switch that changes app behavior, or that the app can reach. The app's generator stays exactly as it is until a separate decision.
- Numbers that come from first-draft luck instead of the repair turn (see Method: both arms repair the same draft).
- A headline that hides a cost: if info findings drop but collateral changes or regressions rise, the report says so first. This is the commitment from the public reply:

  > If adding info findings raises collateral changes or regressions, that answers the question even if the info count drops.

- Spending without the owner's OK: the paid run waits for an explicit yes in chat.

## Method

### Paired arms from one first draft _(Claude's call; owner chose "do your recommendation")_

Each job (scenario × model × repeat) runs extraction and the first draft once, exactly as the live eval does today. From that first draft, two repair turns run on the same conversation:

- **Arm W (today):** errors and warnings, the production repair message.
- **Arm I (with info):** errors, warnings and info findings.

Both arms start from the identical draft, so differences come from the repair turn. Cases:

| First draft has          | Arm W               | Arm I                                     |
| ------------------------ | ------------------- | ----------------------------------------- |
| errors/warnings and info | repair call         | repair call                               |
| info only                | no repair (= draft) | repair call                               |
| errors/warnings, no info | repair call         | repair call (the same request; see below) |
| nothing                  | no repair           | no repair                                 |

("Info" in this table means the five rules sent to repair, so a draft whose only info finding is VR-015 is in the "no info" rows.)

In the "no info" row both arms send the same request. Run it twice anyway: the difference between the two answers measures how much a repair varies by chance. That's the noise floor for the collateral-change comparison, and costs about one repair call per such design. _(Claude's call.)_

### Which info rules go to repair _(Claude's call)_

VR-005, VR-007, VR-008, VR-013 and VR-024 go to arm I's repair message. **VR-015 (unresolved node) does not**: an unresolved node is often the right answer (scenarios with `expectedUnresolved` fail without it), and asking the model to "fix" it invites invented services. VR-015 is still counted and reported per arm, separately, and is left out of criterion 1's info count.

### Repair message for info findings _(Claude's call)_

The same list format as today (rule id, severity, explanation, fix, node and edge ids). The instruction gains one sentence for info: apply an info finding if it fits the requirements, otherwise leave it and say why in assumptions; the existing "Do not change anything else" stays. The exact message is recorded in the report.

### Where the switch lives

The generator gets an option to include info findings in the repair turn and to run a second repair from the first draft, or exposes the pieces the eval needs to do that itself. Either way the app's call path and default behavior are unchanged, and tests prove it. _(Builder's call how.)_

### Scale

22 scenarios × 3 models × 2 repeats = 132 jobs, matching the 0.3 benchmark (44 designs per model).

### Saving designs

Per job: the first draft, the arm W design and the arm I design (`eval/results/live/<runId>/outputs/`, git-ignored as today), plus first-draft findings and findings for each arm in `records.json`. The model's text is never printed to the console.

### Structural diff: targeted vs collateral

Diff each repaired design against its first draft by element id:

- nodes added or removed
- a node's service changed
- edges added, removed or rewired (source or target changed)
- nodes moved between containers
- requirement links dropped (from a node or edge)

Layout positions and label or description text are not counted as changes; label changes may be reported separately. _(Claude's call.)_

A change is **targeted** if it touches a node or edge id that a finding sent in that arm's repair message named (`nodeIds`, `edgeIds`; an edge change also counts as targeted when either end node was named). Everything else is **collateral**. Arm I sends more findings, so more of its changes can be targeted; that's the question being asked.

**Regression:** a finding (rule id + element ids) in the repaired design that was not in the first draft.

### Unit of comparison _(Claude's call)_

The headline numbers are **per job** (all 44 designs per model, the arm's final design, unrepaired drafts counting as zero changes), so both arms are compared over the same set. The report also breaks them down into: jobs both arms repaired, and info-only jobs (repaired only in arm I).

### Noise floor and "clearly" _(Claude's call)_

The noise floor (the two repairs of an identical "no info" request) is pooled across the three models when a model has fewer than 10 such jobs; the report says when it was pooled. A difference between arms counts only if a paired bootstrap 90% interval over jobs excludes zero; otherwise the report calls it "no clear difference". Criteria 2 and 4 fail only on a clear worsening, not on one extra failed run.

### Blind review

The existing panel (`eval/src/review.ts`, `packets.ts`: one Claude, one OpenAI and one Gemini reviewer, anonymous A/B designs, seven dimensions scored 0–3) compares arm W against arm I of the same job. Today's packets pair different models; the builder adds a pairing mode for two arms of the same model. Only jobs where the two arms differ are eligible. The 0.3 panel cost about $0.17 per pair (51 pairs, about $8.50 with retries), so the review covers a sample, not every job: **10 pairs per model, 30 in all** (owner's choice), drawn at random with a fixed seed from the eligible jobs, preferring jobs whose first draft had info findings. Packets of three pairs, three reviewers each, as in 0.3. The A/B order is randomized as today.

### Cost and cap

- Generation: about $1.70 (one 0.3-sized round, about $1.13, plus one extra repair call per design).
- Blind review: about $5 (30 pairs at about $0.17, the 0.3 rate including retries).
- Total about $6.70. Each paid command uses `--max-usd` (generation cap $2.50, review cap $7.00) and stops at the cap.
- A one-scenario smoke run per model (a few cents) before the full run. The owner says yes in chat once to cover smoke run, full run and review together, with the estimate shown. _(Claude's call: one approval for the whole sequence; a cap hit or a re-run needs a new yes.)_

## When to recommend changing the app _(Claude's call, stated up front so the result can't move the bar)_

Recommend sending info findings to repair, per model or for all three, only if, compared with arm W:

1. info findings per final design drop clearly (at least by a third),
2. errors and warnings per final design and the pass rate do not get worse,
3. collateral changes per repaired design are no higher than arm W's plus the noise floor,
4. regressions per design do not rise,
5. the blind score is not lower (ties are fine),
6. the extra cost per design is stated, so the owner can weigh it.

With one run per design and 44 designs per model, small differences are noise; the report says which differences are within the noise floor and doesn't claim them.

## Deliverables

1. Eval code and tests (no paid calls in tests; `pnpm run ci` stays offline and about as fast as now).
2. The paid run, after the owner's yes.
3. Report: `docs/product/info-repair-experiment.md` (tables per model, the six criteria, the recommendation, caveats, the commands to reproduce it), linked from `docs/product/phase3-provider-benchmark.md`.
4. Reply text for Gautam's thread, in the owner's voice, for the owner to post.
5. If recommended and the owner agrees: a separate PR changing the app's repair turn, with a CHANGELOG entry.

## Constraints

- Real keys come from the repo-root `.env` through the existing live-eval loader; never print or read them otherwise.
- Public repo content in English; no personal-brand wording in the report.
- Commits and PR as usual (branch, PR, owner merges).

## Left to the builder

- How the generator exposes the switch (option vs. exported steps), as long as the app path is unchanged.
- Whether the experiment is a flag on `live.ts` or its own script; the diff and report code layout.
- The diff's handling of renamed ids (count as remove + add, and say so in the report).
- The exact table layout of the report.
