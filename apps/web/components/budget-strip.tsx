"use client";

import { motion } from "motion/react";
import { AnimatedNear } from "@/components/ui/animated-number";
import { progressPercent } from "@/lib/utils";
import { spring } from "@/lib/motion";

export function BudgetStrip({
  availableYocto,
  reservedYocto,
  spentYocto,
  taskCount,
}: {
  availableYocto: string;
  reservedYocto: string;
  spentYocto: string;
  taskCount: number;
}) {
  const values = [
    { label: "Available", value: availableYocto, hint: "Ready to reserve", dot: "bg-[var(--accent)]" },
    { label: "Reserved", value: reservedYocto, hint: "Held for open operations", dot: "bg-[#f2b34a]" },
    { label: "Spent", value: spentYocto, hint: "Settled payouts", dot: "bg-[var(--foreground)]" },
  ];
  let total = "0";
  try {
    total = (BigInt(availableYocto) + BigInt(reservedYocto) + BigInt(spentYocto)).toString();
  } catch {
    total = "0";
  }
  const spentPct = progressPercent(spentYocto, total);
  const reservedPct = progressPercent(reservedYocto, total);
  const availablePct = total === "0" ? 0 : Math.max(0, 100 - spentPct - reservedPct);

  return (
    <section aria-label="Shared financial summary" className="workspace-panel overflow-hidden">
      <div className="grid divide-y divide-[var(--border)] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {values.map((item, index) => (
          <motion.div
            key={item.label}
            className="px-5 py-5 sm:px-6"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1], delay: index * 0.06 }}
          >
            <div className="flex items-baseline justify-between gap-2">
              <p className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--foreground-secondary)]">
                <span className={`size-1.5 rounded-full ${item.dot}`} />
                {item.label}
              </p>
              <p className="text-[11px] text-[var(--foreground-muted)]">{item.hint}</p>
            </div>
            <p className="financial-value mt-2 text-[28px] font-medium leading-none tracking-[-0.02em] sm:text-[30px]">
              <AnimatedNear yocto={item.value} />
            </p>
            <p className="mt-1.5 text-[11px] text-[var(--foreground-muted)]">testNEAR · no monetary value</p>
          </motion.div>
        ))}
      </div>
      <div className="px-5 pb-4 sm:px-6" aria-hidden>
        <div className="flex h-1.5 overflow-hidden rounded-full bg-[var(--surface-selected)]">
          <motion.div className="h-full bg-[var(--foreground)]" initial={{ width: 0 }} animate={{ width: `${spentPct}%` }} transition={spring.gentle} />
          <motion.div className="h-full bg-[#f2b34a]" initial={{ width: 0 }} animate={{ width: `${reservedPct}%` }} transition={spring.gentle} />
          <motion.div className="h-full bg-[var(--accent)]" initial={{ width: 0 }} animate={{ width: `${availablePct}%` }} transition={spring.gentle} />
        </div>
      </div>
      <div className="border-t border-[var(--border)] bg-[var(--surface-muted)] px-5 py-2.5 text-[11px] leading-4 text-[var(--foreground-muted)] sm:px-6">
        Projection across {taskCount} {taskCount === 1 ? "task" : "tasks"} owned by this account.
        Open a task to read its current on-chain balance.
      </div>
    </section>
  );
}
