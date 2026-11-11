#!/usr/bin/env node
/**
 * Read-only PoolGuard testnet preflight and verification.
 *
 * This script never signs a transaction, deploys code, spends NEAR or writes to
 * the database. It validates a production-shaped environment, checks the
 * testnet accounts/contract/restricted access keys, and optionally checks the
 * live API, provider and web services.
 *
 * It deliberately requires `.testnet` account names so a mainnet account or RPC
 * endpoint cannot be accepted by accident.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse as parseDotenv } from "dotenv";
import { KeyPair, baseEncode } from "near-api-js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, "..");
export const DEFAULT_ENV_FILE = process.env.POOLGUARD_ENV_FILE || ".env.testnet";
export const WORKER_METHODS = Object.freeze([
  "reserve",
  "execute",
  "cancel_reservation",
  "expire_reservation",
]);
export const MIN_WORKER_ALLOWANCE_YOCTO = 10_000_000_000_000_000_000_000n; // 0.01 NEAR
export const MAX_WORKER_ALLOWANCE_YOCTO = 1_000_000_000_000_000_000_000_000n; // 1 NEAR

const ACCOUNT_ID_RE = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])$/;
const PLACEHOLDER_RE =
  /^(|changeme|change[-_ ]?me|replace.*|your[-_ ].*|todo|example|\.\.\.|<.*>)$/i;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);
const RPC_TIMEOUT_MS = 12_000;
const HTTP_TIMEOUT_MS = 10_000;

const isMain =
  Boolean(process.argv[1]) &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

function value(env, name) {
  return String(env[name] ?? "").trim();
}

function isPlaceholder(input) {
  return PLACEHOLDER_RE.test(input.trim());
}

export function isTestnetAccount(accountId) {
  return ACCOUNT_ID_RE.test(accountId) && accountId.endsWith(".testnet");
}

export function createReport(mode = "preflight", envFile = null) {
  return {
    mode,
    envFile,
    checks: [],
    counts: { ok: 0, warn: 0, error: 0, info: 0 },
    chainChecked: false,
    servicesChecked: false,
    derivedWorkerKeys: [],
  };
}

export function addCheck(report, level, code, message) {
  if (!(level in report.counts)) throw new Error(`Unknown check level: ${level}`);
  report.checks.push({ level, code, message });
  report.counts[level] += 1;
}

/**
 * Load `.env` as the base, then `.env.testnet` (or --env-file) as the override.
 * The real process environment wins so a secret manager or hosting shell can
 * inject values without writing them to disk.
 */
export function loadTestnetEnv({
  envFile = DEFAULT_ENV_FILE,
  root = ROOT,
  environ = process.env,
} = {}) {
  const paths = [resolve(root, ".env"), resolve(root, envFile)];
  const merged = {};
  for (const path of paths) {
    if (!existsSync(path)) continue;
    Object.assign(merged, parseDotenv(readFileSync(path, "utf8")));
  }
  return { ...merged, ...environ };
}

function requireValue(report, env, name, message) {
  const current = value(env, name);
  if (!current) {
    addCheck(report, "error", `MISSING_${name}`, message);
    return "";
  }
  if (isPlaceholder(current)) {
    addCheck(
      report,
      "error",
      `PLACEHOLDER_${name}`,
      `${name} still contains a template placeholder.`,
    );
    return "";
  }
  return current;
}

function ensureAccount(report, env, name, label, { optional = false } = {}) {
  const raw = value(env, name);
  if (!raw) {
    if (!optional) addCheck(report, "error", `MISSING_${name}`, `${label} is required.`);
    return null;
  }
  if (isPlaceholder(raw)) {
    addCheck(report, "error", `PLACEHOLDER_${name}`, `${label} still contains a template placeholder.`);
    return null;
  }
  if (!isTestnetAccount(raw)) {
    addCheck(
      report,
      "error",
      `NOT_TESTNET_${name}`,
      `${label} must be a named .testnet account (got ${raw}).`,
    );
    return null;
  }
  return raw;
}

function validateOrigin(report, name, raw) {
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    addCheck(report, "error", `INVALID_${name}`, `${name} must be a valid absolute URL.`);
    return null;
  }
  if (url.protocol !== "https:") {
    addCheck(report, "error", `INSECURE_${name}`, `${name} must use https:// in a public testnet deployment.`);
  }
  if (LOCAL_HOSTS.has(url.hostname.toLowerCase())) {
    addCheck(report, "error", `LOCAL_${name}`, `${name} must not point at localhost or 0.0.0.0.`);
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    addCheck(report, "error", `ORIGIN_PATH_${name}`, `${name} must be an origin only, without a path, query or fragment.`);
  }
  return url;
}

/**
 * Validate the access key that will sign worker transactions. A full-access
 * key, a key scoped to another contract, extra methods or an unlimited gas
 * allowance all fail this check.
 */
export function inspectWorkerAccessKey(permission, contractId) {
  const errors = [];
  const warnings = [];
  const functionCall = permission?.FunctionCall;
  if (!functionCall) {
    errors.push("key is not a function-call key; a full-access worker key is not allowed");
    return { errors, warnings };
  }
  if (functionCall.receiver_id !== contractId) {
    errors.push(`key is scoped to ${functionCall.receiver_id ?? "no contract"}, expected ${contractId}`);
  }

  const methods = Array.isArray(functionCall.method_names) ? functionCall.method_names : [];
  if (methods.length === 0) {
    errors.push("key has an empty method list, which permits every method on the contract");
  } else {
    const extra = methods.filter((method) => !WORKER_METHODS.includes(method));
    const missing = WORKER_METHODS.filter((method) => !methods.includes(method));
    if (extra.length > 0) errors.push(`key allows extra methods: ${extra.join(", ")}`);
    if (missing.length > 0) errors.push(`key is missing required methods: ${missing.join(", ")}`);
  }

  if (functionCall.allowance === null || functionCall.allowance === undefined) {
    errors.push("key has an unlimited gas allowance; set a finite allowance");
  } else {
    let allowance;
    try {
      allowance = BigInt(String(functionCall.allowance));
    } catch {
      errors.push("key has an invalid gas allowance");
    }
    if (allowance !== undefined) {
      if (allowance <= 0n) {
        errors.push("key has no gas allowance");
      } else if (allowance < MIN_WORKER_ALLOWANCE_YOCTO) {
        warnings.push("gas allowance is below 0.01 NEAR and may be exhausted during demos");
      } else if (allowance > MAX_WORKER_ALLOWANCE_YOCTO) {
        warnings.push("gas allowance is above 1 NEAR; reduce it if this key does not need that much");
      }
    }
  }
  return { errors, warnings };
}

/**
 * Static validation only. No network calls and no secret values in the report.
 */
export function validateTestnetConfig(env, { mode = "preflight", envFile = null } = {}) {
  const report = createReport(mode, envFile);

  const nodeEnv = requireValue(report, env, "NODE_ENV", "NODE_ENV=production is required.");
  if (nodeEnv && nodeEnv !== "production") {
    addCheck(report, "error", "NODE_ENV_NOT_PRODUCTION", "NODE_ENV must be exactly production.");
  }

  const network = requireValue(report, env, "NEAR_NETWORK", "NEAR_NETWORK=testnet is required.");
  if (network && network !== "testnet") {
    addCheck(report, "error", "NOT_TESTNET_NETWORK", "NEAR_NETWORK must be exactly testnet; mainnet is unsupported.");
  }

  const rpcUrl = requireValue(report, env, "NEAR_RPC_URL", "NEAR_RPC_URL is required.");
  if (rpcUrl) {
    try {
      const url = new URL(rpcUrl);
      if (url.protocol !== "https:") {
        addCheck(report, "error", "INSECURE_NEAR_RPC_URL", "NEAR_RPC_URL must use https://.");
      }
      if (LOCAL_HOSTS.has(url.hostname.toLowerCase())) {
        addCheck(report, "error", "LOCAL_NEAR_RPC_URL", "NEAR_RPC_URL must not point at localhost.");
      }
      if (/mainnet/i.test(url.hostname)) {
        addCheck(report, "error", "MAINNET_NEAR_RPC_URL", "NEAR_RPC_URL points at mainnet; this project is testnet-only.");
      }
    } catch {
      addCheck(report, "error", "INVALID_NEAR_RPC_URL", "NEAR_RPC_URL must be a valid absolute URL.");
    }
  }

  const databaseUrl = requireValue(report, env, "DATABASE_URL", "DATABASE_URL is required.");
  if (databaseUrl) {
    try {
      const url = new URL(databaseUrl);
      if (!["postgres:", "postgresql:"].includes(url.protocol)) {
        addCheck(report, "error", "INVALID_DATABASE_URL", "DATABASE_URL must be a PostgreSQL URL.");
      }
      if (LOCAL_HOSTS.has(url.hostname.toLowerCase())) {
        addCheck(report, "error", "LOCAL_DATABASE_URL", "DATABASE_URL must not point at localhost for a public deployment.");
      }
      if (!url.username || !url.password || /changeme|replace|example/i.test(`${url.username}:${url.password}`)) {
        addCheck(report, "error", "DATABASE_CREDENTIALS", "DATABASE_URL still has placeholder credentials.");
      }
      const sslMode = url.searchParams.get("sslmode") || url.searchParams.get("ssl");
      if (!sslMode) {
        addCheck(report, "warn", "DATABASE_TLS", "DATABASE_URL has no sslmode; use TLS for a managed database.");
      }
    } catch {
      addCheck(report, "error", "INVALID_DATABASE_URL", "DATABASE_URL must be a valid PostgreSQL URL.");
    }
  }

  const contractId = ensureAccount(report, env, "POOLGUARD_CONTRACT_ID", "POOLGUARD_CONTRACT_ID");
  const ownerId = ensureAccount(report, env, "OWNER_ACCOUNT_ID", "OWNER_ACCOUNT_ID");
  const providerId = ensureAccount(report, env, "PROVIDER_ACCOUNT_ID", "PROVIDER_ACCOUNT_ID");

  const origins = {};
  for (const name of ["API_ORIGIN", "WEB_ORIGIN", "PROVIDER_ORIGIN"]) {
    const raw = requireValue(report, env, name, `${name} is required.`);
    origins[name] = validateOrigin(report, name, raw);
  }

  const providerDomain = requireValue(
    report,
    env,
    "PROVIDER_SERVICE_DOMAIN",
    "PROVIDER_SERVICE_DOMAIN is required for NEP-413 buyer authentication.",
  );
  if (providerDomain) {
    if (providerDomain.includes("://") || providerDomain.includes("/") || /\s/.test(providerDomain)) {
      addCheck(
        report,
        "error",
        "INVALID_PROVIDER_SERVICE_DOMAIN",
        "PROVIDER_SERVICE_DOMAIN must be a host[:port] only, with no scheme or path.",
      );
    } else if (origins.PROVIDER_ORIGIN) {
      const providerHost = origins.PROVIDER_ORIGIN.host;
      const providerHostname = origins.PROVIDER_ORIGIN.hostname;
      if (providerDomain !== providerHost && providerDomain !== providerHostname) {
        addCheck(
          report,
          "error",
          "PROVIDER_DOMAIN_MISMATCH",
          `PROVIDER_SERVICE_DOMAIN (${providerDomain}) must equal the provider origin host (${providerHost}).`,
        );
      }
    }
  }

  const sessionSecret = requireValue(report, env, "SESSION_SECRET", "SESSION_SECRET is required.");
  if (sessionSecret) {
    if (sessionSecret.length < 32) {
      addCheck(report, "error", "SESSION_SECRET_SHORT", "SESSION_SECRET must be at least 32 characters.");
    }
    if (/changeme|replace|example/i.test(sessionSecret)) {
      addCheck(report, "error", "SESSION_SECRET_PLACEHOLDER", "SESSION_SECRET still contains a placeholder.");
    }
  }

  const documentKey = requireValue(
    report,
    env,
    "DOCUMENT_ENCRYPTION_KEY",
    "DOCUMENT_ENCRYPTION_KEY is required.",
  );
  if (documentKey) {
    let bytes = null;
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(documentKey)) {
      addCheck(report, "error", "DOCUMENT_KEY_INVALID_BASE64", "DOCUMENT_ENCRYPTION_KEY must be valid base64.");
    } else {
      bytes = Buffer.from(documentKey, "base64");
      if (bytes.length !== 32) {
        addCheck(
          report,
          "error",
          "DOCUMENT_KEY_LENGTH",
          `DOCUMENT_ENCRYPTION_KEY must decode to 32 bytes (got ${bytes.length}).`,
        );
      }
    }
  }

  for (const [name, reason] of [
    ["LOCAL_SANDBOX_MODE", "must be false for testnet"],
    ["ALLOW_DEV_SESSION", "must be false for testnet"],
    ["FAULT_INJECTION_ENABLED", "must be false outside scripted local demos"],
  ]) {
    if (value(env, name).toLowerCase() !== "false") {
      addCheck(report, "error", `${name}_NOT_FALSE`, `${name} ${reason}.`);
    }
  }

  for (const name of ["SANDBOX_OWNER_PRIVATE_KEY", "SANDBOX_PROVIDER_PRIVATE_KEY"]) {
    if (value(env, name)) {
      addCheck(
        report,
        "error",
        `SANDBOX_SECRET_${name}`,
        `${name} is local-sandbox-only and must be unset for testnet.`,
      );
    }
  }

  const workerKeys = [];
  const workerKeyStrings = new Set();
  for (const slot of [1, 2]) {
    const prefix = slot === 1 ? "WORKER_ONE" : "WORKER_TWO";
    const accountId = ensureAccount(report, env, `${prefix}_ACCOUNT_ID`, `${prefix}_ACCOUNT_ID`);
    // OutLayer custody: the key never leaves OutLayer's TEE; the worker signs
    // through an API key and the account is the wallet's implicit account.
    if (value(env, `${prefix}_CUSTODY`).toLowerCase() === "outlayer") {
      const apiKey = value(env, `${prefix}_OUTLAYER_API_KEY`);
      if (!apiKey) {
        addCheck(report, "error", `${prefix}_OUTLAYER_API_KEY`, `${prefix}_OUTLAYER_API_KEY is required when ${prefix}_CUSTODY=outlayer.`);
        continue;
      }
      if (!accountId || !/^[0-9a-f]{64}$/.test(accountId)) {
        addCheck(report, "error", `${prefix}_IMPLICIT_ACCOUNT`, `${prefix}_ACCOUNT_ID must be the OutLayer wallet's 64-character implicit account.`);
        continue;
      }
      if (value(env, `${prefix}_PRIVATE_KEY`)) {
        addCheck(report, "warn", `${prefix}_UNUSED_PRIVATE_KEY`, `${prefix}_PRIVATE_KEY is ignored under OutLayer custody; remove it.`);
      }
      const publicKey = `ed25519:${baseEncode(Buffer.from(accountId, "hex"))}`;
      workerKeys.push({ slot, accountId, publicKey, custody: "outlayer", apiKey });
      addCheck(report, "ok", `WORKER_${slot}_CUSTODY`, `Worker ${slot} signs through OutLayer TEE custody as ${accountId} (${publicKey}).`);
      continue;
    }
    const privateKey = requireValue(
      report,
      env,
      `${prefix}_PRIVATE_KEY`,
      `${prefix}_PRIVATE_KEY is required.`,
    );
    if (!privateKey) continue;
    if (workerKeyStrings.has(privateKey)) {
      addCheck(report, "error", `DUPLICATE_${prefix}_KEY`, "worker one and worker two must use different keys.");
      continue;
    }
    workerKeyStrings.add(privateKey);

    let publicKey = null;
    try {
      publicKey = KeyPair.fromString(privateKey).getPublicKey().toString();
    } catch {
      addCheck(
        report,
        "error",
        `INVALID_${prefix}_KEY`,
        `${prefix}_PRIVATE_KEY is not a valid NEAR private key.`,
      );
      continue;
    }
    if (!/^(ed25519|secp256k1):/.test(publicKey)) {
      addCheck(report, "error", `UNSUPPORTED_${prefix}_KEY`, `${prefix}_PRIVATE_KEY has an unsupported key type.`);
      continue;
    }
    if (accountId) {
      workerKeys.push({ slot, accountId, publicKey });
      addCheck(
        report,
        "ok",
        `WORKER_${slot}_KEY`,
        `Worker ${slot} key derives to ${publicKey} for ${accountId}.`,
      );
    }
  }
  report.derivedWorkerKeys = workerKeys;

  const roles = [
    ["POOLGUARD_CONTRACT_ID", contractId],
    ["OWNER_ACCOUNT_ID", ownerId],
    ["PROVIDER_ACCOUNT_ID", providerId],
    ...workerKeys.map((worker) => [`WORKER_${worker.slot}_ACCOUNT_ID`, worker.accountId]),
  ].filter(([, accountId]) => Boolean(accountId));
  const seenAccounts = new Map();
  for (const [name, accountId] of roles) {
    const previous = seenAccounts.get(accountId);
    if (previous) {
      addCheck(
        report,
        "error",
        `DUPLICATE_ACCOUNT_${name}`,
        `${name} must not reuse the same account as ${previous}.`,
      );
    } else {
      seenAccounts.set(accountId, name);
    }
  }

  const policyProbe = ensureAccount(
    report,
    env,
    "POLICY_PROBE_PROVIDER_ACCOUNT_ID",
    "POLICY_PROBE_PROVIDER_ACCOUNT_ID",
    { optional: true },
  );
  if (policyProbe) {
    if (seenAccounts.has(policyProbe)) {
      addCheck(
        report,
        "error",
        "POLICY_PROBE_NOT_DISTINCT",
        "POLICY_PROBE_PROVIDER_ACCOUNT_ID must be an account that is not allowlisted and not another service role.",
      );
    }
  } else if (!value(env, "POLICY_PROBE_PROVIDER_ACCOUNT_ID")) {
    addCheck(
      report,
      "warn",
      "POLICY_PROBE_MISSING",
      "POLICY_PROBE_PROVIDER_ACCOUNT_ID is unset; scenario C's contract denial check will be unavailable.",
    );
  }

  const publicContract = value(env, "NEXT_PUBLIC_POOLGUARD_CONTRACT_ID");
  if (publicContract && contractId && publicContract !== contractId) {
    addCheck(
      report,
      "error",
      "PUBLIC_CONTRACT_MISMATCH",
      "NEXT_PUBLIC_POOLGUARD_CONTRACT_ID must match POOLGUARD_CONTRACT_ID.",
    );
  }

  if (value(env, "AI_API_KEY")) {
    const aiBase = value(env, "AI_BASE_URL") || "https://api.openai.com/v1";
    try {
      if (new URL(aiBase).protocol !== "https:") {
        addCheck(report, "error", "INSECURE_AI_BASE_URL", "AI_BASE_URL must use https://.");
      }
    } catch {
      addCheck(report, "error", "INVALID_AI_BASE_URL", "AI_BASE_URL must be a valid absolute URL.");
    }
    addCheck(report, "info", "AI_LIVE", "AI_API_KEY is configured; runs will use the live model path.");
  } else {
    addCheck(report, "info", "AI_SCRIPTED", "AI_API_KEY is unset; runs will be labelled scripted fixtures.");
  }

  if (value(env, "WORKER_ID") === "" || value(env, "WORKER_ID") === "worker-local") {
    addCheck(
      report,
      "warn",
      "WORKER_ID_DEFAULT",
      "Set a unique WORKER_ID for each testnet worker process.",
    );
  }

  if (value(env, "PRISMA_LOG_QUERIES")) {
    addCheck(report, "warn", "PRISMA_LOG_QUERIES", "PRISMA_LOG_QUERIES is set; query logs may contain sensitive data.");
  }

  if (report.counts.error === 0) {
    addCheck(report, "ok", "CONFIG_GATE", "Static configuration passes the testnet deployment gate.");
  }
  return report;
}

async function rpcCall(rpcUrl, method, params, fetchImpl) {
  const response = await fetchImpl(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "poolguard-testnet-check", method, params }),
    signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`NEAR RPC returned HTTP ${response.status} with non-JSON content`);
  }
  if (!response.ok) throw new Error(`NEAR RPC returned HTTP ${response.status}`);
  if (body.error) {
    const message = body.error.message ?? body.error.data ?? "NEAR RPC error";
    throw new Error(String(message).slice(0, 500));
  }
  return body.result;
}

async function viewAccount(rpcUrl, accountId, fetchImpl) {
  return rpcCall(
    rpcUrl,
    "query",
    { request_type: "view_account", finality: "final", account_id: accountId },
    fetchImpl,
  );
}

/** Near-sdk serializes U128 as a decimal string; accept the wrapped shape too. */
function yoctoFromConfig(value) {
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  if (value && typeof value === "object") {
    const inner = value.U128 ?? value.u128;
    if (typeof inner === "string" && /^\d+$/.test(inner)) return BigInt(inner);
  }
  return null;
}

/**
 * On-chain checks. This is read-only and safe to run before the app services
 * are started.
 */
/** OutLayer custody worker: wallet address, on-chain key, gas balance and policy. */
async function checkCustodyWorker(env, report, worker, rpcUrl, fetchImpl) {
  const label = `WORKER_${worker.slot}`;
  const apiUrl = (value(env, "OUTLAYER_API_URL") || "https://testnet-api.outlayer.ai").replace(/\/+$/, "");
  const get = async (path) => {
    const response = await fetchImpl(`${apiUrl}${path}`, {
      headers: { authorization: `Bearer ${worker.apiKey}`, accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    let body = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = {};
    }
    return { status: response.status, body };
  };
  try {
    const address = await get("/wallet/v1/address?chain=near");
    if (address.status !== 200) {
      addCheck(report, "error", `${label}_OUTLAYER_AUTH`, `OutLayer rejected the API key (HTTP ${address.status}).`);
      return;
    }
    if (address.body.address !== worker.accountId) {
      addCheck(report, "error", `${label}_OUTLAYER_ADDRESS`, `OutLayer wallet address ${address.body.address ?? "unknown"} does not match ${worker.accountId}.`);
      return;
    }
    addCheck(report, "ok", `${label}_OUTLAYER_WALLET`, `OutLayer wallet ${worker.accountId} answers for this API key.`);
    const policy = await get("/wallet/v1/policy");
    const hasPolicy = policy.status === 200 && policy.body && Object.keys(policy.body).length > 0 && !policy.body.error;
    addCheck(
      report,
      hasPolicy ? "ok" : "warn",
      `${label}_OUTLAYER_POLICY`,
      hasPolicy
        ? "OutLayer policy is set; it is enforced in the TEE before every signature."
        : "No OutLayer policy found. Set per-transaction and daily limits through the wallet's handoff URL.",
    );
  } catch (error) {
    addCheck(report, "error", `${label}_OUTLAYER_UNREACHABLE`, `Cannot reach OutLayer at ${apiUrl}: ${error.message}`);
    return;
  }
  try {
    await rpcCall(
      rpcUrl,
      "query",
      { request_type: "view_access_key", finality: "final", account_id: worker.accountId, public_key: worker.publicKey },
      fetchImpl,
    );
    const account = await viewAccount(rpcUrl, worker.accountId, fetchImpl);
    const balance = BigInt(account?.amount ?? "0");
    const minimum = 50_000_000_000_000_000_000_000n; // 0.05 NEAR for gas
    addCheck(
      report,
      balance >= minimum ? "ok" : "error",
      `${label}_GAS_BALANCE`,
      balance >= minimum
        ? `${worker.accountId} holds enough NEAR for gas.`
        : `${worker.accountId} needs at least 0.05 NEAR for gas; send testnet NEAR to it.`,
    );
  } catch (error) {
    addCheck(report, "error", `${label}_IMPLICIT_ACCOUNT_MISSING`, `${worker.accountId} is not on chain yet; fund it with testnet NEAR first (${error.message}).`);
  }
}

export async function checkChain(env, report, { fetchImpl = fetch } = {}) {
  report.chainChecked = true;
  const rpcUrl = value(env, "NEAR_RPC_URL");
  const contractId = value(env, "POOLGUARD_CONTRACT_ID");
  const ownerId = value(env, "OWNER_ACCOUNT_ID") || value(env, "POOLGUARD_OWNER_ACCOUNT_ID");
  const providerId = value(env, "PROVIDER_ACCOUNT_ID");
  const policyProbeId = value(env, "POLICY_PROBE_PROVIDER_ACCOUNT_ID");

  if (!rpcUrl || !contractId) {
    addCheck(report, "error", "CHAIN_CONFIG_MISSING", "RPC URL and contract ID are required before chain checks.");
    return report;
  }

  let status;
  try {
    status = await rpcCall(rpcUrl, "status", [], fetchImpl);
  } catch (error) {
    addCheck(report, "error", "RPC_UNREACHABLE", `Cannot reach NEAR RPC: ${error.message}`);
    return report;
  }
  if (status?.chain_id !== "testnet") {
    addCheck(
      report,
      "error",
      "RPC_NOT_TESTNET",
      `RPC chain_id is ${status?.chain_id ?? "unknown"}, not testnet. Refusing to verify a mainnet endpoint.`,
    );
    return report;
  }
  addCheck(
    report,
    "ok",
    "RPC_TESTNET",
    `RPC is testnet at block ${status.latest_block_height ?? "unknown"}.`,
  );

  const accounts = [
    ["POOLGUARD_CONTRACT_ID", contractId],
    ["OWNER_ACCOUNT_ID", ownerId],
    ["PROVIDER_ACCOUNT_ID", providerId],
    ...report.derivedWorkerKeys.map((worker) => [`WORKER_${worker.slot}_ACCOUNT_ID`, worker.accountId]),
    ...(policyProbeId ? [["POLICY_PROBE_PROVIDER_ACCOUNT_ID", policyProbeId]] : []),
  ].filter(([, accountId]) => Boolean(accountId));

  const balances = new Map();
  for (const [name, accountId] of accounts) {
    try {
      const account = await viewAccount(rpcUrl, accountId, fetchImpl);
      const amount = BigInt(account.amount ?? "0");
      balances.set(accountId, amount);
      if (amount === 0n) {
        addCheck(report, "warn", `ZERO_BALANCE_${name}`, `${accountId} exists but has a zero NEAR balance.`);
      } else {
        addCheck(report, "ok", `ACCOUNT_${name}`, `${accountId} exists on testnet.`);
      }
    } catch (error) {
      addCheck(report, "error", `MISSING_ACCOUNT_${name}`, `${accountId} is missing or unreadable: ${error.message}`);
    }
  }

  try {
    const code = await rpcCall(
      rpcUrl,
      "query",
      { request_type: "view_code", finality: "final", account_id: contractId },
      fetchImpl,
    );
    if (!code.code_base64 || code.code_base64.length < 100) {
      addCheck(report, "error", "CONTRACT_NO_CODE", `${contractId} has no deployed contract code.`);
    } else {
      addCheck(report, "ok", "CONTRACT_DEPLOYED", `${contractId} has deployed WASM code.`);
      const deployedHash = createHash("sha256")
        .update(Buffer.from(code.code_base64, "base64"))
        .digest("hex");
      const localWasm = resolve(ROOT, "contracts/poolguard/res/poolguard.wasm");
      if (!existsSync(localWasm)) {
        addCheck(
          report,
          "warn",
          "CONTRACT_WASM_LOCAL_MISSING",
          `Cannot compare the deployed WASM: ${localWasm} is missing. Run pnpm contract:build.`,
        );
      } else {
        const localHash = createHash("sha256").update(readFileSync(localWasm)).digest("hex");
        if (localHash !== deployedHash) {
          addCheck(
            report,
            "error",
            "CONTRACT_WASM_MISMATCH",
            `Deployed WASM hash ${deployedHash} does not match the built artifact ${localHash}.`,
          );
        } else {
          addCheck(
            report,
            "ok",
            "CONTRACT_WASM_MATCH",
            `Deployed WASM matches the local build (${localHash.slice(0, 12)}…).`,
          );
        }
      }
    }
  } catch (error) {
    addCheck(report, "error", "CONTRACT_CODE_UNREADABLE", `Cannot read contract code at ${contractId}: ${error.message}`);
  }

  try {
    const configResult = await rpcCall(
      rpcUrl,
      "query",
      {
        request_type: "call_function",
        finality: "final",
        account_id: contractId,
        method_name: "get_config",
        args_base64: Buffer.from("{}").toString("base64"),
      },
      fetchImpl,
    );
    const decoded = JSON.parse(Buffer.from(configResult.result ?? []).toString("utf8"));
    if (decoded.contract_id !== contractId) {
      addCheck(
        report,
        "error",
        "CONTRACT_CONFIG_MISMATCH",
        `get_config reports ${decoded.contract_id ?? "no contract"}, expected ${contractId}.`,
      );
    } else {
      addCheck(report, "ok", "CONTRACT_CONFIG", "get_config responds with the expected contract ID.");
    }
    if (decoded.owner && decoded.owner !== contractId) {
      addCheck(
        report,
        "warn",
        "CONTRACT_INITIALIZED_BY",
        `Contract owner field is ${decoded.owner}, not the contract account. Confirm this was intentional.`,
      );
    }
    const taskDeposit = yoctoFromConfig(decoded.task_storage_deposit);
    const agentDeposit = yoctoFromConfig(decoded.agent_storage_deposit);
    const ownerBalance = ownerId ? balances.get(ownerId) : undefined;
    if (taskDeposit !== null && agentDeposit !== null && ownerBalance !== undefined) {
      const required = taskDeposit + agentDeposit * 2n;
      if (ownerBalance < required) {
        addCheck(
          report,
          "warn",
          "OWNER_BALANCE_SETUP",
          `${ownerId} has ${ownerBalance} yoctoNEAR; task setup needs at least ${required} for storage before budget funding.`,
        );
      } else {
        addCheck(
          report,
          "ok",
          "OWNER_BALANCE_SETUP",
          `${ownerId} can cover the task and two agent storage deposits.`,
        );
      }
    }
  } catch (error) {
    addCheck(report, "error", "CONTRACT_CONFIG_UNREADABLE", `Cannot call get_config: ${error.message}`);
  }

  for (const worker of report.derivedWorkerKeys) {
    if (worker.custody === "outlayer") {
      await checkCustodyWorker(env, report, worker, rpcUrl, fetchImpl);
      continue;
    }
    try {
      const access = await rpcCall(
        rpcUrl,
        "query",
        {
          request_type: "view_access_key",
          finality: "final",
          account_id: worker.accountId,
          public_key: worker.publicKey,
        },
        fetchImpl,
      );
      const outcome = inspectWorkerAccessKey(access.permission, contractId);
      for (const message of outcome.errors) {
        addCheck(report, "error", `WORKER_${worker.slot}_ACCESS_KEY`, message);
      }
      for (const message of outcome.warnings) {
        addCheck(report, "warn", `WORKER_${worker.slot}_ACCESS_KEY`, message);
      }
      if (outcome.errors.length === 0) {
        addCheck(
          report,
          "ok",
          `WORKER_${worker.slot}_ACCESS_KEY_OK`,
          `Worker ${worker.slot} has a contract-scoped function-call key.`,
        );
      }
      try {
        const list = await rpcCall(
          rpcUrl,
          "query",
          { request_type: "view_access_key_list", finality: "final", account_id: worker.accountId },
          fetchImpl,
        );
        const keys = Array.isArray(list?.keys) ? list.keys : [];
        const fullAccess = keys.filter((entry) => entry?.access_key?.permission?.FullAccess);
        if (fullAccess.length > 0) {
          addCheck(
            report,
            "error",
            `WORKER_${worker.slot}_FULL_ACCESS_KEY`,
            `${worker.accountId} still has ${fullAccess.length} full-access key(s): ${fullAccess
              .map((entry) => entry.public_key ?? "unknown")
              .join(", ")}. Remove them after adding the restricted key.`,
          );
        } else {
          addCheck(
            report,
            "ok",
            `WORKER_${worker.slot}_NO_FULL_ACCESS_KEY`,
            `${worker.accountId} has no full-access key.`,
          );
        }
      } catch (error) {
        addCheck(
          report,
          "warn",
          `WORKER_${worker.slot}_ACCESS_KEY_LIST`,
          `Could not list access keys for ${worker.accountId}: ${error.message}`,
        );
      }
    } catch (error) {
      addCheck(
        report,
        "error",
        `WORKER_${worker.slot}_ACCESS_KEY_MISSING`,
        `Access key for ${worker.accountId} is missing or unreadable: ${error.message}`,
      );
    }
  }

  return report;
}

async function httpGet(url, fetchImpl) {
  const response = await fetchImpl(url, {
    redirect: "follow",
    headers: { accept: "application/json,text/html;q=0.9,*/*;q=0.8" },
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // HTML is expected for the web app.
  }
  return { response, text, json, finalUrl: response.url };
}

async function httpPost(url, fetchImpl) {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // A dev-session rejection may not be JSON.
  }
  return { response, text, json, finalUrl: response.url };
}

/**
 * Live service checks. Run only after the four services are deployed.
 */
export async function checkServices(env, report, { fetchImpl = fetch } = {}) {
  report.servicesChecked = true;
  const normalizeOrigin = (input) => {
    try {
      return new URL(input).origin;
    } catch {
      return input.replace(/\/$/, "");
    }
  };
  const apiOrigin = normalizeOrigin(value(env, "API_ORIGIN"));
  const webOrigin = normalizeOrigin(value(env, "WEB_ORIGIN"));
  const providerOrigin = normalizeOrigin(value(env, "PROVIDER_ORIGIN"));
  const expectedContract = value(env, "POOLGUARD_CONTRACT_ID");
  const providerAccountId = value(env, "PROVIDER_ACCOUNT_ID");
  const httpsWeb = webOrigin.startsWith("https://");

  if (!apiOrigin || !webOrigin || !providerOrigin) {
    addCheck(report, "error", "SERVICE_ORIGINS_MISSING", "API_ORIGIN, WEB_ORIGIN and PROVIDER_ORIGIN are required.");
    return report;
  }

  let apiHealth = null;
  try {
    apiHealth = await httpGet(`${apiOrigin}/health`, fetchImpl);
    if (apiHealth.response.ok && apiHealth.json?.status === "ok") {
      addCheck(report, "ok", "API_HEALTH", "API health endpoint responds.");
    } else {
      addCheck(report, "error", "API_HEALTH", `API health returned HTTP ${apiHealth.response.status}.`);
    }
  } catch (error) {
    addCheck(report, "error", "API_UNREACHABLE", `Cannot reach API: ${error.message}`);
  }

  try {
    const ready = await httpGet(`${apiOrigin}/ready`, fetchImpl);
    if (ready.response.ok && ready.json?.status === "ready") {
      addCheck(report, "ok", "API_READY", "API reports database and RPC ready.");
    } else {
      addCheck(report, "error", "API_NOT_READY", `API readiness returned HTTP ${ready.response.status}.`);
    }
  } catch (error) {
    addCheck(report, "error", "API_READY_UNREACHABLE", `Cannot read API readiness: ${error.message}`);
  }

  try {
    const metaResult = await httpGet(`${apiOrigin}/meta`, fetchImpl);
    if (!metaResult.response.ok || !metaResult.json) {
      addCheck(report, "error", "API_META", `API /meta returned HTTP ${metaResult.response.status}.`);
    } else {
      const meta = metaResult.json;
      const checks = [
        ["META_NETWORK", meta.network === "testnet", "API reports testnet."],
        ["META_CONTRACT", meta.contractId === expectedContract, "API reports the expected contract."],
        ["META_NO_SANDBOX", meta.sandbox === false, "API is not in sandbox mode."],
        ["META_NO_DEV_SESSION", meta.devSessionEnabled === false, "API dev session is disabled."],
        ["META_TEST_TOKENS", meta.testTokens === true, "API reports testnet tokens with no value."],
        ["META_API_ORIGIN", normalizeOrigin(meta.apiOrigin) === apiOrigin, "API reports the expected public API origin."],
        ["META_WEB_ORIGIN", normalizeOrigin(meta.webOrigin) === webOrigin, "API reports the expected public web origin."],
      ];
      for (const [code, passed, message] of checks) {
        if (passed) addCheck(report, "ok", code, message);
        else addCheck(report, "error", code, message.replace("reports", "does not report"));
      }

      if (httpsWeb) {
        if (meta.secureCookies === true) {
          addCheck(report, "ok", "META_SECURE_COOKIES", "API reports secure cookies for the HTTPS web origin.");
        } else {
          addCheck(
            report,
            "error",
            "META_INSECURE_COOKIES",
            "API does not report secure cookies for an HTTPS web origin.",
          );
        }
      }

      const metaWorkers = Array.isArray(meta.workerAccounts) ? meta.workerAccounts : [];
      for (const derived of report.derivedWorkerKeys) {
        const remote = metaWorkers.find((worker) => worker.accountId === derived.accountId);
        if (!remote) {
          addCheck(
            report,
            "error",
            `META_WORKER_${derived.slot}_MISSING`,
            `API does not list ${derived.accountId}.`,
          );
        } else if (remote.publicKey !== derived.publicKey) {
          addCheck(
            report,
            "error",
            `META_WORKER_${derived.slot}_KEY_MISMATCH`,
            `API derived a different public key for ${derived.accountId}.`,
          );
        } else {
          addCheck(report, "ok", `META_WORKER_${derived.slot}`, `API has the expected worker key for ${derived.accountId}.`);
        }
      }

      const aiExpected = Boolean(value(env, "AI_API_KEY"));
      if (meta.aiConfigured !== aiExpected) {
        addCheck(
          report,
          "warn",
          "META_AI_MISMATCH",
          `API aiConfigured=${Boolean(meta.aiConfigured)} while the environment expects ${aiExpected}.`,
        );
      }
      const policyProbeExpected = Boolean(value(env, "POLICY_PROBE_PROVIDER_ACCOUNT_ID"));
      if (meta.policyProbeConfigured !== policyProbeExpected) {
        addCheck(
          report,
          "warn",
          "META_POLICY_PROBE_MISMATCH",
          `API policyProbeConfigured=${Boolean(meta.policyProbeConfigured)} while the environment expects ${policyProbeExpected}.`,
        );
      }
      if (!meta.chainConfig) {
        addCheck(report, "warn", "META_CHAIN_CONFIG", "API could not read chain configuration.");
      }
    }
  } catch (error) {
    addCheck(report, "error", "API_META_UNREACHABLE", `Cannot read API metadata: ${error.message}`);
  }

  try {
    const devSession = await httpPost(`${apiOrigin}/dev/session`, fetchImpl);
    if (devSession.response.status === 404) {
      addCheck(report, "ok", "DEV_SESSION_BLOCKED", "The dev-session endpoint returns 404 on the deployed API.");
    } else if (devSession.response.ok) {
      addCheck(report, "error", "DEV_SESSION_EXPOSED", "The dev-session endpoint is enabled on the deployed API.");
    } else {
      addCheck(
        report,
        "warn",
        "DEV_SESSION_UNEXPECTED",
        `The dev-session endpoint returned HTTP ${devSession.response.status}; expected 404.`,
      );
    }
  } catch (error) {
    addCheck(report, "warn", "DEV_SESSION_UNREACHABLE", `Cannot probe the dev-session endpoint: ${error.message}`);
  }

  for (const endpoint of ["health", "ready"]) {
    try {
      const result = await httpGet(`${providerOrigin}/${endpoint}`, fetchImpl);
      if (result.response.ok) addCheck(report, "ok", `PROVIDER_${endpoint.toUpperCase()}`, `Provider /${endpoint} responds.`);
      else addCheck(report, "error", `PROVIDER_${endpoint.toUpperCase()}`, `Provider /${endpoint} returned HTTP ${result.response.status}.`);
    } catch (error) {
      addCheck(report, "error", `PROVIDER_${endpoint.toUpperCase()}_UNREACHABLE`, `Cannot reach provider /${endpoint}: ${error.message}`);
    }
  }

  try {
    const catalog = await httpGet(`${providerOrigin}/catalog`, fetchImpl);
    if (catalog.response.ok && Array.isArray(catalog.json?.services) && catalog.json.services.length > 0) {
      addCheck(report, "ok", "PROVIDER_CATALOG", `Provider exposes ${catalog.json.services.length} service(s).`);
      if (catalog.json.provider_account_id !== providerAccountId) {
        addCheck(
          report,
          "error",
          "PROVIDER_CATALOG_ACCOUNT",
          `Provider catalog reports ${catalog.json.provider_account_id ?? "no account"}, expected ${providerAccountId}.`,
        );
      } else {
        addCheck(report, "ok", "PROVIDER_CATALOG_ACCOUNT", `Provider catalog is bound to ${providerAccountId}.`);
      }
    } else {
      addCheck(report, "warn", "PROVIDER_CATALOG", "Provider catalog is empty or unreadable.");
    }
  } catch (error) {
    addCheck(report, "warn", "PROVIDER_CATALOG_UNREACHABLE", `Cannot read provider catalog: ${error.message}`);
  }

  for (const path of ["/", "/app"]) {
    try {
      const result = await httpGet(`${webOrigin}${path}`, fetchImpl);
      if (!result.response.ok) {
        addCheck(report, "error", `WEB_${path === "/" ? "ROOT" : "APP"}`, `Web ${path} returned HTTP ${result.response.status}.`);
      } else if (!result.text.includes("PoolGuard")) {
        addCheck(report, "warn", `WEB_${path === "/" ? "ROOT" : "APP"}`, `Web ${path} did not contain the PoolGuard title.`);
      } else {
        addCheck(report, "ok", `WEB_${path === "/" ? "ROOT" : "APP"}`, `Web ${path} renders.`);
        if (!result.finalUrl.startsWith(webOrigin)) {
          addCheck(report, "warn", "WEB_REDIRECT_ORIGIN", `Web ${path} redirected to ${result.finalUrl}.`);
        }
      }
    } catch (error) {
      addCheck(report, "error", `WEB_${path === "/" ? "ROOT" : "APP"}_UNREACHABLE`, `Cannot reach web ${path}: ${error.message}`);
    }
  }

  return report;
}

export function reportAsJson(report) {
  return {
    mode: report.mode,
    envFile: report.envFile,
    configOnly: Boolean(report.configOnly),
    counts: report.counts,
    chainChecked: report.chainChecked,
    servicesChecked: report.servicesChecked,
    checks: report.checks,
  };
}

export function printReport(report) {
  const title = report.mode === "verify" ? "PoolGuard testnet verification" : "PoolGuard testnet preflight";
  console.log(`\n${title}`);
  if (report.envFile) console.log(`Environment: ${report.envFile}`);
  console.log("");
  const labels = { ok: "PASS", warn: "WARN", error: "FAIL", info: "INFO" };
  for (const check of report.checks) {
    console.log(`${labels[check.level].padEnd(5)} ${check.code}: ${check.message}`);
  }
  console.log("");
  console.log(
    `${report.counts.ok} passed, ${report.counts.warn} warning(s), ${report.counts.error} error(s).`,
  );
  if (report.configOnly) {
    console.log("Config-only mode: chain and live-service checks were skipped.");
  } else if (!report.chainChecked && !report.servicesChecked) {
    console.log("Chain and live-service checks were not run because static configuration failed.");
  } else if (!report.servicesChecked && report.mode === "verify") {
    console.log("Live-service checks were skipped because chain checks did not pass.");
  }
  if (report.counts.error > 0) {
    console.log("Deployment gate: FAILED. Do not deploy or announce this environment.\n");
  } else if (report.configOnly) {
    console.log("Static gate: PASSED. Chain and live-service verification is still required.\n");
  } else if (report.mode === "verify" && !report.servicesChecked) {
    console.log("Deployment gate: NOT COMPLETE. Live-service verification has not run.\n");
  } else {
    console.log("Deployment gate: PASSED for the checks that ran.\n");
  }
}

function parseArgs(argv) {
  const args = {
    live: false,
    configOnly: false,
    json: false,
    help: false,
    envFile: DEFAULT_ENV_FILE,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--live") args.live = true;
    else if (arg === "--config-only") args.configOnly = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--env-file" || arg === "--env") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error(`${arg} requires a path`);
      args.envFile = next;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (args.live && args.configOnly) throw new Error("--live and --config-only cannot be combined");
  return args;
}

function printUsage() {
  console.log(`Usage:
  pnpm testnet:preflight [--env-file .env.testnet] [--config-only] [--json]
  pnpm testnet:verify    [--env-file .env.testnet] [--json]

Preflight validates production configuration, keys, testnet accounts, deployed
WASM, full-access-key removal, owner storage balance, restricted worker access
keys, cookie/dev-session metadata and the provider catalog binding. Verify
additionally checks API, provider and web health/metadata. Neither command signs,
deploys or spends.
`);
}

export async function runCli(argv = process.argv.slice(2), options = {}) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(error.message);
    printUsage();
    return 2;
  }
  if (args.help) {
    printUsage();
    return 0;
  }

  const envPath = resolve(ROOT, args.envFile);
  if (!existsSync(envPath)) {
    console.error(`Missing ${envPath}. Copy .env.testnet.example to .env.testnet and fill it in.`);
    return 2;
  }

  const env = loadTestnetEnv({ envFile: args.envFile });
  const report = validateTestnetConfig(env, {
    mode: args.live ? "verify" : "preflight",
    envFile: args.envFile,
  });
  report.configOnly = args.configOnly;
  if (existsSync(resolve(ROOT, ".env.local"))) {
    addCheck(
      report,
      "error",
      "LOCAL_ENV_OVERRIDE",
      ".env.local exists; the services refuse it in production/testnet. Remove it from the host before deploying.",
    );
  }

  if (!args.configOnly && report.counts.error === 0) {
    await checkChain(env, report, { fetchImpl: options.fetchImpl });
    if (args.live && report.counts.error === 0) {
      await checkServices(env, report, { fetchImpl: options.fetchImpl });
    }
  }

  if (args.json) console.log(JSON.stringify(reportAsJson(report), null, 2));
  else printReport(report);
  return report.counts.error === 0 ? 0 : 1;
}

if (isMain) {
  runCli()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`Testnet check failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 2;
    });
}
