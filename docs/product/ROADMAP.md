# Roadmap & Implementation Backlog — CloudArchitect Lite

**Version:** 0.2 · **Date:** 2026-10-13 · **Dates:** estimates, not commitments · **Aligned with:** PRD v0.2

## 1. Delivery model

- **Implementation:** Claude, with the product owner making decisions and providing accounts (AI provider, Cloudflare, hosting, domain).
- **Independent architecture review:** Claude in an isolated, blind reviewer session using the PRD §14 rubric (PRD §15).
- The schedule holds only if scope stays at P0; each P1 pulled into MVP moves dates.

## 2. Development stages

| Phase | Estimate | Outcome | Exit criterion |
|---|---|---|---|
| 0. Discovery / Benchmark | Week 1 | 10–15 reference prompts with labels, rubric, project schema 1.1 (incl. containers), icon packs downloaded and terms recorded, **AI quality spike** (one-shot generation on the benchmark), **token/cost measurement** | Benchmark + rubric ready; spike shows schema-valid output and acceptable recall; cost per operation measured; budget cap decided |
| 1. Visual PoC | Weeks 2–3 | React Flow canvas, **nested containers + ELK layout spike**, official AWS icons, JSON roundtrip, undo/redo | Editable, saveable diagram with containers, no AI dependency |
| 2. AI PoC | Weeks 3–4 | Requirements extraction, clarification round, catalog retrieval, constrained generation, unresolved nodes, rule set VR-001…018, **eval harness in CI** | Gate A |
| 3. MVP engineering | Weeks 5–7 | Gateway, credits, **budget cap + kill switch**, BYOK direct browser, Review, exports, Privacy Policy / Terms | End-to-end workflow; Gate B |
| 4. Private beta | Weeks 8–9 | 15–30 testers, full benchmark blind review, bug fixes | Meaningful user acceptance and reliable core |
| 5. Public beta | ~Weeks 9–10+ | Release, analytics, user feedback | Usage, cost and reliability monitored |

The AI spike is moved into Phase 0 because generation quality is the main product hypothesis; the canvas is lower risk. Original 3–5/4–6 week estimates refer to an aggressive small-scope prototype; the schedule above is the conservative plan.

## 3. Implementation epics

**E1 — Project/Canvas:** editor, graph schema 1.1, **containers (FR-019)**, manual operations, undo/redo, ELK layout in a Web Worker, local save/load, schema migration.

**E2 — Cloud Catalog:** ~40 AWS services + containers + features, CloudFormation-checked IDs, lifecycle, evidence, icon pack import with hashes and terms, manual update checklist, provider-neutral interfaces, sample Azure/GCP schemas.

**E3 — AI Generation:** requirements extraction, clarification round (FR-025), catalog retrieval, structured generation with service enum, unresolved nodes (FR-020), error handling, **eval harness (NFR-013)**.

**E4 — Knowledge & Validation UX:** node/edge/container details, requirement traceability, docs links, rule engine VR-001…018, finding display, **Review (FR-021)**.

**E5 — Hybrid AI:** 3 anonymous free operations (configurable), gateway/secrets, provider adapters, **budget cap + kill switch (NFR-009)**, credit transparency (FR-024), **BYOK direct browser** with proxy fallback, anti-abuse.

**E8 — Self-hosted install (new):** one-command `docker compose up`, browser setup wizard (FR-027), installation guide for Windows/macOS/Linux, model choice with benchmark (FR-026). Done 2026-10-14.

**E6 — Export & QA:** PNG/SVG/JSON with containers; Mermaid and draw.io (P1); graph/icon rendering tests, browser QA, accessibility baseline, performance targets (NFR-012).

**E7 — Legal & compliance (new):** Privacy Policy, Terms of Use, GDPR basis, AI provider data settings, icon attribution page, disclaimers.

## 4. Priority order

P0: E1 editor + containers → E2 AWS catalog/icons → E3 structured generation + eval harness → E4 details/rules/Review → E5 credits, budget cap, BYOK → E6 core export → E7 legal.  
P1: AI edit with preview, Ask (FR-022), Mermaid export, draw.io export, OpenRouter OAuth, advanced traceability, manual Architecture Freshness Check.  
P2: Cost estimate, architecture alternatives, ADR/report export, IaC, Azure/GCP generation, automated catalog pipeline, collaboration.

## 5. Product differentiation to test

- Faster **time to accepted diagram** vs manual/editor-plus-chatbot workflow and vs existing text-to-diagram tools.
- Official consistent iconography and trustworthy supported service IDs.
- Clear connection descriptions, requirement coverage and rule-based findings.
- No signup/manual free editor and simple BYOK transition.

## 6. Beta metrics (proposed targets)

- Valid graph output ≥ 99% on curated benchmark.
- Key requirements recall ≥ 90% on benchmark.
- Median rubric score ≥ 2.0 / 3 and no critical defect in ≥ 90% of scenarios (blind review).
- No unsupported service ID accepted as officially verified.
- MyBlog: welcome email traced to SES; DAX not generated without a justifying requirement; manually added DAX flagged by VR-006 and Review.
- Measured cost per operation within the budget model; kill switch tested.
- Zero secrets in app bundle/logs; BYOK key never reaches our servers in direct mode; quota bypass controls tested.
- Manual canvas and exports usable when AI gateway is unavailable.

## 7. Decision gates

- **Gate A (after AI PoC):** blind review of ≥ 10 distinct reference scenarios against the rubric — diagram fidelity, correct edges and containers, no critical defects; eval harness green.
- **Gate B (before private beta):** icon terms recorded for every bundled pack and usage within those terms; security test of keys, quotas and budget cap; Privacy Policy and Terms ready; disaster recovery of local project via JSON export.
- **Gate C (after beta):** empirical time saved, retention, real generation cost vs budget, willingness to pay; compare reviewer scores with beta user feedback to detect reviewer blind spots.

## 8. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Free AI abuse and unexpected costs | Global daily/monthly budget cap, kill switch, throttling, Turnstile, capped tokens |
| Generation quality below targets | AI spike in Phase 0, eval harness in CI, catalog subset retrieval, clarification round |
| Hallucinated cloud knowledge | Curated sourced catalog + structured enum + unresolved status + rule validation |
| Nested container layout complexity | Phase 1 spike with ELK hierarchical layout; fallback to manual container sizing |
| Icon trademark/licensing breach | Only the three official sources; terms recorded per pack; lazy asset store, not public Git; no use in branding |
| BYOK key exposure | Direct browser mode keeps key off our servers; memory-only default; CSP; log scrubbing; proxy threat model |
| Provider drops browser-direct support | Adapter capability flag; proxy fallback |
| Reviewer shares blind spots with generator | Doc-cited findings, optional human spot-check, compare with beta feedback (Gate C) |
| Model drift | Regression benchmark gates every model/prompt change |
| Browser storage loss | Export/backup with migration metadata and UI reminder |
| Scope creep to multi-cloud | AWS feature complete first; generic adapters now, provider content later |
| Crowded market | Focus on validation/traceability differentiation; measure against competitors at Gate C |

## 9. Future vision (not committed)

- V1.5: architecture alternatives, cost assumptions/estimates, ADR.
- V2: architecture-to-backlog, controlled Terraform/CDK template generation.
- V3: full Azure/GCP content and capability-based multi-cloud comparisons.
- V4: read-only cloud inventory, design-vs-actual drift and continuous architecture review.
