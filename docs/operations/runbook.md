# Runbook

For people who run their own instance. The gateway logs go to `docker compose logs gateway`.

## AI spend is higher than expected

1. Check the spending limits in the setup wizard (or `DAILY_BUDGET_MICRO_USD` and `MONTHLY_BUDGET_MICRO_USD`). When a limit is reached, AI routes return `ai_unavailable` until the period rolls over; manual editing keeps working.
2. Lower the limits, or `RATE_LIMIT_PER_MINUTE`, and restart the gateway if they are set in the environment.
3. Set a monthly limit at the provider as well, and check usage in the provider's console.

## Gateway errors (5xx)

1. Check `docker compose logs gateway` for `level: error` with request IDs.
2. Roll back by starting the previous image tag.
3. The editor is unaffected; only AI features degrade.

## Suspected key leak

1. Rotate the key at the provider, then enter the new one (re-run setup with `node node.js reset-setup` in the gateway container, or update the environment variable).
2. Review CI secret-scan results and git history if the key was ever committed.

## Catalog problem (wrong fact or broken icon)

1. Mark the entry `needs_review` and set lifecycle to `unknown`; publish a new catalog version.
2. Existing projects keep their snapshot; users see the update via "Review updates".
