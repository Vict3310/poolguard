"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { Activity, ArrowUp, RefreshCw } from "lucide-react";
import { ListPageSkeleton } from "@/components/route-skeletons";
import { spring } from "@/lib/motion";
import { feedback } from "@/lib/feedback";
import { api, ApiError } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { ActivityList } from "@/components/activity-list";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { PanelSkeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { ActivityEvent } from "@/lib/types";

const FILTERS = [
  { key: "all", label: "All events" },
  { key: "operations", label: "Operations" },
  { key: "payments", label: "Payments" },
  { key: "recovery", label: "Recovery" },
] as const;

function matches(event: ActivityEvent, filter: (typeof FILTERS)[number]["key"]): boolean {
  if (filter === "all") return true;
  if (filter === "payments") return event.type.startsWith("payment.") || event.type.startsWith("withdrawal.");
  if (filter === "recovery") return event.type.startsWith("recovery.");
  return event.type.startsWith("operation.") || event.type.startsWith("agent.") || event.type.startsWith("fulfillment.");
}

export default function ActivityPage() {
  const activity = useQuery({
    queryKey: ["activity-global"],
    queryFn: () => api<{ events: ActivityEvent[] }>("/activity"),
    refetchInterval: 5_000,
  });
  const [filter, setFilter] = React.useState<(typeof FILTERS)[number]["key"]>("all");
  const all = activity.data?.events ?? [];
  const events = all.filter((event) => matches(event, filter));
  const groups = groupByDay(events);

  // "New events" pill: count events that arrived after the user last looked at the top.
  const [seenTopId, setSeenTopId] = React.useState<string | null>(null);
  const [scrolledAway, setScrolledAway] = React.useState(false);
  React.useEffect(() => {
    const onScroll = () => setScrolledAway(window.scrollY > 240);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const topId = all[0]?.id ?? null;
  React.useEffect(() => {
    if (seenTopId === null && topId !== null) setSeenTopId(topId);
    else if (!scrolledAway && topId !== null) setSeenTopId(topId);
  }, [topId, scrolledAway, seenTopId]);
  const newCount = seenTopId ? Math.max(0, all.findIndex((event) => event.id === seenTopId)) : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Activity"
        description="A durable, append-only record of agent runs, reservations, payments, denials and recovery. Technical evidence is available per event."
        actions={
          <Button variant="secondary" onClick={() => void activity.refetch()} loading={activity.isFetching}>
            <RefreshCw /> Refresh
          </Button>
        }
      />

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Activity filters">
        {FILTERS.map((item) => {
          const active = filter === item.key;
          const count = all.filter((event) => matches(event, item.key)).length;
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => {
                setFilter(item.key);
                feedback("select");
              }}
              className={cn(
                "relative h-8 rounded-full border px-3 text-[12px] font-medium transition-colors duration-150",
                active
                  ? "border-transparent text-[var(--action)]"
                  : "border-[var(--border)] bg-[var(--surface)] text-[var(--foreground-secondary)] hover:bg-[var(--surface-hover)]",
              )}
            >
              {active ? (
                <motion.span layoutId="activity-filter" className="absolute inset-0 rounded-full bg-[var(--action-soft)] shadow-[inset_0_0_0_1px_rgb(165_166_246_/_16%)]" transition={spring.glide} />
              ) : null}
              <span className="relative inline-flex items-center gap-1.5">
                {item.label}
                {activity.data ? (
                  <span className={cn("financial-value text-[10px]", active ? "text-[var(--action)]/70" : "text-[var(--foreground-muted)]")}>{count}</span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>

      <AnimatePresence>
        {newCount > 0 && scrolledAway ? (
          <motion.button
            type="button"
            initial={{ opacity: 0, y: -12, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.95 }}
            transition={spring.snappy}
            onClick={() => {
              window.scrollTo({ top: 0, behavior: "smooth" });
              setSeenTopId(topId);
            }}
            className="fixed left-1/2 top-20 z-30 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-[var(--primary)] px-3.5 py-2 text-[12px] font-medium text-[var(--primary-foreground)] shadow-[0_8px_24px_rgb(0_0_0_/_45%)]"
          >
            <ArrowUp className="size-3.5" /> {newCount} new {newCount === 1 ? "event" : "events"}
          </motion.button>
        ) : null}
      </AnimatePresence>

      {activity.isLoading ? (
        <ListPageSkeleton label="activity" />
      ) : activity.error ? (
        <div className="workspace-panel p-6">
          <h2 className="text-[16px] font-semibold">Activity could not be loaded</h2>
          <p className="mt-2 text-[13px] text-[var(--danger)]">
            {activity.error instanceof ApiError ? activity.error.message : "The API did not respond."}
          </p>
          <Button className="mt-4" variant="secondary" onClick={() => void activity.refetch()}>
            Retry
          </Button>
        </div>
      ) : (
        <section className="workspace-panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
            <div>
              <h2 className="text-[15px] font-semibold">Event history</h2>
              <p className="mt-0.5 text-[12px] text-[var(--foreground-muted)]">
                Newest first · {events.length} of {activity.data?.events.length ?? 0}
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--foreground-muted)]">
              <span className="pulse-dot size-1.5 rounded-full bg-[var(--success)]" /> Live projection
            </span>
          </div>
          {events.length === 0 ? (
            <EmptyState
              icon={<Activity className="size-5" />}
              title={filter === "all" ? "No activity yet" : "No events in this filter"}
              description={
                filter === "all"
                  ? "Create a task and run its agents. Every financial transition will be recorded here."
                  : "Switch filters or trigger a task run to produce new events."
              }
              action={
                filter !== "all" ? (
                  <Button variant="secondary" onClick={() => setFilter("all")}>
                    Show all events
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div>
              {groups.map((group) => (
                <div key={group.label}>
                  <p className="sticky top-16 z-10 border-b border-[var(--border)] bg-[var(--surface-muted)]/95 px-5 py-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--foreground-muted)] backdrop-blur">
                    {group.label}
                  </p>
                  <div className="px-5">
                    <ActivityList events={group.events} showTask />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <p className="text-[11px] leading-5 text-[var(--foreground-muted)]">
        Event records are stored in PostgreSQL and are not financial authority. If the app database is
        lost, task balances can be rebuilt from contract views. Events preserve the operational history
        around those balances.
      </p>
    </div>
  );
}

function groupByDay(events: ActivityEvent[]): Array<{ label: string; events: ActivityEvent[] }> {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const key = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  const groups = new Map<string, { label: string; events: ActivityEvent[] }>();
  for (const event of events) {
    const date = new Date(event.createdAt);
    const k = Number.isNaN(date.getTime()) ? "unknown" : key(date);
    const label =
      k === key(today)
        ? "Today"
        : k === key(yesterday)
          ? "Yesterday"
          : k === "unknown"
            ? "Earlier"
            : new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(date);
    const group = groups.get(k) ?? { label, events: [] };
    group.events.push(event);
    groups.set(k, group);
  }
  return [...groups.values()];
}
