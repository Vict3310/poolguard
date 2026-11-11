"use client";

import * as React from "react";
import { AnimatePresence, motion, useInView } from "motion/react";
import { useMotionReduced } from "@/components/preferences-provider";
import { Bot, Check, Lock, RotateCcw, ShieldX, Store } from "lucide-react";
import { TiltCard } from "@/components/landing/interactive";
import { cn } from "@/lib/utils";
import { spring } from "@/lib/motion";

/**
 * The hero's interactive illustration: a shared 0.03 pool and two agents that each
 * try to buy a 0.02 service. Click an agent to make it buy. The first purchase is
 * reserved then paid exactly once; the second is denied because only 0.01 is left.
 * Illustrative numbers, clearly labelled. Plays itself while idle and in view.
 */
type AgentState = "idle" | "reserved" | "paid" | "denied";
interface Pool {
  available: number; // hundredths of testNEAR
  reserved: number;
  spent: number;
  agents: [AgentState, AgentState];
  log: Array<{ id: number; text: string; tone: "warning" | "success" | "danger" }>;
  coins: number[];
}

const TOTAL = 3;
const PRICE = 2;
const initial: Pool = { available: TOTAL, reserved: 0, spent: 0, agents: ["idle", "idle"], log: [], coins: [] };

export function HeroPool() {
  const reduce = useMotionReduced();
  const ref = React.useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-80px" });
  const [pool, setPool] = React.useState<Pool>(initial);
  const [touched, setTouched] = React.useState(false);
  const timers = React.useRef<number[]>([]);
  const seq = React.useRef(0);

  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, reduce ? 0 : ms));
  };
  React.useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const poolRef = React.useRef(pool);
  poolRef.current = pool;

  // Decide from the latest state, then apply pure updates; timers live outside updaters.
  const buy = React.useCallback(
    (index: 0 | 1) => {
      const current = poolRef.current;
      if (current.agents[index] !== "idle") return;
      const id = ++seq.current;
      const name = index === 0 ? "one" : "two";
      if (current.available < PRICE) {
        setPool((p) => {
          const agents = [...p.agents] as Pool["agents"];
          agents[index] = "denied";
          return {
            ...p,
            agents,
            log: [{ id, text: `Agent ${name} denied: INSUFFICIENT_AVAILABLE_BUDGET`, tone: "danger" as const }, ...p.log].slice(0, 4),
          };
        });
        later(() => {
          setPool((p) => {
            const agents = [...p.agents] as Pool["agents"];
            if (agents[index] === "denied") agents[index] = "idle";
            return { ...p, agents };
          });
        }, 1800);
        return;
      }
      // Reserve synchronously in the ref too, so a second click in the same tick sees it.
      poolRef.current = { ...current, available: current.available - PRICE };
      setPool((p) => {
        const agents = [...p.agents] as Pool["agents"];
        agents[index] = "reserved";
        return {
          ...p,
          available: p.available - PRICE,
          reserved: p.reserved + PRICE,
          agents,
          log: [{ id, text: `Agent ${name} reserved 0.02`, tone: "warning" as const }, ...p.log].slice(0, 4),
        };
      });
      later(() => {
        setPool((p) => {
          if (p.agents[index] !== "reserved") return p;
          const agents = [...p.agents] as Pool["agents"];
          agents[index] = "paid";
          return {
            ...p,
            reserved: p.reserved - PRICE,
            spent: p.spent + PRICE,
            agents,
            coins: [...p.coins, id],
            log: [{ id: id + 0.5, text: "Payment settled exactly once", tone: "success" as const }, ...p.log].slice(0, 4),
          };
        });
      }, 1100);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reduce],
  );

  const reset = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    setPool(initial);
  };

  // Autoplay a short story while visible and untouched. Every timer is cleared as
  // soon as the visitor interacts or the card scrolls away.
  React.useEffect(() => {
    if (!inView || touched || reduce) return;
    const pending: number[] = [];
    const play = () => {
      pending.push(window.setTimeout(() => buy(0), 900));
      pending.push(window.setTimeout(() => buy(1), 2300));
      pending.push(window.setTimeout(() => reset(), 6200));
    };
    play();
    const loop = window.setInterval(play, 6600);
    return () => {
      window.clearInterval(loop);
      pending.forEach((t) => window.clearTimeout(t));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, touched, reduce, buy]);

  const interact = (fn: () => void) => {
    if (!touched) {
      setTouched(true);
      reset();
      window.setTimeout(fn, 60);
      return;
    }
    fn();
  };

  const fraction = (value: number) => value / TOTAL;

  return (
    <div ref={ref} className="relative">
      <TiltCard className="rounded-[20px] border border-[var(--border)] bg-[var(--surface)] shadow-[0_30px_80px_rgb(0_0_0_/_45%)]" max={4}>
        <div className="p-5 sm:p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[12px] font-medium text-[var(--foreground-secondary)]">Shared pool · supplier review</p>
              <div className="mt-1 flex items-baseline gap-1.5">
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span
                    key={pool.available}
                    initial={{ y: 14, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: -14, opacity: 0 }}
                    transition={spring.snappy}
                    className="financial-value text-[40px] font-semibold leading-none tracking-[-0.04em]"
                  >
                    {(pool.available / 100).toFixed(2)}
                  </motion.span>
                </AnimatePresence>
                <span className="text-[12px] text-[var(--foreground-muted)]">testNEAR available</span>
              </div>
            </div>
            <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--foreground-muted)]">Illustrative</span>
          </div>

          {/* Accounting bar: spent · reserved · available, composed with transforms only. */}
          <div className="relative mt-5 h-3 overflow-hidden rounded-full bg-[var(--surface-selected)]" aria-hidden>
            <motion.div
              className="absolute inset-y-0 left-0 w-full origin-left bg-[var(--foreground)]"
              animate={{ scaleX: fraction(pool.spent) }}
              transition={spring.gentle}
            />
            <motion.div
              className="absolute inset-y-0 left-0 w-full origin-left bg-[#f2b34a]"
              animate={{ x: `${fraction(pool.spent) * 100}%`, scaleX: fraction(pool.reserved) }}
              transition={spring.gentle}
            />
            <motion.div
              className="absolute inset-y-0 left-0 w-full origin-left bg-[var(--accent)]"
              animate={{ x: `${fraction(pool.spent + pool.reserved) * 100}%`, scaleX: fraction(pool.available) }}
              transition={spring.gentle}
            />
          </div>
          <div className="mt-2 flex gap-4 text-[11px] text-[var(--foreground-muted)]">
            <Legend className="bg-[var(--accent)]" label="Available" />
            <Legend className="bg-[#f2b34a]" label="Reserved" />
            <Legend className="bg-[var(--foreground)]" label="Spent" />
          </div>

          <div className="mt-5 grid grid-cols-[1fr_1fr_auto] items-stretch gap-2.5">
            {([0, 1] as const).map((index) => (
              <AgentButton key={index} index={index} state={pool.agents[index]} onBuy={() => interact(() => buy(index))} />
            ))}
            <div className="relative flex w-[74px] flex-col items-center justify-center rounded-[12px] border border-dashed border-[var(--border-strong)]/40 px-2 py-3 text-center">
              <Store className="size-4 text-[var(--foreground-muted)]" />
              <span className="mt-1 text-[10px] leading-3 text-[var(--foreground-muted)]">Provider</span>
              <AnimatePresence>
                {pool.coins.map((coin) => (
                  <motion.span
                    key={coin}
                    aria-hidden
                    className="absolute size-3 rounded-full bg-[var(--action-bright)] shadow-[0_0_0_3px_rgb(132_134_245_/_18%)]"
                    initial={{ x: -150, y: -60, opacity: 0, scale: 0.4 }}
                    animate={{ x: 0, y: 0, opacity: [0, 1, 1, 0], scale: [0.4, 1, 1, 0.6] }}
                    transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
                  />
                ))}
              </AnimatePresence>
              <span className="financial-value mt-1 text-[11px] font-semibold">{(pool.spent / 100).toFixed(2)}</span>
            </div>
          </div>

          <div className="mt-4 min-h-[76px] space-y-1.5" aria-live="polite">
            <AnimatePresence initial={false}>
              {pool.log.length === 0 ? (
                <motion.p key="hint" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-[12px] text-[var(--foreground-muted)]">
                  Click an agent to make it buy a 0.02 service.
                </motion.p>
              ) : null}
              {pool.log.map((entry) => (
                <motion.p
                  key={entry.id}
                  layout
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  className={cn(
                    "flex items-center gap-2 text-[12px]",
                    entry.tone === "danger" ? "text-[var(--danger)]" : entry.tone === "success" ? "text-[var(--success)]" : "text-[var(--warning)]",
                  )}
                >
                  <span className="size-1.5 rounded-full bg-current" />
                  <span className={entry.tone === "danger" ? "mono text-[11px]" : undefined}>{entry.text}</span>
                </motion.p>
              ))}
            </AnimatePresence>
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-[var(--border)] pt-3">
            <span className="text-[11px] text-[var(--foreground-muted)]">The contract decides. The model never touches the money.</span>
            <button
              type="button"
              onClick={() => interact(reset)}
              className="inline-flex items-center gap-1 rounded-[6px] px-2 py-1 text-[11px] text-[var(--foreground-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]"
            >
              <RotateCcw className="size-3" /> Reset
            </button>
          </div>
        </div>
      </TiltCard>
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("size-1.5 rounded-full", className)} />
      {label}
    </span>
  );
}

function AgentButton({ index, state, onBuy }: { index: 0 | 1; state: AgentState; onBuy: () => void }) {
  const label = index === 0 ? "Agent one" : "Agent two";
  const tone =
    state === "denied"
      ? "border-[var(--danger)]/35 bg-[var(--danger-background)]"
      : state === "paid"
        ? "border-[var(--success)]/30 bg-[var(--success-background)]"
        : state === "reserved"
          ? "border-[#f2b34a]/40 bg-[var(--warning-background)]"
          : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--action)]/50 hover:bg-[var(--action-soft)]";
  return (
    <motion.button
      type="button"
      onClick={onBuy}
      disabled={state !== "idle"}
      whileTap={{ scale: 0.96 }}
      animate={state === "denied" ? { x: [0, -6, 6, -4, 4, 0] } : { x: 0 }}
      transition={state === "denied" ? { duration: 0.4 } : spring.snappy}
      className={cn("group rounded-[12px] border p-3 text-left transition-colors duration-200 disabled:cursor-default", tone)}
      aria-label={`${label}: ${state === "idle" ? "buy a 0.02 service" : state}`}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[12px] font-medium">
          <Bot className="size-3.5" /> {label}
        </span>
        <AnimatePresence mode="wait" initial={false}>
          <motion.span key={state} initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0 }} transition={spring.snappy}>
            {state === "paid" ? (
              <Check className="size-3.5 text-[var(--success)]" />
            ) : state === "denied" ? (
              <ShieldX className="size-3.5 text-[var(--danger)]" />
            ) : state === "reserved" ? (
              <Lock className="size-3.5 text-[var(--warning)]" />
            ) : (
              <span className="block size-1.5 rounded-full bg-[var(--action)] transition-transform group-hover:scale-150" />
            )}
          </motion.span>
        </AnimatePresence>
      </span>
      <span className={cn("mt-1 block text-[11px]", state === "idle" ? "font-medium text-[var(--action)]" : "text-[var(--foreground-muted)]")}>
        {state === "idle" ? "Buy 0.02 →" : state === "reserved" ? "Reserved, paying…" : state === "paid" ? "Paid once" : "Denied"}
      </span>
    </motion.button>
  );
}
