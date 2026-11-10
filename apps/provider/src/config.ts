import { z } from "zod";

export const providerConfigSchema = z.object({
  databaseUrl: z.string().min(1, "DATABASE_URL is required"),
  nearNetwork: z.enum(["sandbox", "testnet"]).default("testnet"),
  nearRpcUrl: z.string().url("NEAR_RPC_URL is required"),
  contractId: z.string().min(2, "POOLGUARD_CONTRACT_ID is required"),
  providerAccountId: z.string().min(2, "PROVIDER_ACCOUNT_ID is required"),
  providerOrigin: z.string().url().default("http://127.0.0.1:4103"),
  serviceDomain: z.string().min(1, "PROVIDER_SERVICE_DOMAIN is required"),
  port: z.coerce.number().int().min(1).max(65535).default(4103),
  host: z.string().default("127.0.0.1"),
});

export type ProviderConfig = z.infer<typeof providerConfigSchema>;

export function loadProviderConfig(env: NodeJS.ProcessEnv = process.env): ProviderConfig {
  const parsed = providerConfigSchema.safeParse({
    databaseUrl: env.DATABASE_URL,
    nearNetwork: env.NEAR_NETWORK,
    nearRpcUrl: env.NEAR_RPC_URL,
    contractId: env.POOLGUARD_CONTRACT_ID,
    providerAccountId: env.PROVIDER_ACCOUNT_ID,
    providerOrigin: env.PROVIDER_ORIGIN,
    serviceDomain: env.PROVIDER_SERVICE_DOMAIN,
    // Hosting shells sometimes export PORT=0 as a placeholder. Treat empty or
    // non-positive values as absent so the documented default still applies.
    port: env.PROVIDER_PORT || (env.PORT && Number(env.PORT) > 0 ? env.PORT : undefined),
    host: env.PROVIDER_HOST,
  });
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid provider configuration: ${detail}`);
  }
  return parsed.data;
}
