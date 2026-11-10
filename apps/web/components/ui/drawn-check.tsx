"use client";

import { motion } from "motion/react";
import { ease } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** A checkmark that draws itself: the success beat for completed actions. */
export function DrawnCheck({ className, delay = 0 }: { className?: string; delay?: number }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-4", className)} fill="none" aria-hidden>
      <motion.path
        d="M5 12.5l4.2 4.2L19 7"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.38, ease, delay }}
      />
    </svg>
  );
}
