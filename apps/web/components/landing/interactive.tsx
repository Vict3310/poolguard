"use client";

import * as React from "react";
import { motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { useMotionReduced } from "@/components/preferences-provider";
import { cn } from "@/lib/utils";

/** True on devices with a precise pointer (mouse/trackpad); false for touch. */
export function useFinePointer(): boolean {
  const [fine, setFine] = React.useState(false);
  React.useEffect(() => {
    const query = window.matchMedia("(pointer: fine)");
    const update = () => setFine(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return fine;
}

/**
 * A card that tilts toward the cursor and carries a soft highlight under it.
 * Transform/opacity only; flat on touch devices and with reduced motion.
 */
export function TiltCard({
  children,
  className,
  max = 6,
}: {
  children: React.ReactNode;
  className?: string;
  max?: number;
}) {
  const reduce = useMotionReduced();
  const fine = useFinePointer();
  const active = fine && !reduce;
  const ref = React.useRef<HTMLDivElement>(null);
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const rotateX = useSpring(useTransform(py, [0, 1], [max, -max]), { stiffness: 220, damping: 22 });
  const rotateY = useSpring(useTransform(px, [0, 1], [-max, max]), { stiffness: 220, damping: 22 });
  const glowX = useTransform(px, [0, 1], ["-30%", "30%"]);
  const glowY = useTransform(py, [0, 1], ["-30%", "30%"]);
  const [hover, setHover] = React.useState(false);

  return (
    <motion.div
      ref={ref}
      className={cn("relative overflow-hidden [transform-style:preserve-3d]", className)}
      style={active ? { rotateX, rotateY, transformPerspective: 900 } : undefined}
      onPointerMove={(event) => {
        if (!active || !ref.current) return;
        const rect = ref.current.getBoundingClientRect();
        px.set((event.clientX - rect.left) / rect.width);
        py.set((event.clientY - rect.top) / rect.height);
      }}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => {
        setHover(false);
        px.set(0.5);
        py.set(0.5);
      }}
      whileHover={active ? { y: -3 } : undefined}
      transition={{ type: "spring", stiffness: 260, damping: 24 }}
    >
      {active ? (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-[-40%] rounded-full bg-[radial-gradient(circle_at_center,rgb(132_134_245_/_11%),transparent_45%)]"
          style={{ x: glowX, y: glowY }}
          animate={{ opacity: hover ? 1 : 0 }}
          transition={{ duration: 0.25 }}
        />
      ) : null}
      <div className="relative">{children}</div>
    </motion.div>
  );
}

/** A large soft spotlight that follows the cursor across a section. */
export function CursorSpotlight({ className }: { className?: string }) {
  const reduce = useMotionReduced();
  const fine = useFinePointer();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 120, damping: 24 });
  const sy = useSpring(y, { stiffness: 120, damping: 24 });
  const ref = React.useRef<HTMLDivElement>(null);
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    if (!fine || reduce) return;
    const parent = ref.current?.parentElement;
    if (!parent) return;
    const move = (event: PointerEvent) => {
      const rect = parent.getBoundingClientRect();
      x.set(event.clientX - rect.left - 300);
      y.set(event.clientY - rect.top - 300);
      setVisible(true);
    };
    const leave = () => setVisible(false);
    parent.addEventListener("pointermove", move);
    parent.addEventListener("pointerleave", leave);
    return () => {
      parent.removeEventListener("pointermove", move);
      parent.removeEventListener("pointerleave", leave);
    };
  }, [fine, reduce, x, y]);

  if (!fine || reduce) return <div ref={ref} aria-hidden className="hidden" />;
  return (
    <div ref={ref} aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      <motion.div
        className="absolute size-[600px] rounded-full bg-[radial-gradient(circle_at_center,rgb(132_134_245_/_9%),transparent_60%)]"
        style={{ x: sx, y: sy }}
        animate={{ opacity: visible ? 1 : 0 }}
        transition={{ duration: 0.4 }}
      />
    </div>
  );
}
