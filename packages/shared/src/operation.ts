import { canonicalize } from "./canonical.js";
import { bytesToHex, sha256Bytes, sha256Hex } from "./sha256.js";

export const OPERATION_DOMAIN = "poolguard/operation/v1";
export const REQUEST_HASH_DOMAIN = "poolguard/provider-request/v1";

export interface OperationBindingInput {
  network: string;
  contractId: string;
  taskId: string;
  agentAccountId: string;
  providerAccountId: string;
  amountYocto: string;
  serviceId: string;
  requestHash: string;
  outputSchemaHash: string;
  policyVersion: number;
  expiresAtBlock: number;
}

/**
 * The canonical binding hashed into an operation id. Snake_case keys are part of
 * the wire format: changing one changes every id, so this object is versioned by
 * OPERATION_DOMAIN and must only change with a domain bump.
 */
export function operationBindingPayload(input: OperationBindingInput) {
  return {
    domain: OPERATION_DOMAIN,
    network: input.network,
    contract_id: input.contractId,
    task_id: input.taskId,
    agent_id: input.agentAccountId,
    provider_id: input.providerAccountId,
    amount_yocto: input.amountYocto,
    service_id: input.serviceId,
    request_hash: input.requestHash,
    output_schema_hash: input.outputSchemaHash,
    policy_version: input.policyVersion,
    expires_at_block: input.expiresAtBlock,
  };
}

/** Stable id for one logical purchase, reused across every transport retry. */
export function computeOperationId(input: OperationBindingInput): string {
  return sha256Hex(canonicalize(operationBindingPayload(input)));
}

/**
 * Hash of the exact purchased input for a service. The provider recomputes this
 * from the request body and rejects a mismatch before processing.
 */
export function computeRequestHash(serviceId: string, input: unknown): string {
  return sha256Hex(
    canonicalize({
      domain: REQUEST_HASH_DOMAIN,
      service_id: serviceId,
      input,
    }),
  );
}

export function computeOutputSchemaHash(schema: unknown): string {
  return sha256Hex(canonicalize({ domain: "poolguard/output-schema/v1", schema }));
}

export interface ProviderAuthPayloadInput {
  domain: string;
  network: string;
  contractId: string;
  action: "purchase" | "result";
  operationId: string;
  requestHash: string;
  issuedAt: string;
  nonce: string;
}

/** Signed by the worker's registered key; verified by the provider. */
export function providerAuthPayload(input: ProviderAuthPayloadInput) {
  return {
    domain: input.domain,
    network: input.network,
    contract_id: input.contractId,
    action: input.action,
    operation_id: input.operationId,
    request_hash: input.requestHash,
    issued_at: input.issuedAt,
    nonce: input.nonce,
  };
}

/**
 * Header names for a signed provider authorization on GET requests. Headers keep
 * signatures out of URLs, where proxies and access logs would record them.
 */
export const PROVIDER_AUTH_HEADERS = {
  agent: "x-poolguard-agent",
  publicKey: "x-poolguard-public-key",
  signature: "x-poolguard-signature",
  issuedAt: "x-poolguard-issued-at",
  nonce: "x-poolguard-nonce",
  scheme: "x-poolguard-auth-scheme",
} as const;

export function providerAuthChallengeHash(input: ProviderAuthPayloadInput): Uint8Array {
  const hex = sha256Hex(canonicalize(providerAuthPayload(input)));
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** NEP-413 tag: 2^31 + 413, prefixed to every signed-message payload. */
const NEP413_TAG = 2_147_484_061;

function borshString(value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value);
  const out = new Uint8Array(4 + bytes.length);
  new DataView(out.buffer).setUint32(0, bytes.length, true);
  out.set(bytes, 4);
  return out;
}

/**
 * SHA-256 of a NEP-413 payload `{ message, nonce, recipient, callbackUrl: None }`
 * with its tag prefix: the exact bytes a NEAR wallet signs for `signMessage`.
 */
export function nep413Hash(input: { message: string; nonce: Uint8Array; recipient: string }): Uint8Array {
  if (input.nonce.length !== 32) throw new Error("NEP-413 nonce must be 32 bytes");
  const tag = new Uint8Array(4);
  new DataView(tag.buffer).setUint32(0, NEP413_TAG, true);
  const parts = [tag, borshString(input.message), input.nonce, borshString(input.recipient), new Uint8Array([0])];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return sha256Bytes(bytes);
}

/** The message text a custody wallet signs for provider auth: the challenge digest in hex. */
export function providerAuthNep413Message(input: ProviderAuthPayloadInput): string {
  return bytesToHex(providerAuthChallengeHash(input));
}
