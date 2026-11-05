# CloudArchitect Lite

[![CI](https://github.com/aliaksandr-liapin/cloudarchitect-lite/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/aliaksandr-liapin/cloudarchitect-lite/actions/workflows/ci.yml)
[![Security](https://github.com/aliaksandr-liapin/cloudarchitect-lite/actions/workflows/security.yml/badge.svg?branch=main)](https://github.com/aliaksandr-liapin/cloudarchitect-lite/actions/workflows/security.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
![Status: pre-alpha](https://img.shields.io/badge/status-pre--alpha-orange.svg)

> Describe your app in plain English and get an AWS architecture, checked against 25 rules, running on your own machine with your own key.

![Replay of a recorded generation: CloudArchitect Lite turns a plain-English description into an AWS architecture diagram](docs/images/demo.gif)

_Replay of a real recorded generation with Claude Haiku, shortened: a real generation takes about 50 seconds._

**[Try the demo](https://aliaksandr-liapin.github.io/cloudarchitect-lite/)** (a clickable editor in your browser, no install) · **[Install](#install)** (one command, needs Docker)

## Install

You need [Docker](https://docs.docker.com/get-docker/) and an API key from Anthropic, OpenAI or Google (Gemini): [Anthropic](https://platform.claude.com/settings/keys), [OpenAI](https://platform.openai.com/api-keys), [Google AI Studio](https://aistudio.google.com/apikey). Any one is enough. Then run one command.

macOS and Linux:

```bash
curl -fsSLO https://raw.githubusercontent.com/aliaksandr-liapin/cloudarchitect-lite/v0.3.0/compose.yaml && docker compose up
```

Windows (PowerShell):

```powershell
curl.exe -fsSLO https://raw.githubusercontent.com/aliaksandr-liapin/cloudarchitect-lite/v0.3.0/compose.yaml; docker compose up
```

Open the setup link printed in the terminal. A short wizard checks your keys, lets you pick models and sets your daily and monthly spending limits. Then the editor is at <http://localhost:8080>.

Details, upgrading and troubleshooting: [installation guide](docs/operations/installation.md). To build from source, see [development guide](docs/engineering/development.md).

**About the AWS icons.** On first start, CloudArchitect Lite downloads the official AWS icon set from aws.amazon.com, so the internet is needed for that step (offline installs work with generic tiles). AWS terms allow the icons for creating architecture diagrams but do not cover redistribution, which is why they are not in this repository or its images. Each release uses the newest AWS icon set the project has verified, pinned by hash, so every install looks the same.

**Privacy.** Your keys and projects stay on your machine; prompts go only to your AI provider.

## How it works

1. **Describe** your application in plain language. The AI asks up to three clarifying questions.
2. **Generate** a design built only from a curated catalog of 38 AWS services, placed in containers (cloud, region, VPC, availability zone, subnet). A service the catalog does not know is flagged as unresolved instead of invented.
3. **Validate**: 25 deterministic rules (VR-001 to VR-025, not the AI) check the design and report findings, for example a queue consumer without a dead-letter queue or a single-AZ load balancer.
4. **Edit and export** on the canvas, then export JSON, PNG or SVG.

## Claude vs GPT vs Gemini

**Claude vs GPT vs Gemini: GPT-6.1 Sol scored highest in a blind review by a panel of all three providers.** Six models were measured on the same code; the four that met the listing bar are offered in the setup wizard and the editor.

| Model             | Blind score (0-3) | Checks passed | Cost per design | Typical wait |
| ----------------- | ----------------- | ------------- | --------------- | ------------ |
| GPT-6.1 Sol       | 2.86              | 86.7%         | $0.0440         | 65 s         |
| Claude Sonnet 5.5 | 2.55              | 100%          | $0.0490         | 30 s         |
| Claude Haiku 5.5  | 2.52              | 86.4%         | $0.0071         | 53 s         |
| Gemini 4 Argon    | 2.43              | 100%          | $0.1197         | 50 s         |

Small samples (9 to 12 reviewed designs per model), AI reviewers, prices checked 2026-11-04; Gemini 4 Argon is priced at its December rate. Method, the two unlisted models and all limits: [benchmark report](docs/product/phase3-provider-benchmark.md).

## What works today

- Plain-English description, clarifying questions and design-priority toggles (serverless-first, backups, disaster recovery, high availability, cost-optimized, security hardening).
- AWS diagrams with official icons, containers and 25 validation rules with findings.
- Editor: drag, resize, auto layout, light and dark theme, and versions that keep earlier diagrams.
- Import and export JSON; export PNG and SVG.
- Self-hosted with Docker on your own Anthropic, OpenAI or Gemini key (one is enough), with daily and monthly spending limits that count all providers together.
- Choice of four measured models from three providers: Claude Haiku 5.5, Claude Sonnet 5.5, GPT-6.1 Sol and Gemini 4 Argon. Scores, cost and wait are in the [benchmark table](#claude-vs-gpt-vs-gemini); method and caveats: [benchmark report](docs/product/phase3-provider-benchmark.md).

## What's next

0.3 added OpenAI and Gemini next to Claude and the public benchmark above. 0.4 adds Review (an AI critique of any diagram) and Mermaid export. See the [roadmap](docs/product/roadmap.md#2-public-release-roadmap-from-2026-10-26).

## Documentation

- Product: [overview](docs/product/README.md) · [PRD](docs/product/prd.md) · [technical architecture](docs/product/technical-architecture.md) · [catalog](docs/product/cloud-provider-catalog.md) · [roadmap](docs/product/roadmap.md)
- Decisions: [docs/adr](docs/adr/)
- Security: [SECURITY.md](SECURITY.md) · [threat model](docs/security/threat-model.md)
- Operations: [installation](docs/operations/installation.md) · [deployment](docs/operations/deployment.md) · [runbook](docs/operations/runbook.md)
- Engineering: [development](docs/engineering/development.md) · [testing](docs/engineering/testing.md)

## FAQ

**Which model should I use?**
Claude Sonnet 5.5 if you want every automated check to pass (15 of 15 in the benchmark). GPT-6.1 Sol for the best-reviewed designs (highest blind score). Claude Haiku 5.5 to keep costs low, at about $0.007 per design. Gemini 4 Argon also passed every check but costs the most. See [Claude vs GPT vs Gemini](#claude-vs-gpt-vs-gemini).

**What data leaves my machine?**
Only what generation needs, and only to the AI provider of the model you picked: your description, the design priorities, your answers to the clarifying questions, the requirements and a list of catalog services. Your API keys stay in the gateway's data volume and are never sent to the browser. Projects are saved in your browser. On first start the gateway downloads the official AWS icons from aws.amazon.com. There is no telemetry and no account.

**Why does the AI produce a typed graph instead of a picture?**
The design is a JSON project (components, connections, containers such as VPCs and subnets) checked against a schema. That makes it possible to restrict services to a catalog, run deterministic rules on it, edit it on a canvas, and export it as JSON, PNG or SVG. A picture could only be looked at.

**What do the rules check, and how is that different from an AI review?**
25 deterministic rules (plain code, not the model) check the graph after generation, for example a database outside a VPC, a database in a public subnet, or a queue consumer without a dead-letter queue. They catch the same problems every time. An AI review that critiques the whole design is planned for 0.4; it will add judgement on top of the rules, not replace them.

**Does it work offline?**
Editing, validation and export work without internet or an API key. Generation needs your AI provider. Without internet on first start, diagrams use generic tiles instead of the AWS icons.

**What does it cost?**
The app is free and open source. You pay your AI provider directly for generations, about $0.007 per design with Claude Haiku 5.5 and $0.04–0.05 with Claude Sonnet 5.5 or GPT-6.1 Sol. Daily and monthly spending limits are set in the setup wizard.

## Contributing and support

Found a bug or have an idea? [Report a bug](https://github.com/aliaksandr-liapin/cloudarchitect-lite/issues/new?template=bug.yml) or [suggest an improvement](https://github.com/aliaksandr-liapin/cloudarchitect-lite/issues/new?template=feature.yml). See [CONTRIBUTING.md](CONTRIBUTING.md), [SUPPORT.md](SUPPORT.md) and the [code of conduct](CODE_OF_CONDUCT.md). Changes are listed in [CHANGELOG.md](CHANGELOG.md). Report vulnerabilities as described in [SECURITY.md](SECURITY.md).

## License

[Apache License 2.0](LICENSE). Cloud provider names, icons and trademarks belong to their owners and are not included in this repository; see [NOTICE](NOTICE). This project is not affiliated with or endorsed by any cloud provider.
