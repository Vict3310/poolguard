/**
 * OutLayer agent custody: the worker's NEAR key lives inside OutLayer's TEE and the
 * worker signs through an API key. OutLayer enforces the wallet's policy (spend
 * caps, transaction types, freeze) before it signs; the PoolGuard contract then
 * enforces the task policy on chain. Two independent limits on every purchase.
 *
 * Docs: https://app.outlayer.ai/docs/agent-custody
 */
import { hexToBytes } from "@poolguard/shared";

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) + BigInt(byte);
  let out = "";
  while (value > 0n) {
    out = BASE58[Number(value % 58n)] + out;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = `1${out}`;
  }
  return out;
}

/** A NEAR implicit account id is the hex of its ed25519 public key. */
export function implicitAccountPublicKey(accountId: string): string | null {
  if (!/^[0-9a-f]{64}$/.test(accountId)) return null;
  return `ed25519:${base58(hexToBytes(accountId))}`;
}

export class OutLayerError extends Error {
  override name = "OutLayerError";
  constructor(
    message: string,
    readonly status: number | null,
    readonly code: string | null,
    readonly txHash: string | null,
  ) {
    super(message);
  }
  /** On-chain revert or policy denial: definitive, never retried. */
  get definitive(): boolean {
    return this.code === "onchain_tx_failed" || this.code === "policy_denied" || this.code === "wallet_frozen";
  }
}

export interface OutLayerCallResult {
  txHash: string | null;
  status: string | null;
  result: unknown;
  raw: Record<string, unknown>;
}

function pickTxHash(body: Record<string, unknown>): string | null {
  for (const key of ["tx_hash", "transaction_hash", "hash"]) {
    if (typeof body[key] === "string" && body[key]) return body[key] as string;
  }
  const result = body.result as Record<string, unknown> | undefined;
  const tx = (result?.transaction as Record<string, unknown> | undefined) ?? undefined;
  if (tx && typeof tx.hash === "string") return tx.hash;
  return null;
}

function describe(body: Record<string, unknown>): string {
  const parts = [body.error, body.message, body.detail, body.result]
    .map((value) => (typeof value === "string" ? value : value ? JSON.stringify(value) : ""))
    .filter(Boolean);
  return parts.join(" · ").slice(0, 1_500);
}

export class OutLayerClient {
  private readonly base: string;
  constructor(
    private readonly options: { apiUrl: string; apiKey: string; timeoutMs?: number },
  ) {
    this.base = options.apiUrl.replace(/\/+$/, "");
  }

  private async request(method: "GET" | "POST", path: string, body?: unknown): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await fetch(`${this.base}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          accept: "application/json",
          ...(body ? { "content-type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 45_000),
      });
    } catch (error) {
      throw new OutLayerError(
        `OutLayer request failed: ${error instanceof Error ? error.message : String(error)}`,
        null,
        "transport",
        null,
      );
    }
    const text = await response.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      parsed = { message: text.slice(0, 500) };
    }
    if (!response.ok) {
      const code = typeof parsed.error === "string" ? parsed.error : `http_${response.status}`;
      throw new OutLayerError(
        `OutLayer ${path} returned ${response.status}: ${describe(parsed) || response.statusText}`,
        response.status,
        code,
        pickTxHash(parsed),
      );
    }
    return parsed;
  }

  /** Sign and broadcast a function call from the custody wallet. */
  async call(input: {
    receiverId: string;
    methodName: string;
    args: Record<string, unknown>;
    gas: string;
    deposit: string;
  }): Promise<OutLayerCallResult> {
    const body = await this.request("POST", "/wallet/v1/call", {
      receiver_id: input.receiverId,
      method_name: input.methodName,
      args: input.args,
      gas: input.gas,
      deposit: input.deposit,
    });
    const status = typeof body.status === "string" ? body.status : null;
    const txHash = pickTxHash(body);
    if (status && status !== "success") {
      // e.g. "failed", "pending_approval" (multisig policy). Not a success.
      throw new OutLayerError(
        `OutLayer call status ${status}: ${describe(body)}`,
        200,
        status === "failed" ? "onchain_tx_failed" : status,
        txHash,
      );
    }
    return { txHash, status, result: body.result, raw: body };
  }

  /** NEP-413 signed message (gasless). Used for provider authorization. */
  async signMessage(input: { message: string; recipient: string; nonceBase64: string }): Promise<{
    publicKey: string;
    signatureBase64: string;
    nonce: string;
  }> {
    const body = await this.request("POST", "/wallet/v1/sign-message", {
      message: input.message,
      recipient: input.recipient,
      nonce: input.nonceBase64,
    });
    const publicKey = typeof body.public_key === "string" ? body.public_key : "";
    const signatureBase64 = typeof body.signature_base64 === "string" ? body.signature_base64 : "";
    if (!publicKey || !signatureBase64) throw new OutLayerError("OutLayer sign-message response incomplete", 200, "bad_response", null);
    return { publicKey, signatureBase64, nonce: typeof body.nonce === "string" ? body.nonce : input.nonceBase64 };
  }

  async address(): Promise<{ address: string; publicKey: string }> {
    const body = await this.request("GET", "/wallet/v1/address?chain=near");
    return {
      address: typeof body.address === "string" ? body.address : "",
      publicKey: typeof body.public_key === "string" ? body.public_key : "",
    };
  }

  async policy(): Promise<Record<string, unknown>> {
    return this.request("GET", "/wallet/v1/policy");
  }
}
