#!/usr/bin/env node
/**
 * Move PoolGuard's two worker agents into OutLayer TEE custody. Run it yourself:
 *
 *   node scripts/outlayer-setup.mjs
 *
 * It registers two OutLayer custody wallets (one per worker) on the testnet API,
 * then updates .env.testnet so each worker signs through its wallet's API key
 * instead of a private key in the environment. The previous worker private keys
 * are commented out, not deleted, so you can switch back.
 *
 * It asks before registering. Afterwards it prints exactly what is left:
 * funding each wallet's implicit account with a little testnet NEAR for gas, and
 * setting a spending policy through each wallet's handoff URL.
 */
import { existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { parse } from "dotenv";

const ENV_FILE = process.env.POOLGUARD_ENV_FILE || ".env.testnet";
const API_URL = (process.env.OUTLAYER_API_URL || "https://testnet-api.outlayer.ai").replace(/\/+$/, "");

if (!existsSync(ENV_FILE)) {
  console.error(`Missing ${ENV_FILE}. Run from the repository root.`);
  process.exit(1);
}
const env = parse(readFileSync(ENV_FILE, "utf8"));
const owner = env.OWNER_ACCOUNT_ID || "poolguard-owner.testnet";

if (env.WORKER_ONE_CUSTODY === "outlayer" && env.WORKER_TWO_CUSTODY === "outlayer") {
  console.log("Both workers already use OutLayer custody in", ENV_FILE);
  printNextSteps(env.WORKER_ONE_ACCOUNT_ID, env.WORKER_TWO_ACCOUNT_ID, null, null);
  process.exit(0);
}

console.log(`OutLayer API: ${API_URL}`);
console.log(`This registers 2 custody wallets and rewrites the worker settings in ${ENV_FILE}.`);
const rl = createInterface({ input: stdin, output: stdout });
const answer = (await rl.question("Continue? [y/N] ")).trim().toLowerCase();
rl.close();
if (answer !== "y") {
  console.log("Nothing changed.");
  process.exit(0);
}

async function register() {
  const response = await fetch(`${API_URL}/register`, {
    method: "POST",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`register returned ${response.status}: ${text.slice(0, 300)}`);
  const body = JSON.parse(text);
  if (!body.api_key || !/^[0-9a-f]{64}$/.test(body.near_account_id ?? "")) {
    throw new Error(`unexpected register response: ${text.slice(0, 300)}`);
  }
  return { apiKey: body.api_key, accountId: body.near_account_id, handoffUrl: body.handoff_url ?? null };
}

const one = await register();
const two = await register();

// Back up, then rewrite only the worker block.
const backup = `${ENV_FILE}.before-outlayer`;
copyFileSync(ENV_FILE, backup);
let text = readFileSync(ENV_FILE, "utf8");
const setLine = (name, value) => {
  const line = `${name}=${value}`;
  const pattern = new RegExp(`^${name}=.*$`, "m");
  text = pattern.test(text) ? text.replace(pattern, line) : `${text.trimEnd()}\n${line}\n`;
};
const commentOut = (name) => {
  text = text.replace(new RegExp(`^(${name}=.*)$`, "m"), "# local custody (unused while OutLayer custody is on): $1");
};
commentOut("WORKER_ONE_PRIVATE_KEY");
commentOut("WORKER_TWO_PRIVATE_KEY");
setLine("WORKER_ONE_CUSTODY", "outlayer");
setLine("WORKER_ONE_ACCOUNT_ID", one.accountId);
setLine("WORKER_ONE_OUTLAYER_API_KEY", one.apiKey);
setLine("WORKER_TWO_CUSTODY", "outlayer");
setLine("WORKER_TWO_ACCOUNT_ID", two.accountId);
setLine("WORKER_TWO_OUTLAYER_API_KEY", two.apiKey);
setLine("OUTLAYER_API_URL", API_URL);
writeFileSync(ENV_FILE, text);

console.log(`\nUpdated ${ENV_FILE} (backup: ${backup}). API keys were written there and are not printed.`);
printNextSteps(one.accountId, two.accountId, one.handoffUrl, two.handoffUrl);

function printNextSteps(accountOne, accountTwo, handoffOne, handoffTwo) {
  console.log(`
Next steps
──────────
1. Fund each wallet's implicit account with testnet NEAR for gas (about 0.001 NEAR per call):

   near tokens ${owner} send-near ${accountOne} '0.5 NEAR' network-config testnet sign-with-keychain send
   near tokens ${owner} send-near ${accountTwo} '0.5 NEAR' network-config testnet sign-with-keychain send

2. Set a spending policy for each wallet (enforced inside OutLayer's TEE before every signature).
   Allow transaction type "call", cap native NEAR per transaction (e.g. 0.05) and per day.
${handoffOne ? `   Worker one: ${handoffOne}\n   Worker two: ${handoffTwo}\n   (These links carry the API key: open them yourself, don't share them.)` : "   Use each wallet's handoff URL from registration, or the OutLayer dashboard."}

3. Restart the API and worker. New tasks register the custody wallets as their agents.

4. Check everything (read-only):  pnpm testnet:preflight
`);
}
