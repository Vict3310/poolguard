import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { verifyMessage } from "near-api-js/nep413";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@poolguard/db";
import { JobStatus, TaskStatus } from "@poolguard/db";
import {
  accountIdSchema,
  computeOperationId,
  computeRequestHash,
  deriveTaskLifecycle,
  documentLabelSchema,
  hex64Schema,
  isYoctoString,
  parseNearToYocto,
  providerResultResponseSchema,
  taskNameSchema,
  taskObjectiveSchema,
  type ChainBudgetView,
  type ChainOperationView,
  type ChainTaskView,
  type ContractPolicyInput,
  type ContractReserveRequest,
  type SupplierExtraction,
} from "@poolguard/shared";
import {
  ChainDenialError,
  ChainTransportError,
  NearChain,
  buildTaskSetupPlan,
  isNonceError,
  type ActionSpec,
  type PreparedTransaction,
} from "@poolguard/agent-runtime/chain";
import { recordAudit, toActivityEvent } from "./audit.js";
import { fetchAttestation, isNearAiBaseUrl, type AttestationSummary } from "@poolguard/agent-runtime";
import { AccountQuota, KeyedLock } from "./limits.js";
import { HealthService } from "./health.js";
import type { RouteContext } from "./routes/context.js";
import { registerPlatformRoutes } from "./routes/platform.js";
import { registerAccountRoutes } from "./routes/account.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { LEGAL_VERSIONS, type LegalDocument } from "@poolguard/shared";
import type { ApiConfig } from "./config.js";
import {
  CSRF_COOKIE,
  CSRF_HEADER,
  SESSION_COOKIE,
  buildChallengeMessage,
  cookieOptions,
  csrfCookieOptions,
  decryptDocument,
  encryptDocument,
  hashToken,
  randomNonce,
  randomToken,
  safeEqual,
} from "./security.js";

export interface ApiDeps {
  prisma: PrismaClient;
  chain: NearChain;
  config: ApiConfig;
  now?: () => Date;
}

export interface SessionInfo {
  sessionId: string;
  userId: string;
  accountId: string;
  csrfHash: string;
  suspended: boolean;
}

const taskInclude = {
  agents: { orderBy: { slot: "asc" as const } },
  documents: { orderBy: { createdAt: "asc" as const } },
  operations: {
    include: { agent: true, chainTransactions: { orderBy: { createdAt: "desc" as const } } },
    orderBy: { createdAt: "desc" as const },
  },
  policySnapshots: { orderBy: { version: "desc" as const } },
  providerResults: true,
  runs: { orderBy: { createdAt: "desc" as const }, take: 12 },
} satisfies Prisma.TaskInclude;

type TaskBundle = Prisma.TaskGetPayload<{ include: typeof taskInclude }>;

const createTaskSchema = z.object({
  name: taskNameSchema,
  objective: taskObjectiveSchema,
  budget_near: z.string().min(1),
  max_per_operation_near: z.string().min(1),
  reservation_ttl_blocks: z.coerce.number().int().min(10).max(10_000),
  expires_in_blocks: z.coerce.number().int().min(100).max(1_000_000),
  documents: z
    .array(z.object({ label: documentLabelSchema, text: z.string().min(20).max(80_000) }))
    .min(1)
    .max(2),
});

const actionSchema = z.object({
  action: z.enum(["pause", "resume", "fund", "withdraw", "revoke_agent"]),
  amount_near: z.string().optional(),
  agent_account_id: accountIdSchema.optional(),
});

const runSchema = z.object({
  mode: z.enum(["live", "scripted"]).default("scripted"),
  scenario: z.enum(["A", "B", "C", "D"]).optional(),
  fault: z.boolean().optional(),
});

const quoteRequestApiSchema = z.object({
  service_key: z.string().min(1).max(64),
  document_id: z.string().optional(),
});

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30) || "task";
}

function jsonSafe(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

function mapPaymentState(state: string): "RESERVED" | "PAYOUT_PENDING" | "PAID" | "PAYOUT_FAILED" | "CANCELLED" | "EXPIRED" {
  return state.toUpperCase() as ReturnType<typeof mapPaymentState>;
}

function chainActionPlan(actions: ActionSpec[], receiverId: string, network: string) {
  return {
    receiver_id: receiverId,
    network,
    actions: actions.map((action) => ({
      method_name: action.methodName,
      args: action.args,
      gas_tgas: action.gasTgas,
      deposit_yocto: action.depositYocto,
    })),
    total_deposit_yocto: actions
      .reduce((sum, action) => sum + BigInt(action.depositYocto), 0n)
      .toString(),
  };
}

function bigintToString(value: bigint | null | undefined): string | null {
  return value == null ? null : value.toString();
}

/** Bounded fan-out for chain reads; public RPC endpoints reject large bursts. */
async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const runners = Array.from(
    { length: Math.min(Math.max(1, limit), items.length) },
    async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        const item = items[index];
        if (item !== undefined) await worker(item);
      }
    },
  );
  await Promise.all(runners);
}

function agentKeyConfigured(config: ApiConfig, accountId: string): boolean {
  return config.workerAccounts.some((worker) => worker.accountId === accountId);
}

export async function buildApiApp(deps: ApiDeps): Promise<FastifyInstance> {
  const { prisma, chain, config } = deps;
  const now = deps.now ?? (() => new Date());
  const secureCookies = config.webOrigin.startsWith("https://");
  const sessionMaxAge = config.sessionTtlDays * 24 * 60 * 60;
  // Browsers treat localhost and 127.0.0.1 as different origins. Accept both
  // loopback spellings outside production; a deployed origin stays exact.
  const allowedOrigins = new Set([config.webOrigin]);
  if (config.nodeEnv !== "production") {
    for (const origin of [config.webOrigin]) {
      try {
        const url = new URL(origin);
        if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
          const alternate = new URL(origin);
          alternate.hostname = url.hostname === "localhost" ? "127.0.0.1" : "localhost";
          allowedOrigins.add(alternate.origin);
        }
      } catch {
        /* a malformed WEB_ORIGIN is rejected elsewhere */
      }
    }
  }
  let chainConfigCache: { value: Awaited<ReturnType<NearChain["getConfig"]>>; at: number } | null = null;
  const purchaseLocks = new KeyedLock();
  const chainActionQuota = new AccountQuota(config.apiChainActionsPerHour, 60 * 60_000, () => now().getTime());
  const allowedAccounts = new Set(config.authAllowedAccounts ?? []);
  const adminAccounts = new Set(config.adminAccounts ?? []);
  const operatorAccounts = new Set(config.operatorAccounts ?? []);
  const isAdmin = (accountId: string) => adminAccounts.has(accountId.toLowerCase());
  const isOperator = (accountId: string) => operatorAccounts.has(accountId.toLowerCase());
  /**
   * Sign-in allowlist: AUTH_ALLOWED_ACCOUNTS plus operator-managed AllowedAccount
   * rows. When both are empty everyone may sign in. Admins can always sign in.
   */
  const accountAllowed = async (accountId: string): Promise<boolean> => {
    const id = accountId.toLowerCase();
    if (isAdmin(id) || allowedAccounts.has(id)) return true;
    const rows = await prisma.allowedAccount.count().catch(() => 0);
    if (allowedAccounts.size === 0 && rows === 0) return true;
    if (rows === 0) return false;
    return Boolean(await prisma.allowedAccount.findUnique({ where: { accountId: id } }).catch(() => null));
  };
  const SSE_MAX_STREAMS_PER_ACCOUNT = 6;
  const SSE_SESSION_RECHECK_TICKS = 15;
  const openStreams = new Map<string, number>();

  const app = Fastify({
    logger: false,
    bodyLimit: 300_000,
    trustProxy: config.apiTrustProxy,
  });

  await app.register(cookie);
  await app.register(cors, {
    origin: [...allowedOrigins],
    credentials: true,
    allowedHeaders: ["content-type", CSRF_HEADER, "last-event-id"],
    methods: ["GET", "POST", "OPTIONS"],
  });
  await app.register(rateLimit, {
    global: true,
    max: config.apiRateLimitMax,
    timeWindow: "1 minute",
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof z.ZodError) {
      return reply.code(400).send({ error: "Invalid request", code: "VALIDATION_ERROR", issues: error.issues });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status < 500) {
      return reply.code(status).send({
        error: error instanceof Error ? error.message : String(error),
        code: (error as { code?: string }).code ?? "REQUEST_ERROR",
      });
    }
    request.log.error({ err: error }, "unhandled API error");
    return reply.code(500).send({ error: "Internal error", code: "INTERNAL_ERROR" });
  });

  app.addHook("onSend", async (_request, reply, payload) => {
    if (!reply.hasHeader("cache-control")) reply.header("cache-control", "no-store");
    reply.header("x-content-type-options", "nosniff");
    return payload;
  });

  async function chainConfig() {
    if (chainConfigCache && Date.now() - chainConfigCache.at < 60_000) return chainConfigCache.value;
    const value = await chain.getConfig();
    chainConfigCache = { value, at: Date.now() };
    return value;
  }

  async function sessionFrom(request: FastifyRequest): Promise<SessionInfo | null> {
    const token = request.cookies[SESSION_COOKIE];
    if (!token) return null;
    const session = await prisma.walletSession.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });
    if (!session || session.revokedAt || session.expiresAt.getTime() <= now().getTime()) return null;
    // Keep "last active" fresh for the sessions list without a write per request.
    if (!session.lastSeenAt || now().getTime() - session.lastSeenAt.getTime() > 5 * 60_000) {
      void prisma.walletSession.update({ where: { id: session.id }, data: { lastSeenAt: now() } }).catch(() => undefined);
    }
    return {
      sessionId: session.id,
      userId: session.userId,
      accountId: session.user.accountId,
      csrfHash: session.csrfHash,
      suspended: Boolean(session.user.suspendedAt),
    };
  }

  async function requireSession(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<SessionInfo | null> {
    const session = await sessionFrom(request);
    if (!session) {
      reply.code(401).send({ error: "Sign in required", code: "UNAUTHENTICATED" });
      return null;
    }
    if (session.suspended) {
      reply.code(403).send({ error: "This account is suspended. Contact the operator.", code: "ACCOUNT_SUSPENDED" });
      return null;
    }
    // Changes require the current Terms and Privacy versions. Data-rights routes
    // (/account/*) and sign-out stay available so a user can always export or leave.
    const path = request.url.split("?")[0] ?? "";
    if (request.method !== "GET" && !path.startsWith("/account") && path !== "/auth/logout") {
      const consent = await consentStatus(session.userId);
      if (consent.required) {
        reply.code(428).send({
          error: "Please accept the current Terms of Use and Privacy Policy",
          code: "CONSENT_REQUIRED",
          versions: LEGAL_VERSIONS,
        });
        return null;
      }
    }
    return session;
  }

  async function consentStatus(userId: string) {
    const records = await prisma.consentRecord.findMany({ where: { userId }, orderBy: { acceptedAt: "desc" } });
    const accepted = (document: LegalDocument) => records.find((record) => record.document === document)?.version ?? null;
    const terms = accepted("terms");
    const privacy = accepted("privacy");
    return {
      required: terms !== LEGAL_VERSIONS.terms || privacy !== LEGAL_VERSIONS.privacy,
      accepted: { terms, privacy },
      current: LEGAL_VERSIONS,
    };
  }

  function checkCsrf(request: FastifyRequest, session: SessionInfo, reply: FastifyReply): boolean {
    const origin = request.headers.origin;
    if (origin && !allowedOrigins.has(origin)) {
      reply.code(403).send({ error: "Cross-origin request rejected", code: "ORIGIN_REJECTED" });
      return false;
    }
    const header = request.headers[CSRF_HEADER];
    const cookieValue = request.cookies[CSRF_COOKIE];
    if (
      typeof header !== "string" ||
      !cookieValue ||
      !safeEqual(header, cookieValue) ||
      !safeEqual(hashToken(header), session.csrfHash)
    ) {
      reply.code(403).send({ error: "CSRF token missing or invalid", code: "CSRF_REJECTED" });
      return false;
    }
    return true;
  }

  /**
   * Worker accounts are shared across every task, so actions that make a worker sign
   * a transaction spend shared gas. Bound them per signed-in account.
   */
  function consumeChainQuota(session: SessionInfo, reply: FastifyReply): boolean {
    const result = chainActionQuota.consume(session.accountId);
    if (result.ok) return true;
    reply.header("retry-after", String(result.retryAfterSeconds));
    reply.code(429).send({
      error: "Too many worker transactions requested by this account; try again later",
      code: "CHAIN_ACTION_QUOTA",
      retry_after_seconds: result.retryAfterSeconds,
    });
    return false;
  }

  async function createSession(accountId: string, reply: FastifyReply, request?: FastifyRequest) {
    const user = await prisma.user.upsert({
      where: { accountId },
      update: { lastSeenAt: now() },
      create: { accountId },
    });
    const token = randomToken();
    const csrf = randomToken();
    const expiresAt = new Date(now().getTime() + sessionMaxAge * 1000);
    await prisma.walletSession.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        csrfHash: hashToken(csrf),
        expiresAt,
        userAgent: request?.headers["user-agent"]?.slice(0, 200) ?? null,
        lastSeenAt: now(),
      },
    });
    reply.setCookie(SESSION_COOKIE, token, cookieOptions({ secure: secureCookies, maxAgeSeconds: sessionMaxAge }));
    reply.setCookie(CSRF_COOKIE, csrf, csrfCookieOptions({ secure: secureCookies, maxAgeSeconds: sessionMaxAge }));
    return { user, csrf, expiresAt };
  }

  async function loadOwnedTask(
    taskId: string,
    session: SessionInfo,
    reply: FastifyReply,
  ): Promise<TaskBundle | null> {
    const task = await prisma.task.findUnique({ where: { id: taskId }, include: taskInclude });
    if (!task || task.ownerAccountId !== session.accountId) {
      reply.code(404).send({ error: "Task not found", code: "TASK_NOT_FOUND" });
      return null;
    }
    return task;
  }

  async function refreshTaskFromChain(task: TaskBundle): Promise<{
    chainTask: ChainTaskView | null;
    stale: boolean;
    warning: string | null;
    currentBlock: number | null;
  }> {
    try {
      const chainTask = await chain.getTask(task.chainTaskId);
      if (!chainTask) {
        return { chainTask: null, stale: true, warning: "Task is not visible on chain", currentBlock: null };
      }
      if (chainTask.owner !== task.ownerAccountId) {
        return { chainTask: null, stale: true, warning: "On-chain owner does not match this task", currentBlock: null };
      }
      const currentBlock = await chain.getCurrentBlock().catch(() => null);
      const status =
        chainTask.paused
          ? TaskStatus.PAUSED
          : currentBlock !== null && currentBlock > chainTask.policy.expires_at_block
            ? TaskStatus.EXPIRED
            : chainTask.total_funded === "0"
              ? TaskStatus.AWAITING_FUNDING
              : TaskStatus.ACTIVE;
      await prisma.task.update({
        where: { id: task.id },
        data: {
          paused: chainTask.paused,
          status,
          policyVersion: chainTask.policy.policy_version,
          maxPerOperationYocto: chainTask.policy.max_per_operation,
          allowedProviders: chainTask.policy.allowed_providers,
          reservationTtlBlocks: chainTask.policy.reservation_ttl_blocks,
          expiresAtBlock: BigInt(chainTask.policy.expires_at_block),
          totalFundedYocto: chainTask.total_funded,
          availableYocto: chainTask.available,
          reservedYocto: chainTask.reserved,
          spentYocto: chainTask.spent,
          withdrawnYocto: chainTask.withdrawn,
          withdrawalPendingYocto: chainTask.withdrawal_pending,
          createdAtBlock: BigInt(chainTask.created_at_block),
          syncedAt: now(),
          lastSyncError: null,
        },
      });
      await Promise.all(
        chainTask.agents.map((agent) =>
          prisma.agent.updateMany({
            where: { taskId: task.id, accountId: agent.account_id },
            data: {
              publicKey: agent.public_key,
              status: agent.active ? "REGISTERED" : "REVOKED",
              registeredAtBlock: BigInt(agent.registered_at_block),
            },
          }),
        ),
      );
      await syncOperations(task);
      return { chainTask, stale: false, warning: null, currentBlock };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await prisma.task.update({ where: { id: task.id }, data: { lastSyncError: message.slice(0, 300) } });
      return {
        chainTask: null,
        stale: true,
        warning: "Chain read failed; showing the last verified projection",
        currentBlock: null,
      };
    }
  }

  async function syncOperations(task: TaskBundle): Promise<void> {
    await runWithConcurrency(task.operations, config.chainReadConcurrency, async (operation) => {
      try {
        const view = await chain.getOperation(task.chainTaskId, operation.operationId);
        if (!view) return;
        const needsRecovery = view.payment_state === "payout_pending";
        if (
          operation.paymentState !== mapPaymentState(view.payment_state) ||
          operation.payoutAttempts !== view.payout_attempts ||
          operation.needsRecovery !== needsRecovery ||
          bigintToString(operation.settledAtBlock) !== (view.settled_at_block?.toString() ?? null)
        ) {
          await prisma.operation.update({
            where: { id: operation.id },
            data: {
              paymentState: mapPaymentState(view.payment_state),
              payoutAttempts: view.payout_attempts,
              needsRecovery,
              settledAtBlock: view.settled_at_block == null ? null : BigInt(view.settled_at_block),
            },
          });
        }
      } catch {
        /* a single RPC failure must not invalidate the whole page */
      }
    });
  }

  function budgetDto(task: TaskBundle, chainTask: ChainTaskView | null, stale: boolean) {
    const source = chainTask ? "chain" : "cache";
    const available = chainTask?.available ?? task.availableYocto;
    const reserved = chainTask?.reserved ?? task.reservedYocto;
    const spent = chainTask?.spent ?? task.spentYocto;
    const total = chainTask?.total_funded ?? task.totalFundedYocto;
    return {
      totalFundedYocto: total,
      availableYocto: available,
      reservedYocto: reserved,
      spentYocto: spent,
      withdrawnYocto: chainTask?.withdrawn ?? task.withdrawnYocto,
      withdrawalPendingYocto: chainTask?.withdrawal_pending ?? task.withdrawalPendingYocto,
      invariantHolds: chainTask ? true : null,
      source,
      stale,
      checkedAt: task.syncedAt?.toISOString() ?? null,
      lifecycle: deriveTaskLifecycle({
        paused: chainTask?.paused ?? task.paused,
        totalFunded: total,
        available,
        reserved,
        currentBlock: 0,
        expiresAtBlock: Number(task.expiresAtBlock),
      }),
    };
  }

  interface OperationViewInput {
    id: string;
    taskId: string;
    operationId: string;
    providerAccountId: string;
    serviceId: string;
    amountYocto: string;
    requestHash: string;
    outputSchemaHash: string;
    policyVersion: number;
    paymentState: string;
    fulfillmentState: string;
    reservationExpiresAtBlock: bigint;
    expiresAtBlock: bigint;
    chainCreatedAtBlock: bigint | null;
    settledAtBlock: bigint | null;
    payoutAttempts: number;
    recoveryAttempts: number;
    needsRecovery: boolean;
    denialCode: string | null;
    lastError: string | null;
    createdAt: Date;
    updatedAt: Date;
    agent: { id: string; label: string; accountId: string };
    chainTransactions: Array<{
      id: string;
      kind: string;
      status: string;
      txHash: string | null;
      blockHeight: bigint | null;
      errorMessage: string | null;
      createdAt: Date;
    }>;
  }

  function operationDto(operation: OperationViewInput) {
    return {
      id: operation.id,
      chainOperationId: operation.operationId,
      taskId: operation.taskId,
      agent: {
        id: operation.agent.id,
        label: operation.agent.label,
        accountId: operation.agent.accountId,
      },
      providerAccountId: operation.providerAccountId,
      serviceId: operation.serviceId,
      amountYocto: operation.amountYocto,
      requestHash: operation.requestHash,
      outputSchemaHash: operation.outputSchemaHash,
      policyVersion: operation.policyVersion,
      paymentState: operation.paymentState.toLowerCase(),
      fulfillmentState: operation.fulfillmentState.toLowerCase(),
      reservationExpiresAtBlock: Number(operation.reservationExpiresAtBlock),
      expiresAtBlock: Number(operation.expiresAtBlock),
      chainCreatedAtBlock: operation.chainCreatedAtBlock == null ? null : Number(operation.chainCreatedAtBlock),
      settledAtBlock: operation.settledAtBlock == null ? null : Number(operation.settledAtBlock),
      payoutAttempts: operation.payoutAttempts,
      recoveryAttempts: operation.recoveryAttempts,
      needsRecovery: operation.needsRecovery,
      denialCode: operation.denialCode,
      lastError: operation.lastError,
      createdAt: operation.createdAt.toISOString(),
      updatedAt: operation.updatedAt.toISOString(),
      transactions: operation.chainTransactions.map((tx) => ({
        id: tx.id,
        kind: tx.kind,
        status: tx.status,
        txHash: tx.txHash,
        blockHeight: tx.blockHeight == null ? null : Number(tx.blockHeight),
        error: tx.errorMessage,
        createdAt: tx.createdAt.toISOString(),
      })),
    };
  }

  function buildComparison(task: TaskBundle) {
    const delivered = task.providerResults.filter((row) => row.status === "DELIVERED" && row.resultJson);
    const entries = delivered.map((row) => {
      const operation = task.operations.find(
        (candidate) => candidate.operationId === row.operationId,
      );
      const result = row.resultJson as unknown as SupplierExtraction;
      return {
        operationId: row.operationId,
        agentLabel: operation?.agent.label ?? "Agent",
        documentLabel: result.document?.label ?? "Document",
        supplier: result.supplier?.name ?? null,
        quotes: (result.quotes ?? []).map((quote) => ({ amount: quote.amount, currency: quote.currency })),
        deliveryTerms: result.delivery?.terms ?? [],
        missingFields: result.missing_fields ?? [],
        warnings: result.warnings ?? [],
        deliveredAt: row.deliveredAt?.toISOString() ?? null,
      };
    });
    const expectedAgents = task.agents.filter((agent) => agent.status === "REGISTERED").length;
    return {
      entries,
      incomplete: entries.length < Math.max(1, expectedAgents) || entries.length === 0,
      differences: [
        ...(new Set(entries.map((entry) => entry.supplier ?? "unknown")).size > 1
          ? ["The documents name different suppliers."]
          : []),
        ...(new Set(entries.flatMap((entry) => entry.quotes.map((quote) => quote.currency))).size > 1
          ? ["Quotes use different currencies."]
          : []),
        ...(entries.some((entry) => entry.missingFields.length > 0)
          ? ["At least one document has missing fields."]
          : []),
        ...(entries.some((entry) => entry.warnings.length > 0)
          ? ["At least one document contains flagged text."]
          : []),
      ],
    };
  }

  async function taskDto(
    task: TaskBundle,
    options: { refresh?: boolean } = {},
  ) {
    const refresh = options.refresh !== false
      ? await refreshTaskFromChain(task)
      : { chainTask: null, stale: false, warning: null, currentBlock: null };
    const latest = refresh.chainTask
      ? await prisma.task.findUnique({ where: { id: task.id }, include: taskInclude })
      : task;
    if (!latest) throw new Error("Task disappeared during refresh");
    const pendingRecoveries = latest.operations.filter(
      (operation) => operation.needsRecovery || operation.paymentState === "PAYOUT_PENDING",
    ).length;
    const chainConfigValue = await chainConfig().catch(() => null);
    return {
      id: latest.id,
      chainTaskId: latest.chainTaskId,
      name: latest.name,
      objective: latest.objective,
      status: latest.status.toLowerCase(),
      paused: latest.paused,
      network: latest.network,
      contractId: latest.contractId,
      ownerAccountId: latest.ownerAccountId,
      createdAt: latest.createdAt.toISOString(),
      updatedAt: latest.updatedAt.toISOString(),
      policy: {
        version: latest.policyVersion,
        maxPerOperationYocto: latest.maxPerOperationYocto,
        allowedProviders: latest.allowedProviders,
        reservationTtlBlocks: latest.reservationTtlBlocks,
        expiresAtBlock: Number(latest.expiresAtBlock),
      },
      budget: budgetDto(latest, refresh.chainTask, refresh.stale),
      currentBlock: refresh.currentBlock,
      syncWarning: refresh.warning,
      setup: {
        storageDepositYocto: latest.setupStorageDepositYocto,
        budgetGoalYocto: latest.budgetGoalYocto,
        withdrawalStorageDepositYocto: chainConfigValue?.withdrawal_storage_deposit ?? null,
      },
      agents: latest.agents.map((agent) => ({
        id: agent.id,
        label: agent.label,
        slot: agent.slot,
        accountId: agent.accountId,
        publicKey: agent.publicKey,
        status: agent.status.toLowerCase(),
        keyConfigured: agentKeyConfigured(config, agent.accountId),
        registeredAtBlock: agent.registeredAtBlock == null ? null : Number(agent.registeredAtBlock),
      })),
      documents: latest.documents.map((document) => ({
        id: document.id,
        label: document.label,
        filename: document.filename,
        byteSize: document.byteSize,
        sha256: document.contentHash,
      })),
      operations: latest.operations.map(operationDto),
      runs: latest.runs.map((run) => ({
        id: run.id,
        runId: run.runId,
        agentId: run.agentId,
        mode: run.mode.toLowerCase(),
        status: run.status.toLowerCase(),
        steps: run.steps,
        tokensUsed: run.tokensUsed,
        summary: run.summary,
        denialCode: run.denialCode,
        error: run.error,
        startedAt: run.startedAt?.toISOString() ?? null,
        finishedAt: run.finishedAt?.toISOString() ?? null,
        model: run.model,
        privateInference: privateInferenceSummary(run.outputJson),
      })),
      result: buildComparison(latest),
      pendingRecoveries,
      chainProjection: refresh.chainTask
        ? {
            totalFunded: refresh.chainTask.total_funded,
            available: refresh.chainTask.available,
            reserved: refresh.chainTask.reserved,
            spent: refresh.chainTask.spent,
            withdrawn: refresh.chainTask.withdrawn,
            withdrawalPending: refresh.chainTask.withdrawal_pending,
          }
        : null,
    };
  }

  async function activateTask(task: TaskBundle, txHash: string, kind: "CREATE_TASK" | "FUND_TASK") {
    const chainTask = await chain.getTask(task.chainTaskId);
    if (!chainTask) throw new ChainTransportError("Task does not exist on chain after confirmation", txHash);
    if (chainTask.owner !== task.ownerAccountId) {
      throw new ChainDenialError("UNAUTHORIZED_OWNER", txHash, "On-chain task owner differs from this session");
    }
    for (const agent of task.agents) {
      const registered = chainTask.agents.find((candidate) => candidate.account_id === agent.accountId);
      if (!registered) {
        throw new ChainDenialError("AGENT_NOT_REGISTERED", txHash, `Agent ${agent.accountId} was not registered on chain`);
      }
    }
    await prisma.task.update({
      where: { id: task.id },
      data: {
        status: chainTask.paused ? TaskStatus.PAUSED : TaskStatus.ACTIVE,
        paused: chainTask.paused,
        policyVersion: chainTask.policy.policy_version,
        maxPerOperationYocto: chainTask.policy.max_per_operation,
        allowedProviders: chainTask.policy.allowed_providers,
        reservationTtlBlocks: chainTask.policy.reservation_ttl_blocks,
        expiresAtBlock: BigInt(chainTask.policy.expires_at_block),
        totalFundedYocto: chainTask.total_funded,
        availableYocto: chainTask.available,
        reservedYocto: chainTask.reserved,
        spentYocto: chainTask.spent,
        withdrawnYocto: chainTask.withdrawn,
        withdrawalPendingYocto: chainTask.withdrawal_pending,
        createdAtBlock: BigInt(chainTask.created_at_block),
        syncedAt: now(),
        lastSyncError: null,
      },
    });
    await prisma.policySnapshot.upsert({
      where: { taskId_version: { taskId: task.id, version: chainTask.policy.policy_version } },
      update: {},
      create: {
        taskId: task.id,
        version: chainTask.policy.policy_version,
        maxPerOperationYocto: chainTask.policy.max_per_operation,
        allowedProviders: chainTask.policy.allowed_providers,
        reservationTtlBlocks: chainTask.policy.reservation_ttl_blocks,
        expiresAtBlock: BigInt(chainTask.policy.expires_at_block),
        policyHash: computeRequestHash("policy", chainTask.policy),
        createdBy: task.ownerAccountId,
        createdTxHash: txHash,
      },
    });
    await prisma.chainTransaction.upsert({
      where: { txHash },
      update: { status: "SUCCESS", confirmedAt: now(), outcome: jsonSafe({ status: "success" }) },
      create: {
        taskId: task.id,
        kind,
        status: "SUCCESS",
        txHash,
        signerAccountId: task.ownerAccountId,
        receiverId: task.contractId,
        network: task.network,
        confirmedAt: now(),
        outcome: jsonSafe({ status: "success" }),
      },
    });
    await recordAudit(prisma, {
      taskId: task.id,
      type: "task.funded",
      actor: task.ownerAccountId,
      summary: `Task funded with ${chainTask.total_funded} yoctoNEAR.`,
      data: { amount_yocto: chainTask.total_funded, tx_hash: txHash },
      dedupeKey: `funded:${txHash}`,
    });
    for (const agent of chainTask.agents) {
      await recordAudit(prisma, {
        taskId: task.id,
        type: "agent.registered",
        actor: task.ownerAccountId,
        summary: `${agent.account_id} registered as an agent.`,
        data: { agent_account_id: agent.account_id, public_key: agent.public_key },
        dedupeKey: `agent:${task.id}:${agent.account_id}:${agent.registered_at_block}`,
      });
    }
    const fresh = await prisma.task.findUnique({ where: { id: task.id }, include: taskInclude });
    if (!fresh) throw new Error("Task vanished after activation");
    return fresh;
  }

  async function recordPreparedTx(
    task: { id: string; network: string; contractId: string },
    prepared: PreparedTransaction,
    kind: Prisma.ChainTransactionCreateInput["kind"],
    operationDbId?: string,
  ) {
    return prisma.chainTransaction.upsert({
      where: { txHash: prepared.txHash },
      update: {},
      create: {
        taskId: task.id,
        operationDbId: operationDbId ?? null,
        kind,
        status: "PREPARED",
        txHash: prepared.txHash,
        signerAccountId: prepared.signerAccountId,
        receiverId: prepared.receiverId,
        network: task.network,
        outcome: jsonSafe({
          method: prepared.methodName,
          actions: prepared.actions ?? [{ methodName: prepared.methodName, args: prepared.args }],
        }),
      },
    });
  }

  async function recordTxOutcome(
    txHash: string,
    status: "SUCCESS" | "FAILED" | "UNKNOWN",
    detail: { error?: string | null; outcome?: unknown },
  ) {
    await prisma.chainTransaction
      .update({
        where: { txHash },
        data: {
          status,
          errorMessage: detail.error?.slice(0, 500) ?? null,
          outcome: jsonSafe(detail.outcome ?? {}),
          confirmedAt: status === "SUCCESS" ? now() : null,
        },
      })
      .catch(() => undefined);
  }

  // ------------------------------------------------------------------------- meta

  app.get("/health", async () => ({
    status: "ok",
    service: "poolguard-api",
    network: config.nearNetwork,
    contractId: config.contractId,
  }));

  app.get("/ready", async (_request, reply) => {
    const checks: Record<string, string> = {};
    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.database = "ok";
    } catch {
      checks.database = "failed";
    }
    try {
      await chain.getCurrentBlock();
      checks.rpc = "ok";
    } catch {
      checks.rpc = "failed";
    }
    const ready = Object.values(checks).every((value) => value === "ok");
    return reply.code(ready ? 200 : 503).send({ status: ready ? "ready" : "not_ready", checks });
  });

  app.get("/meta", async () => ({
    network: config.nearNetwork,
    contractId: config.contractId,
    ownerAccountId: config.ownerAccountId ?? null,
    providerAccountId: config.providerAccountId,
    workerAccounts: config.workerAccounts.map((worker) => ({
      slot: worker.slot,
      accountId: worker.accountId,
      publicKey: chain.publicKeyFor(worker.accountId),
      keyConfigured: chain.hasSigner(worker.accountId),
      custody: worker.custody,
    })),
    apiOrigin: config.apiOrigin,
    webOrigin: config.webOrigin,
    secureCookies,
    trustProxy: config.apiTrustProxy,
    rateLimitMax: config.apiRateLimitMax,
    chainReadConcurrency: config.chainReadConcurrency,
    sandbox: config.localSandboxMode,
    devSessionEnabled:
      config.localSandboxMode && config.allowDevSession && config.nodeEnv !== "production",
    aiConfigured: Boolean(config.aiApiKey),
    aiModel: config.aiModel,
    aiProvider: isNearAiBaseUrl(config.aiBaseUrl) ? "near-ai" : "openai-compatible",
    aiPrivateInference: isNearAiBaseUrl(config.aiBaseUrl),
    policyProbeConfigured: Boolean(config.policyProbeProviderAccountId),
    chainConfig: await chainConfig().catch(() => null),
    testTokens: true,
    disclaimer:
      "Experimental testnet application. Balances are testnet tokens with no monetary value. Not audited.",
  }));

  // ----------------------------------------------------------- private inference

  let attestationCache: { value: AttestationSummary; at: number } | null = null;
  /**
   * Public summary of NEAR AI Cloud's TEE attestation for the configured model.
   * Cached for 10 minutes. Per-response signature checks live on each agent run.
   */
  app.get("/ai/attestation", async (_request, reply) => {
    if (!isNearAiBaseUrl(config.aiBaseUrl)) {
      return reply.code(404).send({
        error: "Private inference is not configured; AI_BASE_URL is not NEAR AI Cloud",
        code: "PRIVATE_INFERENCE_DISABLED",
      });
    }
    if (attestationCache && Date.now() - attestationCache.at < 10 * 60_000) {
      return { attestation: attestationCache.value, cached: true, model: config.aiModel };
    }
    try {
      const value = await fetchAttestation({ baseUrl: config.aiBaseUrl, apiKey: config.aiApiKey, model: config.aiModel });
      attestationCache = { value, at: Date.now() };
      return { attestation: value, cached: false, model: config.aiModel };
    } catch (error) {
      return reply.code(502).send({
        error: error instanceof Error ? error.message : "Attestation unavailable",
        code: "ATTESTATION_UNAVAILABLE",
      });
    }
  });

  // ------------------------------------------------------------------------- auth

  app.post(
    "/auth/challenge",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsed = z.object({ account_id: accountIdSchema }).safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "A valid NEAR account id is required", code: "VALIDATION_ERROR" });
      }
      if (!(await accountAllowed(parsed.data.account_id))) {
        return reply.code(403).send({ error: "Access is invite-only and this account is not on the list yet", code: "ACCOUNT_NOT_ALLOWED" });
      }
      const domain = new URL(config.webOrigin).host;
      const nonce = randomNonce();
      const issuedAt = now();
      const expiresAt = new Date(issuedAt.getTime() + 5 * 60_000);
      const message = buildChallengeMessage({
        domain,
        accountId: parsed.data.account_id,
        nonce,
        network: config.nearNetwork,
        issuedAt,
        expiresAt,
      });
      const challenge = await prisma.walletChallenge.create({
        data: {
          accountId: parsed.data.account_id,
          nonce,
          domain,
          network: config.nearNetwork,
          message,
          expiresAt,
        },
      });
      return {
        challenge_id: challenge.id,
        message,
        nonce,
        recipient: domain,
        network: config.nearNetwork,
        expires_at: expiresAt.toISOString(),
      };
    },
  );

  app.post(
    "/auth/verify",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsed = z
        .object({
          challenge_id: z.string().min(1),
          account_id: accountIdSchema,
          public_key: z.string().min(1),
          signature: z.string().min(1),
        })
        .safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid verification payload", code: "VALIDATION_ERROR" });
      }
      if (!(await accountAllowed(parsed.data.account_id))) {
        return reply.code(403).send({ error: "Access is invite-only and this account is not on the list yet", code: "ACCOUNT_NOT_ALLOWED" });
      }
      const challenge = await prisma.walletChallenge.findUnique({ where: { id: parsed.data.challenge_id } });
      if (
        !challenge ||
        challenge.usedAt ||
        challenge.expiresAt.getTime() <= now().getTime() ||
        challenge.accountId !== parsed.data.account_id ||
        challenge.network !== config.nearNetwork
      ) {
        return reply.code(400).send({ error: "Challenge expired or already used", code: "CHALLENGE_INVALID" });
      }
      const nonce = Buffer.from(challenge.nonce, "base64");
      if (nonce.length !== 32) {
        return reply.code(400).send({ error: "Challenge nonce is malformed", code: "CHALLENGE_INVALID" });
      }
      try {
        await verifyMessage({
          signerAccountId: parsed.data.account_id,
          signerPublicKey: parsed.data.public_key,
          signature: Buffer.from(parsed.data.signature, "base64"),
          payload: {
            message: challenge.message,
            recipient: challenge.domain,
            nonce: new Uint8Array(nonce),
          },
          provider: chain.provider,
        });
      } catch (error) {
        request.log.warn({ accountId: parsed.data.account_id }, "NEP-413 verification failed");
        return reply.code(401).send({
          error: "Signature verification failed",
          code: "SIGNATURE_INVALID",
          detail: error instanceof Error ? error.message.slice(0, 200) : "verification failed",
        });
      }
      const consumed = await prisma.walletChallenge.updateMany({
        where: { id: challenge.id, usedAt: null },
        data: { usedAt: now() },
      });
      if (consumed.count !== 1) {
        return reply.code(400).send({ error: "Challenge already used", code: "CHALLENGE_INVALID" });
      }
      const existing = await prisma.user.findUnique({ where: { accountId: parsed.data.account_id } });
      if (existing?.suspendedAt) {
        return reply.code(403).send({ error: "This account is suspended. Contact the operator.", code: "ACCOUNT_SUSPENDED" });
      }
      const { user, csrf, expiresAt } = await createSession(parsed.data.account_id, reply, request);
      return {
        user: { accountId: user.accountId },
        csrf_token: csrf,
        expires_at: expiresAt.toISOString(),
        network: config.nearNetwork,
      };
    },
  );

  app.get("/auth/session", async (request) => {
    const session = await sessionFrom(request);
    if (!session) {
      return {
        authenticated: false,
        network: config.nearNetwork,
        sandbox: config.localSandboxMode,
        devSessionEnabled:
          config.localSandboxMode && config.allowDevSession && config.nodeEnv !== "production",
        aiConfigured: Boolean(config.aiApiKey),
      };
    }
    const consent = await consentStatus(session.userId);
    return {
      authenticated: true,
      user: { accountId: session.accountId },
      suspended: session.suspended,
      consentRequired: consent.required,
      consent,
      isAdmin: isAdmin(session.accountId),
      isOperator: isOperator(session.accountId),
      csrf_token: request.cookies[CSRF_COOKIE] ?? null,
      network: config.nearNetwork,
      sandbox: config.localSandboxMode,
      aiConfigured: Boolean(config.aiApiKey),
    };
  });

  app.post("/auth/logout", async (request, reply) => {
    const session = await sessionFrom(request);
    if (session) {
      await prisma.walletSession.update({ where: { id: session.sessionId }, data: { revokedAt: now() } });
    }
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    reply.clearCookie(CSRF_COOKIE, { path: "/" });
    return { ok: true };
  });

  const devSessionEnabled =
    config.localSandboxMode && config.allowDevSession && config.nodeEnv !== "production";

  app.post("/dev/session", async (request, reply) => {
    if (!devSessionEnabled || !config.ownerAccountId) {
      return reply.code(404).send({ error: "Not found", code: "NOT_FOUND" });
    }
    const { user, csrf, expiresAt } = await createSession(config.ownerAccountId, reply, request);
    return {
      user: { accountId: user.accountId },
      csrf_token: csrf,
      expires_at: expiresAt.toISOString(),
      mode: "sandbox",
      notice:
        "Local sandbox session: no wallet signature. Gated to sandbox mode and never available in production; contract checks still apply.",
    };
  });

  // ------------------------------------------------------------------ overview

  app.get("/overview", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    const tasks = await prisma.task.findMany({
      where: { ownerAccountId: session.accountId },
      include: {
        agents: true,
        operations: {
          include: { agent: true, chainTransactions: { orderBy: { createdAt: "desc" as const } } },
          orderBy: { createdAt: "desc" },
          take: 8,
        },
        providerResults: true,
      },
      orderBy: { updatedAt: "desc" },
    });
    const totals = tasks.reduce(
      (acc, task) => ({
        available: acc.available + BigInt(task.availableYocto),
        reserved: acc.reserved + BigInt(task.reservedYocto),
        spent: acc.spent + BigInt(task.spentYocto),
      }),
      { available: 0n, reserved: 0n, spent: 0n },
    );
    const recent = tasks
      .flatMap((task) =>
        task.operations.map((operation) => ({
          ...operationDto(operation),
          taskName: task.name,
        })),
      )
      .slice(0, 8);
    return {
      totals: {
        availableYocto: totals.available.toString(),
        reservedYocto: totals.reserved.toString(),
        spentYocto: totals.spent.toString(),
        includedTaskIds: tasks.map((task) => task.id),
      },
      tasks: tasks.map((task) => ({
        id: task.id,
        chainTaskId: task.chainTaskId,
        name: task.name,
        status: task.status.toLowerCase(),
        paused: task.paused,
        agentCount: task.agents.length,
        totalFundedYocto: task.totalFundedYocto,
        availableYocto: task.availableYocto,
        reservedYocto: task.reservedYocto,
        spentYocto: task.spentYocto,
        updatedAt: task.updatedAt.toISOString(),
        pendingRecoveries: task.operations.filter((op) => op.needsRecovery).length,
      })),
      recentOperations: recent,
      pendingRecoveries: tasks.reduce(
        (count, task) => count + task.operations.filter((operation) => operation.needsRecovery).length,
        0,
      ),
      network: config.nearNetwork,
      contractId: config.contractId,
      chain: { status: "configured", rpcUrl: config.nearRpcUrl },
    };
  });

  app.get("/catalog", async (_request, reply) => {
    try {
      const response = await fetch(`${config.providerOrigin.replace(/\/+$/, "")}/catalog`, {
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) throw new Error(`provider catalog returned ${response.status}`);
      const body = (await response.json()) as Record<string, unknown>;
      if (body.provider_account_id !== config.providerAccountId) {
        return reply.code(502).send({ error: "Provider account mismatch", code: "PROVIDER_MISMATCH" });
      }
      return body;
    } catch (error) {
      return reply.code(503).send({
        error: error instanceof Error ? error.message : "Provider catalog unavailable",
        code: "CATALOG_UNAVAILABLE",
      });
    }
  });

  app.get("/activity", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    const events = await prisma.auditEvent.findMany({
      where: { task: { ownerAccountId: session.accountId } },
      orderBy: { id: "desc" },
      take: 50,
    });
    return { events: events.map(toActivityEvent) };
  });

  // --------------------------------------------------------------------- tasks

  app.get("/tasks", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    const tasks = await prisma.task.findMany({
      where: { ownerAccountId: session.accountId },
      include: { agents: true, operations: true },
      orderBy: { updatedAt: "desc" },
    });
    return {
      tasks: tasks.map((task) => ({
        id: task.id,
        chainTaskId: task.chainTaskId,
        name: task.name,
        objective: task.objective,
        status: task.status.toLowerCase(),
        paused: task.paused,
        agentCount: task.agents.length,
        agents: task.agents.map((agent) => ({
          id: agent.id,
          label: agent.label,
          accountId: agent.accountId,
          status: agent.status.toLowerCase(),
          publicKey: agent.publicKey,
          keyConfigured: agentKeyConfigured(config, agent.accountId),
        })),
        totalFundedYocto: task.totalFundedYocto,
        availableYocto: task.availableYocto,
        reservedYocto: task.reservedYocto,
        spentYocto: task.spentYocto,
        updatedAt: task.updatedAt.toISOString(),
        createdAt: task.createdAt.toISOString(),
        pendingRecoveries: task.operations.filter((operation) => operation.needsRecovery).length,
      })),
    };
  });

  app.post("/tasks", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    if (!checkCsrf(request, session, reply)) return;
    const parsed = createTaskSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: parsed.error.issues[0]?.message ?? "Invalid task", code: "VALIDATION_ERROR", issues: parsed.error.issues });
    }
    if (config.localSandboxMode && config.ownerAccountId && session.accountId !== config.ownerAccountId) {
      return reply.code(403).send({
        error: `Sandbox mode is restricted to ${config.ownerAccountId}`,
        code: "SANDBOX_OWNER_REQUIRED",
      });
    }
    const workers = config.workerAccounts;
    if (workers.length !== 2) {
      return reply.code(503).send({
        error: "Exactly two worker accounts must be configured",
        code: "WORKERS_NOT_CONFIGURED",
        required: ["WORKER_ONE_ACCOUNT_ID", "WORKER_ONE_PRIVATE_KEY", "WORKER_TWO_ACCOUNT_ID", "WORKER_TWO_PRIVATE_KEY"],
      });
    }
    let budgetYocto: bigint;
    let maxPerOperationYocto: bigint;
    try {
      budgetYocto = parseNearToYocto(parsed.data.budget_near);
      maxPerOperationYocto = parseNearToYocto(parsed.data.max_per_operation_near);
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : "Invalid amount",
        code: "INVALID_AMOUNT",
      });
    }
    if (budgetYocto <= 0n || maxPerOperationYocto <= 0n) {
      return reply.code(400).send({ error: "Budget and per-operation limit must be positive", code: "INVALID_AMOUNT" });
    }
    if (maxPerOperationYocto > budgetYocto) {
      return reply.code(400).send({
        error: "Per-operation limit cannot exceed the task budget",
        code: "LIMIT_EXCEEDS_BUDGET",
      });
    }
    let chainConfigValue;
    try {
      chainConfigValue = await chainConfig();
    } catch {
      return reply.code(503).send({ error: "Could not read the contract configuration", code: "CHAIN_UNAVAILABLE" });
    }
    const publicKeys = workers.map((worker) => ({
      ...worker,
      publicKey: chain.publicKeyFor(worker.accountId),
    }));
    if (publicKeys.some((worker) => !worker.publicKey)) {
      return reply.code(503).send({
        error: "Worker signing keys are not available to the API",
        code: "WORKER_KEYS_MISSING",
        required: workers.map((worker) => worker.envVar),
      });
    }
    let currentBlock: number;
    try {
      currentBlock = await chain.getCurrentBlock();
    } catch {
      // Never fall back to block 0: the task expiry would already be in the past and
      // the owner's setup transaction would fail much later with a confusing error.
      return reply.code(503).send({ error: "Could not read the current block", code: "CHAIN_UNAVAILABLE" });
    }
    let chainTaskId = "";
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = `${slugify(parsed.data.name)}-${randomToken(3).replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toLowerCase()}`;
      const collision = await prisma.task.findUnique({ where: { chainTaskId: candidate } });
      if (!collision) {
        chainTaskId = candidate;
        break;
      }
    }
    if (!chainTaskId) {
      return reply.code(409).send({ error: "Could not allocate a task id", code: "TASK_ID_COLLISION" });
    }

    const created = await prisma.$transaction(async (tx) => {
      const task = await tx.task.create({
        data: {
          chainTaskId,
          contractId: config.contractId,
          network: config.nearNetwork,
          ownerAccountId: session.accountId,
          ownerUserId: session.userId,
          name: parsed.data.name,
          objective: parsed.data.objective,
          status: TaskStatus.DRAFT,
          maxPerOperationYocto: maxPerOperationYocto.toString(),
          allowedProviders: [config.providerAccountId],
          reservationTtlBlocks: parsed.data.reservation_ttl_blocks,
          expiresAtBlock: BigInt(currentBlock + parsed.data.expires_in_blocks),
          setupStorageDepositYocto: chainConfigValue!.task_storage_deposit,
          budgetGoalYocto: budgetYocto.toString(),
        },
      });
      for (const document of parsed.data.documents) {
        await tx.document.create({
          data: {
            taskId: task.id,
            label: document.label,
            filename: `${slugify(document.label)}.txt`,
            contentCiphertext: encryptDocument(document.text, config.documentEncryptionKey),
            contentHash: computeRequestHash("document", { text: document.text }),
            byteSize: Buffer.byteLength(document.text, "utf8"),
          },
        });
      }
      for (const worker of publicKeys) {
        await tx.agent.create({
          data: {
            taskId: task.id,
            label: worker.slot === 1 ? "Agent one" : "Agent two",
            slot: worker.slot,
            accountId: worker.accountId,
            publicKey: worker.publicKey!,
            keyEnvVar: worker.envVar,
          },
        });
      }
      return task;
    });
    await recordAudit(prisma, {
      taskId: created.id,
      type: "task.created",
      actor: session.accountId,
      summary: `Task "${created.name}" created with a ${parsed.data.budget_near} NEAR budget plan.`,
      data: {
        chain_task_id: created.chainTaskId,
        budget_goal_yocto: budgetYocto.toString(),
        max_per_operation_yocto: maxPerOperationYocto.toString(),
      },
    });
    const bundle = await prisma.task.findUnique({ where: { id: created.id }, include: taskInclude });
    if (!bundle) throw new Error("Task creation failed");
    return reply.code(201).send({
      task: await taskDto(bundle, { refresh: false }),
      setup_required: true,
      next: `Call GET /tasks/${created.id}/setup-plan, sign the actions with the owner wallet, then POST /tasks/${created.id}/confirm.`,
    });
  });

  app.get("/tasks/:id", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    const parsed = z.object({ id: z.string() }).safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid task id" });
    const task = await loadOwnedTask(parsed.data.id, session, reply);
    if (!task) return;
    return { task: await taskDto(task) };
  });

  app.get("/tasks/:id/documents/:documentId", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    const parsed = z
      .object({ id: z.string(), documentId: z.string() })
      .safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid document request" });
    const task = await loadOwnedTask(parsed.data.id, session, reply);
    if (!task) return;
    const document = task.documents.find((candidate) => candidate.id === parsed.data.documentId);
    if (!document) return reply.code(404).send({ error: "Document not found", code: "DOCUMENT_NOT_FOUND" });
    try {
      return {
        id: document.id,
        label: document.label,
        sha256: document.contentHash,
        text: decryptDocument(document.contentCiphertext, config.documentEncryptionKey),
      };
    } catch {
      return reply.code(500).send({ error: "Document could not be decrypted", code: "DOCUMENT_DECRYPT_FAILED" });
    }
  });

  app.get("/tasks/:id/setup-plan", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    const parsed = z.object({ id: z.string() }).safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid task id" });
    const task = await loadOwnedTask(parsed.data.id, session, reply);
    if (!task) return;
    if (task.status !== TaskStatus.DRAFT && task.status !== TaskStatus.AWAITING_FUNDING) {
      return reply.code(409).send({ error: "Task already activated", code: "TASK_ALREADY_ACTIVE" });
    }
    let chainConfigValue;
    try {
      chainConfigValue = await chainConfig();
    } catch {
      return reply.code(503).send({ error: "Could not read contract configuration", code: "CHAIN_UNAVAILABLE" });
    }
    const agents = task.agents.map((agent) => ({ accountId: agent.accountId, publicKey: agent.publicKey }));
    if (agents.length !== 2) {
      return reply.code(409).send({ error: "Two registered agents are required", code: "AGENTS_INCOMPLETE" });
    }
    const policy: ContractPolicyInput = {
      max_per_operation: task.maxPerOperationYocto,
      allowed_providers: task.allowedProviders,
      reservation_ttl_blocks: task.reservationTtlBlocks,
      expires_at_block: Number(task.expiresAtBlock),
    };
    const plan = buildTaskSetupPlan(
      {
        taskId: task.chainTaskId,
        name: task.name,
        policy,
        fundingYocto: task.budgetGoalYocto,
        agents,
        config: chainConfigValue,
      },
      config.contractId,
    );
    return {
      ...chainActionPlan(plan.actions, plan.receiverId, config.nearNetwork),
      summary: plan.summary,
      task_id: task.chainTaskId,
      owner_account_id: task.ownerAccountId,
      network: config.nearNetwork,
      contract_id: config.contractId,
      notice:
        "Storage deposits are separate from the spendable budget and are non-refundable in this MVP. Sign all actions in one owner-wallet transaction.",
    };
  });

  app.post("/tasks/:id/confirm", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    if (!checkCsrf(request, session, reply)) return;
    const params = z.object({ id: z.string() }).safeParse(request.params);
    const body = z.object({ tx_hash: z.string().min(20).max(120) }).safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ error: "Invalid confirmation payload", code: "VALIDATION_ERROR" });
    }
    const task = await loadOwnedTask(params.data.id, session, reply);
    if (!task) return;
    const outcome = await chain.transactionStatus(body.data.tx_hash, task.ownerAccountId);
    if (outcome.status === "not_found") {
      return reply.code(409).send({
        error: "Transaction is not final yet; retry confirmation",
        code: "TX_NOT_FINAL",
        tx_hash: body.data.tx_hash,
      });
    }
    if (outcome.status !== "success") {
      return reply.code(409).send({
        error: outcome.errorMessage ?? "Transaction did not succeed",
        code: outcome.errorCode ?? "TX_FAILED",
        tx_hash: body.data.tx_hash,
      });
    }
    try {
      const fresh = await activateTask(task, body.data.tx_hash, "CREATE_TASK");
      return { task: await taskDto(fresh) };
    } catch (error) {
      const code = error instanceof ChainDenialError ? error.code : "ACTIVATION_FAILED";
      return reply.code(409).send({
        error: error instanceof Error ? error.message : "Activation failed",
        code: code ?? "ACTIVATION_FAILED",
        tx_hash: body.data.tx_hash,
      });
    }
  });

  app.post("/dev/tasks/:id/submit-setup", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    if (!checkCsrf(request, session, reply)) return;
    if (!devSessionEnabled) return reply.code(404).send({ error: "Not found", code: "NOT_FOUND" });
    const params = z.object({ id: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid task id" });
    const task = await loadOwnedTask(params.data.id, session, reply);
    if (!task) return;
    if (!chain.hasSigner(task.ownerAccountId)) {
      return reply.code(503).send({
        error: "Sandbox owner signing key is not configured",
        code: "SANDBOX_OWNER_KEY_MISSING",
        required: ["SANDBOX_OWNER_PRIVATE_KEY"],
      });
    }
    if (task.status !== TaskStatus.DRAFT && task.status !== TaskStatus.AWAITING_FUNDING) {
      return reply.code(409).send({ error: "Task already activated", code: "TASK_ALREADY_ACTIVE" });
    }
    const chainConfigValue = await chainConfig();
    const policy: ContractPolicyInput = {
      max_per_operation: task.maxPerOperationYocto,
      allowed_providers: task.allowedProviders,
      reservation_ttl_blocks: task.reservationTtlBlocks,
      expires_at_block: Number(task.expiresAtBlock),
    };
    const plan = buildTaskSetupPlan(
      {
        taskId: task.chainTaskId,
        name: task.name,
        policy,
        fundingYocto: task.budgetGoalYocto,
        agents: task.agents.map((agent) => ({ accountId: agent.accountId, publicKey: agent.publicKey })),
        config: chainConfigValue,
      },
      config.contractId,
    );
    let prepared: PreparedTransaction;
    try {
      prepared = await chain.prepareBatch({ signerAccountId: task.ownerAccountId, actions: plan.actions });
    } catch (error) {
      return reply.code(503).send({
        error: error instanceof Error ? error.message : "Could not prepare setup transaction",
        code: "CHAIN_UNAVAILABLE",
      });
    }
    await recordPreparedTx(task, prepared, "CREATE_TASK");
    try {
      const outcome = await chain.submit(prepared);
      await recordTxOutcome(outcome.txHash, "SUCCESS", { outcome: outcome.raw });
      const fresh = await activateTask(task, outcome.txHash, "CREATE_TASK");
      return { task: await taskDto(fresh), tx_hash: outcome.txHash };
    } catch (error) {
      const txHash = error instanceof ChainDenialError || error instanceof ChainTransportError ? error.txHash : prepared.txHash;
      if (txHash) await recordTxOutcome(txHash, "FAILED", { error: error instanceof Error ? error.message : String(error) });
      const code = error instanceof ChainDenialError ? error.code : "SETUP_TX_FAILED";
      return reply.code(409).send({
        error: error instanceof Error ? error.message : "Setup transaction failed",
        code: code ?? "SETUP_TX_FAILED",
        tx_hash: txHash,
      });
    }
  });

  app.get("/tasks/:id/budget", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    const params = z.object({ id: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid task id" });
    const task = await loadOwnedTask(params.data.id, session, reply);
    if (!task) return;
    try {
      const budget: ChainBudgetView | null = await chain.getBudget(task.chainTaskId);
      if (!budget) return reply.code(404).send({ error: "Task not on chain", code: "TASK_NOT_ON_CHAIN" });
      return { budget, source: "chain" };
    } catch {
      return reply.code(503).send({
        error: "Chain read failed; last verified projection follows",
        code: "CHAIN_UNAVAILABLE",
        budget: budgetDto(task, null, true),
      });
    }
  });

  // --------------------------------------------------------------- owner actions

  async function planOwnerAction(task: TaskBundle, action: z.infer<typeof actionSchema>) {
    switch (action.action) {
      case "pause":
      case "resume":
        return [
          {
            methodName: action.action === "pause" ? "pause_task" : "resume_task",
            args: { task_id: task.chainTaskId },
            gasTgas: 40,
            depositYocto: "0",
          } satisfies ActionSpec,
        ];
      case "fund": {
        if (!action.amount_near) throw new Error("amount_near is required to fund");
        const amount = parseNearToYocto(action.amount_near).toString();
        return [
          { methodName: "fund_task", args: { task_id: task.chainTaskId }, gasTgas: 50, depositYocto: amount } satisfies ActionSpec,
        ];
      }
      case "revoke_agent": {
        const accountId = action.agent_account_id;
        if (!accountId) throw new Error("agent_account_id is required to revoke an agent");
        const agent = task.agents.find((candidate) => candidate.accountId === accountId);
        if (!agent) throw new Error("Agent is not registered for this task");
        if (agent.status === "REVOKED") throw new Error("Agent is already revoked");
        return [
          {
            methodName: "revoke_agent",
            args: { task_id: task.chainTaskId, account_id: accountId },
            gasTgas: 40,
            depositYocto: "0",
          } satisfies ActionSpec,
        ];
      }
      case "withdraw": {
        if (!action.amount_near) throw new Error("amount_near is required to withdraw");
        const amount = parseNearToYocto(action.amount_near);
        if (amount <= 0n) throw new Error("Withdrawal must be positive");
        const chainConfigValue = await chainConfig();
        return [
          {
            methodName: "withdraw_available",
            args: { task_id: task.chainTaskId, amount: amount.toString() },
            gasTgas: 50,
            depositYocto: chainConfigValue.withdrawal_storage_deposit,
          } satisfies ActionSpec,
        ];
      }
    }
  }

  app.post("/tasks/:id/actions/plan", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    if (!checkCsrf(request, session, reply)) return;
    const params = z.object({ id: z.string() }).safeParse(request.params);
    const body = actionSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "Invalid action", code: "VALIDATION_ERROR" });
    const task = await loadOwnedTask(params.data.id, session, reply);
    if (!task) return;
    try {
      const actions = await planOwnerAction(task, body.data);
      return {
        ...chainActionPlan(actions, config.contractId, config.nearNetwork),
        action: body.data.action,
        notice:
          body.data.action === "withdraw"
            ? "Withdrawal includes a separate non-refundable storage deposit. Reserved funds cannot be withdrawn."
            : null,
      };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "Invalid action", code: "ACTION_INVALID" });
    }
  });

  app.post("/tasks/:id/actions/confirm", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    if (!checkCsrf(request, session, reply)) return;
    const params = z.object({ id: z.string() }).safeParse(request.params);
    const body = z
      .object({
        tx_hash: z.string().min(20).max(120),
        action: z.enum(["pause", "resume", "fund", "withdraw", "revoke_agent"]),
        agent_account_id: accountIdSchema.optional(),
      })
      .safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "Invalid action confirmation", code: "VALIDATION_ERROR" });
    const task = await loadOwnedTask(params.data.id, session, reply);
    if (!task) return;
    const outcome = await chain.transactionStatus(body.data.tx_hash, task.ownerAccountId);
    if (outcome.status !== "success") {
      return reply.code(409).send({
        error: outcome.errorMessage ?? "Transaction did not succeed",
        code: outcome.errorCode ?? "TX_FAILED",
      });
    }
    const kindMap = {
      pause: "PAUSE_TASK",
      resume: "RESUME_TASK",
      fund: "FUND_TASK",
      withdraw: "WITHDRAW",
      revoke_agent: "REVOKE_AGENT",
    } as const;
    await prisma.chainTransaction.upsert({
      where: { txHash: body.data.tx_hash },
      update: { status: "SUCCESS", confirmedAt: now() },
      create: {
        taskId: task.id,
        kind: kindMap[body.data.action],
        status: "SUCCESS",
        txHash: body.data.tx_hash,
        signerAccountId: task.ownerAccountId,
        receiverId: task.contractId,
        network: task.network,
        confirmedAt: now(),
      },
    });
    if (body.data.action === "revoke_agent" && body.data.agent_account_id) {
      await prisma.agent.updateMany({
        where: { taskId: task.id, accountId: body.data.agent_account_id },
        data: { status: "REVOKED" },
      });
    }
    const fresh = await prisma.task.findUnique({ where: { id: task.id }, include: taskInclude });
    if (!fresh) throw new Error("Task vanished");
    const refreshed = await taskDto(fresh);
    await recordAudit(prisma, {
      taskId: task.id,
      type:
        body.data.action === "pause"
          ? "task.paused"
          : body.data.action === "resume"
            ? "task.resumed"
            : body.data.action === "fund"
              ? "task.funded"
              : body.data.action === "revoke_agent"
                ? "agent.revoked"
                : "withdrawal.dispatched",
      actor: session.accountId,
      summary:
        body.data.action === "pause"
          ? "Owner paused the task."
          : body.data.action === "resume"
            ? "Owner resumed the task."
            : body.data.action === "fund"
              ? "Owner funded the task."
              : body.data.action === "revoke_agent"
                ? `Owner revoked ${body.data.agent_account_id}; future execution is blocked, already-dispatched transfers are unaffected.`
                : "Owner started a withdrawal.",
      data: { tx_hash: body.data.tx_hash, action: body.data.action, agent_account_id: body.data.agent_account_id ?? null },
      dedupeKey: `action:${body.data.tx_hash}`,
    });
    return { task: refreshed, tx_hash: body.data.tx_hash };
  });

  app.post("/dev/tasks/:id/actions", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    if (!checkCsrf(request, session, reply)) return;
    if (!devSessionEnabled) return reply.code(404).send({ error: "Not found", code: "NOT_FOUND" });
    const params = z.object({ id: z.string() }).safeParse(request.params);
    const body = actionSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "Invalid action", code: "VALIDATION_ERROR" });
    const task = await loadOwnedTask(params.data.id, session, reply);
    if (!task) return;
    if (!chain.hasSigner(task.ownerAccountId)) {
      return reply.code(503).send({ error: "Sandbox owner key missing", code: "SANDBOX_OWNER_KEY_MISSING" });
    }
    const actions = await planOwnerAction(task, body.data);
    const action = actions[0]!;
    try {
      const preview = await chain.prepare({
        signerAccountId: task.ownerAccountId,
        methodName: action.methodName,
        args: action.args,
        gasTgas: action.gasTgas,
        depositYocto: action.depositYocto,
      });
      const kind =
        body.data.action === "withdraw"
          ? "WITHDRAW"
          : body.data.action === "pause"
            ? "PAUSE_TASK"
            : body.data.action === "resume"
              ? "RESUME_TASK"
              : body.data.action === "revoke_agent"
                ? "REVOKE_AGENT"
                : "FUND_TASK";
      await recordPreparedTx(task, preview, kind);
      const outcome = await chain.submit(preview);
      await recordTxOutcome(outcome.txHash, "SUCCESS", { outcome: outcome.raw });
      if (body.data.action === "revoke_agent" && body.data.agent_account_id) {
        await prisma.agent.updateMany({
          where: { taskId: task.id, accountId: body.data.agent_account_id },
          data: { status: "REVOKED" },
        });
      }
      const fresh = await prisma.task.findUnique({ where: { id: task.id }, include: taskInclude });
      if (!fresh) throw new Error("Task vanished");
      await recordAudit(prisma, {
        taskId: task.id,
        type:
          body.data.action === "pause"
            ? "task.paused"
            : body.data.action === "resume"
              ? "task.resumed"
              : body.data.action === "fund"
                ? "task.funded"
                : body.data.action === "revoke_agent"
                  ? "agent.revoked"
                  : "withdrawal.dispatched",
        actor: session.accountId,
        summary: `Sandbox owner action: ${body.data.action}.`,
        data: { tx_hash: outcome.txHash, agent_account_id: body.data.agent_account_id ?? null },
        dedupeKey: `action:${outcome.txHash}`,
      });
      return { task: await taskDto(fresh), tx_hash: outcome.txHash };
    } catch (error) {
      const code = error instanceof ChainDenialError ? error.code : "ACTION_FAILED";
      return reply.code(409).send({
        error: error instanceof Error ? error.message : "Action failed",
        code: code ?? "ACTION_FAILED",
      });
    }
  });

  // ------------------------------------------------------------------- events

  app.get("/tasks/:id/events", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    const params = z.object({ id: z.string() }).safeParse(request.params);
    const query = z
      .object({ after: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).default(100) })
      .safeParse(request.query);
    if (!params.success || !query.success) return reply.code(400).send({ error: "Invalid event query" });
    const task = await loadOwnedTask(params.data.id, session, reply);
    if (!task) return;
    let after = 0n;
    if (query.data.after && /^\d+$/.test(query.data.after)) after = BigInt(query.data.after);
    const events = await prisma.auditEvent.findMany({
      where: { taskId: task.id, id: { gt: after } },
      orderBy: { id: "asc" },
      take: query.data.limit,
    });
    return { events: events.map(toActivityEvent) };
  });

  app.get("/tasks/:id/events/stream", async (request, reply) => {
    const session = await sessionFrom(request);
    if (!session) return reply.code(401).send({ error: "Sign in required" });
    const params = z.object({ id: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid task id" });
    const task = await prisma.task.findUnique({ where: { id: params.data.id } });
    if (!task || task.ownerAccountId !== session.accountId) {
      return reply.code(404).send({ error: "Task not found" });
    }
    const streamsForAccount = openStreams.get(session.accountId) ?? 0;
    if (streamsForAccount >= SSE_MAX_STREAMS_PER_ACCOUNT) {
      return reply.code(429).send({ error: "Too many open event streams", code: "STREAM_LIMIT" });
    }
    openStreams.set(session.accountId, streamsForAccount + 1);
    const headerId = request.headers["last-event-id"];
    const query = z.object({ after: z.string().optional() }).safeParse(request.query);
    let cursor =
      typeof headerId === "string" && /^\d+$/.test(headerId)
        ? BigInt(headerId)
        : query.success && query.data.after && /^\d+$/.test(query.data.after)
          ? BigInt(query.data.after)
          : 0n;

    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      "access-control-allow-origin": config.webOrigin,
      "access-control-allow-credentials": "true",
    });
    let closed = false;
    let pumping = false;
    let ticks = 0;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      const remaining = (openStreams.get(session.accountId) ?? 1) - 1;
      if (remaining > 0) openStreams.set(session.accountId, remaining);
      else openStreams.delete(session.accountId);
    };
    request.raw.on("close", cleanup);
    request.raw.on("error", cleanup);

    const writeEvent = (event: ReturnType<typeof toActivityEvent>) => {
      reply.raw.write(`id: ${event.id}\nevent: activity\ndata: ${JSON.stringify(event)}\n\n`);
      cursor = BigInt(event.id);
    };

    const pump = async () => {
      if (closed || pumping) return;
      pumping = true;
      try {
        const rows = await prisma.auditEvent.findMany({
          where: { taskId: task.id, id: { gt: cursor } },
          orderBy: { id: "asc" },
          take: 100,
        });
        for (const row of rows) writeEvent(toActivityEvent(row));
        ticks += 1;
        if (ticks % SSE_SESSION_RECHECK_TICKS === 0) {
          // A logged-out or expired session must stop receiving task events.
          const current = await sessionFrom(request);
          if (!current || current.sessionId !== session.sessionId) {
            reply.raw.write(`event: error\ndata: ${JSON.stringify({ code: "SESSION_ENDED" })}\n\n`);
            cleanup();
            reply.raw.end();
            return;
          }
        }
        if (ticks % 15 === 0) reply.raw.write(`: heartbeat ${new Date().toISOString()}\n\n`);
      } catch {
        reply.raw.write(`event: error\ndata: ${JSON.stringify({ code: "EVENT_STREAM_ERROR" })}\n\n`);
      } finally {
        pumping = false;
      }
    };
    const timer = setInterval(() => void pump(), 1_000);
    await pump();
    return reply;
  });

  // ----------------------------------------------------------------- runs/demos

  async function startRun(
    task: TaskBundle,
    options: { mode: "live" | "scripted"; scenario?: "A" | "B" | "C" | "D"; fault?: boolean },
  ) {
    if (options.mode === "live" && !config.aiApiKey) {
      const error = new Error(
        "Live AI is not configured. Set AI_API_KEY (and optionally AI_BASE_URL, AI_MODEL), or run a clearly labelled scripted fixture.",
      ) as Error & { code?: string };
      error.code = "AI_NOT_CONFIGURED";
      throw error;
    }
    if (task.status !== TaskStatus.ACTIVE && task.status !== TaskStatus.PAUSED) {
      const error = new Error("Task must be active and funded to run agents") as Error & { code?: string };
      error.code = "TASK_NOT_RUNNABLE";
      throw error;
    }
    if (task.documents.length === 0) {
      const error = new Error("Task has no documents") as Error & { code?: string };
      error.code = "NO_DOCUMENTS";
      throw error;
    }
    const runId = randomToken(12);
    const agents = task.agents.filter((agent) => agent.status === "REGISTERED");
    if (agents.length === 0) {
      const error = new Error("No registered agents") as Error & { code?: string };
      error.code = "NO_AGENTS";
      throw error;
    }
    const runAgents = options.scenario === "D" ? agents.slice(0, 1) : agents;
    await prisma.$transaction(async (tx) => {
      for (const [index, agent] of runAgents.entries()) {
        const document = task.documents[Math.min(index, task.documents.length - 1)]!;
        await tx.agentRun.create({
          data: {
            taskId: task.id,
            agentId: agent.id,
            runId,
            mode: options.mode === "live" ? "LIVE" : "SCRIPTED",
            status: "QUEUED",
            documentId: document.id,
          },
        });
        await tx.job.create({
          data: {
            kind: "RUN_AGENT",
            taskId: task.id,
            dedupeKey: `run:${runId}:${agent.id}`,
            payload: {
              runId,
              taskId: task.id,
              agentId: agent.id,
              documentId: document.id,
              mode: options.mode,
              scenario: options.scenario ?? null,
              fault: options.fault && config.demoFaultInjection ? "drop_execute_response" : null,
            } as Prisma.InputJsonValue,
          },
        });
      }
    });
    await recordAudit(prisma, {
      taskId: task.id,
      type: "agent.run.started",
      actor: task.ownerAccountId,
      summary: `${options.mode === "live" ? "Live" : "Scripted"} run started for ${runAgents.length} agent(s).`,
      data: {
        run_id: runId,
        mode: options.mode,
        scenario: options.scenario ?? null,
        fault_injection: Boolean(options.fault && config.demoFaultInjection),
      },
    });
    return { runId, mode: options.mode, agentCount: runAgents.length };
  }

  app.post("/tasks/:id/runs", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    if (!checkCsrf(request, session, reply)) return;
    if (!consumeChainQuota(session, reply)) return;
    const params = z.object({ id: z.string() }).safeParse(request.params);
    const body = runSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "Invalid run request", code: "VALIDATION_ERROR" });
    const task = await loadOwnedTask(params.data.id, session, reply);
    if (!task) return;
    try {
      const run = await startRun(task, body.data);
      return reply.code(202).send({
        run_id: run.runId,
        mode: run.mode,
        agent_count: run.agentCount,
        notice:
          run.mode === "scripted"
            ? "Scripted fixture run. It exercises the real contract and provider but does not use a model."
            : null,
      });
    } catch (error) {
      const code = (error as { code?: string }).code ?? "RUN_FAILED";
      return reply.code(code === "AI_NOT_CONFIGURED" ? 409 : 409).send({
        error: error instanceof Error ? error.message : "Could not start run",
        code,
      });
    }
  });

  app.post("/tasks/:id/demo/:scenario", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    if (!checkCsrf(request, session, reply)) return;
    if (!consumeChainQuota(session, reply)) return;
    const params = z
      .object({ id: z.string(), scenario: z.enum(["A", "B", "C", "D"]) })
      .safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid scenario" });
    const task = await loadOwnedTask(params.data.id, session, reply);
    if (!task) return;
    const mode = config.aiApiKey ? "live" : "scripted";
    // Scenario C's adversarial probe signs with worker one. Run it before the
    // agents start so the same access key is not used by two processes at once
    // (NEAR requires strictly monotonic nonces per key).
    let probe: unknown = null;
    if (params.data.scenario === "C") {
      probe = await runPolicyProbe(task, session).catch((error) => ({
        error: error instanceof Error ? error.message : String(error),
        code: (error as { code?: string }).code ?? "PROBE_FAILED",
      }));
    }
    let run;
    try {
      run = await startRun(task, {
        mode,
        scenario: params.data.scenario,
        fault: params.data.scenario === "D",
      });
    } catch (error) {
      return reply.code(409).send({
        error: error instanceof Error ? error.message : "Could not start demo",
        code: (error as { code?: string }).code ?? "DEMO_FAILED",
      });
    }
    return reply.code(202).send({
      run_id: run.runId,
      scenario: params.data.scenario,
      mode,
      notice:
        mode === "scripted"
          ? "Scripted fixture: AI_API_KEY is not configured, so no model is used. Contract, provider and accounting are real."
          : "Live model run. Payment and policy enforcement remain deterministic.",
      policy_probe: probe,
      expected:
        params.data.scenario === "A"
          ? "Both agents reserve, pay once each and receive provider results."
          : params.data.scenario === "B"
            ? "Both agents race for 0.02 of a 0.03 budget; exactly one reservation succeeds and the other is denied or falls back."
            : params.data.scenario === "C"
              ? "The document contains an instruction to redirect payment. It is shown as untrusted text; the contract probe is rejected by policy."
              : "The execute response is dropped after submission. Recovery must find the same operation and payout, with no second payment.",
    });
  });

  async function runPolicyProbe(task: TaskBundle, session: SessionInfo) {
    if (!config.policyProbeProviderAccountId) {
      const error = new Error("Set POLICY_PROBE_PROVIDER_ACCOUNT_ID to a non-allowlisted provider account") as Error & { code?: string };
      error.code = "PROBE_NOT_CONFIGURED";
      throw error;
    }
    if (task.allowedProviders.includes(config.policyProbeProviderAccountId)) {
      const error = new Error("The probe provider is allowlisted; refusing to probe") as Error & { code?: string };
      error.code = "PROBE_PROVIDER_ALLOWLISTED";
      throw error;
    }
    const worker = config.workerAccounts[0];
    if (!worker || !chain.hasSigner(worker.accountId)) {
      const error = new Error("Worker one signing key is not configured for the policy probe") as Error & { code?: string };
      error.code = "PROBE_WORKER_MISSING";
      throw error;
    }
    // The probe and the worker process share one function-call key, and NEAR
    // nonces are per key. Refuse to probe while a run job is active so the two
    // processes do not sign with the same nonce.
    // Jobs do not record which worker key they will use, and worker concurrency
    // can run jobs from several tasks. Refuse while any job is active rather than
    // assuming this task's job is the only signer.
    const activeJobs = await prisma.job.count({
      where: { status: JobStatus.RUNNING },
    });
    if (activeJobs > 0) {
      const error = new Error(
        "A worker job is running. Retry the probe when the worker is idle.",
      ) as Error & { code?: string };
      error.code = "PROBE_WORKER_BUSY";
      throw error;
    }
    const agent = task.agents.find((candidate) => candidate.accountId === worker.accountId);
    if (!agent) {
      const error = new Error("Worker one is not registered on this task") as Error & { code?: string };
      error.code = "PROBE_AGENT_NOT_REGISTERED";
      throw error;
    }
    const service = await prisma.service.findFirst({ where: { active: true } });
    if (!service) {
      const error = new Error("No active service catalog entry for the probe") as Error & { code?: string };
      error.code = "PROBE_SERVICE_MISSING";
      throw error;
    }
    const currentBlock = await chain.getCurrentBlock();
    const amountYocto = "1"; // 1 yoctoNEAR: enough to prove the provider check, no meaningful spend.
    const requestHash = computeRequestHash(service.serviceId, { probe: "policy" });
    const expiresAtBlock = currentBlock + 500;
    const operationId = computeOperationId({
      network: task.network,
      contractId: task.contractId,
      taskId: task.chainTaskId,
      agentAccountId: worker.accountId,
      providerAccountId: config.policyProbeProviderAccountId,
      amountYocto,
      serviceId: service.serviceId,
      requestHash,
      outputSchemaHash: service.outputSchemaHash,
      policyVersion: task.policyVersion,
      expiresAtBlock,
    });
    const request: ContractReserveRequest = {
      task_id: task.chainTaskId,
      operation_id: operationId,
      agent_id: worker.accountId,
      provider_id: config.policyProbeProviderAccountId,
      amount: amountYocto,
      service_id: service.serviceId,
      request_hash: requestHash,
      output_schema_hash: service.outputSchemaHash,
      policy_version: task.policyVersion,
      expires_at_block: expiresAtBlock,
    };
    // The worker process also signs with this key. Its nonce state is independent,
    // so discard our cached state and read the access key from chain first. A
    // nonce race is safe to retry: reserve is idempotent for this operation id.
    let prepared: PreparedTransaction | null = null;
    let outcome: Awaited<ReturnType<NearChain["submit"]>> | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      chain.resetSignerNonce(worker.accountId);
      prepared = await chain.reserve(worker.accountId, request);
      await recordPreparedTx(task, prepared, "RESERVE");
      try {
        outcome = await chain.submit(prepared);
        break;
      } catch (error) {
        if (attempt === 1 || !isNonceError(error)) throw error;
        await recordTxOutcome(prepared.txHash, "FAILED", {
          error: "InvalidNonce; retrying the same operation id with a fresh nonce.",
        });
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
    if (!prepared || !outcome) throw new Error("Probe did not produce a transaction outcome");
    const preparedTxHash = prepared.txHash;
    const outcomeTxHash = outcome.txHash;
    try {
      await recordTxOutcome(outcomeTxHash, "SUCCESS", { outcome: outcome.raw });
      // Defensive: a probe must never leave funds locked. Cancel immediately.
      await chain.cancel(worker.accountId, task.chainTaskId, operationId).catch(() => undefined);
      await recordAudit(prisma, {
        taskId: task.id,
        operationId,
        type: "operation.denied",
        actor: worker.accountId,
        summary: "Policy probe unexpectedly succeeded; reservation was cancelled.",
        severity: "danger",
        data: { probe: true, code: "PROBE_UNEXPECTED_SUCCESS", tx_hash: outcomeTxHash },
        dedupeKey: `probe:${task.id}:${operationId}`,
      });
      return { denied: false, code: "PROBE_UNEXPECTED_SUCCESS", tx_hash: outcomeTxHash };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const code = error instanceof ChainDenialError ? error.code : null;
      // A transport failure or an unclassified rejection is not evidence that
      // the contract denied the provider. Never turn "unknown" into "denied".
      if (!(error instanceof ChainDenialError) || !code) {
        await recordTxOutcome(preparedTxHash, "UNKNOWN", { error: detail });
        await recordAudit(prisma, {
          taskId: task.id,
          operationId,
          type: "probe.unavailable",
          actor: worker.accountId,
          summary: "The adversarial provider probe did not produce a settled contract denial.",
          severity: "warning",
          data: {
            probe: true,
            code: "PROBE_UNAVAILABLE",
            tx_hash: preparedTxHash,
            error: detail.slice(0, 300),
            attempted_provider: config.policyProbeProviderAccountId,
            requested_by: session.accountId,
          },
          dedupeKey: `probe-unavailable:${task.id}:${operationId}:${preparedTxHash}`,
        });
        return {
          denied: false,
          code: "PROBE_UNAVAILABLE",
          error: detail.slice(0, 300),
          tx_hash: preparedTxHash,
          attempted_provider: config.policyProbeProviderAccountId,
        };
      }
      await recordTxOutcome(preparedTxHash, "FAILED", { error: detail });
      await recordAudit(prisma, {
        taskId: task.id,
        operationId,
        type: "operation.denied",
        actor: worker.accountId,
        summary: `Contract rejected the adversarial provider reservation (${code}).`,
        severity: "danger",
        data: {
          probe: true,
          code,
          tx_hash: preparedTxHash,
          attempted_provider: config.policyProbeProviderAccountId,
          requested_by: session.accountId,
        },
        dedupeKey: `probe:${task.id}:${operationId}`,
      });
      return {
        denied: true,
        code,
        tx_hash: preparedTxHash,
        attempted_provider: config.policyProbeProviderAccountId,
      };
    }
  }

  app.post("/tasks/:id/policy-probe", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    if (!checkCsrf(request, session, reply)) return;
    if (!consumeChainQuota(session, reply)) return;
    const params = z.object({ id: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid task id" });
    const task = await loadOwnedTask(params.data.id, session, reply);
    if (!task) return;
    try {
      return await runPolicyProbe(task, session);
    } catch (error) {
      return reply.code(409).send({
        error: error instanceof Error ? error.message : "Probe failed",
        code: (error as { code?: string }).code ?? "PROBE_FAILED",
      });
    }
  });

  // --------------------------------------------------------------- operations

  async function loadOwnedOperation(operationId: string, session: SessionInfo, reply: FastifyReply) {
    const operation = await prisma.operation.findUnique({
      where: { id: operationId },
      include: {
        task: { include: { agents: true, documents: true } },
        agent: true,
        chainTransactions: { orderBy: { createdAt: "desc" } },
        document: true,
      },
    });
    if (!operation || operation.task.ownerAccountId !== session.accountId) {
      reply.code(404).send({ error: "Operation not found", code: "OPERATION_NOT_FOUND" });
      return null;
    }
    return operation;
  }

  app.get("/operations/:id", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    const params = z.object({ id: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid operation id" });
    const operation = await loadOwnedOperation(params.data.id, session, reply);
    if (!operation) return;
    let chainView: ChainOperationView | null = null;
    try {
      chainView = await chain.getOperation(operation.chainTaskId, operation.operationId);
    } catch {
      /* show the projection with a stale warning */
    }
    const providerResult = await prisma.providerResult.findUnique({
      where: {
        chainTaskId_operationId: {
          chainTaskId: operation.chainTaskId,
          operationId: operation.operationId,
        },
      },
    });
    return {
      operation: {
        ...operationDto(operation),
        chainState: chainView
          ? {
              paymentState: chainView.payment_state,
              payoutAttempts: chainView.payout_attempts,
              settledAtBlock: chainView.settled_at_block,
              reservationExpiresAtBlock: chainView.reservation_expires_at_block,
              source: "chain",
            }
          : null,
        explorerUrl:
          config.nearNetwork === "testnet" && operation.chainTransactions[0]?.txHash
            ? `https://testnet.nearblocks.io/txns/${operation.chainTransactions[0].txHash}`
            : null,
        delivery: {
          status: providerResult?.status.toLowerCase() ?? operation.fulfillmentState.toLowerCase(),
          deliveredAt: providerResult?.deliveredAt?.toISOString() ?? null,
          attempts: providerResult?.attempts ?? 0,
          hasResult: Boolean(providerResult?.resultJson),
        },
      },
    };
  });

  app.get("/operations/:id/result", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    const params = z.object({ id: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid operation id" });
    const operation = await loadOwnedOperation(params.data.id, session, reply);
    if (!operation) return;
    const result = await prisma.providerResult.findUnique({
      where: {
        chainTaskId_operationId: {
          chainTaskId: operation.chainTaskId,
          operationId: operation.operationId,
        },
      },
    });
    if (!result || result.status !== "DELIVERED") {
      return reply.code(404).send({
        error: "No delivered result for this operation",
        code: "RESULT_NOT_READY",
        fulfillment_state: operation.fulfillmentState.toLowerCase(),
      });
    }
    return {
      operation_id: operation.operationId,
      request_hash: result.requestHash,
      delivered_at: result.deliveredAt?.toISOString() ?? null,
      result: providerResultResponseSchema.parse({
        operation_id: operation.operationId,
        status: "delivered",
        request_hash: result.requestHash,
        output_schema_hash: result.outputSchemaHash,
        result: result.resultJson,
        delivered_at: result.deliveredAt?.toISOString() ?? null,
        attempts: result.attempts,
        note: null,
      }).result,
    };
  });

  app.post("/operations/:id/recover", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    if (!checkCsrf(request, session, reply)) return;
    if (!consumeChainQuota(session, reply)) return;
    const params = z.object({ id: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid operation id" });
    const operation = await loadOwnedOperation(params.data.id, session, reply);
    if (!operation) return;
    if (operation.fulfillmentState === "DELIVERED" && operation.paymentState === "PAID") {
      return { already_complete: true, payment_state: "paid", fulfillment_state: "delivered" };
    }
    // A settled payment whose fulfillment is missing is exactly the lost-response
    // case: reconciliation must retrieve the stored provider result instead of
    // treating the operation as complete or starting a new purchase.
    const needsPaymentRecovery =
      operation.paymentState === "RESERVED" || operation.paymentState === "PAYOUT_PENDING";
    const needsFulfillmentRecovery =
      operation.paymentState === "PAID" && operation.fulfillmentState !== "DELIVERED";
    if (needsPaymentRecovery || needsFulfillmentRecovery) {
      await prisma.job.create({
        data: {
          kind: "RECOVER_OPERATION",
          taskId: operation.taskId,
          dedupeKey: `recover:${operation.id}:${jobDedupeBucket(now())}`,
          payload: { operationId: operation.id, reason: "manual-recovery" } as Prisma.InputJsonValue,
        },
      });
      await recordAudit(prisma, {
        taskId: operation.taskId,
        operationId: operation.id,
        type: "recovery.started",
        actor: session.accountId,
        summary: needsFulfillmentRecovery
          ? "Payment already settled; recovery will fetch the stored provider result without paying again."
          : "Recovery requested; PoolGuard will reconcile the original operation before any further action.",
        data: { operation_id: operation.operationId },
      });
      return reply.code(202).send({
        recovery_queued: true,
        operation_id: operation.operationId,
        reason: needsFulfillmentRecovery ? "payment_settled_fulfillment_missing" : "payment_unresolved",
      });
    }
    return { already_complete: false, payment_state: operation.paymentState.toLowerCase(), note: "No recovery action applies to this state." };
  });

  // ----------------------------------------------------------------- SDK-ish

  // Serialize identical purchase requests in this process so two concurrent calls
  // cannot both miss the in-flight lookup and create two operations.
  app.post("/tasks/:id/purchases/reserve", async (request, reply) => {
    const raw = (request.body ?? {}) as Record<string, unknown>;
    const params = (request.params ?? {}) as Record<string, unknown>;
    const lockKey = [params.id, raw.agent_account_id, raw.service_key, raw.document_id ?? ""].map(String).join("|");
    return purchaseLocks.run(lockKey, () => handleReservePurchase(request, reply));
  });

  async function handleReservePurchase(request: FastifyRequest, reply: FastifyReply) {
    const session = await requireSession(request, reply);
    if (!session) return;
    if (!checkCsrf(request, session, reply)) return;
    if (!consumeChainQuota(session, reply)) return;
    const params = z.object({ id: z.string() }).safeParse(request.params);
    const body = z
      .object({
        agent_account_id: accountIdSchema,
        service_key: z.string().min(1).max(64),
        document_id: z.string().optional(),
        execute: z.boolean().default(false),
      })
      .safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "Invalid purchase request", code: "VALIDATION_ERROR" });
    const task = await loadOwnedTask(params.data.id, session, reply);
    if (!task) return;
    const agent = task.agents.find((candidate) => candidate.accountId === body.data.agent_account_id);
    if (!agent) return reply.code(404).send({ error: "Agent not registered for this task", code: "AGENT_NOT_FOUND" });
    if (!chain.hasSigner(agent.accountId)) {
      return reply.code(503).send({ error: "This agent's signing key is not configured server-side", code: "WORKER_KEY_MISSING" });
    }
    const service = await prisma.service.findFirst({
      where: { serviceKey: body.data.service_key, active: true },
    });
    if (!service) return reply.code(404).send({ error: "Service not found", code: "SERVICE_NOT_FOUND" });
    if (task.allowedProviders.length === 0) {
      return reply.code(409).send({ error: "Task has no allowed provider", code: "PROVIDER_NOT_ALLOWED" });
    }
    const document = body.data.document_id
      ? task.documents.find((candidate) => candidate.id === body.data.document_id)
      : task.documents[0];
    if (!document) return reply.code(404).send({ error: "Document not found", code: "DOCUMENT_NOT_FOUND" });
    let text: string;
    try {
      text = decryptDocument(document.contentCiphertext, config.documentEncryptionKey);
    } catch {
      return reply.code(500).send({ error: "Document could not be decrypted", code: "DOCUMENT_DECRYPT_FAILED" });
    }
    const requestHash = computeRequestHash(service.serviceId, { document_text: text });

    // One logical purchase is task + agent + provider + service + exact input + amount +
    // output schema + policy version. A retried call (for example after
    // RESERVE_OUTCOME_UNKNOWN) must reuse that purchase. Deriving a fresh operation id
    // from a newer block height would reserve, and possibly pay, a second time.
    // This mirrors the contract: Reserved / PayoutPending / Paid are reusable, while
    // cancelled, expired and failed operations allow a new purchase.
    const inFlight = await prisma.operation.findFirst({
      where: {
        taskId: task.id,
        agentId: agent.id,
        providerAccountId: config.providerAccountId,
        serviceId: service.serviceId,
        amountYocto: service.priceYocto,
        requestHash,
        outputSchemaHash: service.outputSchemaHash,
        policyVersion: task.policyVersion,
        paymentState: { in: ["RESERVED", "PAYOUT_PENDING", "PAID"] },
      },
      orderBy: { createdAt: "desc" },
    });

    let operationId: string;
    let expiresAtBlock: number;
    let currentBlock: number;
    try {
      currentBlock = await chain.getCurrentBlock();
    } catch {
      return reply.code(503).send({ error: "Could not read the current block", code: "CHAIN_UNAVAILABLE" });
    }
    if (inFlight) {
      operationId = inFlight.operationId;
      expiresAtBlock = Number(inFlight.expiresAtBlock);
    } else {
      expiresAtBlock = Math.min(currentBlock + task.reservationTtlBlocks, Number(task.expiresAtBlock) - 1);
      operationId = computeOperationId({
        network: task.network,
        contractId: task.contractId,
        taskId: task.chainTaskId,
        agentAccountId: agent.accountId,
        providerAccountId: config.providerAccountId,
        amountYocto: service.priceYocto,
        serviceId: service.serviceId,
        requestHash,
        outputSchemaHash: service.outputSchemaHash,
        policyVersion: task.policyVersion,
        expiresAtBlock,
      });
    }
    const reserveRequest: ContractReserveRequest = {
      task_id: task.chainTaskId,
      operation_id: operationId,
      agent_id: agent.accountId,
      provider_id: config.providerAccountId,
      amount: service.priceYocto,
      service_id: service.serviceId,
      request_hash: requestHash,
      output_schema_hash: service.outputSchemaHash,
      policy_version: task.policyVersion,
      expires_at_block: expiresAtBlock,
    };

    let recorded = inFlight;
    if (!recorded) {
      const conflicting = await prisma.operation.findUnique({
        where: { chainTaskId_operationId: { chainTaskId: task.chainTaskId, operationId } },
      });
      if (conflicting) {
        return reply.code(409).send({ error: "Operation id is bound to different parameters", code: "OPERATION_ID_CONFLICT" });
      }
    }

    // If the chain already knows the original operation, never broadcast again.
    const knownView = recorded
      ? await chain.getOperation(task.chainTaskId, operationId).catch(() => null)
      : null;
    let reserveTxHash: string | null = null;

    if (recorded && knownView) {
      await prisma.operation.update({
        where: { id: recorded.id },
        data: {
          paymentState: mapPaymentState(knownView.payment_state),
          payoutAttempts: knownView.payout_attempts,
          needsRecovery: knownView.payment_state === "payout_pending",
          settledAtBlock: knownView.settled_at_block == null ? null : BigInt(knownView.settled_at_block),
          lastError: null,
        },
      });
      if (knownView.payment_state !== "reserved" || !body.data.execute) {
        return {
          operation_id: operationId,
          payment_state: knownView.payment_state,
          reused: true,
          note: "An identical purchase already exists; no new reservation was created.",
        };
      }
    } else {
      let prepared: PreparedTransaction;
      try {
        prepared = await chain.reserve(agent.accountId, reserveRequest);
      } catch (error) {
        return reply.code(503).send({ error: error instanceof Error ? error.message : "Could not prepare reservation", code: "CHAIN_UNAVAILABLE" });
      }
      reserveTxHash = prepared.txHash;
      const previewTx = await prisma.chainTransaction.create({
        data: {
          taskId: task.id,
          kind: "RESERVE",
          status: "PREPARED",
          txHash: prepared.txHash,
          signerAccountId: agent.accountId,
          receiverId: config.contractId,
          network: task.network,
          operationDbId: recorded?.id ?? null,
          outcome: jsonSafe({ method: "reserve", operation_id: operationId, rebroadcast: Boolean(recorded) }),
        },
      });
      if (!recorded) {
        recorded = await prisma.operation.create({
          data: {
            taskId: task.id,
            chainTaskId: task.chainTaskId,
            operationId,
            agentId: agent.id,
            providerAccountId: config.providerAccountId,
            serviceId: service.serviceId,
            amountYocto: service.priceYocto,
            requestHash,
            outputSchemaHash: service.outputSchemaHash,
            policyVersion: task.policyVersion,
            documentId: document.id,
            reservationExpiresAtBlock: BigInt(Math.min(currentBlock + task.reservationTtlBlocks, expiresAtBlock)),
            expiresAtBlock: BigInt(expiresAtBlock),
          },
        });
        await prisma.chainTransaction.update({ where: { id: previewTx.id }, data: { operationDbId: recorded.id } });
      }
      try {
        const outcome = await chain.submit(prepared);
        await recordTxOutcome(outcome.txHash, "SUCCESS", { outcome: outcome.raw });
        const chainView = await chain.getOperation(task.chainTaskId, operationId);
        await prisma.operation.update({
          where: { id: recorded.id },
          data: {
            paymentState: chainView ? mapPaymentState(chainView.payment_state) : "RESERVED",
            needsRecovery: chainView?.payment_state === "payout_pending",
            lastError: null,
            chainCreatedAtBlock: chainView?.created_at_block != null ? BigInt(chainView.created_at_block) : null,
            reservationExpiresAtBlock: chainView?.reservation_expires_at_block != null ? BigInt(chainView.reservation_expires_at_block) : recorded.reservationExpiresAtBlock,
          },
        });
        await recordAudit(prisma, {
          taskId: task.id,
          operationId: recorded.id,
          type: "operation.reserved",
          actor: agent.accountId,
          summary: `${agent.label} reserved ${service.priceYocto} yoctoNEAR for ${service.name}.`,
          data: { operation_id: operationId, tx_hash: outcome.txHash, amount_yocto: service.priceYocto },
          dedupeKey: `reserve:${task.id}:${operationId}`,
        });
      } catch (error) {
        if (error instanceof ChainDenialError) {
          await prisma.chainTransaction.update({ where: { txHash: prepared.txHash }, data: { status: "FAILED", errorMessage: error.message.slice(0, 500), confirmedAt: now() } }).catch(() => undefined);
          await prisma.operation.delete({ where: { id: recorded.id } }).catch(() => undefined);
          await recordAudit(prisma, {
            taskId: task.id,
            type: "operation.denied",
            actor: agent.accountId,
            summary: `Reservation denied: ${error.code ?? "UNKNOWN"}.`,
            data: { operation_id: operationId, code: error.code, tx_hash: prepared.txHash },
            dedupeKey: `denied:${prepared.txHash}`,
          });
          return reply.code(409).send({ error: error.message, code: error.code ?? "RESERVE_DENIED", operation_id: operationId });
        }
        await prisma.operation.update({ where: { id: recorded.id }, data: { needsRecovery: true, lastError: error instanceof Error ? error.message.slice(0, 300) : "unknown" } }).catch(() => undefined);
        return reply.code(502).send({
          error: "Reservation outcome is unknown; retrying this request reuses the original operation instead of creating a new payment",
          code: "RESERVE_OUTCOME_UNKNOWN",
          operation_id: operationId,
          tx_hash: prepared.txHash,
        });
      }
    }

    if (body.data.execute) {
      try {
        const execution = await chain.execute(agent.accountId, task.chainTaskId, operationId);
        await recordTxOutcome(execution.txHash, "SUCCESS", { outcome: execution.raw });
        const chainView = await chain.getOperation(task.chainTaskId, operationId);
        await prisma.operation.update({
          where: { id: recorded.id },
          data: {
            paymentState: chainView ? mapPaymentState(chainView.payment_state) : "PAYOUT_PENDING",
            payoutAttempts: chainView?.payout_attempts ?? 1,
            needsRecovery: chainView?.payment_state === "payout_pending",
            settledAtBlock: chainView?.settled_at_block == null ? null : BigInt(chainView.settled_at_block),
          },
        });
        await recordAudit(prisma, {
          taskId: task.id,
          operationId: recorded.id,
          type: "payment.dispatched",
          actor: agent.accountId,
          summary: `Payment dispatched to ${config.providerAccountId}.`,
          data: { operation_id: operationId, tx_hash: execution.txHash, amount_yocto: service.priceYocto },
          dedupeKey: `execute:${task.id}:${operationId}`,
        });
        return { operation_id: operationId, tx_hash: execution.txHash, payment_state: chainView?.payment_state ?? "payout_pending" };
      } catch (error) {
        const code = error instanceof ChainDenialError ? error.code : "EXECUTE_OUTCOME_UNKNOWN";
        await prisma.operation.update({ where: { id: recorded.id }, data: { needsRecovery: true, lastError: error instanceof Error ? error.message.slice(0, 300) : "unknown" } }).catch(() => undefined);
        return reply.code(code === "EXECUTE_OUTCOME_UNKNOWN" ? 502 : 409).send({
          error: error instanceof Error ? error.message : "Execution failed",
          code: code ?? "EXECUTE_FAILED",
          operation_id: operationId,
          tx_hash: error instanceof ChainTransportError ? error.txHash : reserveTxHash,
        });
      }
    }
    return { operation_id: operationId, payment_state: "reserved", tx_hash: reserveTxHash };
  }

  app.post("/operations/:id/execute", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    if (!checkCsrf(request, session, reply)) return;
    if (!consumeChainQuota(session, reply)) return;
    const params = z.object({ id: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid operation id" });
    const operation = await loadOwnedOperation(params.data.id, session, reply);
    if (!operation) return;
    if (!chain.hasSigner(operation.agent.accountId)) {
      return reply.code(503).send({ error: "Agent signing key is not configured", code: "WORKER_KEY_MISSING" });
    }
    try {
      const prepared = await chain.prepare({
        signerAccountId: operation.agent.accountId,
        methodName: "execute",
        args: { task_id: operation.chainTaskId, operation_id: operation.operationId },
        gasTgas: 120,
      });
      await recordPreparedTx(operation.task, prepared, "EXECUTE", operation.id);
      const outcome = await chain.submit(prepared);
      await recordTxOutcome(outcome.txHash, "SUCCESS", { outcome: outcome.raw });
      const chainView = await chain.getOperation(operation.chainTaskId, operation.operationId);
      await prisma.operation.update({
        where: { id: operation.id },
        data: {
          paymentState: chainView ? mapPaymentState(chainView.payment_state) : "PAYOUT_PENDING",
          payoutAttempts: chainView?.payout_attempts ?? operation.payoutAttempts + 1,
          needsRecovery: chainView?.payment_state === "payout_pending",
        },
      });
      return { operation_id: operation.operationId, tx_hash: outcome.txHash, payment_state: chainView?.payment_state ?? "payout_pending" };
    } catch (error) {
      const code = error instanceof ChainDenialError ? error.code : "EXECUTE_OUTCOME_UNKNOWN";
      if (error instanceof ChainTransportError && error.txHash) {
        await prisma.operation.update({ where: { id: operation.id }, data: { needsRecovery: true } }).catch(() => undefined);
      }
      return reply.code(code === "EXECUTE_OUTCOME_UNKNOWN" ? 502 : 409).send({
        error: error instanceof Error ? error.message : "Execution failed",
        code: code ?? "EXECUTE_FAILED",
      });
    }
  });

  // --------------------------------------------------------------- provider quote

  app.post("/tasks/:id/quote", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    if (!checkCsrf(request, session, reply)) return;
    const params = z.object({ id: z.string() }).safeParse(request.params);
    const body = quoteRequestApiSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "Invalid quote request" });
    const task = await loadOwnedTask(params.data.id, session, reply);
    if (!task) return;
    const document = body.data.document_id
      ? task.documents.find((candidate) => candidate.id === body.data.document_id)
      : task.documents[0];
    if (!document) return reply.code(404).send({ error: "Document not found" });
    let text: string;
    try {
      text = decryptDocument(document.contentCiphertext, config.documentEncryptionKey);
    } catch {
      return reply.code(500).send({ error: "Document could not be decrypted" });
    }
    try {
      const response = await fetch(`${config.providerOrigin.replace(/\/+$/, "")}/quotes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          service_key: body.data.service_key,
          document_label: document.label,
          document_text: text,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json) {
        return reply.code(502).send({ error: "Provider quote failed", code: "PROVIDER_QUOTE_FAILED", detail: json });
      }
      const quote = z
        .object({
          request_hash: hex64Schema,
          output_schema_hash: hex64Schema,
          price_yocto: z.string().refine(isYoctoString),
          service_key: z.string(),
          service_id: z.string(),
          expires_at: z.string(),
        })
        .parse(json);
      if (json.provider_account_id !== config.providerAccountId) {
        return reply.code(502).send({ error: "Provider account mismatch", code: "PROVIDER_MISMATCH" });
      }
      const service = await prisma.service.findFirst({ where: { serviceKey: quote.service_key, active: true } });
      if (service) {
        await prisma.quote.create({
          data: {
            taskId: task.id,
            serviceId: service.id,
            documentId: document.id,
            providerQuoteId: String((json as { quote_id?: string }).quote_id ?? randomToken(8)),
            requestHash: quote.request_hash,
            outputSchemaHash: quote.output_schema_hash,
            priceYocto: quote.price_yocto,
            expiresAt: new Date(quote.expires_at),
          },
        });
      }
      return { quote: json, pricing: "fixed_catalog" };
    } catch (error) {
      return reply.code(502).send({
        error: error instanceof Error ? error.message : "Provider unreachable",
        code: "PROVIDER_UNAVAILABLE",
      });
    }
  });

  app.get("/runs/:runId", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    const params = z.object({ runId: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid run id" });
    const runs = await prisma.agentRun.findMany({
      where: { runId: params.data.runId },
      include: { agent: true, task: true },
    });
    if (runs.length === 0 || runs.some((run) => run.task.ownerAccountId !== session.accountId)) {
      return reply.code(404).send({ error: "Run not found", code: "RUN_NOT_FOUND" });
    }
    return {
      run_id: params.data.runId,
      mode: runs[0]!.mode.toLowerCase(),
      status: runs.every((run) => run.status === "SUCCEEDED")
        ? "succeeded"
        : runs.some((run) => run.status === "FAILED")
          ? "failed"
          : runs.every((run) => run.status === "QUEUED")
            ? "queued"
            : runs.some((run) => run.status === "PARTIAL")
              ? "partial"
              : "running",
      agents: runs.map((run) => ({
        agent_id: run.agentId,
        label: run.agent.label,
        account_id: run.agent.accountId,
        status: run.status.toLowerCase(),
        steps: run.steps,
        tokens_used: run.tokensUsed,
        summary: run.summary,
        denial_code: run.denialCode,
        error: run.error,
        started_at: run.startedAt?.toISOString() ?? null,
        finished_at: run.finishedAt?.toISOString() ?? null,
      })),
    };
  });

  // ------------------------------------------- compliance, status and admin
  const health = new HealthService({ prisma, chain, config });
  const routeContext: RouteContext = {
    prisma,
    chain,
    config,
    now,
    health,
    quota: chainActionQuota,
    sessionFrom,
    requireSession,
    checkCsrf,
    consentStatus,
    isAdmin,
    isOperator,
    clearSessionCookies: (reply) => {
      reply.clearCookie(SESSION_COOKIE, { path: "/" });
      reply.clearCookie(CSRF_COOKIE, { path: "/" });
    },
    decryptDocument: (ciphertext) => decryptDocument(ciphertext, config.documentEncryptionKey),
  };
  registerPlatformRoutes(app, routeContext);
  registerAccountRoutes(app, routeContext);
  registerAdminRoutes(app, routeContext);

  return app;
}

function jobDedupeBucket(date: Date): string {
  return Math.floor(date.getTime() / 15_000).toString();
}

/** The run's NEAR AI verification result, trimmed for the UI. */
function privateInferenceSummary(outputJson: unknown) {
  const report = (outputJson as { privateInference?: Record<string, unknown> } | null)?.privateInference;
  if (!report || report.provider !== "near-ai") return null;
  const attestation = report.attestation as Record<string, unknown> | null;
  return {
    provider: "near-ai" as const,
    model: typeof report.model === "string" ? report.model : null,
    verifiedCount: typeof report.verifiedCount === "number" ? report.verifiedCount : 0,
    totalCount: typeof report.totalCount === "number" ? report.totalCount : 0,
    attested: Boolean(attestation),
    hasTdxQuote: Boolean(attestation?.hasTdxQuote),
    signingAddress: typeof attestation?.gatewaySigningAddress === "string" ? attestation.gatewaySigningAddress : null,
    attestationError: typeof report.attestationError === "string" ? report.attestationError : null,
    scope: typeof report.scope === "string" ? report.scope : null,
  };
}
