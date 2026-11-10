/**
 * In-process concurrency and quota helpers for the API.
 *
 * Both are scoped to one API process. A horizontally scaled deployment needs a
 * shared store (for example PostgreSQL advisory locks and a counter table); the
 * hackathon deployment runs a single API instance.
 */

/** Runs callbacks that share a key one at a time, in arrival order. */
export class KeyedLock {
  private readonly tails = new Map<string, Promise<unknown>>();

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(fn);
    const tail = current.catch(() => undefined);
    this.tails.set(key, tail);
    try {
      return await current;
    } finally {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }

  get size(): number {
    return this.tails.size;
  }
}

/**
 * Sliding-window counter per account. Worker accounts are shared by every task,
 * so any signed-in account that triggers worker transactions spends the workers'
 * gas allowance. This bounds how much one account can spend per window.
 */
export class AccountQuota {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly clock: () => number = Date.now,
  ) {}

  /** Records one action and returns whether it is within quota. */
  consume(accountId: string): { ok: true } | { ok: false; retryAfterSeconds: number } {
    const now = this.clock();
    const cutoff = now - this.windowMs;
    const recent = (this.hits.get(accountId) ?? []).filter((at) => at > cutoff);
    if (recent.length >= this.limit) {
      this.hits.set(accountId, recent);
      const retryAfterMs = recent[0]! + this.windowMs - now;
      return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
    }
    recent.push(now);
    this.hits.set(accountId, recent);
    if (this.hits.size > 10_000) this.prune(cutoff);
    return { ok: true };
  }

  private prune(cutoff: number) {
    for (const [account, times] of this.hits) {
      if (!times.some((at) => at > cutoff)) this.hits.delete(account);
    }
  }
}

/** Parses a comma-separated account allowlist. An empty list allows every account. */
export function parseAccountAllowlist(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}
