"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronRight,
  CircleDollarSign,
  FileText,
  FlaskConical,
  Play,
  RefreshCw,
  ShieldAlert,
  Users,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { BudgetPanel } from "@/components/budget-panel";
import { AgentCard } from "@/components/agent-card";
import { PurchasesTable } from "@/components/purchases-table";
import { ResultSection } from "@/components/result-section";
import { TaskPolicy } from "@/components/task-policy";
import { ActivityList } from "@/components/activity-list";
import { OperationDrawer } from "@/components/operation-drawer";
import { RunTaskDialog } from "@/components/run-task-dialog";
import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import { PanelSkeleton, Skeleton } from "@/components/ui/skeleton";
import { useTaskEvents } from "@/lib/use-task-events";
import { motion } from "motion/react";
import { TaskDetailSkeleton } from "@/components/route-skeletons";
import { StatusScreen } from "@/components/status-screen";
import { feedback } from "@/lib/feedback";
import { formatDate, near, relative, shortId } from "@/lib/utils";
import { signAndSendPlan } from "@/lib/wallet";
import type { Operation, Task, TxPlan } from "@/lib/types";

function DraftBanner({ task }: { task: Task }) {
  const { meta } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = React.useState<string | null>(null);
  const plan = useQuery({
    queryKey: ["setup-plan", task.id],
    queryFn: () => api<TxPlan>(`/tasks/${task.id}/setup-plan`),
    retry: 1,
  });
  const fund = useMutation({
    mutationFn: async () => {
      if (meta?.sandbox) {
        await api(`/dev/tasks/${task.id}/submit-setup`, { method: "POST" });
        return;
      }
      if (!plan.data) throw new Error("Setup plan is not ready.");
      const hash = await signAndSendPlan(plan.data);
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        try {
          await api(`/tasks/${task.id}/confirm`, {
            method: "POST",
            body: JSON.stringify({ tx_hash: hash }),
          });
          return;
        } catch (confirmError) {
          lastError = confirmError;
          if (confirmError instanceof ApiError && confirmError.code === "TX_NOT_FINAL") {
            await new Promise((resolve) => setTimeout(resolve, 1_500));
            continue;
          }
          throw confirmError;
        }
      }
      throw lastError instanceof Error ? lastError : new Error("Transaction confirmation timed out.");
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["task", task.id] });
      await queryClient.invalidateQueries({ queryKey: ["tasks"] });
      const { toast } = await import("sonner");
      toast.success("Task activated");
    },
    onError: (mutationError) => {
      setError(mutationError instanceof Error ? mutationError.message : "Setup failed.");
    },
  });

  return (
    <div className="workspace-panel border-[var(--warning)]/40 p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-[8px] bg-[var(--warning-background)] text-[var(--warning)]">
            <CircleDollarSign className="size-4" />
          </span>
          <div>
            <h2 className="text-[15px] font-semibold">This task is not funded on chain yet</h2>
            <p className="mt-1 max-w-xl text-[12px] leading-5 text-[var(--foreground-secondary)]">
              The draft and its documents are saved. One owner-wallet transaction creates the task,
              funds the pool and registers both agent keys. Storage deposits are separate.
            </p>
            {plan.data ? (
              <p className="financial-value mt-2 text-[11px] text-[var(--foreground-muted)]">
                Funding {near(plan.data.summary?.budgetFundingYocto)} testNEAR · total attached{" "}
                {near(plan.data.total_deposit_yocto)} testNEAR
              </p>
            ) : null}
            {error ? <p className="mt-2 text-[12px] text-[var(--danger)]">{error}</p> : null}
          </div>
        </div>
        <Button onClick={() => fund.mutate()} loading={fund.isPending || plan.isLoading} className="shrink-0">
          <ShieldAlert /> Fund task
        </Button>
      </div>
    </div>
  );
}

const sectionRise = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] as const } },
};

export default function TaskDetailPage() {
  const params = useParams<{ id: string }>();
  const taskId = params.id;
  const queryClient = useQueryClient();
  const [selectedOperation, setSelectedOperation] = React.useState<Operation | null>(null);
  const [runOpen, setRunOpen] = React.useState(false);

  const taskQuery = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => api<{ task: Task }>(`/tasks/${taskId}`).then((value) => value.task),
    refetchInterval: 4_000,
  });
  const events = useTaskEvents(taskId);

  if (taskQuery.isLoading) {
    return <TaskDetailSkeleton />;
  }

  if (taskQuery.error && !taskQuery.data) {
    const notFound = taskQuery.error instanceof ApiError && taskQuery.error.status === 404;
    return (
      <StatusScreen
        framed={false}
        code={notFound ? "404" : "!"}
        title={notFound ? "No task with this id." : "This task couldn’t load."}
        body={
          notFound
            ? "It may belong to another account, or the link is incomplete. Your other tasks are unaffected."
            : taskQuery.error instanceof ApiError
              ? taskQuery.error.message
              : "The API did not respond. Balances stay safe on chain."
        }
        actions={
          <>
            {!notFound ? (
              <Button onClick={() => void taskQuery.refetch()}>
                <RefreshCw /> Try again
              </Button>
            ) : null}
            <Button variant="secondary" asChild>
              <Link href="/app/tasks">Back to tasks</Link>
            </Button>
          </>
        }
      />
    );
  }

  const task = taskQuery.data!;
  const latestRuns = task.agents.map((agent) =>
    task.runs.find((run) => run.agentId === agent.id),
  );
  const needsSetup = task.status === "draft" || task.status === "awaiting_funding";
  const activeOperations = task.operations.filter((operation) => operation.needsRecovery).length;

  return (
    <motion.div
      className="space-y-5"
      initial="hidden"
      animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05 } } }}
    >
      <div>
        <Link
          href="/app/tasks"
          className="inline-flex items-center gap-1.5 text-[12px] text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
        >
          <ArrowLeft className="size-3.5" /> Tasks
        </Link>
      </div>

      <PageHeader
        eyebrow={
          <>
            <StatusBadge kind="task" value={task.status} />
            <span className="text-[11px] text-[var(--foreground-muted)]">
              Created {formatDate(task.createdAt)} · {task.documents.length} document
              {task.documents.length === 1 ? "" : "s"}
            </span>
          </>
        }
        title={task.name}
        description={task.objective}
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void taskQuery.refetch()}
              loading={taskQuery.isFetching}
              aria-label="Refresh task"
            >
              <RefreshCw /> Refresh
            </Button>
            <Button
              size="sm"
              onClick={() => {
                feedback("tap");
                setRunOpen(true);
              }}
              disabled={needsSetup}
            >
              <Play /> Run task
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-[var(--foreground-muted)]">
        <span className="inline-flex items-center gap-1">
          Contract task <span className="mono text-[var(--foreground-secondary)]">{task.chainTaskId}</span>
          <CopyButton value={task.chainTaskId} label="Copy chain task id" />
        </span>
        <span>Owner {shortId(task.ownerAccountId, 14, 6)}</span>
        <span className="inline-flex items-center gap-1">
          <Users className="size-3" /> {task.agents.length} agents
        </span>
        <span>Policy v{task.policy.version}</span>
        {task.currentBlock ? <span>Block {task.currentBlock.toLocaleString()}</span> : null}
      </div>

      {task.syncWarning ? (
        <div className="flex items-start gap-2 rounded-[8px] border border-[var(--warning)]/30 bg-[var(--warning-background)] px-3 py-2.5 text-[12px] leading-5 text-[var(--warning)]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p>
            {task.syncWarning}. Displayed balances may be the last verified projection; they are never
            replaced with a fabricated zero.
          </p>
        </div>
      ) : null}

      {needsSetup ? <DraftBanner task={task} /> : null}

      <motion.div variants={sectionRise}>
        <BudgetPanel task={task} />
      </motion.div>

      {activeOperations > 0 ? (
        <div className="flex flex-col gap-2 rounded-[8px] border border-[var(--warning)]/30 bg-[var(--warning-background)] px-4 py-3 text-[12px] leading-5 text-[var(--warning)] sm:flex-row sm:items-center sm:justify-between">
          <span className="inline-flex items-start gap-2">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" />
            {activeOperations} {activeOperations === 1 ? "operation is" : "operations are"} waiting for
            payment reconciliation. The original operation is checked before any further payment.
          </span>
          <button
            type="button"
            className="self-start font-medium underline underline-offset-2"
            onClick={() => {
              const pending = task.operations.find((operation) => operation.needsRecovery);
              if (pending) setSelectedOperation(pending);
            }}
          >
            Review
          </button>
        </div>
      ) : null}

      <motion.div variants={sectionRise} className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_350px] xl:items-start">
        <div className="min-w-0 space-y-5">
          <section aria-labelledby="agents-heading">
            <div className="mb-2.5 flex items-end justify-between gap-3">
              <div>
                <h2 id="agents-heading" className="text-[15px] font-semibold">
                  Agents
                </h2>
                <p className="mt-0.5 text-[11px] text-[var(--foreground-muted)]">
                  Two separate worker accounts. Actions, not private reasoning.
                </p>
              </div>
              <span className="text-[11px] text-[var(--foreground-muted)]">
                {task.runs.length > 0 ? `Last run ${relative(task.runs[0]?.finishedAt ?? task.runs[0]?.startedAt ?? null)}` : "No runs yet"}
              </span>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {task.agents.map((agent, index) => (
                <AgentCard key={agent.id} agent={agent} run={latestRuns[index]} />
              ))}
            </div>
          </section>

          <section className="workspace-panel overflow-hidden" aria-labelledby="purchases-heading">
            <div className="flex items-center justify-between gap-3 px-5 py-4">
              <div>
                <h2 id="purchases-heading" className="text-[15px] font-semibold">
                  Purchases
                </h2>
                <p className="mt-0.5 text-[11px] text-[var(--foreground-muted)]">
                  One row per logical operation. Payment and delivery are independent.
                </p>
              </div>
              <span className="text-[11px] text-[var(--foreground-muted)]">{task.operations.length} total</span>
            </div>
            <div className="border-t border-[var(--border)]">
              <PurchasesTable operations={task.operations} onSelect={setSelectedOperation} />
            </div>
          </section>

          <section id="result" className="workspace-panel scroll-mt-24 overflow-hidden" aria-labelledby="result-heading">
            <div className="flex items-center justify-between gap-3 px-5 py-4">
              <div>
                <h2 id="result-heading" className="text-[15px] font-semibold">
                  Result
                </h2>
                <p className="mt-0.5 text-[11px] text-[var(--foreground-muted)]">
                  Structured comparison assembled from provider outputs, not model invention.
                </p>
              </div>
              {task.documents.length > 0 ? (
                <span className="hidden items-center gap-1.5 text-[11px] text-[var(--foreground-muted)] sm:inline-flex">
                  <FileText className="size-3" /> {task.documents.map((document) => document.label).join(" · ")}
                </span>
              ) : null}
            </div>
            <div className="border-t border-[var(--border)]">
              <ResultSection result={task.result} />
            </div>
          </section>

          <TaskPolicy task={task} />
        </div>

        <aside className="workspace-panel overflow-hidden xl:sticky xl:top-24" aria-labelledby="timeline-heading">
          <div className="flex items-center justify-between px-4 py-4">
            <div>
              <h2 id="timeline-heading" className="text-[15px] font-semibold">
                Activity
              </h2>
              <p className="mt-0.5 text-[11px] text-[var(--foreground-muted)]">Durable event timeline</p>
            </div>
            <span className="inline-flex items-center gap-1.5 text-[10px] text-[var(--foreground-muted)]">
              <span className="pulse-dot size-1.5 rounded-full bg-[var(--success)]" /> Live
            </span>
          </div>
          <div className="scrollbar-quiet max-h-[min(70vh,760px)] overflow-y-auto border-t border-[var(--border)] px-4">
            {events.isLoading ? (
              <div className="space-y-3 py-4">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div key={index} className="flex gap-3">
                    <Skeleton className="size-7 rounded-full" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-3.5 w-full" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <ActivityList
                events={events.data?.events ?? []}
                limit={30}
                empty={
                  <p className="py-8 text-center text-[12px] leading-5 text-[var(--foreground-muted)]">
                    No events yet. Run the task to see reservations, payments and delivery.
                  </p>
                }
              />
            )}
          </div>
          <div className="border-t border-[var(--border)] px-4 py-3">
            <Link
              href="/app/demo"
              className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--foreground-secondary)] hover:text-[var(--foreground)]"
            >
              <FlaskConical className="size-3.5" /> Open guided demo lab
              <ChevronRight className="size-3" />
            </Link>
          </div>
        </aside>
      </motion.div>

      {selectedOperation ? (
        <OperationDrawer
          operationId={selectedOperation.id}
          open={Boolean(selectedOperation)}
          onOpenChange={(open) => {
            if (!open) setSelectedOperation(null);
          }}
        />
      ) : null}

      <RunTaskDialog task={task} open={runOpen} onOpenChange={setRunOpen} />
    </motion.div>
  );
}
