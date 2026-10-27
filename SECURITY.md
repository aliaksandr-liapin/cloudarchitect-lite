# Security Policy

## Reporting a vulnerability

Report vulnerabilities privately through [GitHub Security Advisories](https://github.com/aliaksandr-liapin/cloudarchitect-lite/security/advisories/new). Do not open a public issue.

Include the affected component (web, gateway, catalog), steps to reproduce, and impact. We aim to acknowledge reports within 3 business days.

## Supported versions

Only the latest `main` and the latest release are supported during pre-1.0 development.

## Security principles

- **Self-hosted only.** There is no hosted service, no accounts and no telemetry. Your AI key lives only in your own gateway (a data volume with mode 0600, or the container environment), is never sent to the browser, and prompts go only to your AI provider.
- **No private content in logs.** The gateway logs request metadata only — never prompts, project graphs, keys or raw IP addresses (client keys are salted hashes). This is covered by tests.
- **Budget protection.** AI use is bounded by daily and monthly spending limits you set, plus rate limits.
- **Untrusted AI output.** Every AI response is schema-parsed and validated before rendering; catalog IDs are constrained.
- **Supply chain.** Pinned GitHub Actions (commit SHAs), Dependabot, dependency review, CodeQL, `pnpm audit`, gitleaks, Trivy image scans, SBOM and build provenance on released images.
- **Hardened runtime.** Non-root containers, read-only filesystems, dropped capabilities, strict CSP and security headers.

See [docs/security/threat-model.md](docs/security/threat-model.md) for the full threat model.
