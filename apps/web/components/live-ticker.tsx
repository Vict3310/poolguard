"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { TaskAvatar } from "@/components/task-avatar";
import { useMotionReduced } from "@/components/preferences-provider";
import { near, progressPercent, shortId } from "@/lib/utils";
import type { Overview } from "@/lib/types";

type Item = { key: string; node: React.ReactNode };

/**
 * A slow, endless strip of the account's real budgets (the reference's price
 * ticker). It pauses on hover/focus and stays still under reduced motion.
 */
export function LiveTicker() {
  const reduced = useMotionReduced();
  const overview = useQuery({ queryKey: ["overview"], queryFn: () => api<Overview>("/overview"), refetchInterval: 6_000 });
  const data = overview.data;
  if (!data) return <div className="h-14 border-t border-[var(--border)]" aria-hidden />;

  const items: Item[] = [
    {
      key: "total",
      node: (
        <>
          <span className="text-[var(--foreground-secondary)]">Available</span>
          <span className="financial-value">{near(data.totals.availableYocto)} Ⓝ</span>
        </>
      ),
    },
    ...data.tasks.map((task) => {
      const spent = progressPercent(task.spentYocto, task.totalFundedYocto);
      return {
        key: task.id,
        node: (
          <Link href={`/app/tasks/${task.id}`} className="inline-flex items-center gap-3 hover:text-white">
            <TaskAvatar id={task.id} name={task.name} size="sm" />
            <span className="max-w-[180px] truncate font-medium">{task.name}</span>
            <span className="financial-value text-[var(--foreground-secondary)]">{near(task.availableYocto)} Ⓝ</span>
            {spent > 0 ? <span className="text-[13px] text-[#f87171]">−{spent.toFixed(1)}%</span> : null}
          </Link>
        ),
      };
    }),
    {
      key: "reserved",
      node: (
        <>
          <span className="text-[var(--foreground-secondary)]">Reserved</span>
          <span className="financial-value">{near(data.totals.reservedYocto)} Ⓝ</span>
        </>
      ),
    },
    {
      key: "spent",
      node: (
        <>
          <span className="text-[var(--foreground-secondary)]">Spent</span>
          <span className="financial-value">{near(data.totals.spentYocto)} Ⓝ</span>
        </>
      ),
    },
    {
      key: "contract",
      node: (
        <>
          <span className="text-[var(--foreground-secondary)]">{data.network === "sandbox" ? "Sandbox" : "Testnet"}</span>
          <span className="mono text-[13px]">{shortId(data.contractId, 18, 6)}</span>
        </>
      ),
    },
  ];

  const row = (copy: number) =>
    items.map((item) => (
      <li key={`${copy}-${item.key}`} aria-hidden={copy > 0 || undefined} className="flex shrink-0 items-center gap-3 px-6 text-[15px]">
        {item.node}
        <span aria-hidden className="ml-6 h-4 w-px bg-[var(--border-strong)]" />
      </li>
    ));

  return (
    <div
      className="group relative h-14 overflow-hidden border-t border-[var(--border)] [mask-image:linear-gradient(90deg,transparent,black_6%,black_94%,transparent)]"
      aria-label="Live budget summary"
      role="region"
    >
      {reduced ? (
        <ul className="scrollbar-quiet flex h-full items-center overflow-x-auto">{row(0)}</ul>
      ) : (
        <ul className="ticker-track flex h-full w-max items-center group-hover:[animation-play-state:paused] group-focus-within:[animation-play-state:paused]">
          {row(0)}
          {row(1)}
        </ul>
      )}
    </div>
  );
}
