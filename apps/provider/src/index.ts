import { loadRootEnv } from "./env.js";

loadRootEnv();

const [{ PrismaClient }, { NearChain }, { buildProviderApp }, { PrismaProviderStore }, { loadProviderConfig }] =
  await Promise.all([
    import("@poolguard/db"),
    import("@poolguard/agent-runtime/chain"),
    import("./app.js"),
    import("./store.js"),
    import("./config.js"),
  ]);

const config = loadProviderConfig();
const prisma = new PrismaClient();
const chain = new NearChain({
  network: config.nearNetwork,
  rpcUrl: config.nearRpcUrl,
  contractId: config.contractId,
  signers: {},
});
const store = new PrismaProviderStore(prisma, config.providerAccountId);
const app = await buildProviderApp({
  store,
  chain,
  network: config.nearNetwork,
  contractId: config.contractId,
  providerAccountId: config.providerAccountId,
  serviceDomain: config.serviceDomain,
  logger: true,
});

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down provider");
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ port: config.port, host: config.host });
app.log.info(
  `PoolGuard provider for ${config.providerAccountId} on ${config.nearNetwork} at ${config.providerOrigin}`,
);
