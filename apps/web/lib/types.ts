import type { ActivityEvent, CatalogResponse, TaskLifecycle } from "@poolguard/shared";

export type { ActivityEvent, CatalogResponse, TaskLifecycle };

export interface Meta {
  network: "sandbox" | "testnet";
  contractId: string;
  ownerAccountId: string | null;
  providerAccountId: string;
  workerAccounts: Array<{
    slot: 1 | 2;
    accountId: string;
    publicKey: string | null;
    keyConfigured: boolean;
  }>;
  apiOrigin: string;
  webOrigin: string;
  sandbox: boolean;
  devSessionEnabled: boolean;
  aiConfigured: boolean;
  aiModel: string;
  policyProbeConfigured: boolean;
  chainConfig: {
    task_storage_deposit: string;
    agent_storage_deposit: string;
    withdrawal_storage_deposit: string;
    max_operations_per_task: number;
    max_operations_per_agent?: number;
    max_agents: number;
    max_providers: number;
  } | null;
  testTokens: boolean;
  disclaimer: string;
}

export interface Session {
  authenticated: boolean;
  user?: { accountId: string };
  csrf_token?: string | null;
  network?: "sandbox" | "testnet";
  sandbox?: boolean;
  devSessionEnabled?: boolean;
  aiConfigured?: boolean;
  mode?: string;
  notice?: string;
}

export interface Challenge {
  challenge_id: string;
  message: string;
  nonce: string;
  recipient: string;
  network: string;
  expires_at: string;
}

export interface Budget {
  totalFundedYocto: string;
  availableYocto: string;
  reservedYocto: string;
  spentYocto: string;
  withdrawnYocto: string;
  withdrawalPendingYocto: string;
  invariantHolds: boolean | null;
  source: "chain" | "cache";
  stale: boolean;
  checkedAt: string | null;
  lifecycle: TaskLifecycle;
}

export interface Agent {
  id: string;
  label: string;
  slot?: number;
  accountId: string;
  publicKey: string | null;
  status: "registered" | "revoked";
  keyConfigured: boolean;
  registeredAtBlock?: number | null;
}

export interface Document {
  id: string;
  label: string;
  filename: string;
  byteSize: number;
  sha256: string;
}

export interface ChainTransaction {
  id: string;
  kind: string;
  status: string;
  txHash: string | null;
  blockHeight: number | null;
  error: string | null;
  createdAt: string;
}

export interface Operation {
  id: string;
  chainOperationId: string;
  taskId: string;
  agent: { id: string; label: string; accountId: string };
  providerAccountId: string;
  serviceId: string;
  amountYocto: string;
  requestHash: string;
  outputSchemaHash: string;
  policyVersion: number;
  paymentState: string;
  fulfillmentState: string;
  reservationExpiresAtBlock: number;
  expiresAtBlock: number;
  chainCreatedAtBlock: number | null;
  settledAtBlock: number | null;
  payoutAttempts: number;
  recoveryAttempts: number;
  needsRecovery: boolean;
  denialCode: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  transactions: ChainTransaction[];
  chainState?: {
    paymentState: string;
    payoutAttempts: number;
    settledAtBlock: number | null;
    reservationExpiresAtBlock: number;
    source: "chain";
  } | null;
  explorerUrl?: string | null;
  delivery?: {
    status: string;
    deliveredAt: string | null;
    attempts: number;
    hasResult: boolean;
  };
}

export interface Run {
  id: string;
  runId: string;
  agentId: string;
  mode: "live" | "scripted";
  status: string;
  steps: number;
  tokensUsed: number;
  summary: string | null;
  denialCode: string | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface ComparisonEntry {
  operationId: string;
  agentLabel: string;
  documentLabel: string;
  supplier: string | null;
  quotes: Array<{ amount: string; currency: string }>;
  deliveryTerms: string[];
  missingFields: string[];
  warnings: string[];
  deliveredAt: string | null;
}

export interface TaskResult {
  entries: ComparisonEntry[];
  incomplete: boolean;
  differences: string[];
}

export interface Task {
  id: string;
  chainTaskId: string;
  name: string;
  objective: string;
  status: "draft" | "awaiting_funding" | "active" | "paused" | "expired";
  paused: boolean;
  network: "sandbox" | "testnet";
  contractId: string;
  ownerAccountId: string;
  createdAt: string;
  updatedAt: string;
  policy: {
    version: number;
    maxPerOperationYocto: string;
    allowedProviders: string[];
    reservationTtlBlocks: number;
    expiresAtBlock: number;
  };
  budget: Budget;
  currentBlock: number | null;
  syncWarning: string | null;
  setup: {
    storageDepositYocto: string;
    budgetGoalYocto: string;
    withdrawalStorageDepositYocto: string | null;
  };
  agents: Agent[];
  documents: Document[];
  operations: Operation[];
  runs: Run[];
  result: TaskResult;
  pendingRecoveries: number;
  chainProjection: {
    totalFunded: string;
    available: string;
    reserved: string;
    spent: string;
    withdrawn: string;
    withdrawalPending: string;
  } | null;
}

export interface TaskSummary {
  id: string;
  chainTaskId: string;
  name: string;
  objective?: string;
  status: string;
  paused: boolean;
  agentCount: number;
  agents?: Agent[];
  totalFundedYocto: string;
  availableYocto: string;
  reservedYocto: string;
  spentYocto: string;
  updatedAt: string;
  createdAt?: string;
  pendingRecoveries: number;
}

export interface Overview {
  totals: {
    availableYocto: string;
    reservedYocto: string;
    spentYocto: string;
    includedTaskIds: string[];
  };
  tasks: TaskSummary[];
  recentOperations: Array<Operation & { taskName: string }>;
  pendingRecoveries: number;
  network: string;
  contractId: string;
  chain: { status: string; rpcUrl: string };
}

export interface TxPlan {
  receiver_id: string;
  network: string;
  actions: Array<{
    method_name: string;
    args: Record<string, unknown>;
    gas_tgas: number;
    deposit_yocto: string;
  }>;
  total_deposit_yocto: string;
  summary?: {
    storageDepositYocto: string;
    budgetFundingYocto: string;
    perAgentDepositYocto: string;
  };
  task_id?: string;
  owner_account_id?: string;
  contract_id?: string;
  notice?: string | null;
  action?: string;
}

export interface RunResponse {
  run_id: string;
  mode: "live" | "scripted";
  agent_count: number;
  notice?: string | null;
}

export interface DemoResponse {
  run_id: string;
  scenario: "A" | "B" | "C" | "D";
  mode: "live" | "scripted";
  notice: string;
  expected: string;
  policy_probe?: {
    denied?: boolean;
    code?: string;
    tx_hash?: string;
    attempted_provider?: string;
    error?: string;
  } | null;
}
