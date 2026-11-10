#!/usr/bin/env node
/**
 * Start a local NEAR sandbox, deploy PoolGuard, create owner/provider/worker
 * accounts with restricted function-call keys, and write .env.local.
 *
 * Leave this process running while using `pnpm dev`. Ctrl-C stops the sandbox.
 */
import { provisionSandbox, sandboxEnv, writeEnvLocal } from "./sandbox-lib.mjs";

let handles;
let stopping = false;

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`\n${signal}: stopping NEAR sandbox…`);
  await handles?.tearDown().catch(() => undefined);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

handles = await provisionSandbox();
const path = writeEnvLocal(sandboxEnv(handles));
console.log(`\nWrote ${path}`);
console.log("Next: `pnpm dev` (keep this process running).");
console.log("The sandbox is ephemeral: restarting creates new accounts and keys.\n");

await new Promise(() => {});
