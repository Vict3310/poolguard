"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, Lock, ShieldX } from "lucide-react";
import { cn } from "@/lib/utils";
import { duration, ease, spring } from "@/lib/motion";

/**
 * A short, looping product story with clearly illustrative numbers:
 * one agent reserves from the shared pool, the second is denied because the
 * pool is too small, and the first payment settles exactly once.
 * Reduced motion shows the final frame without looping.
 */
const FRAMES = [
  {
    caption: "Two agents share one 0.03 budget.",
    available: 0.03,
    reserved: 0,
    spent: 0,
    one: "idle",
    two: "idle",
  },
  {
    caption: "Agent one reserves 0.02 before it buys.",
    available: 0.01,
    reserved: 0.02,
    spent: 0,
    one: "reserved",
    two: "idle",
  },
  {
    caption: "Agent two asks for 0.02. The contract says no.",
    available: 0.01,
    reserved: 0.02,
    spent: 0,
    one: "reserved",
    two: "denied",
  },
  {
    caption: "The provider is paid exactly once.",
    available: 0.01,
    reserved: 0,
    spent: 0.02,
    one: "paid",
    two: "denied",
  },
] as const;

type AgentState = (typeof FRAMES)[number]["one"] | (typeof FRAMES)[number]["two"];

export function PoolVignette({ className, compact = false }: { className?: string; compact?: boolean }) {
  const reduce = useReducedMotion();
  const [index, setIndex] = React.useState(reduce ? FRAMES.length - 1 : 0);

  React.useEffect(() => {
    if (reduce) {
      setIndex(FRAMES.length - 1);
      return;
    }
    const timer = window.setInterval(() => setIndex((value) => (value + 1) % FRAMES.length), 2300);
    return () => window.clearInterval(timer);
  }, [reduce]);

  const frame = FRAMES[index]!;
  const total = 0.03;
  // The loop restarts by cutting, not by animating money backwards out of "spent".
  const barTransition = index === 0 ? { duration: 0 } : spring.gentle;

  return (
    <div
      className={cn(
        "relative w-full max-w-[440px] rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[0_24px_64px_rgb(24_28_20_/_9%)]",
        className,
      )}
      role="img"
      aria-label="Illustration: two agents share one budget; the contract denies a reservation that would overspend it and pays the provider once."
    >
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-[var(--foreground-secondary)]">Shared pool</span>
        <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--foreground-muted)]">
          Illustrative
        </span>
      </div>
      <div className="mt-3 flex items-baseline gap-1.5">
        <motion.span
          key={frame.available}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: duration.base, ease }}
          className="financial-value text-[34px] font-semibold tracking-[-0.03em]"
        >
          {frame.available.toFixed(2)}
        </motion.span>
        <span className="text-[13px] text-[var(--foreground-muted)]">testNEAR available</span>
      </div>

      <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-[var(--surface-selected)]">
        <motion.div
          className="h-full bg-[var(--foreground)]"
          animate={{ width: `${(frame.spent / total) * 100}%` }}
          transition={barTransition}
        />
        <motion.div
          className="h-full bg-[#b58a3a]"
          animate={{ width: `${(frame.reserved / total) * 100}%` }}
          transition={barTransition}
        />
        <motion.div
          className="h-full bg-[var(--accent)]"
          animate={{ width: `${(frame.available / total) * 100}%` }}
          transition={barTransition}
        />
      </div>
      <div className="mt-2 flex gap-4 text-[11px] text-[var(--foreground-muted)]">
        <Legend color="bg-[var(--accent)]" label="Available" />
        <Legend color="bg-[#b58a3a]" label="Reserved" />
        <Legend color="bg-[var(--foreground)]" label="Spent" />
      </div>

      <div className={cn("mt-5 grid gap-2.5", compact ? "grid-cols-2" : "grid-cols-2")}>
        <AgentChip name="Agent one" state={frame.one} instant={index === 0} />
        <AgentChip name="Agent two" state={frame.two} instant={index === 0} />
      </div>

      <div className="mt-4 h-5 overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            key={frame.caption}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: duration.base, ease }}
            className="text-[13px] text-[var(--foreground-secondary)]"
          >
            {frame.caption}
          </motion.p>
        </AnimatePresence>
      </div>
      {!reduce ? (
        <div className="mt-3 flex gap-1.5" aria-hidden>
          {FRAMES.map((item, dot) => (
            <span
              key={item.caption}
              className={cn(
                "h-1 rounded-full transition-all duration-300",
                dot === index ? "w-5 bg-[var(--foreground)]" : "w-1.5 bg-[var(--border)]",
              )}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("size-1.5 rounded-full", color)} />
      {label}
    </span>
  );
}

function AgentChip({ name, state, instant }: { name: string; state: AgentState; instant?: boolean }) {
  const tone =
    state === "denied"
      ? "border-[var(--danger)]/30 bg-[var(--danger-background)]"
      : state === "paid"
        ? "border-[var(--success)]/25 bg-[var(--success-background)]"
        : state === "reserved"
          ? "border-[#b58a3a]/30 bg-[var(--warning-background)]"
          : "border-[var(--border)] bg-[var(--surface)]";
  const label =
    state === "denied" ? "INSUFFICIENT_BUDGET" : state === "paid" ? "Paid once" : state === "reserved" ? "Reserved 0.02" : "Waiting";
  return (
    <motion.div
      layout
      className={cn("rounded-[10px] border px-3 py-2.5", !instant && "transition-colors duration-300", tone, state === "denied" && "shake")}
      key={`${name}-${state === "denied" ? "denied" : "ok"}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-medium">{name}</span>
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={state}
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.6, opacity: 0 }}
            transition={spring.snappy}
            className="flex size-5 items-center justify-center"
          >
            {state === "paid" ? (
              <Check className="size-3.5 text-[var(--success)]" />
            ) : state === "denied" ? (
              <ShieldX className="size-3.5 text-[var(--danger)]" />
            ) : state === "reserved" ? (
              <Lock className="size-3.5 text-[var(--warning)]" />
            ) : (
              <span className="size-1.5 rounded-full bg-[var(--border-strong)]" />
            )}
          </motion.span>
        </AnimatePresence>
      </div>
      <p className={cn("mt-0.5 truncate text-[11px] text-[var(--foreground-muted)]", state === "denied" && "mono text-[10px] text-[var(--danger)]")}>
        {label}
      </p>
    </motion.div>
  );
}
