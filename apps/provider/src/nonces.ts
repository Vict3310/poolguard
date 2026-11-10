/**
 * Single-use cache for signed request nonces.
 *
 * A signed buyer authorization is valid for a short window. Without this cache the
 * same signed request could be replayed any number of times inside that window.
 * Entries are kept until the authorization itself would be stale, so memory stays
 * bounded by request rate × window. The cache is per process; a multi-instance
 * provider would need a shared store (for example a unique database row).
 */
export class NonceCache {
  private readonly entries = new Map<string, number>();

  constructor(
    private readonly maxEntries = 100_000,
    private readonly clock: () => number = Date.now,
  ) {}

  /**
   * Records `key` until `expiresAtMs`. Returns false if it was already used, or if
   * the cache is full of live entries (fail closed rather than forget a nonce).
   */
  claim(key: string, expiresAtMs: number): boolean {
    const now = this.clock();
    const existing = this.entries.get(key);
    if (existing !== undefined && existing > now) return false;
    if (this.entries.size >= this.maxEntries) {
      this.sweep(now);
      if (this.entries.size >= this.maxEntries) return false;
    }
    this.entries.set(key, expiresAtMs);
    return true;
  }

  get size(): number {
    return this.entries.size;
  }

  private sweep(now: number) {
    for (const [key, expiresAt] of this.entries) {
      if (expiresAt <= now) this.entries.delete(key);
    }
  }
}
