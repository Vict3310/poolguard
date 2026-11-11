import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { recordAudit } from "../audit.js";
import { overallStatus } from "../health.js";
import type { SessionInfo } from "../app.js";
import { deleteAccountData } from "./account.js";
import type { RouteContext } from "./context.js";

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) + BigInt(byte);
  let out = "";
  while (value > 0n) {
    out = BASE58[Number(value % 58n)] + out;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = `1${out}`;
  }
  return out;
}

const YOCTO_PER_NEAR = 10n ** 24n;
const LOW_BALANCE_YOCTO = 10n ** 23n; // 0.1 NEAR
const sum = (values: string[]) => values.reduce((total, value) => total + BigInt(value || "0"), 0n).toString();

function nearString(yocto: bigint): string {
  const whole = yocto / YOCTO_PER_NEAR;
  const fraction = (yocto % YOCTO_PER_NEAR).toString().padStart(24, "0").slice(0, 4).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

/** Locate the built WASM for the contract hash check (API may run from apps/api). */
function localWasmHash(): string | null {
  const candidates = [
    process.env.POOLGUARD_WASM_PATH,
    resolve(process.cwd(), "contracts/poolguard/res/poolguard.wasm"),
    resolve(process.cwd(), "../../contracts/poolguard/res/poolguard.wasm"),
  ].filter((path): path is string => Boolean(path));
  for (const path of candidates) {
    if (existsSync(path)) return base58(createHash("sha256").update(readFileSync(path)).digest());
  }
  return null;
}

export function registerAdminRoutes(app: FastifyInstance, ctx: RouteContext) {
  const { prisma, config } = ctx;

  async function rpc<T>(params: Record<string, unknown>): Promise<T> {
    const response = await fetch(config.nearRpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "admin", method: "query", params: { finality: "final", ...params } }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await response.json()) as { result?: T; error?: { cause?: { name?: string }; message?: string } };
    if (body.error) throw new Error(body.error.cause?.name ?? body.error.message ?? "RPC error");
    return body.result as T;
  }

  /** Admin gate. Reads need ADMIN_ACCOUNTS; writes also need ADMIN_OPERATOR_ACCOUNTS and CSRF. */
  async function requireAdmin(
    request: FastifyRequest,
    reply: FastifyReply,
    mode: "read" | "write" = "read",
  ): Promise<SessionInfo | null> {
    const session = await ctx.requireSession(request, reply);
    if (!session) return null;
    if (!ctx.isAdmin(session.accountId)) {
      reply.code(404).send({ error: "Not found", code: "NOT_FOUND" });
      return null;
    }
    if (mode === "write") {
      if (!ctx.isOperator(session.accountId)) {
        reply.code(403).send({ error: "Your admin access is read-only", code: "ADMIN_READ_ONLY" });
        return null;
      }
      if (!ctx.checkCsrf(request, session, reply)) return null;
    }
    return session;
  }

  async function audit(session: SessionInfo, action: string, summary: string, data: Record<string, unknown> = {}) {
    await recordAudit(prisma, {
      type: "admin.action",
      actor: session.accountId,
      summary: `[admin] ${summary}`,
      data: { action, ...data },
    });
  }

  // Moderation: a hidden task cannot start runs or purchases.
  app.addHook("preHandler", async (request, reply) => {
    if (request.method !== "POST") return;
    const match = /^\/tasks\/([^/?]+)\//.exec(request.url);
    if (!match?.[1]) return;
    const task = await prisma.task.findUnique({ where: { id: match[1] }, select: { hiddenAt: true } }).catch(() => null);
    if (task?.hiddenAt) {
      return reply.code(403).send({ error: "This task was hidden by an operator", code: "TASK_HIDDEN" });
    }
  });

  // --------------------------------------------------------------- overview
  app.get("/admin/overview", async (request, reply) => {
    const session = await requireAdmin(request, reply);
    if (!session) return;
    const [checks, jobCounts, stuck, tasks, users, flags] = await Promise.all([
      ctx.health.checks(true),
      prisma.job.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.operation.count({ where: { OR: [{ needsRecovery: true }, { paymentState: "PAYOUT_PENDING" }] } }),
      prisma.task.findMany({ select: { availableYocto: true, reservedYocto: true, spentYocto: true, withdrawalPendingYocto: true } }),
      prisma.user.count(),
      prisma.contentFlag.count({ where: { status: "open" } }),
    ]);
    return {
      you: { accountId: session.accountId, operator: ctx.isOperator(session.accountId) },
      status: overallStatus(checks),
      checks,
      jobs: Object.fromEntries(jobCounts.map((row) => [row.status, row._count._all])),
      stuckOperations: stuck,
      totals: {
        tasks: tasks.length,
        users,
        availableYocto: sum(tasks.map((task) => task.availableYocto)),
        reservedYocto: sum(tasks.map((task) => task.reservedYocto)),
        spentYocto: sum(tasks.map((task) => task.spentYocto)),
        withdrawalPendingYocto: sum(tasks.map((task) => task.withdrawalPendingYocto)),
      },
      openFlags: flags,
    };
  });

  // ------------------------------------------------------------------- jobs
  app.get("/admin/jobs", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const query = z.object({ status: z.enum(["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "DEAD"]).optional() }).safeParse(request.query);
    const jobs = await prisma.job.findMany({
      where: query.success && query.data.status ? { status: query.data.status } : { status: { in: ["QUEUED", "RUNNING", "FAILED", "DEAD"] } },
      orderBy: { updatedAt: "desc" },
      take: 100,
      include: { task: { select: { name: true, ownerAccountId: true } } },
    });
    return {
      jobs: jobs.map((job) => ({
        id: job.id,
        kind: job.kind,
        status: job.status,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
        lastError: job.lastError,
        leaseOwner: job.leaseOwner,
        runAt: job.runAt.toISOString(),
        updatedAt: job.updatedAt.toISOString(),
        task: job.task ? { id: job.taskId, name: job.task.name, owner: job.task.ownerAccountId } : null,
      })),
    };
  });

  app.post("/admin/jobs/:id/retry", async (request, reply) => {
    const session = await requireAdmin(request, reply, "write");
    if (!session) return;
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const job = await prisma.job.findUnique({ where: { id } });
    if (!job) return reply.code(404).send({ error: "Job not found", code: "NOT_FOUND" });
    if (job.status !== "FAILED" && job.status !== "DEAD") {
      return reply.code(409).send({ error: "Only failed or dead-lettered jobs can be retried", code: "NOT_RETRYABLE" });
    }
    await prisma.job.update({
      where: { id },
      data: { status: "QUEUED", runAt: ctx.now(), finishedAt: null, leaseOwner: null, leaseExpiresAt: null, maxAttempts: job.attempts + 3 },
    });
    await audit(session, "job.retry", `Requeued job ${id} (${job.kind}).`, { jobId: id });
    return { ok: true };
  });

  app.post("/admin/jobs/:id/cancel", async (request, reply) => {
    const session = await requireAdmin(request, reply, "write");
    if (!session) return;
    const { id } = z.object({ id: z.string() }).parse(request.params);
    // Only queued jobs: cancelling a running job could abandon a payment mid-flight.
    const result = await prisma.job.updateMany({
      where: { id, status: "QUEUED" },
      data: { status: "FAILED", finishedAt: ctx.now(), lastError: `CANCELLED_BY_ADMIN ${session.accountId}` },
    });
    if (result.count !== 1) return reply.code(409).send({ error: "Only queued jobs can be cancelled", code: "NOT_CANCELLABLE" });
    await audit(session, "job.cancel", `Cancelled queued job ${id}.`, { jobId: id });
    return { ok: true };
  });

  // ------------------------------------------------------- stuck operations
  app.get("/admin/operations/stuck", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const rows = await prisma.operation.findMany({
      where: { OR: [{ needsRecovery: true }, { paymentState: "PAYOUT_PENDING" }, { paymentState: "PAID", fulfillmentState: { not: "DELIVERED" } }] },
      orderBy: { updatedAt: "asc" },
      take: 100,
      include: { task: { select: { name: true, ownerAccountId: true } }, agent: { select: { accountId: true } } },
    });
    return {
      operations: rows.map((row) => ({
        id: row.id,
        operationId: row.operationId,
        task: { id: row.taskId, name: row.task.name, owner: row.task.ownerAccountId },
        agent: row.agent.accountId,
        amountYocto: row.amountYocto,
        paymentState: row.paymentState,
        fulfillmentState: row.fulfillmentState,
        needsRecovery: row.needsRecovery,
        lastError: row.lastError,
        updatedAt: row.updatedAt.toISOString(),
        ageMinutes: Math.round((ctx.now().getTime() - row.updatedAt.getTime()) / 60_000),
      })),
    };
  });

  app.post("/admin/operations/:id/reconcile", async (request, reply) => {
    const session = await requireAdmin(request, reply, "write");
    if (!session) return;
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const operation = await prisma.operation.findUnique({ where: { id } });
    if (!operation) return reply.code(404).send({ error: "Operation not found", code: "NOT_FOUND" });
    // Recovery reads the original operation from chain first; it never creates a new payment.
    await prisma.job.create({
      data: {
        kind: "RECOVER_OPERATION",
        taskId: operation.taskId,
        dedupeKey: `admin-recover:${id}:${Math.floor(ctx.now().getTime() / 60_000)}`,
        payload: { operationId: id, reason: "admin-reconcile" },
      },
    });
    await audit(session, "operation.reconcile", `Queued chain reconciliation for operation ${operation.operationId.slice(0, 12)}….`, { operationId: id });
    return { ok: true };
  });

  // ---------------------------------------------------------- withdrawals
  app.get("/admin/withdrawals", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const tasks = await prisma.task.findMany({ where: { NOT: { withdrawalPendingYocto: "0" } }, take: 50 });
    const rows = await Promise.all(
      tasks.map(async (task) => {
        const pending = await ctx.chain
          .view<Array<{ withdrawal_id: number; amount: string }>>("list_pending_withdrawals", { task_id: task.chainTaskId })
          .catch(() => null);
        return {
          task: { id: task.id, name: task.name, owner: task.ownerAccountId, chainTaskId: task.chainTaskId },
          projectedPendingYocto: task.withdrawalPendingYocto,
          chainPending: pending,
          syncedAt: task.syncedAt?.toISOString() ?? null,
        };
      }),
    );
    return { withdrawals: rows };
  });

  // ---------------------------------------------------------------- workers
  app.get("/admin/workers", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const workers = await Promise.all(
      config.workerAccounts.map(async (worker) => {
        const publicKey = ctx.chain.publicKeyFor(worker.accountId);
        let balanceYocto: string | null = null;
        let allowanceYocto: string | null = null;
        let keyStatus = "unknown";
        const warnings: string[] = [];
        try {
          const account = await rpc<{ amount: string }>({ request_type: "view_account", account_id: worker.accountId });
          balanceYocto = account.amount;
          if (BigInt(account.amount) < LOW_BALANCE_YOCTO) warnings.push("Balance below 0.1 NEAR: top up gas.");
        } catch (error) {
          warnings.push(`Account unreadable: ${error instanceof Error ? error.message : error}`);
        }
        if (publicKey) {
          try {
            const key = await rpc<{ permission: "FullAccess" | { FunctionCall: { allowance: string | null } } }>({
              request_type: "view_access_key",
              account_id: worker.accountId,
              public_key: publicKey,
            });
            if (key.permission === "FullAccess") {
              keyStatus = worker.custody === "outlayer" ? "custody (TEE)" : "full access";
              if (worker.custody !== "outlayer") warnings.push("Worker key is full-access; use a restricted key.");
            } else {
              keyStatus = "function call";
              allowanceYocto = key.permission.FunctionCall.allowance;
              if (allowanceYocto && BigInt(allowanceYocto) < LOW_BALANCE_YOCTO / 2n) warnings.push("Gas allowance below 0.05 NEAR.");
            }
          } catch {
            keyStatus = "missing";
            warnings.push("Signing key not found on chain.");
          }
        }
        let outlayer: { policy: "set" | "none" | "unknown"; quota: string } | null = null;
        if (worker.custody === "outlayer" && worker.outlayerApiKey) {
          let policy: "set" | "none" | "unknown" = "unknown";
          try {
            const response = await fetch(`${config.outlayerApiUrl.replace(/\/+$/, "")}/wallet/v1/policy`, {
              headers: { authorization: `Bearer ${worker.outlayerApiKey}`, accept: "application/json" },
              signal: AbortSignal.timeout(8_000),
            });
            const body = response.ok ? ((await response.json()) as Record<string, unknown>) : {};
            policy = response.ok && Object.keys(body).length > 0 && !body.error ? "set" : "none";
          } catch {
            policy = "unknown";
          }
          if (policy === "none") warnings.push("No OutLayer spending policy set.");
          outlayer = { policy, quota: "Free tier: 1000 custody operations per wallet per 24h (usage is not exposed by the API)." };
        }
        return {
          slot: worker.slot,
          accountId: worker.accountId,
          custody: worker.custody,
          publicKey,
          keyStatus,
          balanceNear: balanceYocto ? nearString(BigInt(balanceYocto)) : null,
          allowanceNear: allowanceYocto ? nearString(BigInt(allowanceYocto)) : null,
          outlayer,
          warnings,
        };
      }),
    );
    return { workers };
  });

  // --------------------------------------------------------------- contract
  app.get("/admin/contract", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const [configView, account] = await Promise.all([
      ctx.chain.getConfig().catch((error) => ({ error: String(error) })),
      rpc<{ code_hash: string; amount: string; storage_usage: number }>({ request_type: "view_account", account_id: config.contractId }).catch(
        (error) => ({ error: String(error) }),
      ),
    ]);
    const expected = config.expectedWasmHash ?? localWasmHash();
    const deployed = "code_hash" in account ? account.code_hash : null;
    return {
      contractId: config.contractId,
      config: configView,
      deployedCodeHash: deployed,
      expectedCodeHash: expected,
      expectedSource: config.expectedWasmHash ? "POOLGUARD_EXPECTED_WASM_HASH" : expected ? "local build" : null,
      matches: deployed && expected ? deployed === expected : null,
      balanceNear: "amount" in account ? nearString(BigInt(account.amount)) : null,
      storageBytes: "storage_usage" in account ? account.storage_usage : null,
    };
  });

  // ------------------------------------------------------- users and access
  app.get("/admin/users", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const [users, allowlist] = await Promise.all([
      prisma.user.findMany({
        orderBy: { lastSeenAt: "desc" },
        take: 100,
        include: {
          _count: { select: { tasks: true } },
          sessions: { where: { revokedAt: null, expiresAt: { gt: ctx.now() } }, select: { id: true } },
        },
      }),
      prisma.allowedAccount.findMany({ orderBy: { createdAt: "desc" } }),
    ]);
    return {
      envAllowlist: config.authAllowedAccounts,
      allowlist: allowlist.map((row) => ({ accountId: row.accountId, addedBy: row.addedBy, note: row.note, createdAt: row.createdAt.toISOString() })),
      users: users.map((user) => ({
        accountId: user.accountId,
        lastSeenAt: user.lastSeenAt.toISOString(),
        createdAt: user.createdAt.toISOString(),
        tasks: user._count.tasks,
        activeSessions: user.sessions.length,
        suspendedAt: user.suspendedAt?.toISOString() ?? null,
        suspendedReason: user.suspendedReason,
        admin: ctx.isAdmin(user.accountId),
      })),
    };
  });

  const accountParam = z.object({ accountId: z.string().min(2).max(64) });

  app.post("/admin/allowlist", async (request, reply) => {
    const session = await requireAdmin(request, reply, "write");
    if (!session) return;
    const body = z
      .object({ account_id: z.string().min(2).max(64), note: z.string().max(200).optional(), remove: z.boolean().optional() })
      .safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid allowlist change", code: "VALIDATION_ERROR" });
    const accountId = body.data.account_id.toLowerCase();
    if (body.data.remove) {
      await prisma.allowedAccount.deleteMany({ where: { accountId } });
      await audit(session, "allowlist.remove", `Removed ${accountId} from the sign-in allowlist.`, { accountId });
    } else {
      await prisma.allowedAccount.upsert({
        where: { accountId },
        update: { note: body.data.note ?? null },
        create: { accountId, addedBy: session.accountId, note: body.data.note ?? null },
      });
      await audit(session, "allowlist.add", `Added ${accountId} to the sign-in allowlist.`, { accountId });
    }
    return { ok: true };
  });

  app.post("/admin/users/:accountId/revoke-sessions", async (request, reply) => {
    const session = await requireAdmin(request, reply, "write");
    if (!session) return;
    const { accountId } = accountParam.parse(request.params);
    const user = await prisma.user.findUnique({ where: { accountId } });
    if (!user) return reply.code(404).send({ error: "User not found", code: "NOT_FOUND" });
    const result = await prisma.walletSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: ctx.now() } });
    await audit(session, "user.revoke_sessions", `Revoked ${result.count} session(s) for ${accountId}.`, { accountId });
    return { revoked: result.count };
  });

  app.post("/admin/users/:accountId/suspend", async (request, reply) => {
    const session = await requireAdmin(request, reply, "write");
    if (!session) return;
    const { accountId } = accountParam.parse(request.params);
    const body = z.object({ reason: z.string().min(3).max(300), unsuspend: z.boolean().optional() }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Give a reason", code: "VALIDATION_ERROR" });
    if (accountId === session.accountId) return reply.code(409).send({ error: "You cannot suspend yourself", code: "SELF" });
    const user = await prisma.user.findUnique({ where: { accountId } });
    if (!user) return reply.code(404).send({ error: "User not found", code: "NOT_FOUND" });
    if (body.data.unsuspend) {
      await prisma.user.update({ where: { id: user.id }, data: { suspendedAt: null, suspendedReason: null } });
      await audit(session, "user.unsuspend", `Lifted suspension for ${accountId}.`, { accountId, reason: body.data.reason });
    } else {
      await prisma.$transaction([
        prisma.user.update({ where: { id: user.id }, data: { suspendedAt: ctx.now(), suspendedReason: body.data.reason } }),
        prisma.walletSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: ctx.now() } }),
      ]);
      await audit(session, "user.suspend", `Suspended ${accountId}.`, { accountId, reason: body.data.reason });
    }
    return { ok: true };
  });

  app.post("/admin/users/:accountId/delete-data", async (request, reply) => {
    const session = await requireAdmin(request, reply, "write");
    if (!session) return;
    const { accountId } = accountParam.parse(request.params);
    const body = z.object({ confirm: z.string() }).safeParse(request.body);
    if (!body.success || body.data.confirm !== accountId) {
      return reply.code(400).send({ error: "Type the account id to confirm", code: "CONFIRMATION_REQUIRED" });
    }
    const active = await prisma.job.count({ where: { status: { in: ["QUEUED", "RUNNING"] }, task: { ownerAccountId: accountId } } });
    if (active > 0) return reply.code(409).send({ error: "Jobs are still active for this account", code: "JOBS_ACTIVE" });
    const result = await deleteAccountData(ctx, accountId);
    await audit(session, "user.delete_data", `Deleted off-chain data for ${accountId} (${result.tasks} task(s)) on request.`, { accountId, tasks: result.tasks });
    return { deleted: true, tasks: result.tasks };
  });

  // ------------------------------------------------------------------ tasks
  app.get("/admin/tasks", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const tasks = await prisma.task.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { _count: { select: { operations: true, documents: true } } },
    });
    return {
      totals: {
        count: tasks.length,
        fundedYocto: sum(tasks.map((task) => task.totalFundedYocto)),
        availableYocto: sum(tasks.map((task) => task.availableYocto)),
        reservedYocto: sum(tasks.map((task) => task.reservedYocto)),
        spentYocto: sum(tasks.map((task) => task.spentYocto)),
      },
      tasks: tasks.map((task) => ({
        id: task.id,
        name: task.name,
        owner: task.ownerAccountId,
        status: task.status,
        chainTaskId: task.chainTaskId,
        fundedYocto: task.totalFundedYocto,
        availableYocto: task.availableYocto,
        reservedYocto: task.reservedYocto,
        spentYocto: task.spentYocto,
        operations: task._count.operations,
        documents: task._count.documents,
        hiddenAt: task.hiddenAt?.toISOString() ?? null,
        hiddenReason: task.hiddenReason,
        createdAt: task.createdAt.toISOString(),
      })),
    };
  });

  // ------------------------------------------------------------- moderation
  app.get("/admin/flags", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const flags = await prisma.contentFlag.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
    return { flags: flags.map((flag) => ({ ...flag, createdAt: flag.createdAt.toISOString(), resolvedAt: flag.resolvedAt?.toISOString() ?? null })) };
  });

  app.post("/admin/flags", async (request, reply) => {
    const session = await requireAdmin(request, reply, "write");
    if (!session) return;
    const body = z
      .object({ task_id: z.string().optional(), document_id: z.string().optional(), reason: z.string().min(3).max(300) })
      .refine((value) => value.task_id || value.document_id, "task_id or document_id is required")
      .safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid flag", code: "VALIDATION_ERROR" });
    const flag = await prisma.contentFlag.create({
      data: { taskId: body.data.task_id ?? null, documentId: body.data.document_id ?? null, reason: body.data.reason, createdBy: session.accountId },
    });
    await audit(session, "flag.create", `Flagged ${body.data.task_id ? `task ${body.data.task_id}` : `document ${body.data.document_id}`}: ${body.data.reason}`, { flagId: flag.id });
    return { flag };
  });

  app.post("/admin/flags/:id/resolve", async (request, reply) => {
    const session = await requireAdmin(request, reply, "write");
    if (!session) return;
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ resolution: z.string().min(2).max(300) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Describe the resolution", code: "VALIDATION_ERROR" });
    await prisma.contentFlag.update({ where: { id }, data: { status: "resolved", resolvedAt: ctx.now(), resolution: body.data.resolution } });
    await audit(session, "flag.resolve", `Resolved flag ${id}: ${body.data.resolution}`, { flagId: id });
    return { ok: true };
  });

  app.post("/admin/tasks/:id/hide", async (request, reply) => {
    const session = await requireAdmin(request, reply, "write");
    if (!session) return;
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ reason: z.string().min(3).max(300), unhide: z.boolean().optional() }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Give a reason", code: "VALIDATION_ERROR" });
    await prisma.task.update({
      where: { id },
      data: body.data.unhide ? { hiddenAt: null, hiddenReason: null } : { hiddenAt: ctx.now(), hiddenReason: body.data.reason },
    });
    await audit(session, body.data.unhide ? "task.unhide" : "task.hide", `${body.data.unhide ? "Unhid" : "Hid"} task ${id}: ${body.data.reason}`, { taskId: id });
    return { ok: true };
  });

  app.post("/admin/documents/:id/remove", async (request, reply) => {
    const session = await requireAdmin(request, reply, "write");
    if (!session) return;
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ reason: z.string().min(3).max(300) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Give a reason", code: "VALIDATION_ERROR" });
    // Wipe the ciphertext; keep the row so purchase evidence still links to it.
    await prisma.document.update({ where: { id }, data: { contentCiphertext: "", removedAt: ctx.now(), label: "Removed by operator" } });
    await audit(session, "document.remove", `Removed document ${id}: ${body.data.reason}`, { documentId: id });
    return { ok: true };
  });

  // ------------------------------------------------------------------ usage
  app.get("/admin/usage", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const runs = await prisma.agentRun.findMany({
      where: { createdAt: { gt: new Date(ctx.now().getTime() - 30 * 24 * 3600_000) } },
      select: { tokensUsed: true, mode: true, model: true, outputJson: true, task: { select: { ownerAccountId: true } } },
    });
    const byAccount = new Map<string, { runs: number; tokens: number; live: number }>();
    let verified = 0;
    let signedTotal = 0;
    let privateRuns = 0;
    for (const run of runs) {
      const owner = run.task.ownerAccountId;
      const row = byAccount.get(owner) ?? { runs: 0, tokens: 0, live: 0 };
      row.runs += 1;
      row.tokens += run.tokensUsed;
      if (run.mode === "LIVE") row.live += 1;
      byAccount.set(owner, row);
      const report = (run.outputJson as { privateInference?: { verifiedCount?: number; totalCount?: number } } | null)?.privateInference;
      if (report) {
        privateRuns += 1;
        verified += report.verifiedCount ?? 0;
        signedTotal += report.totalCount ?? 0;
      }
    }
    return {
      windowDays: 30,
      totals: { runs: runs.length, tokens: runs.reduce((total, run) => total + run.tokensUsed, 0) },
      privateInference: { runs: privateRuns, verifiedSignatures: verified, totalSignatures: signedTotal },
      byAccount: [...byAccount.entries()].map(([accountId, row]) => ({ accountId, ...row })).sort((a, b) => b.tokens - a.tokens),
      quota: { perHour: config.apiChainActionsPerHour, usage: ctx.quota.snapshot() },
      note: "AI provider charges are billed by the provider and are not metered here; tokens are as reported by the model.",
    };
  });

  // ---------------------------------------------------------- announcements
  app.get("/admin/announcements", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const rows = await prisma.announcement.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
    return { announcements: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString(), endsAt: row.endsAt?.toISOString() ?? null })) };
  });

  app.post("/admin/announcements", async (request, reply) => {
    const session = await requireAdmin(request, reply, "write");
    if (!session) return;
    const body = z
      .object({ message: z.string().min(3).max(400), severity: z.enum(["info", "warning", "danger"]).default("info"), ends_at: z.string().datetime().optional() })
      .safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid announcement", code: "VALIDATION_ERROR" });
    const row = await prisma.announcement.create({
      data: { message: body.data.message, severity: body.data.severity, createdBy: session.accountId, endsAt: body.data.ends_at ? new Date(body.data.ends_at) : null },
    });
    await audit(session, "announcement.create", `Posted ${body.data.severity === "danger" ? "an incident" : body.data.severity === "info" ? "an info" : "a warning"} announcement.`, { announcementId: row.id, message: body.data.message });
    return { announcement: row };
  });

  app.post("/admin/announcements/:id/end", async (request, reply) => {
    const session = await requireAdmin(request, reply, "write");
    if (!session) return;
    const { id } = z.object({ id: z.string() }).parse(request.params);
    await prisma.announcement.update({ where: { id }, data: { active: false } });
    await audit(session, "announcement.end", `Ended announcement ${id}.`, { announcementId: id });
    return { ok: true };
  });

  // ------------------------------------------------------------- audit log
  app.get("/admin/audit", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const rows = await prisma.auditEvent.findMany({
      where: { type: { in: ["admin.action", "alert.raised", "account.data_deleted"] } },
      orderBy: { id: "desc" },
      take: 100,
    });
    return {
      events: rows.map((row) => ({ id: row.id.toString(), type: row.type, actor: row.actor, summary: row.summary, severity: row.severity, createdAt: row.createdAt.toISOString() })),
    };
  });
}
