"use client";

import { AlertTriangle, ExternalLink } from "lucide-react";
import { motion } from "motion/react";
import { AnimatedNear } from "@/components/ui/animated-number";
import { spring } from "@/lib/motion";
import { near, progressPercent } from "@/lib/utils";
import type { Task } from "@/lib/types";

export function BudgetPanel({ task }: { task: Task }) {
  const { budget } = task;
  const segments = [
    {
      key: "available",
      label: "Available",
      value: budget.availableYocto,
      className: "bg-[#4d6042]",
    },
    {
      key: "reserved",
      label: "Reserved",
      value: budget.reservedYocto,
      className: "bg-[#c08a3e]",
    },
    {
      key: "spent",
      label: "Spent",
      value: budget.spentYocto,
      className: "bg-[#20211f]",
    },
    {
      key: "withdrawn",
      label: "Withdrawn",
      value: budget.withdrawnYocto,
      className: "bg-[#b9bbb2]",
    },
    {
      key: "withdrawal_pending",
      label: "Withdrawal pending",
      value: budget.withdrawalPendingYocto,
      className: "bg-[#8fa3b8]",
    },
  ].filter((segment) => segment.value !== "0");
  const total = budget.totalFundedYocto;
  const remainingBlocks =
    task.currentBlock != null && task.policy.expiresAtBlock > task.currentBlock
      ? task.policy.expiresAtBlock - task.currentBlock
      : null;

  return (
    <section className="workspace-panel overflow-hidden" aria-labelledby="budget-heading">
      <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.65fr)]">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p id="budget-heading" className="text-[12px] font-medium text-[var(--foreground-secondary)]">
              Available to agents
            </p>
            <span className="rounded-[4px] bg-[var(--surface-muted)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--foreground-muted)]">
              testNEAR
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-baseline gap-2">
            <span className="financial-value text-[34px] font-medium leading-none tracking-[-0.03em] sm:text-[38px]">
              <AnimatedNear yocto={budget.availableYocto} />
            </span>
            <span className="text-[13px] text-[var(--foreground-secondary)]">testNEAR</span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[12px] text-[var(--foreground-muted)]">
            <span>
              Funded <strong className="financial-value font-medium text-[var(--foreground-secondary)]">{near(total)}</strong>
            </span>
            <span>
              Spent <strong className="financial-value font-medium text-[var(--foreground-secondary)]">{near(budget.spentYocto)}</strong>
            </span>
            <span>
              Reserved <strong className="financial-value font-medium text-[var(--foreground-secondary)]">{near(budget.reservedYocto)}</strong>
            </span>
          </div>
          <p className="mt-2 text-[11px] text-[var(--foreground-muted)]">
            Balances are testnet tokens with no monetary value. Amounts are exact integers.
          </p>
        </div>

        <dl className="grid grid-cols-2 gap-x-5 gap-y-3 border-t border-[var(--border)] pt-5 text-[12px] lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
          <div>
            <dt className="text-[var(--foreground-muted)]">Source</dt>
            <dd className="mt-1 font-medium">
              {budget.source === "chain" ? "Contract view" : "Last verified projection"}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--foreground-muted)]">Policy</dt>
            <dd className="mt-1">
              <a href="#policy" className="inline-flex items-center gap-1 font-medium text-[var(--accent)] hover:underline">
                Version {task.policy.version} <ExternalLink className="size-3" />
              </a>
            </dd>
          </div>
          <div>
            <dt className="text-[var(--foreground-muted)]">Task expiry</dt>
            <dd className="mt-1 font-medium">Block {task.policy.expiresAtBlock.toLocaleString()}</dd>
            <dd className="text-[11px] text-[var(--foreground-muted)]">
              {remainingBlocks != null ? `~${remainingBlocks.toLocaleString()} blocks remaining` : "Past expiry"}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--foreground-muted)]">Invariant</dt>
            <dd className="mt-1 font-medium">
              {budget.invariantHolds === true
                ? "Conserved"
                : budget.invariantHolds === false
                  ? "Mismatch"
                  : "Not checked in cache"}
            </dd>
          </div>
        </dl>
      </div>

      <div className="border-t border-[var(--border)] px-5 py-4 sm:px-6">
        <div className="flex items-baseline justify-between gap-4">
          <p className="text-[12px] font-medium text-[var(--foreground-secondary)]">Accounting</p>
          <p className="text-[11px] text-[var(--foreground-muted)]">
            available + reserved + spent + withdrawn + pending = funded
          </p>
        </div>
        <div
          className="mt-2.5 flex h-2.5 w-full overflow-hidden rounded-full bg-[var(--surface-selected)]"
          role="img"
          aria-label={`Budget accounting: ${segments.map((segment) => `${segment.label} ${near(segment.value)} testNEAR`).join(", ")}`}
        >
          {segments.length === 0 ? null : (
            segments.map((segment) => (
              <motion.span
                key={segment.key}
                className={`${segment.className} h-full first:rounded-l-full last:rounded-r-full`}
                initial={{ width: 0 }}
                animate={{ width: `${Math.max(progressPercent(segment.value, total), 0.8)}%` }}
                transition={spring.gentle}
                title={`${segment.label}: ${near(segment.value)} testNEAR`}
              />
            ))
          )}
        </div>
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
          {segments.length === 0 ? (
            <li className="text-[11px] text-[var(--foreground-muted)]">No funds have been added yet.</li>
          ) : (
            segments.map((segment) => (
              <li key={segment.key} className="flex items-center gap-1.5 text-[11px] text-[var(--foreground-secondary)]">
                <span aria-hidden className={`size-2 rounded-[2px] ${segment.className}`} />
                {segment.label}
                <span className="financial-value text-[var(--foreground-muted)]">{near(segment.value)}</span>
              </li>
            ))
          )}
        </ul>
        {budget.withdrawalPendingYocto !== "0" ? (
          <div className="mt-3 flex items-start gap-2 rounded-[8px] bg-[var(--info-background)] px-3 py-2 text-[11px] leading-4 text-[var(--info)]">
            <AlertTriangle className="mt-0.5 size-3 shrink-0" />
            A withdrawal is awaiting its transfer callback. Its amount is tracked separately and is
            not available to agents.
          </div>
        ) : null}
        {budget.stale ? (
          <p className="mt-3 text-[11px] text-[var(--warning)]">
            Chain read failed. Showing the last verified projection
            {budget.checkedAt ? ` from ${new Date(budget.checkedAt).toLocaleTimeString()}` : ""}.
          </p>
        ) : null}
      </div>
    </section>
  );
}
