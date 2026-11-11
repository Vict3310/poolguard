import { loadRootEnv } from "./env.js";
import { buildApiApp } from "./app.js";
import { Monitor } from "./monitor.js";
import { loadApiConfig } from "./config.js";
import { createPrismaClient } from "@poolguard/db";
import { NearChain } from "@poolguard/agent-runtime/chain";
import { signerMap, custodyMap } from "@poolguard/agent-runtime";

async function main() {
  loadRootEnv();
  const config = loadApiConfig();
  const prisma = createPrismaClient();
  const chain = new NearChain({
    network: config.nearNetwork,
    rpcUrl: config.nearRpcUrl,
    contractId: config.contractId,
    signers: signerMap(config),
    custody: custodyMap(config),
    // Custody transactions get their real hash only after OutLayer broadcasts.
    onTxHashResolved: async (placeholder, txHash) => {
      await prisma.chainTransaction.updateMany({ where: { txHash: placeholder }, data: { txHash } });
    },
  });
  const app = await buildApiApp({ prisma, chain, config });
  // Operational alerts: stale worker, queue backlog, stuck payouts, low balances.
  const monitor = new Monitor({ prisma, chain, config });
  if (process.env.MONITOR_DISABLED !== "true") monitor.start();

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "shutting down API");
    monitor.stop();
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
