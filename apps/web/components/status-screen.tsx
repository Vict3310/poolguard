"use client";

import * as React from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { Brand } from "@/components/brand";
import { rise, stagger } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** Shared layout for 404, error and signed-out screens. */
export function StatusScreen({
  code,
  title,
  body,
  actions,
  detail,
  framed = true,
  illustration,
}: {
  code: string;
  title: string;
  body: string;
  actions: React.ReactNode;
  detail?: React.ReactNode;
  framed?: boolean;
  illustration?: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col", framed && "min-h-dvh bg-[var(--background)]")}>
      {framed ? (
        <header className="flex h-16 items-center px-5 sm:px-8">
          <Brand />
        </header>
      ) : null}
      <main id="main" className={cn("flex flex-1 items-center justify-center px-5", framed ? "py-16" : "py-10")}>
        <motion.div className="w-full max-w-[520px] text-center" initial="hidden" animate="show" variants={stagger(0.08)}>
          <motion.div variants={rise} className="mx-auto flex justify-center">
            {illustration ?? <BoundedMark code={code} />}
          </motion.div>
          <motion.h1 variants={rise} className="mt-8 text-[28px] font-semibold leading-tight tracking-[-0.03em] sm:text-[34px]">
            {title}
          </motion.h1>
          <motion.p variants={rise} className="mx-auto mt-3 max-w-md text-[15px] leading-6 text-[var(--foreground-secondary)]">
            {body}
          </motion.p>
          <motion.div variants={rise} className="mt-8 flex flex-col items-center justify-center gap-2 sm:flex-row">
            {actions}
          </motion.div>
          {detail ? (
            <motion.div variants={rise} className="mt-8">
              {detail}
            </motion.div>
          ) : null}
        </motion.div>
      </main>
    </div>
  );
}

/** The PoolGuard brackets holding the status code, drawn in. */
function BoundedMark({ code }: { code: string }) {
  return (
    <div className="relative flex h-24 items-center gap-3 text-[var(--foreground)]">
      <motion.svg width="28" height="96" viewBox="0 0 28 96" fill="none" aria-hidden>
        <motion.path
          d="M24 4H12A8 8 0 0 0 4 12v72a8 8 0 0 0 8 8h12"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        />
      </motion.svg>
      <motion.span
        className="financial-value text-[56px] font-semibold tracking-[-0.04em]"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.25, duration: 0.4 }}
      >
        {code}
      </motion.span>
      <motion.svg width="28" height="96" viewBox="0 0 28 96" fill="none" aria-hidden>
        <motion.path
          d="M4 4h12a8 8 0 0 1 8 8v72a8 8 0 0 1-8 8H4"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        />
      </motion.svg>
    </div>
  );
}

export function TextLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-[13px] text-[var(--foreground-muted)] underline-offset-4 hover:text-[var(--foreground)] hover:underline">
      {children}
    </Link>
  );
}
