# Product Requirements Document — CloudArchitect Lite

**Version:** 0.2 · **Date:** 2026-10-13 · **Status:** agreed scope + gap review incorporated + proposed acceptance targets

> v0.2 adds the results of the independent architecture review of v0.1: the container model, an expanded catalog, Review mode, concrete validation rules, a cost model, the BYOK direction, legal/privacy, the eval harness, the expert review process and icon sources. The full list of changes is in §18.

## 1. Product goal

Let users, without signing up and without knowing any diagram format, turn a description of a cloud application into an **editable**, understandable AWS architecture, check it for the main problems, and save and export the result.

**Positioning.** The text-to-diagram market is crowded (Eraser, Cloudairy, Lucid, Brainboard, Cloudcraft, LLM chats generating draw.io/Mermaid, AWS's own tools). Generating a diagram is not a differentiator in itself. The defensible value is **verified catalog + explainable connections + requirements traceability + rule-based validation**. Free/local-first is an acquisition channel, not a retention one. All differentiation claims remain hypotheses until Gate C.

## 2. MVP user journey

1. Open the app without logging in → choose **AWS** (show Azure/GCP as *coming later*, if shown at all).
2. Enter requirements in English → **Generate**. Before the first submission, show an explicit notice that the text will be sent to an AI provider (NFR-001).
3. Receive extracted requirements, assumptions and open questions. If there are critical questions, **one clarification round** happens within the same operation (FR-025).
4. Receive a structured architecture graph → canvas with original AWS icons, containers (Region / VPC / subnet) and connections.
5. Click a component or edge → see purpose, interaction, rationale, source/verification and relevant requirements.
6. Correct the diagram manually or with an available AI command.
7. Run **Validate** → see rule-based findings on canvas elements and requirement coverage. Optionally run **Review** (AI advisory findings, separate from rule findings; FR-021).
8. Save the project in the browser or as JSON; export PNG/SVG.
9. After three free AI operations, continue manually or connect BYOK.

## 3. Roles

- **Anonymous user:** the full local editor; limited free AI operations.
- **BYOK user:** a user with their own AI key/configuration; their provider determines quotas and cost.
- **Catalog maintainer** (internal role): approves catalog updates, connections and icons.
- **Independent cloud architect reviewer** (internal role): scores benchmark outputs against the rubric in §14 at decision gates. In the MVP, Claude fills this role in an isolated reviewer session (§15).

## 4. MVP functional requirements

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| FR-001 | Text description of the architecture | P0 | The user can paste text (≤ 8,000 characters) and start generation; errors are shown clearly. |
| FR-002 | Requirements extraction | P0 | AI returns functional/non-functional requirements, assumptions and open questions; each has status `confirmed` / `inferred` / `open`; the user can edit them. |
| FR-003 | AWS architecture JSON | P0 | A graph valid against the schema; `serviceId` is constrained to an enum from the selected catalog snapshot at the structured-output level; unjustified IDs are rejected. |
| FR-004 | AWS icons | P0 | Known service IDs show the matching official icon from the approved pack (§12); the fallback is visibly marked generic and never passed off as official. |
| FR-005 | Editable canvas | P0 | Nodes can be moved, selected and changed; edges can be edited; undo/redo; the diagram is not an image. |
| FR-006 | Automatic layout | P0 | Auto-layout works for supported graphs, **including nested containers** (FR-019); manual positions are never erased without a user action. |
| FR-007 | Component details | P0 | Name, role, rationale, relevant requirements, docs, verification status, key configuration (e.g. CloudFront OAC and S3 Transfer Acceleration as **configuration**, not separate services). |
| FR-008 | Connection details | P0 | Direction, semantics, protocol/event, auth/permission caveats, rationale; unknown fields are explicitly marked. |
| FR-009 | Basic validation | P0 | Structural checks (schema, IDs, dangling edges, duplicates), catalog checks (unknown/deprecated), coverage, and the rule set in §11. Each finding is attached to a node/edge and carries a ruleId and validator version. |
| FR-010 | Local save/load | P0 | The project is saved in IndexedDB and opens without login; JSON import/export works; the UI reminds users to keep a JSON backup. |
| FR-011 | Diagram export | P0 | PNG and SVG for supported graphs; export keeps labels, connections and containers. |
| FR-012 | Hybrid free AI | P0 | An anonymous user gets a configurable 3 initial AI operations, with anti-abuse controls and a global budget cap in place (NFR-009). |
| FR-013 | BYOK | P0 | After the limit, the user can continue with their own AI provider (§8); the key never reaches the bundle, logs, analytics or server storage. |
| FR-014 | Manual mode | P0 | All core editing, storage and export operations work without an AI connection. |
| FR-015 | Traceability | P0 | Nodes/edges reference requirements; the UI shows uncovered requirements and nodes without requirements. |
| FR-016 | AI editing | P1 | Limited add/remove/replace/update operations via preview diff + confirm; manual edits are not lost; stale patches are rejected. |
| FR-017 | Draw.io export | P1 | The diagram opens and is editable in diagrams.net, including containers; verified on reference scenarios. |
| FR-018 | English interface | P0 | Core interface and error texts in English; the i18n architecture is ready for more languages. |
| FR-019 | **Containers / groups** | P0 | The model supports nested containers `aws-cloud` → `region` → `vpc` → `availability-zone` → `subnet` (public/private) and logical groups. VPC and subnet are containers, not ordinary nodes. A node belongs to ≤ 1 container; containers are displayed, move together with their contents, and take part in layout and export. Global services (CloudFront, Route 53, IAM) sit outside the region. |
| FR-020 | **Out-of-catalog services** | P0 | If a requirement needs a service outside the catalog, AI returns it as `unresolved` (name + rationale) instead of substituting the nearest known service. On the canvas it is a generic node labelled *Not in verified catalog*; validation reports an info finding. The user can replace it with a catalog service. |
| FR-021 | **Architecture review** | P0 | The **Review** button analyzes the *current* graph (generated or manually edited) and returns advisory findings (cost, redundancy, security, resilience). Advisory findings are visually separate from rule findings and never marked verified. Costs 1 credit. |
| FR-022 | Ask about the design | P1 | A question in the context of the selected node/edge/project (e.g. "OAC vs Transfer Acceleration?") answered from the catalog with documentation links. Costs 1 credit. |
| FR-023 | Mermaid export | P1 | Export the graph as a Mermaid flowchart with a subgraph per container; no icon references required. |
| FR-024 | Credit & cost transparency | P0 | Before an operation, the UI shows remaining credits and exactly what will be sent to the AI provider, and shows "free AI temporarily unavailable" when the kill switch is active. |
| FR-025 | Clarification round | P0 | If extraction returns critical open questions, the user answers or skips them; generation uses the answers within the **same** credit. At most one round per operation. |
| FR-026 | Model choice with measured benchmark | P0 | The user picks Claude Haiku 5.5 or Sonnet 5.5 for AI operations. The UI shows each model's measured blind-review score, automated pass rate, critical-defect rate, cost per generation and latency (ADR-0011). Models the instance key does not serve are marked as needing the user's own key. |
| FR-027 | Self-hosted setup wizard | P0 | `docker compose up` on Windows, macOS or Linux prints a one-time setup link. A five-step browser wizard (code, API key check, models, limits with budget estimate, review) configures the instance without editing files (ADR-0012). |

## 5. Non-functional requirements

| ID | Description | Priority |
|---|---|---|
| NFR-001 | Privacy: local data by default, explicit notice before sending requirements to an LLM | P0 |
| NFR-002 | Security: server-side secrets, rate limiting, abuse protection, safe key handling, bounded request size | P0 |
| NFR-003 | Resilience: editor usable offline after assets are cached; AI outages do not block the canvas | P1 |
| NFR-004 | Backward-compatible project schema; migrations on import | P0 |
| NFR-005 | Accessibility basics: keyboard navigation, labels, contrast, scalable UI | P1 |
| NFR-006 | Observability without logging private project content or keys by default | P0 |
| NFR-007 | Multi-cloud-ready architecture domain model | P0 |
| NFR-008 | Provenance: catalog version, verification time, documentation links | P0 |
| NFR-009 | **Cost ceiling:** global daily and monthly budget cap for free AI; automatic kill switch when exceeded; per-request input/output token limits | P0 |
| NFR-010 | **Legal/privacy:** Privacy Policy and Terms of Use before public beta; a documented legal basis (GDPR) for sending text to an AI provider; only provider settings with no training on data and minimal retention; disclaimer "generated designs require professional review" | P0 |
| NFR-011 | **Icon compliance:** icons used only within the source's terms (§12); no changes to shape or color; provenance and hash for each pack | P0 |
| NFR-012 | **Performance:** canvas interaction (drag, select) without noticeable lag at ≤ 150 nodes and ≤ 10 nesting levels; auto-layout ≤ 2 s for a 50-node graph on a typical laptop | P1 |
| NFR-013 | **Automated AI evaluation:** the §13 benchmark runs automatically whenever the prompt, model or catalog changes; a metric regression blocks release | P0 |

## 6. Credit semantics

- **1 credit = one user operation** (Generate, AI Edit, Review, Ask), regardless of how many LLM calls the pipeline makes internally.
- The clarification round (FR-025) is included in the original Generate credit.
- Operations that fail because of the server or provider are **not charged**; operations the user cancels before a response arrives are not charged.
- **3** is a starting configuration, not a guaranteed lifetime quota: without accounts, protection against re-obtaining credits is probabilistic. The main budget protection is the global cap (NFR-009), not precise per-user accounting.
- Manual mode and offline edits do not use credits.
- The interface shows remaining credits and explains that with BYOK the user pays the provider directly.
- The server is the authoritative ledger (atomic changes); localStorage is not a trusted ledger.

## 7. AI cost model

The cost model is set by measurement in Phase 0, not by assumption. Required values:

| Value | How to obtain |
|---|---|
| Average input/output tokens per operation of each type | Measured on the §13 benchmark |
| Cost per operation = Σ (tokens × model price) over all pipeline calls | Calculated from the provider's current price list on the measurement date |
| Cost per free user = 3 × average cost per operation | Calculated |
| Monthly budget cap | Product owner decision |
| Supportable free users per month = cap / cost per user | Calculated; recalculated after beta |

Recommendation: use an economical model for the free tier and a stronger one as the BYOK default; check both on the same benchmark. Send only the part of the catalog relevant to the request in the prompt, to bound input tokens.

## 8. BYOK — product decision

- **Preferred: direct calls from the browser** to providers that officially support it (Anthropic and OpenAI as of v0.2). The user's key never passes through our server, which reduces our liability and increases trust.
- By default the key is held **only in tab memory**; saving it in the browser is an explicit opt-in with a warning.
- With BYOK, prompt templates and the catalog snapshot are loaded by the client; validation runs on the client (shared TypeScript schema).
- **Fallback:** an ephemeral proxy for providers without browser access; the key is neither stored nor logged (a detailed threat model is required before release).
- **Optional (P1):** OpenRouter via OAuth PKCE — the user obtains a key without copying it manually.
- This reverses v0.1 (proxy as the primary option); TECHNICAL_ARCHITECTURE §7 has been updated to match.

## 9. AWS catalog scope (MVP)

A manually curated catalog of ~40 services; identifiers and resource types are cross-checked against the official CloudFormation resource specification. The automated update pipeline (CLOUD_PROVIDER_CATALOG §6) comes after beta; until then, updates are manual against a checklist.

| Group | Services |
|---|---|
| Delivery / networking | CloudFront, Route 53, API Gateway, Application Load Balancer, NAT Gateway; containers: VPC, Subnet |
| Compute | Lambda, EC2, ECS, Fargate, EKS |
| Storage | S3, EFS |
| Data | DynamoDB, DynamoDB Accelerator (DAX), RDS, Aurora, RDS Proxy, ElastiCache, OpenSearch Service |
| Integration | SQS, SNS, EventBridge, Step Functions, Kinesis Data Streams, Data Firehose |
| Identity / security | IAM, Cognito, WAF, Shield, KMS, Secrets Manager, Certificate Manager |
| Operations | CloudWatch, X-Ray, CloudTrail |
| Email / AI / analytics | SES, Bedrock, Athena |

Service features (CloudFront OAC, S3 Transfer Acceleration, S3 Event Notifications, Lambda authorizer, etc.) are modelled as **configuration** on a node or edge, not as separate nodes. Anything outside this list falls under FR-020.

## 10. Containers model (summary)

See FR-019. Minimal contract: `Container { id, kind: 'aws-cloud' | 'region' | 'vpc' | 'availability-zone' | 'subnet' | 'group', parentId?, label, properties (e.g. subnet: public|private, cidr?) }`; a node gets a `containerId`. Container validation rules are in §11 (VR-009, VR-010). Details: TECHNICAL_ARCHITECTURE §4.

## 11. Initial validation rule set (MVP)

Rule findings are deterministic and versioned; advisory findings (FR-021) are a separate class.

| Rule | Condition | Severity |
|---|---|---|
| VR-001 | S3 as a CloudFront origin without OAC in configuration | warning |
| VR-002 | Clients read S3 directly while CloudFront serves the same content | warning |
| VR-003 | Public API Gateway / ALB without a stated auth mechanism (Cognito, IAM, Lambda authorizer) | warning |
| VR-004 | Asynchronous consumer (SQS / SNS / EventBridge / S3 event → Lambda) without a DLQ or failure destination | warning |
| VR-005 | Lambda → RDS/Aurora without RDS Proxy | info |
| VR-006 | DAX without a (confirmed/inferred) requirement for microsecond DynamoDB read latency | warning (cost/design) |
| VR-007 | No observability component (CloudWatch) in the architecture | info |
| VR-008 | Data store without stated encryption at rest | info |
| VR-009 | EC2 / RDS / Aurora / ElastiCache / EFS outside a VPC container | error |
| VR-010 | RDS / Aurora / ElastiCache in a public subnet | error |
| VR-011 | Client writes to S3 (upload) without a stated authorization mechanism (presigned URL / Cognito) | warning |
| VR-012 | Requirement without a linked node or edge | warning |
| VR-013 | Node without a linked requirement (except the observability/security baseline) | info |
| VR-014 | Service with lifecycle `deprecated` / `retired` / `unknown` | warning |
| VR-015 | `unresolved` node (FR-020) | info |
| VR-016 | AWS WAF attached to an API Gateway HTTP or WebSocket API (WAF supports REST APIs only) | error |
| VR-017 | Lambda on-failure destination used for an SQS event source (use the queue's redrive DLQ) | warning |
| VR-018 | Application Load Balancer placed in a single Availability Zone | warning |

Every rule has positive and negative fixture tests.

## 12. Icons — sources and usage terms

Use **only** the official packages from the sources below, never redrawn, AI-generated, cropped, flipped, rotated or recolored. Each pack is recorded in a manifest: provider, release identifier, source URL, download date, SHA-256.

| Provider | Source | Terms published on the page (checked 2026-10-13) | Format |
|---|---|---|---|
| AWS | https://aws.amazon.com/architecture/icons/ | "We allow customers and partners to use these toolkits and assets to create architecture diagrams." No separate redistribution terms on the page; the AWS Site Terms and trademark guidelines apply. Current package: release 2026-07-31. | ZIP (icon package, PPTX toolkits) |
| Azure | https://learn.microsoft.com/en-us/azure/architecture/icons/ | "Microsoft permits the use of these icons in architectural diagrams, training materials, or documentation. You can copy, distribute, and display the icons only for the permitted use unless granted explicit permission by Microsoft." Don'ts: don't crop, flip, rotate or distort; don't use them to represent your own product. Current package: V24 (July 2026). | SVG (ZIP) |
| GCP | https://cloud.google.com/icons | No explicit terms of use published on the page; the Google Cloud Site Terms and brand guidelines apply. Packages: core product icons, category icons, legacy console icons. | SVG + PNG (ZIP) |

**Product rules:**

- Icons are used only to depict provider services on users' architecture diagrams, which matches the stated purpose of all three sources.
- Provider icons are not used in the CloudArchitect Lite logo, branding or marketing.
- The service name is always shown next to its icon (Azure's recommendation, applied to all providers).
- The interface and repository give attribution and a source link for each pack; trademarks belong to their owners.
- Residual risk: the AWS and GCP terms do not explicitly cover embedding the package in a third-party tool. Mitigation: in Phase 0, record the terms text from the downloaded archives (README/LICENSE, if any) and, if anything is ambiguous, serve icons lazily from a versioned asset store rather than a public Git repository. Gate B keeps its "license review" item.

## 13. Quality benchmark and evaluation harness

- **Phase 0:** 10–15 reference prompts + rubric (§14); **before beta:** 30–50 prompts across classes (static web, event-driven, data pipeline, containerized API, ML inference, legacy migration).
- Metrics (targets, not confirmed results):
  - valid graph / schema rate ≥ 99%;
  - explicit requirement recall ≥ 90%;
  - unsupported service IDs accepted as verified = 0 (structurally enforced);
  - median rubric score ≥ 2.0 of 3, with no critical defects in ≥ 90% of scenarios;
  - time to **accepted** architecture and amount of manual editing.
- **Eval harness (NFR-013):** automatic CI run — schema validity, recall against labelled requirements, expected VR rule hits, comparison with the previous run. Rubric scoring (§14) is done by the reviewer at gates and on significant regressions.

## 14. Architecture review rubric

Each dimension is scored 0–3 (0 = critical defect, 3 = production-grade for an MVP-level design).

| Dimension | What is checked |
|---|---|
| Requirement coverage | All explicit requirements are reflected; assumptions are marked |
| Service fitness | Service choices are justified; nothing redundant or expensive without reason |
| Connection correctness | Direction, semantics, protocols and integrations are correct |
| Security baseline | Auth, least privilege, private data not public, encryption |
| Reliability / operability | Error handling, DLQs, observability, fault tolerance |
| Cost awareness | No obvious overspend; serverless/managed where appropriate |
| Explanation accuracy | Rationale and connection descriptions are technically correct |

A **critical defect** is any 0, or any incorrect technical statement that would lead the user to an insecure or non-working solution.

## 15. Independent expert review process

- In the MVP, **Claude** fills the role of independent cloud architect in a separate reviewer session.
- **Isolation:** the reviewer receives only the user's original prompt, the final graph JSON and the rubric; it does not receive the generation prompt, intermediate reasoning, or the model/prompt version (blind review).
- **Output:** a completed rubric, a list of defects with severity, and links to AWS documentation / Well-Architected for every disputed claim.
- **When it applies:** Gate A (≥ 10 scenarios), before private beta (the full benchmark), on a significant eval-harness regression, and on a model change.
- **Limitation:** the reviewer and the generator are models from the same family, so they may share blind spots. Mitigations: mandatory links to official documentation for disputed points; a human expert spot-checks ≥ 20% before public beta, if available; track disagreements between rubric scores and beta-user feedback.

## 16. MyBlog.com — reference acceptance scenario (revised)

**User request:** serverless global blog, read-heavy / infrequent writes, static site + REST API, caching, welcome email for subscribers, photo upload + thumbnails, low latency & cost.

**Expected behavior — Generate:**

- Extract requirements, distinguishing assumed from confirmed needs; ask about author authentication if it is critical.
- Generate a justified architecture: S3 + CloudFront (static), API Gateway + Lambda (dynamic), a suitable data store, SES for email, S3 event → Lambda for thumbnails.
- Model CloudFront OAC correctly as configuration on the CloudFront → S3 connection; do not confuse it with S3 Transfer Acceleration (which speeds up **uploads** to S3) — covered in FR-007/FR-008 details.
- The welcome-email requirement traces to SES (VR-012 does not fire).
- Missing auth/upload security, error handling and observability are shown as findings or open questions (VR-003, VR-004, VR-007, VR-011).
- DAX is **not** added without a microsecond-latency requirement.

**Expected behavior — Review (FR-021) and Validate:**

- If the user adds DAX in front of DynamoDB manually or via AI Edit without a matching requirement, VR-006 raises a warning and Review explains the cost/design trade-off.

**Expected behavior — Ask (FR-022, P1):**

- Asked "CloudFront OAC vs S3 Transfer Acceleration", the tool gives a correct explanation with documentation links.

No single topology is mandatory; the reviewer scores against the §14 rubric.

## 17. User stories, team assumptions, exclusions, open decisions

**User stories**

- US-01: As a user I can generate a diagram from prose.
- US-02: As a user I can inspect and edit extracted requirements and answer clarifying questions.
- US-03: As a user I can understand why a service/connection was selected.
- US-04: As a user I can move/add/delete nodes, edges and containers.
- US-05: As a user I can see validation findings attached to canvas elements.
- US-06: As a user I can save locally and export without creating an account.
- US-07: As a user I can switch from free credits to my own AI key.
- US-08: As a maintainer I can update provider data without breaking projects.
- US-09: As a user I can ask the tool to review my (edited) architecture.
- US-10: As a user I can see which parts of my design use services outside the verified catalog.

**Team & delivery assumptions**

- Implementation: Claude as implementer, plus the product owner, who makes decisions and provides access (AI provider, Cloudflare, hosting, domain).
- The ROADMAP schedule (9–10 weeks) is realistic under this model if scope is held; pulling any P1 into the MVP moves dates.
- **Risk order:** Phases 0–1 include an AI quality spike in parallel with the canvas — generation quality is the main hypothesis; the canvas is the low-risk part.

**Exclusions**

No IaC deployment, deep price engine, multi-user cloud storage, enterprise compliance certification, continuous infrastructure inventory, autonomous production changes, or Azure/GCP AI generation in the MVP.

**Decisions requiring product validation**

- Monthly free-AI budget cap and final quota after measurement (§7). Models are decided in ADR-0011.
- Accountless anti-abuse UX; whether an email magic link is needed as an optional way to get more credits.
- Depth of requirement extraction in the first public beta.
- Branding, trademark and pricing of an eventual Pro plan.
- Availability of a human expert for spot checks before public beta (§15).

## 18. Changelog

**v0.2 (2026-10-13)** — from the independent review of v0.1:

- Added FR-019 (containers), FR-020 (out-of-catalog), FR-021 (review), FR-022 (ask, P1), FR-023 (Mermaid, P1), FR-024 (cost transparency), FR-025 (clarification round); refined FR-001…FR-011.
- Added NFR-009…NFR-013 (cost ceiling, legal/privacy, icon compliance, performance, automated eval).
- Credit semantics: 1 credit = 1 user operation; budget cap as the main protection.
- New sections: AI cost model, BYOK decision (direct browser calls), catalog scope of ~40 services, containers, 15 validation rules, icon sources and terms, eval harness, rubric, expert review process.
- MyBlog scenario aligned with scope: DAX → via Review/VR-006; OAC vs Transfer Acceleration → via details and Ask; "options" → one justified architecture (alternatives remain P2).
- Positioning refined against competitors.

**Synchronized (v0.2, 2026-10-13):** TECHNICAL_ARCHITECTURE, CLOUD_PROVIDER_CATALOG and ROADMAP updated to v0.2 to match this PRD.

**Translated (2026-10-13):** all product documentation is now English only; no content changes.
