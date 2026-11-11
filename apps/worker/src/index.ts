import { loadRootEnv } from "./env.js";
import { createPrismaClient, type Job } from "@poolguard/db";
import { NearChain, signerMap, custodyMap } from "@poolguard/agent-runtime";
import { loadWorkerConfig } from "./config.js";
import { JobQueue } from "./queue.js";
import { handleRecoverOperationJob, handleRunAgentJob, type WorkerDeps } from "./run-job.js";
import { PermanentJobError, RetryableJobError } from "./host.js";

function log(fields: Record<string, unknown>) {
  console.log(JSON.stringify({ level: "info", ts: new Date().toISOString(), ...fields }));
}

async function main() {
  loadRootEnv();
  const config = loadWorkerConfig();
  const prisma = createPrismaClient();
  const chain = new NearChain({
    network: config.nearNetwork,
    rpcUrl: config.nearRpcUrl,
    contractId: config.contractId,
    signers: signerMap(config),
    custody: custodyMap(config),
    // Custody transactions get their real hash only after OutLayer broadcasts.
    onTxHashResolved: async (placeholder, txHash) => {
      await prisma.chainTransaction.updateMany({ where: { txHash: placeholder }, data: { txHash } });
    },
  });
  const deps: WorkerDeps = { prisma, chain, config };
  const queue = new JobQueue(prisma, config.workerId, config.jobLeaseSeconds);
  let running = true;
  let active = 0;

  const reaped = await queue.reap();
  log({
    msg: "PoolGuard worker started",
    workerId: config.workerId,
    concurrency: config.workerConcurrency,
    network: config.nearNetwork,
    contractId: config.contractId,
    reclaimedJobs: reaped.reclaimed,
    deadJobs: reaped.dead,
    aiConfigured: Boolean(config.aiApiKey),
  });

  const shutdown = (signal: string) => {
    if (!running) return;
    running = false;
    log({ msg: "graceful shutdown requested", signal, activeJobs: active });
    const started = Date.now();
    const timer = setInterval(() => {
      if (active === 0 || Date.now() - started > 25_000) {
        clearInterval(timer);
        void prisma.$disconnect().finally(() => process.exit(0));
      }
    }, 200);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("unhandledRejection", (reason) => {
    log({ level: "error", msg: "unhandled rejection", error: String(reason) });
  });

  async function execute(job: Job): Promise<void> {
    let leaseLostLogged = false;
    const heartbeat = setInterval(() => {
      void queue
        .heartbeat(job.id)
        .then((held) => {
          if (!held && !leaseLostLogged) {
            leaseLostLogged = true;
            log({ level: "warn", msg: "job lease lost; another worker may own this job", jobId: job.id });
          }
        })
        .catch(() => undefined);
    }, Math.max(2_000, Math.floor((config.jobLeaseSeconds * 1000) / 3)));
    try {
      switch (job.kind) {
        case "RUN_AGENT":
          await handleRunAgentJob(deps, job);
          break;
        case "RECOVER_OPERATION":
          await handleRecoverOperationJob(deps, job);
          break;
        case "SYNC_TASK":
          log({ msg: "sync job acknowledged", jobId: job.id });
          break;
        default:
          throw new PermanentJobError(`Unsupported job kind ${job.kind}`);
      }
      const completed = await queue.complete(job.id);
      if (completed === "lease_lost") {
        log({ level: "warn", msg: "job finished after its lease was lost; status left to the current owner", jobId: job.id });
      } else {
        log({ msg: "job succeeded", jobId: job.id, kind: job.kind, attempts: job.attempts });
      }
    } catch (error) {
      const retryable = error instanceof RetryableJobError;
      const delay = error instanceof RetryableJobError ? error.delaySeconds : 0;
      const outcome = await queue.fail(job, error, retryable, delay);
      log({
        level: outcome === "failed" ? "error" : "warn",
        msg:
          outcome === "retry"
            ? "job scheduled for retry"
            : outcome === "lease_lost"
              ? "job failed after its lease was lost; status left to the current owner"
              : "job failed permanently",
        jobId: job.id,
        kind: job.kind,
        attempts: job.attempts,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      clearInterval(heartbeat);
    }
  }

  async function slot(slotIndex: number): Promise<void> {
    while (running) {
      let job: Job | null = null;
      try {
        job = await queue.claim();
      } catch (error) {
        log({
          level: "error",
          msg: "job claim failed",
          slot: slotIndex,
          error: error instanceof Error ? error.message : String(error),
        });
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        continue;
      }
      if (!job) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        continue;
      }
      active += 1;
      try {
        await execute(job);
      } finally {
        active -= 1;
      }
    }
  }

  // Liveness for the status page, admin dashboard and stale-worker alert.
  const startedAt = new Date();
  const beat = () =>
    void prisma.workerHeartbeat
      .upsert({
        where: { workerId: config.workerId },
        update: { lastSeenAt: new Date(), activeJobs: active },
        create: { workerId: config.workerId, startedAt, lastSeenAt: new Date(), activeJobs: active },
      })
      .catch(() => undefined);
  beat();
  const heartbeatTimer = setInterval(beat, 20_000);
  heartbeatTimer.unref();

  // Periodically reap leases left behind by a crashed sibling process.
  const reaper = setInterval(() => {
    void queue.reap().catch(() => undefined);
  }, 15_000);
  reaper.unref();

  await Promise.all(
    Array.from({ length: config.workerConcurrency }, (_, index) => slot(index)),
  );
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      level: "fatal",
      msg: "PoolGuard worker failed to start",
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
});
