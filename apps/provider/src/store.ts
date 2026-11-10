import type { PrismaClient } from "@poolguard/db";
import type { SupplierExtraction } from "@poolguard/shared";

export interface ProviderServiceRecord {
  serviceKey: string;
  serviceId: string;
  name: string;
  description: string;
  priceYocto: string;
  outputSchemaHash: string;
  version: string;
  engine: string;
  active: boolean;
}

export interface StoredResult {
  chainTaskId: string;
  operationId: string;
  requestHash: string;
  outputSchemaHash: string;
  serviceKey: string;
  status: "PROCESSING" | "DELIVERED" | "FAILED";
  result: SupplierExtraction | null;
  attempts: number;
  deliveredAt: Date | null;
  lastError: string | null;
}

export type ClaimKind = "claimed" | "reclaimed" | "delivered" | "processing" | "conflict";

export interface ClaimResult {
  kind: ClaimKind;
  result?: StoredResult;
}

export interface ProviderStore {
  ping(): Promise<void>;
  listServices(): Promise<ProviderServiceRecord[]>;
  getService(serviceKey: string): Promise<ProviderServiceRecord | null>;
  claim(input: {
    chainTaskId: string;
    operationId: string;
    requestHash: string;
    outputSchemaHash: string;
    serviceKey: string;
    now: Date;
  }): Promise<ClaimResult>;
  deliver(key: { chainTaskId: string; operationId: string }, result: SupplierExtraction): Promise<void>;
  fail(key: { chainTaskId: string; operationId: string }, error: string): Promise<void>;
  get(key: { chainTaskId: string; operationId: string }): Promise<StoredResult | null>;
}

const STALE_PROCESSING_MS = 30_000;

function mapResult(row: {
  chainTaskId: string;
  operationId: string;
  requestHash: string;
  outputSchemaHash: string;
  serviceKey: string;
  status: string;
  resultJson: unknown;
  attempts: number;
  deliveredAt: Date | null;
  lastError: string | null;
}): StoredResult {
  return {
    chainTaskId: row.chainTaskId,
    operationId: row.operationId,
    requestHash: row.requestHash,
    outputSchemaHash: row.outputSchemaHash,
    serviceKey: row.serviceKey,
    status: row.status as StoredResult["status"],
    result: (row.resultJson ?? null) as SupplierExtraction | null,
    attempts: row.attempts,
    deliveredAt: row.deliveredAt,
    lastError: row.lastError,
  };
}

export class PrismaProviderStore implements ProviderStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly providerAccountId: string,
  ) {}

  async ping(): Promise<void> {
    await this.prisma.$queryRaw`SELECT 1`;
  }

  private async provider() {
    return this.prisma.provider.findUnique({
      where: { accountId: this.providerAccountId },
      include: { services: { where: { active: true } } },
    });
  }

  async listServices(): Promise<ProviderServiceRecord[]> {
    const provider = await this.provider();
    if (!provider) return [];
    return provider.services.map((service) => ({
      serviceKey: service.serviceKey,
      serviceId: service.serviceId,
      name: service.name,
      description: service.description,
      priceYocto: service.priceYocto,
      outputSchemaHash: service.outputSchemaHash,
      version: service.version,
      engine: service.engine,
      active: service.active,
    }));
  }

  async getService(serviceKey: string): Promise<ProviderServiceRecord | null> {
    const services = await this.listServices();
    return services.find((service) => service.serviceKey === serviceKey) ?? null;
  }

  async claim(input: {
    chainTaskId: string;
    operationId: string;
    requestHash: string;
    outputSchemaHash: string;
    serviceKey: string;
    now: Date;
  }): Promise<ClaimResult> {
    // Results live in the shared application database for this MVP. Attach the
    // internal task id when known so the owner's UI can include this result even
    // before the worker reconciles it.
    const task = await this.prisma.task.findUnique({
      where: { chainTaskId: input.chainTaskId },
      select: { id: true },
    });
    try {
      const created = await this.prisma.providerResult.create({
        data: {
          taskId: task?.id ?? null,
          chainTaskId: input.chainTaskId,
          operationId: input.operationId,
          requestHash: input.requestHash,
          outputSchemaHash: input.outputSchemaHash,
          serviceKey: input.serviceKey,
          status: "PROCESSING",
          attempts: 1,
        },
      });
      return { kind: "claimed", result: mapResult(created) };
    } catch (error) {
      if ((error as { code?: string }).code !== "P2002") throw error;
    }

    const existing = await this.prisma.providerResult.findUnique({
      where: {
        chainTaskId_operationId: {
          chainTaskId: input.chainTaskId,
          operationId: input.operationId,
        },
      },
    });
    if (!existing) return { kind: "processing" };
    if (
      existing.requestHash !== input.requestHash ||
      existing.outputSchemaHash !== input.outputSchemaHash ||
      existing.serviceKey !== input.serviceKey
    ) {
      return { kind: "conflict", result: mapResult(existing) };
    }
    if (existing.status === "DELIVERED") {
      return { kind: "delivered", result: mapResult(existing) };
    }
    const stale =
      existing.status === "FAILED" ||
      (existing.status === "PROCESSING" &&
        input.now.getTime() - existing.updatedAt.getTime() > STALE_PROCESSING_MS);
    if (!stale) return { kind: "processing", result: mapResult(existing) };

    // Optimistic reclaim: only one concurrent request can move this exact row.
    const update = await this.prisma.providerResult.updateMany({
      where: {
        id: existing.id,
        status: existing.status,
        updatedAt: existing.updatedAt,
      },
      data: {
        status: "PROCESSING",
        attempts: { increment: 1 },
        lastError: null,
      },
    });
    if (update.count !== 1) return { kind: "processing" };
    const reclaimed = await this.prisma.providerResult.findUnique({ where: { id: existing.id } });
    return reclaimed
      ? { kind: "reclaimed", result: mapResult(reclaimed) }
      : { kind: "processing" };
  }

  async deliver(
    key: { chainTaskId: string; operationId: string },
    result: SupplierExtraction,
  ): Promise<void> {
    await this.prisma.providerResult.update({
      where: {
        chainTaskId_operationId: { chainTaskId: key.chainTaskId, operationId: key.operationId },
      },
      data: {
        status: "DELIVERED",
        resultJson: result as unknown as object,
        deliveredAt: new Date(),
        lastError: null,
      },
    });
  }

  async fail(key: { chainTaskId: string; operationId: string }, error: string): Promise<void> {
    await this.prisma.providerResult.update({
      where: {
        chainTaskId_operationId: { chainTaskId: key.chainTaskId, operationId: key.operationId },
      },
      data: { status: "FAILED", lastError: error.slice(0, 500) },
    });
  }

  async get(key: { chainTaskId: string; operationId: string }): Promise<StoredResult | null> {
    const row = await this.prisma.providerResult.findUnique({
      where: {
        chainTaskId_operationId: { chainTaskId: key.chainTaskId, operationId: key.operationId },
      },
    });
    return row ? mapResult(row) : null;
  }
}
