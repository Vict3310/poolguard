import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { KeyPair } from "near-api-js";
import {
  WORKER_METHODS,
  checkChain,
  checkServices,
  inspectWorkerAccessKey,
  isTestnetAccount,
  validateTestnetConfig,
} from "./testnet-check.mjs";

function validEnv(overrides = {}) {
  return {
    NODE_ENV: "production",
    NEAR_NETWORK: "testnet",
    NEAR_RPC_URL: "https://rpc.testnet.near.org",
    POOLGUARD_CONTRACT_ID: "poolguard.testnet",
    OWNER_ACCOUNT_ID: "owner.testnet",
    PROVIDER_ACCOUNT_ID: "extract.testnet",
    PROVIDER_ORIGIN: "https://provider.example.com",
    PROVIDER_SERVICE_DOMAIN: "provider.example.com",
    API_ORIGIN: "https://api.example.com",
    WEB_ORIGIN: "https://app.example.com",
    DATABASE_URL:
      "postgresql://poolguard:strong-password@db.example.com:5432/poolguard?sslmode=require",
    SESSION_SECRET: "a".repeat(48),
    DOCUMENT_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    WORKER_ONE_ACCOUNT_ID: "agent-one.testnet",
    WORKER_ONE_PRIVATE_KEY: KeyPair.fromRandom("ed25519").toString(),
    WORKER_TWO_ACCOUNT_ID: "agent-two.testnet",
    WORKER_TWO_PRIVATE_KEY: KeyPair.fromRandom("ed25519").toString(),
    POLICY_PROBE_PROVIDER_ACCOUNT_ID: "policy-probe.testnet",
    NEXT_PUBLIC_POOLGUARD_CONTRACT_ID: "poolguard.testnet",
    LOCAL_SANDBOX_MODE: "false",
    ALLOW_DEV_SESSION: "false",
    FAULT_INJECTION_ENABLED: "false",
    WORKER_ID: "worker-testnet-1",
    ...overrides,
  };
}

test("a production-shaped testnet environment passes static validation", () => {
  const report = validateTestnetConfig(validEnv());
  assert.equal(report.counts.error, 0, JSON.stringify(report.checks, null, 2));
  assert.equal(report.derivedWorkerKeys.length, 2);
  assert.ok(report.derivedWorkerKeys.every((worker) => worker.publicKey.startsWith("ed25519:")));
});

test("sandbox-only switches are rejected", () => {
  const report = validateTestnetConfig(
    validEnv({
      LOCAL_SANDBOX_MODE: "true",
      ALLOW_DEV_SESSION: "true",
      FAULT_INJECTION_ENABLED: "true",
      SANDBOX_OWNER_PRIVATE_KEY: "ed25519:not-used",
    }),
  );
  assert.equal(report.counts.error, 4);
  assert.ok(report.checks.some((check) => check.code === "LOCAL_SANDBOX_MODE_NOT_FALSE"));
  assert.ok(report.checks.some((check) => check.code === "ALLOW_DEV_SESSION_NOT_FALSE"));
  assert.ok(report.checks.some((check) => check.code === "FAULT_INJECTION_ENABLED_NOT_FALSE"));
  assert.ok(report.checks.some((check) => check.code === "SANDBOX_SECRET_SANDBOX_OWNER_PRIVATE_KEY"));
});

test("mainnet RPC, mainnet network and non-testnet accounts are rejected", () => {
  const report = validateTestnetConfig(
    validEnv({
      NEAR_NETWORK: "mainnet",
      NEAR_RPC_URL: "https://rpc.mainnet.near.org",
      POOLGUARD_CONTRACT_ID: "poolguard.near",
    }),
  );
  assert.ok(report.checks.some((check) => check.code === "NOT_TESTNET_NETWORK"));
  assert.ok(report.checks.some((check) => check.code === "MAINNET_NEAR_RPC_URL"));
  assert.ok(report.checks.some((check) => check.code === "NOT_TESTNET_POOLGUARD_CONTRACT_ID"));
});

test("placeholder worker keys and duplicate roles fail closed", () => {
  const report = validateTestnetConfig(
    validEnv({
      WORKER_ONE_PRIVATE_KEY: "REPLACE_WITH_RESTRICTED_KEY",
      PROVIDER_ACCOUNT_ID: "owner.testnet",
    }),
  );
  assert.ok(report.checks.some((check) => check.code === "PLACEHOLDER_WORKER_ONE_PRIVATE_KEY"));
  assert.ok(report.checks.some((check) => check.code === "DUPLICATE_ACCOUNT_PROVIDER_ACCOUNT_ID"));
  assert.equal(report.derivedWorkerKeys.length, 1);
});

test("provider NEP-413 domain must match the provider origin host", () => {
  const report = validateTestnetConfig(validEnv({ PROVIDER_SERVICE_DOMAIN: "other.example.com" }));
  assert.ok(report.checks.some((check) => check.code === "PROVIDER_DOMAIN_MISMATCH"));
});

test("document encryption key must be exactly 32 bytes of base64", () => {
  const report = validateTestnetConfig(
    validEnv({ DOCUMENT_ENCRYPTION_KEY: Buffer.alloc(16, 1).toString("base64") }),
  );
  assert.ok(report.checks.some((check) => check.code === "DOCUMENT_KEY_LENGTH"));
});

test("a correctly scoped worker access key passes", () => {
  const outcome = inspectWorkerAccessKey(
    {
      FunctionCall: {
        receiver_id: "poolguard.testnet",
        method_names: [...WORKER_METHODS],
        allowance: "250000000000000000000000",
      },
    },
    "poolguard.testnet",
  );
  assert.deepEqual(outcome.errors, []);
  assert.deepEqual(outcome.warnings, []);
});

test("a full-access worker key, extra methods and unlimited allowance fail", () => {
  const fullAccess = inspectWorkerAccessKey({ FullAccess: {} }, "poolguard.testnet");
  assert.ok(fullAccess.errors[0].includes("full-access"));

  const extra = inspectWorkerAccessKey(
    {
      FunctionCall: {
        receiver_id: "poolguard.testnet",
        method_names: [...WORKER_METHODS, "pause_task"],
        allowance: "250000000000000000000000",
      },
    },
    "poolguard.testnet",
  );
  assert.ok(extra.errors.some((message) => message.includes("extra methods")));

  const unlimited = inspectWorkerAccessKey(
    {
      FunctionCall: {
        receiver_id: "poolguard.testnet",
        method_names: [...WORKER_METHODS],
        allowance: null,
      },
    },
    "poolguard.testnet",
  );
  assert.ok(unlimited.errors.some((message) => message.includes("unlimited")));
});

test("a key scoped to another contract or missing methods fails", () => {
  const wrongContract = inspectWorkerAccessKey(
    {
      FunctionCall: {
        receiver_id: "other.testnet",
        method_names: [...WORKER_METHODS],
        allowance: "250000000000000000000000",
      },
    },
    "poolguard.testnet",
  );
  assert.ok(wrongContract.errors.some((message) => message.includes("scoped to")));

  const missing = inspectWorkerAccessKey(
    {
      FunctionCall: {
        receiver_id: "poolguard.testnet",
        method_names: ["reserve"],
        allowance: "250000000000000000000000",
      },
    },
    "poolguard.testnet",
  );
  assert.ok(missing.errors.some((message) => message.includes("missing required methods")));
});

function fakeServiceFetch(metaOverrides = {}, options = {}) {
  const derived = validateTestnetConfig(validEnv()).derivedWorkerKeys;
  const apiOrigin = "https://api.example.com";
  const webOrigin = "https://app.example.com";
  const providerOrigin = "https://provider.example.com";
  const devSessionStatus = options.devSessionStatus ?? 404;
  const catalogProviderAccountId = options.catalogProviderAccountId ?? "extract.testnet";
  const meta = {
    network: "testnet",
    contractId: "poolguard.testnet",
    sandbox: false,
    devSessionEnabled: false,
    secureCookies: true,
    testTokens: true,
    apiOrigin,
    webOrigin,
    workerAccounts: derived.map((worker) => ({
      slot: worker.slot,
      accountId: worker.accountId,
      publicKey: worker.publicKey,
      keyConfigured: true,
    })),
    aiConfigured: false,
    policyProbeConfigured: true,
    chainConfig: { network: "testnet" },
    ...metaOverrides,
  };
  const responses = new Map([
    [`${apiOrigin}/health`, { status: 200, body: { status: "ok" } }],
    [`${apiOrigin}/ready`, { status: 200, body: { status: "ready" } }],
    [`${apiOrigin}/meta`, { status: 200, body: meta }],
    [`${providerOrigin}/health`, { status: 200, body: { status: "ok" } }],
    [`${providerOrigin}/ready`, { status: 200, body: { status: "ready" } }],
    [
      `${providerOrigin}/catalog`,
      {
        status: 200,
        body: {
          provider_account_id: catalogProviderAccountId,
          services: [{ service_key: "extract-basic" }],
        },
      },
    ],
    [`${webOrigin}/`, { status: 200, body: "<html><title>PoolGuard</title></html>" }],
    [`${webOrigin}/app`, { status: 200, body: "<html>PoolGuard workspace</html>" }],
  ]);
  return async (url, init = {}) => {
    if (url === `${apiOrigin}/dev/session`) {
      const status = init.method === "POST" ? devSessionStatus : 405;
      const body = status === 200 ? { ok: true } : { error: "Not found" };
      return { ok: status === 200, status, url, text: async () => JSON.stringify(body) };
    }
    const response = responses.get(url);
    if (!response) throw new Error(`unexpected URL ${url}`);
    return {
      ok: response.status === 200,
      status: response.status,
      url,
      text: async () => (typeof response.body === "string" ? response.body : JSON.stringify(response.body)),
    };
  };
}

test("live verification rejects sandbox/dev-session metadata", async () => {
  const env = validEnv();
  const report = validateTestnetConfig(env);
  await checkServices(env, report, {
    fetchImpl: fakeServiceFetch({ sandbox: true, devSessionEnabled: true }),
  });
  assert.ok(report.checks.some((check) => check.code === "META_NO_SANDBOX" && check.level === "error"));
  assert.ok(report.checks.some((check) => check.code === "META_NO_DEV_SESSION" && check.level === "error"));
});

test("live verification rejects an exposed dev session and provider catalog mismatch", async () => {
  const env = validEnv();
  const report = validateTestnetConfig(env);
  await checkServices(env, report, {
    fetchImpl: fakeServiceFetch(
      {},
      { devSessionStatus: 200, catalogProviderAccountId: "other.testnet" },
    ),
  });
  assert.ok(report.checks.some((check) => check.code === "DEV_SESSION_EXPOSED" && check.level === "error"));
  assert.ok(report.checks.some((check) => check.code === "PROVIDER_CATALOG_ACCOUNT" && check.level === "error"));
});

test("chain verification refuses to continue on a non-testnet chain ID", async () => {
  const env = validEnv();
  const report = validateTestnetConfig(env);
  const fakeFetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ result: { chain_id: "mainnet", latest_block_height: 1 } }),
  });
  await checkChain(env, report, { fetchImpl: fakeFetch });
  assert.ok(report.checks.some((check) => check.code === "RPC_NOT_TESTNET"));
  assert.equal(report.chainChecked, true);
});

function fakeChainFetch({ codeBase64 } = {}) {
  const localWasm = readFileSync(new URL("../contracts/poolguard/res/poolguard.wasm", import.meta.url));
  const code = codeBase64 ?? localWasm.toString("base64");
  const config = {
    contract_id: "poolguard.testnet",
    owner: "poolguard.testnet",
    task_storage_deposit: "350000000000000000000000",
    agent_storage_deposit: "20000000000000000000000",
    withdrawal_storage_deposit: "20000000000000000000000",
  };
  return async (_url, init = {}) => {
    const { method, params } = JSON.parse(init.body);
    let result;
    if (method === "status") {
      result = { chain_id: "testnet", latest_block_height: 1 };
    } else if (method === "query") {
      switch (params.request_type) {
        case "view_account":
          result = {
            amount: "1000000000000000000000000",
            code_hash: "A".repeat(44),
          };
          break;
        case "view_code":
          result = { code_base64: code };
          break;
        case "call_function":
          result = { result: Array.from(Buffer.from(JSON.stringify(config))) };
          break;
        case "view_access_key":
          result = {
            permission: {
              FunctionCall: {
                receiver_id: "poolguard.testnet",
                method_names: [...WORKER_METHODS],
                allowance: "250000000000000000000000",
              },
            },
          };
          break;
        case "view_access_key_list":
          result = {
            keys: [
              {
                public_key: "ed25519:full",
                access_key: { permission: { FullAccess: {} } },
              },
            ],
          };
          break;
        default:
          throw new Error(`unexpected query ${params.request_type}`);
      }
    } else {
      throw new Error(`unexpected method ${method}`);
    }
    return { ok: true, status: 200, text: async () => JSON.stringify({ result }) };
  };
}

test("chain verification catches a remaining full-access key and a WASM mismatch", async () => {
  const env = validEnv();
  const report = validateTestnetConfig(env);
  await checkChain(env, report, {
    fetchImpl: fakeChainFetch({ codeBase64: Buffer.alloc(256, 1).toString("base64") }),
  });
  assert.ok(
    report.checks.some((check) => check.code === "WORKER_1_FULL_ACCESS_KEY" && check.level === "error"),
  );
  assert.ok(
    report.checks.some((check) => check.code === "CONTRACT_WASM_MISMATCH" && check.level === "error"),
    JSON.stringify(report.checks, null, 2),
  );
});

test("testnet account helper rejects mainnet-looking names", () => {
  assert.equal(isTestnetAccount("poolguard.testnet"), true);
  assert.equal(isTestnetAccount("poolguard.near"), false);
  assert.equal(isTestnetAccount("PoolGuard.testnet"), false);
  assert.equal(isTestnetAccount("a"), false);
});
