"use client";

import { Bot, KeyRound, ShieldCheck } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { near, relative, shortId } from "@/lib/utils";
import type { Agent, Run } from "@/lib/types";

function runState(agent: Agent, run: Run | undefined): { label: string; detail: string } {
  if (agent.status === "revoked") return { label: "Revoked", detail: "Future execution is blocked." };
  if (!run) return { label: "Idle", detail: "No run yet for this agent." };
  if (run.status === "running") {
    return {
      label: "Working",
      detail: `Step ${run.steps} of 8 · ${run.mode === "live" ? "live model" : "scripted fixture"}`,
    };
  }
  if (run.status === "queued") return { label: "Queued", detail: "Waiting for a worker to claim the job." };
  if (run.status === "succeeded") {
    return {
      label: "Finished",
      detail: run.summary ?? "Run completed.",
    };
  }
  if (run.status === "partial") {
    return {
      label: run.denialCode ? "Stopped after denial" : "Stopped early",
      detail: run.summary ?? run.denialCode ?? "Run stopped before finishing.",
    };
  }
  return { label: "Failed", detail: run.error ?? run.summary ?? "Run failed." };
}

export function AgentCard({ agent, run }: { agent: Agent; run?: Run }) {
  const state = runState(agent, run);
  return (
    <section
      className={`workspace-panel lift relative flex min-w-0 flex-col overflow-hidden p-4 sm:p-5 ${run?.status === "running" ? "border-[var(--info)]/30" : ""}`}
    >
      {run?.status === "running" ? (
        <span aria-hidden className="shimmer pointer-events-none absolute inset-x-0 top-0 h-0.5 opacity-80" />
      ) : null}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={`relative flex size-8 shrink-0 items-center justify-center rounded-[7px] border border-[var(--border)] bg-[var(--surface-muted)] ${run?.status === "running" ? "text-[var(--info)]" : "text-[var(--foreground-muted)]"}`}
          >
            <Bot className="size-4" />
            {run?.status === "running" ? (
              <span className="pulse-dot absolute -right-0.5 -top-0.5 size-2 rounded-full bg-[var(--accent)]" aria-hidden />
            ) : null}
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-[14px] font-semibold">{agent.label}</h3>
            <p className="mono truncate text-[10px] text-[var(--foreground-muted)]" title={agent.accountId}>
              {shortId(agent.accountId, 14, 8)}
            </p>
          </div>
        </div>
        {run ? (
          <StatusBadge kind="run" value={run.status} />
        ) : (
          <span className="rounded-[5px] bg-[var(--surface-muted)] px-2 py-1 text-[11px] font-medium text-[var(--foreground-muted)]">
            Idle
          </span>
        )}
      </div>

      <div className="mt-4 flex-1">
        <p className="text-[13px] font-medium leading-5 text-[var(--foreground)]">{state.label}</p>
        <p className="mt-1 line-clamp-3 text-[12px] leading-5 text-[var(--foreground-secondary)]">
          {state.detail}
        </p>
        {run?.status === "running" ? (
          <div className="mt-3">
            <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-selected)]">
              <div
                className="h-full rounded-full bg-[var(--info)] transition-[width] duration-300"
                style={{ width: `${Math.min(100, Math.max(6, (run.steps / 8) * 100))}%` }}
                role="progressbar"
                aria-valuenow={run.steps}
                aria-valuemin={0}
                aria-valuemax={8}
                aria-label={`${agent.label} progress`}
              />
            </div>
          </div>
        ) : null}
        {run?.denialCode ? (
          <p className="mt-2 inline-flex rounded-[4px] bg-[var(--danger-background)] px-1.5 py-1 text-[10px] font-medium text-[var(--danger)]">
            {run.denialCode}
          </p>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-[var(--border)] pt-3 text-[10px] text-[var(--foreground-muted)]">
        <span className="inline-flex items-center gap-1">
          <KeyRound className="size-3" /> Restricted key
        </span>
        <span className={agent.keyConfigured ? "inline-flex items-center gap-1 text-[var(--success)]" : "text-[var(--warning)]"}>
          {agent.keyConfigured ? <ShieldCheck className="size-3" /> : null}
          {agent.keyConfigured ? "Signing configured" : "Signing key missing"}
        </span>
        {run?.runId ? (
          <span className="ml-auto" title={run.runId}>
            {run.finishedAt ? `Finished ${relative(run.finishedAt)}` : `Started ${relative(run.startedAt)}`}
          </span>
        ) : null}
      </div>
      {run?.tokensUsed ? (
        <p className="mt-1 text-[10px] text-[var(--foreground-muted)]">
          {run.tokensUsed.toLocaleString()} model tokens · inference billed separately
        </p>
      ) : null}
    </section>
  );
}
