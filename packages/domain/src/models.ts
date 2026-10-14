/**
 * AI model policy (ADR-0011), shared by the gateway (free tier) and the web client (BYOK).
 * Chosen from the Phase 0 spike and blind review; change only with a new eval run and review.
 */
export const MODEL_POLICY = {
  /** Free credits: economical model plus one validator-driven repair turn. */
  freeTier: { provider: 'anthropic', model: 'claude-haiku-5-5', repairTurns: 1 },
  /** Default suggested to users who bring their own Anthropic key. */
  byokDefault: { provider: 'anthropic', model: 'claude-sonnet-5-5', repairTurns: 0 },
} as const;
