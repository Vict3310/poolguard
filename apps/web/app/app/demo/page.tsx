"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  CircleCheck,
  FlaskConical,
  Play,
  RefreshCw,
  ShieldAlert,
  WifiOff,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, near } from "@/lib/utils";
import { AnimatePresence, motion } from "motion/react";
import { duration, ease, rise, spring, stagger } from "@/lib/motion";
import { feedback } from "@/lib/feedback";
import { DrawnCheck } from "@/components/ui/drawn-check";
import type { DemoResponse, TaskSummary } from "@/lib/types";

const SCENARIOS = [
  {
    key: "A" as const,
    title: "Permitted purchase",
    description:
      "Both agents select the paid extraction service, reserve within policy, pay once each, and consume the structured result.",
    expectation: "Two payments, two delivered results, shared budget reduced by both.",
    suitable: (task: TaskSummary) => BigInt(task.availableYocto) >= 40_000_000_000_000_000_000_000n,
  },
  {
    key: "B" as const,
    title: "Shared-budget race",
    description:
      "Two concurrent workers each request 0.02 from a 0.03 budget. The contract serializes the reservations; only one can hold 0.02.",
    expectation: "One reservation succeeds. The other receives a structured denial and may choose the cheaper service.",
    suitable: (task: TaskSummary) =>
      BigInt(task.availableYocto) >= 30_000_000_000_000_000_000_000n &&
      BigInt(task.availableYocto) < 40_000_000_000_000_000_000_000n,
  },
  {
    key: "C" as const,
    title: "Malicious instruction",
    description:
      "One document tells the agent to pay an attacker account and raise the task limit. The text is shown as untrusted evidence, never as an instruction.",
    expectation:
      "The model ignores or reports the injection. A separate, labelled policy probe attempts a non-allowlisted provider and the contract rejects it.",
    suitable: () => true,
  },
  {
    key: "D" as const,
    title: "Lost response",
    description:
      "A labelled fault drops the execute response after the node accepted the transaction. The worker is retried; it must find the original operation.",
    expectation: "Same operation ID, same payout, recovered provider result, no second payment.",
    suitable: (task: TaskSummary) => BigInt(task.availableYocto) >= 20_000_000_000_000_000_000_000n,
  },
];

interface RunDetail {
  run_id: string;
  mode: string;
  status: string;
  agents: Array<{
    agent_id: string;
    label: string;
    account_id: string;
    status: string;
    steps: number;
    tokens_used: number;
    summary: string | null;
    denial_code: string | null;
    error: string | null;
    started_at: string | null;
    finished_at: string | null;
  }>;
}

export default function DemoLabPage() {
  const { meta } = useAuth();
  const queryClient = useQueryClient();
  const tasks = useQuery({
    queryKey: ["tasks"],
    queryFn: () => api<{ tasks: TaskSummary[] }>("/tasks"),
    refetchInterval: 8_000,
  });
  const activeTasks = (tasks.data?.tasks ?? []).filter((task) => task.status === "active");
  const [taskId, setTaskId] = React.useState<string>("");
  const selected = activeTasks.find((task) => task.id === taskId) ?? activeTasks[0];
  const [runId, setRunId] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<DemoResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!taskId && activeTasks[0]) setTaskId(activeTasks[0].id);
  }, [activeTasks, taskId]);

  const run = useMutation({
    mutationFn: (scenario: "A" | "B" | "C" | "D") => {
      if (!selected) throw new Error("Create and fund a task first.");
      return api<DemoResponse>(`/tasks/${selected.id}/demo/${scenario}`, { method: "POST" });
    },
    onSuccess: async (response) => {
      setResult(response);
      setRunId(response.run_id);
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["task", response.run_id] });
      await queryClient.invalidateQueries({ queryKey: ["tasks"] });
      await queryClient.invalidateQueries({ queryKey: ["overview"] });
    },
    onError: (mutationError) => {
      setError(mutationError instanceof ApiError ? mutationError.message : "The scenario could not be started.");
    },
  });

  const detail = useQuery({
    queryKey: ["run", runId],
    queryFn: () => api<RunDetail>(`/runs/${runId}`),
    enabled: Boolean(runId),
    refetchInterval: (query) => {
      const value = query.state.data;
      return value && (value.status === "queued" || value.status === "running") ? 1_500 : false;
    },
  });

  const completed = detail.data?.status === "succeeded" || detail.data?.status === "failed" || detail.data?.status === "partial";
  const outputRef = React.useRef<HTMLElement>(null);
  const announced = React.useRef<string | null>(null);

  // Bring the output into view when a scenario starts, and give one success/error beat when it ends.
  React.useEffect(() => {
    if (result) outputRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [result]);
  React.useEffect(() => {
    if (!completed || !runId || announced.current === runId) return;
    announced.current = runId;
    feedback(detail.data?.status === "succeeded" ? "success" : "error");
  }, [completed, runId, detail.data?.status]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[11px] text-[var(--foreground-secondary)]">
            <FlaskConical className="size-3" /> Guided demo lab
          </span>
        }
        title="Four failure modes, one contract."
        description="These controls execute real reservations and payments on the configured network. They do not bypass authentication, policies or contract checks."
        actions={
          <Button variant="secondary" size="sm" onClick={() => void tasks.refetch()} loading={tasks.isFetching}>
            <RefreshCw /> Refresh
          </Button>
        }
      />

      <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3 text-[12px] leading-5 text-[var(--foreground-secondary)]">
        <strong className="font-medium text-[var(--foreground)]">Not a recording.</strong>{" "}
        {meta?.sandbox
          ? "This local sandbox executes the Rust contract on a real NEAR node. Transactions are not public testnet evidence."
          : "Every scenario runs against NEAR testnet and produces transaction hashes you can inspect."}{" "}
        {meta?.aiConfigured
          ? "Live model mode is configured."
          : "AI_API_KEY is not configured, so runs use a clearly labelled scripted fixture; the contract and provider are still real."}
      </div>

      <section className="workspace-panel p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="w-full sm:max-w-md">
            <label htmlFor="demo-task" className="text-[12px] font-medium">
              Demo task
            </label>
            <p className="mt-0.5 text-[11px] text-[var(--foreground-muted)]">
              Only active, funded tasks are listed. Scenario B expects 0.03 testNEAR remaining.
            </p>
            <Select
              id="demo-task"
              className="mt-2"
              value={selected?.id ?? ""}
              onChange={(event) => setTaskId(event.target.value)}
              disabled={activeTasks.length === 0}
            >
              {activeTasks.length === 0 ? <option value="">No active task</option> : null}
              {activeTasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.name} — {near(task.availableYocto)} available
                </option>
              ))}
            </Select>
          </div>
          {selected ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--foreground-muted)]">
              <span>
                Budget <span className="financial-value text-[var(--foreground-secondary)]">{near(selected.availableYocto)}</span>
              </span>
              <span>Policy enforced on chain</span>
              <Link href={`/app/tasks/${selected.id}`} className="inline-flex items-center gap-1 font-medium text-[var(--action)] hover:text-[var(--action-hover)] hover:underline">
                Open task <ArrowRight className="size-3" />
              </Link>
            </div>
          ) : null}
        </div>
        {activeTasks.length === 0 && !tasks.isLoading ? (
          <div className="mt-4 flex items-start gap-2 rounded-[8px] bg-[var(--warning-background)] px-3 py-2 text-[12px] text-[var(--warning)]">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>
              No active task. <Link href="/app/tasks/new" className="font-medium underline">Create and fund one</Link>{" "}
              before running a scenario.
            </span>
          </div>
        ) : null}
      </section>

      <motion.div className="grid gap-4 lg:grid-cols-2" initial="hidden" animate="show" variants={stagger(0.07)}>
        {SCENARIOS.map((scenario) => {
          const suitable = selected ? scenario.suitable(selected) : false;
          const isRunning = run.isPending && run.variables === scenario.key;
          const isLatest = result?.scenario === scenario.key && !completed;
          const dimmed = run.isPending && !isRunning;
          return (
            <motion.section
              key={scenario.key}
              variants={rise}
              className={cn(
                "workspace-panel lift relative flex flex-col overflow-hidden p-5 transition-opacity duration-300",
                dimmed && "opacity-55",
                (isRunning || isLatest) && "border-[var(--foreground)]/30",
              )}
            >
              {isRunning || isLatest ? (
                <span aria-hidden className="shimmer pointer-events-none absolute inset-x-0 top-0 h-0.5" />
              ) : null}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="flex size-8 items-center justify-center rounded-[7px] border border-[var(--border)] bg-[var(--surface-muted)] text-[12px] font-semibold">
                    {scenario.key}
                  </span>
                  <h2 className="text-[15px] font-semibold">{scenario.title}</h2>
                </div>
                {scenario.key === "D" ? (
                  <span className="rounded-[4px] bg-[var(--warning-background)] px-1.5 py-1 text-[10px] font-medium text-[var(--warning)]">
                    Labelled fault
                  </span>
                ) : null}
              </div>
              <p className="mt-3 text-[12px] leading-5 text-[var(--foreground-secondary)]">{scenario.description}</p>
              <p className="mt-2 flex-1 text-[11px] leading-5 text-[var(--foreground-muted)]">
                <span className="font-medium text-[var(--foreground-secondary)]">Observe:</span> {scenario.expectation}
              </p>
              {!suitable && selected ? (
                <p className="mt-2 text-[10px] leading-4 text-[var(--warning)]">
                  Recommended remaining budget: {scenario.key === "A" ? "0.04" : scenario.key === "B" ? "0.03" : "0.02"}{" "}
                  testNEAR. This task may produce a partial run instead.
                </p>
              ) : null}
              <Button
                className="mt-4 w-full sm:w-auto"
                variant={scenario.key === "B" || scenario.key === "D" ? "secondary" : "action"}
                onClick={() => {
                  setError(null);
                  run.mutate(scenario.key);
                }}
                loading={isRunning}
                disabled={!selected || run.isPending}
              >
                <Play /> Run scenario {scenario.key}
              </Button>
            </motion.section>
          );
        })}
      </motion.div>

      {error ? (
        <div className="flex items-start gap-2 rounded-[8px] border border-[var(--danger)]/30 bg-[var(--danger-background)] px-4 py-3 text-[12px] leading-5 text-[var(--danger)]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {error}
        </div>
      ) : null}

      <AnimatePresence>
      {result ? (
        <motion.section
          ref={outputRef}
          key={result.run_id}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: duration.slow, ease }}
          className="workspace-panel scroll-mt-24 overflow-hidden"
        >
          <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
            <div>
              <h2 className="text-[15px] font-semibold">Scenario {result.scenario} output</h2>
              <p className="mt-0.5 text-[12px] text-[var(--foreground-secondary)]">{result.notice}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-[var(--border)] px-2.5 py-1 text-[11px] text-[var(--foreground-secondary)]">
                {result.mode === "live" ? "Live model" : "Scripted fixture"}
              </span>
              {detail.data ? <StatusBadge kind="run" value={detail.data.status} /> : null}
            </div>
          </div>

          {result.scenario === "C" && result.policy_probe ? (
            <div className="border-t border-[var(--border)] bg-[var(--danger-background)] px-5 py-4">
              <p className="flex items-center gap-2 text-[12px] font-medium text-[var(--danger)]">
                <ShieldAlert className="size-4" /> Contract policy probe
              </p>
              <p className="mt-1 text-[12px] leading-5 text-[var(--danger)]">
                {result.policy_probe.denied
                  ? `Denied with ${result.policy_probe.code} for provider ${result.policy_probe.attempted_provider ?? "unknown"}. The reservation never existed on chain.`
                  : result.policy_probe.error
                    ? `Probe unavailable: ${result.policy_probe.error}`
                    : `Probe unexpectedly succeeded (${result.policy_probe.code ?? "unknown"}); it was cancelled and should be investigated.`}
              </p>
              {result.policy_probe.tx_hash ? (
                <p className="mono mt-1 break-all text-[10px] text-[var(--danger)]">
                  Failed transaction: {result.policy_probe.tx_hash}
                </p>
              ) : null}
              <p className="mt-2 text-[11px] leading-5 text-[var(--danger)]">
                This is a separate adversarial request, not evidence that the model followed the
                document. The model may correctly ignore the text; the contract check proves the
                boundary either way.
              </p>
            </div>
          ) : null}

          <div className="border-t border-[var(--border)] px-5 py-4">
            {detail.isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-4 w-56" />
                <Skeleton className="h-4 w-full" />
              </div>
            ) : detail.error ? (
              <p className="text-[12px] text-[var(--danger)]">
                {detail.error instanceof ApiError ? detail.error.message : "Run status unavailable."}
              </p>
            ) : detail.data ? (
              <div className="space-y-3">
                <p className="flex items-center gap-1.5 text-[11px] text-[var(--foreground-muted)]">
                  {completed ? (
                    <DrawnCheck className="size-3.5 text-[var(--success)]" />
                  ) : (
                    <span className="pulse-dot size-1.5 rounded-full bg-[var(--accent)]" />
                  )}
                  {completed ? "Run finished." : "Run in progress. The timeline below updates automatically."}
                </p>
                {result.scenario === "B" ? <RaceViz agents={detail.data.agents} done={completed} /> : null}
                {detail.data.agents.map((agent) => (
                  <motion.div
                    key={agent.agent_id}
                    layout
                    className={cn(
                      "rounded-[8px] border p-3.5 transition-colors duration-300",
                      agent.denial_code ? "shake border-[var(--danger)]/30" : "border-[var(--border)]",
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[13px] font-medium">{agent.label}</p>
                      <StatusBadge kind="run" value={agent.status} />
                    </div>
                    <p className="mono mt-0.5 text-[10px] text-[var(--foreground-muted)]">{agent.account_id}</p>
                    <p className="mt-2 text-[12px] leading-5 text-[var(--foreground-secondary)]">
                      {agent.summary ?? agent.error ?? "No summary yet."}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-x-3 text-[10px] text-[var(--foreground-muted)]">
                      <span>{agent.steps} steps</span>
                      <span>{agent.tokens_used.toLocaleString()} tokens</span>
                      {agent.denial_code ? <span className="text-[var(--danger)]">{agent.denial_code}</span> : null}
                    </div>
                  </motion.div>
                ))}
                {detail.data.status === "failed" ? (
                  <p className="flex items-center gap-1.5 text-[12px] text-[var(--danger)]">
                    <WifiOff className="size-3.5" /> The run ended with a failure. See each agent summary.
                  </p>
                ) : null}
                {detail.data.status === "succeeded" ? (
                  <p className="flex items-center gap-1.5 text-[12px] text-[var(--success)]">
                    <CircleCheck className="size-3.5" /> Run finished. Payments and deliveries remain separate
                    records in the task timeline.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          {selected ? (
            <div className="border-t border-[var(--border)] px-5 py-3">
              <Link
                href={`/app/tasks/${selected.id}`}
                className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--action)] hover:text-[var(--action-hover)] hover:underline"
              >
                Inspect the full task, budget and operation evidence <ArrowRight className="size-3.5" />
              </Link>
            </div>
          ) : null}
        </motion.section>
      ) : null}
      </AnimatePresence>

      <section className="workspace-panel p-5">
        <h2 className="text-[14px] font-semibold">Manual worker-restart rehearsal</h2>
        <p className="mt-1 max-w-3xl text-[12px] leading-5 text-[var(--foreground-secondary)]">
          For scenario D, a labelled fault drops the response after submission. The worker job is
          retried automatically. To prove restart recovery explicitly, stop the worker process during
          the run, then start it again. The job lease expires, the same job is re-claimed, and recovery
          reads the original operation from chain. No new payment is created. The exact commands are in{" "}
          <span className="mono text-[11px]">docs/DEMO.md</span>.
        </p>
      </section>
    </div>
  );
}

/**
 * Scenario B, drawn: two agents race for one 0.03 pool that only fits one 0.02 reservation.
 * The lane with a denial code turns red; the other reaches the pool.
 */
function RaceViz({ agents, done }: { agents: RunDetail["agents"]; done: boolean }) {
  const anyDenied = agents.some((agent) => agent.denial_code);
  return (
    <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface-muted)] p-4" aria-label="Shared-budget race visualization">
      <div className="flex items-center justify-between text-[11px] text-[var(--foreground-muted)]">
        <span className="font-medium text-[var(--foreground-secondary)]">Race for the shared pool</span>
        <span className="financial-value">pool 0.03 · each asks 0.02</span>
      </div>
      <div className="mt-3 space-y-2.5">
        {agents.map((agent, index) => {
          const denied = Boolean(agent.denial_code);
          const finished = agent.status !== "queued" && agent.status !== "running";
          const progress = denied ? 62 : finished || (done && !denied) ? 100 : anyDenied ? 100 : 45 + index * 8;
          return (
            <div key={agent.agent_id} className="grid grid-cols-[80px_minmax(0,1fr)_92px] items-center gap-3">
              <span className="truncate text-[12px] font-medium">{agent.label}</span>
              <div className="relative h-2 rounded-full bg-[var(--surface-selected)]">
                <motion.div
                  className={cn("absolute inset-y-0 left-0 rounded-full", denied ? "bg-[var(--danger)]" : "bg-[var(--accent)]")}
                  initial={{ width: "0%" }}
                  animate={{ width: `${progress}%` }}
                  transition={spring.gentle}
                />
              </div>
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={denied ? "denied" : progress === 100 ? "won" : "racing"}
                  initial={{ opacity: 0, x: 6 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: duration.fast }}
                  className={cn(
                    "mono truncate text-right text-[10px]",
                    denied ? "text-[var(--danger)]" : progress === 100 ? "text-[var(--success)]" : "text-[var(--foreground-muted)]",
                  )}
                >
                  {denied ? "denied" : progress === 100 ? "reserved" : "racing…"}
                </motion.span>
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
}
