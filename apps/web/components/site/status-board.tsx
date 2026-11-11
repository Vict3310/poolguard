"use client";

import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { CheckCircle2, CircleDashed, RefreshCw, TriangleAlert, XCircle } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, relative } from "@/lib/utils";

type Status = "up" | "degraded" | "down" | "not_configured";
interface StatusResponse {
  status: Status;
  network: string;
  checks: Array<{ name: string; label: string; status: Status; detail: string; latencyMs: number | null; checkedAt: string }>;
}

const TONE: Record<Status, { label: string; className: string; icon: React.ComponentType<{ className?: string }> }> = {
  up: { label: "Operational", className: "text-[var(--success)] bg-[var(--success-background)]", icon: CheckCircle2 },
  degraded: { label: "Degraded", className: "text-[var(--warning)] bg-[var(--warning-background)]", icon: TriangleAlert },
  down: { label: "Down", className: "text-[var(--danger)] bg-[var(--danger-background)]", icon: XCircle },
  not_configured: { label: "Not in use", className: "text-[var(--foreground-muted)] bg-[var(--surface-muted)]", icon: CircleDashed },
};

const HEADLINE: Record<Status, string> = {
  up: "All systems operational",
  degraded: "Some systems are degraded",
  down: "Part of PoolGuard is down",
  not_configured: "Status unknown",
};

export function StatusBoard() {
  const status = useQuery({
    queryKey: ["public-status"],
    queryFn: () => api<StatusResponse>("/status"),
    refetchInterval: 30_000,
    retry: 0,
  });

  if (status.isLoading) {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-20 w-full" />
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  if (status.error || !status.data) {
    return (
      <div className="rounded-[14px] border border-[var(--danger)]/30 bg-[var(--danger-background)] p-5 text-[var(--danger)]">
        <p className="text-[16px] font-semibold">The PoolGuard API is not responding.</p>
        <p className="mt-1 text-[13px]">Every other check depends on it. Try again in a moment.</p>
        <Button className="mt-4" variant="secondary" onClick={() => void status.refetch()}>
          <RefreshCw /> Retry
        </Button>
      </div>
    );
  }

  const overall = TONE[status.data.status];
  return (
    <div>
      <div className={cn("flex items-center gap-3 rounded-[14px] px-5 py-4", overall.className)}>
        <overall.icon className="size-6" />
        <div>
          <p className="text-[17px] font-semibold">{HEADLINE[status.data.status]}</p>
          <p className="text-[12px] opacity-80">NEAR {status.data.network} · refreshes every 30 seconds</p>
        </div>
      </div>
      <ul className="mt-5 divide-y divide-[var(--border)] rounded-[14px] border border-[var(--border)] bg-[var(--surface)]">
        {status.data.checks.map((check, index) => {
          const tone = TONE[check.status];
          return (
            <motion.li
              key={check.name}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.04 }}
              className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="text-[14px] font-medium text-[var(--foreground)]">{check.label}</p>
                <p className="mt-0.5 text-[12px] text-[var(--foreground-muted)]">{check.detail}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[11px] text-[var(--foreground-muted)]">
                  {check.latencyMs != null ? `${check.latencyMs} ms · ` : ""}checked {relative(check.checkedAt)}
                </span>
                <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-medium", tone.className)}>
                  <tone.icon className="size-3.5" /> {tone.label}
                </span>
              </div>
            </motion.li>
          );
        })}
      </ul>
    </div>
  );
}
