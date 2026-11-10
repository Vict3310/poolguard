import type { Job, PrismaClient } from "@poolguard/db";

/**
 * PostgreSQL-backed queue with transactional claiming, leases and bounded retries.
 * The claim uses FOR UPDATE SKIP LOCKED so several worker processes never execute
 * the same job at once. A crashed process's lease is reaped and the job re-queued;
 * handlers are written to be re-runnable safely.
 *
 * Every write after the claim is fenced on `leaseOwner` and `RUNNING`: once a lease
 * has expired and another worker has reclaimed the job, the original worker can no
 * longer complete, fail or extend it.
 */
export type FencedOutcome<T extends string> = T | "lease_lost";

export class JobQueue {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly workerId: string,
    private readonly leaseSeconds: number,
  ) {}

  /**
   * Return expired leases to the queue, then dead-letter exhausted retries.
   * `attempts` is not incremented here: the claim already counted this run.
   */
  async reap(): Promise<{ reclaimed: number; dead: number }> {
    const reclaimed = await this.prisma.$executeRaw`
      UPDATE "Job"
      SET status = 'QUEUED',
          "leaseOwner" = NULL,
          "leaseExpiresAt" = NULL,
          "runAt" = now(),
          "lastError" = COALESCE("lastError", 'LEASE_EXPIRED')
      WHERE status = 'RUNNING' AND "leaseExpiresAt" < now()
    `;
    const dead = await this.prisma.$executeRaw`
      UPDATE "Job"
      SET status = 'DEAD', "finishedAt" = now(),
          "lastError" = COALESCE("lastError", 'RETRY_EXHAUSTED')
      WHERE status = 'QUEUED' AND attempts >= "maxAttempts" AND "leaseOwner" IS NULL
    `;
    return { reclaimed, dead };
  }

  /** Claim one runnable job, or null. Attempts increments exactly once per run. */
  async claim(): Promise<Job | null> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        WITH candidate AS (
          SELECT id FROM "Job"
          WHERE status = 'QUEUED' AND "runAt" <= now()
          ORDER BY priority DESC, "runAt" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE "Job" j
        SET status = 'RUNNING',
            "leaseOwner" = ${this.workerId},
            "leaseExpiresAt" = now() + make_interval(secs => ${this.leaseSeconds}),
            "heartbeatAt" = now(),
            attempts = j.attempts + 1
        FROM candidate
        WHERE j.id = candidate.id
        RETURNING j.id
      `;
      const claimed = rows[0];
      if (!claimed) return null;
      return tx.job.findUnique({ where: { id: claimed.id } });
    });
  }

  /** Extends the lease. Returns false when this worker no longer holds it. */
  async heartbeat(jobId: string): Promise<boolean> {
    const result = await this.prisma.job.updateMany({
      where: { id: jobId, leaseOwner: this.workerId, status: "RUNNING" },
      data: {
        heartbeatAt: new Date(),
        leaseExpiresAt: new Date(Date.now() + this.leaseSeconds * 1000),
      },
    });
    return result.count === 1;
  }

  private fenced(jobId: string) {
    return { id: jobId, leaseOwner: this.workerId, status: "RUNNING" as const };
  }

  async complete(jobId: string): Promise<FencedOutcome<"succeeded">> {
    const result = await this.prisma.job.updateMany({
      where: this.fenced(jobId),
      data: {
        status: "SUCCEEDED",
        leaseOwner: null,
        leaseExpiresAt: null,
        finishedAt: new Date(),
        lastError: null,
      },
    });
    return result.count === 1 ? "succeeded" : "lease_lost";
  }

  /**
   * Retry with bounded exponential backoff, or fail permanently. `attempts` was
   * already incremented by the claim, so attempts === 1 on the first failure.
   */
  async fail(
    job: Job,
    error: unknown,
    retryable: boolean,
    delaySeconds = 0,
  ): Promise<FencedOutcome<"retry" | "failed">> {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 800);
    if (retryable && job.attempts < job.maxAttempts) {
      const backoff = Math.min(500 * 2 ** Math.max(0, job.attempts - 1), 30_000);
      const runAt = new Date(Date.now() + Math.max(backoff, delaySeconds * 1000));
      const result = await this.prisma.job.updateMany({
        where: this.fenced(job.id),
        data: {
          status: "QUEUED",
          leaseOwner: null,
          leaseExpiresAt: null,
          runAt,
          lastError: message,
        },
      });
      return result.count === 1 ? "retry" : "lease_lost";
    }
    const result = await this.prisma.job.updateMany({
      where: this.fenced(job.id),
      data: {
        status: "FAILED",
        leaseOwner: null,
        leaseExpiresAt: null,
        finishedAt: new Date(),
        lastError: message,
      },
    });
    return result.count === 1 ? "failed" : "lease_lost";
  }

  async release(jobId: string): Promise<void> {
    await this.prisma.job.updateMany({
      where: { id: jobId, leaseOwner: this.workerId },
      data: { status: "QUEUED", leaseOwner: null, leaseExpiresAt: null },
    });
  }
}
