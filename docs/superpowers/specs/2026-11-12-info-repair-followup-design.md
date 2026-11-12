# Info findings in the repair turn: follow-up for GPT Luna (warnings first) — design

**Date:** 2026-11-12 · **Status:** approved by the product owner 2026-11-12 (bar, fail rule and $1.20 cap) · **Follows:** [the first experiment](2026-11-11-info-repair-experiment-design.md), [report](../../product/info-repair-experiment.md)

## Why

The first experiment adopted info findings in GPT Luna's repair turn (PR #50, unreleased). A reader (Gautam K, dev.to) asked whether Luna's single-AZ warning (VR-018), which went from 6 to 10 of 44 designs, came from the designs where info findings were sent. It did, and the records (`eval/results/live/2026-11-12T04-56-18-173Z`) show what happened:

- All 4 extra VR-018 cases are designs where info findings were sent, and all 4 already had VR-018 in the first draft. The info version did not introduce the problem; it left it unfixed.
- Of the 11 drafts with VR-018 and at least one info finding to send, arm W fixed VR-018 in 7 and arm I in 3. On drafts where both arms sent the identical request, they matched.
- Warnings across Luna's 44 final designs: 17 (W) → 22 (I). The report's errors + warnings criterion passed with an interval that just touches zero ([−0.02, 0.27]).
- The "regressions" measure counts findings absent from the draft, so a warning the repair fails to fix only shows in the warnings total. That's a measurement gap, named here and in the report update.

Hypothesis: with the info findings in the same list and the same sentence block, Luna spends the turn on them (mostly encryption, VR-008) and drops harder warning fixes such as a second AZ. Ordering the message, warnings first and info findings as explicitly lower priority, may keep the encryption gain without that cost.

## Goal

Decide, before the Luna change ships in a release, which repair message Luna uses: today's (W), the adopted info version (I), or a new prioritized version (P).

## Non-goals

- Haiku and Flash-Lite (they keep W; nothing in this question is about them).
- A new blind review. The I-vs-W panel already preferred Luna's info version 9 of 10; P only reorders the same content. Decided on deterministic metrics only (saves about $4). If P passes but changes the designs in a way the metrics don't capture, a review can be a separate decision.
- Changing rules or severities.

## Method

Same harness as the first experiment (`pnpm --filter @cloudarchitect/eval info-repair`), same 22 scenarios, Luna only, paired: one first draft per job, then two repairs from that draft.

- **Arm W:** today's message, errors and warnings (unchanged).
- **Arm P (new):** the same findings as arm I, with a new message:
  - the findings are split into two lists: errors and warnings first, then info findings under their own heading;
  - the instruction says: fix every error; fix each warning or keep it only if intentional and say why; **only then** apply each info finding if it fits the requirements and does not undo an error or warning fix; otherwise leave it and say why; do not change anything else.

P is compared with W (the baseline the bar was written against). The first run's W-vs-I numbers stay as the reference for I.

Repeats: 3 (66 jobs), to get more drafts where VR-018 and info findings meet (about 16 instead of 11).

Tooling: one new option on the existing runner, `--info-message prioritized`, which swaps arm I's message for P's. Default stays the current message, so the first experiment reproduces as before. The generator gets the prioritized message builder as an export, unused by the app until a decision. Unit tests: the prioritized message lists warnings before info, contains the "only then" sentence, and equals today's message when no info finding is sent.

New metric in the report, closing the measurement gap: **warnings left unfixed** per arm (warnings present in the draft and still present in the final design), next to regressions.

## The bar, written before the run

P replaces I for Luna if all of these hold (P vs W, paired, 90% bootstrap intervals as before):

1. Info findings per design drop by at least a third, clearly (interval excludes zero).
2. Errors + warnings per design are **not higher**: point estimate ≤ 0. (Stricter than the first experiment's "not clearly worse", because that's exactly where I was weak.)
3. On drafts with VR-018 and info to send, P fixes VR-018 at least as often as W.
4. Collateral changes within the noise floor; regressions not clearly up (as before).
5. Extra cost per design stated.

**If P fails** (owner confirmed 2026-11-12): Luna goes back to today's message (W) before the next release. The product spec ranks warnings above info, so trading unfixed availability warnings for fixed encryption info findings is the wrong trade, even at 4 of 44. The I result stays in the report as measured.

## Cost and approvals

Luna's 44 jobs cost about $0.57 in the first run, so 66 jobs ≈ $0.85. Run with `--max-usd 1.20`. The paid run waits for an explicit yes in chat; a cap hit or a re-run needs a new yes.

## Deliverables

1. This design, committed before the run.
2. The `--info-message prioritized` option, the prioritized message builder and the unfixed-warnings metric, with tests (one PR).
3. The run, a short "Follow-up: warnings first" section in `docs/product/info-repair-experiment.md`, and, if P passes, `gpt-luna` switched to P in the generator (or, if P fails, the `repairInfoRules` setting removed). Same PR or a second one, depending on the outcome.
4. A reply to Gautam with the result.
