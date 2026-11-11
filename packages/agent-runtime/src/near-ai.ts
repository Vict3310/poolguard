/**
 * NEAR AI Cloud: private inference inside TEEs, with per-response signatures.
 *
 * PoolGuard keeps only hashes of each request/response (never the document text),
 * fetches NEAR AI's signature for each completion, and checks it against the
 * signing key published in the attestation report. Scope of the check:
 *   ✓ the signed text binds our exact request and response bytes (SHA-256)
 *   ✓ the ed25519 signature verifies against the attested signing address
 *   ✗ PoolGuard does not verify the Intel TDX quote itself; that is NEAR AI's
 *     verifier's job (docs.near.ai/cloud/verification) and is reported as such.
 */
import { randomBytes } from "node:crypto";
import { PublicKey } from "near-api-js";
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

/** True when the configured OpenAI-compatible endpoint is NEAR AI Cloud. */
export function isNearAiBaseUrl(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname;
    return host === "cloud-api.near.ai" || host.endsWith(".near.ai");
  } catch {
    return false;
  }
}

export interface InferenceEvidence {
  /** The completion `id`, used to fetch NEAR AI's response signature. */
  chatId: string | null;
  model: string;
  requestSha256: string;
  responseSha256: string;
}

export interface AttestationSummary {
  provider: "near-ai";
  signingAlgo: string;
  gatewaySigningAddress: string | null;
  modelSigningAddresses: string[];
  hasTdxQuote: boolean;
  nonceEchoed: boolean;
  tlsFingerprint: string | null;
  checkedAt: string;
}

export type SignatureCheck =
  | { chatId: string; verified: true; kind: string; signingAddress: string }
  | { chatId: string | null; verified: false; reason: string };

export interface PrivateInferenceReport {
  provider: "near-ai";
  model: string;
  attestation: AttestationSummary | null;
  attestationError: string | null;
  responses: SignatureCheck[];
  verifiedCount: number;
  totalCount: number;
  scope: string;
}

const SCOPE =
  "Each signed response binds PoolGuard's exact request and response hashes and verifies against the signing key in NEAR AI's attestation report. The Intel TDX quote is verified by NEAR AI's own verifier, not by PoolGuard.";

function rootUrl(baseUrl: string): string {
  // Accept https://cloud-api.near.ai or https://cloud-api.near.ai/v1
  return baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
}

async function getJson(url: string, init: RequestInit, timeoutMs: number): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/** Fetch and summarize NEAR AI's attestation report (gateway + model evidence). */
export async function fetchAttestation(input: {
  baseUrl: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}): Promise<AttestationSummary> {
  const nonce = randomBytes(32).toString("hex");
  const params = new URLSearchParams({ signing_algo: "ed25519", nonce });
  if (input.model) {
    params.set("model", input.model);
    params.set("provider", "near");
  }
  const { status, body } = await getJson(
    `${rootUrl(input.baseUrl)}/v1/attestation/report?${params.toString()}`,
    {
      headers: {
        accept: "application/json",
        ...(input.model ? { "x-no-aliasing": "true" } : {}),
        ...(input.apiKey ? { authorization: `Bearer ${input.apiKey}` } : {}),
      },
    },
    input.timeoutMs ?? 15_000,
  );
  if (status < 200 || status >= 300) throw new Error(`attestation report returned HTTP ${status}`);
  const report = record(body);
  const gateway = record(report.gateway_attestation);
  const models = Array.isArray(report.model_attestations) ? report.model_attestations.map(record) : [];
  const addressOf = (entry: Record<string, unknown>) =>
    typeof entry.signing_address === "string" ? entry.signing_address.toLowerCase().replace(/^0x/, "") : null;
  const echoed = [gateway, ...models].some((entry) => typeof entry.request_nonce === "string" && entry.request_nonce === nonce);
  return {
    provider: "near-ai",
    signingAlgo: typeof gateway.signing_algo === "string" ? gateway.signing_algo : "ed25519",
    gatewaySigningAddress: addressOf(gateway),
    modelSigningAddresses: models.map(addressOf).filter((value): value is string => Boolean(value)),
    hasTdxQuote: typeof gateway.intel_quote === "string" && gateway.intel_quote.length > 0,
    nonceEchoed: echoed,
    tlsFingerprint: typeof gateway.tls_cert_fingerprint === "string" ? gateway.tls_cert_fingerprint : null,
    checkedAt: new Date().toISOString(),
  };
}

/** Verify one response signature: the text must bind our hashes and the ed25519 signature must verify. */
export function verifyResponseSignature(input: {
  evidence: InferenceEvidence;
  signature: Record<string, unknown>;
  attestation: AttestationSummary | null;
}): SignatureCheck {
  const { evidence, signature } = input;
  const chatId = evidence.chatId;
  if (!chatId) return { chatId: null, verified: false, reason: "completion had no id" };
  if (typeof signature.error_code === "string") {
    return { chatId, verified: false, reason: `signature unavailable: ${signature.error_code}` };
  }
  const text = typeof signature.text === "string" ? signature.text : null;
  const sigHex = typeof signature.signature === "string" ? signature.signature.replace(/^0x/, "") : null;
  const address = typeof signature.signing_address === "string" ? signature.signing_address.toLowerCase().replace(/^0x/, "") : null;
  const algo = typeof signature.signing_algo === "string" ? signature.signing_algo : "ed25519";
  const kind = typeof signature.signature_kind === "string" ? signature.signature_kind : "gateway";
  if (!text || !sigHex || !address) return { chatId, verified: false, reason: "signature response incomplete" };
  if (algo !== "ed25519") return { chatId, verified: false, reason: `unsupported signing algorithm ${algo}` };

  // The signed text must reference exactly the bytes PoolGuard sent and received.
  const suffix = `${evidence.requestSha256}:${evidence.responseSha256}`;
  if (!text.endsWith(suffix)) return { chatId, verified: false, reason: "signed text does not match this request/response" };

  if (input.attestation) {
    const attested =
      kind === "provider_tee" ? input.attestation.modelSigningAddresses : [input.attestation.gatewaySigningAddress];
    if (!attested.includes(address)) return { chatId, verified: false, reason: "signing key is not in the attestation report" };
  }

  try {
    const keyBytes = hexToBytes(address);
    const sigBytes = hexToBytes(sigHex);
    if (keyBytes.length !== 32 || sigBytes.length !== 64) return { chatId, verified: false, reason: "malformed key or signature" };
    const key = PublicKey.fromString(`ed25519:${base58(keyBytes)}`);
    const ok = key.verify(new TextEncoder().encode(text), sigBytes);
    return ok ? { chatId, verified: true, kind, signingAddress: address } : { chatId, verified: false, reason: "signature does not verify" };
  } catch (error) {
    return { chatId, verified: false, reason: `verification error: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Fetch NEAR AI's signature for a completion; a 404 can be transient right after the response. */
export async function fetchResponseSignature(input: {
  baseUrl: string;
  apiKey: string;
  chatId: string;
  model?: string;
  timeoutMs?: number;
}): Promise<Record<string, unknown>> {
  const params = new URLSearchParams({ signing_algo: "ed25519" });
  if (input.model) params.set("model", input.model);
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const { status, body } = await getJson(
      `${rootUrl(input.baseUrl)}/v1/signature/${encodeURIComponent(input.chatId)}?${params.toString()}`,
      { headers: { accept: "application/json", authorization: `Bearer ${input.apiKey}` } },
      input.timeoutMs ?? 10_000,
    );
    if (status === 404 && attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 750));
      continue;
    }
    if (status < 200 || status >= 300) return { error_code: `http_${status}` };
    return record(body);
  }
  return { error_code: "not_found" };
}

/** Build the private-inference report for a finished run. Never throws. */
export async function verifyPrivateInference(input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  evidence: InferenceEvidence[];
}): Promise<PrivateInferenceReport> {
  let attestation: AttestationSummary | null = null;
  let attestationError: string | null = null;
  try {
    attestation = await fetchAttestation({ baseUrl: input.baseUrl, apiKey: input.apiKey, model: input.model });
  } catch (error) {
    attestationError = error instanceof Error ? error.message : String(error);
  }
  const responses: SignatureCheck[] = [];
  for (const evidence of input.evidence) {
    if (!evidence.chatId) {
      responses.push({ chatId: null, verified: false, reason: "completion had no id" });
      continue;
    }
    try {
      const signature = await fetchResponseSignature({
        baseUrl: input.baseUrl,
        apiKey: input.apiKey,
        chatId: evidence.chatId,
        model: evidence.model,
      });
      responses.push(verifyResponseSignature({ evidence, signature, attestation }));
    } catch (error) {
      responses.push({ chatId: evidence.chatId, verified: false, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return {
    provider: "near-ai",
    model: input.model,
    attestation,
    attestationError,
    responses,
    verifiedCount: responses.filter((check) => check.verified).length,
    totalCount: responses.length,
    scope: SCOPE,
  };
}

