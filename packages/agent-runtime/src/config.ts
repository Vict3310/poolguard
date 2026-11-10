import { z } from "zod";

const booleanString = z
  .string()
  .optional()
  .transform((value) => value === "1" || value === "true");

export const serverConfigSchema = z.object({
  nodeEnv: z.string().default("development"),
  databaseUrl: z.string().min(1, "DATABASE_URL is required"),
  nearNetwork: z.enum(["sandbox", "testnet"]).default("testnet"),
  nearRpcUrl: z.string().url("NEAR_RPC_URL must be a URL"),
  contractId: z.string().min(2, "POOLGUARD_CONTRACT_ID is required"),
  ownerAccountId: z.string().min(2).optional(),
  sandboxOwnerPrivateKey: z.string().optional(),
  apiOrigin: z.string().url().default("http://127.0.0.1:4100"),
  webOrigin: z.string().url().default("http://127.0.0.1:3000"),
  providerOrigin: z.string().url().default("http://127.0.0.1:4103"),
  providerServiceDomain: z.string().min(1, "PROVIDER_SERVICE_DOMAIN is required"),
  providerAccountId: z.string().min(2, "PROVIDER_ACCOUNT_ID is required"),
  policyProbeProviderAccountId: z.string().min(2).optional(),
  sessionSecret: z.string().optional(),
  documentEncryptionKey: z.string().optional(),
  workerAccounts: z.array(
    z.object({
      slot: z.union([z.literal(1), z.literal(2)]),
      accountId: z.string().min(2),
      privateKey: z.string().min(1),
      envVar: z.string(),
    }),
  ),
  aiBaseUrl: z.string().url().default("https://api.openai.com/v1"),
  aiApiKey: z.string().optional(),
  aiModel: z.string().default("gpt-4o-mini"),
  aiTimeoutMs: z.coerce.number().int().positive().default(60_000),
  localSandboxMode: booleanString,
  allowDevSession: booleanString,
  demoFaultInjection: booleanString,
  workerId: z.string().default("worker-local"),
  workerConcurrency: z.coerce.number().int().min(1).max(8).default(2),
  jobLeaseSeconds: z.coerce.number().int().min(10).max(3600).default(90),
});

export type ServerConfig = z.infer<typeof serverConfigSchema>;

export class ConfigurationError extends Error {
  override name = "ConfigurationError";
}

export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const workerAccounts: Array<{
    slot: 1 | 2;
    accountId: string;
    privateKey: string;
    envVar: string;
  }> = [];

  for (const slot of [1, 2] as const) {
    const prefix = slot === 1 ? "WORKER_ONE" : "WORKER_TWO";
    const accountId = env[`${prefix}_ACCOUNT_ID`];
    const privateKey = env[`${prefix}_PRIVATE_KEY`];
    if (accountId && privateKey) {
      workerAccounts.push({
        slot,
        accountId,
        privateKey,
        envVar: `${prefix}_PRIVATE_KEY`,
      });
    }
  }

  const parsed = serverConfigSchema.safeParse({
    nodeEnv: env.NODE_ENV,
    databaseUrl: env.DATABASE_URL,
    nearNetwork: env.NEAR_NETWORK,
    nearRpcUrl: env.NEAR_RPC_URL,
    contractId: env.POOLGUARD_CONTRACT_ID,
    ownerAccountId: env.OWNER_ACCOUNT_ID || env.POOLGUARD_OWNER_ACCOUNT_ID || undefined,
    sandboxOwnerPrivateKey: env.SANDBOX_OWNER_PRIVATE_KEY || undefined,
    apiOrigin: env.API_ORIGIN,
    webOrigin: env.WEB_ORIGIN,
    providerOrigin: env.PROVIDER_ORIGIN,
    providerServiceDomain: env.PROVIDER_SERVICE_DOMAIN,
    providerAccountId: env.PROVIDER_ACCOUNT_ID,
    policyProbeProviderAccountId: env.POLICY_PROBE_PROVIDER_ACCOUNT_ID || undefined,
    sessionSecret: env.SESSION_SECRET || undefined,
    documentEncryptionKey: env.DOCUMENT_ENCRYPTION_KEY || undefined,
    workerAccounts,
    aiBaseUrl: env.AI_BASE_URL,
    aiApiKey: env.AI_API_KEY || undefined,
    aiModel: env.AI_MODEL,
    aiTimeoutMs: env.AI_TIMEOUT_MS,
    localSandboxMode: env.LOCAL_SANDBOX_MODE,
    allowDevSession: env.ALLOW_DEV_SESSION,
    demoFaultInjection: env.FAULT_INJECTION_ENABLED,
    workerId: env.WORKER_ID,
    workerConcurrency: env.WORKER_CONCURRENCY,
    jobLeaseSeconds: env.JOB_LEASE_SECONDS,
  });

  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("; ");
    throw new ConfigurationError(`Invalid configuration: ${detail}`);
  }

  return parsed.data;
}

export function signerMap(config: ServerConfig): Record<string, string> {
  const signers: Record<string, string> = {};
  for (const worker of config.workerAccounts) signers[worker.accountId] = worker.privateKey;
  if (
    config.nearNetwork === "sandbox" &&
    config.ownerAccountId &&
    config.sandboxOwnerPrivateKey
  ) {
    signers[config.ownerAccountId] = config.sandboxOwnerPrivateKey;
  }
  return signers;
}

export function aiConfigured(config: ServerConfig): boolean {
  return Boolean(config.aiApiKey && config.aiApiKey.trim().length > 0);
}
