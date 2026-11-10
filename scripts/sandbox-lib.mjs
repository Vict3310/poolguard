/**
 * Local NEAR sandbox provisioning shared by `pnpm sandbox` and the sandbox
 * integration suite.
 *
 * This is the only place that holds unrestricted account keys. It writes the
 * restricted worker keys (and the owner key used by the explicitly gated
 * sandbox setup helper) to .env.local; it never prints secret material.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Account,
  JsonRpcProvider,
  KeyPair,
  KeyPairSigner,
  actions,
  nearToYocto,
  teraToGas,
} from "near-api-js";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// near-sandbox downloads to os.tmpdir() and renames into node_modules. On hosts
// where /tmp is a different filesystem, that rename fails with EXDEV. Keep the
// download inside the workspace so both paths share a filesystem.
process.env.TMPDIR = resolve(ROOT, ".tmp");
mkdirSync(process.env.TMPDIR, { recursive: true });
const { Sandbox, DEFAULT_ACCOUNT_ID, DEFAULT_PRIVATE_KEY } = await import("near-sandbox");
export const WASM_PATH = resolve(ROOT, "contracts/poolguard/res/poolguard.wasm");
export const CONTRACT_METHODS = [
  "reserve",
  "execute",
  "cancel_reservation",
  "expire_reservation",
];

export function ensureWasm() {
  if (!existsSync(WASM_PATH)) {
    execFileSync("bash", [resolve(ROOT, "scripts/contract-build.sh")], {
      cwd: ROOT,
      stdio: "inherit",
    });
  }
  return WASM_PATH;
}

export function shortKey(key) {
  return key.getPublicKey().toString().slice(0, 18) + "…";
}

/**
 * Start a sandbox, deploy the contract and create the four identities used by
 * the application. Returns handles needed by tests; the caller owns teardown.
 */
export async function provisionSandbox({ log = console.log } = {}) {
  ensureWasm();
  const sandbox = await Sandbox.start({ version: process.env.NEAR_SANDBOX_VERSION ?? "2.14.0" });
  const rpcUrl = sandbox.rpcUrl;
  const provider = new JsonRpcProvider({ url: rpcUrl });
  const root = new Account(DEFAULT_ACCOUNT_ID, provider, KeyPairSigner.fromSecretKey(DEFAULT_PRIVATE_KEY));

  const cleanupOnError = async (error) => {
    await sandbox.tearDown().catch(() => undefined);
    throw error;
  };

  try {
    const contractKey = KeyPair.fromRandom("ed25519");
    const contractAccountId = `poolguard.${DEFAULT_ACCOUNT_ID}`;
    const ownerKey = KeyPair.fromRandom("ed25519");
    const ownerAccountId = `owner.${DEFAULT_ACCOUNT_ID}`;
    const providerKey = KeyPair.fromRandom("ed25519");
    const providerAccountId = `extract.${DEFAULT_ACCOUNT_ID}`;

    await root.createSubAccount({
      accountOrPrefix: "poolguard",
      publicKey: contractKey.getPublicKey().toString(),
      nearToTransfer: nearToYocto("60"),
    });
    const contractAccount = new Account(contractAccountId, provider, new KeyPairSigner(contractKey));
    await contractAccount.deployContract(readFileSync(WASM_PATH));
    await contractAccount.callFunction({
      contractId: contractAccountId,
      methodName: "new",
      args: {},
      waitUntil: "FINAL",
    });

    await root.createSubAccount({
      accountOrPrefix: "owner",
      publicKey: ownerKey.getPublicKey().toString(),
      nearToTransfer: nearToYocto("40"),
    });
    await root.createSubAccount({
      accountOrPrefix: "extract",
      publicKey: providerKey.getPublicKey().toString(),
      nearToTransfer: nearToYocto("2"),
    });
    const owner = new Account(ownerAccountId, provider, new KeyPairSigner(ownerKey));

    const workers = [];
    for (const [slot, prefix] of [
      [1, "agent-one"],
      [2, "agent-two"],
    ]) {
      const fullKey = KeyPair.fromRandom("ed25519");
      const restrictedKey = KeyPair.fromRandom("ed25519");
      const accountId = `${prefix}.${DEFAULT_ACCOUNT_ID}`;
      await root.createSubAccount({
        accountOrPrefix: prefix,
        publicKey: fullKey.getPublicKey().toString(),
        nearToTransfer: nearToYocto("8"),
      });
      const fullAccount = new Account(accountId, provider, new KeyPairSigner(fullKey));
      await fullAccount.signAndSendTransaction({
        receiverId: accountId,
        actions: [
          actions.addFunctionCallAccessKey(
            restrictedKey.getPublicKey(),
            contractAccountId,
            CONTRACT_METHODS,
            nearToYocto("0.25"),
          ),
        ],
        waitUntil: "FINAL",
      });
      workers.push({
        slot,
        accountId,
        fullKey,
        restrictedKey,
        privateKey: restrictedKey.toString(),
        publicKey: restrictedKey.getPublicKey().toString(),
        account: new Account(accountId, provider, new KeyPairSigner(restrictedKey)),
      });
    }

    log(`Sandbox RPC ${rpcUrl}`);
    log(`Contract ${contractAccountId}`);
    log(`Owner ${ownerAccountId}`);
    log(`Provider ${providerAccountId}`);
    for (const worker of workers) {
      log(`Agent ${worker.slot} ${worker.accountId} (restricted key ${shortKey(worker.restrictedKey)})`);
    }

    return {
      sandbox,
      rpcUrl,
      provider,
      root,
      contract: { accountId: contractAccountId, key: contractKey, account: contractAccount },
      owner: { accountId: ownerAccountId, key: ownerKey, account: owner },
      providerAccount: { accountId: providerAccountId, key: providerKey },
      workers,
      async tearDown() {
        await sandbox.tearDown();
      },
    };
  } catch (error) {
    return cleanupOnError(error);
  }
}

/** Values written to .env.local for the local stack. Secrets never leave disk. */
export function sandboxEnv(handles) {
  return {
    NEAR_NETWORK: "sandbox",
    NEAR_RPC_URL: handles.rpcUrl,
    POOLGUARD_CONTRACT_ID: handles.contract.accountId,
    OWNER_ACCOUNT_ID: handles.owner.accountId,
    POOLGUARD_OWNER_ACCOUNT_ID: handles.owner.accountId,
    SANDBOX_OWNER_PRIVATE_KEY: handles.owner.key.toString(),
    PROVIDER_ACCOUNT_ID: handles.providerAccount.accountId,
    SANDBOX_PROVIDER_PRIVATE_KEY: handles.providerAccount.key.toString(),
    // Deliberately not allowlisted on any task. Scenario C uses it to prove the
    // contract rejects an adversarial provider even when the model is fooled.
    POLICY_PROBE_PROVIDER_ACCOUNT_ID: `policy-probe.${handles.providerAccount.accountId.split(".").slice(1).join(".")}`,
    FAULT_INJECTION_ENABLED: "true",
    WORKER_ONE_ACCOUNT_ID: handles.workers[0].accountId,
    WORKER_ONE_PRIVATE_KEY: handles.workers[0].privateKey,
    WORKER_TWO_ACCOUNT_ID: handles.workers[1].accountId,
    WORKER_TWO_PRIVATE_KEY: handles.workers[1].privateKey,
    LOCAL_SANDBOX_MODE: "true",
    ALLOW_DEV_SESSION: "true",
  };
}

export function writeEnvLocal(values) {
  const path = resolve(ROOT, ".env.local");
  const lines = [
    "# Generated by `pnpm sandbox`. Gitignored; contains local-only testnet keys.",
    ...Object.entries(values).map(([key, value]) => `${key}=${value}`),
    "",
  ];
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, lines.join("\n"), { mode: 0o600 });
  return path;
}

export async function currentBlock(provider) {
  return provider.block({ finality: "final" });
}

export { nearToYocto, teraToGas, actions };
