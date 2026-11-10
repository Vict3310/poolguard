"use client";

import * as React from "react";
import { animate, useReducedMotion } from "motion/react";
import { near } from "@/lib/utils";

/**
 * Rolls a yoctoNEAR amount between values. The animation interpolates a display
 * float only; the settled text is always the exact decimal string from `near()`,
 * so money is never shown rounded once the motion stops.
 */
export function AnimatedNear({
  yocto,
  className,
  duration = 0.7,
}: {
  yocto: string | null | undefined;
  className?: string;
  duration?: number;
}) {
  const exact = near(yocto);
  const reduce = useReducedMotion();
  const [text, setText] = React.useState(exact);
  const previous = React.useRef<number | null>(null);

  React.useEffect(() => {
    const target = Number.parseFloat(exact);
    if (!Number.isFinite(target)) {
      setText(exact);
      return;
    }
    const from = previous.current;
    previous.current = target;
    if (reduce || from === null || from === target) {
      setText(exact);
      return;
    }
    const decimals = Math.min(6, Math.max(decimalPlaces(exact), 2));
    const controls = animate(from, target, {
      duration,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (value) => setText(value.toFixed(decimals).replace(/\.?0+$/, "") || "0"),
      onComplete: () => setText(exact),
    });
    return () => controls.stop();
  }, [exact, reduce, duration]);

  return (
    <span className={className} aria-label={`${exact} testNEAR`}>
      <span aria-hidden>{text}</span>
    </span>
  );
}

/** Counts an integer up or down (event counts, operation totals). */
export function AnimatedInteger({ value, className }: { value: number; className?: string }) {
  const reduce = useReducedMotion();
  const [display, setDisplay] = React.useState(value);
  const previous = React.useRef(value);
  React.useEffect(() => {
    const from = previous.current;
    previous.current = value;
    if (reduce || from === value) {
      setDisplay(value);
      return;
    }
    const controls = animate(from, value, {
      duration: 0.5,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (latest) => setDisplay(Math.round(latest)),
    });
    return () => controls.stop();
  }, [value, reduce]);
  return <span className={className}>{display}</span>;
}

function decimalPlaces(value: string): number {
  const dot = value.indexOf(".");
  return dot === -1 ? 0 : value.length - dot - 1;
}
