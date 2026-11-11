"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import {
  ShieldCheck,
  Activity,
  BadgeCheck,
  Ban,
  Banknote,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  FileCheck2,
  KeyRound,
  LockKeyhole,
  Pause,
  Play,
  ReceiptText,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  TriangleAlert,
  Undo2,
} from "lucide-react";
import type { ActivityEvent } from "@/lib/types";
import { cn, formatTime, relative, shortId } from "@/lib/utils";
import { CopyButton } from "@/components/copy-button";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  "task.created": CircleDashed,
  "task.funded": Banknote,
  "task.paused": Pause,
  "task.resumed": Play,
  "policy.updated": ShieldAlert,
  "agent.registered": KeyRound,
  "agent.revoked": Ban,
  "agent.run.started": Play,
  "agent.step": CircleDashed,
  "agent.finished": BadgeCheck,
  "operation.reserved": LockKeyhole,
  "operation.denied": Ban,
  "operation.recovered": RefreshCw,
  "payment.dispatched": ReceiptText,
  "payment.settled": CircleCheck,
  "payment.failed": CircleAlert,
  "reservation.cancelled": Undo2,
  "reservation.expired": Undo2,
  "fulfillment.processing": RefreshCw,
  "fulfillment.delivered": FileCheck2,
  "fulfillment.failed": TriangleAlert,
  "recovery.started": RefreshCw,
  "recovery.resolved": CircleCheck,
  "withdrawal.dispatched": Banknote,
  "withdrawal.settled": CircleCheck,
  "withdrawal.failed": CircleAlert,
  "demo.fault_injected": CircleAlert,
  "demo.scenario.started": Sparkles,
  "demo.scenario.finished": Sparkles,
  "sync.completed": RefreshCw,
  "ai.private_inference": ShieldCheck,
};

const TONE: Record<string, string> = {
  success: "bg-[var(--success-background)] text-[var(--success)]",
  warning: "bg-[var(--warning-background)] text-[var(--warning)]",
  danger: "bg-[var(--danger-background)] text-[var(--danger)]",
  info: "bg-[var(--info-background)] text-[var(--info)]",
  neutral: "bg-[var(--surface-muted)] text-[var(--foreground-muted)]",
};

function EventRow({ event, showTask }: { event: ActivityEvent; showTask?: boolean }) {
  const Icon = ICONS[event.type] ?? Activity;
  const [expanded, setExpanded] = React.useState(false);
  const hasData = event.data && Object.keys(event.data).length > 0;
  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: -8, backgroundColor: "rgba(77,96,66,0.07)" }}
      animate={{ opacity: 1, y: 0, backgroundColor: "rgba(77,96,66,0)" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1], backgroundColor: { duration: 1.6 } }}
      className="relative flex gap-3 py-3.5"
    >
      <span
        className={cn(
          "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full",
          TONE[event.severity] ?? TONE.neutral,
        )}
      >
        <Icon className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="text-[13px] leading-5 text-[var(--foreground)]">{event.summary}</p>
          <time
            dateTime={event.createdAt}
            title={formatTime(event.createdAt)}
            className="shrink-0 text-[11px] text-[var(--foreground-muted)]"
          >
            {relative(event.createdAt)}
          </time>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--foreground-muted)]">
          {event.actor ? <span className="mono">{shortId(event.actor, 10, 6)}</span> : null}
          {showTask && event.taskId ? (
            <Link href={`/app/tasks/${event.taskId}`} className="hover:text-[var(--foreground)] hover:underline">
              Open task
            </Link>
          ) : null}
          {event.operationId ? (
            <span className="mono text-[10px]">op {shortId(event.operationId, 8, 6)}</span>
          ) : null}
          {hasData ? (
            <button
              type="button"
              className="text-[11px] text-[var(--foreground-secondary)] underline-offset-2 hover:underline"
              onClick={() => setExpanded((value) => !value)}
              aria-expanded={expanded}
            >
              {expanded ? "Hide evidence" : "Evidence"}
            </button>
          ) : null}
        </div>
        <AnimatePresence initial={false}>
        {expanded && hasData ? (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
          <div className="relative mt-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface-muted)] p-3">
            <div className="absolute right-2 top-2">
              <CopyButton value={JSON.stringify(event.data, null, 2)} label="Copy event data" />
            </div>
            <pre className="mono max-h-64 overflow-auto whitespace-pre-wrap break-all pr-8 text-[10px] leading-5 text-[var(--foreground-secondary)]">
              {JSON.stringify(event.data, null, 2)}
            </pre>
          </div>
          </motion.div>
        ) : null}
        </AnimatePresence>
      </div>
    </motion.li>
  );
}

export function ActivityList({
  events,
  showTask = false,
  empty,
  className,
  limit,
}: {
  events: ActivityEvent[];
  showTask?: boolean;
  empty?: React.ReactNode;
  className?: string;
  limit?: number;
}) {
  const shown = limit ? events.slice(0, limit) : events;
  if (shown.length === 0) {
    return <>{empty ?? null}</>;
  }
  return (
    <ol className={cn("divide-y divide-[var(--border)]", className)}>
      <AnimatePresence initial={false}>
        {shown.map((event) => (
          <EventRow key={event.id} event={event} showTask={showTask} />
        ))}
      </AnimatePresence>
    </ol>
  );
}
