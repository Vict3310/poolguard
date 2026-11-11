"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { motion } from "motion/react";
import { ArrowUpRight, Copy, FlaskConical, MoreVertical, TrendingDown, TrendingUp } from "lucide-react";
import { api, copyText } from "@/lib/api";
import { TaskTile, taskTone } from "@/components/task-avatar";
import { useMotionReduced } from "@/components/preferences-provider";
import { cn, near, progressPercent } from "@/lib/utils";
import type { Task, TaskSummary } from "@/lib/types";

function toNear(yocto: string): number {
  try {
    return Number(BigInt(yocto) / 10n ** 18n) / 1e6;
  } catch {
    return 0;
  }
}

/**
 * Budget remaining after each paid purchase, oldest first. Real data from the
 * task's operations; a task with no purchases is a flat line at its funding.
 */
function budgetSeries(task: TaskSummary, detail: Task | undefined) {
  const funded = toNear(task.totalFundedYocto);
  const paid = (detail?.operations ?? [])
    .filter((operation) => operation.paymentState.toUpperCase() === "PAID")
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const points = [funded];
  let left = funded;
  for (const operation of paid) {
    left -= toNear(operation.amountYocto);
    points.push(Math.max(0, left));
  }
  return { points, lastChange: paid.length ? -toNear(paid[paid.length - 1]!.amountYocto) : 0 };
}

function Sparkline({ points, color, lastChange, id }: { points: number[]; color: string; lastChange: number; id: string }) {
  const reduced = useMotionReduced();
  const width = 400;
  const height = 150;
  const series = points.length === 1 ? [points[0]!, points[0]!] : points;
  const max = Math.max(...series);
  const min = Math.min(...series);
  const span = max - min || 1;
  const xy = series.map((value, index) => {
    const x = 14 + (index / (series.length - 1)) * (width - 40);
    const y = 28 + (1 - (value - min) / span) * (height - 56);
    return [x, points.length === 1 ? height / 2 : y] as const;
  });
  const line = xy.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  const markers = xy.length > 2 ? [xy[xy.length - 2]!, xy[xy.length - 1]!] : [xy[xy.length - 1]!];
  const last = markers[markers.length - 1]!;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full overflow-visible" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={`fill-${id}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
        <pattern id={`dots-${id}`} width="7" height="7" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.8" fill="rgb(255 255 255 / 0.08)" />
        </pattern>
      </defs>
      <motion.path
        d={area}
        fill={`url(#fill-${id})`}
        initial={reduced ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, delay: 0.3 }}
      />
      <path d={area} fill={`url(#dots-${id})`} />
      <motion.path
        d={line}
        fill="none"
        stroke={color}
        strokeOpacity="0.75"
        strokeWidth="2"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        initial={reduced ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
      />
      {markers.map(([x, y], index) => (
        <g key={index}>
          <circle cx={x} cy={y} r="7" fill="#0b0b0e" stroke="rgb(255 255 255 / 0.35)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          <circle cx={x} cy={y} r="2.6" fill="#ffffff" />
        </g>
      ))}
      {lastChange ? (
        <text x={Math.min(last[0], width - 70)} y={Math.max(14, last[1] - 18)} fill="#f4f4f6" fontSize="13" fontFamily="var(--font-sans)">
          − {Math.abs(lastChange).toFixed(3)}
        </text>
      ) : null}
    </svg>
  );
}

/** Splits a formatted amount so its last digits can fade, like the reference prices. */
function FadedAmount({ value }: { value: string }) {
  const cut = Math.max(1, Math.ceil(value.length * 0.55));
  return (
    <span className="financial-value">
      <span className="text-white">{value.slice(0, cut)}</span>
      <span className="text-fade">{value.slice(cut)}</span>
    </span>
  );
}

export function BudgetCard({ task }: { task: TaskSummary }) {
  const tone = taskTone(task.id);
  const detail = useQuery({
    queryKey: ["task", task.id],
    queryFn: () => api<{ task: Task }>(`/tasks/${task.id}`).then((value) => value.task),
    staleTime: 10_000,
  });
  const { points, lastChange } = budgetSeries(task, detail.data);
  const spentPct = progressPercent(task.spentYocto, task.totalFundedYocto);
  const down = spentPct > 0;

  return (
    <article
      className="glow-card flex h-[470px] w-[min(86vw,440px)] shrink-0 snap-start flex-col"
      style={{ ["--glow" as string]: tone.glow, ["--tick" as string]: tone.solid }}
      aria-labelledby={`card-${task.id}`}
    >
      <div className="flex items-start gap-4 px-9 pt-9">
        <TaskTile id={task.id} name={task.name} />
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="mono truncate text-[13px] uppercase text-[var(--foreground-secondary)]">Task · {task.chainTaskId.slice(0, 8)}</p>
          <h3 id={`card-${task.id}`} className="mt-1 truncate text-[20px] font-medium tracking-[-0.01em]">
            <Link href={`/app/tasks/${task.id}`} className="hover:underline hover:underline-offset-4">
              {task.name}
            </Link>
          </h3>
        </div>
        <CardMenu task={task} />
      </div>

      <div className="px-9 pt-9">
        <p className="accent-tick text-[15px] text-[var(--foreground-secondary)]">Available</p>
        <p className="mt-2 text-[40px] font-medium leading-none tracking-[-0.03em]">
          <FadedAmount value={near(task.availableYocto)} />
          <span className="ml-2 text-[20px] text-[var(--foreground-muted)]">Ⓝ</span>
        </p>
        <div className="mt-5 flex items-center gap-2">
          <span className={cn("inline-flex size-10 items-center justify-center rounded-full", down ? "pill-down" : "pill-up")}>
            {down ? <TrendingDown className="size-4" /> : <TrendingUp className="size-4" />}
          </span>
          <span className={cn("pill h-10 px-4 text-[15px]", down ? "pill-down" : "pill-up")}>
            {down ? `− ${spentPct.toFixed(2)}% spent` : `+ ${(100 - spentPct).toFixed(1)}% left`}
          </span>
        </div>
      </div>

      <div className="relative mt-auto h-[150px]">
        <Sparkline points={points} color={down ? "#f87171" : tone.solid} lastChange={lastChange} id={task.id} />
      </div>
    </article>
  );
}

function CardMenu({ task }: { task: TaskSummary }) {
  const item =
    "flex cursor-pointer items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-[14px] outline-none data-[highlighted]:bg-[var(--surface-hover)]";
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" aria-label={`Actions for ${task.name}`} className="icon-tile size-11 rounded-[12px] text-[var(--foreground-secondary)] hover:text-[var(--foreground)]">
          <MoreVertical className="size-4" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={8} className="z-[60] w-52 rounded-[16px] border border-[var(--border)] bg-[#111115] p-1.5 shadow-[var(--shadow-popover)]">
          <DropdownMenu.Item asChild className={item}>
            <Link href={`/app/tasks/${task.id}`}>
              <ArrowUpRight className="size-4 text-[var(--foreground-muted)]" /> Open task
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild className={item}>
            <Link href={`/app/demo?task=${task.id}`}>
              <FlaskConical className="size-4 text-[var(--foreground-muted)]" /> Run in demo lab
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item className={item} onSelect={() => void copyText(task.chainTaskId)}>
            <Copy className="size-4 text-[var(--foreground-muted)]" /> Copy chain task id
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
