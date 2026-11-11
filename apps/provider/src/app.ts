import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import {
  catalogResponseSchema,
  computeRequestHash,
  hex64Schema,
  purchaseRequestSchema,
  quoteRequestSchema,
  quoteResponseSchema,
  providerResultResponseSchema,
  sha256Hex,
  taskChainIdSchema,
  accountIdSchema,
  type ProviderAuth,
  PROVIDER_AUTH_HEADERS,
} from "@poolguard/shared";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { extractSupplierDocument, OUTPUT_SCHEMA_HASH } from "./extraction.js";
import { authExpiresAt, verifyBuyerAuth, verifyPaidOperation, type AgentRegistration } from "./security.js";
import { NonceCache } from "./nonces.js";
import type { ProviderServiceRecord, ProviderStore, StoredResult } from "./store.js";

export interface ProviderAppOptions {
  store: ProviderStore;
  /** Single-use nonce cache; defaults to a fresh in-process cache. */
  nonces?: NonceCache;
  chain: {
    getOperation(taskId: string, operationId: string): Promise<import("@poolguard/shared").ChainOperationView | null>;
    listAgents(taskId: string): Promise<AgentRegistration[]>;
  };
  network: "sandbox" | "testnet";
  contractId: string;
  providerAccountId: string;
  serviceDomain: string;
  now?: () => Date;
  logger?: boolean;
}

function errorBody(code: string, error: string, extra: Record<string, unknown> = {}) {
  return { code, error, ...extra };
}

function toResultResponse(operationId: string, record: StoredResult) {
  return providerResultResponseSchema.parse({
    operation_id: operationId,
    status:
      record.status === "DELIVERED"
        ? "delivered"
        : record.status === "FAILED"
          ? "delivery_failed"
          : "processing",
    request_hash: record.requestHash,
    output_schema_hash: record.outputSchemaHash,
    result: record.result,
    delivered_at: record.deliveredAt ? record.deliveredAt.toISOString() : null,
    attempts: record.attempts,
    note:
      record.status === "PROCESSING"
        ? "Another request is processing this operation; retry shortly."
        : record.lastError,
  });
}

function shapeService(service: ProviderServiceRecord) {
  return {
    provider_account_id: "",
    service_key: service.serviceKey,
    service_id: service.serviceId,
    name: service.name,
    description: service.description,
    price_yocto: service.priceYocto,
    output_schema_hash: service.outputSchemaHash,
    version: service.version,
    engine: service.engine,
    operator_controlled: true,
    active: service.active,
  };
}

export async function buildProviderApp(options: ProviderAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 200_000 });
  const now = options.now ?? (() => new Date());
  const nonces = options.nonces ?? new NonceCache(100_000, () => now().getTime());
  /** Signed authorizations are single use, so a captured request cannot be replayed. */
  const claimNonce = (auth: ProviderAuth) =>
    nonces.claim(`${auth.agent_account_id}:${auth.nonce}`, authExpiresAt(auth.issued_at));
  const replayed = () => errorBody("AUTH_REPLAYED", "This signed authorization was already used");

  await app.register(rateLimit, {
    global: true,
    max: 180,
    timeWindow: "1 minute",
    allowList: [],
  });

  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("cache-control", "no-store");
    reply.header("x-content-type-options", "nosniff");
    return payload;
  });

  app.get("/health", async () => ({ status: "ok", service: "poolguard-provider" }));

  app.get("/ready", async (_request, reply) => {
    try {
      await options.store.ping();
      return { status: "ready" };
    } catch {
      return reply.code(503).send({ status: "not_ready", reason: "database unavailable" });
    }
  });

  app.get("/catalog", async () => {
    const services = await options.store.listServices();
    const shaped = services.map((service) => ({
      ...shapeService(service),
      provider_account_id: options.providerAccountId,
    }));
    return catalogResponseSchema.parse({
      provider_account_id: options.providerAccountId,
      network: options.network,
      contract_id: options.contractId,
      pricing: "fixed_catalog",
      services: shaped,
    });
  });

  app.post("/quotes", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request, reply) => {
    const parsed = quoteRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(errorBody("INVALID_REQUEST", parsed.error.issues[0]?.message ?? "Invalid request"));
    }
    const service = await options.store.getService(parsed.data.service_key);
    if (!service || !service.active) {
      return reply.code(404).send(errorBody("SERVICE_NOT_FOUND", "Unknown or inactive service_key"));
    }
    const requestHash = computeRequestHash(service.serviceId, {
      document_text: parsed.data.document_text,
    });
    const documentHash = sha256Hex(parsed.data.document_text.replace(/\r\n/g, "\n"));
    const expiresAt = new Date(now().getTime() + 10 * 60_000).toISOString();
    return quoteResponseSchema.parse({
      quote_id: randomUUID(),
      service_key: service.serviceKey,
      service_id: service.serviceId,
      provider_account_id: options.providerAccountId,
      price_yocto: service.priceYocto,
      output_schema_hash: service.outputSchemaHash || OUTPUT_SCHEMA_HASH,
      request_hash: requestHash,
      document_sha256: documentHash,
      expires_at: expiresAt,
      pricing: "fixed_catalog",
    });
  });

  app.post(
    "/purchases",
    { config: { rateLimit: { max: 40, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsed = purchaseRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send(errorBody("INVALID_REQUEST", parsed.error.issues[0]?.message ?? "Invalid request"));
      }
      const body = parsed.data;
      const service = await options.store.getService(body.service_key);
      if (!service || !service.active) {
        return reply.code(404).send(errorBody("SERVICE_NOT_FOUND", "Unknown or inactive service_key"));
      }
      if (service.outputSchemaHash !== body.output_schema_hash) {
        return reply
          .code(409)
          .send(errorBody("OUTPUT_SCHEMA_MISMATCH", "The operation is bound to a different output schema"));
      }
      const canonicalHash = computeRequestHash(service.serviceId, {
        document_text: body.document_text,
      });
      if (canonicalHash !== body.request_hash) {
        return reply
          .code(409)
          .send(errorBody("REQUEST_HASH_MISMATCH", "Document does not match the hash bound on chain"));
      }

      let agents: AgentRegistration[];
      try {
        agents = await options.chain.listAgents(body.task_id);
      } catch {
        return reply.code(503).send(errorBody("CHAIN_UNAVAILABLE", "Could not read agent registrations"));
      }
      const auth = verifyBuyerAuth({
        auth: body.auth,
        agents,
        action: "purchase",
        domain: options.serviceDomain,
        network: options.network,
        contractId: options.contractId,
        operationId: body.operation_id,
        requestHash: body.request_hash,
        now: now(),
      });
      if (!auth.ok) return reply.code(401).send(errorBody(auth.code, auth.message));
      if (!claimNonce(body.auth)) return reply.code(401).send(replayed());

      let payment;
      try {
        payment = await verifyPaidOperation({
          chain: options.chain,
          providerAccountId: options.providerAccountId,
          expected: {
            taskId: body.task_id,
            operationId: body.operation_id,
            requestHash: body.request_hash,
            outputSchemaHash: body.output_schema_hash,
            priceYocto: service.priceYocto,
          },
        });
      } catch {
        return reply.code(503).send(errorBody("CHAIN_UNAVAILABLE", "Could not verify payment on chain"));
      }
      if (!payment.ok) {
        const status =
          payment.code === "PAYMENT_NOT_FOUND"
            ? 404
            : payment.code === "PAYMENT_REQUEST_MISMATCH" || payment.code === "PAYMENT_AMOUNT_MISMATCH"
              ? 409
              : 402;
        return reply.code(status).send(
          errorBody(payment.code, payment.message, {
            ...(payment.retryAfterSeconds ? { retry_after_seconds: payment.retryAfterSeconds } : {}),
          }),
        );
      }

      const claim = await options.store.claim({
        chainTaskId: body.task_id,
        operationId: body.operation_id,
        requestHash: body.request_hash,
        outputSchemaHash: body.output_schema_hash,
        serviceKey: service.serviceKey,
        now: now(),
      });

      if (claim.kind === "conflict") {
        return reply
          .code(409)
          .send(errorBody("OPERATION_BINDING_CONFLICT", "This operation is already stored with different input"));
      }
      if (claim.kind === "delivered" && claim.result) {
        return reply.code(200).send(toResultResponse(body.operation_id, claim.result));
      }
      if (claim.kind === "processing") {
        return reply.code(202).send(
          claim.result
            ? toResultResponse(body.operation_id, claim.result)
            : errorBody("PROCESSING", "This operation is being processed; retry shortly.", {
                retry_after_seconds: 2,
              }),
        );
      }

      try {
        const extraction = extractSupplierDocument({
          serviceKey: service.serviceKey,
          providerAccountId: options.providerAccountId,
          label: body.document_label,
          text: body.document_text,
          now: now(),
        });
        await options.store.deliver(
          { chainTaskId: body.task_id, operationId: body.operation_id },
          extraction,
        );
        const stored = await options.store.get({
          chainTaskId: body.task_id,
          operationId: body.operation_id,
        });
        if (!stored) {
          return reply.code(500).send(errorBody("RESULT_NOT_STORED", "Provider result could not be read after processing"));
        }
        return reply.code(200).send(toResultResponse(body.operation_id, stored));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await options.store
          .fail({ chainTaskId: body.task_id, operationId: body.operation_id }, message)
          .catch(() => undefined);
        request.log.error({ operationId: body.operation_id }, "provider processing failed");
        return reply.code(500).send(errorBody("PROCESSING_FAILED", "Provider processing failed; retry is safe"));
      }
    },
  );

  const resultQuerySchema = z.object({
    task_id: taskChainIdSchema,
    request_hash: hex64Schema,
  });
  // Signed authorization travels in headers, not the query string, so signatures do
  // not end up in proxy or access logs.
  const resultAuthHeadersSchema = z.object({
    [PROVIDER_AUTH_HEADERS.agent]: accountIdSchema,
    [PROVIDER_AUTH_HEADERS.publicKey]: z.string().min(1),
    [PROVIDER_AUTH_HEADERS.signature]: z.string().min(1),
    [PROVIDER_AUTH_HEADERS.issuedAt]: z.string().min(1),
    [PROVIDER_AUTH_HEADERS.nonce]: z.string().min(16),
  });

  app.get("/operations/:operationId", async (request, reply) => {
    const params = z.object({ operationId: hex64Schema }).safeParse(request.params);
    const query = resultQuerySchema.safeParse(request.query);
    const headers = resultAuthHeadersSchema.safeParse(request.headers);
    if (!params.success || !query.success || !headers.success) {
      return reply.code(400).send(errorBody("INVALID_REQUEST", "Invalid operation id, query or authorization headers"));
    }
    const authPayload: ProviderAuth = {
      agent_account_id: headers.data[PROVIDER_AUTH_HEADERS.agent],
      public_key: headers.data[PROVIDER_AUTH_HEADERS.publicKey],
      signature_base64: headers.data[PROVIDER_AUTH_HEADERS.signature],
      issued_at: headers.data[PROVIDER_AUTH_HEADERS.issuedAt],
      nonce: headers.data[PROVIDER_AUTH_HEADERS.nonce],
      ...(request.headers[PROVIDER_AUTH_HEADERS.scheme] === "nep413" ? { scheme: "nep413" as const } : {}),
    };
    let agents: AgentRegistration[];
    try {
      agents = await options.chain.listAgents(query.data.task_id);
    } catch {
      return reply.code(503).send(errorBody("CHAIN_UNAVAILABLE", "Could not read agent registrations"));
    }
    const auth = verifyBuyerAuth({
      auth: authPayload,
      agents,
      action: "result",
      domain: options.serviceDomain,
      network: options.network,
      contractId: options.contractId,
      operationId: params.data.operationId,
      requestHash: query.data.request_hash,
      now: now(),
    });
    if (!auth.ok) return reply.code(401).send(errorBody(auth.code, auth.message));
    if (!claimNonce(authPayload)) return reply.code(401).send(replayed());

    const record = await options.store.get({
      chainTaskId: query.data.task_id,
      operationId: params.data.operationId,
    });
    if (!record) {
      return reply.code(404).send(errorBody("RESULT_NOT_FOUND", "No stored result for this operation"));
    }
    if (record.requestHash !== query.data.request_hash) {
      return reply.code(403).send(errorBody("RESULT_FORBIDDEN", "Authorization does not match this result"));
    }

    const service = await options.store.getService(record.serviceKey);
    if (!service) return reply.code(404).send(errorBody("SERVICE_NOT_FOUND", "Service is no longer available"));
    let payment;
    try {
      payment = await verifyPaidOperation({
        chain: options.chain,
        providerAccountId: options.providerAccountId,
        expected: {
          taskId: query.data.task_id,
          operationId: params.data.operationId,
          requestHash: record.requestHash,
          outputSchemaHash: record.outputSchemaHash,
          priceYocto: service.priceYocto,
        },
      });
    } catch {
      return reply.code(503).send(errorBody("CHAIN_UNAVAILABLE", "Could not verify payment on chain"));
    }
    if (!payment.ok) {
      return reply
        .code(payment.code === "PAYMENT_NOT_FOUND" ? 404 : 402)
        .send(errorBody(payment.code, payment.message));
    }

    const statusCode = record.status === "PROCESSING" ? 202 : record.status === "FAILED" ? 502 : 200;
    return reply.code(statusCode).send(toResultResponse(params.data.operationId, record));
  });

  return app;
}
