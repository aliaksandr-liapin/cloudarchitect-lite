# Release 0.2 "Public MVP" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship CloudArchitect Lite 0.2 as the first public release: official AWS icons fetched on first
start, a one-command install from published multi-arch images, a clickable GitHub Pages demo, PNG/SVG
export, a pitch-first README with a GIF, and no hosted-service leftovers.

**Architecture:** The catalog package owns the pinned icon-pack record and a Node-only streaming
extractor; the gateway fetches the pack once into its data volume and serves the icon set as one JSON
document at `/api/icons`; the web app turns it into data URLs. The Pages demo is the same web build in
demo mode (no `/api` calls) with the icon set written next to it by the Pages workflow. Free credits,
the kill switch and all Cloudflare code are deleted; spending limits stay.

**Tech Stack:** pnpm monorepo, TypeScript, Hono (Node), React 19 + React Flow, Vite, Vitest, Docker
Compose, GitHub Actions, Playwright (tools only). New dependencies: `fflate` (catalog, runtime),
`html-to-image` (web, runtime).

**Spec:** `docs/superpowers/specs/2026-10-27-public-mvp-design.md`

## Global Constraints

- Everything in English; existing tests stay green; `pnpm ci` passes at the end of every task.
- AWS icon files never enter the repository, its history, or the published container images.
- Icons are never recoloured or distorted; a neutral tile sits behind each icon; the service name is
  always shown next to it; never used in CloudArchitect Lite branding.
- An icon download failure never stops the app from starting; unverified files are never used.
- No new runtime dependency except `fflate` and `html-to-image` (each replaces hand-written code).
- Repository: `aliaksandr-liapin/cloudarchitect-lite`. Images:
  `ghcr.io/aliaksandr-liapin/cloudarchitect-lite/{web,gateway}`. Demo:
  `https://aliaksandr-liapin.github.io/cloudarchitect-lite/`.
- AWS icon package (release 2026-07-31):
  `https://d1.awsstatic.com/onedam/marketing-channels/website/public/shared/architecture-icon-release/Icon-package_07312026.5846e92413caa21490223536cc97f1269e44fa92.zip`
- GitHub Actions are pinned by full commit SHA with a `# vX.Y.Z` comment, as in the existing workflows.
- Never print or log API keys. Paid API calls run only after the product owner approves, capped.
- The product owner (not the agent) pushes the release tag, flips repository/GHCR visibility, enables
  Pages, sets topics and the social preview, and posts announcements.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Owner stops (ask in chat, wait for yes)

1. Task 3, Step 1: first download of the AWS icon ZIP (state file name, source, size).
2. Task 9, Step 1: the paid Haiku recording (about $0.01, budget capped at $0.05).
3. Task 11, Step 1: pulling the gitleaks image.
4. Task 11, Step 6: pushing the branch / opening the PR; tag `v0.2.0` is pushed by the owner.

## Review Focus

1. The gateway container has a 256 MB memory limit: the icon ZIP must be streamed through hash and
   unzip, never buffered whole (Task 3 test `extractIcons consumes chunks incrementally`).
2. A crash mid-write leaves a partial icon file on the volume: on next start it is treated as missing
   and fetched again (Task 4 test `corrupt cache is refetched`).
3. Many browser tabs open at first start and call `/api/icons` and retry together: exactly one
   download runs (Task 4 test `concurrent ensure shares one download`).
4. An existing install upgrades with `FREE_CREDITS` / `FREE_AI_DISABLED` in `settings.json` or the
   environment: it starts and keeps its other settings (Task 1 test `ignores removed settings`).
5. Export of a diagram whose nodes sit at negative coordinates must include them; export is disabled
   when the diagram is empty (Task 6 tests `imageFrame covers negative coordinates`, `export disabled
without nodes`).

---

### Task 1: Remove free credits, the kill switch and Cloudflare code

**Files:**

- Delete: `apps/gateway/src/worker.ts`, `apps/gateway/wrangler.toml`, `apps/gateway/migrations/`,
  `apps/gateway/.dev.vars.example`, `apps/web/public/_headers`, `.github/workflows/deploy.yml`
- Modify: `apps/gateway/src/config.ts`, `store.ts`, `app.ts`, `generate.ts`, `setup.ts`, `node.ts`,
  `apps/gateway/package.json`, `apps/gateway/tsconfig.json`, root `package.json`
  (`onlyBuiltDependencies`: drop `workerd`), `.gitignore` (drop `.wrangler/`, `.dev.vars`),
  `.env.example`, `infra/docker/nginx.conf`, `packages/domain/src/models.ts`,
  `apps/web/src/SetupWizard.tsx`, `apps/web/src/api.ts`, `apps/web/src/errors.ts`,
  `apps/web/src/App.tsx`, `tools/screenshots.ts`
- Test: `apps/gateway/src/app.test.ts`, `generate.test.ts`, `settings-file.test.ts` (or a new
  `config.test.ts`), `apps/web/src/errors.test.ts`

**Interfaces:**

- Produces: `interface SpendStore { addSpend(microUsd: number, now?: Date): Promise<void>; spend(now?: Date): Promise<{ dayMicroUsd: number; monthMicroUsd: number }> }` and `class MemorySpendStore implements SpendStore` in `store.ts`; `Deps.store: SpendStore`; `aiAvailable(): Promise<boolean>` (true when `ANTHROPIC_API_KEY` is set and both spend counters are under their limits).
- Produces: gateway error code `ai_unavailable` (503) replaces `free_ai_unavailable`; `no_credits`, the `byok` response field and `GET /api/credits/status` are gone.
- Produces: `MODEL_POLICY.defaultEnabledModels` (renamed from `freeTierModels`); `byokDefault` removed.

- [ ] **Step 1: Write the failing tests**
  - `config: ignores removed settings` — `resolveConfig({}, { FREE_CREDITS: '3', DEFAULT_MODEL: 'haiku', AI_MODELS: 'haiku', CLIENT_KEY_SALT: 'x'.repeat(16) })` returns a config with `DEFAULT_MODEL === 'haiku'` and no `FREE_CREDITS` property; the same with `FREE_AI_DISABLED: 'true'` in the env argument does not throw.
  - `app: generate returns ai_unavailable when the daily limit is reached` — store spend ≥ `DAILY_BUDGET_MICRO_USD` → 503 `{ error: 'ai_unavailable' }`.
  - `app: repeated generations are not limited per client` — four successful generations from one client all return 200 (previously the fourth was `no_credits`).
  - `app: /api/credits/status is gone` — 404.
  - `errors: ai_unavailable message` — `errorMessage(new ApiError(503, 'ai_unavailable'))` equals `'AI generation is paused: the daily or monthly spending limit is reached. Manual editing still works.'`
  - Update existing tests that assert credits or `free_ai_unavailable`.
- [ ] **Step 2: Run** `pnpm --filter @cloudarchitect/gateway test && pnpm --filter @cloudarchitect/web test` — new tests FAIL.
- [ ] **Step 3: Implement.** Remove `FREE_CREDITS` and `FREE_AI_DISABLED` from `Config` and `SETTING_KEYS`; remove `freeCredits` from `SetupInput`, `status().current`, `SetupRequest` and the wizard (field, "visitors per month" estimate, review row); replace `CreditStore`/`MemoryCreditStore`/`D1CreditStore` with `SpendStore`/`MemorySpendStore`; drop the `cf-connecting-ip` header read; drop wrangler, `@cloudflare/workers-types` and the `dev:worker`/`deploy`/`db:migrate:local` scripts; gateway `description` becomes "AI gateway: setup wizard, spending limits, LLM calls. Runs on Node."; nginx CSP `connect-src 'self'` only (no direct provider calls) and drop the `_headers` sync comment. User-facing copy: drop every "no credit used" (`'Generation cancelled.'`, `'Generation failed. Try again.'`); `model_not_enabled` → `'This model is not enabled. Re-run setup to enable it.'`. Leave historic ADRs and docs to Task 2.
- [ ] **Step 4: Run** `pnpm ci` — PASS; `grep -rnE 'credit|FREE_CREDITS|FREE_AI_DISABLED|wrangler|D1|byok' apps packages tools .env.example infra --exclude-dir=node_modules --exclude-dir=dist` prints nothing.
- [ ] **Step 5: Commit** `refactor!: remove free credits, kill switch and Cloudflare deployment`.

### Task 2: Record the self-hosted-only decision in docs

**Files:**

- Create: `docs/adr/0013-self-hosted-only.md`
- Modify: `docs/adr/0003-*.md`, `0004-*.md`, `0006-*.md` (status line: "Superseded by ADR-0013"),
  `docs/adr/README.md`, `docs/product/prd.md`, `docs/product/technical-architecture.md`,
  `docs/security/threat-model.md`, `docs/operations/{deployment,runbook,scalability,observability}.md`,
  `docs/engineering/testing.md`, `docs/product/README.md`, `docs/product/cloud-provider-catalog.md`
  (§2/§9: icons fetched on first start into the gateway volume, not a lazy asset store),
  `docs/adr/0011-model-selection.md` (free-tier wording), `docs/product/roadmap.md` (§3–§9 risks rows
  about free AI abuse, BYOK and Cloudflare marked dropped)

- [ ] **Step 1: Write ADR-0013** in the existing ADR format: context (2026-10-26 re-scope), decision
      (self-hosted only; the Node gateway in Docker is the only runtime; each user's own key; spending
      limits protect it; no credits, kill switch, Cloudflare, direct browser calls), consequences.
- [ ] **Step 2: Update the listed docs** so none describes a hosted service as current; historical
      sections keep their dates and say "dropped 2026-10-26".
- [ ] **Step 3: Verify** `grep -rniE 'free credit|kill switch|cloudflare|D1|workers' docs --include=*.md | grep -v -E 'superpowers/|Superseded|dropped|0003|0004|0006|0013'` prints nothing; `pnpm format:check` PASS.
- [ ] **Step 4: Commit** `docs: self-hosted only (ADR-0013), supersede hosted ADRs`.

### Task 3: Pinned AWS icon pack and streaming extractor

**Files:**

- Modify: `packages/catalog/data/icon-packs.json` (AWS entry), `packages/catalog/package.json`
  (add `fflate`; `exports` gains `"./extract": "./src/extract.ts"`), `packages/catalog/src/index.ts`
- Create: `packages/catalog/src/icons.ts` (browser-safe), `packages/catalog/src/extract.ts`
  (Node-only), `tools/fetch-icons.ts`
- Modify: `.gitignore` (add `.cache/`)
- Test: `packages/catalog/src/icons.test.ts`, `packages/catalog/src/extract.test.ts`

**Interfaces:**

- Produces (`icons.ts`, exported from the package index):
  - `AwsIconPack` zod schema and type: `{ provider: 'aws'; sourceUrl: string; release: string; downloadUrl: string; sha256: string /* 64 hex */; termsAsPublished: string; termsCheckedAt: string; files: Record<string, string> /* assetId → path inside the ZIP */; noIcon: string[]; status: 'pinned' }`
  - `awsIconPack: AwsIconPack` (parsed at import, like `awsCatalog`)
  - `requiredIconIds(catalog: CatalogSnapshot): string[]` — every service `iconAssetId`, plus `aws/group/<kind>` per container kind, plus `aws/group/subnet-<type>` per subnet type in the domain schema
  - `type IconSet = { provider: 'aws'; release: string; icons: Record<string, string> /* assetId → SVG text */ }`
- Produces (`extract.ts`): `extractIcons(chunks: AsyncIterable<Uint8Array>, pack: AwsIconPack): Promise<IconSet>`; throws `IconPackError` with `code: 'hash_mismatch' | 'missing_file' | 'not_svg'`.
- Produces (`tools/fetch-icons.ts`): `node tools/fetch-icons.ts [--out <file>]` downloads (cached in `.cache/aws-icons-<release>.zip`), verifies, writes the `IconSet` JSON (default `.cache/icons/aws-<release>.json`).

- [ ] **Step 1: OWNER STOP** — ask to download the icon ZIP (name, source URL above, size from a
      `curl -sI` HEAD request). After yes, download into `.cache/`, compute SHA-256, list the SVGs
      (`unzip -l`), and choose for each required id the 48 px service SVG (`Arch_*_48.svg`) or the group
      SVG (`*Group*` folder, 32 px). Put `downloadUrl`, `sha256`, `files`, `noIcon: ["aws/group/availability-zone", "aws/group/group"]` and `status: "pinned"` in the AWS entry; keep release, terms and `termsCheckedAt` (refresh the date if the page text is unchanged).
- [ ] **Step 2: Write the failing tests**
  - `icons: every required id is mapped or explicitly noIcon` — `requiredIconIds(awsCatalog)` each is a key of `files` or in `noIcon`, and `noIcon` equals exactly the two ids above.
  - `icons: no mapping points outside SVG files` — every `files` value ends with `.svg` and has no `..`.
  - `extract: builds the set from a small ZIP` — build a ZIP in-test with `fflate.zipSync` containing two mapped SVGs and an unrelated PNG, a pack whose `sha256` is that ZIP's hash; result `icons` has exactly the two ids with their SVG text.
  - `extract: hash_mismatch` — same ZIP, wrong `sha256` → rejects `IconPackError` code `hash_mismatch`, and no partial set is returned.
  - `extract: missing_file` — pack maps an id to a path not in the ZIP → `missing_file`.
  - `extract: not_svg` — mapped file content without `<svg` → `not_svg`.
  - `extractIcons consumes chunks incrementally` — feed the ZIP as 1 KB chunks from an async generator; same result as one chunk.
- [ ] **Step 3: Run** `pnpm --filter @cloudarchitect/catalog test` — FAIL.
- [ ] **Step 4: Implement** `icons.ts` and `extract.ts`: stream chunks into `node:crypto` `createHash('sha256')` and fflate's streaming `Unzip` (with `UnzipInflate`), keeping only mapped entries; compare the hash after the last chunk before returning. Implement `tools/fetch-icons.ts` with `fetch` + `Readable.fromWeb` feeding `extractIcons`.
- [ ] **Step 5: Run** catalog tests PASS; `node tools/fetch-icons.ts` writes `.cache/icons/aws-2026-07-31.json` with every non-`noIcon` id; `git status` shows no ZIP or SVG.
- [ ] **Step 6: Commit** `feat(catalog): pin the official AWS icon pack and stream-verify it`.

### Task 4: Gateway fetches icons on first start and serves them

**Files:**

- Create: `apps/gateway/src/icons.ts`
- Modify: `apps/gateway/src/app.ts` (routes), `apps/gateway/src/node.ts` (wire + start `ensure()` in the background after `listen`)
- Test: `apps/gateway/src/icons.test.ts`, `apps/gateway/src/app.test.ts`

**Interfaces:**

- Consumes: `awsIconPack`, `IconSet`, `extractIcons`, `IconPackError` (Task 3).
- Produces: `type IconState = 'missing' | 'fetching' | 'ready' | 'failed'`;
  `class IconStore { constructor(deps: { dir: string; pack: AwsIconPack; download?: (url: string, signal: AbortSignal) => Promise<AsyncIterable<Uint8Array>>; log?: (e: Record<string, unknown>) => void }); state(): IconState; iconSet(): IconSet | undefined; ensure(): Promise<void> }`.
  Cache file: `<dir>/aws-<release>.json`, written to a temp name then renamed; other `aws-*.json` files are deleted after a successful fetch. Download timeout 120 s.
- Produces: `Deps.icons?: IconStore`; `GET /api/icons` → `200 { state, release, icons? }` (`icons` only when ready; `{ state: 'missing' }` without a store); `POST /api/icons/retry` → `202 { state }`, starts `ensure()` when state is `missing` or `failed`. Logs `{ event: 'icons', state, error? }` with the `IconPackError` code or `'network'`, never file contents.

- [ ] **Step 1: Write the failing tests** (fake `download`, temp dir)
  - `loads a valid cache without downloading` — pre-written cache for the pinned release → `state()` `'ready'` after `ensure()`, download never called.
  - `downloads, verifies and caches on first start` — then a new `IconStore` on the same dir is ready without downloading.
  - `failed download leaves state failed and no cache file`; a later `ensure()` retries and succeeds.
  - `hash mismatch → failed, no cache file`.
  - `corrupt cache is refetched` — cache file containing `{"provider":"aws"` (truncated) → treated as missing, downloaded again.
  - `concurrent ensure shares one download` — three parallel `ensure()` calls → download called once.
  - `old release caches are removed` — `aws-2025-01-31.json` present → gone after a successful fetch.
  - app: `GET /api/icons` while fetching → `{ state: 'fetching' }` without `icons`; ready → includes `icons`; `POST /api/icons/retry` after failure → 202 and download called again.
- [ ] **Step 2: Run** `pnpm --filter @cloudarchitect/gateway test` — FAIL.
- [ ] **Step 3: Implement** `IconStore` and the routes; in `node.ts` use `join(dataDir, 'icons')` and
      start `void icons.ensure()` after the server listens (startup never waits on it).
- [ ] **Step 4: Run** gateway tests PASS; `pnpm dev`, then `curl -s localhost:8787/api/icons | head -c 200` shows `"state":"ready"` within a minute.
- [ ] **Step 5: Commit** `feat(gateway): fetch official AWS icons on first start`.

### Task 5: Show official icons in the editor

**Files:**

- Create: `apps/web/src/icons.ts`
- Modify: `apps/web/src/api.ts` (`icons()`, `retryIcons()`), `apps/web/src/nodes.tsx`,
  `apps/web/src/App.tsx` (load, poll, notice, pass `iconUrl` into node data), `apps/web/src/styles.css`
- Test: `apps/web/src/icons.test.ts`

**Interfaces:**

- Consumes: `GET /api/icons`, `POST /api/icons/retry` (Task 4); `IconSet` (Task 3).
- Produces: `toDataUrls(set: IconSet): Record<string, string>` (base64 `data:image/svg+xml` URLs, allowed by CSP `img-src data:`); `serviceIcon(node: GraphNode, urls: Record<string,string>): string | undefined` (undefined for unresolved and external nodes); `containerIcon(container: Container, urls): string | undefined` (`aws/group/subnet-<type>` for subnets); node data gains `iconUrl?: string`. `loadIcons(source: () => Promise<{ state: IconState; icons?: IconSet }>)` is reused by the demo (Task 7).

- [ ] **Step 1: Write the failing tests**
  - `serviceIcon returns the CloudFront URL for a node of aws.cloudfront`.
  - `serviceIcon returns undefined for unresolved and external nodes`.
  - `containerIcon maps a public subnet to aws/group/subnet-public; availability-zone and group get undefined`.
  - `toDataUrls encodes SVG text losslessly` (decode round-trip, non-ASCII title included).
- [ ] **Step 2: Run** `pnpm --filter @cloudarchitect/web test` — FAIL.
- [ ] **Step 3: Implement.** `ServiceNode`: when `iconUrl` is set, render `<img src alt="" draggable={false}>` on a neutral tile (light: white, dark: `#f3f4f6`, 4 px padding, rounded) in place of the generic glyph, never filtered or recoloured; otherwise the existing generic tile with `title="Generic icon"`. `ContainerNode`: group icon (20 px) before the label when present; availability zone and generic group keep the dashed style. App: fetch icons once; while `fetching`, show `Downloading the official AWS icons (first start only)…` and poll every 3 s; on `failed`, show `The official AWS icons could not be downloaded, so diagrams show generic tiles.` with a `Retry` button. Update the `ServiceNode` doc comment.
- [ ] **Step 4: Run** web tests PASS; with `pnpm dev`, the sample diagram shows official icons in light and dark themes (check by eye; capture one screenshot into the task report).
- [ ] **Step 5: Commit** `feat(web): official AWS icons on nodes and groups`.

### Task 6: PNG and SVG export

**Files:**

- Create: `apps/web/src/exportImage.ts`
- Modify: `apps/web/package.json` (add `html-to-image`), `apps/web/src/storage.ts` (export `fileBaseName(name: string): string`, used by `downloadJson`), `apps/web/src/App.tsx` (Export menu)
- Test: `apps/web/src/exportImage.test.ts`, `apps/web/src/storage.test.ts`

**Interfaces:**

- Produces: `imageFrame(bounds: { x: number; y: number; width: number; height: number }, padding = 40): { width: number; height: number; transform: string }`; `exportImage(format: 'png' | 'svg', viewport: HTMLElement, nodes: Node[], opts: { background: string; fileName: string }): Promise<void>` (PNG with `pixelRatio: 2`); bounds from React Flow `getNodesBounds(nodes)`.

- [ ] **Step 1: Write the failing tests**
  - `imageFrame adds padding and translates to the origin` — `{x:100,y:50,width:400,height:300}` → `{ width: 480, height: 380, transform: 'translate(-60px, -10px) scale(1)' }`.
  - `imageFrame covers negative coordinates` — `{x:-200,y:-100,width:100,height:100}` → `transform: 'translate(240px, 140px) scale(1)'`.
  - `fileBaseName('My Blog: v2') === 'My-Blog-v2'`.
  - `export disabled without nodes` — the export menu items are disabled when the project has no nodes (test the pure `canExport(project)` helper: `false` for zero nodes and containers).
- [ ] **Step 2: Run** web tests — FAIL.
- [ ] **Step 3: Implement.** Toolbar `Export` menu (a `<details>` dropdown) with `PNG image`, `SVG image`, `JSON project`; background from the current theme's canvas colour; exports include containers, icons and edge labels; hide React Flow controls, minimap and resize handles via html-to-image `filter`.
- [ ] **Step 4: Run** web tests PASS; by hand export PNG and SVG of the sample in both themes; both show the whole diagram with icons (attach to report).
- [ ] **Step 5: Commit** `feat(web): export the whole diagram as PNG or SVG`.

### Task 7: Clickable demo on GitHub Pages

**Files:**

- Create: `apps/web/src/demo.ts`, `.github/workflows/pages.yml`
- Modify: `apps/web/vite.config.ts` (`base: process.env.VITE_BASE ?? '/'`), `apps/web/src/api.ts`,
  `apps/web/src/App.tsx`, `apps/web/src/GeneratePanel.tsx`, `apps/web/src/models.tsx`, `apps/web/src/icons.ts`
- Test: `apps/web/src/api.test.ts`, `apps/web/src/demo.test.ts`

**Interfaces:**

- Produces: `DEMO: boolean` (`import.meta.env.VITE_DEMO === 'true'`); in demo mode `request()` never calls `fetch` and rejects with `ApiError(0, 'demo_mode')`; icons load from `${import.meta.env.BASE_URL}icons.json` (an `IconSet`); models panel uses `MODEL_OPTIONS` from `@cloudarchitect/domain`; `INSTALL_URL = 'https://github.com/aliaksandr-liapin/cloudarchitect-lite#install'`; `demoBootSelection(project: Project): string | undefined` returns the id the first validation finding points at.

- [ ] **Step 1: Write the failing tests**
  - `api in demo mode never fetches` — `vi.stubEnv('VITE_DEMO', 'true')`, re-import `api`, `api.models()` rejects with code `demo_mode`, `fetch` spy not called.
  - `demoBootSelection selects the first finding's node in the sample` — equals the id the README screenshot highlights (read it from `tools/screenshots.ts`).
- [ ] **Step 2: Run** web tests — FAIL.
- [ ] **Step 3: Implement.** Demo mode: no setup notice; a banner `Demo: runs entirely in your browser, nothing is sent anywhere. View on GitHub` (link to the repository); the Generate panel and model panel stay visible, and Generate shows `This demo has no AI. Install CloudArchitect Lite with your own key to generate designs.` with an `Install` link to `INSTALL_URL`; the project boots from the sample with `demoBootSelection` selected. Workflow `pages.yml`: on `release: published` and `workflow_dispatch`; `permissions: pages: write, id-token: write, contents: read`; build with `VITE_DEMO=true VITE_BASE=/cloudarchitect-lite/`; `node tools/fetch-icons.ts --out apps/web/dist/icons.json`; `actions/configure-pages`, `actions/upload-pages-artifact` (path `apps/web/dist`), `actions/deploy-pages`, all SHA-pinned (look up current release SHAs with `gh api`).
- [ ] **Step 4: Run** web tests PASS; `VITE_DEMO=true VITE_BASE=/cloudarchitect-lite/ pnpm --filter @cloudarchitect/web build`, copy the cached icon set to `dist/icons.json`, serve `dist` under `/cloudarchitect-lite/` (`vite preview --base /cloudarchitect-lite/`), and confirm in the browser network panel: icons shown, zero `/api` requests, export works.
- [ ] **Step 5: Commit** `feat: clickable editor demo for GitHub Pages`.

### Task 8: One-command install from published multi-arch images

**Files:**

- Modify: `compose.yaml` (images), `infra/docker/web.Dockerfile`, `infra/docker/gateway.Dockerfile`
  (build stage `FROM --platform=$BUILDPLATFORM`), `.github/workflows/release.yml`,
  `.github/workflows/ci.yml`, root `package.json` (`"version": "0.2.0"`), all workspace
  `package.json` versions → `0.2.0`, `docs/operations/installation.md`, `docs/engineering/development.md`
- Create: `compose.build.yaml`, `tools/check-versions.ts`

**Interfaces:**

- Produces: `compose.yaml` services use `image: ghcr.io/aliaksandr-liapin/cloudarchitect-lite/<svc>:${CLOUDARCHITECT_VERSION:-0.2.0}` and keep every existing hardening option; `compose.build.yaml` adds `build:` per service with `pull_policy: build` and `image: cloudarchitect-<svc>:local`. Contributor command: `docker compose -f compose.yaml -f compose.build.yaml up --build`.
- Produces: `node tools/check-versions.ts` fails unless the root version, every workspace version and the compose default tag are equal.

- [ ] **Step 1: Write `tools/check-versions.ts`** and add it to the CI `verify` job; run it — PASS after the version bumps.
- [ ] **Step 2: Release workflow.** Add `docker/setup-qemu-action` (SHA-pinned) and `platforms: linux/amd64,linux/arm64`; add a `smoke` job (`needs: publish`) that logs in to GHCR and runs `CLOUDARCHITECT_VERSION=${GITHUB_REF_NAME#v} docker compose up --detach --wait --wait-timeout 300` from the checked-out `compose.yaml` only, and runs the same checks as CI install-smoke.
- [ ] **Step 3: CI install-smoke** uses `-f compose.yaml -f compose.build.yaml up --build`; add: poll `curl -fsS http://127.0.0.1:8080/api/icons` until it contains `"state":"ready"` (up to 120 s); and `docker compose exec gateway sh -c 'ls /app'` shows no `.svg` (images carry no icons).
- [ ] **Step 4: Docs.** `installation.md` gets the one-command install per platform:
      macOS/Linux `curl -fsSLO https://raw.githubusercontent.com/aliaksandr-liapin/cloudarchitect-lite/v0.2.0/compose.yaml && docker compose up`;
      Windows PowerShell `curl.exe -fsSLO https://raw.githubusercontent.com/aliaksandr-liapin/cloudarchitect-lite/v0.2.0/compose.yaml; docker compose up`;
      plus the icon note (how and why, wording from spec Goal 1), offline behaviour, upgrade (`docker compose pull && docker compose up`), and the tested platforms (macOS Apple Silicon, Windows 11 on ARM, Linux in CI; Windows x64 expected to work, not hand-tested). `development.md` gets the build-from-source command.
- [ ] **Step 5: Verify locally** `docker compose -f compose.yaml -f compose.build.yaml up --build --wait` on Rancher Desktop; icons reach `ready`; `docker buildx build --platform linux/arm64,linux/amd64 -f infra/docker/gateway.Dockerfile .` succeeds (no push).
- [ ] **Step 6: Commit** `feat: one-command install from published multi-arch images`.

### Task 9: Recorded generation, README GIF and screenshots

**Files:**

- Create: `tools/record-generation.ts`, `tools/fixtures/blog-generation.json`, `docs/images/demo.gif`, `docs/images/social-preview.png`
- Modify: `tools/screenshots.ts`, all `docs/images/*.png`

**Interfaces:**

- Produces: `tools/fixtures/blog-generation.json` = `{ recordedAt, model: 'haiku', prompt, questions /* gateway questions response */, answers, result /* final gateway response */ }`, with `operationId`/`operationToken` replaced by the existing placeholders in `screenshots.ts`.
- Produces: `pnpm screenshots` (PNG set + `social-preview.png` 1280×640) and `pnpm screenshots --gif` (`docs/images/demo.gif`); both read icons from `.cache/icons/aws-<release>.json` (run `tools/fetch-icons.ts` first) and answer `/api/icons` with it.

- [ ] **Step 1: OWNER STOP** — ask to run one live Haiku generation (about $0.01). After yes: start the gateway with `SETUP_WIZARD=disabled AI_MODELS=haiku DEFAULT_MODEL=haiku DAILY_BUDGET_MICRO_USD=50000 MONTHLY_BUDGET_MICRO_USD=50000` (key from `.env`, never printed) and run `node tools/record-generation.ts` with the existing `BLOG_PROMPT`, answering each question with its first suggestion. Commit nothing that contains a key; `grep -E 'sk-ant' tools/fixtures/blog-generation.json` prints nothing.
- [ ] **Step 2: Switch `screenshots.ts`** to answer generate/continue from the fixture instead of hand-written responses; remove the old fixed `QUESTIONS` and result constants.
- [ ] **Step 3: Add `--gif`**: Playwright `recordVideo` at 1280×720 of typing the prompt, the clarification card, the generation status and the finished diagram (10–15 s); convert with `ffmpeg` (palettegen/paletteuse, 12 fps, 960 px wide); fail if the GIF is 5 MB or larger.
- [ ] **Step 4: Run** `node tools/fetch-icons.ts && pnpm screenshots && pnpm screenshots --gif`; every image shows official icons; GIF under 5 MB; review by eye.
- [ ] **Step 5: Commit** `docs: README GIF and screenshots from a recorded generation`.

### Task 10: Pitch-first README, CHANGELOG and roadmap

**Files:**

- Modify: `README.md`, `CHANGELOG.md`, `docs/product/roadmap.md` (0.2 row status), `NOTICE` (AWS icon attribution: fetched at runtime, AWS terms quoted, not redistributed)

- [ ] **Step 1: README** in this order: one-line pitch (spec Intent), `demo.gif`, `Try the demo` and `Install` links (anchor `#install`), the one-command install, the icon note (spec Goal 1 wording), requirements (Docker; an Anthropic API key), privacy in one sentence (spec Goal 7), short "How it works", "What works today", "What's next" (link roadmap §2), badges kept, contributing/licence. Keep it short enough that install is visible on the first screen after the GIF.
- [ ] **Step 2: CHANGELOG** `## 0.2.0 — 2026-11-xx` with Added (icons, install, demo, PNG/SVG export), Removed (free credits, kill switch, Cloudflare), Upgrade note (old settings ignored; first start downloads icons).
- [ ] **Step 3: Verify** `pnpm format:check` PASS; all README links resolve (`grep -o '](\./[^)]*)' README.md` paths exist).
- [ ] **Step 4: Commit** `docs: pitch-first README and 0.2.0 changelog`.

### Task 11: Going public safely and launch drafts

**Files:**

- Create: `docs/launch/0.2/release-checklist.md`, `docs/launch/0.2/linkedin.md`, `docs/launch/0.2/devto.md`
- Modify: `.github/workflows/live-eval.yml` (only if Step 2 finds a problem)

- [ ] **Step 1: OWNER STOP** — ask to pull the official gitleaks image (`ghcr.io/gitleaks/gitleaks`, a v8 release at least two weeks old). Run `docker run --rm -v "$PWD:/repo" <image> git /repo --log-opts="--all"` (redact output: `--redact`). Also `git log --all --name-only --format= | sort -u | grep -iE '\.(zip|pem|key|p12|env)$|\.env'` prints nothing but `.env.example`. Record results (counts, no secret values) in the checklist; any finding stops the task and goes to the owner.
- [ ] **Step 2: Fork safety.** Confirm in `live-eval.yml` that a fork PR (no secrets) skips the paid job rather than failing: add `if: ... && github.event.pull_request.head.repo.full_name == github.repository` to the job if it is not already guarded; confirm no other workflow reads a secret on `pull_request`. Record the result.
- [ ] **Step 3: Release checklist** for the owner, in order: merge the PR; push tag `v0.2.0`; wait for Release images and the published-image smoke job; make the repository public; make both GHCR packages public; enable Pages (source: GitHub Actions) and run `pages.yml`; set description and topics `aws architecture diagram llm claude react-flow self-hosted` (`gh repo edit --description … --add-topic …`, command given); upload `docs/images/social-preview.png` in Settings; hand-test install on Windows 11 ARM; tick tested platforms; publish the GitHub release from the CHANGELOG.
- [ ] **Step 4: Launch drafts.** `linkedin.md` (≤ 1,300 characters, hook: describe your app, get an AWS architecture checked against 18 rules, on your own key; links to demo and repo) and `devto.md` ("How I stop an LLM from inventing cloud services": catalog enum, unresolved nodes, rule checks, eval numbers from `docs/product/phase2-gate-a.md`, with the GIF). Plain English, no claims beyond what 0.2 does.
- [ ] **Step 5: Commit** `docs: 0.2 release checklist and launch drafts`.
- [ ] **Step 6: OWNER STOP** — ask before pushing the branch and opening the PR.
