import type { Job, PrismaClient } from "@poolguard/db";
import {
  computeOperationId,
  computeRequestHash,
  type ChainOperationView,
  type ContractReserveRequest,
  type SupplierExtraction,
} from "@poolguard/shared";
import {
  ChainDenialError,
  InjectedResponseLoss,
  NearChain,
  ProviderClient,
  ProviderRequestError,
  type AgentBudgetView,
  type AgentContextView,
  type AgentFinish,
  type AgentHost,
  type AgentOffer,
  type AgentStepRecord,
  type ServerConfig,
} from "@poolguard/agent-runtime";
import { decryptDocument } from "./crypto.js";
import { recordAudit } from "./audit.js";

export class RetryableJobError extends Error {
  override name = "RetryableJobError";
  constructor(message: string, readonly delaySeconds = 0) {
    super(message);
  }
}

export class PermanentJobError extends Error {
  override name = "PermanentJobError";
}

export interface AgentJobPayload {
  runId: string;
  taskId: string;
  agentId: string;
  documentId: string;
  mode: "live" | "scripted";
  scenario: "A" | "B" | "C" | "D" | null;
  fault: "drop_execute_response" | null;
}

function operationMap(payload: unknown): Record<string, string> {
  if (!payload || typeof payload !== "object") return {};
  const value = (payload as Record<string, unknown>).operations;
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function paymentProjection(state: string): "RESERVED" | "PAYOUT_PENDING" | "PAID" | "PAYOUT_FAILED" | "CANCELLED" | "EXPIRED" {
  return state.toUpperCase() as ReturnType<typeof paymentProjection>;
}

async function pollForSettled(
  chain: NearChain,
  taskId: string,
  operationId: string,
  attempts = 20,
): Promise<ChainOperationView | null> {
  let view: ChainOperationView | null = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    view = await chain.getOperation(taskId, operationId).catch(() => view);
    if (view?.payment_state === "paid" || view?.payment_state === "payout_failed") return view;
    await sleep(500);
  }
  return view;
}

/**
 * One agent run's deterministic host. It owns persistence, signing and provider
 * calls. The model can only name a catalog service; every amount, recipient and
 * operation id is derived here and enforced again by the contract.
 */
export class PersistentAgentHost implements AgentHost {
  private contextCache: AgentContextView | null = null;
  private servicesCache: Array<{
    serviceKey: string;
    serviceId: string;
    name: string;
    description: string;
    priceYocto: string;
    outputSchemaHash: string;
  }> | null = null;
  private operations: Record<string, string>;
  private raceDelayApplied = false;
  private faultUsed = false;
  private finishValue: AgentFinish | null = null;

  constructor(
    private readonly deps: {
      prisma: PrismaClient;
      chain: NearChain;
      config: ServerConfig;
      job: Job;
      payload: AgentJobPayload;
    },
  ) {
    this.operations = operationMap(deps.job.payload);
  }

  get finished(): AgentFinish | null {
    return this.finishValue;
  }

  private get chain() {
    return this.deps.chain;
  }

  private async taskBundle() {
    const task = await this.deps.prisma.task.findUnique({
      where: { id: this.deps.payload.taskId },
      include: {
        agents: true,
        documents: true,
        runs: { where: { runId: this.deps.payload.runId } },
      },
    });
    if (!task) throw new PermanentJobError("TASK_NOT_FOUND");
    return task;
  }

  private async agentBundle() {
    const agent = await this.deps.prisma.agent.findUnique({
      where: { id: this.deps.payload.agentId },
      include: { task: { include: { documents: true } } },
    });
    if (!agent) throw new PermanentJobError("AGENT_NOT_FOUND");
    return agent;
  }

  private async services() {
    if (this.servicesCache) return this.servicesCache;
    const provider = await this.deps.prisma.provider.findUnique({
      where: { accountId: this.deps.config.providerAccountId },
      include: { services: { where: { active: true } } },
    });
    if (!provider) throw new PermanentJobError("PROVIDER_NOT_SEEDED");
    this.servicesCache = provider.services.map((service) => ({
      serviceKey: service.serviceKey,
      serviceId: service.serviceId,
      name: service.name,
      description: service.description,
      priceYocto: service.priceYocto,
      outputSchemaHash: service.outputSchemaHash,
    }));
    return this.servicesCache;
  }

  private async documentText(): Promise<{ label: string; text: string }> {
    const agent = await this.agentBundle();
    const document = agent.task.documents.find((candidate) => candidate.id === this.deps.payload.documentId);
    if (!document) throw new PermanentJobError("DOCUMENT_NOT_FOUND");
    return {
      label: document.label,
      text: decryptDocument(document.contentCiphertext, this.deps.config.documentEncryptionKey ?? ""),
    };
  }

  /**
   * Resolve the signing key from the agent row rather than from earlier call order.
   * Recovery paths reach the provider before `context()` runs, so depending on a
   * side effect here made a legitimate retry fail as if the key were unconfigured.
   */
  private async providerClient(): Promise<ProviderClient> {
    const agent = await this.agentBundle();
    const worker = this.deps.config.workerAccounts.find(
      (candidate) => candidate.accountId === agent.accountId,
    );
    if (!worker) throw new PermanentJobError("WORKER_KEY_NOT_CONFIGURED");
    return new ProviderClient({
      origin: this.deps.config.providerOrigin,
      network: this.deps.config.nearNetwork,
      contractId: this.deps.config.contractId,
      serviceDomain: this.deps.config.providerServiceDomain,
      agentAccountId: worker.accountId,
      agentPrivateKey: worker.privateKey,
      custody: this.chain.custodyClient(worker.accountId) ?? undefined,
    });
  }

  async context(): Promise<AgentContextView> {
    if (this.contextCache) return this.contextCache;
    const agent = await this.agentBundle();
    const task = await this.taskBundle();
    const chainTask = await this.chain.getTask(task.chainTaskId);
    if (!chainTask) throw new PermanentJobError("TASK_NOT_ON_CHAIN");
    const budget = await this.chain.getBudget(task.chainTaskId);
    if (!budget) throw new PermanentJobError("BUDGET_NOT_AVAILABLE");
    const document = await this.documentText();
    const offers: AgentOffer[] = (await this.services())
      .filter((service) => BigInt(service.priceYocto) <= BigInt(chainTask.policy.max_per_operation))
      .map((service) => ({
        serviceKey: service.serviceKey,
        serviceId: service.serviceId,
        name: service.name,
        description: service.description,
        priceYocto: service.priceYocto,
        providerAccountId: this.deps.config.providerAccountId,
        outputSchemaHash: service.outputSchemaHash,
      }));
    this.contextCache = {
      taskId: task.chainTaskId,
      taskName: task.name,
      objective: task.objective,
      agentAccountId: agent.accountId,
      agentLabel: agent.label,
      policy: {
        maxPerOperationYocto: chainTask.policy.max_per_operation,
        policyVersion: chainTask.policy.policy_version,
        expiresAtBlock: chainTask.policy.expires_at_block,
        allowedProviders: chainTask.policy.allowed_providers,
      },
      budget: {
        totalFundedYocto: budget.total_funded,
        availableYocto: budget.available,
        reservedYocto: budget.reserved,
        spentYocto: budget.spent,
      },
      offers,
      document: {
        label: document.label,
        text: document.text,
        sha256: computeRequestHash("document", { text: document.text }),
      },
    };
    return this.contextCache;
  }

  async budget(): Promise<AgentBudgetView> {
    const agent = await this.agentBundle();
    const budget = await this.chain.getBudget(agent.task.chainTaskId);
    if (!budget) throw new RetryableJobError("Budget unavailable");
    return {
      totalFundedYocto: budget.total_funded,
      availableYocto: budget.available,
      reservedYocto: budget.reserved,
      spentYocto: budget.spent,
    };
  }

  async requestQuote(serviceKey: string) {
    const service = (await this.services()).find((candidate) => candidate.serviceKey === serviceKey);
    if (!service) throw new PermanentJobError("UNKNOWN_SERVICE");
    const document = await this.documentText();
    const client = await this.providerClient();
    const quote = await client.requestQuote({
      serviceKey,
      documentLabel: document.label,
      documentText: document.text,
    });
    if (quote.provider_account_id !== this.deps.config.providerAccountId) {
      throw new PermanentJobError("PROVIDER_ACCOUNT_MISMATCH");
    }
    const expected = computeRequestHash(service.serviceId, { document_text: document.text });
    if (quote.request_hash !== expected) throw new PermanentJobError("QUOTE_REQUEST_HASH_MISMATCH");
    return {
      requestHash: quote.request_hash,
      outputSchemaHash: quote.output_schema_hash,
      priceYocto: quote.price_yocto,
    };
  }

  private async persistOperationLink(serviceKey: string, operationDbId: string | null) {
    const job = await this.deps.prisma.job.findUnique({ where: { id: this.deps.job.id } });
    if (!job) return;
    const payload = (job.payload ?? {}) as Record<string, unknown>;
    const operations = operationMap(job.payload);
    if (operationDbId) operations[serviceKey] = operationDbId;
    else delete operations[serviceKey];
    await this.deps.prisma.job.update({
      where: { id: job.id },
      data: { payload: { ...payload, operations } as never },
    });
    this.operations = operations;
  }

  private async loadOperation(serviceKey: string) {
    const id = this.operations[serviceKey];
    if (!id) return null;
    return this.deps.prisma.operation.findUnique({
      where: { id },
      include: { document: true, agent: true, task: true },
    });
  }

  private async syncOperation(operationId: string, view: ChainOperationView) {
    await this.deps.prisma.operation.update({
      where: { id: operationId },
      data: {
        paymentState: paymentProjection(view.payment_state),
        payoutAttempts: view.payout_attempts,
        needsRecovery: view.payment_state === "payout_pending",
        settledAtBlock: view.settled_at_block == null ? null : BigInt(view.settled_at_block),
        chainCreatedAtBlock:
          view.created_at_block == null ? undefined : BigInt(view.created_at_block),
        reservationExpiresAtBlock: BigInt(view.reservation_expires_at_block),
        lastError: null,
      },
    });
  }

  /**
   * The first send of a reservation may fail before the node accepts it (for
   * example a stale access-key nonce). The local operation exists, but the chain
   * has never seen it. Re-submitting the same operation id and binding is safe:
   * the contract is idempotent, so an accepted first transaction would simply be
   * returned and a consumed budget would be denied. Never derive a new operation
   * id here, because that would turn an ambiguous retry into a second purchase.
   */
  private async rebroadcastReservation(input: {
    existing: {
      id: string;
      operationId: string;
      providerAccountId: string;
      amountYocto: string;
      serviceId: string;
      requestHash: string;
      outputSchemaHash: string;
      policyVersion: number;
      expiresAtBlock: bigint;
    };
    agentAccountId: string;
    task: { id: string; chainTaskId: string; contractId: string; network: string };
    serviceKey: string;
  }) {
    const { existing, agentAccountId, task, serviceKey } = input;
    const request: ContractReserveRequest = {
      task_id: task.chainTaskId,
      operation_id: existing.operationId,
      agent_id: agentAccountId,
      provider_id: existing.providerAccountId,
      amount: existing.amountYocto,
      service_id: existing.serviceId,
      request_hash: existing.requestHash,
      output_schema_hash: existing.outputSchemaHash,
      policy_version: existing.policyVersion,
      expires_at_block: Number(existing.expiresAtBlock),
    };
    let prepared;
    try {
      prepared = await this.chain.reserve(agentAccountId, request);
    } catch (error) {
      throw new RetryableJobError(
        `Could not re-prepare the original reservation: ${error instanceof Error ? error.message : String(error)}`,
        2,
      );
    }
    await this.deps.prisma.chainTransaction.create({
      data: {
        taskId: task.id,
        operationDbId: existing.id,
        kind: "RESERVE",
        status: "PREPARED",
        txHash: prepared.txHash,
        signerAccountId: agentAccountId,
        receiverId: task.contractId,
        network: task.network,
        outcome: { method: "reserve", operation_id: existing.operationId, recovery: true } as never,
      },
    });
    try {
      const outcome = await this.chain.submit(prepared);
      await this.deps.prisma.chainTransaction.update({
        where: { txHash: prepared.txHash },
        data: { status: "SUCCESS", confirmedAt: new Date(), outcome: { raw: outcome.raw } as never },
      });
      const view = await this.chain.getOperation(task.chainTaskId, existing.operationId);
      if (!view) {
        await this.deps.prisma.operation.update({
          where: { id: existing.id },
          data: { needsRecovery: true, lastError: "RESERVATION_ACCEPTED_VIEW_PENDING" },
        });
        throw new RetryableJobError(
          `Reservation ${prepared.txHash} was accepted but is not readable yet; retrying reconciliation`,
          3,
        );
      }
      await this.syncOperation(existing.id, view);
      await recordAudit(this.deps.prisma, {
        taskId: task.id,
        operationId: existing.id,
        type: "operation.recovered",
        actor: agentAccountId,
        summary: `Recovered the original reservation ${existing.operationId.slice(0, 16)}… after an interrupted submission. No new operation was created.`,
        severity: "warning",
        data: {
          chain_operation_id: existing.operationId,
          tx_hash: outcome.txHash,
          recovered: true,
        },
        dedupeKey: `reserve-recovered:${existing.operationId}:${outcome.txHash}`,
      });
      return {
        ok: true,
        message: `Recovered the original reservation (${view.payment_state}). No new purchase was created.`,
        operationId: existing.operationId,
        data: {
          operation_id: existing.operationId,
          payment_state: view.payment_state,
          tx_hash: outcome.txHash,
          recovered: true,
        },
      };
    } catch (error) {
      if (error instanceof RetryableJobError) throw error;
      if (error instanceof ChainDenialError) {
        await this.deps.prisma.chainTransaction.update({
          where: { txHash: prepared.txHash },
          data: { status: "FAILED", errorMessage: error.message.slice(0, 500), confirmedAt: new Date() },
        }).catch(() => undefined);
        // The contract definitively refused the operation, so the local row was
        // only a placeholder for a purchase that never existed. Remove it so the
        // agent can take its bounded fallback path.
        await this.deps.prisma.operation.delete({ where: { id: existing.id } }).catch(() => undefined);
        await this.persistOperationLink(serviceKey, null).catch(() => undefined);
        await recordAudit(this.deps.prisma, {
          taskId: task.id,
          type: "operation.denied",
          actor: agentAccountId,
          summary: `Reconciled reservation denied by policy: ${error.code ?? "UNKNOWN"}.`,
          data: {
            code: error.code,
            chain_operation_id: existing.operationId,
            attempted_amount_yocto: existing.amountYocto,
            tx_hash: prepared.txHash,
            reconciled: true,
          },
          dedupeKey: `denied:${prepared.txHash}`,
        });
        return {
          ok: false,
          code: error.code ?? "RESERVE_DENIED",
          message: error.message.slice(0, 300),
          operationId: existing.operationId,
          data: { operation_id: existing.operationId, tx_hash: prepared.txHash, recovered: true },
        };
      }
      await this.deps.prisma.operation.update({
        where: { id: existing.id },
        data: {
          needsRecovery: true,
          lastError: error instanceof Error ? error.message.slice(0, 300) : "unknown",
        },
      }).catch(() => undefined);
      throw new RetryableJobError(
        `Reservation ${prepared.txHash} is still ambiguous; the same operation will be reconciled again`,
        3,
      );
    }
  }

  async reserve(serviceKey: string) {
    const service = (await this.services()).find((candidate) => candidate.serviceKey === serviceKey);
    if (!service) return { ok: false, code: "UNKNOWN_SERVICE", message: "Unknown catalog service." };
    const agent = await this.agentBundle();
    const task = await this.taskBundle();
    const existing = await this.loadOperation(serviceKey);
    if (existing) {
      if (existing.agent.accountId !== agent.accountId) {
        throw new PermanentJobError("OPERATION_AGENT_MISMATCH");
      }
      const view = await this.chain.getOperation(task.chainTaskId, existing.operationId).catch(() => null);
      if (!view) {
        return this.rebroadcastReservation({
          existing,
          agentAccountId: agent.accountId,
          task,
          serviceKey,
        });
      }
      if (view.payment_state === "cancelled" || view.payment_state === "expired" || view.payment_state === "payout_failed") {
        return {
          ok: false,
          code: view.payment_state.toUpperCase(),
          message: `Existing operation is ${view.payment_state}; no further automatic payment is attempted.`,
          operationId: existing.operationId,
        };
      }
      await this.syncOperation(existing.id, view);
      return {
        ok: true,
        message: `Recovered the original operation (${view.payment_state}). No new reservation was created.`,
        operationId: existing.operationId,
        data: { operation_id: existing.operationId, payment_state: view.payment_state, recovered: true },
      };
    }

    if (this.deps.payload.scenario === "B" && !this.raceDelayApplied) {
      this.raceDelayApplied = true;
      // Both workers reach the contract at nearly the same block, so the race is real.
      await sleep(1_200);
    }

    const document = await this.documentText();
    const chainTask = await this.chain.getTask(task.chainTaskId);
    if (!chainTask) throw new RetryableJobError("Task is not readable on chain");
    const currentBlock = await this.chain.getCurrentBlock();
    const expiresAtBlock = Math.min(
      currentBlock + chainTask.policy.reservation_ttl_blocks,
      chainTask.policy.expires_at_block,
    );
    if (expiresAtBlock <= currentBlock) {
      return { ok: false, code: "TASK_EXPIRED", message: "The task has expired." };
    }
    const requestHash = computeRequestHash(service.serviceId, { document_text: document.text });
    const operationId = computeOperationId({
      network: task.network,
      contractId: task.contractId,
      taskId: task.chainTaskId,
      agentAccountId: agent.accountId,
      providerAccountId: this.deps.config.providerAccountId,
      amountYocto: service.priceYocto,
      serviceId: service.serviceId,
      requestHash,
      outputSchemaHash: service.outputSchemaHash,
      policyVersion: chainTask.policy.policy_version,
      expiresAtBlock,
    });
    const request: ContractReserveRequest = {
      task_id: task.chainTaskId,
      operation_id: operationId,
      agent_id: agent.accountId,
      provider_id: this.deps.config.providerAccountId,
      amount: service.priceYocto,
      service_id: service.serviceId,
      request_hash: requestHash,
      output_schema_hash: service.outputSchemaHash,
      policy_version: chainTask.policy.policy_version,
      expires_at_block: expiresAtBlock,
    };
    let prepared;
    try {
      prepared = await this.chain.reserve(agent.accountId, request);
    } catch (error) {
      throw new RetryableJobError(
        `Could not prepare reservation: ${error instanceof Error ? error.message : String(error)}`,
        2,
      );
    }

    let operationDbId: string;
    try {
      operationDbId = await this.deps.prisma.$transaction(async (tx) => {
        const operation = await tx.operation.create({
          data: {
            taskId: task.id,
            chainTaskId: task.chainTaskId,
            operationId,
            agentId: agent.id,
            providerAccountId: this.deps.config.providerAccountId,
            serviceId: service.serviceId,
            amountYocto: service.priceYocto,
            requestHash,
            outputSchemaHash: service.outputSchemaHash,
            policyVersion: chainTask.policy.policy_version,
            documentId: this.deps.payload.documentId,
            reservationExpiresAtBlock: BigInt(expiresAtBlock),
            expiresAtBlock: BigInt(expiresAtBlock),
            needsRecovery: false,
          },
        });
        await tx.chainTransaction.create({
          data: {
            taskId: task.id,
            operationDbId: operation.id,
            kind: "RESERVE",
            status: "PREPARED",
            txHash: prepared.txHash,
            signerAccountId: agent.accountId,
            receiverId: task.contractId,
            network: task.network,
            outcome: { method: "reserve", operation_id: operationId } as never,
          },
        });
        const job = await tx.job.findUnique({ where: { id: this.deps.job.id } });
        const payload = (job?.payload ?? {}) as Record<string, unknown>;
        const operations = { ...operationMap(job?.payload), [serviceKey]: operation.id };
        await tx.job.update({
          where: { id: this.deps.job.id },
          data: { payload: { ...payload, operations } as never },
        });
        return operation.id;
      });
      this.operations = { ...this.operations, [serviceKey]: operationDbId };
    } catch (error) {
      // If persistence failed, nothing was broadcast.
      throw new RetryableJobError(
        `Could not persist the reservation before broadcast: ${error instanceof Error ? error.message : String(error)}`,
        2,
      );
    }

    try {
      const outcome = await this.chain.submit(prepared);
      await this.deps.prisma.chainTransaction.update({
        where: { txHash: prepared.txHash },
        data: { status: "SUCCESS", confirmedAt: new Date(), outcome: { raw: outcome.raw } as never },
      });
      const view = await this.chain.getOperation(task.chainTaskId, operationId);
      if (view) await this.syncOperation(operationDbId, view);
      await recordAudit(this.deps.prisma, {
        taskId: task.id,
        operationId: operationDbId,
        type: "operation.reserved",
        actor: agent.accountId,
        summary: `${agent.label} reserved ${service.priceYocto} yoctoNEAR for ${service.name}.`,
        data: {
          chain_operation_id: operationId,
          tx_hash: outcome.txHash,
          amount_yocto: service.priceYocto,
          provider: this.deps.config.providerAccountId,
        },
        dedupeKey: `reserve:${operationId}:${outcome.txHash}`,
      });
      return {
        ok: true,
        message: `Reserved ${service.priceYocto} yoctoNEAR for ${service.name}.`,
        operationId,
        data: { operation_id: operationId, amount_yocto: service.priceYocto, tx_hash: outcome.txHash },
      };
    } catch (error) {
      if (error instanceof ChainDenialError) {
        await this.deps.prisma.chainTransaction.update({
          where: { txHash: prepared.txHash },
          data: { status: "FAILED", errorMessage: error.message.slice(0, 500), confirmedAt: new Date() },
        }).catch(() => undefined);
        await this.deps.prisma.operation.delete({ where: { id: operationDbId } }).catch(() => undefined);
        await this.persistOperationLink(serviceKey, null).catch(() => undefined);
        await recordAudit(this.deps.prisma, {
          taskId: task.id,
          type: "operation.denied",
          actor: agent.accountId,
          summary: `${agent.label}'s reservation was denied: ${error.code ?? "UNKNOWN"}.`,
          data: {
            code: error.code,
            chain_operation_id: operationId,
            attempted_amount_yocto: service.priceYocto,
            tx_hash: prepared.txHash,
          },
          dedupeKey: `denied:${prepared.txHash}`,
        });
        return {
          ok: false,
          code: error.code ?? "RESERVE_DENIED",
          message: error.message.slice(0, 300),
          operationId,
          data: { operation_id: operationId, tx_hash: prepared.txHash },
        };
      }
      await this.deps.prisma.operation.update({
        where: { id: operationDbId },
        data: { needsRecovery: true, lastError: error instanceof Error ? error.message.slice(0, 300) : "unknown" },
      }).catch(() => undefined);
      throw new RetryableJobError(
        `Reservation outcome is unknown (${prepared.txHash}); it will be reconciled, not replaced.`,
        3,
      );
    }
  }

  async execute(serviceKey: string) {
    const operation = await this.loadOperation(serviceKey);
    if (!operation) return { ok: false, code: "NO_RESERVATION", message: "Reserve before executing." };
    const agent = await this.agentBundle();
    const task = await this.taskBundle();
    const view = await this.chain.getOperation(task.chainTaskId, operation.operationId);
    if (!view) throw new RetryableJobError("Operation is not readable on chain yet", 2);
    if (view.payment_state === "paid") {
      await this.syncOperation(operation.id, view);
      return {
        ok: true,
        message: "Payment already settled; no second transfer was created.",
        operationId: operation.operationId,
        data: { operation_id: operation.operationId, payment_state: "paid", recovered: true },
      };
    }
    if (view.payment_state === "payout_pending") {
      const settled = await pollForSettled(this.chain, task.chainTaskId, operation.operationId, 20);
      if (settled?.payment_state === "paid") {
        await this.syncOperation(operation.id, settled);
        return {
          ok: true,
          message: "Payment settled after a pending callback.",
          operationId: operation.operationId,
          data: { operation_id: operation.operationId, payment_state: "paid" },
        };
      }
      await this.syncOperation(operation.id, settled ?? view);
      throw new RetryableJobError("Payout is pending; reconciling the original operation", 2);
    }
    if (view.payment_state !== "reserved") {
      await this.syncOperation(operation.id, view);
      return {
        ok: false,
        code: view.payment_state.toUpperCase(),
        message: `Operation is ${view.payment_state}; no payment was dispatched.`,
        operationId: operation.operationId,
      };
    }

    let prepared;
    try {
      prepared = await this.chain.prepare({
        signerAccountId: agent.accountId,
        methodName: "execute",
        args: { task_id: task.chainTaskId, operation_id: operation.operationId },
        gasTgas: 140,
      });
    } catch (error) {
      throw new RetryableJobError(
        `Could not prepare execution: ${error instanceof Error ? error.message : String(error)}`,
        2,
      );
    }
    await this.deps.prisma.chainTransaction.create({
      data: {
        taskId: task.id,
        operationDbId: operation.id,
        kind: "EXECUTE",
        status: "PREPARED",
        txHash: prepared.txHash,
        signerAccountId: agent.accountId,
        receiverId: task.contractId,
        network: task.network,
        outcome: { method: "execute", operation_id: operation.operationId } as never,
      },
    });

    const injectFault =
      Boolean(this.deps.payload.fault) && !this.faultUsed && this.deps.job.attempts === 1;
    if (injectFault) this.faultUsed = true;
    try {
      const outcome = await this.chain.submit(prepared, { dropResponseAfterSend: injectFault });
      await this.deps.prisma.chainTransaction.update({
        where: { txHash: prepared.txHash },
        data: { status: "SUCCESS", confirmedAt: new Date(), outcome: { raw: outcome.raw } as never },
      });
      const after = await pollForSettled(this.chain, task.chainTaskId, operation.operationId, 10);
      if (after) await this.syncOperation(operation.id, after);
      await recordAudit(this.deps.prisma, {
        taskId: task.id,
        operationId: operation.id,
        type: "payment.dispatched",
        actor: agent.accountId,
        summary: `Payment of ${operation.amountYocto} yoctoNEAR dispatched to ${operation.providerAccountId}.`,
        data: { tx_hash: outcome.txHash, amount_yocto: operation.amountYocto },
        dedupeKey: `dispatched:${operation.operationId}`,
      });
      if (after?.payment_state === "paid") {
        await recordAudit(this.deps.prisma, {
          taskId: task.id,
          operationId: operation.id,
          type: "payment.settled",
          actor: agent.accountId,
          summary: "Transfer final; payout settled on chain.",
          data: { tx_hash: outcome.txHash, settled_at_block: after.settled_at_block },
          dedupeKey: `settled:${operation.operationId}`,
        });
      }
      return {
        ok: true,
        message: after?.payment_state === "paid" ? "Paid exactly once." : "Transfer dispatched; waiting for the private callback.",
        operationId: operation.operationId,
        data: {
          operation_id: operation.operationId,
          payment_state: after?.payment_state ?? "payout_pending",
          tx_hash: outcome.txHash,
        },
      };
    } catch (error) {
      if (error instanceof InjectedResponseLoss) {
        await this.deps.prisma.operation.update({
          where: { id: operation.id },
          data: { paymentState: "PAYOUT_PENDING", needsRecovery: true, lastError: "FAULT_INJECTED_RESPONSE_LOST" },
        }).catch(() => undefined);
        await recordAudit(this.deps.prisma, {
          taskId: task.id,
          operationId: operation.id,
          type: "demo.fault_injected",
          actor: "demo-harness",
          summary: "Demo fault: the execute response was dropped after submission.",
          severity: "warning",
          data: { tx_hash: error.txHash, operation_id: operation.operationId, labelled: true },
          dedupeKey: `fault:${operation.operationId}`,
        });
        throw new RetryableJobError(
          `Labelled demo fault: response for ${error.txHash} dropped after submission`,
          8,
        );
      }
      if (error instanceof ChainDenialError) {
        await this.deps.prisma.chainTransaction.update({
          where: { txHash: prepared.txHash },
          data: { status: "FAILED", errorMessage: error.message.slice(0, 500) },
        }).catch(() => undefined);
        const after = await this.chain.getOperation(task.chainTaskId, operation.operationId).catch(() => null);
        if (after) await this.syncOperation(operation.id, after);
        await recordAudit(this.deps.prisma, {
          taskId: task.id,
          operationId: operation.id,
          type: "operation.denied",
          actor: agent.accountId,
          summary: `Execution was rejected: ${error.code ?? "UNKNOWN"}. No transfer was created.`,
          data: { code: error.code, tx_hash: prepared.txHash },
          dedupeKey: `execute-denied:${prepared.txHash}`,
        });
        return {
          ok: false,
          code: error.code ?? "EXECUTE_DENIED",
          message: error.message.slice(0, 300),
          operationId: operation.operationId,
        };
      }
      // Unknown outcome is never treated as failure. Keep funds reserved, mark for
      // reconciliation, and let the retry read chain evidence.
      await this.deps.prisma.operation.update({
        where: { id: operation.id },
        data: {
          needsRecovery: true,
          paymentState: "PAYOUT_PENDING",
          lastError: error instanceof Error ? error.message.slice(0, 300) : "unknown",
        },
      }).catch(() => undefined);
      throw new RetryableJobError(
        `Execution outcome unknown (${prepared.txHash}); the original operation will be reconciled.`,
        5,
      );
    }
  }

  async retrieve(serviceKey: string) {
    const operation = await this.loadOperation(serviceKey);
    if (!operation) return { ok: false, code: "NO_OPERATION", message: "No operation to retrieve." };
    const agent = await this.agentBundle();
    const task = await this.taskBundle();
    const view = await this.chain.getOperation(task.chainTaskId, operation.operationId);
    if (!view) throw new RetryableJobError("Operation not readable on chain", 2);
    if (view.payment_state !== "paid") {
      await this.syncOperation(operation.id, view);
      throw new RetryableJobError(
        `Payment is ${view.payment_state}; fulfillment cannot be claimed yet`,
        3,
      );
    }
    await this.syncOperation(operation.id, view);
    const existing = await this.deps.prisma.providerResult.findUnique({
      where: {
        chainTaskId_operationId: {
          chainTaskId: task.chainTaskId,
          operationId: operation.operationId,
        },
      },
    });
    if (existing?.status === "DELIVERED" && existing.resultJson) {
      return {
        ok: true,
        message: `Recovered the stored provider result for ${serviceKey}.`,
        operationId: operation.operationId,
        data: { result: existing.resultJson, recovered: true },
      };
    }

    const service = (await this.services()).find((candidate) => candidate.serviceKey === serviceKey);
    if (!service) throw new PermanentJobError("UNKNOWN_SERVICE");
    const document = await this.documentText();
    const client = await this.providerClient();
    // The provider owns the ProviderResult row: it creates it atomically when it
    // claims the operation. Pre-creating it here would make the provider mistake
    // our placeholder for another request already in progress.
    await this.deps.prisma.operation.update({
      where: { id: operation.id },
      data: { fulfillmentState: "PROCESSING" },
    });
    await recordAudit(this.deps.prisma, {
      taskId: task.id,
      operationId: operation.id,
      type: "fulfillment.processing",
      actor: agent.accountId,
      summary: `Requesting ${service.name} from the provider after verified payment.`,
      data: { operation_id: operation.operationId },
      dedupeKey: `fulfill-request:${operation.operationId}`,
    });

    try {
      const delivered = await client.purchase({
        operationId: operation.operationId,
        taskId: task.chainTaskId,
        serviceKey: service.serviceKey,
        requestHash: operation.requestHash,
        outputSchemaHash: operation.outputSchemaHash,
        documentLabel: document.label,
        documentText: document.text,
      });
      if (delivered.status === "processing" || !delivered.result) {
        throw new RetryableJobError("Provider is still processing this operation", 2);
      }
      const extraction: SupplierExtraction = delivered.result;
      await this.deps.prisma.providerResult.upsert({
        where: {
          chainTaskId_operationId: {
            chainTaskId: task.chainTaskId,
            operationId: operation.operationId,
          },
        },
        update: {
          taskId: task.id,
          status: "DELIVERED",
          resultJson: extraction as never,
          deliveredAt: delivered.delivered_at ? new Date(delivered.delivered_at) : new Date(),
          outputSchemaHash: delivered.output_schema_hash,
          lastError: null,
        },
        create: {
          taskId: task.id,
          chainTaskId: task.chainTaskId,
          operationId: operation.operationId,
          requestHash: operation.requestHash,
          outputSchemaHash: operation.outputSchemaHash,
          serviceKey: service.serviceKey,
          status: "DELIVERED",
          resultJson: extraction as never,
          deliveredAt: delivered.delivered_at ? new Date(delivered.delivered_at) : new Date(),
          attempts: 1,
        },
      });
      await this.deps.prisma.operation.update({
        where: { id: operation.id },
        data: { fulfillmentState: "DELIVERED", needsRecovery: false },
      });
      await recordAudit(this.deps.prisma, {
        taskId: task.id,
        operationId: operation.id,
        type: "fulfillment.delivered",
        actor: agent.accountId,
        summary: `Provider delivered structured extraction for ${document.label}. Payment and delivery are separate states.`,
        data: {
          operation_id: operation.operationId,
          document_sha256: extraction.document.sha256,
          supplier: extraction.supplier.name,
        },
        dedupeKey: `fulfilled:${operation.operationId}`,
      });
      return {
        ok: true,
        message: `Retrieved the stored extraction for ${document.label}.`,
        operationId: operation.operationId,
        data: { result: extraction },
      };
    } catch (error) {
      if (error instanceof RetryableJobError) throw error;
      const retryable =
        error instanceof ProviderRequestError &&
        (error.status === 402 || error.status === 503 || error.status === 404 || error.status === null);
      await this.deps.prisma.providerResult
        .updateMany({
          where: { chainTaskId: task.chainTaskId, operationId: operation.operationId },
          data: {
            status: "FAILED",
            lastError: error instanceof Error ? error.message.slice(0, 500) : "unknown",
          },
        })
        .catch(() => undefined);
      await this.deps.prisma.operation.update({
        where: { id: operation.id },
        data: {
          fulfillmentState: retryable ? "UNKNOWN" : "DELIVERY_FAILED",
          needsRecovery: true,
        },
      }).catch(() => undefined);
      if (retryable) {
        throw new RetryableJobError(
          `Provider could not confirm settled payment yet: ${error instanceof Error ? error.message : String(error)}`,
          3,
        );
      }
      return {
        ok: false,
        code: "DELIVERY_FAILED",
        message: error instanceof Error ? error.message.slice(0, 300) : "Provider delivery failed",
        operationId: operation.operationId,
      };
    }
  }

  async recordStep(step: AgentStepRecord): Promise<void> {
    await this.deps.prisma.agentRun.updateMany({
      where: { runId: this.deps.payload.runId, agentId: this.deps.payload.agentId },
      data: { steps: step.step },
    });
  }

  async finish(finish: AgentFinish): Promise<void> {
    this.finishValue = finish;
    await this.deps.prisma.agentRun.updateMany({
      where: { runId: this.deps.payload.runId, agentId: this.deps.payload.agentId },
      data: {
        summary: finish.summary.slice(0, 1000),
        outputJson: (finish.output ?? {}) as never,
        denialCode: finish.denialCode ?? null,
      },
    });
  }

  /**
   * Called before a re-run. If the previous attempt already settled a payment,
   * finish from chain evidence and stored provider output — never re-decide a new
   * purchase.
   */
  async resumeIfSettled(): Promise<{ resumed: boolean; summary?: string }> {
    for (const operationDbId of Object.values(this.operations)) {
      const operation = await this.deps.prisma.operation.findUnique({ where: { id: operationDbId } });
      if (!operation) continue;
      let view = await this.chain.getOperation(operation.chainTaskId, operation.operationId).catch(() => null);
      if (!view) continue;
      if (view.payment_state === "payout_pending") {
        view = await pollForSettled(this.chain, operation.chainTaskId, operation.operationId, 30);
      }
      if (!view || view.payment_state !== "paid") continue;
      await this.syncOperation(operation.id, view);
      const service = (await this.services()).find((candidate) => candidate.serviceId === operation.serviceId);
      if (!service) continue;
      const existing = await this.deps.prisma.providerResult.findUnique({
        where: {
          chainTaskId_operationId: {
            chainTaskId: operation.chainTaskId,
            operationId: operation.operationId,
          },
        },
      });
      if (existing?.status !== "DELIVERED") {
        const delivery = await this.retrieve(service.serviceKey);
        if (!delivery.ok) return { resumed: false };
      }
      const summary = `Recovered the original operation after a restart: payment ${operation.operationId.slice(0, 12)}… had already settled exactly once, and the provider returned the stored result. No new payment was made.`;
      await this.finish({ summary });
      await this.deps.prisma.agentRun.updateMany({
        where: { runId: this.deps.payload.runId, agentId: this.deps.payload.agentId },
        data: { status: "SUCCEEDED", finishedAt: new Date() },
      });
      return { resumed: true, summary };
    }
    return { resumed: false };
  }
}

/** Standalone reconciliation used by the RECOVER_OPERATION job. */
export async function reconcileOperationById(deps: {
  prisma: PrismaClient;
  chain: NearChain;
  config: ServerConfig;
  operationDbId: string;
}): Promise<{ outcome: string; paymentState: string; delivered: boolean }> {
  const operation = await deps.prisma.operation.findUnique({
    where: { id: deps.operationDbId },
    include: { task: true, agent: true, document: true },
  });
  if (!operation) return { outcome: "not_found", paymentState: "unknown", delivered: false };
  const view = await deps.chain
    .getOperation(operation.chainTaskId, operation.operationId)
    .catch(() => null);
  if (!view) return { outcome: "chain_unreadable", paymentState: operation.paymentState.toLowerCase(), delivered: false };

  await deps.prisma.operation.update({
    where: { id: operation.id },
    data: {
      paymentState: paymentProjection(view.payment_state) as never,
      payoutAttempts: view.payout_attempts,
      needsRecovery: view.payment_state === "payout_pending",
      settledAtBlock: view.settled_at_block == null ? null : BigInt(view.settled_at_block),
    },
  });

  if (view.payment_state === "reserved") {
    const currentBlock = await deps.chain.getCurrentBlock();
    if (currentBlock > view.reservation_expires_at_block) {
      try {
        await deps.chain.expire(operation.agent.accountId, operation.chainTaskId, operation.operationId);
        await deps.prisma.operation.update({
          where: { id: operation.id },
          data: { paymentState: "EXPIRED", needsRecovery: false },
        });
        await recordAudit(deps.prisma, {
          taskId: operation.taskId,
          operationId: operation.id,
          type: "reservation.expired",
          actor: "recovery",
          summary: "Expired reservation released exactly once; no transfer was dispatched.",
          data: { chain_operation_id: operation.operationId },
          dedupeKey: `expire:${operation.operationId}`,
        });
        return { outcome: "expired", paymentState: "expired", delivered: false };
      } catch (error) {
        return {
          outcome: `expire_failed:${error instanceof Error ? error.message : String(error)}`,
          paymentState: "reserved",
          delivered: false,
        };
      }
    }
    return { outcome: "reserved", paymentState: "reserved", delivered: false };
  }

  if (view.payment_state !== "paid") {
    return { outcome: view.payment_state, paymentState: view.payment_state, delivered: operation.fulfillmentState === "DELIVERED" };
  }

  // Paid: recover or fetch the stored provider result, never pay again.
  const existing = await deps.prisma.providerResult.findUnique({
    where: {
      chainTaskId_operationId: {
        chainTaskId: operation.chainTaskId,
        operationId: operation.operationId,
      },
    },
  });
  if (existing?.status === "DELIVERED") {
    await deps.prisma.operation.update({
      where: { id: operation.id },
      data: { fulfillmentState: "DELIVERED", needsRecovery: false },
    });
    return { outcome: "recovered", paymentState: "paid", delivered: true };
  }
  if (!operation.document) {
    return { outcome: "paid_without_document", paymentState: "paid", delivered: false };
  }
  const service = await deps.prisma.service.findFirst({
    where: { serviceId: operation.serviceId, provider: { accountId: operation.providerAccountId } },
  });
  if (!service) return { outcome: "paid_service_missing", paymentState: "paid", delivered: false };
  const worker = deps.config.workerAccounts.find((candidate) => candidate.accountId === operation.agent.accountId);
  if (!worker) return { outcome: "paid_without_worker_key", paymentState: "paid", delivered: false };
  const client = new ProviderClient({
    origin: deps.config.providerOrigin,
    network: deps.config.nearNetwork,
    contractId: deps.config.contractId,
    serviceDomain: deps.config.providerServiceDomain,
    agentAccountId: worker.accountId,
    agentPrivateKey: worker.privateKey,
    custody: deps.chain.custodyClient(worker.accountId) ?? undefined,
  });
  try {
    const delivered = await client.purchase({
      operationId: operation.operationId,
      taskId: operation.chainTaskId,
      serviceKey: service.serviceKey,
      requestHash: operation.requestHash,
      outputSchemaHash: operation.outputSchemaHash,
      documentLabel: operation.document.label,
      documentText: decryptDocument(operation.document.contentCiphertext, deps.config.documentEncryptionKey ?? ""),
    });
    if (delivered.status === "delivered" && delivered.result) {
      await deps.prisma.providerResult.upsert({
        where: {
          chainTaskId_operationId: {
            chainTaskId: operation.chainTaskId,
            operationId: operation.operationId,
          },
        },
        update: {
          status: "DELIVERED",
          resultJson: delivered.result as never,
          deliveredAt: delivered.delivered_at ? new Date(delivered.delivered_at) : new Date(),
        },
        create: {
          taskId: operation.taskId,
          chainTaskId: operation.chainTaskId,
          operationId: operation.operationId,
          requestHash: operation.requestHash,
          outputSchemaHash: operation.outputSchemaHash,
          serviceKey: service.serviceKey,
          status: "DELIVERED",
          resultJson: delivered.result as never,
          deliveredAt: delivered.delivered_at ? new Date(delivered.delivered_at) : new Date(),
          attempts: delivered.attempts,
        },
      });
      await deps.prisma.operation.update({
        where: { id: operation.id },
        data: { fulfillmentState: "DELIVERED", needsRecovery: false },
      });
      await recordAudit(deps.prisma, {
        taskId: operation.taskId,
        operationId: operation.id,
        type: "recovery.resolved",
        actor: "recovery",
        summary: "Recovered the original paid operation and its stored result. No second payout was made.",
        data: { chain_operation_id: operation.operationId, tx_evidence: true },
        dedupeKey: `recovery:${operation.operationId}`,
      });
      return { outcome: "recovered", paymentState: "paid", delivered: true };
    }
    return { outcome: "provider_processing", paymentState: "paid", delivered: false };
  } catch (error) {
    return {
      outcome: `provider_error:${error instanceof Error ? error.message : String(error)}`,
      paymentState: "paid",
      delivered: false,
    };
  }
}

