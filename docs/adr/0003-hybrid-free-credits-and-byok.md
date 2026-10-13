# ADR-0003: Hybrid free credits + BYOK

**Status:** Accepted (limit adjustable) · **Date:** 2026-10-13

**Context.** Users should try AI without signing up; the owner's AI spend must stay bounded.

**Decision.** Three free operations per anonymous client (1 credit = 1 user operation), enforced by a server-side ledger, with a global daily/monthly budget cap and kill switch as the hard limit. After that, BYOK or manual mode.

**Consequences.** Without accounts, per-user limits are best-effort; the budget cap is what protects cost. The limit is re-tuned after Phase 0 cost measurement.
