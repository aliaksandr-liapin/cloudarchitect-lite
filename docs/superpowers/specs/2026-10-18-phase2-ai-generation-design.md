# Phase 2 — AI generation (design)

**Date:** 2026-10-18 · **Status:** ready for product-owner approval · **Roadmap:** Phase 2 "AI PoC", exit = Gate A · **Aligned with:** PRD v0.2 (FR-020, FR-025, FR-026, NFR-009, NFR-013), technical-architecture §5–6, ADR-0011

Markers: **[PO]** = decided by the product owner in the 2026-10-18 conversation. **[builder call]** = chosen by Claude while writing this, open to change.

## 1. Intent

Phase 0 proved that a model can turn a description into a valid, reviewable AWS graph (eval/src/spike.ts, docs/product/phase0-spike.md). Phase 2 turns that spike into the product feature. A user types what they want, answers at most one round of short questions, can steer the result with a few design-priority toggles, and gets an editable, validated diagram. Their previous diagram is never silently lost.

What makes it worth using: the first diagram is a **sensible general solution** (signups → Cognito, welcome email → SES), the questions target exactly the parts best practice says are usually underspecified, and every node shows **why** it exists (a requirement, or a toggle the user enabled).

## 2. Goals

1. **Generate from a description [PO].** The service extracts requirements and produces a general, best-practice solution for what was asked.
2. **Clarify gaps [PO].** When a request is incomplete or very broad by best-practice standards, the service asks before drawing. Example: "a blog with user signups and a welcome email" → "Sign-up options: email only, or also social sign-in (Google / Apple / Facebook)?" One round at most, inside the same credit (FR-025).
3. **Design-priority toggles [PO: add toggles; Claude recommended the set, PO did not object].** Chips under the prompt box, all off by default (off = sensible defaults):
   - **Serverless-first:** prefer Lambda, API Gateway, DynamoDB, Fargate, Step Functions over EC2/RDS.
   - **Backups:** every data store has backup (AWS Backup, PITR, S3 versioning).
   - **Disaster recovery:** a level choice, Multi-AZ or cross-region.
   - **High availability:** multi-AZ placement, no single point of failure.
   - **Cost-optimized:** cheapest reasonable option, scale to zero where possible.
   - **Security hardening:** WAF on public entry points, KMS encryption, private subnets, least-privilege auth on edges.

   Toggles change the generated result. Each enabled toggle enters the pipeline as an explicit requirement (`status: confirmed`, `provenance: 'toggle'`), so nodes it causes trace back to it ("added because: Backups"), and the validator checks that the result honours it (§6).
4. **Automatic versions instead of a dialog [PO chose this over "ask to save" and "confirm override"].**
   - When a diagram exists, a line under Generate reads: *"Generating replaces the current diagram. The current one is kept in Versions."*
   - On click, generation starts immediately. The current diagram is first stored as a version in IndexedDB, labelled with time and enabled toggles (e.g. *"14:32 · Serverless-first, Backups"*).
   - After success, a toast shows *"New diagram generated · Restore previous"*. A Versions list restores any earlier one.
   - The one real confirmation: if the user **edited the diagram by hand** since it was generated, confirm before replacing. The edited diagram is still kept as a version.
   - Keep the last 10 versions per project; drop older ones automatically. [builder call, proposed to PO]
5. **Gateway generation is real.** `/api/ai/generate` and `/api/ai/generate/continue` stop returning 501. Credits, budget caps and kill switch apply as already built.
6. **The remaining PRD rules VR-002, VR-003, VR-008 and VR-011 are implemented** (roadmap Phase 2: rule set VR-001…018).
7. **Eval harness runs the real generator** (NFR-013), and **Gate A** is passed: blind review of ≥ 10 distinct scenarios via isolated Claude reviewer sessions, eval harness green.

## 3. Non-goals (this phase)

- AI Edit, Review, Ask (`/api/ai/edit|review|ask` stay 501).
- BYOK direct browser calls (Phase 3). Phase 2 generates through the gateway with the instance key and the existing model policy (Haiku free tier, Sonnet where enabled).
- Exports beyond the existing JSON, cost estimates, Azure/GCP generation.
- Merging a new generation into an existing diagram. Regenerating replaces; versions are the safety net.
- Re-applying a toggle to an existing diagram without regenerating.

## 4. Anti-goals (failure even if it "works")

- Losing a user's diagram, or manual edits, without a way back.
- Questions that are generic filler ("Any other requirements?") or more than one round. Questions must be specific and skippable; skipping must still produce a good diagram.
- A toggle that changes nothing visible, or that the validator does not check.
- Over-engineering by default: toggles off must keep the Phase 0 "simplest design that meets the requirements" behaviour (no DAX, no cross-region, no WAF unless asked or justified).
- Prompts, graphs or keys in logs (NFR-006). Any regression on the Phase 0 benchmark numbers in `MODEL_OPTIONS`.

## 5. User flow

```
[prompt box] + [toggle chips] + [model picker (existing AiModelPanel)] → Generate
   │
   ├─ step 1: extract  → requirements, assumptions, questions
   │     questions? ── yes → show question card(s) with quick-answer chips + "You decide" + Skip all
   │                         user answers/skips → Continue (no new credit)
   │                  └─ no → go straight on
   ├─ step 2: generate → graph JSON (structured output, catalog enum), 1 repair turn per model policy
   ├─ client: snapshot current diagram as a version → migrate → ELK layout → validate → render
   └─ toast "New diagram generated · Restore previous"
```

- **Questions.** At most 3 per round [builder call]. Questions are drawn from a **fixed list of gap topics** [builder call], so ids are stable and testable: `auth-methods`, `user-scale`, `data-retention`, `region-residency`, `compliance`, `notifications`, `media-processing`, `integrations`, `availability-target`. The topic is the question id; the model writes the wording for the specific request. A topic an enabled toggle settles (e.g. `availability-target` with High availability or Disaster recovery on) is removed from the enum for that call. Each question has the topic id, the question text, 2–4 suggested answers as chips, and implicitly "You decide" (model picks, recorded as `inferred`). Free-text answer allowed. Questions must not cover something an enabled toggle already settles.
- **Requirements are editable at the question step [PO, 2026-10-18].** The question card also lists the extracted requirements (PRD US-02). The user can edit a requirement's text, delete it, or add one. When extraction returns no questions, this review step is still offered as an optional "Review requirements" pause before generation; the default is to go straight on [builder call].
- **Answers become requirements** with `provenance: 'clarification'`, `status: confirmed`.
- **Progress.** Generation takes ~45 s median (benchmark). Show stage text ("Reading your requirements…", "Designing…", "Checking…"), and allow Cancel (no credit charged if the server has not completed).
- **Errors.** `no_credits` / `model_not_enabled` / `free_ai_unavailable` / `setup_required` show the reason and keep manual editing working. Provider failure → no charge, "Try again".

## 6. Toggles in the validator

Each toggle adds rules that run only when it is enabled (project stores enabled toggles, §8). New rule IDs continue the sequence [builder call on exact conditions; the intent is PO's]:

| Toggle | Rule (enabled only) | Severity |
|---|---|---|
| Serverless-first | EC2 or RDS/Aurora (non-serverless) node without a requirement justifying it | warning |
| Backups | Data store (DynamoDB, RDS, Aurora, S3, EFS, ElastiCache) without backup/PITR/versioning configuration | warning |
| Disaster recovery: Multi-AZ | VPC resources not spread over ≥ 2 availability-zone containers; RDS/Aurora without Multi-AZ config | warning |
| Disaster recovery: cross-region | No second region container, or data stores without replication config (S3 CRR, DynamoDB global tables, Aurora global) | warning |
| High availability | Single-AZ placement of VPC resources (generalises VR-018) | warning |
| Cost-optimized | DAX/NAT Gateway/provisioned capacity without a justifying requirement | info |
| Security hardening | Public API Gateway / ALB / CloudFront without WAF; data store without KMS encryption config | warning |

New feature keys these rules read (backup, PITR, versioning, Multi-AZ, replication, KMS) are added to the catalog `features` list so the generator can set them through the existing `configuration` contract. The rules get positive and negative fixture tests like VR-001…018.

## 7. Pipeline and API

Port the spike's generation contract (`Generation` schema, system prompt, `toProject`, repair turn) from `eval/src/spike.ts` into a shared package (e.g. `packages/generator`) used by both the gateway and the eval harness, so CI scores exactly what users get. [builder call on package name/shape]

**Two model calls per Generate** (technical-architecture §5): extract, then generate. Extraction always runs on Haiku with a short structured output (requirements, assumptions, questions), whichever model the user picked for generation, to keep the added cost (~$0.001) and latency (~5–10 s) small. The generation call receives the extracted requirements instead of re-extracting. A cost or latency increase over the Phase 0 single-call numbers is accepted up to 1.5× [builder call]. Catalog retrieval (step 3 of §5) is optional for the PoC: the full catalog is ~40 services and fits; add retrieval only if token cost requires it. [builder call]

**API (existing routes, contract made concrete):**

- `POST /api/ai/generate` body: `{ prompt, catalogVersion, model?, toggles: { serverlessFirst?, backups?, disasterRecovery?: 'multi-az' | 'cross-region', highAvailability?, costOptimized?, securityHardening? } }`
  - → `200 { status: 'questions', operationId, operationToken, requirements, assumptions, questions }`, or
  - → `200 { status: 'done', project, usage }`.
- `POST /api/ai/generate/continue` body: `{ operationId, operationToken, answers: { [questionId]: string | 'you-decide' }, requirements? }`. `requirements` is the user-edited list and, when present, replaces the token's extracted list (same `Requirement` shape and limits; edited ones get `provenance: 'user'`). The token still fixes toggles, model, client key and expiry, so editing cannot change who pays or which model runs. → `200 { status: 'done', project, usage }`.
- **Operation state is stateless [builder call]:** `operationToken` is an HMAC-signed blob (server secret) carrying the extraction result (used when the client sends no edited list), toggles, model, client key and an expiry of 15 min. That works on both Workers and the Node gateway without a new store, and nothing is persisted server side.
- **What counts as success:** a schema-valid project after the repair turn. Rule findings and UNRESOLVED nodes are information shown to the user, not failures, so they are charged [builder call]. Schema-invalid after repair → `502 generation_failed`, no credit.
- **Credits:** one credit per Generate operation, charged once, after the final successful response (either the direct `done` or the `continue`). If the user abandons at the question step, the extraction cost still goes to the spend counters but no credit is consumed. [builder call; PRD says credits are charged on success]
- Spend (micro-USD from token usage × price table) is added to the daily/monthly counters for every model call. The price table moves from spike.ts to the shared package.
- Logs carry request id, model, token counts, latency, status. Never prompt, answers or graph.

## 8. Data model changes

- `Requirement.provenance` adds `'toggle'`.
- Backups, Multi-AZ, cross-region replication and encryption are modelled as catalog **features** (`backup`, `multiAz`, `replication`, `encryption` config keys) on existing data-store services; no new AWS Backup service node is added in this phase [builder call].
- `Project` adds `generation?: { toggles, model, generatedAt, contentHash }`. `contentHash` is a hash of the graph content without positions and sizes, so the client can detect manual edits since generation (hash differs → confirm before replacing). Moving nodes or re-running layout does not count as an edit [builder call].
- Schema bump `1.2.0 → 1.3.0` with a no-op migration in `migrate.ts`.
- **Versions** live in a new IndexedDB object store `versions` keyed by `[projectId, createdAt]`, value `{ label, toggles, project }`, max 10 per project (oldest pruned on insert). Versions are not part of the project JSON export. [builder call]

## 9. Eval harness and CI

- `eval/src/run.ts` keeps scoring stored candidates on every PR (free, deterministic).
- A new **live eval** generates fresh candidates for all 15 scenarios with the shared generator, scores them, and compares with the previous run's metrics. It fails on regression below the `MODEL_OPTIONS` benchmark bars (schema valid 100%, pass rate, VR expectations).
- Scenarios gain optional `toggles` and `answers` fields; add at least one scenario per toggle that checks the toggle's effect (e.g. Backups → every data store has backup config).
- Clarification: in the live eval, questions are answered from a scenario's `answers` or with "you-decide", so runs are reproducible in structure.
- **Regression gate [builder call]:** Haiku only (the free-tier default), every scenario × 1 repeat in CI (≈ $0.20 per run with the toggle scenarios); Gate A uses 2 repeats. Fails when schema-valid rate < 100%, pass rate < 0.90, any `forbiddenServices` hit, or mean cost per operation > 1.5× the Haiku benchmark. Latency is reported, not gated. Sonnet is measured at Gate A and on manual dispatch, not on every PR.
- **When live eval runs and who pays: open for the PO (see §11).**

## 10. Gate A

- Models: Haiku must pass (free-tier default); Sonnet is re-measured on the same scenarios and its `MODEL_OPTIONS` benchmark updated, but does not gate [builder call].
- Blind review of ≥ 10 distinct scenarios with the live generator, via isolated Claude reviewer sessions using PRD §14 rubric and anonymized packets (as in Phase 0). Include toggled variants for at least 3 scenarios.
- Pass: median ≥ 2.0/3, no critical defect in ≥ 90% of scenarios, live eval green. Results recorded in `docs/product/` alongside phase0-spike.md, and MODEL_OPTIONS benchmarks updated only from that run.

## 11. Decided by the product owner (2026-10-18)

1. **Live eval in CI: approved as recommended.** It runs automatically on PRs that change the generator prompt, model policy or catalog (path filter), and on manual dispatch. It uses an `ANTHROPIC_API_KEY` repository secret, which **the PO adds**; Claude never handles the key. Each run has a hard `--max-usd 0.50` cap. Without the secret the job skips with a notice and does not fail, as the deploy workflow already does.
2. **API budget: $5.59 available.** Planned spend: development iterations on scenario subsets ~$1.00, CI live runs ~$1.00 (≈5 runs), Gate A Haiku 15 × 2 ~$0.25, Sonnet re-measure 15 × 1 ~$1.30. Total ≈ $3.55, leaving ~$2 headroom. The blind reviews run as isolated Claude Code reviewer sessions, not on the API key. Claude reports spend at each milestone and asks before going past $4.50.
3. **Requirement editing before generation: in scope** (§5).
4. **Version cap of 10** per project; versions are not in JSON export (builder default, not objected).

## 12. Left to the builder

Package layout, component structure, exact prompt wording for extraction and question selection, toast/Versions UI styling (matching existing styles.css), exact rule IDs and conditions in §6, HMAC details, test structure.
