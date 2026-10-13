# ADR-0004: Cloudflare Workers + D1 for the gateway

**Status:** Proposed — validate during PoC · **Date:** 2026-10-13

**Context.** The gateway is small, stateless apart from the credit ledger, and must scale to bursts cheaply.

**Decision.** Deploy the gateway to Cloudflare Workers with D1 as the transactional ledger; serve the web app from Cloudflare Pages.

**Consequences.** Near-zero idle cost and global edge. D1 single-writer limits apply (see `docs/operations/scalability.md`). ADR-0010 keeps the gateway portable to Node containers if this is revisited.
