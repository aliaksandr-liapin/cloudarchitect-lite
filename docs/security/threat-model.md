# Threat Model

**Version:** 0.1 · **Date:** 2026-10-13 · **Method:** STRIDE per component · **Review:** before private beta (ROADMAP Gate B)

## Assets

| Asset                           | Why it matters                              |
| ------------------------------- | ------------------------------------------- |
| Owner AI provider keys          | Direct financial loss if leaked             |
| AI budget                       | Abuse drains money even without key leakage |
| User BYOK keys                  | User's money and trust                      |
| User prompts and project graphs | May describe confidential systems           |
| Catalog integrity               | Wrong facts lead users to bad designs       |
| Icon pack compliance            | Legal exposure                              |

## Trust boundaries

1. Browser ↔ gateway (untrusted client).
2. Gateway ↔ AI provider (third party receives prompts).
3. Browser ↔ AI provider directly (BYOK).
4. CI/CD ↔ registries and Cloudflare (supply chain).

## Threats and mitigations

| #   | Threat (STRIDE)                            | Mitigation                                                                                                                     | Status                                          |
| --- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| T1  | Owner key exfiltration (I)                 | Keys only in Workers secrets / container env; never in bundle; gitleaks in CI                                                  | In place                                        |
| T2  | Free-credit farming via IP rotation (S, D) | Global daily/monthly budget cap + kill switch; rate limits; Turnstile (planned)                                                | Cap and limits in place; Turnstile planned      |
| T3  | Concurrent requests overdraw credits (T)   | Single-statement guarded increment in D1                                                                                       | In place                                        |
| T4  | Oversized prompts to inflate cost (D)      | 256 KB body limit, 8 000-char prompt limit, token ceilings (planned with LLM adapter)                                          | Partially in place                              |
| T5  | Prompt/graph leakage via logs (I)          | Logger receives metadata only; tested; IPs hashed with a secret salt                                                           | In place                                        |
| T6  | BYOK key theft via XSS (I)                 | Strict CSP (`script-src 'self'`), no third-party scripts, key in memory by default, React escaping, SVG sanitization for icons | CSP in place; SVG sanitization with icon import |
| T7  | BYOK key leakage through our servers (I)   | Direct browser calls; proxy fallback stores nothing                                                                            | Design accepted; implementation Phase 3         |
| T8  | Malicious AI output (T)                    | Schema parse, enum-constrained service IDs, validator, no HTML rendering of AI text                                            | Schema + validator in place                     |
| T9  | Prompt injection steering Review/Ask (T)   | Advisory findings separated from rule findings; no tool execution; no autonomous changes                                       | By design                                       |
| T10 | Tampered catalog or icons (T)              | Immutable catalog versions, evidence per entry, maintainer review, SHA-256 for icon packs                                      | Process defined                                 |
| T11 | Compromised CI action or dependency (T, E) | SHA-pinned actions, Dependabot, dependency review, CodeQL, `pnpm audit`, Trivy, SBOM and provenance                            | In place                                        |
| T12 | Clickjacking (T)                           | `frame-ancestors 'none'`                                                                                                       | In place                                        |
| T13 | Gateway container escape (E)               | Non-root, read-only FS, `cap_drop: ALL`, `no-new-privileges`, resource limits                                                  | In place (compose)                              |

## Privacy

- Prompts are sent to an AI provider only after explicit user action and a notice (NFR-001).
- Use provider settings that exclude training and minimize retention (NFR-010).
- Privacy Policy and Terms of Use are required before public beta.

## Open items

- Written threat model for the BYOK proxy fallback.
- Turnstile integration and its privacy notice.
- Penetration test of quota/budget bypass before private beta.
