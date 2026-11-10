import { describe, expect, it } from "vitest";
import type { Job, PrismaClient } from "@poolguard/db";
import { JobQueue } from "./queue.js";
import { RetryableJobError } from "./host.js";

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    kind: "RUN_AGENT",
    status: "RUNNING",
    taskId: "task-1",
    payload: {},
    priority: 0,
    attempts: 1,
    maxAttempts: 3,
    runAt: new Date(),
    leaseOwner: "worker-1",
    leaseExpiresAt: new Date(),
    heartbeatAt: new Date(),
    lastError: null,
    dedupeKey: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    finishedAt: null,
    ...overrides,
  } as Job;
}

function makeQueue() {
  const updates: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  let currentOwner: string | null = "worker-1";
  const prisma = {
    job: {
      updateMany: async (input: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        updates.push(input);
        const matches = input.where.leaseOwner === currentOwner && input.where.status === "RUNNING";
        return { count: matches ? 1 : 0 };
      },
    },
  } as unknown as PrismaClient;
  return {
    queue: new JobQueue(prisma, "worker-1", 90),
    updates,
    reclaimBy: (owner: string) => {
      currentOwner = owner;
    },
  };
}

describe("durable job retry policy", () => {
  it("requeues a retryable failure with bounded exponential backoff", async () => {
    const { queue, updates } = makeQueue();
    const before = Date.now();
    const outcome = await queue.fail(
      job({ attempts: 1, maxAttempts: 3 }),
      new RetryableJobError("chain is not ready", 2),
      true,
      2,
    );
    expect(outcome).toBe("retry");
    expect(updates).toHaveLength(1);
    expect(updates[0]!.data.status).toBe("QUEUED");
    expect(updates[0]!.data.leaseOwner).toBeNull();
    expect(updates[0]!.data.lastError).toBe("chain is not ready");
    expect((updates[0]!.data.runAt as Date).getTime()).toBeGreaterThanOrEqual(before + 2_000);
  });

  it("fails permanently once the lease/attempt budget is exhausted", async () => {
    const { queue, updates } = makeQueue();
    const outcome = await queue.fail(job({ attempts: 3, maxAttempts: 3 }), new Error("bad payload"), true);
    expect(outcome).toBe("failed");
    expect(updates[0]!.data.status).toBe("FAILED");
    expect(updates[0]!.data.finishedAt).toBeInstanceOf(Date);
  });

  it("does not retry a permanent validation error", async () => {
    const { queue, updates } = makeQueue();
    const outcome = await queue.fail(job({ attempts: 1, maxAttempts: 3 }), new Error("TASK_NOT_FOUND"), false);
    expect(outcome).toBe("failed");
    expect(updates[0]!.data.status).toBe("FAILED");
  });

  it("fences every write on the lease owner", async () => {
    const { queue, updates } = makeQueue();
    await queue.complete("job-1");
    expect(updates[0]!.where).toEqual({ id: "job-1", leaseOwner: "worker-1", status: "RUNNING" });
  });

  it("cannot complete, fail or extend a job another worker reclaimed", async () => {
    const { queue, updates, reclaimBy } = makeQueue();
    reclaimBy("worker-2");
    expect(await queue.complete("job-1")).toBe("lease_lost");
    expect(await queue.fail(job(), new Error("late"), true)).toBe("lease_lost");
    expect(await queue.fail(job({ attempts: 3 }), new Error("late"), false)).toBe("lease_lost");
    expect(await queue.heartbeat("job-1")).toBe(false);
    expect(updates.every((update) => update.where.leaseOwner === "worker-1")).toBe(true);
  });
});
