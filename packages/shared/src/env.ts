/**
 * Shared server-side environment loader for PoolGuard.
 *
 * Precedence: process environment > explicit overlay > .env.testnet > .env.
 * `.env.local` is a local-sandbox convenience and is refused in production or
 * testnet mode, so a copied sandbox file can never override a deployment.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { parse as parseDotenv } from "dotenv";

export class EnvConfigurationError extends Error {
  override name = "EnvConfigurationError";
}

export interface EnvPlan {
  root: string;
  files: string[];
  skippedLocal: string | null;
  mode: {
    nodeEnv: string;
    network: string;
    productionLike: boolean;
  };
}

export interface LoadRootEnvOptions {
  root?: string;
  environ?: NodeJS.ProcessEnv;
}

/**
 * Walk up from a package directory to the pnpm workspace root. Deployments that
 * copy only build output should set the working directory or POOLGUARD_ENV_FILE
 * explicitly.
 */
export function findRepoRoot(start = process.cwd()): string {
  const origin = resolve(start);
  let dir = origin;
  while (true) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return origin;
    dir = parent;
  }
}

function readValues(path: string): Record<string, string> {
  return parseDotenv(readFileSync(path, "utf8"));
}

function mergeValues(files: readonly string[]): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const file of files) Object.assign(merged, readValues(file));
  return merged;
}

/**
 * Resolve which files will be loaded without mutating the environment. Exposed
 * for the preflight diagnostics and unit tests.
 */
export function resolveEnvPlan(options: LoadRootEnvOptions = {}): EnvPlan {
  const root = options.root ? resolve(options.root) : findRepoRoot();
  const environ = options.environ ?? process.env;

  const base = resolve(root, ".env");
  const testnet = resolve(root, ".env.testnet");
  const local = resolve(root, ".env.local");
  const explicitRaw = String(environ.POOLGUARD_ENV_FILE ?? "").trim();
  const explicit = explicitRaw
    ? isAbsolute(explicitRaw)
      ? explicitRaw
      : resolve(root, explicitRaw)
    : null;

  if (explicit && !existsSync(explicit)) {
    throw new EnvConfigurationError(
      `POOLGUARD_ENV_FILE points at ${explicit}, which does not exist.`,
    );
  }

  // Determine mode without letting .env.local mask a production/testnet overlay.
  const modeFiles: string[] = [];
  if (existsSync(base)) modeFiles.push(base);
  if (explicit) {
    if (resolve(explicit) !== local) modeFiles.push(explicit);
  } else if (existsSync(testnet)) {
    modeFiles.push(testnet);
  }
  const modeValues = mergeValues(modeFiles);
  const nodeEnv = String(environ.NODE_ENV ?? modeValues.NODE_ENV ?? "").trim();
  const network = String(environ.NEAR_NETWORK ?? modeValues.NEAR_NETWORK ?? "").trim();
  const productionLike = nodeEnv === "production" || network === "testnet";

  if (productionLike && explicit && resolve(explicit) === local) {
    throw new EnvConfigurationError(
      "POOLGUARD_ENV_FILE must not point at .env.local in production or testnet mode.",
    );
  }

  const files: string[] = [];
  if (existsSync(base)) files.push(base);
  if (explicit) {
    files.push(explicit);
  } else if (existsSync(testnet)) {
    files.push(testnet);
  }

  let skippedLocal: string | null = null;
  if (existsSync(local)) {
    if (productionLike) skippedLocal = local;
    else files.push(local);
  }

  // An explicit local file in development is already in `files`; avoid duplicates.
  const uniqueFiles = [...new Set(files)];
  return {
    root,
    files: uniqueFiles,
    skippedLocal,
    mode: { nodeEnv, network, productionLike },
  };
}

/**
 * Load the repository environment into `environ` (process.env by default).
 * File values never replace variables already present in the process
 * environment, which is how a secret manager or hosting shell should inject
 * deployment values.
 */
export function loadRootEnv(options: LoadRootEnvOptions = {}): string {
  const environ = options.environ ?? process.env;
  const plan = resolveEnvPlan({ root: options.root, environ });
  if (plan.skippedLocal) {
    throw new EnvConfigurationError(
      `Refusing to load ${plan.skippedLocal} in ${plan.mode.network === "testnet" ? "testnet" : "production"} mode. ` +
        "Remove the sandbox file from the deployment, or set POOLGUARD_ENV_FILE to an explicit server environment file.",
    );
  }

  const merged = mergeValues(plan.files);
  const preexisting = new Set(Object.keys(environ));
  for (const [key, value] of Object.entries(merged)) {
    if (!preexisting.has(key)) environ[key] = value;
  }
  return plan.root;
}
