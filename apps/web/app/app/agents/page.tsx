"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { rise, stagger } from "@/lib/motion";
import { useQuery } from "@tanstack/react-query";
import { KeyRound, ShieldCheck, Users } from "lucide-react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { CopyButton } from "@/components/copy-button";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { shortId } from "@/lib/utils";
import type { TaskSummary } from "@/lib/types";

const WORKER_METHODS = ["reserve", "execute", "cancel_reservation"];

export default function AgentsPage() {
  const tasks = useQuery({
    queryKey: ["tasks"],
    queryFn: () => api<{ tasks: TaskSummary[] }>("/tasks"),
    refetchInterval: 10_000,
  });
  const agents = (tasks.data?.tasks ?? []).flatMap((task) =>
    (task.agents ?? []).map((agent) => ({ agent, task })),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agents"
        description="Each agent is a separate testnet account with a restricted function-call key scoped to PoolGuard worker methods."
      />

      <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3 text-[12px] leading-5 text-[var(--foreground-secondary)]">
        <strong className="font-medium text-[var(--foreground)]">Key allowance is not a budget.</strong>{" "}
        A function-call key caps gas, not spending. The task policy in the contract enforces the
        per-purchase limit, provider allowlist and shared balance. Worker keys cannot call owner
        administration.
      </div>

      {tasks.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="workspace-panel p-5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="mt-3 h-3 w-56" />
              <Skeleton className="mt-5 h-16 w-full" />
            </div>
          ))}
        </div>
      ) : agents.length === 0 ? (
        <div className="workspace-panel">
          <EmptyState
            icon={<Users className="size-5" />}
            title="No agents registered yet"
            description="Creating a task registers the two configured worker accounts against its policy."
            action={
              <Button asChild>
                <Link href="/app/tasks/new">Create task</Link>
              </Button>
            }
          />
        </div>
      ) : (
        <motion.div
          className="grid gap-4 lg:grid-cols-2"
          initial="hidden"
          animate="show"
          variants={stagger(0.06)}
        >
          {agents.map(({ agent, task }) => (
            <motion.section key={agent.id} variants={rise} className="workspace-panel lift p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-[8px] border border-[var(--border)] bg-[var(--surface-muted)] text-[var(--foreground-muted)]">
                    <KeyRound className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="truncate text-[14px] font-semibold">{agent.label}</h2>
                    <p className="mono mt-0.5 truncate text-[11px] text-[var(--foreground-muted)]">
                      {agent.accountId}
                    </p>
                  </div>
                </div>
                <span
                  className={
                    agent.status === "registered"
                      ? "shrink-0 rounded-[5px] bg-[var(--success-background)] px-2 py-1 text-[11px] font-medium text-[var(--success)]"
                      : "shrink-0 rounded-[5px] bg-[var(--danger-background)] px-2 py-1 text-[11px] font-medium text-[var(--danger)]"
                  }
                >
                  {agent.status === "registered" ? "Registered" : "Revoked"}
                </span>
              </div>

              <dl className="mt-4 space-y-2 border-t border-[var(--border)] pt-3 text-[12px]">
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-[var(--foreground-muted)]">Task</dt>
                  <dd className="min-w-0 text-right">
                    <Link href={`/app/tasks/${task.id}`} className="block truncate font-medium hover:underline">
                      {task.name}
                    </Link>
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-[var(--foreground-muted)]">Registered public key</dt>
                  <dd className="mono flex min-w-0 items-center gap-1 truncate text-[11px]">
                    {shortId(agent.publicKey, 16, 8)}
                    {agent.publicKey ? <CopyButton value={agent.publicKey} label="Copy public key" /> : null}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-[var(--foreground-muted)]">Server signing key</dt>
                  <dd className="text-[11px]">
                    {agent.keyConfigured ? (
                      <span className="inline-flex items-center gap-1 text-[var(--success)]">
                        <ShieldCheck className="size-3" /> Configured
                      </span>
                    ) : (
                      <span className="text-[var(--warning)]">Missing — runs will not start</span>
                    )}
                  </dd>
                </div>
              </dl>

              <div className="mt-3 border-t border-[var(--border)] pt-3">
                <p className="text-[11px] text-[var(--foreground-muted)]">Contract methods reachable with this key</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {WORKER_METHODS.map((method) => (
                    <span key={method} className="mono rounded-[4px] bg-[var(--surface-muted)] px-1.5 py-1 text-[10px] text-[var(--foreground-secondary)]">
                      {method}
                    </span>
                  ))}
                </div>
                <p className="mt-2 text-[10px] leading-4 text-[var(--foreground-muted)]">
                  <code className="mono">expire_reservation</code> is permissionless and can only release an
                  already-expired reservation. It cannot cancel a live reservation or a dispatched payout.
                </p>
              </div>
            </motion.section>
          ))}
        </motion.div>
      )}
    </div>
  );
}
