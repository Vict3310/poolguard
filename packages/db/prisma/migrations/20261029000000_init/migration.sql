-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('DRAFT', 'AWAITING_FUNDING', 'ACTIVE', 'PAUSED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PaymentState" AS ENUM ('RESERVED', 'PAYOUT_PENDING', 'PAID', 'PAYOUT_FAILED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "FulfillmentState" AS ENUM ('NOT_REQUESTED', 'PROCESSING', 'DELIVERED', 'DELIVERY_FAILED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "AgentStatus" AS ENUM ('REGISTERED', 'REVOKED');

-- CreateEnum
CREATE TYPE "JobKind" AS ENUM ('RUN_AGENT', 'RECOVER_OPERATION', 'SYNC_TASK', 'DEMO_SCENARIO');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DEAD');

-- CreateEnum
CREATE TYPE "ChainTxKind" AS ENUM ('CREATE_TASK', 'FUND_TASK', 'REGISTER_AGENT', 'UPDATE_POLICY', 'REVOKE_AGENT', 'PAUSE_TASK', 'RESUME_TASK', 'WITHDRAW', 'RESERVE', 'EXECUTE', 'CANCEL', 'EXPIRE');

-- CreateEnum
CREATE TYPE "ChainTxStatus" AS ENUM ('PREPARED', 'SUBMITTED', 'SUCCESS', 'FAILED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ProviderResultStatus" AS ENUM ('PROCESSING', 'DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "AgentRunMode" AS ENUM ('LIVE', 'SCRIPTED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "displayName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "csrfHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "WalletSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletChallenge" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "chainTaskId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "ownerAccountId" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "name" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'DRAFT',
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "policyVersion" INTEGER NOT NULL DEFAULT 1,
    "maxPerOperationYocto" TEXT NOT NULL,
    "allowedProviders" TEXT[],
    "reservationTtlBlocks" INTEGER NOT NULL,
    "expiresAtBlock" BIGINT NOT NULL,
    "setupStorageDepositYocto" TEXT NOT NULL,
    "budgetGoalYocto" TEXT NOT NULL,
    "totalFundedYocto" TEXT NOT NULL DEFAULT '0',
    "availableYocto" TEXT NOT NULL DEFAULT '0',
    "reservedYocto" TEXT NOT NULL DEFAULT '0',
    "spentYocto" TEXT NOT NULL DEFAULT '0',
    "withdrawnYocto" TEXT NOT NULL DEFAULT '0',
    "withdrawalPendingYocto" TEXT NOT NULL DEFAULT '0',
    "createdAtBlock" BIGINT,
    "syncedAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicySnapshot" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "maxPerOperationYocto" TEXT NOT NULL,
    "allowedProviders" TEXT[],
    "reservationTtlBlocks" INTEGER NOT NULL,
    "expiresAtBlock" BIGINT NOT NULL,
    "policyHash" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdTxHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "accountId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "keyEnvVar" TEXT NOT NULL,
    "status" "AgentStatus" NOT NULL DEFAULT 'REGISTERED',
    "registeredTxHash" TEXT,
    "registeredAtBlock" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Provider" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "operatorControlled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Provider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Service" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "serviceKey" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priceYocto" TEXT NOT NULL,
    "outputSchemaHash" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "engine" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "agentId" TEXT,
    "serviceId" TEXT NOT NULL,
    "documentId" TEXT,
    "providerQuoteId" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "outputSchemaHash" TEXT NOT NULL,
    "priceYocto" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentCiphertext" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Operation" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "chainTaskId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "amountYocto" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "outputSchemaHash" TEXT NOT NULL,
    "policyVersion" INTEGER NOT NULL,
    "documentId" TEXT,
    "paymentState" "PaymentState" NOT NULL DEFAULT 'RESERVED',
    "fulfillmentState" "FulfillmentState" NOT NULL DEFAULT 'NOT_REQUESTED',
    "reservationExpiresAtBlock" BIGINT NOT NULL,
    "expiresAtBlock" BIGINT NOT NULL,
    "chainCreatedAtBlock" BIGINT,
    "settledAtBlock" BIGINT,
    "payoutAttempts" INTEGER NOT NULL DEFAULT 0,
    "recoveryAttempts" INTEGER NOT NULL DEFAULT 0,
    "needsRecovery" BOOLEAN NOT NULL DEFAULT false,
    "lastError" TEXT,
    "denialCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Operation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChainTransaction" (
    "id" TEXT NOT NULL,
    "taskId" TEXT,
    "operationDbId" TEXT,
    "kind" "ChainTxKind" NOT NULL,
    "status" "ChainTxStatus" NOT NULL DEFAULT 'PREPARED',
    "txHash" TEXT,
    "signerAccountId" TEXT NOT NULL,
    "receiverId" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "blockHeight" BIGINT,
    "outcome" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "ChainTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderResult" (
    "id" TEXT NOT NULL,
    "chainTaskId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "outputSchemaHash" TEXT NOT NULL,
    "serviceKey" TEXT NOT NULL,
    "status" "ProviderResultStatus" NOT NULL DEFAULT 'PROCESSING',
    "resultJson" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "taskId" TEXT,

    CONSTRAINT "ProviderResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "kind" "JobKind" NOT NULL,
    "taskId" TEXT,
    "dedupeKey" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB NOT NULL,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "lastError" TEXT,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" BIGSERIAL NOT NULL,
    "taskId" TEXT,
    "operationId" TEXT,
    "type" TEXT NOT NULL,
    "actor" TEXT,
    "summary" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'neutral',
    "data" JSONB NOT NULL DEFAULT '{}',
    "dedupeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "mode" "AgentRunMode" NOT NULL,
    "status" "AgentRunStatus" NOT NULL DEFAULT 'QUEUED',
    "documentId" TEXT,
    "steps" INTEGER NOT NULL DEFAULT 0,
    "tokensUsed" INTEGER NOT NULL DEFAULT 0,
    "model" TEXT,
    "summary" TEXT,
    "outputJson" JSONB,
    "denialCode" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_accountId_key" ON "User"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "WalletSession_tokenHash_key" ON "WalletSession"("tokenHash");

-- CreateIndex
CREATE INDEX "WalletSession_userId_idx" ON "WalletSession"("userId");

-- CreateIndex
CREATE INDEX "WalletSession_expiresAt_idx" ON "WalletSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "WalletChallenge_nonce_key" ON "WalletChallenge"("nonce");

-- CreateIndex
CREATE INDEX "WalletChallenge_expiresAt_idx" ON "WalletChallenge"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Task_chainTaskId_key" ON "Task"("chainTaskId");

-- CreateIndex
CREATE INDEX "Task_ownerAccountId_idx" ON "Task"("ownerAccountId");

-- CreateIndex
CREATE INDEX "Task_status_idx" ON "Task"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PolicySnapshot_taskId_version_key" ON "PolicySnapshot"("taskId", "version");

-- CreateIndex
CREATE INDEX "Agent_accountId_idx" ON "Agent"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_taskId_accountId_key" ON "Agent"("taskId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_taskId_slot_key" ON "Agent"("taskId", "slot");

-- CreateIndex
CREATE UNIQUE INDEX "Provider_accountId_key" ON "Provider"("accountId");

-- CreateIndex
CREATE INDEX "Service_active_idx" ON "Service"("active");

-- CreateIndex
CREATE UNIQUE INDEX "Service_providerId_serviceKey_version_key" ON "Service"("providerId", "serviceKey", "version");

-- CreateIndex
CREATE INDEX "Quote_taskId_createdAt_idx" ON "Quote"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "Quote_requestHash_idx" ON "Quote"("requestHash");

-- CreateIndex
CREATE INDEX "Document_taskId_idx" ON "Document"("taskId");

-- CreateIndex
CREATE INDEX "Operation_taskId_createdAt_idx" ON "Operation"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "Operation_paymentState_idx" ON "Operation"("paymentState");

-- CreateIndex
CREATE INDEX "Operation_fulfillmentState_idx" ON "Operation"("fulfillmentState");

-- CreateIndex
CREATE INDEX "Operation_needsRecovery_idx" ON "Operation"("needsRecovery");

-- CreateIndex
CREATE UNIQUE INDEX "Operation_chainTaskId_operationId_key" ON "Operation"("chainTaskId", "operationId");

-- CreateIndex
CREATE UNIQUE INDEX "ChainTransaction_txHash_key" ON "ChainTransaction"("txHash");

-- CreateIndex
CREATE INDEX "ChainTransaction_operationDbId_createdAt_idx" ON "ChainTransaction"("operationDbId", "createdAt");

-- CreateIndex
CREATE INDEX "ChainTransaction_signerAccountId_idx" ON "ChainTransaction"("signerAccountId");

-- CreateIndex
CREATE INDEX "ChainTransaction_status_idx" ON "ChainTransaction"("status");

-- CreateIndex
CREATE INDEX "ProviderResult_status_idx" ON "ProviderResult"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderResult_chainTaskId_operationId_key" ON "ProviderResult"("chainTaskId", "operationId");

-- CreateIndex
CREATE UNIQUE INDEX "Job_dedupeKey_key" ON "Job"("dedupeKey");

-- CreateIndex
CREATE INDEX "Job_status_runAt_idx" ON "Job"("status", "runAt");

-- CreateIndex
CREATE INDEX "Job_leaseExpiresAt_idx" ON "Job"("leaseExpiresAt");

-- CreateIndex
CREATE INDEX "Job_taskId_idx" ON "Job"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "AuditEvent_dedupeKey_key" ON "AuditEvent"("dedupeKey");

-- CreateIndex
CREATE INDEX "AuditEvent_taskId_id_idx" ON "AuditEvent"("taskId", "id");

-- CreateIndex
CREATE INDEX "AuditEvent_operationId_idx" ON "AuditEvent"("operationId");

-- CreateIndex
CREATE INDEX "AgentRun_taskId_createdAt_idx" ON "AgentRun"("taskId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentRun_runId_agentId_key" ON "AgentRun"("runId", "agentId");

-- AddForeignKey
ALTER TABLE "WalletSession" ADD CONSTRAINT "WalletSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicySnapshot" ADD CONSTRAINT "PolicySnapshot_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Operation" ADD CONSTRAINT "Operation_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Operation" ADD CONSTRAINT "Operation_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Operation" ADD CONSTRAINT "Operation_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChainTransaction" ADD CONSTRAINT "ChainTransaction_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChainTransaction" ADD CONSTRAINT "ChainTransaction_operationDbId_fkey" FOREIGN KEY ("operationDbId") REFERENCES "Operation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderResult" ADD CONSTRAINT "ProviderResult_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- PoolGuard invariants enforced by the database.
-- ---------------------------------------------------------------------------

-- Financial columns are decimal integer strings, never floats or formatted money.
ALTER TABLE "Task"
  ADD CONSTRAINT "task_amounts_are_integer_strings" CHECK (
    "budgetGoalYocto" ~ '^[0-9]+$' AND
    "maxPerOperationYocto" ~ '^[0-9]+$' AND
    "setupStorageDepositYocto" ~ '^[0-9]+$' AND
    "totalFundedYocto" ~ '^[0-9]+$' AND
    "availableYocto" ~ '^[0-9]+$' AND
    "reservedYocto" ~ '^[0-9]+$' AND
    "spentYocto" ~ '^[0-9]+$' AND
    "withdrawnYocto" ~ '^[0-9]+$' AND
    "withdrawalPendingYocto" ~ '^[0-9]+$'
  );

ALTER TABLE "PolicySnapshot"
  ADD CONSTRAINT "policy_snapshot_cap_is_integer" CHECK ("maxPerOperationYocto" ~ '^[0-9]+$');

ALTER TABLE "Service"
  ADD CONSTRAINT "service_price_is_integer" CHECK ("priceYocto" ~ '^[0-9]+$');

ALTER TABLE "Quote"
  ADD CONSTRAINT "quote_price_is_integer" CHECK ("priceYocto" ~ '^[0-9]+$');

ALTER TABLE "Operation"
  ADD CONSTRAINT "operation_amount_is_integer" CHECK ("amountYocto" ~ '^[0-9]+$');

-- The purchase binding is immutable. Only state/projection columns may change.
CREATE OR REPLACE FUNCTION poolguard_operation_binding_immutable()
RETURNS trigger AS $$
BEGIN
  IF NEW."operationId" <> OLD."operationId"
     OR NEW."chainTaskId" <> OLD."chainTaskId"
     OR NEW."agentId" <> OLD."agentId"
     OR NEW."providerAccountId" <> OLD."providerAccountId"
     OR NEW."amountYocto" <> OLD."amountYocto"
     OR NEW."serviceId" <> OLD."serviceId"
     OR NEW."requestHash" <> OLD."requestHash"
     OR NEW."outputSchemaHash" <> OLD."outputSchemaHash"
     OR NEW."policyVersion" <> OLD."policyVersion"
     OR NEW."expiresAtBlock" <> OLD."expiresAtBlock" THEN
    RAISE EXCEPTION 'poolguard: operation binding is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "operation_binding_immutable"
BEFORE UPDATE ON "Operation"
FOR EACH ROW EXECUTE FUNCTION poolguard_operation_binding_immutable();

-- One provider result per logical operation.
CREATE UNIQUE INDEX "provider_result_one_per_operation"
  ON "ProviderResult" ("chainTaskId", "operationId");
