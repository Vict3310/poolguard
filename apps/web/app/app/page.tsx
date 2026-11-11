"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import {
  Activity,
  AlertTriangle,
  Clock3,
  ArrowRight,
  FlaskConical,
  ListChecks,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { PoolVignette } from "@/components/pool-vignette";
import { OverviewSkeleton } from "@/components/route-skeletons";
import { rise, stagger } from "@/lib/motion";
import { api, ApiError } from "@/lib/api";
import { BudgetCard } from "@/components/budget-card";
import { PoolGuardMark } from "@/components/brand";
import { AnimatedNear } from "@/components/ui/animated-number";
import { Segmented } from "@/components/ui/switch";
import { TaskTable } from "@/components/task-table";
import { ActivityList } from "@/components/activity-list";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/components/auth-provider";
import type { ActivityEvent, Overview } from "@/lib/types";

type TaskFilter = "all" | "active" | "paused";

function useNow(intervalMs: number) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

export default function OverviewPage() {
  const { accountId } = useAuth();
  const [filter, setFilter] = React.useState<TaskFilter>("all");
  const now = useNow(5_000);
  const overview = useQuery({
    queryKey: ["overview"],
    queryFn: () => api<Overview>("/overview"),
    refetchInterval: 6_000,
  });
  const activity = useQuery({
    queryKey: ["activity-global"],
    queryFn: () => api<{ events: ActivityEvent[] }>("/activity"),
    refetchInterval: 8_000,
  });

  const seconds = overview.dataUpdatedAt ? Math.max(0, Math.round((now - overview.dataUpdatedAt) / 1000)) : null;
  const updatedLabel = seconds == null ? "—" : seconds < 10 ? "just now" : seconds < 60 ? `${seconds} sec ago` : `${Math.round(seconds / 60)} min ago`;

  if (overview.isLoading) {
    return <OverviewSkeleton />;
  }

  if (overview.error && !overview.data) {
    return (
      <div className="workspace-panel mx-auto mt-10 max-w-lg p-6">
        <div className="flex size-10 items-center justify-center rounded-[9px] bg-[var(--danger-background)] text-[var(--danger)]">
          <AlertTriangle className="size-5" />
        </div>
        <h1 className="mt-4 text-[18px] font-semibold">Overview could not be loaded</h1>
        <p className="mt-2 text-[13px] leading-5 text-[var(--foreground-secondary)]">
          {overview.error instanceof ApiError ? overview.error.message : "The API did not respond."}
        </p>
        <Button className="mt-5" variant="secondary" onClick={() => void overview.refetch()}>
          <RefreshCw /> Retry
        </Button>
      </div>
    );
  }

  const data = overview.data!;
  const tasks = data.tasks;
  const visible = tasks.filter((task) => (filter === "all" ? true : filter === "paused" ? task.paused : !task.paused));

  return (
    <div className="space-y-12">
      <motion.header initial="hidden" animate="show" variants={stagger(0.07)} className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <motion.p variants={rise} className="flex items-center gap-2.5 text-[15px] text-[var(--foreground-secondary)]">
            <span className="icon-tile size-6 rounded-full">
              <span className="pulse-dot size-2 rounded-full bg-white" />
            </span>
            Last update: <span className="text-[var(--foreground)]">{updatedLabel}</span>
          </motion.p>
          <motion.h1 variants={rise} className="mt-5 text-[44px] font-medium leading-[1.04] tracking-[-0.035em] sm:text-[56px]">
            <span className="text-fade-soft">Live Budget</span>
            <br />
            <span className="text-fade">Updates</span>{" "}
            <PoolGuardMark className="inline size-9 align-[-2px] text-[var(--foreground-muted)] sm:size-11" />
            <span className="sr-only">: overview of {accountId}</span>
          </motion.h1>
        </div>
        <motion.div variants={rise} className="flex flex-wrap items-center gap-3">
          <div className="grid grid-cols-3 divide-x divide-[var(--border)] rounded-[18px] border border-[var(--border)] bg-[#0c0c10]">
            {(
              [
                ["Available", data.totals.availableYocto],
                ["Reserved", data.totals.reservedYocto],
                ["Spent", data.totals.spentYocto],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="px-5 py-3">
                <p className="text-[12px] text-[var(--foreground-muted)]">{label}</p>
                <p className="financial-value mt-1 text-[17px] font-medium">
                  <AnimatedNear yocto={value} /> <span className="text-[13px] text-[var(--foreground-muted)]">Ⓝ</span>
                </p>
              </div>
            ))}
          </div>
          <Button asChild variant="action" size="lg" className="h-[62px] rounded-[18px] px-6">
            <Link href="/app/tasks/new">
              <Plus /> Create task
            </Link>
          </Button>
        </motion.div>
      </motion.header>

      {overview.error ? (
        <div className="flex items-start gap-2.5 rounded-[16px] border border-[var(--warning)]/25 bg-[var(--warning-background)] px-4 py-3 text-[13px] leading-5 text-[var(--warning)]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p>
            A refresh failed; values below are the last successful projection.{" "}
            <button className="font-medium underline underline-offset-2" onClick={() => void overview.refetch()}>
              Try again
            </button>
          </p>
        </div>
      ) : null}

      {data.pendingRecoveries > 0 ? (
        <div className="flex flex-col gap-3 rounded-[16px] border border-[var(--warning)]/25 bg-[var(--warning-background)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2.5">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[var(--warning)]" />
            <div>
              <p className="text-[14px] font-medium text-[var(--warning)]">
                {data.pendingRecoveries} {data.pendingRecoveries === 1 ? "operation needs" : "operations need"} a status check.
              </p>
              <p className="mt-0.5 text-[13px] leading-5 text-[var(--warning)]/85">
                PoolGuard will reconcile the original operation before any new payment. Nothing is paid twice.
              </p>
            </div>
          </div>
          <Button size="sm" variant="secondary" asChild>
            <Link href="/app/activity">
              Review activity <ArrowRight />
            </Link>
          </Button>
        </div>
      ) : null}

      {tasks.length === 0 ? (
        <GuidedSetupHero />
      ) : (
        <section aria-label="Task budgets" className="-mx-4 sm:-mx-6 lg:-mx-10">
          <div className="scrollbar-quiet flex snap-x snap-mandatory scroll-px-4 gap-8 overflow-x-auto px-4 pb-4 sm:scroll-px-6 sm:px-6 lg:scroll-px-10 lg:px-10">
            {tasks.slice(0, 8).map((task) => (
              <BudgetCard key={task.id} task={task} />
            ))}
            <Link
              href="/app/tasks/new"
              className="glow-card flex h-[470px] w-[260px] shrink-0 snap-start flex-col items-center justify-center gap-4 text-[var(--foreground-secondary)] transition-colors hover:text-[var(--foreground)]"
            >
              <span className="icon-tile size-14 rounded-[16px]">
                <Plus className="size-5" />
              </span>
              <span className="text-[16px]">New shared budget</span>
            </Link>
          </div>
        </section>
      )}

      <div className="h-px bg-[var(--border)]" />

      <section aria-labelledby="tasks-heading" className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="flex items-center gap-2 text-[15px] text-[var(--foreground-secondary)]">
              <Clock3 className="size-[18px]" strokeWidth={1.5} /> Live updates
            </p>
            <h2 id="tasks-heading" className="mt-1.5 text-[26px] font-medium tracking-[-0.02em]">
              Budget Overview
            </h2>
          </div>
          <div className="flex items-center gap-3">
            <Segmented<TaskFilter>
              id="task-filter"
              label="Filter tasks"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: "All" },
                { value: "active", label: "Active" },
                { value: "paused", label: "Paused" },
              ]}
            />
            <Link href="/app/tasks" className="hidden text-[14px] text-[var(--foreground-secondary)] underline-offset-4 hover:text-[var(--foreground)] hover:underline sm:inline">
              View all
            </Link>
          </div>
        </div>
        <div className="workspace-panel overflow-hidden rounded-[24px]">
          {visible.length === 0 ? (
            <EmptyState
              icon={<ListChecks className="size-5" />}
              title={tasks.length === 0 ? "Create your first shared budget" : "No tasks match this filter"}
              description={
                tasks.length === 0
                  ? "Fund one task, register two agents, and set the providers and per-purchase limit they must respect."
                  : "Switch the filter back to All to see every task."
              }
              action={
                tasks.length === 0 ? (
                  <Button asChild variant="action">
                    <Link href="/app/tasks/new">
                      <Plus /> Create task
                    </Link>
                  </Button>
                ) : null
              }
            />
          ) : (
            <TaskTable tasks={visible} />
          )}
        </div>
      </section>

      <section aria-labelledby="activity-heading" className="space-y-6">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-[15px] text-[var(--foreground-secondary)]">
              <Activity className="size-[18px]" strokeWidth={1.5} /> Durable event history
            </p>
            <h2 id="activity-heading" className="mt-1.5 text-[26px] font-medium tracking-[-0.02em]">
              Recent Activity
            </h2>
          </div>
          <Link href="/app/activity" className="text-[14px] text-[var(--foreground-secondary)] underline-offset-4 hover:text-[var(--foreground)] hover:underline">
            All activity
          </Link>
        </div>
        <div className="workspace-panel rounded-[24px] px-6">
          {activity.isLoading ? (
            <div className="space-y-3 py-5">
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={index} className="flex gap-3">
                  <Skeleton className="size-7 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-full" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <ActivityList
              events={activity.data?.events ?? []}
              showTask
              limit={8}
              empty={<p className="py-10 text-center text-[13px] text-[var(--foreground-muted)]">Activity appears here after you create a task.</p>}
            />
          )}
        </div>
      </section>
    </div>
  );
}

function GuidedSetupHero() {
  return (
    <motion.section
      aria-labelledby="welcome-heading"
      className="glow-card relative"
      style={{ ["--glow" as string]: "rgb(165 166 246 / 22%)" }}
      initial="hidden"
      animate="show"
      variants={stagger(0.08)}
    >
      <div className="grid items-center gap-8 p-7 sm:p-10 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div>
          <motion.p variants={rise} className="eyebrow">
            Start here
          </motion.p>
          <motion.h2 variants={rise} id="welcome-heading" className="text-fade-soft mt-3 text-[30px] font-medium leading-tight tracking-[-0.03em] sm:text-[36px]">
            Your first shared budget is two minutes away.
          </motion.h2>
          <motion.p variants={rise} className="mt-3 max-w-lg text-[14px] leading-6 text-[var(--foreground-secondary)]">
            The guided setup explains how agents share one pool, fills in sample documents and funds a task on the
            {" "}
            contract. You can watch two agents compete for the same budget right after.
          </motion.p>
          <motion.div variants={rise} className="mt-6 flex flex-wrap gap-2.5">
            <Button asChild size="lg" variant="action">
              <Link href="/onboarding">
                <Sparkles /> Start guided setup
              </Link>
            </Button>
            <Button asChild size="lg" variant="secondary">
              <Link href="/app/tasks/new">
                <Plus /> Create task manually
              </Link>
            </Button>
            <Button asChild size="lg" variant="ghost">
              <Link href="/app/demo">
                <FlaskConical /> Demo lab
              </Link>
            </Button>
          </motion.div>
        </div>
        <motion.div variants={rise} className="hidden justify-center lg:flex">
          <PoolVignette />
        </motion.div>
      </div>
    </motion.section>
  );
}
