# Runbook

## Free AI costs are spiking

1. Check spend: `wrangler d1 execute cloudarchitect --remote --command "SELECT * FROM spend ORDER BY period DESC LIMIT 5"`.
2. Disable free AI immediately: set `FREE_AI_DISABLED = "true"` in the environment vars and redeploy (`wrangler deploy --env production`). Manual mode and BYOK keep working.
3. Look for abuse patterns in logs (429 rates, request bursts). Lower `RATE_LIMIT_PER_MINUTE` or the budget caps if needed.

## Gateway errors (5xx)

1. Check Workers logs for `level: error` with request IDs.
2. Roll back: `wrangler rollback` or redeploy the previous tag.
3. The editor is unaffected; only AI features degrade.

## Suspected key leak

1. Rotate the provider key at the provider, then `wrangler secret put <NAME>` per environment.
2. Rotate `CLIENT_KEY_SALT` only if the salt leaked (this resets per-client credit counts).
3. Review CI secret-scan results and git history.

## Catalog problem (wrong fact or broken icon)

1. Mark the entry `needs_review` and set lifecycle to `unknown`; publish a new catalog version.
2. Existing projects keep their snapshot; users see the update via "Review updates".
