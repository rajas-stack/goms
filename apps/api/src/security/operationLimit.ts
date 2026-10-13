/** Bounded, per-instance operation budgets complement the HTTP request limiter. */
export class OperationBudget {
  private readonly entries = new Map<string, { count: number; until: number }>()
  constructor(private readonly max = 1200, private readonly windowMs = 300000, private readonly capacity = 10000) {}
  consume(key: string, cost = 1, now = Date.now()): boolean {
    if (!Number.isSafeInteger(cost) || cost < 1 || cost > this.max) return false
    let entry = this.entries.get(key)
    if (entry && entry.until <= now) { this.entries.delete(key); entry = undefined }
    if (!entry) {
      if (this.entries.size >= this.capacity) for (const [id, value] of this.entries) if (value.until <= now) this.entries.delete(id)
      if (this.entries.size >= this.capacity) return false
      entry = { count: 0, until: now + this.windowMs }; this.entries.set(key, entry)
    }
    if (entry.count + cost > this.max) return false
    entry.count += cost; return true
  }
}
export const userOperationBudget = new OperationBudget()
