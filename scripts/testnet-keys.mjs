#!/usr/bin/env node
/**
 * Read-only helper for scripts/testnet-setup.sh.
 *
 *   node scripts/testnet-keys.mjs worker-public-key <1|2>   → public key derived from WORKER_<N>_PRIVATE_KEY
 *   node scripts/testnet-keys.mjs account-state <account>    → "missing" | "exists <codeDeployed:yes|no>"
 *   node scripts/testnet-keys.mjs full-access-keys <account> → one full-access public key per line
 *   node scripts/testnet-keys.mjs has-key <account> <pubkey> → "yes" | "no"
 *
 * It never prints a private key and never signs or sends anything.
 */
import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { KeyPair } from "near-api-js";

const envFile = process.env.POOLGUARD_ENV_FILE || ".env.testnet";
const env = parse(readFileSync(envFile, "utf8"));
const rpc = process.env.NEAR_RPC_URL || env.NEAR_RPC_URL || "https://rpc.testnet.near.org";

async function post(params) {
  // The public testnet RPC is rate-limited and sometimes times out: retry a few times.
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "pg", method: "query", params: { finality: "final", ...params } }),
        signal: AbortSignal.timeout(12_000),
      });
      return await response.json();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1_500));
    }
  }
  throw new Error(`RPC ${rpc} unreachable after 4 attempts: ${lastError instanceof Error ? lastError.message : lastError}`);
}

async function query(params) {
  const body = await post(params);
  if (body.error) {
    const cause = body.error.cause?.name ?? body.error.name ?? "RPC_ERROR";
    return { missing: cause === "UNKNOWN_ACCOUNT", error: cause };
  }
  return { result: body.result };
}

const [command, a, b] = process.argv.slice(2);

if (command === "worker-public-key") {
  const name = a === "1" ? "WORKER_ONE_PRIVATE_KEY" : a === "2" ? "WORKER_TWO_PRIVATE_KEY" : null;
  if (!name || !env[name]) throw new Error(`${name ?? "worker"} is not set in ${envFile}`);
  console.log(KeyPair.fromString(env[name].trim()).getPublicKey().toString());
} else if (command === "account-state") {
  const view = await query({ request_type: "view_account", account_id: a });
  if (view.missing) console.log("missing");
  else if (view.error) throw new Error(`RPC error for ${a}: ${view.error}`);
  else console.log(`exists ${view.result.code_hash === "11111111111111111111111111111111" ? "no" : "yes"}`);
} else if (command === "full-access-keys" || command === "has-key") {
  const list = await query({ request_type: "view_access_key_list", account_id: a });
  if (list.error) throw new Error(`RPC error for ${a}: ${list.error}`);
  const keys = list.result.keys ?? [];
  if (command === "has-key") console.log(keys.some((key) => key.public_key === b) ? "yes" : "no");
  else for (const key of keys) if (key.access_key.permission === "FullAccess") console.log(key.public_key);
} else {
  console.error("usage: testnet-keys.mjs worker-public-key|account-state|full-access-keys|has-key …");
  process.exit(2);
}
