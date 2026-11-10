import { z } from "zod";

/** Payment state is authoritative on chain. */
export const paymentStateSchema = z.enum([
  "reserved",
  "payout_pending",
  "paid",
  "payout_failed",
  "cancelled",
  "expired",
]);
export type PaymentState = z.infer<typeof paymentStateSchema>;

/** Fulfillment state is off chain: the contract makes no delivery claim. */
export const fulfillmentStateSchema = z.enum([
  "not_requested",
  "processing",
  "delivered",
  "delivery_failed",
  "unknown",
]);
export type FulfillmentState = z.infer<typeof fulfillmentStateSchema>;

export const PAYMENT_STATE_LABELS: Record<PaymentState, string> = {
  reserved: "Reserved",
  payout_pending: "Payment pending",
  paid: "Paid",
  payout_failed: "Payment failed",
  cancelled: "Cancelled",
  expired: "Expired",
};

export const FULFILLMENT_STATE_LABELS: Record<FulfillmentState, string> = {
  not_requested: "Not requested",
  processing: "Processing",
  delivered: "Delivered",
  delivery_failed: "Delivery failed",
  unknown: "Checking status",
};

export const PAYMENT_TRANSITIONS: Record<PaymentState, readonly PaymentState[]> = {
  reserved: ["payout_pending", "cancelled", "expired"],
  payout_pending: ["paid", "payout_failed"],
  paid: [],
  payout_failed: [],
  cancelled: [],
  expired: [],
};

export const FULFILLMENT_TRANSITIONS: Record<FulfillmentState, readonly FulfillmentState[]> = {
  not_requested: ["processing", "delivery_failed"],
  processing: ["delivered", "delivery_failed", "unknown"],
  delivered: [],
  delivery_failed: ["processing"],
  unknown: ["delivered", "delivery_failed", "processing"],
};

export function canTransitionPayment(from: PaymentState, to: PaymentState): boolean {
  return PAYMENT_TRANSITIONS[from].includes(to);
}

export function canTransitionFulfillment(from: FulfillmentState, to: FulfillmentState): boolean {
  return FULFILLMENT_TRANSITIONS[from].includes(to);
}

export function isPaymentTerminal(state: PaymentState): boolean {
  return PAYMENT_TRANSITIONS[state].length === 0;
}

export function isFulfillmentTerminal(state: FulfillmentState): boolean {
  return FULFILLMENT_TRANSITIONS[state].length === 0;
}

/** Terminal outcomes that must never be mistaken for a retryable payment. */
export const NON_PAYABLE_STATES: readonly PaymentState[] = [
  "paid",
  "cancelled",
  "expired",
  "payout_failed",
];

export const CONTRACT_DENIAL_CODES = [
  "TASK_NOT_FOUND",
  "TASK_PAUSED",
  "TASK_EXPIRED",
  "AGENT_NOT_REGISTERED",
  "AGENT_REVOKED",
  "AGENT_KEY_MISMATCH",
  "AGENT_ID_MISMATCH",
  "SIGNER_PREDECESSOR_MISMATCH",
  "OPERATION_ID_INVALID",
  "OPERATION_ID_CONFLICT",
  "OPERATION_LIMIT_REACHED",
  "OPERATION_NOT_FOUND",
  "OPERATION_NOT_PAYABLE",
  "OPERATION_NOT_CANCELLABLE",
  "OPERATION_NOT_EXPIRABLE",
  "OPERATION_TERMINAL",
  "POLICY_VERSION_STALE",
  "PER_OPERATION_CAP_EXCEEDED",
  "PROVIDER_NOT_ALLOWED",
  "INSUFFICIENT_AVAILABLE_BUDGET",
  "RESERVATION_EXPIRED",
  "RESERVATION_NOT_EXPIRED",
  "UNAUTHORIZED_OWNER",
  "UNAUTHORIZED_AGENT_OPERATION",
  "AMOUNT_MUST_BE_POSITIVE",
  "TASK_ID_INVALID",
  "TASK_ALREADY_EXISTS",
  "TASK_STORAGE_DEPOSIT_REQUIRED",
  "AGENT_STORAGE_DEPOSIT_REQUIRED",
  "WITHDRAWAL_STORAGE_DEPOSIT_REQUIRED",
  "INSUFFICIENT_AVAILABLE_FUNDS",
  "CALLBACK_NOT_PRIVATE",
] as const;
export type ContractDenialCode = (typeof CONTRACT_DENIAL_CODES)[number];

const PANIC_TO_CODE: Record<string, ContractDenialCode> = Object.fromEntries(
  CONTRACT_DENIAL_CODES.map((code) => [code, code]),
) as Record<string, ContractDenialCode>;

/** Extract a stable denial code from an RPC error / panic message. */
export function extractDenialCode(message: string): ContractDenialCode | null {
  for (const [needle, code] of Object.entries(PANIC_TO_CODE)) {
    if (message.includes(needle)) return code;
  }
  return null;
}

export const DENIAL_EXPLANATIONS: Record<string, string> = {
  INSUFFICIENT_AVAILABLE_BUDGET:
    "Other agents already reserved enough of this task's shared budget.",
  PER_OPERATION_CAP_EXCEEDED: "This purchase is above the task's per-operation limit.",
  PROVIDER_NOT_ALLOWED: "That provider is not on this task's allowlist.",
  POLICY_VERSION_STALE: "The owner changed the policy after this reservation was made.",
  TASK_PAUSED: "The owner paused this task.",
  TASK_EXPIRED: "The task's expiry block has passed.",
  AGENT_REVOKED: "This agent was revoked by the task owner.",
  AGENT_KEY_MISMATCH: "The transaction was signed with a key that is not registered for this agent.",
  RESERVATION_EXPIRED: "The reservation expired before payment was dispatched.",
  OPERATION_NOT_CANCELLABLE: "Payment has already been dispatched for this operation.",
  OPERATION_ID_CONFLICT: "The operation id is already bound to different purchase parameters.",
  OPERATION_TERMINAL: "This operation already reached a final state. Start a new logical purchase.",
};
