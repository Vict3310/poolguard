import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { KeyPair, PublicKey } from "near-api-js";
import {
  computeRequestHash,
  providerAuthChallengeHash,
  SUPPLIER_EXTRACTION_JSON_SCHEMA,
  computeOutputSchemaHash,
} from "@poolguard/shared";
import { ProviderClient, ProviderRequestError } from "./provider-client.js";

const NETWORK = "testnet" as const;
const CONTRACT = "poolguard.testnet";
const DOMAIN = "provider.example.test";
const TASK = "supplier-review";
const OPERATION = "b".repeat(64);
const DOCUMENT = "Supplier: Northwind Ltd\nQuote: USD 1200\nDelivery: 2 weeks\n";
const SERVICE_ID = "doc-extract-v1";
const OUTPUT_SCHEMA_HASH = computeOutputSchemaHash(SUPPLIER_EXTRACTION_JSON_SCHEMA);

const servers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

async function startServer(handler: (request: IncomingMessage, response: ServerResponse) => void) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind");
  return `http://127.0.0.1:${address.port}`;
}

function clientFor(origin: string, key: KeyPair, timeoutMs = 2_000) {
  return new ProviderClient({
    origin,
    network: NETWORK,
    contractId: CONTRACT,
    serviceDomain: DOMAIN,
    agentAccountId: "agent-one.testnet",
    agentPrivateKey: key.toString(),
    timeoutMs,
  });
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function assertSigned(input: {
  publicKey: string;
  signature: string;
  action: "purchase" | "result";
  operationId: string;
  requestHash: string;
  issuedAt: string;
  nonce: string;
}) {
  const digest = providerAuthChallengeHash({
    domain: DOMAIN,
    network: NETWORK,
    contractId: CONTRACT,
    action: input.action,
    operationId: input.operationId,
    requestHash: input.requestHash,
    issuedAt: input.issuedAt,
    nonce: input.nonce,
  });
  const valid = PublicKey.from(input.publicKey).verify(
    digest,
    Buffer.from(input.signature, "base64"),
  );
  expect(valid).toBe(true);
}

describe("provider client", () => {
  it("signs the exact operation binding the provider verifies", async () => {
    const key = KeyPair.fromRandom("ed25519");
    const origin = await startServer(async (request, response) => {
      const body = JSON.parse(await readBody(request));
      expect(request.url).toBe("/purchases");
      expect(body.operation_id).toBe(OPERATION);
      expect(body.request_hash).toBe(
        computeRequestHash(SERVICE_ID, { document_text: DOCUMENT }),
      );
      expect(body.auth.agent_account_id).toBe("agent-one.testnet");
      assertSigned({
        publicKey: body.auth.public_key,
        signature: body.auth.signature_base64,
        action: "purchase",
        operationId: body.operation_id,
        requestHash: body.request_hash,
        issuedAt: body.auth.issued_at,
        nonce: body.auth.nonce,
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          operation_id: OPERATION,
          status: "delivered",
          request_hash: body.request_hash,
          output_schema_hash: body.output_schema_hash,
          result: null,
          delivered_at: new Date().toISOString(),
          attempts: 1,
          note: null,
        }),
      );
    });

    const result = await clientFor(origin, key).purchase({
      operationId: OPERATION,
      taskId: TASK,
      serviceKey: "doc-extract",
      requestHash: computeRequestHash(SERVICE_ID, { document_text: DOCUMENT }),
      outputSchemaHash: OUTPUT_SCHEMA_HASH,
      documentLabel: "Northwind",
      documentText: DOCUMENT,
    });
    expect(result.status).toBe("delivered");
  });

  it("maps a structured provider denial instead of retrying blindly", async () => {
    const key = KeyPair.fromRandom("ed25519");
    const origin = await startServer((_request, response) => {
      response.writeHead(402, { "content-type": "application/json" });
      response.end(JSON.stringify({ code: "PAYMENT_PENDING", error: "Wait for settlement" }));
    });
    const client = clientFor(origin, key);
    await expect(
      client.purchase({
        operationId: OPERATION,
        taskId: TASK,
        serviceKey: "doc-extract",
        requestHash: computeRequestHash(SERVICE_ID, { document_text: DOCUMENT }),
        outputSchemaHash: OUTPUT_SCHEMA_HASH,
        documentLabel: "Northwind",
        documentText: DOCUMENT,
      }),
    ).rejects.toMatchObject({
      name: "ProviderRequestError",
      status: 402,
      code: "PAYMENT_PENDING",
    });
  });

  it("classifies a timeout as an unknown provider outcome", async () => {
    const key = KeyPair.fromRandom("ed25519");
    const origin = await startServer((_request, response) => {
      setTimeout(() => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end("{}");
      }, 200);
    });
    const client = clientFor(origin, key, 25);
    let caught: unknown = null;
    try {
      await client.getCatalog();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ProviderRequestError);
    expect((caught as ProviderRequestError).code).toBe("PROVIDER_TIMEOUT");
    expect((caught as ProviderRequestError).status).toBeNull();
  });
});
