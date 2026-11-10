"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ActivityEvent } from "@/lib/types";

/**
 * Durable history first, live stream second. EventSource reconnects with its
 * Last-Event-ID; React Query polling is the fallback if SSE is blocked.
 */
export function useTaskEvents(taskId: string) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["task-events", taskId],
    queryFn: () => api<{ events: ActivityEvent[] }>(`/tasks/${taskId}/events`),
    refetchInterval: 8_000,
  });

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    let source: EventSource | null = null;
    try {
      source = new EventSource(`/api/tasks/${taskId}/events/stream`);
      const onActivity = (event: MessageEvent<string>) => {
        try {
          const parsed = JSON.parse(event.data) as ActivityEvent;
          queryClient.setQueryData<{ events: ActivityEvent[] }>(["task-events", taskId], (current) => {
            const existing = current?.events ?? [];
            if (existing.some((candidate) => candidate.id === parsed.id)) return current;
            return { events: [...existing, parsed].sort((a, b) => Number(a.id) - Number(b.id)) };
          });
          void queryClient.invalidateQueries({ queryKey: ["task", taskId] });
          void queryClient.invalidateQueries({ queryKey: ["overview"] });
          void queryClient.invalidateQueries({ queryKey: ["tasks"] });
        } catch {
          /* a malformed event must not break the timeline */
        }
      };
      source.addEventListener("activity", onActivity as EventListener);
      source.addEventListener("error", () => {
        /* Browser reconnects automatically; polling continues. */
      });
    } catch {
      /* SSE unsupported: polling still works */
    }
    return () => source?.close();
  }, [taskId, queryClient]);

  return query;
}
