"use client";

import * as React from "react";
import { motion, useAnimationControls, useReducedMotion } from "motion/react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { feedback } from "@/lib/feedback";
import { cn } from "@/lib/utils";

/**
 * Press and hold to confirm. Used for on-chain actions that cannot be undone
 * (pause, revoke): a deliberate gesture instead of a second dialog.
 * Keyboard: hold Space or Enter. Reduced motion or `instant` falls back to a click.
 */
export function HoldButton({
  onConfirm,
  holdMs = 900,
  children,
  hint = "Hold to confirm",
  className,
  disabled,
  loading,
  variant = "secondary",
  size = "sm",
  ...props
}: Omit<ButtonProps, "onClick"> & { onConfirm: () => void; holdMs?: number; hint?: string }) {
  const reduce = useReducedMotion();
  const controls = useAnimationControls();
  const timer = React.useRef<number | null>(null);
  const [holding, setHolding] = React.useState(false);

  const cancel = React.useCallback(() => {
    const wasHolding = timer.current !== null;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
    if (wasHolding) void controls.start({ scaleX: 0, transition: { duration: 0.18 } });
  }, [controls]);

  const start = React.useCallback(() => {
    if (disabled || loading || timer.current !== null) return;
    setHolding(true);
    feedback("tap");
    void controls.start({ scaleX: 1, transition: { duration: holdMs / 1000, ease: "linear" } });
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setHolding(false);
      void controls.set({ scaleX: 0 });
      feedback("success");
      onConfirm();
    }, holdMs);
  }, [controls, disabled, holdMs, loading, onConfirm]);

  // On unmount only clear the timer: animation controls must not run after unmount.
  React.useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
    },
    [],
  );

  if (reduce) {
    return (
      <Button variant={variant} size={size} className={className} disabled={disabled} loading={loading} onClick={onConfirm} {...props}>
        {children}
      </Button>
    );
  }

  return (
    <Button
      variant={variant}
      size={size}
      disabled={disabled}
      loading={loading}
      className={cn("overflow-hidden", className)}
      title={hint}
      aria-description={hint}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        start();
      }}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onKeyDown={(event) => {
        if ((event.key === " " || event.key === "Enter") && !event.repeat) {
          event.preventDefault();
          start();
        }
      }}
      onKeyUp={(event) => {
        if (event.key === " " || event.key === "Enter") cancel();
      }}
      onContextMenu={(event) => event.preventDefault()}
      {...props}
    >
      <motion.span
        aria-hidden
        initial={{ scaleX: 0 }}
        animate={controls}
        style={{ originX: 0 }}
        className="pointer-events-none absolute inset-0 bg-current opacity-[0.12]"
      />
      {children}
      <span className="sr-only">{holding ? "Keep holding" : hint}</span>
    </Button>
  );
}
