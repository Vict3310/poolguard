import type { Job, PrismaClient } from "@poolguard/db";
import {
  AiConfigurationError,
  AiRequestError,
  NearChain,
  OpenAiCompatibleClient,
  ProviderRequestError,
  isNearAiBaseUrl,
  runAgent,
  verifyPrivateInference,
  type CompletionClient,
  type InferenceEvidence,
  type ServerConfig,
} from "@poolguard/agent-runtime";
import { z } from "zod";
import { recordAudit } from "./audit.js";
import {
  PermanentJobError,
  PersistentAgentHost,
  RetryableJobError,
  reconcileOperationById,
  type AgentJobPayload,
} from "./host.js";

const runPayloadSchema = z.object({
  runId: z.string().min(1),
  taskId: z.string().min(1),
  agentId: z.string().min(1),
  documentId: z.string().min(1),
  mode: z.enum(["live", "scripted"]),
  scenario: z.enum(["A", "B", "C", "D"]).nullable().optional().default(null),
  fault: z.enum(["drop_execute_response"]).nullable().optional().default(null),
});

export interface WorkerDeps {
  prisma: PrismaClient;
  chain: NearChain;
  config: ServerConfig;
}

export async function handleRunAgentJob(deps: WorkerDeps, job: Job): Promise<void> {
  const parsed = runPayloadSchema.safeParse(job.payload);
  if (!parsed.success) throw new PermanentJobError("Malformed RUN_AGENT payload");
  const payload: AgentJobPayload = {
    ...parsed.data,
    scenario: parsed.data.scenario ?? null,
    fault: parsed.data.fault ?? null,
  };
  const run = await deps.prisma.agentRun.findUnique({
    where: { runId_agentId: { runId: payload.runId, agentId: payload.agentId } },
    include: { agent: true, task: true },
  });
  if (!run) throw new PermanentJobError("Agent run not found");
  if (run.status === "SUCCEEDED") return;

  await deps.prisma.agentRun.update({
    where: { id: run.id },
    data: { status: "RUNNING", startedAt: run.startedAt ?? new Date(), error: null },
  });
  await recordAudit(deps.prisma, {
    taskId: run.taskId,
    type: "agent.run.started",
    actor: run.agent.accountId,
    summary: `${run.agent.label} started a ${payload.mode} run.`,
    data: {
      run_id: payload.runId,
      mode: payload.mode,
      scenario: payload.scenario,
      document_id: payload.documentId,
      attempt: job.attempts,
    },
    dedupeKey: `run-start:${payload.runId}:${payload.agentId}`,
  });

  const host = new PersistentAgentHost({
    prisma: deps.prisma,
    chain: deps.chain,
    config: deps.config,
    job,
    payload,
  });

  const resumed = await host.resumeIfSettled();
  if (resumed.resumed) {
    await recordAudit(deps.prisma, {
      taskId: run.taskId,
      type: "recovery.resolved",
      actor: run.agent.accountId,
      summary: "Recovered the original settled operation from chain evidence after a restart.",
      data: { run_id: payload.runId, operation_recovered: true },
      dedupeKey: `resume:${payload.runId}:${payload.agentId}`,
    });
    await finishRunGroup(deps, payload.runId);
    return;
  }

  const client =
    payload.mode === "live"
      ? new OpenAiCompatibleClient({
          baseUrl: deps.config.aiBaseUrl,
          apiKey: deps.config.aiApiKey,
          model: deps.config.aiModel,
          timeoutMs: deps.config.aiTimeoutMs,
        })
      : undefined;
  if (payload.mode === "live" && !client?.configured()) {
    throw new PermanentJobError("AI_NOT_CONFIGURED: live runs require AI_API_KEY");
  }

  // Record exact-bytes hashes of every completion so NEAR AI private inference
  // can be verified after the run. Document text itself is never stored.
  const inferences: InferenceEvidence[] = [];
  const recordingClient: CompletionClient | undefined = client
    ? {
        complete: async (input) => {
          const completion = await client.complete(input);
          if (completion.evidence) inferences.push(completion.evidence);
          return completion;
        },
      }
    : undefined;

  try {
    const result = await runAgent(host, {
      mode: payload.mode,
      client: recordingClient,
      maxSteps: 8,
      maxTokens: 5_000,
      timeoutMs: 180_000,
    });
    const status =
      result.status === "succeeded" ? "SUCCEEDED" : result.status === "partial" ? "PARTIAL" : "FAILED";
    const privateInference =
      payload.mode === "live" && inferences.length > 0 && deps.config.aiApiKey && isNearAiBaseUrl(deps.config.aiBaseUrl)
        ? await verifyPrivateInference({
            baseUrl: deps.config.aiBaseUrl,
            apiKey: deps.config.aiApiKey,
            model: deps.config.aiModel,
            evidence: inferences,
          }).catch(() => null)
        : null;
    if (privateInference) {
      await recordAudit(deps.prisma, {
        taskId: run.taskId,
        type: "ai.private_inference",
        actor: run.agent.accountId,
        summary:
          privateInference.verifiedCount === privateInference.totalCount
            ? `Private inference on NEAR AI Cloud: ${privateInference.verifiedCount}/${privateInference.totalCount} responses signed by an attested TEE key.`
            : `Private inference on NEAR AI Cloud: ${privateInference.verifiedCount}/${privateInference.totalCount} response signatures verified.`,
        severity: privateInference.verifiedCount === privateInference.totalCount ? "success" : "warning",
        data: privateInference as unknown as Record<string, unknown>,
        dedupeKey: `private-inference:${payload.runId}:${payload.agentId}`,
      });
    }
    await deps.prisma.agentRun.update({
      where: { id: run.id },
      data: {
        ...(privateInference ? { outputJson: { privateInference } as never } : {}),
        status,
        steps: result.steps.length,
        tokensUsed: result.tokensUsed,
        model: result.model,
        summary: result.summary.slice(0, 1000),
        denialCode: result.denialCode ?? null,
        error: null,
        finishedAt: new Date(),
      },
    });
    await recordAudit(deps.prisma, {
      taskId: run.taskId,
      type: "agent.finished",
      actor: run.agent.accountId,
      summary: result.summary.slice(0, 400),
      severity: status === "SUCCEEDED" ? "success" : "warning",
      data: {
        run_id: payload.runId,
        status: status.toLowerCase(),
        steps: result.steps.length,
        tokens_used: result.tokensUsed,
        model: result.model,
        denial_code: result.denialCode ?? null,
      },
      dedupeKey: `run-finish:${payload.runId}:${payload.agentId}`,
    });
    await finishRunGroup(deps, payload.runId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const retryable =
      error instanceof RetryableJobError ||
      error instanceof ProviderRequestError ||
      (error instanceof AiRequestError && (error.status === null || error.status === 429 || error.status >= 500));
    await deps.prisma.agentRun.update({
      where: { id: run.id },
      data: {
        status: retryable ? "QUEUED" : "FAILED",
        error: message.slice(0, 1000),
      },
    });
    if (error instanceof RetryableJobError) throw error;
    if (error instanceof PermanentJobError) throw error;
    if (error instanceof AiConfigurationError) throw new PermanentJobError(error.message);
    if (!retryable) {
      await recordAudit(deps.prisma, {
        taskId: run.taskId,
        type: "agent.finished",
        actor: run.agent.accountId,
        summary: `Run failed: ${message.slice(0, 300)}`,
        severity: "danger",
        data: { run_id: payload.runId, error: message.slice(0, 300) },
        dedupeKey: `run-fail:${payload.runId}:${payload.agentId}`,
      });
      await finishRunGroup(deps, payload.runId);
      throw new PermanentJobError(message);
    }
    throw new RetryableJobError(message, 2);
  }
}

async function finishRunGroup(deps: WorkerDeps, runId: string): Promise<void> {
  const open = await deps.prisma.agentRun.count({
    where: { runId, status: { in: ["QUEUED", "RUNNING"] } },
  });
  if (open > 0) return;
  const runs = await deps.prisma.agentRun.findMany({ where: { runId }, include: { task: true } });
  if (runs.length === 0) return;
  const failed = runs.some((run) => run.status === "FAILED");
  const partial = runs.some((run) => run.status === "PARTIAL");
  await recordAudit(deps.prisma, {
    taskId: runs[0]!.taskId,
    type: "demo.scenario.finished",
    actor: "worker",
    summary: failed
      ? "Agent run finished with a failure; see each agent for details."
      : partial
        ? "Agent run finished partially; at least one worker stopped after a denial or limit."
        : "Agent run finished. Payment and fulfillment states are separate.",
    severity: failed ? "danger" : partial ? "warning" : "success",
    data: {
      run_id: runId,
      agents: runs.map((run) => ({
        label: run.agentId,
        status: run.status,
        denial_code: run.denialCode,
      })),
    },
    dedupeKey: `run-group-finish:${runId}`,
  });
}

export async function handleRecoverOperationJob(deps: WorkerDeps, job: Job): Promise<void> {
  const parsed = z.object({ operationId: z.string().min(1) }).safeParse(job.payload);
  if (!parsed.success) throw new PermanentJobError("Malformed RECOVER_OPERATION payload");
  const operation = await deps.prisma.operation.findUnique({
    where: { id: parsed.data.operationId },
    include: { task: true },
  });
  if (!operation) throw new PermanentJobError("Operation not found");
  await recordAudit(deps.prisma, {
    taskId: operation.taskId,
    operationId: operation.id,
    type: "recovery.started",
    actor: "recovery",
    summary: "Recovery is reconciling the original operation against final chain state.",
    data: { chain_operation_id: operation.operationId, job_id: job.id },
    dedupeKey: `recovery-start:${operation.operationId}:${job.id}`,
  });
  const result = await reconcileOperationById({
    prisma: deps.prisma,
    chain: deps.chain,
    config: deps.config,
    operationDbId: operation.id,
  });
  await deps.prisma.operation.update({
    where: { id: operation.id },
    data: { recoveryAttempts: { increment: 1 } },
  });
  if (result.outcome === "chain_unreadable" || result.outcome.startsWith("provider_error")) {
    throw new RetryableJobError(`Recovery incomplete: ${result.outcome}`, 4);
  }
  if (result.outcome.startsWith("expire_failed")) {
    throw new RetryableJobError(result.outcome, 8);
  }
}
