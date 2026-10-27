# CloudArchitect Lite — Product Overview

> Free, open-source, self-hosted AI Cloud Architecture Designer — AWS first, Azure/GCP ready.

**Version:** 0.2 · **Status:** product baseline + gap review incorporated · **Baseline date:** 2026-10-13  
**Language:** English (interface and documentation)

## 1. Vision

CloudArchitect Lite turns a text description of an application into an **editable** cloud architecture with official icons, containers (Region / VPC / subnet), meaningful connections and explanations. It is not a raster image generator: the primary output is a typed graph model rendered in an editor.

**Value proposition:** *Describe your application. Get an editable, explainable, validated AWS architecture. Free to start.*

## 2. Agreed product decisions

- **AWS first** for MVP AI generation; the project format, catalog and editor are ready for Azure and GCP.
- **Local-first:** manual editing, local projects, validation and export work without an account or a paid backend.
- **Self-hosted only (2026-10-26, [ADR-0013](../adr/0013-self-hosted-only.md)):** each user runs the app with Docker and their own AI key; daily and monthly spending limits protect that key. Dropped 2026-10-26: hybrid AI with 3 free operations, the budget cap and kill switch, BYOK direct browser calls.
- **Official icons** only from the three sources in §8, within their published terms, never redrawn or distorted.
- **Current knowledge:** a curated catalog of ~40 AWS services cross-checked against the CloudFormation resource specification, with sources, check dates, lifecycle and snapshots. Services outside the catalog are shown as *unresolved*, never as verified.
- **Verifiable architecture:** explainable components and connections, traceability to requirements, 18 deterministic validation rules and a separate AI **Review** (advisory).
- **Independent expert review:** Claude acts as the independent cloud architect in an isolated, blind session using the rubric in PRD §14.

## 3. MVP scope

1. Text-to-AWS-Architecture (structured AI output) with one round of clarifying questions.
2. Interactive canvas: nodes, edges, **nested containers**, labels, drag and drop, auto layout, undo/redo.
3. Verified catalog of AWS services, features (e.g. CloudFront OAC) and official icons.
4. Component and connection details with documentation links.
5. Validation (structure, catalog, VR-001…018, requirement coverage) and AI Review.
6. Local save/open, PNG/SVG/JSON export; Mermaid and draw.io are P1.
7. AI through the user's own gateway and key, with spending limits (the hosted 3-free-operations plan was dropped 2026-10-26).
8. AI Edit and Ask are P1.

**Out of scope for MVP:** Azure/GCP AI generation; Terraform/CDK; deployment; live cloud scanning; full cost estimates; architecture alternatives; teams, SSO, collaboration, cloud storage; automatic remediation of security findings.

## 4. Target audience

- Solution Architects / Cloud Engineers — speed up initial design.
- IT Consultants / Presales — prepare and explain a technical proposal.
- Business Analysts / Technical Product Managers — connect requirements to architecture.
- AWS students — learn how services are used and integrated.

## 5. Competitive position

Text-to-diagram is already offered by Eraser, Cloudairy, Lucid, Brainboard, Cloudcraft, LLM chats (draw.io/Mermaid) and AWS's own tools. Diagram generation alone does not differentiate. Hypothesis: **verified catalog + explainable connections + requirements traceability + rule-based validation**; free/local-first is an acquisition channel. Willingness to pay is unconfirmed (Gate C).

## 6. Documents

- [prd.md](prd.md) — scenarios, requirements, credit semantics, cost model, validation rules, rubric, expert review.
- [technical-architecture.md](technical-architecture.md) — components, API, graph model, AI key handling, security, eval harness, ADRs.
- [cloud-provider-catalog.md](cloud-provider-catalog.md) — catalog, features, containers, icon sources and terms, update process.
- [roadmap.md](roadmap.md) — phases, epics, gates, metrics, risks.

## 7. Open decisions

- Branding and trademark for **CloudArchitect Lite** (working name).
- Product license (not chosen yet: all rights reserved).
- Availability of a human expert for spot checks.

Dropped 2026-10-26 with the hosted plan: free-AI budget cap and quota, accountless anti-abuse UX, email magic link, Pro plan pricing.

**Closed in v0.2:** icon sources (only the official AWS/Azure/GCP pages; terms recorded in PRD §12); BYOK direction; independent reviewer role; container model; catalog scope.

**Closed 2026-10-14:** AI models: Claude Haiku 5.5 with one repair turn (then called the free tier) and Claude Sonnet 5.5 as the stronger option ([ADR-0011](../adr/0011-model-selection.md)).

## 8. Sources

- AWS Icons: https://aws.amazon.com/architecture/icons/
- Azure Icons: https://learn.microsoft.com/en-us/azure/architecture/icons/
- Google Cloud Icons: https://cloud.google.com/icons
- AWS Well-Architected: https://docs.aws.amazon.com/wellarchitected/latest/framework/welcome.html

> The status and current versions of specific services cannot be considered verified on the basis of this document alone. Before release, every catalog entry must have its own verification evidence.
