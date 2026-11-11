"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, ChevronsUpDown, Users } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { TaskAvatar } from "@/components/task-avatar";
import { cn, near, progressPercent, relative, shortId } from "@/lib/utils";
import type { TaskSummary } from "@/lib/types";

type SortKey = "name" | "available" | "spent" | "updated";

function big(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

/** Share of the funded budget that is still available, and share already spent. */
export function budgetShares(task: Pick<TaskSummary, "totalFundedYocto" | "availableYocto" | "spentYocto">) {
  return {
    availablePct: progressPercent(task.availableYocto, task.totalFundedYocto),
    spentPct: progressPercent(task.spentYocto, task.totalFundedYocto),
  };
}

export function PctPill({ value, tone, prefix }: { value: number; tone: "up" | "down" | "flat"; prefix?: string }) {
  return (
    <span className={cn("pill", tone === "up" ? "pill-up" : tone === "down" ? "pill-down" : "pill-flat")}>
      {prefix}
      {value.toFixed(value >= 10 || value === 0 ? 1 : 2)}%
    </span>
  );
}

function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
  align = "left",
}: {
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; dir: "asc" | "desc" };
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = sort.key === sortKey;
  return (
    <th scope="col" aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className={cn("px-4 py-4 font-normal", align === "right" && "text-right")}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn("inline-flex items-center gap-1.5 transition-colors hover:text-[var(--foreground)]", active && "text-[var(--foreground)]")}
      >
        {label}
        <ChevronsUpDown className="size-3.5 opacity-70" />
      </button>
    </th>
  );
}

export function TaskTable({ tasks }: { tasks: TaskSummary[] }) {
  const [sort, setSort] = React.useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "updated", dir: "desc" });
  const onSort = (key: SortKey) =>
    setSort((current) => ({ key, dir: current.key === key && current.dir === "desc" ? "asc" : "desc" }));

  const sorted = React.useMemo(() => {
    const rows = [...tasks];
    const dir = sort.dir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      switch (sort.key) {
        case "name":
          return a.name.localeCompare(b.name) * dir;
        case "available": {
          const x = big(a.availableYocto);
          const y = big(b.availableYocto);
          return (x === y ? 0 : x > y ? 1 : -1) * dir;
        }
        case "spent":
          return (budgetShares(a).spentPct - budgetShares(b).spentPct) * dir;
        default:
          return (new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()) * dir;
      }
    });
    return rows;
  }, [tasks, sort]);

  return (
    <>
      <div className="scrollbar-quiet hidden overflow-x-auto md:block">
        <table className="w-full min-w-[820px] border-collapse text-left">
          <thead>
            <tr className="border-b border-[var(--border)] text-[13px] text-[var(--foreground-muted)]">
              <th scope="col" className="w-16 py-4 pl-6 pr-2 font-normal">
                No
              </th>
              <SortHeader label="Task name" sortKey="name" sort={sort} onSort={onSort} />
              <SortHeader label="Available" sortKey="available" sort={sort} onSort={onSort} />
              <th scope="col" className="px-4 py-4 font-normal">
                Left
              </th>
              <SortHeader label="Spent" sortKey="spent" sort={sort} onSort={onSort} />
              <th scope="col" className="px-4 py-4 font-normal">
                Agents
              </th>
              <th scope="col" className="px-4 py-4 font-normal">
                Status
              </th>
              <SortHeader label="Updated" sortKey="updated" sort={sort} onSort={onSort} />
              <th scope="col" className="w-12 py-4 pr-5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {sorted.map((task, index) => {
              const shares = budgetShares(task);
              return (
                <tr key={task.id} className="group h-[74px] transition-colors duration-150 hover:bg-[rgb(255_255_255_/_2%)]">
                  <td className="py-2 pl-6 pr-2 text-[13px] text-[var(--foreground-muted)]">#{index + 1}</td>
                  <td className="w-[34%] max-w-0 px-4 py-2">
                    <Link href={`/app/tasks/${task.id}`} className="flex min-w-0 items-center gap-3">
                      <TaskAvatar id={task.id} name={task.name} />
                      <span className="flex min-w-0 items-baseline gap-2">
                        <span className="truncate text-[15px] font-medium text-[var(--foreground)] group-hover:underline group-hover:underline-offset-4">
                          {task.name}
                        </span>
                        <span className="mono shrink-0 text-[11px] uppercase text-[var(--foreground-muted)]">
                          {task.chainTaskId.slice(0, 6)}
                        </span>
                      </span>
                    </Link>
                  </td>
                  <td className="financial-value px-4 py-2 text-[14px] text-[var(--foreground)]">{near(task.availableYocto)} Ⓝ</td>
                  <td className="px-4 py-2">
                    <PctPill value={shares.availablePct} tone={shares.availablePct > 0 ? "up" : "flat"} prefix="+" />
                  </td>
                  <td className="px-4 py-2">
                    <PctPill value={shares.spentPct} tone={shares.spentPct > 0 ? "down" : "flat"} prefix={shares.spentPct > 0 ? "−" : ""} />
                  </td>
                  <td className="px-4 py-2">
                    <span className="inline-flex items-center gap-1.5 text-[13px] text-[var(--foreground-secondary)]">
                      <Users className="size-3.5 text-[var(--foreground-muted)]" />
                      {task.agentCount}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <StatusBadge kind="task" value={task.status} />
                      {task.pendingRecoveries > 0 ? <span className="pill bg-[var(--warning-background)] text-[var(--warning)]">{task.pendingRecoveries} to check</span> : null}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-[13px] text-[var(--foreground-muted)]">{relative(task.updatedAt)}</td>
                  <td className="py-2 pr-5 text-right">
                    <Link
                      href={`/app/tasks/${task.id}`}
                      aria-label={`Open ${task.name}`}
                      className="inline-flex size-9 items-center justify-center rounded-[10px] border border-transparent text-[var(--foreground-muted)] transition-colors hover:border-[var(--border)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]"
                    >
                      <ArrowUpRight className="size-4" />
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-[var(--border)] md:hidden">
        {sorted.map((task, index) => {
          const shares = budgetShares(task);
          return (
            <li key={task.id}>
              <Link href={`/app/tasks/${task.id}`} className="flex items-center gap-3 px-4 py-4 hover:bg-[rgb(255_255_255_/_2%)]">
                <span className="w-6 text-[12px] text-[var(--foreground-muted)]">#{index + 1}</span>
                <TaskAvatar id={task.id} name={task.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium">{task.name}</p>
                  <p className="mt-0.5 flex items-center gap-2 text-[11px] text-[var(--foreground-muted)]">
                    <StatusBadge kind="task" value={task.status} />
                    <span>{relative(task.updatedAt)}</span>
                  </p>
                </div>
                <div className="text-right">
                  <p className="financial-value text-[14px]">{near(task.availableYocto)} Ⓝ</p>
                  <div className="mt-1">
                    <PctPill value={shares.spentPct} tone={shares.spentPct > 0 ? "down" : "flat"} prefix={shares.spentPct > 0 ? "−" : ""} />
                  </div>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
