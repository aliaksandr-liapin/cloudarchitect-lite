# Threat Model

**Version:** 0.2 · **Date:** 2026-10-27 (rewritten for self-hosted only, ADR-0013; v0.1 was 2026-10-13) · **Method:** STRIDE per component · **Review:** before the public release

## Assets

| Asset                           | Why it matters                              |
| ------------------------------- | ------------------------------------------- |
| The user's AI provider key      | Direct financial loss if leaked             |
| AI spending limits              | Abuse drains money even without key leakage |
| User prompts and project graphs | May describe confidential systems           |
| Catalog integrity               | Wrong facts lead users to bad designs       |
| Icon pack compliance            | Legal exposure                              |

## Trust boundaries

1. Browser ↔ gateway (untrusted client).
2. Gateway ↔ AI provider (third party receives prompts).
3. CI/CD ↔ registries (supply chain).
4. Gateway ↔ aws.amazon.com (one-time icon pack download, verified by SHA-256).

## Threats and mitigations

| #   | Threat (STRIDE)                            | Mitigation                                                                                                                                                                                                                                       | Status                                          |
| --- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| T1  | Key exfiltration (I)                       | Key only in the gateway (data volume, mode 0600, or container env); never sent to the browser or in the bundle; gitleaks in CI                                                                                                                   | In place                                        |
| T2  | Runaway AI spend on the user's key (D)     | Daily/monthly spending limits; rate limits; ports bound to 127.0.0.1                                                                                                                                                                             | In place                                        |
| T4  | Oversized prompts to inflate cost (D)      | 256 KB body limit, 8 000-char prompt limit, token ceilings (planned with LLM adapter)                                                                                                                                                            | Partially in place                              |
| T5  | Prompt/graph leakage via logs (I)          | Logger receives metadata only; tested; IPs hashed with a secret salt                                                                                                                                                                             | In place                                        |
| T6  | Key theft via XSS (I)                      | Strict CSP (`script-src 'self'`), no third-party scripts, key never in the browser, React escaping, SVG sanitization for icons                                                                                                                   | CSP in place; SVG sanitization with icon import |
| T7  | Key leakage to third parties (I)           | No hosted service and no telemetry; the gateway sends the key only to the AI provider; CSP `connect-src 'self'`                                                                                                                                  | In place                                        |
| T14 | Tampered icon download (T)                 | Pack pinned by SHA-256 in `icon-packs.json`; unverified files never used; only mapped SVGs kept, each decompressed to at most 1 MiB and 8 MiB in total (a decompression bomb fails with `too_large`, no cache written); generic tiles on failure | With the icon fetch (release 0.2)               |
| T8  | Malicious AI output (T)                    | Schema parse, enum-constrained service IDs, validator, no HTML rendering of AI text                                                                                                                                                              | Schema + validator in place                     |
| T9  | Prompt injection steering Review/Ask (T)   | Advisory findings separated from rule findings; no tool execution; no autonomous changes                                                                                                                                                         | By design                                       |
| T10 | Tampered catalog or icons (T)              | Immutable catalog versions, evidence per entry, maintainer review, SHA-256 for icon packs                                                                                                                                                        | Process defined                                 |
| T11 | Compromised CI action or dependency (T, E) | SHA-pinned actions, Dependabot, dependency review, CodeQL, `pnpm audit`, Trivy, SBOM and provenance                                                                                                                                              | In place                                        |
| T12 | Clickjacking (T)                           | `frame-ancestors 'none'`                                                                                                                                                                                                                         | In place                                        |
| T13 | Gateway container escape (E)               | Non-root, read-only FS, `cap_drop: ALL`, `no-new-privileges`, resource limits                                                                                                                                                                    | In place (compose)                              |

## Privacy

- Prompts are sent to an AI provider only after explicit user action and a notice (NFR-001).
- Use provider settings that exclude training and minimize retention (NFR-010).
- No hosted service, accounts or telemetry: keys and projects stay on the user's machine, and prompts go only to the user's AI provider. A hosted-service Privacy Policy and Terms were dropped 2026-10-26.

## Open items

- Dropped 2026-10-26 with the hosted plan: BYOK proxy fallback threat model, Turnstile, quota-bypass penetration test.
- Scan the full git history for secrets before the repository goes public (release 0.2 design, Goal 8).
