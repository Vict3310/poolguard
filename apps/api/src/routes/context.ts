import type { FastifyReply, FastifyRequest } from "fastify";
import type { PrismaClient } from "@poolguard/db";
import type { NearChain } from "@poolguard/agent-runtime";
import type { ApiConfig } from "../config.js";
import type { HealthService } from "../health.js";
import type { AccountQuota } from "../limits.js";
import type { SessionInfo } from "../app.js";

/** Everything the extra route modules need from the core app, passed explicitly. */
export interface RouteContext {
  prisma: PrismaClient;
  chain: NearChain;
  config: ApiConfig;
  now: () => Date;
  health: HealthService;
  quota: AccountQuota;
  sessionFrom(request: FastifyRequest): Promise<SessionInfo | null>;
  requireSession(request: FastifyRequest, reply: FastifyReply): Promise<SessionInfo | null>;
  checkCsrf(request: FastifyRequest, session: SessionInfo, reply: FastifyReply): boolean;
  consentStatus(userId: string): Promise<{
    required: boolean;
    accepted: { terms: string | null; privacy: string | null };
    current: { terms: string; privacy: string };
  }>;
  isAdmin(accountId: string): boolean;
  isOperator(accountId: string): boolean;
  clearSessionCookies(reply: FastifyReply): void;
  decryptDocument(ciphertext: string): string;
}
