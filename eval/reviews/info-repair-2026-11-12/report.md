# Info-repair experiment report

Spent: 1.5595 USD. Seed 1. Intervals are 90% paired bootstrap over jobs; * marks an interval that excludes zero.

## haiku

- Jobs: 44; failed jobs: 4; failed arms (W/I): 0/0; paired jobs: 40
- sameRequest jobs: 23; info-only jobs (W not repaired): 2; nothing-to-repair jobs: 9

Costs: none clearly above zero

| Metric                        | Arm W  | Arm I  | I−W (90% interval)       |
| ----------------------------- | ------ | ------ | ------------------------ |
| Info findings (excl. VR-015)  | 0.40   | 0.00   | -0.40 [-0.68, -0.17] *   |
| VR-015 info findings          | 0.45   | 0.45   | 0.00 [0.00, 0.00]        |
| Errors + warnings             | 0.33   | 0.38   | 0.05 [-0.10, 0.20]       |
| Pass rate                     | 0.86   | 0.86   | 0.00 [0.00, 0.00]        |
| Targeted changes              | 0.72   | 0.50   | -0.23 [-0.57, 0.10]      |
| Collateral changes            | 1.02   | 0.78   | -0.25 [-0.72, 0.23]      |
| Regressions                   | 0.15   | 0.10   | -0.05 [-0.17, 0.07]      |
| Cost per design (USD)         | 0.0067 | 0.0068 | 0.0001 [-0.0000, 0.0002] |
| Median latency per design (s) | 49.9   | 49.4   | —                        |

Breakdown by repair (means only, no intervals; jobs where both arms succeeded):

| Jobs                          | n   | Info W | Info I | Collateral W | Collateral I | Targeted W | Targeted I | Regressions W | Regressions I |
| ----------------------------- | --- | ------ | ------ | ------------ | ------------ | ---------- | ---------- | ------------- | ------------- |
| Both arms repaired            | 29  | 0.48   | 0.00   | 1.41         | 1.07         | 1.00       | 0.69       | 0.21          | 0.14          |
| Info-only (I repaired, W not) | 2   | 1.00   | 0.00   | 0.00         | 0.00         | 0.00       | 0.00       | 0.00          | 0.00          |

Noise floor (mean per-job |difference| between two identical repairs): 1.43; not pooled (this model alone); rests on 23 jobs.

Rule hits, final design, arm W:

| Rule   | Severity | haiku |
| ------ | -------- | ----- |
| VR-003 | warning  | 5/40  |
| VR-011 | warning  | 2/40  |
| VR-018 | warning  | 4/40  |
| VR-008 | info     | 8/40  |
| VR-015 | info     | 13/40 |

Rule hits, final design, arm I:

| Rule   | Severity | haiku |
| ------ | -------- | ----- |
| VR-003 | warning  | 5/40  |
| VR-011 | warning  | 2/40  |
| VR-018 | warning  | 6/40  |
| VR-015 | info     | 13/40 |

- Criterion 1: met. info I/W = 0.00 (need <= 0.67); diff -0.40 [-0.68, -0.17]
- Criterion 2: met. errors+warnings diff 0.05 [-0.10, 0.20]; passed diff 0.00 [0.00, 0.00]
- Criterion 3: met. collateral diff -0.25 [-0.72, 0.23] vs noise floor 1.43 from 23 jobs
  - collateral I−W lower bound vs noise floor (mean per-job |difference| between two identical repairs): -0.72 vs 1.43; noise floor not pooled, 23 jobs
- Criterion 4: met. regressions diff -0.05 [-0.17, 0.07]
- Criterion 5: not met. blind review: I 2.3571428571428568, W 2.4285714285714284
  - head-to-head preferences (supporting data; the criterion uses blind scores): I over W 8, W over I 2
- Criterion 6: met. extra cost per design: 0.0001 USD

Recommendation: keep arm W (criteria 1-5 not all met).

## gpt-luna

- Jobs: 44; failed jobs: 0; failed arms (W/I): 0/0; paired jobs: 44
- sameRequest jobs: 10; info-only jobs (W not repaired): 11; nothing-to-repair jobs: 1

Costs: none clearly above zero

| Metric                        | Arm W  | Arm I  | I−W (90% interval)        |
| ----------------------------- | ------ | ------ | ------------------------- |
| Info findings (excl. VR-015)  | 1.23   | 0.00   | -1.23 [-1.43, -1.02] *    |
| VR-015 info findings          | 0.23   | 0.23   | 0.00 [0.00, 0.00]         |
| Errors + warnings             | 0.39   | 0.50   | 0.11 [-0.02, 0.27]        |
| Pass rate                     | 0.82   | 0.82   | 0.00 [0.00, 0.00]         |
| Targeted changes              | 0.93   | 1.39   | 0.45 [0.00, 0.93]         |
| Collateral changes            | 2.41   | 2.30   | -0.11 [-1.66, 1.34]       |
| Regressions                   | 0.07   | 0.02   | -0.05 [-0.09, 0.00]       |
| Cost per design (USD)         | 0.0037 | 0.0040 | 0.0003 [0.0002, 0.0005] * |
| Median latency per design (s) | 57.0   | 58.1   | —                         |

Breakdown by repair (means only, no intervals; jobs where both arms succeeded):

| Jobs                          | n   | Info W | Info I | Collateral W | Collateral I | Targeted W | Targeted I | Regressions W | Regressions I |
| ----------------------------- | --- | ------ | ------ | ------------ | ------------ | ---------- | ---------- | ------------- | ------------- |
| Both arms repaired            | 32  | 1.22   | 0.00   | 3.31         | 3.16         | 1.28       | 1.91       | 0.09          | 0.03          |
| Info-only (I repaired, W not) | 11  | 1.36   | 0.00   | 0.00         | 0.00         | 0.00       | 0.00       | 0.00          | 0.00          |

Noise floor (mean per-job |difference| between two identical repairs): 4.70; not pooled (this model alone); rests on 10 jobs.

Rule hits, final design, arm W:

| Rule   | Severity | gpt-luna |
| ------ | -------- | -------- |
| VR-002 | warning  | 2/44     |
| VR-003 | warning  | 3/44     |
| VR-004 | warning  | 3/44     |
| VR-012 | warning  | 1/44     |
| VR-018 | warning  | 6/44     |
| VR-005 | info     | 3/44     |
| VR-008 | info     | 31/44    |
| VR-015 | info     | 9/44     |

Rule hits, final design, arm I:

| Rule   | Severity | gpt-luna |
| ------ | -------- | -------- |
| VR-002 | warning  | 1/44     |
| VR-003 | warning  | 3/44     |
| VR-004 | warning  | 2/44     |
| VR-011 | warning  | 1/44     |
| VR-012 | warning  | 2/44     |
| VR-018 | warning  | 10/44    |
| VR-015 | info     | 9/44     |

- Criterion 1: met. info I/W = 0.00 (need <= 0.67); diff -1.23 [-1.43, -1.02]
- Criterion 2: met. errors+warnings diff 0.11 [-0.02, 0.27]; passed diff 0.00 [0.00, 0.00]
- Criterion 3: met. collateral diff -0.11 [-1.66, 1.34] vs noise floor 4.70 from 10 jobs
  - collateral I−W lower bound vs noise floor (mean per-job |difference| between two identical repairs): -1.66 vs 4.70; noise floor not pooled, 10 jobs
- Criterion 4: met. regressions diff -0.05 [-0.09, 0.00]
- Criterion 5: met. blind review: I 2.4285714285714284, W 2.3571428571428568
  - head-to-head preferences (supporting data; the criterion uses blind scores): I over W 9, W over I 1
- Criterion 6: met. extra cost per design: 0.0003 USD

Recommendation: adopt arm I (criteria 1-5 met).

## gemini-flash-lite

- Jobs: 44; failed jobs: 0; failed arms (W/I): 0/0; paired jobs: 44
- sameRequest jobs: 39; info-only jobs (W not repaired): 0; nothing-to-repair jobs: 3

Costs: none clearly above zero

| Metric                        | Arm W  | Arm I  | I−W (90% interval)       |
| ----------------------------- | ------ | ------ | ------------------------ |
| Info findings (excl. VR-015)  | 0.07   | 0.00   | -0.07 [-0.20, 0.00]      |
| VR-015 info findings          | 0.07   | 0.07   | 0.00 [0.00, 0.00]        |
| Errors + warnings             | 0.75   | 0.66   | -0.09 [-0.18, 0.00]      |
| Pass rate                     | 0.50   | 0.52   | 0.02 [0.00, 0.07]        |
| Targeted changes              | 0.36   | 0.52   | 0.16 [-0.05, 0.39]       |
| Collateral changes            | 1.07   | 0.66   | -0.41 [-1.48, 0.23]      |
| Regressions                   | 0.00   | 0.02   | 0.02 [0.00, 0.07]        |
| Cost per design (USD)         | 0.0146 | 0.0148 | 0.0002 [-0.0001, 0.0004] |
| Median latency per design (s) | 11.2   | 11.1   | —                        |

Breakdown by repair (means only, no intervals; jobs where both arms succeeded):

| Jobs                          | n   | Info W | Info I | Collateral W | Collateral I | Targeted W | Targeted I | Regressions W | Regressions I |
| ----------------------------- | --- | ------ | ------ | ------------ | ------------ | ---------- | ---------- | ------------- | ------------- |
| Both arms repaired            | 41  | 0.07   | 0.00   | 1.15         | 0.71         | 0.39       | 0.56       | 0.00          | 0.02          |
| Info-only (I repaired, W not) | 0   | 0.00   | 0.00   | 0.00         | 0.00         | 0.00       | 0.00       | 0.00          | 0.00          |

Noise floor (mean per-job |difference| between two identical repairs): 0.90; not pooled (this model alone); rests on 39 jobs.

Rule hits, final design, arm W:

| Rule   | Severity | gemini-flash-lite |
| ------ | -------- | ----------------- |
| VR-003 | warning  | 13/44             |
| VR-004 | warning  | 1/44              |
| VR-018 | warning  | 14/44             |
| VR-023 | warning  | 3/44              |
| VR-008 | info     | 1/44              |
| VR-015 | info     | 3/44              |

Rule hits, final design, arm I:

| Rule   | Severity | gemini-flash-lite |
| ------ | -------- | ----------------- |
| VR-003 | warning  | 12/44             |
| VR-004 | warning  | 1/44              |
| VR-018 | warning  | 13/44             |
| VR-023 | warning  | 1/44              |
| VR-015 | info     | 3/44              |

- Criterion 1: not met. info I/W = 0.00 (need <= 0.67); diff -0.07 [-0.20, 0.00] is not clearly negative
- Criterion 2: met. errors+warnings diff -0.09 [-0.18, 0.00]; passed diff 0.02 [0.00, 0.07]
- Criterion 3: met. collateral diff -0.41 [-1.48, 0.23] vs noise floor 0.90 from 39 jobs
  - collateral I−W lower bound vs noise floor (mean per-job |difference| between two identical repairs): -1.48 vs 0.90; noise floor not pooled, 39 jobs
- Criterion 4: met. regressions diff 0.02 [0.00, 0.07]
- Criterion 5: met. blind review: I 1.9285714285714286, W 1.9285714285714286
  - head-to-head preferences (supporting data; the criterion uses blind scores): I over W 4, W over I 5
- Criterion 6: met. extra cost per design: 0.0002 USD

Recommendation: keep arm W (criteria 1-5 not all met).

## Caveats

- Configuration edits (for example encryption settings, the VR-008 fix) and label or position edits are not counted as changes.
- A renamed node or edge id counts as a removal plus an addition.
- Regressions are findings whose key (rule, severity, node ids, edge ids) is not present in the first draft.
- Each design comes from one run; there are no repeated repairs of the same draft.
- Targeted (ruling R7): a change touching a node or edge a sent finding names (or either end of a named edge), a requirement link it names, an added node linked to a named node or of a service a node-less finding asks for (VR-007: CloudWatch), or an edge change touching such an added node; everything else is collateral.
