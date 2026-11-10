"use client";

import * as React from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import { CircleCheck, Clock3, FileCheck2, LockKeyhole, RotateCcw } from "lucide-react";
import { ease, spring } from "@/lib/motion";

/**
 * Illustrative hero window. When it scrolls into view it plays the product story:
 * a reservation, a denied race, one settled payment and a delivered result.
 * Sample data only, labelled as such.
 */
export function ProductWindow() {
  const ref = React.useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-120px" });
  const reduce = useReducedMotion();
  const [step, setStep] = React.useState(0);
  const [replay, setReplay] = React.useState(0);
  React.useEffect(() => {
    if (reduce) {
      setStep(4);
      return;
    }
    if (!inView) return;
    setStep(0);
    const timers = [1, 2, 3, 4].map((value) => window.setTimeout(() => setStep(value), 450 + value * 750));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [inView, reduce, replay]);
  const available = step >= 1 ? "0.01" : "0.03";
  const spent = step >= 2 ? 67 : 0;
  const reserved = step === 1 ? 67 : 0;

  return (
    <div className="relative" ref={ref}>
      <div className="absolute inset-x-8 -bottom-3 h-8 rounded-[16px] bg-[#e7e8e1]/60 blur-md" aria-hidden />
      <div className="relative overflow-hidden rounded-[16px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-demo)]">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2">
            <span className="flex gap-1.5" aria-hidden>
              <span className="size-2 rounded-full bg-[#d8d9d2]" />
              <span className="size-2 rounded-full bg-[#d8d9d2]" />
              <span className="size-2 rounded-full bg-[#d8d9d2]" />
            </span>
            <span className="ml-2 text-[11px] text-[var(--foreground-muted)]">
              Supplier comparison — Q4
            </span>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] font-medium text-[var(--foreground-secondary)]">
            <span className="size-1.5 rounded-full bg-[var(--warning)]" /> Illustrative task
          </span>
        </div>

        <div className="grid lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="p-4 sm:p-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-[10px] font-medium text-[var(--foreground-muted)]">Available to agents</p>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <motion.span
                    key={available}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.35, ease }}
                    className="financial-value text-[32px] font-medium leading-none tracking-[-0.03em]"
                  >
                    {available}
                  </motion.span>
                  <span className="text-[11px] text-[var(--foreground-secondary)]">testNEAR</span>
                </div>
              </div>
              <div className="text-right text-[10px] text-[var(--foreground-muted)]">
                <p>Funded 0.03</p>
                <p className="mt-0.5">
                  Reserved {step === 1 ? "0.02" : "0.00"} · Spent {step >= 2 ? "0.02" : "0.00"}
                </p>
              </div>
            </div>
            <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-[var(--surface-selected)]">
              <motion.span className="h-full bg-[#20211f]" initial={false} animate={{ width: `${spent}%` }} transition={spring.gentle} />
              <motion.span className="h-full bg-[#b58a3a]" initial={false} animate={{ width: `${reserved}%` }} transition={spring.gentle} />
              <motion.span className="h-full bg-[#4d6042]" initial={false} animate={{ width: `${100 - spent - reserved}%` }} transition={spring.gentle} />
            </div>
            <div className="mt-1.5 flex gap-4 text-[9px] text-[var(--foreground-muted)]">
              <span>Available</span>
              <span>Spent</span>
            </div>

            <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
              {[
                {
                  name: "Agent one",
                  state: step >= 3 ? "Delivered extraction" : step >= 1 ? "Reserved 0.02 · paying" : "Reading document…",
                  tone: step >= 3 ? "success" : "warning",
                  progress: step >= 3 ? 100 : step >= 1 ? 60 : 20,
                },
                {
                  name: "Agent two",
                  state: step >= 2 ? "Denied · choosing cheaper service" : "Reading document…",
                  tone: step >= 2 ? "danger" : "warning",
                  progress: step >= 2 ? 50 : 20,
                },
              ].map((agent) => (
                <div
                  key={agent.name}
                  className={agent.tone === "danger" ? "shake rounded-[8px] border border-[var(--danger)]/25 p-3 transition-colors duration-300" : "rounded-[8px] border border-[var(--border)] p-3 transition-colors duration-300"}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-medium">{agent.name}</span>
                    <span
                      className={
                        agent.tone === "success"
                          ? "size-1.5 rounded-full bg-[var(--success)]"
                          : agent.tone === "danger"
                            ? "size-1.5 rounded-full bg-[var(--danger)]"
                            : "pulse-dot size-1.5 rounded-full bg-[var(--warning)]"
                      }
                    />
                  </div>
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.p
                      key={agent.state}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.2 }}
                      className="mt-1 line-clamp-2 text-[10px] leading-4 text-[var(--foreground-secondary)]"
                    >
                      {agent.state}
                    </motion.p>
                  </AnimatePresence>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--surface-selected)]">
                    <motion.div
                      className={
                        agent.tone === "success"
                          ? "h-full bg-[var(--success)]"
                          : agent.tone === "danger"
                            ? "h-full bg-[var(--danger)]"
                            : "h-full bg-[var(--warning)]"
                      }
                      initial={false}
                      animate={{ width: `${agent.progress}%` }}
                      transition={spring.gentle}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-3 overflow-hidden rounded-[8px] border border-[var(--border)]">
              <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2 text-[10px] font-medium">
                <span>Purchases</span>
                <span className="text-[var(--foreground-muted)]">Payment · Delivery</span>
              </div>
              {[
                { service: "Supplier extraction", amount: "0.02", payment: step >= 2 ? "Paid" : "Reserved", delivery: step >= 3 ? "Delivered" : "—", at: 1 },
                { service: "Supplier extraction", amount: "0.02", payment: "Denied", delivery: "—", at: 2 },
              ].filter((row) => step >= row.at).map((row, index) => (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  transition={{ duration: 0.3, ease }}
                  key={index}
                  className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-2 border-b border-[var(--border)] px-3 py-2 text-[10px] last:border-0"
                >
                  <span className="truncate text-[var(--foreground-secondary)]">{row.service}</span>
                  <span className="financial-value">{row.amount}</span>
                  <span
                    className={
                      row.payment === "Paid"
                        ? "rounded-[3px] bg-[var(--success-background)] px-1.5 py-0.5 text-[var(--success)]"
                        : row.payment === "Reserved"
                          ? "rounded-[3px] bg-[var(--warning-background)] px-1.5 py-0.5 text-[var(--warning)]"
                          : "rounded-[3px] bg-[var(--danger-background)] px-1.5 py-0.5 text-[var(--danger)]"
                    }
                  >
                    {row.payment}
                  </span>
                  <span
                    className={
                      row.delivery === "Delivered"
                        ? "rounded-[3px] bg-[var(--success-background)] px-1.5 py-0.5 text-[var(--success)]"
                        : "text-[var(--foreground-muted)]"
                    }
                  >
                    {row.delivery}
                  </span>
                </motion.div>
              ))}
              {step < 1 ? (
                <p className="px-3 py-2.5 text-[10px] text-[var(--foreground-muted)]">No purchases yet</p>
              ) : null}
            </div>
          </div>

          <div className="border-t border-[var(--border)] bg-[var(--surface-muted)] p-4 lg:border-l lg:border-t-0">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-medium">Activity</p>
              <button
                type="button"
                onClick={() => setReplay((value) => value + 1)}
                className="inline-flex items-center gap-1 rounded-[4px] px-1.5 py-0.5 text-[9px] text-[var(--foreground-muted)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--foreground)]"
              >
                <RotateCcw className="size-2.5" /> Replay
              </button>
            </div>
            <ol className="mt-3 space-y-3">
              {[
                { icon: LockKeyhole, text: "Reserved 0.02 for Supplier extraction", tone: "warning", at: 1 },
                { icon: Clock3, text: "Shared budget race: second reservation denied", tone: "danger", at: 2 },
                { icon: CircleCheck, text: "Payment settled exactly once", tone: "success", at: 2 },
                { icon: FileCheck2, text: "Structured result delivered", tone: "success", at: 3 },
              ].filter((event) => step >= event.at).map((event, index) => (
                <motion.li
                  key={event.text}
                  layout
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.35, ease, delay: index * 0.02 }}
                  className="flex gap-2.5"
                >
                  <span
                    className={
                      event.tone === "success"
                        ? "flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--success-background)] text-[var(--success)]"
                        : event.tone === "warning"
                          ? "flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--warning-background)] text-[var(--warning)]"
                          : "flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--danger-background)] text-[var(--danger)]"
                    }
                  >
                    <event.icon className="size-2.5" />
                  </span>
                  <p className="text-[10px] leading-4 text-[var(--foreground-secondary)]">{event.text}</p>
                </motion.li>
              ))}
            </ol>
            <div className="mt-4 rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2">
              <p className="text-[9px] leading-4 text-[var(--foreground-muted)]">
                Every row is backed by a contract view and a transaction hash. Sample data, not live
                chain evidence.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

