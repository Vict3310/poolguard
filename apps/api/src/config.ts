import { z } from "zod";
import { ConfigurationError, loadServerConfig, type ServerConfig } from "@poolguard/agent-runtime";
import { parseAccountAllowlist } from "./limits.js";

export type TrustProxySetting = boolean | string | string[];

export interface ApiConfig extends ServerConfig {
  sessionSecret: string;
  documentEncryptionKey: string;
  apiPort: number;
  apiHost: string;
  sessionTtlDays: number;
  apiTrustProxy: TrustProxySetting;
  apiRateLimitMax: number;
  chainReadConcurrency: number;
  /** Worker-signed chain actions one account may trigger per hour. */
  apiChainActionsPerHour: number;
  /** Lower-cased NEAR accounts allowed to sign in. Empty allows every account. */
  authAllowedAccounts: string[];
}

/**
 * Fastify accepts a boolean, an IP/CIDR, or a comma-separated list. Hop counts
 * are deliberately rejected: Fastify 5 fails them closed because a direct
 * client could spoof enough forwarding hops. Use the proxy address instead.
 * `true` trusts every forwarded hop and must only be used when the API is
 * unreachable except through that proxy.
 */
export function parseTrustProxy(value: string | undefined): TrustProxySetting {
  const raw = (value ?? "").trim();
  if (!raw || raw === "0" || raw.toLowerCase() === "false") return false;
  if (raw.toLowerCase() === "true") return true;
  if (/^\d+$/.test(raw)) {
    throw new ConfigurationError(
      "API_TRUST_PROXY must be the proxy IP/CIDR (for example 127.0.0.1 or 10.0.0.5), not a hop count; Fastify treats hop counts as untrusted.",
    );
  }
  if (raw.includes(",")) {
    return raw
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return raw;
}

export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const base = loadServerConfig(env);
  const extra = z
    .object({
      sessionSecret: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
      documentEncryptionKey: z.string().min(1, "DOCUMENT_ENCRYPTION_KEY is required"),
      apiPort: z.coerce.number().int().min(1).max(65535).default(4100),
      apiHost: z.string().default("127.0.0.1"),
      sessionTtlDays: z.coerce.number().int().min(1).max(30).default(7),
      apiTrustProxy: z.string().optional(),
      apiRateLimitMax: z.coerce.number().int().min(1).default(300),
      chainReadConcurrency: z.coerce.number().int().min(1).max(16).default(4),
      apiChainActionsPerHour: z.coerce.number().int().min(1).default(60),
      authAllowedAccounts: z.string().optional(),
    })
    .safeParse({
      sessionSecret: env.SESSION_SECRET,
      documentEncryptionKey: env.DOCUMENT_ENCRYPTION_KEY,
      apiPort: env.API_PORT,
      apiHost: env.API_HOST,
      sessionTtlDays: env.SESSION_TTL_DAYS,
      apiTrustProxy: env.API_TRUST_PROXY,
      apiRateLimitMax: env.API_RATE_LIMIT_MAX,
      chainReadConcurrency: env.CHAIN_READ_CONCURRENCY,
      apiChainActionsPerHour: env.API_CHAIN_ACTIONS_PER_HOUR,
      authAllowedAccounts: env.AUTH_ALLOWED_ACCOUNTS,
    });
  if (!extra.success) {
    throw new ConfigurationError(
      `Invalid API configuration: ${extra.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
  }

  const decoded = Buffer.from(extra.data.documentEncryptionKey, "base64");
  if (decoded.length !== 32) {
    throw new ConfigurationError(
      "DOCUMENT_ENCRYPTION_KEY must be base64 of exactly 32 bytes (openssl rand -base64 32)",
    );
  }

  if (base.nodeEnv === "production" && base.allowDevSession) {
    throw new ConfigurationError("ALLOW_DEV_SESSION must be false in production");
  }

  return {
    ...base,
    ...extra.data,
    apiTrustProxy: parseTrustProxy(extra.data.apiTrustProxy),
    authAllowedAccounts: parseAccountAllowlist(extra.data.authAllowedAccounts),
  };
}
