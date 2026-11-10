import { PrismaClient } from "@prisma/client";

export function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log: process.env.PRISMA_LOG_QUERIES === "1" ? ["query", "warn", "error"] : ["warn", "error"],
  });
}

const globalForPrisma = globalThis as unknown as { poolguardPrisma?: PrismaClient };

export const prisma =
  globalForPrisma.poolguardPrisma ??
  new PrismaClient({
    log: process.env.PRISMA_LOG_QUERIES === "1" ? ["query", "warn", "error"] : ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.poolguardPrisma = prisma;

export * from "@prisma/client";
