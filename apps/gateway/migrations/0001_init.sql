-- Credit ledger: one row per anonymous client key (salted hash, never a raw IP).
CREATE TABLE IF NOT EXISTS credits (
  client_key TEXT PRIMARY KEY,
  used INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0),
  updated_at INTEGER NOT NULL
);

-- Spend counters for the budget cap: period is 'd:YYYY-MM-DD' or 'm:YYYY-MM'.
CREATE TABLE IF NOT EXISTS spend (
  period TEXT PRIMARY KEY,
  micro_usd INTEGER NOT NULL DEFAULT 0 CHECK (micro_usd >= 0)
);
