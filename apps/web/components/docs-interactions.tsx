"use client";

import * as React from "react";
import { motion, useScroll, useSpring } from "motion/react";
import { Check, Copy } from "lucide-react";
import { copyText } from "@/lib/api";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** Table of contents that follows the reader, with a gliding active marker. */
export function DocsToc({ items }: { items: Array<{ href: string; label: string }> }) {
  const [active, setActive] = React.useState(items[0]?.href ?? "");
  React.useEffect(() => {
    const sections = items
      .map((item) => document.querySelector<HTMLElement>(item.href))
      .filter((node): node is HTMLElement => Boolean(node));
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(`#${visible[0].target.id}`);
      },
      { rootMargin: "-90px 0px -60% 0px", threshold: 0 },
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [items]);

  return (
    <>
      {items.map((item) => {
        const current = item.href === active;
        return (
          <a
            key={item.href}
            href={item.href}
            aria-current={current ? "location" : undefined}
            className={cn(
              "relative block rounded-[6px] px-2.5 py-2 text-[12px] transition-colors duration-150",
              current ? "font-medium text-[var(--foreground)]" : "text-[var(--foreground-secondary)] hover:text-[var(--foreground)]",
            )}
          >
            {current ? (
              <motion.span layoutId="docs-toc" className="absolute inset-0 rounded-[6px] bg-[var(--surface-selected)]" transition={spring.glide} />
            ) : null}
            <span className="relative">{item.label}</span>
          </a>
        );
      })}
    </>
  );
}

/** Thin reading-progress bar pinned under the header. */
export function ReadingProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 220, damping: 32 });
  return (
    <motion.div
      aria-hidden
      className="fixed inset-x-0 top-0 z-50 h-0.5 origin-left bg-[var(--accent)]"
      style={{ scaleX }}
    />
  );
}

/** A code block with a copy button that confirms with a check. */
export function CopyablePre({ className, children }: { className?: string; children: React.ReactNode }) {
  const ref = React.useRef<HTMLPreElement>(null);
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const dark = className?.includes("#20211f");
  return (
    <div className="group relative">
      <pre ref={ref} className={className}>
        {children}
      </pre>
      <button
        type="button"
        onClick={() => void copyText(ref.current?.textContent ?? "").then(() => setCopied(true))}
        aria-label={copied ? "Copied" : "Copy code"}
        className={cn(
          "absolute right-2 top-2 inline-flex size-7 items-center justify-center rounded-[6px] opacity-0 transition-[opacity,background-color] duration-150 group-hover:opacity-100 focus-visible:opacity-100",
          dark ? "text-[#a7aca0] hover:bg-[#2c2f29] hover:text-white" : "text-[var(--foreground-muted)] hover:bg-[var(--surface-hover)]",
          copied && "opacity-100",
        )}
      >
        <motion.span key={copied ? "y" : "n"} initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={spring.snappy}>
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </motion.span>
      </button>
    </div>
  );
}
