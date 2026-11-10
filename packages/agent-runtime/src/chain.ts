/**
 * Narrow NEAR boundary for PoolGuard.
 *
 * Every transaction is signed and its hash computed *before* broadcast so the
 * application can persist the hash, then submit. If the response to submission is
 * lost, recovery looks up that exact hash; it never mints a new logical purchase.
 */
import {
  Account,
  JsonRpcProvider,
  KeyPair,
  KeyPairSigner,
  actions,
  baseEncode,
  type KeyPairString,
  type SignedTransaction,
} from "near-api-js";
import {
  accountIdSchema,
  chainBudgetViewSchema,
  chainConfigViewSchema,
  chainOperationViewSchema,
  chainTaskViewSchema,
  extractDenialCode,
  hex64Schema,
  parseYoctoString,
  sha256Bytes,
  type ChainBudgetView,
  type ChainConfigView,
  type ChainOperationView,
  type ChainTaskView,
  type ContractDenialCode,
  type ContractPolicyInput,
  type ContractReserveRequest,
} from "@poolguard/shared";

export interface NearChainOptions {
  network: "sandbox" | "testnet";
  rpcUrl: string;
  contractId: string;
  signers: Record<string, string>;
  requestTimeoutMs?: number;
}

export interface ActionSpec {
  methodName: string;
  args: Record<string, unknown>;
  gasTgas: number;
  depositYocto: string;
}

export interface PreparedTransaction {
  signerAccountId: string;
  receiverId: string;
  methodName: string;
  args: Record<string, unknown>;
  actions?: ActionSpec[];
  gasTgas: number;
  depositYocto: string;
  txHash: string;
  signed: SignedTransaction;
  preparedAt: string;
}

export interface ChainOutcome {
  status: "success" | "failure" | "unknown" | "not_found";
  txHash: string;
  receiptIds: string[];
  errorCode: ContractDenialCode | null;
  errorMessage: string | null;
  blockHeight: number | null;
  raw?: unknown;
}

export class ChainDenialError extends Error {
  override name = "ChainDenialError";
  constructor(
    readonly code: ContractDenialCode | null,
    readonly txHash: string | null,
    message: string,
  ) {
    super(message);
  }
}

export class ChainTransportError extends Error {
  override name = "ChainTransportError";
  constructor(message: string, readonly txHash: string | null, override readonly cause?: unknown) {
    super(message);
  }
}

/** Deliberate fault injection for the response-loss demo. Clearly labeled upstream. */
export class InjectedResponseLoss extends ChainTransportError {
  override name = "InjectedResponseLoss";
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/** True when a submission was rejected before acceptance because the nonce was stale. */
export function isNonceError(error: unknown): boolean {
  return /InvalidNonce|invalid_nonce|invalid nonce/i.test(messageOf(error));
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string, txHash: string | null): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new ChainTransportError(`${label} timed out after ${ms}ms`, txHash));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function isSuccessStatus(status: unknown): boolean {
  return Boolean(status && typeof status === "object" && "SuccessValue" in status);
}

function collectFailureMessages(value: unknown, depth = 0): string[] {
  if (depth > 6 || value == null) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap((entry) => collectFailureMessages(entry, depth + 1));
  if (typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    collectFailureMessages(key === "kind" ? child : child, depth + 1),
  );
}

function errorFromStatus(status: unknown, txHash: string): ChainDenialError {
  const messages = collectFailureMessages(status);
  const joined = messages.join(" ");
  return new ChainDenialError(extractDenialCode(joined), txHash, joined || "Transaction failed");
}

/** Serializes signing per account so two jobs never race the same access-key nonce. */
class KeyQueue {
  private tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const next = previous.then(task, task);
    this.tails.set(
      key,
      next.catch(() => undefined),
    );
    return next;
  }
}

export class NearChain {
  readonly provider: JsonRpcProvider;
  readonly network: "sandbox" | "testnet";
  readonly contractId: string;
  private readonly signers = new Map<string, KeyPair>();
  private readonly accounts = new Map<string, Account>();
  private readonly queue = new KeyQueue();
  private readonly timeoutMs: number;
  private blockCache: { height: number; at: number } | null = null;

  constructor(options: NearChainOptions) {
    accountIdSchema.parse(options.contractId);
    this.network = options.network;
    this.contractId = options.contractId;
    this.provider = new JsonRpcProvider({ url: options.rpcUrl });
    this.timeoutMs = options.requestTimeoutMs ?? 30_000;
    for (const [accountId, privateKey] of Object.entries(options.signers)) {
      accountIdSchema.parse(accountId);
      const pair = KeyPair.fromString(privateKey as KeyPairString);
      this.signers.set(accountId, pair);
      this.accounts.set(accountId, new Account(accountId, this.provider, new KeyPairSigner(pair)));
    }
  }

  hasSigner(accountId: string): boolean {
    return this.signers.has(accountId);
  }

  publicKeyFor(accountId: string): string | null {
    return this.signers.get(accountId)?.getPublicKey().toString() ?? null;
  }

  account(accountId: string): Account {
    const account = this.accounts.get(accountId);
    if (!account) {
      throw new Error(`NO_SIGNER_FOR_${accountId}: configure this account's private key server-side only`);
    }
    return account;
  }

  async getTask(taskId: string): Promise<ChainTaskView | null> {
    const value = await this.view("get_task", { task_id: taskId });
    return value == null ? null : chainTaskViewSchema.parse(value);
  }

  async getBudget(taskId: string): Promise<ChainBudgetView | null> {
    const value = await this.view("get_budget", { task_id: taskId });
    return value == null ? null : chainBudgetViewSchema.parse(value);
  }

  async getOperation(taskId: string, operationId: string): Promise<ChainOperationView | null> {
    if (!/^[0-9a-f]{64}$/.test(operationId)) throw new Error("OPERATION_ID_INVALID");
    const value = await this.view("get_operation", { task_id: taskId, operation_id: operationId });
    return value == null ? null : chainOperationViewSchema.parse(value);
  }

  async listAgents(taskId: string): Promise<ChainTaskView["agents"]> {
    const value = await this.view("list_agents", { task_id: taskId });
    return chainTaskViewSchema.shape.agents.parse(value);
  }

  async getConfig(): Promise<ChainConfigView> {
    return chainConfigViewSchema.parse(await this.view("get_config", {}));
  }

  /**
   * Drop cached nonce state for one signer. A transaction signed by this key may
   * have been submitted by another process (for example the policy probe in the
   * API), so an InvalidNonce response means the local cache must be re-read from
   * chain before the next signature.
   */
  resetSignerNonce(accountId: string): void {
    const pair = this.signers.get(accountId);
    if (!pair) return;
    this.accounts.set(accountId, new Account(accountId, this.provider, new KeyPairSigner(pair)));
  }

  async getCurrentBlock(): Promise<number> {
    if (this.blockCache && Date.now() - this.blockCache.at < 1_500) return this.blockCache.height;
    const block = await withTimeout(
      this.provider.viewBlock({ finality: "final" }),
      this.timeoutMs,
      "viewBlock",
      null,
    );
    const height = block.header.height;
    this.blockCache = { height, at: Date.now() };
    return height;
  }

  async view<T = unknown>(method: string, args: Record<string, unknown>): Promise<T | null> {
    try {
      const result = await withTimeout(
        this.provider.callFunction({
          contractId: this.contractId,
          method,
          args,
          blockQuery: { finality: "final" },
        }),
        this.timeoutMs,
        `view:${method}`,
        null,
      );
      return (result ?? null) as T | null;
    } catch (error) {
      const message = messageOf(error);
      if (/ContractExecutionError|panicked/i.test(message)) {
        throw new ChainDenialError(extractDenialCode(message), null, message);
      }
      throw new ChainTransportError(`View ${method} failed: ${message}`, null, error);
    }
  }

  /** Sign and hash without broadcasting. The caller must persist the hash first. */
  async prepare(input: {
    signerAccountId: string;
    methodName: string;
    args: Record<string, unknown>;
    gasTgas?: number;
    depositYocto?: string;
  }): Promise<PreparedTransaction> {
    return this.prepareBatch({
      signerAccountId: input.signerAccountId,
      actions: [
        {
          methodName: input.methodName,
          args: input.args,
          gasTgas: input.gasTgas ?? defaultGas(input.methodName),
          depositYocto: input.depositYocto ?? "0",
        },
      ],
    });
  }

  /** Prepare a multi-action transaction, used for the one-approval task setup bundle. */
  async prepareBatch(input: {
    signerAccountId: string;
    actions: ActionSpec[];
  }): Promise<PreparedTransaction> {
    if (input.actions.length === 0) throw new Error("A transaction needs at least one action");
    const account = this.account(input.signerAccountId);
    const nearActions = input.actions.map((action) =>
      actions.functionCall(
        action.methodName,
        action.args,
        BigInt(action.gasTgas) * 1_000_000_000_000n,
        parseYoctoString(action.depositYocto),
      ),
    );
    const totalDeposit = input.actions.reduce(
      (sum, action) => sum + parseYoctoString(action.depositYocto),
      0n,
    );

    return this.queue.run(input.signerAccountId, async () => {
      const signed = await withTimeout(
        account.createSignedTransaction({
          receiverId: this.contractId,
          actions: nearActions,
        }),
        this.timeoutMs,
        "createSignedTransaction",
        null,
      );
      const txHash = baseEncode(sha256Bytes(signed.transaction.encode()));
      return {
        signerAccountId: input.signerAccountId,
        receiverId: this.contractId,
        methodName: input.actions.length === 1 ? input.actions[0]!.methodName : "batch",
        args: input.actions.length === 1 ? input.actions[0]!.args : {},
        actions: input.actions,
        gasTgas: input.actions.reduce((sum, action) => sum + action.gasTgas, 0),
        depositYocto: totalDeposit.toString(),
        txHash,
        signed,
        preparedAt: new Date().toISOString(),
      };
    });
  }

  /**
   * Broadcast a prepared transaction. `dropResponseAfterSend` deliberately loses the
   * result *after* the node accepted it, to exercise durable recovery.
   */
  async submit(
    prepared: PreparedTransaction,
    options: { dropResponseAfterSend?: boolean } = {},
  ): Promise<ChainOutcome> {
    let response: Awaited<ReturnType<JsonRpcProvider["sendTransactionUntil"]>>;
    try {
      response = await withTimeout(
        this.provider.sendTransactionUntil(prepared.signed, "FINAL"),
        this.timeoutMs,
        "sendTransaction",
        prepared.txHash,
      );
    } catch (error) {
      // A failed submission has not advanced this process's cached nonce. Reset it
      // even for an execution denial (the access key nonce did advance on chain).
      this.resetSignerNonce(prepared.signerAccountId);
      const message = messageOf(error);
      const denial = extractDenialCode(message);
      if (denial) throw new ChainDenialError(denial, prepared.txHash, message);
      throw new ChainTransportError(`Transaction submission failed: ${message}`, prepared.txHash, error);
    }

    const outcome = outcomeFromResponse(response, prepared.txHash);
    if (options.dropResponseAfterSend) {
      throw new InjectedResponseLoss(
        `FAULT_INJECTED: response for ${prepared.txHash} dropped after submission`,
        prepared.txHash,
      );
    }
    if (outcome.status === "failure") {
      this.resetSignerNonce(prepared.signerAccountId);
      throw new ChainDenialError(outcome.errorCode, prepared.txHash, outcome.errorMessage ?? "Transaction failed");
    }
    return outcome;
  }

  async call(input: {
    signerAccountId: string;
    methodName: string;
    args: Record<string, unknown>;
    gasTgas?: number;
    depositYocto?: string;
    onPrepared?: (prepared: PreparedTransaction) => Promise<void> | void;
    dropResponseAfterSend?: boolean;
  }): Promise<ChainOutcome> {
    const prepared = await this.prepare(input);
    await input.onPrepared?.(prepared);
    return this.submit(prepared, { dropResponseAfterSend: input.dropResponseAfterSend });
  }

  /** Look up a known transaction hash. Never used to create a payment. */
  async transactionStatus(txHash: string, signerAccountId: string): Promise<ChainOutcome> {
    try {
      const response = await withTimeout(
        this.provider.viewTransactionStatusWithReceipts({
          txHash,
          accountId: signerAccountId,
          waitUntil: "FINAL",
        }),
        this.timeoutMs,
        "viewTransactionStatus",
        txHash,
      );
      return outcomeFromResponse(response, txHash);
    } catch (error) {
      const message = messageOf(error);
      if (/UNKNOWN_TRANSACTION|does not exist|not found|UnknownTransaction/i.test(message)) {
        return {
          status: "not_found",
          txHash,
          receiptIds: [],
          errorCode: null,
          errorMessage: null,
          blockHeight: null,
        };
      }
      return {
        status: "unknown",
        txHash,
        receiptIds: [],
        errorCode: null,
        errorMessage: message,
        blockHeight: null,
      };
    }
  }

  // ------------------------------------------------------------- typed wrappers

  reserve(signerAccountId: string, request: ContractReserveRequest) {
    return this.prepare({ signerAccountId, methodName: "reserve", args: { request }, gasTgas: 60 });
  }

  execute(signerAccountId: string, taskId: string, operationId: string, dropResponse = false) {
    return this.call({
      signerAccountId,
      methodName: "execute",
      args: { task_id: taskId, operation_id: operationId },
      gasTgas: 120,
      dropResponseAfterSend: dropResponse,
    });
  }

  cancel(signerAccountId: string, taskId: string, operationId: string) {
    return this.call({
      signerAccountId,
      methodName: "cancel_reservation",
      args: { task_id: taskId, operation_id: operationId },
      gasTgas: 50,
    });
  }

  expire(signerAccountId: string, taskId: string, operationId: string) {
    return this.call({
      signerAccountId,
      methodName: "expire_reservation",
      args: { task_id: taskId, operation_id: operationId },
      gasTgas: 50,
    });
  }
}

export function outcomeFromResponse(
  response: Awaited<ReturnType<JsonRpcProvider["sendTransactionUntil"]>>,
  fallbackHash: string,
): ChainOutcome {
  const txHash = response.transaction?.hash ?? fallbackHash;
  const receiptIds = (response.receipts_outcome ?? []).map((receipt) => receipt.id);
  const status = response.status as unknown;
  if (isSuccessStatus(status)) {
    return {
      status: "success",
      txHash,
      receiptIds,
      errorCode: null,
      errorMessage: null,
      blockHeight: null,
      raw: status,
    };
  }
  // The top-level status is often just a receipt id. The panic message lives in
  // the receipt outcome, so collect both or denials lose their machine code.
  const messages = [
    ...collectFailureMessages(status),
    ...(response.receipts_outcome ?? []).flatMap((receipt) =>
      collectFailureMessages(receipt.outcome?.status),
    ),
  ];
  const joined = messages.join(" ");
  return {
    status: "failure",
    txHash,
    receiptIds,
    errorCode: extractDenialCode(joined),
    errorMessage: joined || "Transaction failed",
    blockHeight: null,
    raw: status,
  };
}

function defaultGas(methodName: string): number {
  switch (methodName) {
    case "execute":
      return 120;
    case "reserve":
      return 60;
    case "create_task":
    case "register_agent":
      return 50;
    case "withdraw_available":
      return 50;
    default:
      return 40;
  }
}

export interface TaskSetupPlanInput {
  taskId: string;
  name: string;
  policy: ContractPolicyInput;
  fundingYocto: string;
  agents: Array<{ accountId: string; publicKey: string }>;
  config: ChainConfigView;
}

export interface TaskSetupPlan {
  receiverId: string;
  actions: ActionSpec[];
  totalDepositYocto: string;
  summary: {
    storageDepositYocto: string;
    budgetFundingYocto: string;
    perAgentDepositYocto: string;
  };
}

/**
 * One wallet approval can carry the whole setup: task creation, budget funding and
 * agent registration as separate actions. Each action keeps its own deposit, so the
 * accounting never conflates storage with spending money.
 */
export function buildTaskSetupPlan(
  input: TaskSetupPlanInput,
  contractId: string,
): TaskSetupPlan {
  const funding = parseYoctoString(input.fundingYocto);
  if (funding <= 0n) throw new Error("Funding must be positive");

  const actionsOut: ActionSpec[] = [
    {
      methodName: "create_task",
      args: {
        task_id: input.taskId,
        name: input.name,
        policy: input.policy,
      },
      gasTgas: 60,
      depositYocto: input.config.task_storage_deposit,
    },
    {
      methodName: "fund_task",
      args: { task_id: input.taskId },
      gasTgas: 50,
      depositYocto: input.fundingYocto,
    },
  ];

  for (const agent of input.agents) {
    actionsOut.push({
      methodName: "register_agent",
      args: {
        task_id: input.taskId,
        account_id: agent.accountId,
        public_key: agent.publicKey,
      },
      gasTgas: 50,
      depositYocto: input.config.agent_storage_deposit,
    });
  }

  const total = actionsOut.reduce((sum, action) => sum + BigInt(action.depositYocto), 0n);
  return {
    receiverId: contractId,
    actions: actionsOut,
    totalDepositYocto: total.toString(),
    summary: {
      storageDepositYocto: input.config.task_storage_deposit,
      budgetFundingYocto: input.fundingYocto,
      perAgentDepositYocto: input.config.agent_storage_deposit,
    },
  };
}

export function operationKey(taskId: string, operationId: string): string {
  return `${taskId}:${hex64Schema.parse(operationId)}`;
}
