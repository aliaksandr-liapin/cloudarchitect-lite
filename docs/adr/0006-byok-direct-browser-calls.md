# ADR-0006: BYOK via direct browser calls

**Status:** Accepted (threat model pending) · **Date:** 2026-10-13

**Context.** Routing user keys through our proxy creates liability and erodes trust.

**Decision.** For providers that officially support browser access (Anthropic, OpenAI at time of writing), the browser calls the provider directly; the key is held in memory by default. An ephemeral proxy is the fallback for other providers.

**Consequences.** Prompt templates and validation run client-side. CSP `connect-src` must list the provider hosts. Provider policy changes are handled by a per-adapter capability flag.
