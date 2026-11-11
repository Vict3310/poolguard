"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { Info, TriangleAlert, X } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Announcement {
  id: string;
  message: string;
  severity: "info" | "warning" | "danger";
}

/** Operator notices (maintenance, incidents). Dismissed per announcement for this visit. */
export function AnnouncementBanner() {
  const [dismissed, setDismissed] = React.useState<string[]>([]);
  const query = useQuery({
    queryKey: ["announcements"],
    queryFn: () => api<{ announcements: Announcement[] }>("/announcements"),
    refetchInterval: 120_000,
    retry: 0,
  });
  const visible = (query.data?.announcements ?? []).filter((item) => !dismissed.includes(item.id));
  return (
    <AnimatePresence initial={false}>
      {visible.map((item) => (
        <motion.div
          key={item.id}
          role={item.severity === "info" ? "status" : "alert"}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          className={cn(
            "overflow-hidden border-b text-[13px]",
            item.severity === "danger"
              ? "border-[var(--danger)]/25 bg-[var(--danger-background)] text-[var(--danger)]"
              : item.severity === "warning"
                ? "border-[var(--warning)]/25 bg-[var(--warning-background)] text-[var(--warning)]"
                : "border-[var(--info)]/20 bg-[var(--info-background)] text-[var(--info)]",
          )}
        >
          <div className="mx-auto flex max-w-[1440px] items-start gap-2.5 px-4 py-2.5 sm:px-6">
            {item.severity === "info" ? <Info className="mt-0.5 size-4 shrink-0" /> : <TriangleAlert className="mt-0.5 size-4 shrink-0" />}
            <p className="flex-1">{item.message}</p>
            <button
              type="button"
              onClick={() => setDismissed((current) => [...current, item.id])}
              className="rounded p-0.5 opacity-70 hover:opacity-100"
              aria-label="Dismiss announcement"
            >
              <X className="size-4" />
            </button>
          </div>
        </motion.div>
      ))}
    </AnimatePresence>
  );
}
