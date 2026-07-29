/**
 * Tiny in-process idempotency cache. Production should use Redis with
 * a TTL; this is a safe fallback used by tests and dev.
 */
export class IdempotencyCache {
  private readonly seen = new Set<string>();
  private readonly ttlMs: number;

  constructor(ttlMs = 10 * 60 * 1000) {
    this.ttlMs = ttlMs;
    if (ttlMs > 0) {
      setInterval(() => this.seen.clear(), ttlMs).unref?.();
    }
  }

  remember(key: string): boolean {
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    return true;
  }

  clear(): void {
    this.seen.clear();
  }
}
