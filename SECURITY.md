# Security Policy

## Reporting a vulnerability

Report vulnerabilities privately through [GitHub Security Advisories](https://github.com/aliaksandr-liapin/cloudarchitect-lite/security/advisories/new). Do not open a public issue.

Include the affected component (web, gateway, catalog), steps to reproduce, and impact. We aim to acknowledge reports within 3 business days.

## Supported versions

Only the latest `main` and the latest release are supported during pre-1.0 development.

## Security principles

- **No owner secrets in the browser.** Provider keys for the free tier live only in the gateway (Workers secrets or container env).
- **BYOK keys never reach our servers** in direct-browser mode and are held in memory only by default.
- **No private content in logs.** The gateway logs request metadata only — never prompts, project graphs, keys or raw IP addresses (client keys are salted hashes). This is covered by tests.
- **Budget protection.** Free AI is bounded by daily and monthly spend caps with an automatic kill switch, plus per-client rate limits.
- **Untrusted AI output.** Every AI response is schema-parsed and validated before rendering; catalog IDs are constrained.
- **Supply chain.** Pinned GitHub Actions (commit SHAs), Dependabot, dependency review, CodeQL, `pnpm audit`, gitleaks, Trivy image scans, SBOM and build provenance on released images.
- **Hardened runtime.** Non-root containers, read-only filesystems, dropped capabilities, strict CSP and security headers.

See [docs/security/threat-model.md](docs/security/threat-model.md) for the full threat model.
