"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Plus, RefreshCw, Search } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { TaskTable } from "@/components/task-table";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PanelSkeleton } from "@/components/ui/skeleton";
import type { TaskSummary } from "@/lib/types";

export default function TasksPage() {
  const tasks = useQuery({
    queryKey: ["tasks"],
    queryFn: () => api<{ tasks: TaskSummary[] }>("/tasks"),
    refetchInterval: 8_000,
  });
  const [search, setSearch] = React.useState("");
  const filtered = (tasks.data?.tasks ?? []).filter((task) => {
    if (!search.trim()) return true;
    const query = search.trim().toLowerCase();
    return (
      task.name.toLowerCase().includes(query) ||
      task.chainTaskId.toLowerCase().includes(query) ||
      task.objective?.toLowerCase().includes(query)
    );
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tasks"
        description="One budget per task. Agents reserve from it; providers are paid from the contract only."
        actions={
          <Button asChild>
            <Link href="/app/tasks/new">
              <Plus /> Create task
            </Link>
          </Button>
        }
      />

      {tasks.isLoading ? (
        <PanelSkeleton rows={6} />
      ) : tasks.error ? (
        <div className="workspace-panel p-6">
          <div className="flex size-10 items-center justify-center rounded-[9px] bg-[var(--danger-background)] text-[var(--danger)]">
            <AlertTriangle className="size-5" />
          </div>
          <h2 className="mt-4 text-[16px] font-semibold">Tasks could not be loaded</h2>
          <p className="mt-2 text-[13px] text-[var(--foreground-secondary)]">
            {tasks.error instanceof ApiError ? tasks.error.message : "The API did not respond."}
          </p>
          <Button className="mt-4" variant="secondary" onClick={() => void tasks.refetch()}>
            <RefreshCw /> Retry
          </Button>
        </div>
      ) : (
        <section className="workspace-panel overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-[var(--border)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-[15px] font-semibold">All tasks</h2>
              <p className="mt-0.5 text-[12px] text-[var(--foreground-muted)]">
                {filtered.length} of {tasks.data?.tasks.length ?? 0} shown
              </p>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[var(--foreground-muted)]" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search tasks"
                aria-label="Search tasks"
                className="h-9 pl-8 text-[13px]"
              />
            </div>
          </div>
          {filtered.length === 0 ? (
            <EmptyState
              icon={<Search className="size-5" />}
              title={search ? "No matching tasks" : "No tasks yet"}
              description={
                search
                  ? "Try a different name or chain task id."
                  : "Create a task to give one group of agents a shared, contract-enforced budget."
              }
              action={
                search ? (
                  <Button variant="secondary" onClick={() => setSearch("")}>
                    Clear search
                  </Button>
                ) : (
                  <Button asChild>
                    <Link href="/app/tasks/new">
                      <Plus /> Create task
                    </Link>
                  </Button>
                )
              }
            />
          ) : (
            <TaskTable tasks={filtered} />
          )}
        </section>
      )}
    </div>
  );
}
