"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import {
  AlertTriangle,
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
import { PageHeader } from "@/components/page-header";
import { BudgetStrip } from "@/components/budget-strip";
import { TaskTable } from "@/components/task-table";
import { ActivityList } from "@/components/activity-list";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { PanelSkeleton, Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/components/auth-provider";
import type { ActivityEvent, Overview } from "@/lib/types";

export default function OverviewPage() {
  const { accountId } = useAuth();
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

  return (
    <div className="space-y-7">
      <PageHeader
        title="Overview"
        description={
          <>
            Shared task budgets for <span className="mono text-[12px] text-[var(--foreground-muted)]">{accountId}</span>.
            A contract holds the funds; this workspace is a projection of its latest state.
          </>
        }
        actions={
          <Button asChild className="hidden sm:inline-flex">
            <Link href="/app/tasks/new">
              <Plus /> Create task
            </Link>
          </Button>
        }
      />

      {overview.error ? (
        <div className="flex items-start gap-2.5 rounded-[10px] border border-[var(--warning)]/30 bg-[var(--warning-background)] px-4 py-3 text-[12px] leading-5 text-[var(--warning)]">
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
        <div className="flex flex-col gap-3 rounded-[10px] border border-[var(--warning)]/30 bg-[var(--warning-background)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2.5">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[var(--warning)]" />
            <div>
              <p className="text-[13px] font-medium text-[var(--warning)]">
                {data.pendingRecoveries} {data.pendingRecoveries === 1 ? "operation needs" : "operations need"} a
                status check.
              </p>
              <p className="mt-0.5 text-[12px] leading-5 text-[var(--warning)]">
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
        <BudgetStrip
          availableYocto={data.totals.availableYocto}
          reservedYocto={data.totals.reservedYocto}
          spentYocto={data.totals.spentYocto}
          taskCount={data.totals.includedTaskIds.length}
        />
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="workspace-panel overflow-hidden" aria-labelledby="tasks-heading">
          <div className="flex items-center justify-between gap-3 px-5 py-4">
            <div>
              <h2 id="tasks-heading" className="text-[16px] font-semibold">
                Tasks
              </h2>
              <p className="mt-0.5 text-[12px] text-[var(--foreground-muted)]">
                {tasks.length === 0 ? "No shared budgets yet" : `${tasks.length} shared ${tasks.length === 1 ? "budget" : "budgets"}`}
              </p>
            </div>
            <Link
              href="/app/tasks"
              className="text-[12px] font-medium text-[var(--foreground-secondary)] underline-offset-4 hover:underline"
            >
              View all
            </Link>
          </div>
          {tasks.length === 0 ? (
            <EmptyState
              icon={<ListChecks className="size-5" />}
              title="Create your first shared budget"
              description="Fund one task, register two agents, and set the providers and per-purchase limit they must respect."
              action={
                <Button asChild>
                  <Link href="/app/tasks/new">
                    <Plus /> Create task
                  </Link>
                </Button>
              }
            />
          ) : (
            <div className="border-t border-[var(--border)]">
              <TaskTable tasks={tasks} />
            </div>
          )}
          <div className="border-t border-[var(--border)] bg-[var(--surface-muted)] px-5 py-2.5 sm:hidden">
            <Button asChild className="w-full" variant="secondary">
              <Link href="/app/tasks/new">
                <Plus /> Create task
              </Link>
            </Button>
          </div>
        </section>

        <aside className="workspace-panel self-start overflow-hidden" aria-labelledby="activity-heading">
          <div className="flex items-center justify-between px-5 py-4">
            <div>
              <h2 id="activity-heading" className="text-[16px] font-semibold">
                Recent activity
              </h2>
              <p className="mt-0.5 text-[12px] text-[var(--foreground-muted)]">Durable event history</p>
            </div>
            <Link
              href="/app/activity"
              className="text-[12px] font-medium text-[var(--foreground-secondary)] underline-offset-4 hover:underline"
            >
              All
            </Link>
          </div>
          <div className="border-t border-[var(--border)] px-5">
            {activity.isLoading ? (
              <div className="space-y-3 py-4">
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
                empty={
                  <p className="py-8 text-center text-[12px] text-[var(--foreground-muted)]">
                    Activity appears here after you create a task.
                  </p>
                }
              />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function GuidedSetupHero() {
  return (
    <motion.section
      aria-labelledby="welcome-heading"
      className="grain workspace-panel relative overflow-hidden"
      initial="hidden"
      animate="show"
      variants={stagger(0.08)}
    >
      <div className="grid items-center gap-8 p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div>
          <motion.p variants={rise} className="eyebrow">
            Start here
          </motion.p>
          <motion.h2 variants={rise} id="welcome-heading" className="mt-3 text-[26px] font-semibold leading-tight tracking-[-0.03em] sm:text-[30px]">
            Your first shared budget is two minutes away.
          </motion.h2>
          <motion.p variants={rise} className="mt-3 max-w-lg text-[14px] leading-6 text-[var(--foreground-secondary)]">
            The guided setup explains how agents share one pool, fills in sample documents and funds a task on the
            {" "}
            contract. You can watch two agents compete for the same budget right after.
          </motion.p>
          <motion.div variants={rise} className="mt-6 flex flex-wrap gap-2.5">
            <Button asChild size="lg">
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
