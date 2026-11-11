import type { PrismaClient } from "@poolguard/db";
import { fetchAttestation, isNearAiBaseUrl, type NearChain } from "@poolguard/agent-runtime";
import type { ApiConfig } from "./config.js";

export type HealthStatus = "up" | "degraded" | "down" | "not_configured";

export interface HealthCheck {
  name: "api" | "database" | "worker" | "provider" | "chain" | "ai" | "outlayer";
  label: string;
  status: HealthStatus;
  detail: string;
  latencyMs: number | null;
  checkedAt: string;
}

const WORKER_STALE_MS = 90_000;

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const started = performance.now();
  const value = await fn();
  return { value, ms: Math.round(performance.now() - started) };
}

/**
 * Health of every moving part, cached briefly. Used by the public status page,
 * the admin dashboard and the alert monitor. Never calls paid endpoints.
 */
export class HealthService {
  private cache: { at: number; checks: HealthCheck[] } | null = null;
  private inflight: Promise<HealthCheck[]> | null = null;

  constructor(
    private readonly deps: { prisma: PrismaClient; chain: NearChain; config: ApiConfig },
    private readonly ttlMs = 30_000,
  ) {}

  async checks(force = false): Promise<HealthCheck[]> {
    if (!force && this.cache && Date.now() - this.cache.at < this.ttlMs) return this.cache.checks;
    this.inflight ??= this.run().finally(() => {
      this.inflight = null;
    });
    const checks = await this.inflight;
    this.cache = { at: Date.now(), checks };
    return checks;
  }

  private async run(): Promise<HealthCheck[]> {
    const { prisma, chain, config } = this.deps;
    const at = () => new Date().toISOString();
    const result = async (
      name: HealthCheck["name"],
      label: string,
      probe: () => Promise<{ status: HealthStatus; detail: string }>,
    ): Promise<HealthCheck> => {
      try {
        const { value, ms } = await timed(probe);
        return { name, label, ...value, latencyMs: ms, checkedAt: at() };
      } catch (error) {
        return {
          name,
          label,
          status: "down",
          detail: (error instanceof Error ? error.message : String(error)).slice(0, 200),
          latencyMs: null,
          checkedAt: at(),
        };
      }
    };

    return Promise.all([
      result("api", "API", async () => ({ status: "up", detail: "Responding" })),
      result("database", "Database", async () => {
        await prisma.$queryRaw`SELECT 1`;
        return { status: "up", detail: "PostgreSQL reachable" };
      }),
      result("worker", "Agent worker", async () => {
        const latest = await prisma.workerHeartbeat.findFirst({ orderBy: { lastSeenAt: "desc" } });
        if (!latest) return { status: "down", detail: "No worker heartbeat recorded yet" };
        const age = Date.now() - latest.lastSeenAt.getTime();
        return age < WORKER_STALE_MS
          ? { status: "up", detail: `Heartbeat ${Math.round(age / 1000)}s ago · ${latest.activeJobs} active job(s)` }
          : { status: "down", detail: `Last heartbeat ${Math.round(age / 1000)}s ago` };
      }),
      result("provider", "Extraction provider", async () => {
        const response = await fetch(`${config.providerOrigin.replace(/\/+$/, "")}/catalog`, {
          signal: AbortSignal.timeout(6_000),
        });
        return response.ok
          ? { status: "up", detail: "Catalog reachable" }
          : { status: "degraded", detail: `Catalog returned HTTP ${response.status}` };
      }),
      result("chain", `NEAR ${config.nearNetwork}`, async () => {
        const block = await chain.getCurrentBlock();
        return { status: "up", detail: `RPC at block ${block.toLocaleString("en-US")}` };
      }),
      result("ai", "AI inference", async () => {
        if (!config.aiApiKey) return { status: "not_configured", detail: "No AI key: runs use labelled scripted fixtures" };
        if (!isNearAiBaseUrl(config.aiBaseUrl)) return { status: "up", detail: `Configured (${config.aiModel}); not probed to avoid cost` };
        const attestation = await fetchAttestation({ baseUrl: config.aiBaseUrl, apiKey: config.aiApiKey, model: config.aiModel, timeoutMs: 8_000 });
        return {
          status: attestation.hasTdxQuote ? "up" : "degraded",
          detail: attestation.hasTdxQuote ? "NEAR AI Cloud attestation available" : "Attestation report has no TDX quote",
        };
      }),
      result("outlayer", "OutLayer custody", async () => {
        const custody = config.workerAccounts.filter((worker) => worker.custody === "outlayer");
        if (custody.length === 0) return { status: "not_configured", detail: "Agents use restricted keys, not OutLayer" };
        const failures: string[] = [];
        for (const worker of custody) {
          const response = await fetch(`${config.outlayerApiUrl.replace(/\/+$/, "")}/wallet/v1/address?chain=near`, {
            headers: { authorization: `Bearer ${worker.outlayerApiKey}`, accept: "application/json" },
            signal: AbortSignal.timeout(8_000),
          });
          if (!response.ok) failures.push(`agent ${worker.slot}: HTTP ${response.status}`);
        }
        return failures.length === 0
          ? { status: "up", detail: `${custody.length} custody wallet(s) reachable` }
          : { status: failures.length === custody.length ? "down" : "degraded", detail: failures.join("; ") };
      }),
    ]);
  }
}

export function overallStatus(checks: HealthCheck[]): HealthStatus {
  const relevant = checks.filter((check) => check.status !== "not_configured");
  if (relevant.some((check) => check.status === "down")) return "down";
  if (relevant.some((check) => check.status === "degraded")) return "degraded";
  return "up";
}
