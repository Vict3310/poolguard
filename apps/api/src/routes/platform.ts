import type { FastifyInstance } from "fastify";
import { LEGAL_VERSIONS } from "@poolguard/shared";
import { overallStatus } from "../health.js";
import type { RouteContext } from "./context.js";

/** Public, unauthenticated endpoints: service status, announcements, legal metadata. */
export function registerPlatformRoutes(app: FastifyInstance, ctx: RouteContext) {
  app.get("/status", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async () => {
    const checks = await ctx.health.checks();
    return {
      status: overallStatus(checks),
      network: ctx.config.nearNetwork,
      checks: checks.map((check) => ({
        name: check.name,
        label: check.label,
        status: check.status,
        // Public detail stays generic; operators see full detail in /admin.
        detail: check.status === "down" ? "Unavailable" : check.detail,
        latencyMs: check.latencyMs,
        checkedAt: check.checkedAt,
      })),
    };
  });

  app.get("/announcements", async () => {
    const now = ctx.now();
    const rows = await ctx.prisma.announcement.findMany({
      where: { active: true, OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
      orderBy: { createdAt: "desc" },
      take: 3,
    });
    return {
      announcements: rows.map((row) => ({
        id: row.id,
        message: row.message,
        severity: row.severity,
        createdAt: row.createdAt.toISOString(),
        endsAt: row.endsAt?.toISOString() ?? null,
      })),
    };
  });

  app.get("/legal", async () => ({
    versions: LEGAL_VERSIONS,
    contactEmail: ctx.config.contactEmail,
    network: ctx.config.nearNetwork,
    aiProvider: ctx.config.aiApiKey ? (ctx.config.aiBaseUrl.includes("near.ai") ? "near-ai" : "openai-compatible") : null,
    aiModel: ctx.config.aiApiKey ? ctx.config.aiModel : null,
    custody: ctx.config.workerAccounts.some((worker) => worker.custody === "outlayer") ? "outlayer" : "local",
  }));
}
