#!/usr/bin/env node
/**
 * One-command local development stack.
 *
 * Starts embedded PostgreSQL when needed, provisions or reuses a NEAR sandbox,
 * applies migrations and seed data, then runs API, worker, provider and web.
 *
 * This is intentionally the only long-running orchestration script. It never
 * prints private keys, never touches mainnet, and never continues with a
 * half-configured stack: a failed prerequisite is reported and the process exits
 * non-zero instead of silently falling back to mocks.
 */
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createConnection } from "node:net";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseDotenv } from "dotenv";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = resolve(ROOT, ".data");
const STATE_PATH = resolve(DATA_DIR, "dev-stack.json");
const LOG_DIR = resolve(DATA_DIR, "logs");

mkdirSync(LOG_DIR, { recursive: true });

const children = [];
let sandbox = null;
let shuttingDown = false;

function log(message) {
  console.log(`[dev] ${message}`);
}

function fail(message) {
  console.error(`[dev] ${message}`);
  process.exitCode = 1;
}

function readEnvFile(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    Object.entries(parseDotenv(readFileSync(path))).filter(([, value]) => value !== undefined),
  );
}

/**
 * Build .env from the template when absent. Generated secrets stay on disk and
 * are never echoed. This makes a fresh checkout runnable without a manual
 * copy-paste step, while an existing .env is never overwritten.
 */
function ensureBaseEnv() {
  const path = resolve(ROOT, ".env");
  if (existsSync(path)) return;
  const template = readFileSync(resolve(ROOT, ".env.example"), "utf8");
  const sessionSecret = randomBytes(48).toString("base64url");
  const documentKey = randomBytes(32).toString("base64");
  const generated = template
    .replace(/^SESSION_SECRET=.*$/m, `SESSION_SECRET=${sessionSecret}`)
    .replace(/^DOCUMENT_ENCRYPTION_KEY=.*$/m, `DOCUMENT_ENCRYPTION_KEY=${documentKey}`);
  writeFileSync(path, generated, { mode: 0o600 });
  log("created .env from .env.example (generated session/document keys; file is gitignored)");
}

function loadEnv() {
  return {
    ...readEnvFile(resolve(ROOT, ".env")),
    ...readEnvFile(resolve(ROOT, ".env.local")),
    ...process.env,
  };
}

function tcpOpen(host, port, timeoutMs = 800) {
  return new Promise((resolvePromise) => {
    const socket = createConnection({ host, port });
    const finish = (open) => {
      socket.destroy();
      resolvePromise(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function waitFor(description, predicate, { timeoutMs = 120_000, intervalMs = 500 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function rpcReady(rpcUrl) {
  if (!rpcUrl) return false;
  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "dev-stack", method: "status", params: [] }),
      signal: AbortSignal.timeout(2_500),
    });
    if (!response.ok) return false;
    const body = await response.json();
    return Boolean(body.result ?? body.error);
  } catch {
    return false;
  }
}

function run(command, args, env, label) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env,
    stdio: "pipe",
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
    throw new Error(`${label} failed (${result.status})\n${output.slice(-4_000)}`);
  }
  if (label === "seed") log("database seeded with the fixed-price provider catalog");
}

async function startPostgres(env) {
  const url = new URL(env.DATABASE_URL);
  const host = url.hostname;
  const port = Number(url.port || 5432);
  if (await tcpOpen(host, port)) {
    log(`reusing PostgreSQL at ${host}:${port}`);
    return null;
  }
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`PostgreSQL at ${host}:${port} is unreachable; start it or fix DATABASE_URL`);
  }
  log(`starting embedded PostgreSQL on ${host}:${port}`);
  const child = spawn(process.execPath, ["scripts/local-postgres.mjs"], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push({ child, name: "postgres", external: false });
  pipeLogs(child, "postgres");
  await waitFor(`PostgreSQL on ${host}:${port}`, () => tcpOpen(host, port), { timeoutMs: 90_000 });
  return child;
}

function pipeLogs(child, name) {
  const prefix = (line) => (line ? `[${name}] ${line}\n` : "");
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk) => process.stdout.write(prefix(chunk.trimEnd())));
  child.stderr?.on("data", (chunk) => process.stderr.write(prefix(chunk.trimEnd())));
}

async function ensureSandbox(env) {
  const local = readEnvFile(resolve(ROOT, ".env.local"));
  const rpcUrl = local.NEAR_RPC_URL || env.NEAR_RPC_URL;
  if (local.NEAR_NETWORK === "sandbox" && (await rpcReady(rpcUrl))) {
    log(`reusing NEAR sandbox at ${rpcUrl}`);
    return { reused: true, env: { ...env, ...local } };
  }

  if (env.NEAR_NETWORK === "testnet") {
    throw new Error(
      "NEAR_NETWORK=testnet is configured but no local sandbox exists. " +
        "Set the testnet contract/worker variables explicitly or unset NEAR_NETWORK.",
    );
  }

  log("provisioning a fresh NEAR sandbox and deploying PoolGuard (first run downloads the node)…");
  const { provisionSandbox, sandboxEnv, writeEnvLocal } = await import("./sandbox-lib.mjs");
  sandbox = await provisionSandbox({
    log: (message) => log(message),
  });
  const generated = sandboxEnv(sandbox);
  const path = writeEnvLocal(generated);
  log(`wrote ${path} (ephemeral sandbox keys; gitignored)`);
  const merged = { ...env, ...generated };

  // A fresh sandbox invalidates every account and task projection. Reset the
  // local database so stale rows cannot masquerade as live chain state.
  run("pnpm", ["--filter", "@poolguard/db", "db:reset"], merged, "database reset");
  return { reused: false, env: merged };
}

function startService(env, name, filter, extraArgs = []) {
  const child = spawn("pnpm", ["--filter", filter, "dev", ...extraArgs], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });
  children.push({ child, name, external: false });
  pipeLogs(child, name);
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    if (code !== 0) {
      console.error(`[dev] ${name} exited with ${code ?? signal}`);
      process.exitCode = 1;
      void shutdown("service-exit");
    }
  });
  return child;
}

async function httpReady(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`stopping (${reason})…`);
  for (const { child, name, external } of children.slice().reverse()) {
    if (external) continue;
    try {
      child.kill("SIGTERM");
      log(`stopped ${name}`);
    } catch {
      /* already gone */
    }
  }
  if (sandbox) {
    await sandbox.tearDown().catch(() => undefined);
    log("stopped NEAR sandbox");
  }
  process.exit(process.exitCode ?? 0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  ensureBaseEnv();
  let env = loadEnv();
  if (!env.SESSION_SECRET || env.SESSION_SECRET === "CHANGEME") {
    throw new Error("SESSION_SECRET is missing. Set it in .env (see .env.example).");
  }
  if (!env.DOCUMENT_ENCRYPTION_KEY || env.DOCUMENT_ENCRYPTION_KEY === "CHANGEME") {
    throw new Error("DOCUMENT_ENCRYPTION_KEY is missing. Set it in .env (see .env.example).");
  }

  await startPostgres(env);
  const sandboxState = await ensureSandbox(env);
  env = sandboxState.env;
  if (process.env.NEAR_NETWORK && process.env.NEAR_NETWORK !== "sandbox" && !sandboxState.reused) {
    throw new Error("Refusing to mix a local sandbox with a non-sandbox NEAR_NETWORK.");
  }

  log("applying migrations…");
  run("pnpm", ["--filter", "@poolguard/api", "db:generate"], env, "prisma generate");
  run("pnpm", ["--filter", "@poolguard/api", "db:migrate"], env, "migrate");
  run("pnpm", ["--filter", "@poolguard/api", "db:seed"], env, "seed");

  startService(env, "api", "@poolguard/api");
  startService(env, "provider", "@poolguard/provider");
  startService(env, "worker", "@poolguard/worker");
  startService(env, "web", "@poolguard/web");

  await waitFor("API /health", () => httpReady("http://127.0.0.1:4100/health"));
  await waitFor("provider /health", () => httpReady("http://127.0.0.1:4103/health"));
  await waitFor("web", () => httpReady("http://127.0.0.1:3000/"));

  writeFileSync(
    STATE_PATH,
    JSON.stringify(
      {
        startedAt: new Date().toISOString(),
        network: env.NEAR_NETWORK,
        contractId: env.POOLGUARD_CONTRACT_ID,
        sandboxReused: sandboxState.reused,
        urls: {
          web: "http://127.0.0.1:3000",
          api: "http://127.0.0.1:4100",
          provider: "http://127.0.0.1:4103",
        },
      },
      null,
      2,
    ),
  );

  log("ready");
  log("web      http://127.0.0.1:3000");
  log("api      http://127.0.0.1:4100");
  log("provider http://127.0.0.1:4103");
  log("Press Ctrl-C to stop the app processes. A reused sandbox is left running.");
  await new Promise(() => {});
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
  await shutdown("startup-failed");
}
