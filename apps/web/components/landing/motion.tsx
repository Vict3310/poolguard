"use client";

import * as React from "react";
import { motion, useMotionValue, useReducedMotion, useScroll, useSpring, useMotionValueEvent } from "motion/react";
import { Check, Copy } from "lucide-react";
import { copyText } from "@/lib/api";
import { ease, spring } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** Fades and lifts content in once it scrolls into view. */
export function Reveal({
  children,
  className,
  delay = 0,
  y = 16,
  as = "div",
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  y?: number;
  as?: "div" | "li" | "section";
}) {
  const Component = motion[as];
  return (
    <Component
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.55, ease, delay }}
    >
      {children}
    </Component>
  );
}

/** Staggers direct children (each wrapped in <RevealItem>) as the group enters. */
export function RevealGroup({ children, className, step = 0.08 }: { children: React.ReactNode; className?: string; step?: number }) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-80px" }}
      variants={{ hidden: {}, show: { transition: { staggerChildren: step } } }}
    >
      {children}
    </motion.div>
  );
}

export function RevealItem({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div
      className={className}
      variants={{ hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.5, ease } } }}
    >
      {children}
    </motion.div>
  );
}

/** A subtle pull toward the cursor on fine pointers. Off for touch and reduced motion. */
export function Magnetic({ children, strength = 0.22, className }: { children: React.ReactNode; strength?: number; className?: string }) {
  const reduce = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const springX = useSpring(x, spring.snappy);
  const springY = useSpring(y, spring.snappy);
  const ref = React.useRef<HTMLDivElement>(null);
  const [fine, setFine] = React.useState(false);
  React.useEffect(() => setFine(window.matchMedia("(pointer: fine)").matches), []);
  const active = fine && !reduce;
  return (
    <motion.div
      ref={ref}
      className={cn("inline-flex", className)}
      style={active ? { x: springX, y: springY } : undefined}
      onPointerMove={(event) => {
        if (!active || !ref.current) return;
        const rect = ref.current.getBoundingClientRect();
        x.set((event.clientX - (rect.left + rect.width / 2)) * strength);
        y.set((event.clientY - (rect.top + rect.height / 2)) * strength);
      }}
      onPointerLeave={() => {
        x.set(0);
        y.set(0);
      }}
    >
      {children}
    </motion.div>
  );
}

/** Word-by-word headline entrance. */
export function StaggerWords({ lines, className }: { lines: string[]; className?: string }) {
  let index = 0;
  return (
    <h1 className={className} aria-label={lines.join(" ")}>
      {lines.map((line, lineIndex) => (
        <span key={line} className="block" aria-hidden>
          {line.split(" ").map((word) => {
            const delay = 0.08 + index++ * 0.06;
            return (
              <span key={`${lineIndex}-${word}-${delay}`} className="inline-block overflow-hidden pb-[0.08em] align-bottom">
                <motion.span
                  className="inline-block"
                  initial={{ y: "105%" }}
                  animate={{ y: "0%" }}
                  transition={{ duration: 0.7, ease, delay }}
                >
                  {word}
                </motion.span>
                &nbsp;
              </span>
            );
          })}
        </span>
      ))}
    </h1>
  );
}

/** Adds a soft shadow to the marketing header once the page scrolls. */
export function ScrollHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = React.useState(false);
  useMotionValueEvent(scrollY, "change", (value) => setScrolled(value > 8));
  return (
    <header
      className={cn(
        className,
        "transition-[box-shadow,background-color] duration-300",
        scrolled && "shadow-[0_6px_24px_rgb(24_28_20_/_6%)]",
      )}
    >
      {children}
    </header>
  );
}

export function CopyCode({ value }: { value: string }) {
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      onClick={() => {
        void copyText(value).then(() => setCopied(true));
      }}
      className="inline-flex h-6 items-center gap-1.5 rounded-[5px] px-2 text-[10px] text-[#a7aca0] transition-colors hover:bg-[#2c2f29] hover:text-white"
      aria-label={copied ? "Copied" : "Copy example"}
    >
      <motion.span key={copied ? "y" : "n"} initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={spring.snappy}>
        {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      </motion.span>
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
