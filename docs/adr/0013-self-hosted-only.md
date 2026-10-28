# ADR-0013: Self-hosted only

**Status:** Accepted · **Date:** 2026-10-26 (recorded 2026-10-27) · **Supersedes:** ADR-0003, ADR-0004, ADR-0006

**Context.** On 2026-10-26 the product owner re-scoped the project: CloudArchitect Lite is a free, open-source tool that each user runs on their own machine with their own AI key, and a public showcase of the maintainer's work (roadmap §2). A hosted service would cost the maintainer money, need abuse controls, quota accounting without accounts, a Privacy Policy and Terms, and operations work, none of which serves that goal. ADR-0003 (free credits), ADR-0004 (Cloudflare Workers and D1) and ADR-0006 (direct browser calls with the user's key) were written for the hosted plan.

**Decision.**

- The Node gateway in Docker is the only runtime. `docker compose up` (ADR-0012) is the install.
- Every AI call is made by the gateway with the key of the person who runs it. The key is entered in the setup wizard or set in the environment, rests on the host's Docker volume, and is never sent to the browser.
- The daily and monthly spending limits stay: they protect the user's own key. When a limit is reached, AI routes return `ai_unavailable`; when no key is configured, they return `setup_required`. Manual editing, validation and export never depend on either.
- Removed: free credits and the credit ledger, the manual kill switch, the Cloudflare Workers entry, the D1 store, `wrangler.toml` and the Cloudflare deploy workflow, direct browser calls to AI providers (and with them the provider hosts in the CSP `connect-src`, which is now `'self'`).
- The public demo is a static GitHub Pages site with no AI.
- Official AWS icons are not committed or shipped in images. The gateway downloads the pinned pack on first start (design: `docs/superpowers/specs/2026-10-27-public-mvp-design.md`, Goal 1).

**Consequences.**

- Nothing costs the maintainer to run, and there is no hosted service whose abuse, privacy or availability needs managing. Keys and projects stay on the user's machine; prompts go only to the user's AI provider.
- The gateway needs no shared store: a single replica with in-memory counters is enough for one user or a small team. Scaling out is not a goal.
- ADR-0010 keeps the portable-gateway design, but the Workers target is gone. `MODEL_POLICY.freeTierModels` became `defaultEnabledModels`.
- The Phase 0–2 measurements that used the "free tier" wording stay as dated history.
