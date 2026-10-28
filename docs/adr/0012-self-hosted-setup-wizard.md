# ADR-0012: Browser setup wizard for self-hosted installs

**Status:** Accepted · **Date:** 2026-10-14

**Context.** The project is meant to be installed by anyone with Docker on Windows, macOS or Linux. Editing `.env` files by hand is error-prone (wrong keys, unknown budget values) and differs per platform. (A hosted Cloudflare deployment, dropped 2026-10-26, would have been configured by its operator; self-hosted is now the only mode, [ADR-0013](0013-self-hosted-only.md).)

**Decision.**

- `docker compose up` is the only install command. The gateway starts unconfigured, generates the client salt, and prints a setup link with a one-time code to its log.
- A five-step wizard at `/setup` covers: code, API key (checked against Anthropic before saving), models (with the measured benchmark from ADR-0011), limits (with a budget estimate), review.
- Settings are saved to `/data/settings.json` on a named volume (atomic write, mode 0600) and applied without a restart. Environment variables always override saved settings; the wizard shows which ones are locked.
- `SETUP_WIZARD=disabled` turns the wizard off; configuration then comes from environment variables only. (The Workers runtime was dropped 2026-10-26; it returned 404 for `/api/setup/*`.)
- Ports bind to `127.0.0.1`; nginx proxies `/api`, so the gateway port is not published.

**Consequences.**

- The API key rests on the host's Docker volume. That is acceptable for a single-user, local install and is documented; shared servers should inject the key from a secret store via the environment.
- The setup code changes on every restart, so a lost link is recovered from the log.
- Re-running setup is an explicit command (`node node.js reset-setup`), so a configured instance cannot be reconfigured from the browser.
