import { PublicKey } from "near-api-js";
import {
  base64ToBytes,
  providerAuthChallengeHash,
  type ChainOperationView,
  type ProviderAuth,
  bytesToHex,
  nep413Hash,
} from "@poolguard/shared";

export const CLOCK_SKEW_MS = 60_000;
export const AUTH_WINDOW_MS = 5 * 60_000;

/** When a signed authorization issued at `issuedAt` stops being acceptable. */
export function authExpiresAt(issuedAt: string): number {
  return Date.parse(issuedAt) + AUTH_WINDOW_MS + CLOCK_SKEW_MS;
}

export interface AgentRegistration {
  account_id: string;
  public_key: string;
  active: boolean;
}

export type AuthCheck =
  | { ok: true }
  | { ok: false; code: "BUYER_NOT_AUTHORIZED" | "AUTH_STALE" | "AUTH_MALFORMED"; message: string };

/**
 * Verifies that the caller holds the key registered for this agent on the task,
 * and that the signed payload matches this exact operation/request. This is an
 * ed25519 signature check over a canonical SHA-256 digest; it is not a NEAR
 * transaction and grants no spending authority by itself.
 */
export function verifyBuyerAuth(input: {
  auth: ProviderAuth;
  agents: AgentRegistration[];
  action: "purchase" | "result";
  domain: string;
  network: string;
  contractId: string;
  operationId: string;
  requestHash: string;
  now?: Date;
}): AuthCheck {
  const now = (input.now ?? new Date()).getTime();
  const issued = Date.parse(input.auth.issued_at);
  if (!Number.isFinite(issued)) {
    return { ok: false, code: "AUTH_MALFORMED", message: "issued_at is not a valid timestamp" };
  }
  if (issued > now + CLOCK_SKEW_MS || now - issued > AUTH_WINDOW_MS) {
    return { ok: false, code: "AUTH_STALE", message: "The signed request is outside the 5 minute window" };
  }

  const agent = input.agents.find((entry) => entry.account_id === input.auth.agent_account_id);
  if (!agent || !agent.active) {
    return { ok: false, code: "BUYER_NOT_AUTHORIZED", message: "Agent is not registered and active on this task" };
  }
  if (agent.public_key !== input.auth.public_key) {
    return { ok: false, code: "BUYER_NOT_AUTHORIZED", message: "Public key does not match the registered agent key" };
  }

  let signature: Uint8Array;
  try {
    signature = base64ToBytes(input.auth.signature_base64);
  } catch {
    return { ok: false, code: "AUTH_MALFORMED", message: "Signature is not valid base64" };
  }

  const digest = providerAuthChallengeHash({
    domain: input.domain,
    network: input.network,
    contractId: input.contractId,
    action: input.action,
    operationId: input.operationId,
    requestHash: input.requestHash,
    issuedAt: input.auth.issued_at,
    nonce: input.auth.nonce,
  });

  // NEP-413: custody wallets (OutLayer) sign the digest's hex as a standard NEAR
  // signed message. The key is still the contract-registered agent key.
  let signedBytes: Uint8Array = digest;
  if (input.auth.scheme === "nep413") {
    let nonceBytes: Uint8Array;
    try {
      nonceBytes = base64ToBytes(input.auth.nonce);
    } catch {
      return { ok: false, code: "AUTH_MALFORMED", message: "NEP-413 nonce is not valid base64" };
    }
    if (nonceBytes.length !== 32) {
      return { ok: false, code: "AUTH_MALFORMED", message: "NEP-413 nonce must be 32 bytes" };
    }
    signedBytes = nep413Hash({ message: bytesToHex(digest), nonce: nonceBytes, recipient: input.domain });
  }

  try {
    // Verify with the registered public key, not a keypair reconstructed from it.
    const verified = PublicKey.fromString(agent.public_key).verify(signedBytes, signature);
    if (!verified) {
      return { ok: false, code: "BUYER_NOT_AUTHORIZED", message: "Signature did not verify" };
    }
  } catch {
    return { ok: false, code: "BUYER_NOT_AUTHORIZED", message: "Signature could not be verified" };
  }
  return { ok: true };
}

export interface PaymentCheckInput {
  taskId: string;
  operationId: string;
  requestHash: string;
  outputSchemaHash: string;
  priceYocto: string;
}

export type PaymentCheck =
  | {
      ok: true;
      evidence: {
        operationId: string;
        taskId: string;
        providerAccountId: string;
        agentAccountId: string;
        amountYocto: string;
        settledAtBlock: number | null;
      };
    }
  | {
      ok: false;
      code:
        | "PAYMENT_NOT_FOUND"
        | "PAYMENT_PENDING"
        | "PAYMENT_NOT_SETTLED"
        | "PAYMENT_PROVIDER_MISMATCH"
        | "PAYMENT_REQUEST_MISMATCH"
        | "PAYMENT_AMOUNT_MISMATCH";
      message: string;
      retryAfterSeconds?: number;
    };

/**
 * The provider's independent check: finalized chain state, correct contract and
 * network (bound by the chain client), correct provider account and amount, and the
 * exact request binding. A client's "paid" flag is never consulted.
 */
export async function verifyPaidOperation(input: {
  chain: { getOperation(taskId: string, operationId: string): Promise<ChainOperationView | null> };
  providerAccountId: string;
  expected: PaymentCheckInput;
}): Promise<PaymentCheck> {
  const operation = await input.chain.getOperation(input.expected.taskId, input.expected.operationId);
  if (!operation) {
    return {
      ok: false,
      code: "PAYMENT_NOT_FOUND",
      message: "No operation with that id exists on the PoolGuard contract for this task",
    };
  }
  if (operation.provider_id !== input.providerAccountId) {
    return {
      ok: false,
      code: "PAYMENT_PROVIDER_MISMATCH",
      message: "Operation pays a different provider account",
    };
  }
  if (operation.request_hash !== input.expected.requestHash) {
    return {
      ok: false,
      code: "PAYMENT_REQUEST_MISMATCH",
      message: "On-chain request hash does not match the supplied document",
    };
  }
  if (operation.output_schema_hash !== input.expected.outputSchemaHash) {
    return {
      ok: false,
      code: "PAYMENT_REQUEST_MISMATCH",
      message: "On-chain output schema hash does not match the service schema",
    };
  }
  if (operation.amount !== input.expected.priceYocto) {
    return {
      ok: false,
      code: "PAYMENT_AMOUNT_MISMATCH",
      message: "On-chain amount does not match this service's fixed price",
    };
  }
  if (operation.payment_state === "reserved") {
    return {
      ok: false,
      code: "PAYMENT_PENDING",
      message: "Payment has been reserved but not dispatched yet",
      retryAfterSeconds: 2,
    };
  }
  if (operation.payment_state === "payout_pending") {
    return {
      ok: false,
      code: "PAYMENT_PENDING",
      message: "Payment is awaiting finalized chain settlement",
      retryAfterSeconds: 2,
    };
  }
  if (operation.payment_state !== "paid") {
    return {
      ok: false,
      code: "PAYMENT_NOT_SETTLED",
      message: `Payment state is ${operation.payment_state}; the provider will not deliver without finalized payment`,
    };
  }
  return {
    ok: true,
    evidence: {
      operationId: operation.operation_id,
      taskId: operation.task_id,
      providerAccountId: operation.provider_id,
      agentAccountId: operation.agent_id,
      amountYocto: operation.amount,
      settledAtBlock: operation.settled_at_block,
    },
  };
}
