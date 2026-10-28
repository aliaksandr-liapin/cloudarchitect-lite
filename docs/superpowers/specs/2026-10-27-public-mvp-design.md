# Release 0.2 "Public MVP" — design

Date: 2026-10-27 · Status: draft · Target: mid-November 2026 · Roadmap: `docs/product/roadmap.md` §2

## Intent

0.2 is the first public release and the first announcement (LinkedIn, dev.to, Show HN). It has to make
someone who clicks through from a post understand the project and want to try it within 30 seconds.
The product owner named the two things they must find: **a live demo diagram and a one-command
install**.

The pitch: _describe your app in plain English and get an AWS architecture, checked against 25 rules,
running on your own machine with your own key._

CloudArchitect Lite is now a free, open-source, self-hosted tool and a public showcase for the
maintainer's work (roadmap §2). The repository itself is judged: README, demo, docs, tests and CI.

## Goals

### 1. Official AWS icons (product owner's call: yes, from the official source)

- Every catalog service and container shows its official AWS Architecture Icon; the service name is
  always shown next to it. Nodes the catalog cannot map (unresolved, out of catalog) keep the generic
  tile, visibly marked generic (catalog spec §9).
- **Icons are never committed and never in the published images** (product owner's call, keeping the
  policy in `docs/product/cloud-provider-catalog.md` §2). The repository holds only the icon-pack
  record in `packages/catalog/data/icon-packs.json`: release, official download URL, SHA-256 of the
  ZIP, terms text, and the serviceId → file mapping.
- **Installs fetch the icons on first start** (product owner's call on my recommendation, 2026-10-27):
  the gateway, on the user's machine, downloads the official ZIP once, verifies the hash, keeps only
  the mapped SVGs in its data volume, and serves them to the editor. The web container stays
  read-only. Local development uses the same path. Later starts reuse the saved set; a release with a
  new pinned set fetches it once after upgrade.
- If the download fails or the hash does not match, the app still works: diagrams show the generic
  tiles and a notice says the icons could not be fetched, with a Retry action. Unverified files are
  never used.
- **The GitHub Pages demo includes the icons**, fetched and verified by the demo's build workflow
  (product owner's call on my recommendation). The demo exists to create architecture diagrams, the
  use AWS terms allow, as draw.io and similar tools do publicly. If AWS ever objects, the demo
  switches to generic tiles with a one-line change.
- **Users are told how and why** (product owner's call): the README and the installation guide say,
  in plain words, that on first start CloudArchitect Lite downloads the official AWS icon set from
  aws.amazon.com, that internet is needed for that step (offline installs work with generic tiles),
  that AWS terms allow the icons for creating architecture diagrams but do not cover redistribution,
  which is why they are not in the repository or the images, and that each release uses the newest
  AWS icon set the project has verified (pinned by hash, so every install looks the same and the
  files cannot be swapped).
- **Updating icons is part of the catalog update** (product owner's call): a new AWS icon release is
  adopted by updating release, URL, hash and mapping in one place; a test fails if any catalog service
  or container has no mapped icon file in the pack.
- Containers AWS draws without an icon (availability zone, generic group) use AWS's own group styles
  (dashed box, no icon) and are listed as explicit exceptions in that test — my call.
- Light and dark canvas: icons are never recoloured; a neutral tile behind the icon keeps contrast
  (catalog spec §9).
- Exported PNG and SVG include the icons.

### 2. One-command install

- Users install without cloning or building: download `compose.yaml` and run `docker compose up`. The
  compose file uses the images published to GitHub Container Registry by the release workflow (tag
  `v0.2.0`). The README shows the one command (a `curl … && docker compose up` line per platform,
  with PowerShell for Windows).
- Building from source stays available for contributors (`docker compose -f compose.yaml -f
compose.build.yaml up --build` or equivalent), documented in the development guide.
- GHCR packages are made public together with the repository.
- Images are built for both amd64 and arm64 (my call), so Apple Silicon Macs, Windows on ARM and ARM
  Linux run them natively.
- Tested before release, with results recorded in the release checklist: macOS (Apple Silicon) by the
  builder; Windows 11 on ARM (Parallels) by the product owner; Linux by CI, where the existing install
  smoke test is extended to run the published-image path. Windows on x64 is listed as "expected to
  work, not hand-tested" for 0.2.

### 3. Clickable demo on GitHub Pages

- The editor runs as a static site on GitHub Pages, opening the sample blog diagram (with a finding
  selected, as in the README screenshot). Visitors can drag, resize, auto-layout, validate, switch
  theme, import JSON and export PNG/SVG/JSON. Nothing is sent anywhere; the project is saved in the
  visitor's browser only.
- AI features (Generate, model panel) are visible but explain: "This demo has no AI. Install
  CloudArchitect Lite with your own key to generate designs" with a link to the install section.
- A small banner says it is the demo and links to the repository.
- Built and published by a GitHub Actions workflow on each release (and manual dispatch), replacing
  the Cloudflare Pages deploy.

### 4. README GIF and screenshots

- A short (about 10–15 s) animated GIF at the top of the README: typing a description, the generation
  status, the finished diagram with official icons. It is produced by the existing screenshot tool
  (`tools/screenshots.ts`) so it is repeatable, with the API answered from a **real recorded
  generation** (no hand-made diagram presented as AI output).
- The recording is one live Claude Haiku generation (about $0.01, approved before it runs and capped
  with `--max-usd`), saved as a committed fixture so the GIF can be re-made at no cost — my call.
- All `docs/images` screenshots regenerated with official icons.
- Size kept reasonable for GitHub (target under 5 MB).

### 5. PNG and SVG export

- "Export" offers PNG, SVG and JSON (JSON as today). PNG and SVG contain the whole diagram (not just
  the visible part), with containers, icons, edge labels and the current theme's background, at a
  resolution good enough for slides and posts (PNG at 2× scale).
- File names follow the project name, as the JSON export does today.

### 6. Hosted-only leftovers removed

The product is self-hosted only (roadmap §2). Removed:

- Free credits per client (`FREE_CREDITS`, credit ledger, credit UI and errors). The daily and monthly
  **spending limits stay**: they protect the user's own key. The manual kill switch
  (`FREE_AI_DISABLED`) goes.
- The Cloudflare Workers gateway entry, D1 store, `wrangler.toml`, Cloudflare deploy workflow and
  Cloudflare-specific headers. The Node gateway in Docker is the only runtime.
- Docs and ADRs updated: ADR-0003 (free credits and BYOK), ADR-0004 (Cloudflare) and ADR-0006 (BYOK
  direct browser calls) are marked superseded by a new ADR recording the self-hosted-only decision;
  PRD, technical architecture, threat model, deployment, runbook and scalability docs no longer
  describe a hosted service.
- Existing installs upgrade without re-running setup: saved settings that mention removed keys are
  ignored, not errors.

### 7. README and repository front page

- Pitch first: the one-line pitch, the GIF, "Try the demo" and "Install" links, then a short "how it
  works", what is real today, and what is next (link to the roadmap). Badges stay.
- The icon note (Goal 1), requirements (Docker only, an Anthropic API key), privacy in one sentence
  (keys and projects stay on your machine; prompts go only to your AI provider).
- GitHub repository description, topics (for example `aws`, `architecture`, `diagram`, `llm`,
  `claude`, `react-flow`) and a social preview image.

### 8. Going public safely

- Before the visibility switch: scan the **entire git history** for secrets (gitleaks or equivalent)
  and for private files (archives, personal data, `.env` contents); anything found is removed from
  history or the key is revoked, and the result is recorded in the release checklist.
- Check that no workflow can spend API budget on a pull request from a fork (the live eval uses
  secrets that forks do not receive; confirm it is skipped, not failed).
- The switch itself, making the GHCR packages public, and enabling GitHub Pages are done by the
  product owner (account-level actions), following a written checklist.

### 9. Release and announcement

- Tag `v0.2.0`, GitHub release notes from the CHANGELOG, images published.
- Drafts, in English, for the LinkedIn post and the dev.to article ("How I stop an LLM from inventing
  cloud services"), saved in `docs/launch/0.2/` for the product owner to edit and publish. Nothing is
  posted on the product owner's behalf.

## Non-goals

- No new AI providers (0.3), Review or Mermaid export (0.4).
- No hosted AI service, accounts, or telemetry.
- No Azure or GCP icons.
- No change to generation quality or prompts.

## Anti-goals

- AWS icon files in the public repository, its history, or the published container images.
- An install that fails to start because the icon download failed.
- A demo or GIF that shows anything the product does not really do.
- A secret, key or private file becoming public with the repository.
- An install that only works on the maintainer's machine.

## Constraints

- Everything in English; existing tests stay green; new behaviour has tests (icon mapping coverage,
  hash check, export output, removed-settings upgrade).
- Icon use follows the recorded terms: original images, no distortion or recolouring, never used in
  CloudArchitect Lite branding.
- No new runtime dependency unless it replaces hand-written code of similar size (PNG/SVG export may
  use a small, maintained library).

## Builder-check answers (2026-10-27)

1. **How icons reach users without the project redistributing them** — product owner's call on my
   recommendation: installs fetch on first start into the gateway's data volume; the Pages demo
   includes them (Goal 1).
2. **Who tests which platform** — product owner tests Windows 11 on ARM; builder tests macOS; CI
   covers Linux; images are multi-arch (Goal 2).
3. **Where the GIF's generation comes from** — my call: one approved live Haiku run, committed as a
   fixture (Goal 4).
4. **Containers without an official icon** — my call: AWS group styles, explicit test exceptions
   (Goal 1).

## Left to the builder

How the gateway fetches, stores and serves the icons (endpoint path, caching headers), the export
library or technique, GIF tooling, the demo's base path handling, the exact README wording, and the
order of the work inside the release.
