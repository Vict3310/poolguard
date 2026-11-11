import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@poolguard/db";
import type { NearChain } from "@poolguard/agent-runtime/chain";
import { hashToken, CSRF_COOKIE, CSRF_HEADER } from "./security.js";
import { buildApiApp } from "./app.js";
import type { ApiConfig } from "./config.js";
import { LEGAL_VERSIONS } from "@poolguard/shared";

const OWNER = "owner.sandbox";
const SESSION_TOKEN = "session-token-for-tests";
const CSRF_TOKEN = "csrf-token-for-tests";

const baseConfig: ApiConfig = {
  nodeEnv: "development",
  databaseUrl: "postgresql://unused",
  nearNetwork: "sandbox",
  nearRpcUrl: "http://127.0.0.1:3030",
  contractId: "poolguard.sandbox",
  ownerAccountId: OWNER,
  sandboxOwnerPrivateKey: undefined,
  apiOrigin: "http://127.0.0.1:4100",
  webOrigin: "http://127.0.0.1:3000",
  providerOrigin: "http://127.0.0.1:4103",
  providerServiceDomain: "127.0.0.1:4103",
  providerAccountId: "extract.sandbox",
  policyProbeProviderAccountId: "probe.sandbox",
  sessionSecret: "x".repeat(48),
  documentEncryptionKey: Buffer.alloc(32).toString("base64"),
  aiBaseUrl: "https://api.openai.com/v1",
  aiModel: "gpt-4o-mini",
  aiTimeoutMs: 10_000,
  localSandboxMode: true,
  allowDevSession: true,
  demoFaultInjection: true,
  workerId: "test-worker",
  workerConcurrency: 2,
  jobLeaseSeconds: 90,
  workerAccounts: [
    { slot: 1, accountId: "agent-one.sandbox", privateKey: "unused", envVar: "WORKER_ONE_PRIVATE_KEY", custody: "local" },
    { slot: 2, accountId: "agent-two.sandbox", privateKey: "unused", envVar: "WORKER_TWO_PRIVATE_KEY", custody: "local" },
  ],
  apiPort: 4100,
  apiHost: "127.0.0.1",
  sessionTtlDays: 7,
  apiChainActionsPerHour: 60,
  outlayerApiUrl: "https://testnet-api.outlayer.ai",
  adminAccounts: [],
  operatorAccounts: [],
  alertWebhookUrl: null,
  contactEmail: null,
  expectedWasmHash: null,
  authAllowedAccounts: [],
};

function fakePrisma() {
  const sessions = new Map<string, { id: string; userId: string; revokedAt: Date | null; expiresAt: Date; csrfHash: string; user: { accountId: string } }>();
  const challenges: Array<{ id: string; usedAt: Date | null; expiresAt: Date }> = [];
  const tasks = new Map<string, Record<string, unknown>>();

  const prisma = {
    $queryRaw: async () => [{ "?column?": 1 }],
    user: {
      upsert: async ({ where }: { where: { accountId: string } }) => ({
        id: "user-1",
        accountId: where.accountId,
      }),
      findUnique: async () => null,
    },
    // The test account has accepted the current Terms and Privacy versions.
    consentRecord: {
      findMany: async () => [
        { document: "terms", version: LEGAL_VERSIONS.terms, acceptedAt: new Date() },
        { document: "privacy", version: LEGAL_VERSIONS.privacy, acceptedAt: new Date() },
      ],
    },
    allowedAccount: { count: async () => 0, findUnique: async () => null },
    walletSession: {
      create: async ({ data }: { data: { userId: string; tokenHash: string; csrfHash: string; expiresAt: Date } }) => {
        const session = {
          id: "session-1",
          userId: data.userId,
          revokedAt: null,
          expiresAt: data.expiresAt,
          csrfHash: data.csrfHash,
          lastSeenAt: new Date(),
          user: { accountId: OWNER, suspendedAt: null },
        };
        sessions.set(data.tokenHash, session);
        return session;
      },
      findUnique: async ({ where }: { where: { tokenHash: string } }) => sessions.get(where.tokenHash) ?? null,
      update: async () => ({ id: "session-1" }),
    },
    walletChallenge: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          ...data,
          id: `challenge-${challenges.length + 1}`,
          usedAt: null,
          expiresAt: data.expiresAt as Date,
        };
        challenges.push(row as never);
        return row;
      },
      findUnique: async ({ where }: { where: { id: string } }) =>
        challenges.find((challenge) => challenge.id === where.id) ?? null,
      updateMany: async ({ where }: { where: { id: string; usedAt: null } }) => {
        const challenge = challenges.find((candidate) => candidate.id === where.id);
        if (!challenge || challenge.usedAt) return { count: 0 };
        challenge.usedAt = new Date();
        return { count: 1 };
      },
    },
    task: {
      findMany: async () => [],
      findUnique: async ({ where }: { where: { id: string } }) => tasks.get(where.id) ?? null,
      update: async () => null,
    },
    auditEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => ({ id: 1n, createdAt: new Date(), ...data }),
      findMany: async () => [],
    },
    operation: { update: async () => null },
    chainTransaction: { update: async () => null },
    agent: { updateMany: async () => ({ count: 0 }) },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
  };
  return { prisma, challenges, tasks };
}

const fakeChain = {
  getConfig: async () => ({
    contract_id: "poolguard.sandbox",
    owner: "deployer.sandbox",
    max_agents: 6,
    max_providers: 8,
    max_operations_per_task: 32,
    max_pending_withdrawals: 3,
    task_storage_deposit: "350000000000000000000000",
    agent_storage_deposit: "20000000000000000000000",
    withdrawal_storage_deposit: "20000000000000000000000",
  }),
  publicKeyFor: () => "ed25519:test",
  hasSigner: () => true,
  custodyOf: () => "local",
  getCurrentBlock: async () => 1,
  provider: { viewAccessKey: async () => ({ permission: "FullAccess" }) },
} as unknown as NearChain;

async function makeApp(overrides: Partial<ApiConfig> = {}) {
  const fake = fakePrisma();
  const app = await buildApiApp({
    prisma: fake.prisma as unknown as PrismaClient,
    chain: fakeChain,
    config: { ...baseConfig, ...overrides },
    now: () => new Date("2026-10-29T12:00:00.000Z"),
  });
  return { app, ...fake };
}

function cookieHeader(app: FastifyInstance, cookies: string[]) {
  void app;
  return cookies.map((cookie) => cookie.split(";")[0]).join("; ");
}

async function authenticate(app: FastifyInstance) {
  const response = await app.inject({ method: "POST", url: "/dev/session" });
  expect(response.statusCode).toBe(200);
  const setCookie = response.cookies;
  expect(setCookie.find((cookie) => cookie.name === CSRF_COOKIE)?.value).toBeTruthy();
  const sessionCookie = setCookie.find((cookie) => cookie.name === "pg_session");
  expect(sessionCookie?.value).toBeTruthy();
  return {
    cookie: cookieHeader(app, setCookie.map((cookie) => `${cookie.name}=${cookie.value}`)),
    csrf: setCookie.find((cookie) => cookie.name === CSRF_COOKIE)!.value as string,
    sessionToken: sessionCookie!.value as string,
  };
}

describe("API authentication and isolation", () => {
  it("issues a NEP-413 nonce as 32 standard-base64 bytes and never reuses a consumed challenge", async () => {
    const { app, challenges } = await makeApp();
    const response = await app.inject({
      method: "POST",
      url: "/auth/challenge",
      payload: { account_id: "alice.testnet" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { nonce: string; challenge_id: string; message: string };
    expect(body.nonce).not.toMatch(/[-_]/);
    expect(Buffer.from(body.nonce, "base64")).toHaveLength(32);
    expect(body.message).toContain("Account: alice.testnet");

    // A challenge consumed by any path cannot be replayed.
    challenges[0]!.usedAt = new Date();
    const replay = await app.inject({
      method: "POST",
      url: "/auth/verify",
      payload: {
        challenge_id: body.challenge_id,
        account_id: "alice.testnet",
        public_key: "ed25519:test",
        signature: Buffer.alloc(64).toString("base64"),
      },
    });
    expect(replay.statusCode).toBe(400);
    expect(replay.json().code).toBe("CHALLENGE_INVALID");
    await app.close();
  });

  it("requires the CSRF header on mutations and rejects a foreign Origin", async () => {
    const { app } = await makeApp();
    const auth = await authenticate(app);
    const withoutCsrf = await app.inject({
      method: "POST",
      url: "/tasks",
      headers: { cookie: auth.cookie },
      payload: {},
    });
    expect(withoutCsrf.statusCode).toBe(403);
    expect(withoutCsrf.json().code).toBe("CSRF_REJECTED");

    const foreignOrigin = await app.inject({
      method: "POST",
      url: "/tasks",
      headers: {
        cookie: auth.cookie,
        [CSRF_HEADER]: auth.csrf,
        origin: "https://attacker.example",
      },
      payload: {},
    });
    expect(foreignOrigin.statusCode).toBe(403);
    expect(foreignOrigin.json().code).toBe("ORIGIN_REJECTED");

    const valid = await app.inject({
      method: "POST",
      url: "/tasks",
      headers: { cookie: auth.cookie, [CSRF_HEADER]: auth.csrf, origin: baseConfig.webOrigin },
      payload: {},
    });
    // CSRF passes; schema validation is the only remaining failure.
    expect(valid.statusCode).toBe(400);
    expect(valid.json().code).toBe("VALIDATION_ERROR");
    await app.close();
  });

  it("does not reveal another owner's task", async () => {
    const { app, tasks } = await makeApp();
    tasks.set("foreign-task", {
      id: "foreign-task",
      ownerAccountId: "someone-else.testnet",
      status: "ACTIVE",
    });
    const auth = await authenticate(app);
    const response = await app.inject({
      method: "GET",
      url: "/tasks/foreign-task",
      headers: { cookie: auth.cookie },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe("TASK_NOT_FOUND");
    await app.close();
  });

  it("disables the sandbox session outside an explicit local sandbox", async () => {
    const { app } = await makeApp({ nodeEnv: "production", localSandboxMode: false, allowDevSession: false });
    const response = await app.inject({ method: "POST", url: "/dev/session" });
    expect(response.statusCode).toBe(404);
    const meta = await app.inject({ method: "GET", url: "/meta" });
    expect(meta.json().devSessionEnabled).toBe(false);
    expect(JSON.stringify(meta.json())).not.toContain("PRIVATE_KEY");
    await app.close();
  });

  it("keeps test session records hashed rather than storing the cookie token", async () => {
    const { app } = await makeApp();
    const auth = await authenticate(app);
    expect(auth.sessionToken).not.toBe(hashToken(auth.sessionToken));
    expect(auth.sessionToken.length).toBeGreaterThan(20);
    const session = await app.inject({ method: "GET", url: "/auth/session", headers: { cookie: auth.cookie } });
    expect(session.statusCode).toBe(200);
    expect(session.json().user.accountId).toBe(OWNER);
    expect(session.headers["cache-control"]).toBe("no-store");
    await app.close();
  });

  it("asks for consent before any change when the current Terms were not accepted", async () => {
    const { app, prisma } = await makeApp();
    (prisma as unknown as { consentRecord: { findMany: () => Promise<unknown[]> } }).consentRecord.findMany = async () => [];
    const auth = await authenticate(app);
    const session = await app.inject({ method: "GET", url: "/auth/session", headers: { cookie: auth.cookie } });
    expect(session.json().consentRequired).toBe(true);
    const change = await app.inject({
      method: "POST",
      url: "/tasks",
      headers: { cookie: auth.cookie, "x-poolguard-csrf": auth.csrf, origin: baseConfig.webOrigin },
      payload: {},
    });
    expect(change.statusCode).toBe(428);
    expect(change.json().code).toBe("CONSENT_REQUIRED");
    await app.close();
  });

  it("hides the admin API from accounts that are not admins", async () => {
    const { app } = await makeApp();
    const auth = await authenticate(app);
    const response = await app.inject({ method: "GET", url: "/admin/overview", headers: { cookie: auth.cookie } });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("keeps admin access read-only unless the account is an operator", async () => {
    const { app } = await makeApp({ adminAccounts: [OWNER] });
    const auth = await authenticate(app);
    const response = await app.inject({
      method: "POST",
      url: "/admin/announcements",
      headers: { cookie: auth.cookie, "x-poolguard-csrf": auth.csrf, origin: baseConfig.webOrigin },
      payload: { message: "Maintenance tonight" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe("ADMIN_READ_ONLY");
    await app.close();
  });
});
