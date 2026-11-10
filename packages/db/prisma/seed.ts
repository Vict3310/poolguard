import { PrismaClient } from "@prisma/client";
import { loadRootEnv } from "@poolguard/shared/env";
import {
  SUPPLIER_EXTRACTION_JSON_SCHEMA,
  computeOutputSchemaHash,
} from "@poolguard/shared";

loadRootEnv();

const prisma = new PrismaClient();

const network = process.env.NEAR_NETWORK ?? "sandbox";
const contractId = process.env.POOLGUARD_CONTRACT_ID ?? "poolguard.sandbox";
const providerAccountId = process.env.PROVIDER_ACCOUNT_ID ?? "provider.poolguard.testnet";
const providerEndpoint = process.env.PROVIDER_ORIGIN ?? "http://127.0.0.1:4103";

const outputSchemaHash = computeOutputSchemaHash(SUPPLIER_EXTRACTION_JSON_SCHEMA);

async function main() {
  const provider = await prisma.provider.upsert({
    where: { accountId: providerAccountId },
    update: {
      name: "PoolGuard Document Services",
      description:
        "Operator-controlled reference provider. Deterministic supplier-document extraction at fixed catalog prices.",
      network,
      contractId,
      endpoint: providerEndpoint,
      operatorControlled: true,
    },
    create: {
      accountId: providerAccountId,
      name: "PoolGuard Document Services",
      description:
        "Operator-controlled reference provider. Deterministic supplier-document extraction at fixed catalog prices.",
      network,
      contractId,
      endpoint: providerEndpoint,
      operatorControlled: true,
    },
  });

  const services = [
    {
      serviceKey: "doc-extract",
      serviceId: "doc-extract-v1",
      name: "Supplier document extraction",
      description:
        "Extracts supplier identity, products, quoted amounts, delivery terms, missing fields and line-level evidence from one document.",
      priceYocto: "20000000000000000000000",
      engine: "rules-v1",
    },
    {
      serviceKey: "doc-summary",
      serviceId: "doc-summary-v1",
      name: "Supplier document summary",
      description:
        "A cheaper, smaller extraction for agents that must fall back after a shared-budget denial.",
      priceYocto: "5000000000000000000000",
      engine: "rules-v1",
    },
  ];

  for (const service of services) {
    await prisma.service.upsert({
      where: {
        providerId_serviceKey_version: {
          providerId: provider.id,
          serviceKey: service.serviceKey,
          version: "1.0.0",
        },
      },
      update: {
        name: service.name,
        description: service.description,
        priceYocto: service.priceYocto,
        outputSchemaHash,
        engine: service.engine,
        serviceId: service.serviceId,
        active: true,
      },
      create: {
        providerId: provider.id,
        serviceKey: service.serviceKey,
        serviceId: service.serviceId,
        name: service.name,
        description: service.description,
        priceYocto: service.priceYocto,
        outputSchemaHash,
        version: "1.0.0",
        engine: service.engine,
        active: true,
      },
    });
  }

  console.log(
    `Seeded provider ${provider.accountId} with ${services.length} fixed-price services (output schema ${outputSchemaHash.slice(0, 12)}…).`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
