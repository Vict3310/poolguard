"use client";

import * as React from "react";
import {
  AnimatePresence,
  motion,
  useMotionValueEvent,
  useScroll,
  useTransform,
  type MotionValue,
} from "motion/react";
import { useMotionReduced } from "@/components/preferences-provider";
import { Bot, Check, FileCheck2, Lock, Play, RefreshCw, Search, ShieldX, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { spring } from "@/lib/motion";

/**
 * Scroll-driven story. On large screens the section pins and scroll progress
 * advances three chapters, four stages each. On small screens or with reduced
 * motion the chapters stack statically at their final stage.
 */
const CHAPTERS = [
  {
    id: "lifecycle",
    eyebrow: "One purchase",
    title: "Reserved is not paid. Paid is not delivered.",
    body: "Every purchase walks the same states on chain. The interface never collapses them, so you can see exactly where money and work stand.",
  },
  {
    id: "race",
    eyebrow: "Two agents, one pool",
    title: "Parallel agents can’t overspend a shared budget.",
    body: "Both agents ask for 0.02 from a 0.03 pool. The contract serializes reservations, so exactly one wins and the other gets a stable denial code.",
  },
  {
    id: "recovery",
    eyebrow: "A lost response",
    title: "A timeout is never a reason to pay twice.",
    body: "If the response to a payment is lost, the worker looks up the original operation on chain instead of creating a new one.",
  },
] as const;

export function ScrollStory() {
  const reduce = useMotionReduced();
  const [wide, setWide] = React.useState(false);
  React.useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const update = () => setWide(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  if (!wide || reduce) return <StaticStory />;
  return <PinnedStory />;
}

function PinnedStory() {
  const ref = React.useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const [position, setPosition] = React.useState({ chapter: 0, stage: 0 });
  useMotionValueEvent(scrollYProgress, "change", (value) => {
    const scaled = Math.min(0.9999, Math.max(0, value)) * CHAPTERS.length;
    const chapter = Math.floor(scaled);
    const stage = Math.min(3, Math.floor((scaled - chapter) * 4));
    setPosition((current) => (current.chapter === chapter && current.stage === stage ? current : { chapter, stage }));
  });

  return (
    <div ref={ref} className="relative h-[360vh]">
      <div className="sticky top-0 flex h-dvh items-center">
        <div className="mx-auto grid w-full max-w-[1160px] grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] items-center gap-14 px-6">
          <ol className="space-y-7" aria-label="Story chapters">
            {CHAPTERS.map((chapter, index) => (
              <ChapterText key={chapter.id} index={index} active={position.chapter === index} progress={scrollYProgress} />
            ))}
          </ol>
          <div className="relative h-[440px]">
            <AnimatePresence mode="wait">
              <motion.div
                key={position.chapter}
                className="absolute inset-0"
                initial={{ opacity: 0, y: 20, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -20, scale: 0.98 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              >
                <ChapterVisual chapter={position.chapter} stage={position.stage} />
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChapterText({ index, active, progress }: { index: number; active: boolean; progress: MotionValue<number> }) {
  const chapter = CHAPTERS[index]!;
  const start = index / CHAPTERS.length;
  const fill = useTransform(progress, [start, start + 1 / CHAPTERS.length], [0, 1], { clamp: true });
  return (
    <li className={cn("transition-opacity duration-300", active ? "opacity-100" : "opacity-40")}>
      <div className="h-0.5 w-full overflow-hidden rounded-full bg-[var(--surface-selected)]">
        <motion.div className="h-full w-full origin-left bg-[var(--action)]" style={{ scaleX: fill }} />
      </div>
      <p className="eyebrow mt-4">{chapter.eyebrow}</p>
      <h3 className="mt-2 text-[24px] font-semibold leading-tight tracking-[-0.03em]">{chapter.title}</h3>
      <AnimatePresence initial={false}>
        {active ? (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-2 max-w-md overflow-hidden text-[15px] leading-7 text-[var(--foreground-secondary)]"
          >
            {chapter.body}
          </motion.p>
        ) : null}
      </AnimatePresence>
    </li>
  );
}

function StaticStory() {
  return (
    <div className="mx-auto max-w-[1160px] space-y-14 px-4 sm:px-6">
      {CHAPTERS.map((chapter, index) => (
        <div key={chapter.id} className="grid items-center gap-6 md:grid-cols-2 md:gap-10">
          <div>
            <p className="eyebrow">{chapter.eyebrow}</p>
            <h3 className="mt-2 text-[24px] font-semibold leading-tight tracking-[-0.03em]">{chapter.title}</h3>
            <p className="mt-2 text-[15px] leading-7 text-[var(--foreground-secondary)]">{chapter.body}</p>
          </div>
          <div className="relative min-h-[360px]">
            <ChapterVisual chapter={index} stage={3} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Frame({ children, caption }: { children: React.ReactNode; caption: string }) {
  return (
    <div className="flex h-full flex-col rounded-[20px] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[0_24px_64px_rgb(0_0_0_/_45%)]">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-[var(--foreground-secondary)]">{caption}</span>
        <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--foreground-muted)]">Illustrative</span>
      </div>
      <div className="flex flex-1 flex-col justify-center">{children}</div>
    </div>
  );
}

function ChapterVisual({ chapter, stage }: { chapter: number; stage: number }) {
  if (chapter === 0) return <LifecycleVisual stage={stage} />;
  if (chapter === 1) return <RaceVisual stage={stage} />;
  return <RecoveryVisual stage={stage} />;
}

const LIFECYCLE = [
  { label: "Requested", detail: "Agent one picks the extraction service", icon: Bot },
  { label: "Reserved", detail: "0.02 held from the shared pool", icon: Lock },
  { label: "Paid", detail: "One transfer, callback finalized", icon: Check },
  { label: "Delivered", detail: "Provider verified payment, returned the result", icon: FileCheck2 },
];

function LifecycleVisual({ stage }: { stage: number }) {
  return (
    <Frame caption="Operation 9f2c…a41e · 0.02 testNEAR">
      <div className="relative mx-2 mt-2">
        <div className="absolute left-0 right-0 top-[19px] h-0.5 rounded-full bg-[var(--surface-selected)]" />
        <motion.div
          className="absolute left-0 right-0 top-[19px] h-0.5 origin-left rounded-full bg-[var(--action)]"
          animate={{ scaleX: stage / (LIFECYCLE.length - 1) }}
          transition={spring.gentle}
        />
        <ol className="relative grid grid-cols-4">
          {LIFECYCLE.map((item, index) => {
            const done = index <= stage;
            return (
              <li key={item.label} className="flex flex-col items-center text-center">
                <motion.span
                  className={cn(
                    "flex size-10 items-center justify-center rounded-full border-2 bg-[var(--surface)] transition-colors duration-300",
                    done ? "border-[var(--action)] text-[var(--action)]" : "border-[var(--border)] text-[var(--foreground-muted)]",
                  )}
                  animate={{ scale: index === stage ? 1.12 : 1 }}
                  transition={spring.snappy}
                >
                  <item.icon className="size-4" />
                </motion.span>
                <span className={cn("mt-2 text-[12px] font-medium", done ? "text-[var(--foreground)]" : "text-[var(--foreground-muted)]")}>
                  {item.label}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
      <AnimatePresence mode="wait">
        <motion.div
          key={stage}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.25 }}
          className="mt-8 rounded-[12px] border border-[var(--border)] bg-[var(--surface-muted)] p-4"
        >
          <p className="text-[14px] font-medium">{LIFECYCLE[stage]!.label}</p>
          <p className="mt-1 text-[13px] text-[var(--foreground-secondary)]">{LIFECYCLE[stage]!.detail}</p>
          <p className="mono mt-3 text-[11px] text-[var(--foreground-muted)]">
            payment {stage >= 2 ? "paid" : stage === 1 ? "reserved" : "—"} · delivery {stage >= 3 ? "delivered" : "pending"}
          </p>
        </motion.div>
      </AnimatePresence>
    </Frame>
  );
}

function RaceVisual({ stage }: { stage: number }) {
  const oneWins = stage >= 2;
  const twoDenied = stage >= 3;
  const available = oneWins ? 0.01 : 0.03;
  return (
    <Frame caption="Shared pool · 0.03 testNEAR">
      <div className="flex items-baseline gap-2">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={available}
            initial={{ y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -12, opacity: 0 }}
            className="financial-value text-[44px] font-semibold tracking-[-0.04em]"
          >
            {available.toFixed(2)}
          </motion.span>
        </AnimatePresence>
        <span className="text-[13px] text-[var(--foreground-muted)]">available</span>
      </div>
      <div className="mt-6 space-y-4">
        {[
          { name: "Agent one", progress: stage >= 1 ? (oneWins ? 1 : 0.6) : 0.1, state: oneWins ? "reserved 0.02" : stage >= 1 ? "requesting 0.02…" : "reading documents", tone: oneWins ? "win" : "idle" },
          {
            name: "Agent two",
            progress: stage >= 1 ? (twoDenied ? 0.7 : 0.55) : 0.1,
            state: twoDenied ? "INSUFFICIENT_AVAILABLE_BUDGET" : stage >= 1 ? "requesting 0.02…" : "reading documents",
            tone: twoDenied ? "lose" : "idle",
          },
        ].map((lane) => (
          <div key={lane.name}>
            <div className="flex items-center justify-between text-[13px]">
              <span className="flex items-center gap-1.5 font-medium">
                <Bot className="size-3.5" /> {lane.name}
              </span>
              <span
                className={cn(
                  "text-[12px]",
                  lane.tone === "win" ? "text-[var(--success)]" : lane.tone === "lose" ? "mono text-[11px] text-[var(--danger)]" : "text-[var(--foreground-muted)]",
                )}
              >
                {lane.state}
              </span>
            </div>
            <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-[var(--surface-selected)]">
              <motion.div
                className={cn(
                  "h-full w-full origin-left rounded-full",
                  lane.tone === "win" ? "bg-[var(--success)]" : lane.tone === "lose" ? "bg-[var(--danger)]" : "bg-[var(--action)]",
                )}
                animate={{ scaleX: lane.progress, x: lane.tone === "lose" ? [0, -5, 5, -3, 0] : 0 }}
                transition={{ scaleX: spring.gentle, x: { duration: 0.4 } }}
              />
            </div>
          </div>
        ))}
      </div>
      <AnimatePresence>
        {twoDenied ? (
          <motion.p
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-6 flex items-center gap-2 rounded-[10px] bg-[var(--danger-background)] px-3 py-2.5 text-[12px] text-[var(--danger)]"
          >
            <ShieldX className="size-4 shrink-0" /> Denied on chain. Agent two can fall back to the 0.005 summary service.
          </motion.p>
        ) : null}
      </AnimatePresence>
    </Frame>
  );
}

const RECOVERY = [
  { icon: Play, title: "Execute sent", detail: "Worker dispatches the payout for operation 9f2c…a41e" },
  { icon: WifiOff, title: "Response lost", detail: "The node accepted it, but the reply never arrived" },
  { icon: Search, title: "Look up, don’t repeat", detail: "After restart the worker reads the same operation id from chain: paid" },
  { icon: RefreshCw, title: "Recovered", detail: "Stored result fetched. Payout attempts: 1. No second payment." },
];

function RecoveryVisual({ stage }: { stage: number }) {
  return (
    <Frame caption="Durable job · lease, retry, reconcile">
      <ol className="space-y-3">
        {RECOVERY.map((item, index) => {
          const reached = index <= stage;
          const bad = index === 1;
          return (
            <motion.li
              key={item.title}
              animate={{ opacity: reached ? 1 : 0.35, x: reached ? 0 : 8 }}
              transition={spring.gentle}
              className={cn(
                "flex gap-3 rounded-[12px] border p-3.5",
                reached && bad ? "border-[var(--warning)]/30 bg-[var(--warning-background)]" : reached && index === 3 ? "border-[var(--success)]/30 bg-[var(--success-background)]" : "border-[var(--border)]",
              )}
            >
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-full",
                  reached ? (bad ? "bg-[var(--surface)] text-[var(--warning)]" : index === 3 ? "bg-[var(--surface)] text-[var(--success)]" : "bg-[var(--action-soft)] text-[var(--action)]") : "bg-[var(--surface-muted)] text-[var(--foreground-muted)]",
                )}
              >
                <item.icon className="size-4" />
              </span>
              <span>
                <span className="block text-[14px] font-medium">{item.title}</span>
                <span className="mt-0.5 block text-[12px] leading-5 text-[var(--foreground-secondary)]">{item.detail}</span>
              </span>
            </motion.li>
          );
        })}
      </ol>
    </Frame>
  );
}
