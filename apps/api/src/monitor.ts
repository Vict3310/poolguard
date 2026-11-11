import type { PrismaClient } from "@poolguard/db";
import type { NearChain } from "@poolguard/agent-runtime";
import { recordAudit } from "./audit.js";
import type { ApiConfig } from "./config.js";

const LOW_BALANCE_YOCTO = 10n ** 23n; // 0.1 NEAR
const DEDUPE_MS = 30 * 60_000;

export interface Alert {
  key: string;
  severity: "warning" | "critical";
  message: string;
}

/**
 * Periodic operational checks. Each alert is logged as structured JSON, written
 * to the audit log, and posted to ALERT_WEBHOOK_URL (Slack-compatible `{ text }`)
 * when configured. Repeats of the same alert are suppressed for 30 minutes.
 */
export class Monitor {
  private readonly lastSent = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: { prisma: PrismaClient; chain: NearChain; config: ApiConfig; log?: (line: string) => void }) {}

  start(intervalMs = 60_000) {
    if (this.timer) return;
    const tick = () => void this.runOnce().catch((error) => this.emitLog("error", "monitor_failed", String(error)));
    this.timer = setInterval(tick, intervalMs);
    this.timer.unref?.();
    setTimeout(tick, 15_000).unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Evaluate every rule once and dispatch new alerts. Returns all active alerts. */
  async runOnce(): Promise<Alert[]> {
    const alerts = await this.evaluate();
    for (const alert of alerts) await this.dispatch(alert);
    return alerts;
  }

  async evaluate(): Promise<Alert[]> {
    const { prisma, config } = this.deps;
    const now = Date.now();
    const alerts: Alert[] = [];

    const heartbeat = await prisma.workerHeartbeat.findFirst({ orderBy: { lastSeenAt: "desc" } });
    if (!heartbeat || now - heartbeat.lastSeenAt.getTime() > 2 * 60_000) {
      alerts.push({
        key: "worker_stale",
        severity: "critical",
        message: heartbeat ? `No worker heartbeat for ${Math.round((now - heartbeat.lastSeenAt.getTime()) / 60_000)} min.` : "No worker has ever reported a heartbeat.",
      });
    }

    const oldestQueued = await prisma.job.findFirst({ where: { status: "QUEUED", runAt: { lt: new Date() } }, orderBy: { runAt: "asc" } });
    const queued = await prisma.job.count({ where: { status: "QUEUED" } });
    if (queued > 50 || (oldestQueued && now - oldestQueued.runAt.getTime() > 5 * 60_000)) {
      alerts.push({ key: "queue_backlog", severity: "warning", message: `${queued} job(s) queued; oldest waiting ${oldestQueued ? Math.round((now - oldestQueued.runAt.getTime()) / 60_000) : 0} min.` });
    }

    const dead = await prisma.job.count({ where: { status: "DEAD", updatedAt: { gt: new Date(now - 60 * 60_000) } } });
    if (dead > 0) alerts.push({ key: "jobs_dead", severity: "warning", message: `${dead} job(s) dead-lettered in the last hour.` });

    const pending = await prisma.operation.count({
      where: { OR: [{ paymentState: "PAYOUT_PENDING" }, { needsRecovery: true }], updatedAt: { lt: new Date(now - 10 * 60_000) } },
    });
    if (pending > 0) alerts.push({ key: "payouts_pending", severity: "critical", message: `${pending} operation(s) waiting on a payout callback or recovery for over 10 min.` });

    for (const worker of config.workerAccounts) {
      try {
        const response = await fetch(config.nearRpcUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: "monitor", method: "query", params: { request_type: "view_account", finality: "final", account_id: worker.accountId } }),
          signal: AbortSignal.timeout(10_000),
        });
        const body = (await response.json()) as { result?: { amount: string } };
        if (body.result && BigInt(body.result.amount) < LOW_BALANCE_YOCTO) {
          alerts.push({ key: `low_balance:${worker.accountId}`, severity: "warning", message: `Agent ${worker.slot} (${worker.accountId}) has under 0.1 NEAR for gas.` });
        }
      } catch {
        /* chain reachability is reported by the health service */
      }
    }
    return alerts;
  }

  private async dispatch(alert: Alert) {
    const last = this.lastSent.get(alert.key) ?? 0;
    if (Date.now() - last < DEDUPE_MS) return;
    this.lastSent.set(alert.key, Date.now());
    this.emitLog(alert.severity === "critical" ? "error" : "warn", alert.key, alert.message);
    await recordAudit(this.deps.prisma, {
      type: "alert.raised",
      actor: "monitor",
      summary: alert.message,
      severity: alert.severity === "critical" ? "danger" : "warning",
      data: { key: alert.key, severity: alert.severity },
      dedupeKey: `alert:${alert.key}:${Math.floor(Date.now() / DEDUPE_MS)}`,
    }).catch(() => undefined);
    if (this.deps.config.alertWebhookUrl) {
      await fetch(this.deps.config.alertWebhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: `PoolGuard ${this.deps.config.nearNetwork} ${alert.severity.toUpperCase()}: ${alert.message}` }),
        signal: AbortSignal.timeout(8_000),
      }).catch((error) => this.emitLog("warn", "alert_webhook_failed", String(error)));
    }
  }

  private emitLog(level: "warn" | "error", key: string, message: string) {
    const line = JSON.stringify({ level, time: new Date().toISOString(), component: "monitor", alert: key, message });
    (this.deps.log ?? ((value: string) => process.stderr.write(`${value}\n`)))(line);
  }
}
