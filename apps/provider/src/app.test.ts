import { describe, expect, it } from "vitest";
import {
  KeyPair,
  base64Encode,
} from "near-api-js";
import {
  computeRequestHash,
  providerAuthChallengeHash,
  nep413Hash,
  bytesToHex,
  type ChainOperationView,
  type ProviderAuth,
  PROVIDER_AUTH_HEADERS,
} from "@poolguard/shared";
import { buildProviderApp } from "./app.js";
import { OUTPUT_SCHEMA_HASH } from "./extraction.js";
import type { ProviderServiceRecord, ProviderStore, StoredResult } from "./store.js";

const NETWORK = "sandbox" as const;
const CONTRACT = "poolguard.sandbox";
const PROVIDER = "extract.sandbox";
const DOMAIN = "127.0.0.1:4103";
const TASK = "supplier-review";
const OP = "a".repeat(64);
const DOC = "Supplier: Northwind Industrial Ltd\nProducts:\n- Fasteners, 100 units\nQuote: USD 1200.00\nDelivery: 2 weeks\n";
const PRICE = "20000000000000000000000";

class MemoryStore implements ProviderStore {
  results = new Map<string, StoredResult>();
  extractionCalls = 0;
  async ping() {}
  services: ProviderServiceRecord[] = [
    {
      serviceKey: "doc-extract",
      serviceId: "doc-extract-v1",
      name: "Supplier extraction",
      description: "Extracts supplier fields",
      priceYocto: PRICE,
      outputSchemaHash: OUTPUT_SCHEMA_HASH,
      version: "1.0.0",
      engine: "rules-v1",
      active: true,
    },
  ];
  async listServices() {
    return this.services;
  }
  async getService(key: string) {
    return this.services.find((s) => s.serviceKey === key) ?? null;
  }
  private key(taskId: string, opId: string) {
    return `${taskId}:${opId}`;
  }
  async claim(input: {
    chainTaskId: string;
    operationId: string;
    requestHash: string;
    outputSchemaHash: string;
    serviceKey: string;
    now: Date;
  }) {
    const key = this.key(input.chainTaskId, input.operationId);
    const existing = this.results.get(key);
    if (existing) {
      if (existing.requestHash !== input.requestHash) return { kind: "conflict" as const };
      if (existing.status === "DELIVERED") return { kind: "delivered" as const, result: existing };
      return { kind: "processing" as const, result: existing };
    }
    const row: StoredResult = {
      chainTaskId: input.chainTaskId,
      operationId: input.operationId,
      requestHash: input.requestHash,
      outputSchemaHash: input.outputSchemaHash,
      serviceKey: input.serviceKey,
      status: "PROCESSING",
      result: null,
      attempts: 1,
      deliveredAt: null,
      lastError: null,
    };
    this.results.set(key, row);
    return { kind: "claimed" as const, result: row };
  }
  async deliver(key: { chainTaskId: string; operationId: string }, result: StoredResult["result"]) {
    const row = this.results.get(this.key(key.chainTaskId, key.operationId));
    if (!row) throw new Error("missing");
    this.extractionCalls += 1;
    this.results.set(this.key(key.chainTaskId, key.operationId), {
      ...row,
      status: "DELIVERED",
      result,
      deliveredAt: new Date(),
    });
  }
  async fail(key: { chainTaskId: string; operationId: string }, error: string) {
    const row = this.results.get(this.key(key.chainTaskId, key.operationId));
    if (row) this.results.set(this.key(key.chainTaskId, key.operationId), { ...row, status: "FAILED", lastError: error });
  }
  async get(key: { chainTaskId: string; operationId: string }) {
    return this.results.get(this.key(key.chainTaskId, key.operationId)) ?? null;
  }
}

function makeOperation(overrides: Partial<ChainOperationView> = {}): ChainOperationView {
  return {
    operation_id: OP,
    task_id: TASK,
    agent_id: "agent-one.sandbox",
    agent_public_key: "ed25519:unused",
    provider_id: PROVIDER,
    amount: PRICE,
    service_id: "doc-extract-v1",
    request_hash: computeRequestHash("doc-extract-v1", { document_text: DOC }),
    output_schema_hash: OUTPUT_SCHEMA_HASH,
    policy_version: 1,
    created_at_block: 10,
    expires_at_block: 10_000,
    reservation_expires_at_block: 500,
    payment_state: "paid",
    payout_attempts: 1,
    settled_at_block: 12,
    ...overrides,
  };
}

function authFor(
  key: KeyPair,
  action: "purchase" | "result",
  requestHash: string,
  operationId = OP,
  issuedAt = new Date().toISOString(),
): ProviderAuth {
  const nonce = base64Encode(crypto.getRandomValues(new Uint8Array(16)));
  const digest = providerAuthChallengeHash({
    domain: DOMAIN,
    network: NETWORK,
    contractId: CONTRACT,
    action,
    operationId,
    requestHash,
    issuedAt,
    nonce,
  });
  return {
    agent_account_id: "agent-one.sandbox",
    public_key: key.getPublicKey().toString(),
    signature_base64: base64Encode(key.sign(digest).signature),
    issued_at: issuedAt,
    nonce,
  };
}

async function setup(operation: ChainOperationView = makeOperation()) {
  const store = new MemoryStore();
  const key = KeyPair.fromRandom("ed25519");
  const agents = [
    {
      account_id: "agent-one.sandbox",
      public_key: key.getPublicKey().toString(),
      active: true,
      registered_at_block: 1,
    },
    {
      account_id: "agent-two.sandbox",
      public_key: KeyPair.fromRandom("ed25519").getPublicKey().toString(),
      active: true,
      registered_at_block: 1,
    },
  ];
  const app = await buildProviderApp({
    store,
    chain: {
      getOperation: async () => operation,
      listAgents: async () => agents,
    },
    network: NETWORK,
    contractId: CONTRACT,
    providerAccountId: PROVIDER,
    serviceDomain: DOMAIN,
  });
  return { app, store, key, agents, operation };
}

const purchaseBody = (key: KeyPair) => {
  const requestHash = computeRequestHash("doc-extract-v1", { document_text: DOC });
  return {
    operation_id: OP,
    task_id: TASK,
    service_key: "doc-extract",
    request_hash: requestHash,
    output_schema_hash: OUTPUT_SCHEMA_HASH,
    document_label: "Supplier A",
    document_text: DOC,
    auth: authFor(key, "purchase", requestHash),
  };
};

describe("provider API", () => {
  it("serves the fixed-price catalog", async () => {
    const { app } = await setup();
    const response = await app.inject({ method: "GET", url: "/catalog" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.pricing).toBe("fixed_catalog");
    expect(body.services[0]).toMatchObject({
      service_key: "doc-extract",
      price_yocto: PRICE,
      operator_controlled: true,
    });
    await app.close();
  });

  it("quotes a canonical request hash for the exact document", async () => {
    const { app } = await setup();
    const response = await app.inject({
      method: "POST",
      url: "/quotes",
      payload: { service_key: "doc-extract", document_label: "Supplier A", document_text: DOC },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.request_hash).toBe(computeRequestHash("doc-extract-v1", { document_text: DOC }));
    expect(body.output_schema_hash).toBe(OUTPUT_SCHEMA_HASH);
    await app.close();
  });

  it("rejects a forged buyer signature before any work", async () => {
    const { app, store } = await setup();
    const body = purchaseBody(KeyPair.fromRandom("ed25519"));
    const response = await app.inject({ method: "POST", url: "/purchases", payload: body });
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe("BUYER_NOT_AUTHORIZED");
    expect(store.results.size).toBe(0);
    await app.close();
  });

  it("rejects a document that does not match the bound request hash", async () => {
    const { app } = await setup();
    const body = { ...purchaseBody(KeyPair.fromRandom("ed25519")), document_text: DOC + "tampered" };
    const response = await app.inject({ method: "POST", url: "/purchases", payload: body });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("REQUEST_HASH_MISMATCH");
    await app.close();
  });

  it("does not deliver while payment is only reserved or pending", async () => {
    const { app, store, key } = await setup(makeOperation({ payment_state: "payout_pending" }));
    const response = await app.inject({ method: "POST", url: "/purchases", payload: purchaseBody(key) });
    expect(response.statusCode).toBe(402);
    expect(response.json().code).toBe("PAYMENT_PENDING");
    expect(response.json().retry_after_seconds).toBe(2);
    expect(store.results.size).toBe(0);
    await app.close();
  });

  it("rejects payment settled for a different provider or amount", async () => {
    const wrongProvider = await setup(makeOperation({ provider_id: "other.sandbox" }));
    const first = await wrongProvider.app.inject({
      method: "POST",
      url: "/purchases",
      payload: purchaseBody(wrongProvider.key),
    });
    expect(first.statusCode).toBe(402);
    expect(first.json().code).toBe("PAYMENT_PROVIDER_MISMATCH");
    await wrongProvider.app.close();

    const wrongAmount = await setup(makeOperation({ amount: "1" }));
    const second = await wrongAmount.app.inject({
      method: "POST",
      url: "/purchases",
      payload: purchaseBody(wrongAmount.key),
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe("PAYMENT_AMOUNT_MISMATCH");
    await wrongAmount.app.close();
  });

  it("processes once and deduplicates a duplicate purchase", async () => {
    const { app, store, key } = await setup();
    const body = purchaseBody(key);
    const first = await app.inject({ method: "POST", url: "/purchases", payload: body });
    expect(first.statusCode).toBe(200);
    expect(first.json().status).toBe("delivered");
    expect(first.json().result.supplier.name).toBe("Northwind Industrial Ltd");
    const deliveries = store.extractionCalls;

    const second = await app.inject({ method: "POST", url: "/purchases", payload: purchaseBody(key) });
    expect(second.statusCode).toBe(200);
    expect(second.json().result).toEqual(first.json().result);
    expect(store.extractionCalls).toBe(deliveries);
    await app.close();
  });

  it("handles concurrent duplicate purchases without a second result", async () => {
    const { app, store, key } = await setup();
    const results = await Promise.all([
      app.inject({ method: "POST", url: "/purchases", payload: purchaseBody(key) }),
      app.inject({ method: "POST", url: "/purchases", payload: purchaseBody(key) }),
    ]);
    // Either the second request saw PROCESSING (202) or the completed result (200);
    // both are safe and neither recomputes the extraction.
    for (const result of results) expect([200, 202]).toContain(result.statusCode);
    expect(store.results.size).toBe(1);
    expect(store.extractionCalls).toBe(1);
    await app.close();
  });

  it("binds result access to the authorized agent and request", async () => {
    const { app, key } = await setup();
    await app.inject({ method: "POST", url: "/purchases", payload: purchaseBody(key) });
    const requestHash = computeRequestHash("doc-extract-v1", { document_text: DOC });

    const query = new URLSearchParams({ task_id: TASK, request_hash: requestHash }).toString();
    const headers = (auth: ProviderAuth) => ({
      [PROVIDER_AUTH_HEADERS.agent]: auth.agent_account_id,
      [PROVIDER_AUTH_HEADERS.publicKey]: auth.public_key,
      [PROVIDER_AUTH_HEADERS.signature]: auth.signature_base64,
      [PROVIDER_AUTH_HEADERS.issuedAt]: auth.issued_at,
      [PROVIDER_AUTH_HEADERS.nonce]: auth.nonce,
    });

    const goodAuth = authFor(key, "result", requestHash);
    const good = await app.inject({
      method: "GET",
      url: `/operations/${OP}?${query}`,
      headers: headers(goodAuth),
    });
    expect(good.statusCode).toBe(200);
    expect(good.json().result.document.label).toBe("Supplier A");

    const attackerKey = KeyPair.fromRandom("ed25519");
    const forged = authFor(attackerKey, "result", requestHash);
    const bad = await app.inject({
      method: "GET",
      url: `/operations/${OP}?${query}`,
      headers: headers(forged),
    });
    expect(bad.statusCode).toBe(401);

    // The same signed authorization cannot be replayed.
    const replay = await app.inject({
      method: "GET",
      url: `/operations/${OP}?${query}`,
      headers: headers(goodAuth),
    });
    expect(replay.statusCode).toBe(401);
    expect(replay.json().code).toBe("AUTH_REPLAYED");

    // Authorization in the query string is no longer accepted.
    const legacy = await app.inject({
      method: "GET",
      url: `/operations/${OP}?${new URLSearchParams({ task_id: TASK, request_hash: requestHash, ...authFor(key, "result", requestHash) })}`,
    });
    expect(legacy.statusCode).toBe(400);
    await app.close();
  });

  it("rejects a replayed purchase authorization", async () => {
    const { app, key } = await setup();
    const body = purchaseBody(key);
    const first = await app.inject({ method: "POST", url: "/purchases", payload: body });
    expect(first.statusCode).toBe(200);
    const replay = await app.inject({ method: "POST", url: "/purchases", payload: body });
    expect(replay.statusCode).toBe(401);
    expect(replay.json().code).toBe("AUTH_REPLAYED");
    await app.close();
  });

  it("rejects stale signed authorizations", async () => {
    const { app, key } = await setup();
    const requestHash = computeRequestHash("doc-extract-v1", { document_text: DOC });
    const stale = authFor(key, "purchase", requestHash, OP, new Date(Date.now() - 10 * 60_000).toISOString());
    const response = await app.inject({
      method: "POST",
      url: "/purchases",
      payload: { ...purchaseBody(key), auth: stale },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe("AUTH_STALE");
    await app.close();
  });

  it("accepts a NEP-413 signed authorization from a custody wallet and rejects a mismatch", async () => {
    const { app, key } = await setup();
    const requestHash = computeRequestHash("doc-extract-v1", { document_text: DOC });
    const issuedAt = new Date().toISOString();
    const nonceBytes = crypto.getRandomValues(new Uint8Array(32));
    const nonce = base64Encode(nonceBytes);
    const digest = providerAuthChallengeHash({
      domain: DOMAIN,
      network: NETWORK,
      contractId: CONTRACT,
      action: "purchase",
      operationId: OP,
      requestHash,
      issuedAt,
      nonce,
    });
    // What OutLayer's /wallet/v1/sign-message signs: the NEP-413 payload hash.
    const signed = key.sign(nep413Hash({ message: bytesToHex(digest), nonce: nonceBytes, recipient: DOMAIN }));
    const auth = {
      agent_account_id: "agent-one.sandbox",
      public_key: key.getPublicKey().toString(),
      signature_base64: base64Encode(signed.signature),
      issued_at: issuedAt,
      nonce,
      scheme: "nep413" as const,
    };
    const ok = await app.inject({ method: "POST", url: "/purchases", payload: { ...purchaseBody(key), auth } });
    expect(ok.statusCode).toBe(200);

    // The same NEP-413 signature presented as a raw digest signature must fail.
    const { scheme: _scheme, ...raw } = auth;
    const wrongScheme = await app.inject({
      method: "POST",
      url: "/purchases",
      payload: { ...purchaseBody(key), auth: { ...raw, nonce: base64Encode(crypto.getRandomValues(new Uint8Array(32))) } },
    });
    expect(wrongScheme.statusCode).toBe(401);
    await app.close();
  });
});
