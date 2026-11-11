import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { LEGAL_VERSIONS } from "@poolguard/shared";
import { recordAudit } from "../audit.js";
import type { RouteContext } from "./context.js";

const CSV_DATASETS = ["tasks", "operations", "activity"] as const;

function csvCell(value: unknown): string {
  const text = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]!);
  return [headers.join(","), ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(","))].join("\n") + "\n";
}

/**
 * Off-chain data removal for one account: tasks (and their documents, jobs,
 * operations and events, by cascade), sessions, consent records and the user row.
 * Chain state is untouched: it is public and permanent, and task funds stay
 * withdrawable by the owner's wallet.
 */
export async function deleteAccountData(ctx: RouteContext, accountId: string): Promise<{ tasks: number }> {
  const user = await ctx.prisma.user.findUnique({ where: { accountId } });
  const tasks = await ctx.prisma.task.findMany({ where: { ownerAccountId: accountId }, select: { id: true } });
  const taskIds = tasks.map((task) => task.id);
  await ctx.prisma.$transaction([
    ctx.prisma.job.deleteMany({ where: { taskId: { in: taskIds } } }),
    ctx.prisma.task.deleteMany({ where: { id: { in: taskIds } } }),
    ...(user ? [ctx.prisma.user.delete({ where: { id: user.id } })] : []),
  ]);
  return { tasks: taskIds.length };
}

export function registerAccountRoutes(app: FastifyInstance, ctx: RouteContext) {
  const { prisma } = ctx;

  // ------------------------------------------------------------- consent
  app.post("/account/consent", async (request, reply) => {
    const session = await ctx.requireSession(request, reply);
    if (!session) return;
    if (!ctx.checkCsrf(request, session, reply)) return;
    const body = z.object({ terms_version: z.string(), privacy_version: z.string() }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid consent payload", code: "VALIDATION_ERROR" });
    if (body.data.terms_version !== LEGAL_VERSIONS.terms || body.data.privacy_version !== LEGAL_VERSIONS.privacy) {
      return reply.code(409).send({ error: "These are not the current documents", code: "STALE_VERSION", current: LEGAL_VERSIONS });
    }
    await prisma.consentRecord.createMany({
      data: [
        { userId: session.userId, document: "terms", version: LEGAL_VERSIONS.terms, acceptedAt: ctx.now() },
        { userId: session.userId, document: "privacy", version: LEGAL_VERSIONS.privacy, acceptedAt: ctx.now() },
      ],
    });
    await recordAudit(prisma, {
      type: "account.consented",
      actor: session.accountId,
      summary: `Accepted Terms ${LEGAL_VERSIONS.terms} and Privacy ${LEGAL_VERSIONS.privacy}.`,
      data: { terms: LEGAL_VERSIONS.terms, privacy: LEGAL_VERSIONS.privacy },
    });
    return { ok: true, consent: await ctx.consentStatus(session.userId) };
  });

  app.get("/account/consents", async (request, reply) => {
    const session = await ctx.requireSession(request, reply);
    if (!session) return;
    const records = await prisma.consentRecord.findMany({ where: { userId: session.userId }, orderBy: { acceptedAt: "desc" } });
    return {
      current: LEGAL_VERSIONS,
      records: records.map((record) => ({ document: record.document, version: record.version, acceptedAt: record.acceptedAt.toISOString() })),
    };
  });

  // ------------------------------------------------------------ sessions
  app.get("/account/sessions", async (request, reply) => {
    const session = await ctx.requireSession(request, reply);
    if (!session) return;
    const rows = await prisma.walletSession.findMany({
      where: { userId: session.userId, revokedAt: null, expiresAt: { gt: ctx.now() } },
      orderBy: { createdAt: "desc" },
    });
    return {
      sessions: rows.map((row) => ({
        id: row.id,
        current: row.id === session.sessionId,
        userAgent: row.userAgent,
        createdAt: row.createdAt.toISOString(),
        lastSeenAt: (row.lastSeenAt ?? row.createdAt).toISOString(),
        expiresAt: row.expiresAt.toISOString(),
      })),
    };
  });

  app.post("/account/sessions/revoke", async (request, reply) => {
    const session = await ctx.requireSession(request, reply);
    if (!session) return;
    if (!ctx.checkCsrf(request, session, reply)) return;
    const body = z
      .object({ session_id: z.string().optional(), all_others: z.boolean().optional(), all: z.boolean().optional() })
      .safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "Invalid request", code: "VALIDATION_ERROR" });
    const where = body.data.all
      ? { userId: session.userId, revokedAt: null }
      : body.data.all_others
        ? { userId: session.userId, revokedAt: null, id: { not: session.sessionId } }
        : { userId: session.userId, revokedAt: null, id: body.data.session_id ?? "__none__" };
    const result = await prisma.walletSession.updateMany({ where, data: { revokedAt: ctx.now() } });
    await recordAudit(prisma, {
      type: "account.sessions_revoked",
      actor: session.accountId,
      summary: `Signed out of ${result.count} session(s).`,
      data: { count: result.count, scope: body.data.all ? "all" : body.data.all_others ? "others" : "one" },
    });
    if (body.data.all) ctx.clearSessionCookies(reply);
    return { revoked: result.count };
  });

  // -------------------------------------------------------------- export
  app.get("/account/export", async (request, reply) => {
    const session = await ctx.requireSession(request, reply);
    if (!session) return;
    const query = z
      .object({ format: z.enum(["json", "csv"]).default("json"), dataset: z.enum(CSV_DATASETS).default("activity") })
      .safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "Invalid export request", code: "VALIDATION_ERROR" });
    const tasks = await prisma.task.findMany({
      where: { ownerAccountId: session.accountId },
      include: {
        documents: true,
        operations: { include: { chainTransactions: true } },
        runs: true,
        events: { orderBy: { id: "asc" } },
        agents: true,
      },
      orderBy: { createdAt: "asc" },
    });
    const stamp = ctx.now().toISOString().replace(/[:.]/g, "-");
    await recordAudit(prisma, {
      type: "account.data_exported",
      actor: session.accountId,
      summary: `Exported account data (${query.data.format}${query.data.format === "csv" ? `, ${query.data.dataset}` : ""}).`,
    });

    if (query.data.format === "csv") {
      let rows: Array<Record<string, unknown>> = [];
      if (query.data.dataset === "tasks") {
        rows = tasks.map((task) => ({
          task_id: task.id,
          chain_task_id: task.chainTaskId,
          name: task.name,
          status: task.status,
          created_at: task.createdAt.toISOString(),
          funded_yocto: task.totalFundedYocto,
          available_yocto: task.availableYocto,
          reserved_yocto: task.reservedYocto,
          spent_yocto: task.spentYocto,
        }));
      } else if (query.data.dataset === "operations") {
        rows = tasks.flatMap((task) =>
          task.operations.map((operation) => ({
            task: task.name,
            operation_id: operation.operationId,
            service: operation.serviceId,
            amount_yocto: operation.amountYocto,
            payment_state: operation.paymentState,
            fulfillment_state: operation.fulfillmentState,
            payout_attempts: operation.payoutAttempts,
            tx_hashes: operation.chainTransactions.map((tx) => tx.txHash).join(" "),
            created_at: operation.createdAt.toISOString(),
          })),
        );
      } else {
        rows = tasks.flatMap((task) =>
          task.events.map((event) => ({
            task: task.name,
            at: event.createdAt.toISOString(),
            type: event.type,
            actor: event.actor,
            summary: event.summary,
          })),
        );
      }
      reply.header("content-type", "text/csv; charset=utf-8");
      reply.header("content-disposition", `attachment; filename="poolguard-${query.data.dataset}-${stamp}.csv"`);
      return toCsv(rows);
    }

    const consents = await prisma.consentRecord.findMany({ where: { userId: session.userId } });
    const sessions = await prisma.walletSession.findMany({ where: { userId: session.userId } });
    const json = {
      exportedAt: ctx.now().toISOString(),
      account: session.accountId,
      note: "Off-chain data PoolGuard stores for this account. On-chain records are public and are not included.",
      consents: consents.map((c) => ({ document: c.document, version: c.version, acceptedAt: c.acceptedAt })),
      sessions: sessions.map((s) => ({ createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, expiresAt: s.expiresAt, revokedAt: s.revokedAt, userAgent: s.userAgent })),
      tasks: tasks.map((task) => ({
        id: task.id,
        chainTaskId: task.chainTaskId,
        name: task.name,
        objective: task.objective,
        status: task.status,
        createdAt: task.createdAt,
        budget: {
          fundedYocto: task.totalFundedYocto,
          availableYocto: task.availableYocto,
          reservedYocto: task.reservedYocto,
          spentYocto: task.spentYocto,
          withdrawnYocto: task.withdrawnYocto,
        },
        documents: task.documents.map((document) => {
          let text: string | null = null;
          try {
            text = document.removedAt ? null : ctx.decryptDocument(document.contentCiphertext);
          } catch {
            text = null;
          }
          return { label: document.label, createdAt: document.createdAt, removedByOperator: Boolean(document.removedAt), text };
        }),
        agents: task.agents.map((agent) => ({ label: agent.label, accountId: agent.accountId })),
        operations: task.operations.map((operation) => ({
          operationId: operation.operationId,
          serviceId: operation.serviceId,
          amountYocto: operation.amountYocto,
          paymentState: operation.paymentState,
          fulfillmentState: operation.fulfillmentState,
          payoutAttempts: operation.payoutAttempts,
          transactions: operation.chainTransactions.map((tx) => ({ kind: tx.kind, status: tx.status, txHash: tx.txHash, createdAt: tx.createdAt })),
        })),
        runs: task.runs.map((run) => ({ mode: run.mode, status: run.status, model: run.model, tokensUsed: run.tokensUsed, summary: run.summary, startedAt: run.startedAt, finishedAt: run.finishedAt })),
        activity: task.events.map((event) => ({ at: event.createdAt, type: event.type, actor: event.actor, summary: event.summary, data: event.data })),
      })),
    };
    reply.header("content-type", "application/json; charset=utf-8");
    reply.header("content-disposition", `attachment; filename="poolguard-export-${stamp}.json"`);
    return JSON.stringify(json, (_key, value) => (typeof value === "bigint" ? value.toString() : value), 2);
  });

  // -------------------------------------------------------------- delete
  app.post("/account/delete", async (request, reply) => {
    const session = await ctx.requireSession(request, reply);
    if (!session) return;
    if (!ctx.checkCsrf(request, session, reply)) return;
    const body = z.object({ confirm: z.string() }).safeParse(request.body);
    if (!body.success || body.data.confirm !== session.accountId) {
      return reply.code(400).send({ error: "Type your account id exactly to confirm", code: "CONFIRMATION_REQUIRED" });
    }
    const active = await prisma.job.count({
      where: { status: { in: ["QUEUED", "RUNNING"] }, task: { ownerAccountId: session.accountId } },
    });
    if (active > 0) {
      return reply.code(409).send({
        error: "Agent jobs are still running for your tasks. Wait for them to finish, then delete.",
        code: "JOBS_ACTIVE",
        activeJobs: active,
      });
    }
    const result = await deleteAccountData(ctx, session.accountId);
    // Kept without personal content so deletions remain accountable.
    await recordAudit(prisma, {
      type: "account.data_deleted",
      actor: session.accountId,
      summary: `Account deleted its off-chain data (${result.tasks} task(s)). On-chain records remain.`,
      data: { tasks: result.tasks, by: "self" },
    });
    ctx.clearSessionCookies(reply);
    return { deleted: true, tasks: result.tasks };
  });
}
