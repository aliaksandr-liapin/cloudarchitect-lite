/**
 * Spend counters behind the daily and monthly limits (NFR-009). Every mutation must be atomic in a
 * production implementation.
 */
export interface SpendStore {
  /** Adds the cost (in micro-USD) of a completed operation to the daily and monthly counters. */
  addSpend(microUsd: number, now?: Date): Promise<void>;
  /** Current spend for the day and month containing `now`. */
  spend(now?: Date): Promise<{ dayMicroUsd: number; monthMicroUsd: number }>;
}

const day = (d: Date) => d.toISOString().slice(0, 10);
const month = (d: Date) => d.toISOString().slice(0, 7);

/** In-process counters. Not shared across instances: run a single gateway replica. */
export class MemorySpendStore implements SpendStore {
  private spendBy = new Map<string, number>();

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
