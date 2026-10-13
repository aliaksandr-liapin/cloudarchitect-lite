/**
 * Credit ledger and spend counters (PRD §6, NFR-009). The server is the authoritative ledger;
 * every mutation must be atomic in the production implementation.
 */
export interface CreditStore {
  /** Remaining free operations for an anonymous client key. */
  remaining(clientKey: string): Promise<number>;
  /** Atomically consumes one credit; returns false when none are left. */
  consume(clientKey: string): Promise<boolean>;
  /** Adds the cost (in micro-USD) of a completed operation to the daily and monthly counters. */
  addSpend(microUsd: number, now?: Date): Promise<void>;
  /** Current spend for the day and month containing `now`. */
  spend(now?: Date): Promise<{ dayMicroUsd: number; monthMicroUsd: number }>;
}

const day = (d: Date) => d.toISOString().slice(0, 10);
const month = (d: Date) => d.toISOString().slice(0, 7);

/** For local development and tests. Not shared across instances — never use in production. */
export class MemoryCreditStore implements CreditStore {
  private used = new Map<string, number>();
  private spendBy = new Map<string, number>();
  constructor(private readonly freeCredits: number) {}

  async remaining(clientKey: string) {
    return Math.max(0, this.freeCredits - (this.used.get(clientKey) ?? 0));
  }
  async consume(clientKey: string) {
    const used = this.used.get(clientKey) ?? 0;
    if (used >= this.freeCredits) return false;
    this.used.set(clientKey, used + 1);
    return true;
  }
  async addSpend(microUsd: number, now = new Date()) {
    for (const k of [day(now), month(now)])
      this.spendBy.set(k, (this.spendBy.get(k) ?? 0) + microUsd);
  }
  async spend(now = new Date()) {
    return {
      dayMicroUsd: this.spendBy.get(day(now)) ?? 0,
      monthMicroUsd: this.spendBy.get(month(now)) ?? 0,
    };
  }
}

/** Cloudflare D1 implementation; schema in `migrations/0001_init.sql`. */
export class D1CreditStore implements CreditStore {
  constructor(
    private readonly db: D1Database,
    private readonly freeCredits: number,
  ) {}

  async remaining(clientKey: string) {
    const row = await this.db
      .prepare('SELECT used FROM credits WHERE client_key = ?')
      .bind(clientKey)
      .first<{ used: number }>();
    return Math.max(0, this.freeCredits - (row?.used ?? 0));
  }
  async consume(clientKey: string) {
    // Single statement: insert-or-increment guarded by the limit, so concurrent requests cannot overdraw.
    const res = await this.db
      .prepare(
        `INSERT INTO credits (client_key, used, updated_at) VALUES (?1, 1, unixepoch())
         ON CONFLICT(client_key) DO UPDATE SET used = used + 1, updated_at = unixepoch()
         WHERE used < ?2`,
      )
      .bind(clientKey, this.freeCredits)
      .run();
    return (res.meta.changes ?? 0) > 0;
  }
  async addSpend(microUsd: number, now = new Date()) {
    const stmt = this.db.prepare(
      `INSERT INTO spend (period, micro_usd) VALUES (?1, ?2)
       ON CONFLICT(period) DO UPDATE SET micro_usd = micro_usd + ?2`,
    );
    await this.db.batch([
      stmt.bind(`d:${day(now)}`, microUsd),
      stmt.bind(`m:${month(now)}`, microUsd),
    ]);
  }
  async spend(now = new Date()) {
    const rows = await this.db
      .prepare('SELECT period, micro_usd FROM spend WHERE period IN (?1, ?2)')
      .bind(`d:${day(now)}`, `m:${month(now)}`)
      .all<{ period: string; micro_usd: number }>();
    const get = (p: string) => rows.results.find((r) => r.period === p)?.micro_usd ?? 0;
    return { dayMicroUsd: get(`d:${day(now)}`), monthMicroUsd: get(`m:${month(now)}`) };
  }
}
