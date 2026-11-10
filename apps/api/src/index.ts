import { loadRootEnv } from "./env.js";
import { buildApiApp } from "./app.js";
import { loadApiConfig } from "./config.js";
import { createPrismaClient } from "@poolguard/db";
import { NearChain } from "@poolguard/agent-runtime/chain";
import { signerMap } from "@poolguard/agent-runtime";

async function main() {
  loadRootEnv();
  const config = loadApiConfig();
  const prisma = createPrismaClient();
  const chain = new NearChain({
    network: config.nearNetwork,
    rpcUrl: config.nearRpcUrl,
    contractId: config.contractId,
    signers: signerMap(config),
  });
  const app = await buildApiApp({ prisma, chain, config });

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "shutting down API");
    await app.close().catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({ host: config.apiHost, port: config.apiPort });
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      level: "info",
      msg: "PoolGuard API listening",
      host: config.apiHost,
      port: config.apiPort,
      network: config.nearNetwork,
      contractId: config.contractId,
    }),
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      level: "fatal",
      msg: "PoolGuard API failed to start",
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
});
