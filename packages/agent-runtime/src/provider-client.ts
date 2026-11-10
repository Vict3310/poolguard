import {
  KeyPair,
  base64Encode,
  type KeyPairString,
} from "near-api-js";
import {
  catalogResponseSchema,
  computeRequestHash,
  providerAuthChallengeHash,
  PROVIDER_AUTH_HEADERS,
  purchaseRequestSchema,
  quoteResponseSchema,
  providerResultResponseSchema,
  type CatalogResponse,
  type ProviderResultResponse,
  type PurchaseRequest,
  type QuoteResponse,
} from "@poolguard/shared";

export interface ProviderClientOptions {
  origin: string;
  network: "sandbox" | "testnet";
  contractId: string;
  serviceDomain: string;
  agentAccountId: string;
  agentPrivateKey: string;
  timeoutMs?: number;
}

export class ProviderRequestError extends Error {
  override name = "ProviderRequestError";
  constructor(
    message: string,
    readonly status: number | null,
    readonly code: string | null,
  ) {
    super(message);
  }
}

export interface PurchaseInput {
  operationId: string;
  taskId: string;
  serviceKey: string;
  requestHash: string;
  outputSchemaHash: string;
  documentLabel: string;
  documentText: string;
}

export class ProviderClient {
  private readonly keyPair: KeyPair;
  private readonly origin: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: ProviderClientOptions) {
    this.keyPair = KeyPair.fromString(options.agentPrivateKey as KeyPairString);
    this.origin = options.origin.replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 20_000;
  }

  publicKey(): string {
    return this.keyPair.getPublicKey().toString();
  }

  private signedAuth(action: "purchase" | "result", operationId: string, requestHash: string) {
    const issuedAt = new Date().toISOString();
    const nonce = base64Encode(crypto.getRandomValues(new Uint8Array(24)));
    const payload = {
      domain: this.options.serviceDomain,
      network: this.options.network,
      contractId: this.options.contractId,
      action,
      operationId,
      requestHash,
      issuedAt,
      nonce,
    };
    const digest = providerAuthChallengeHash(payload);
    const signature = this.keyPair.sign(digest);
    return {
      agent_account_id: this.options.agentAccountId,
      public_key: this.publicKey(),
      signature_base64: base64Encode(signature.signature),
      issued_at: issuedAt,
      nonce,
    };
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    parse: (value: unknown) => T,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.origin}${path}`, {
        ...init,
        headers: { "content-type": "application/json", ...(init.headers ?? {}) },
        signal: controller.signal,
      });
      const text = await response.text();
      let body: unknown = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = null;
      }
      if (!response.ok) {
        const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
        const code = typeof record.code === "string" ? record.code : null;
        const message =
          typeof record.error === "string" ? record.error : `${response.status} ${response.statusText}`;
        throw new ProviderRequestError(message, response.status, code);
      }
      return parse(body);
    } catch (error) {
      if (error instanceof ProviderRequestError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new ProviderRequestError("Provider request timed out", null, "PROVIDER_TIMEOUT");
      }
      throw new ProviderRequestError(
        error instanceof Error ? error.message : String(error),
        null,
        "PROVIDER_UNREACHABLE",
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async getCatalog(): Promise<CatalogResponse> {
    return this.request("/catalog", { method: "GET" }, (value) =>
      catalogResponseSchema.parse(value),
    );
  }

  async requestQuote(input: {
    serviceKey: string;
    documentLabel: string;
    documentText: string;
  }): Promise<QuoteResponse> {
    return this.request(
      "/quotes",
      {
        method: "POST",
        body: JSON.stringify({
          service_key: input.serviceKey,
          document_label: input.documentLabel,
          document_text: input.documentText,
        }),
      },
      (value) => quoteResponseSchema.parse(value),
    );
  }

  async purchase(input: PurchaseInput): Promise<ProviderResultResponse> {
    const body: PurchaseRequest = purchaseRequestSchema.parse({
      operation_id: input.operationId,
      task_id: input.taskId,
      service_key: input.serviceKey,
      request_hash: input.requestHash,
      output_schema_hash: input.outputSchemaHash,
      document_label: input.documentLabel,
      document_text: input.documentText,
      auth: this.signedAuth("purchase", input.operationId, input.requestHash),
    });
    return this.request(
      "/purchases",
      { method: "POST", body: JSON.stringify(body) },
      (value) => providerResultResponseSchema.parse(value),
    );
  }

  async getResult(input: {
    operationId: string;
    taskId: string;
    requestHash: string;
  }): Promise<ProviderResultResponse> {
    const auth = this.signedAuth("result", input.operationId, input.requestHash);
    const query = new URLSearchParams({
      task_id: input.taskId,
      request_hash: input.requestHash,
    });
    return this.request(
      `/operations/${input.operationId}?${query.toString()}`,
      {
        method: "GET",
        headers: {
          [PROVIDER_AUTH_HEADERS.agent]: auth.agent_account_id,
          [PROVIDER_AUTH_HEADERS.publicKey]: auth.public_key,
          [PROVIDER_AUTH_HEADERS.signature]: auth.signature_base64,
          [PROVIDER_AUTH_HEADERS.issuedAt]: auth.issued_at,
          [PROVIDER_AUTH_HEADERS.nonce]: auth.nonce,
        },
      },
      (value) => providerResultResponseSchema.parse(value),
    );
  }

  /** Must match the provider's canonical input exactly. */
  static requestHashFor(serviceKey: string, documentText: string): string {
    return computeRequestHash(serviceKey, { document_text: documentText });
  }
}
