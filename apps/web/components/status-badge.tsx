"use client";

import {
  Ban,
  Check,
  CircleDashed,
  Clock3,
  Loader2,
  Pause,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { spring } from "@/lib/motion";
import { Badge } from "@/components/ui/badge";
import { fulfillmentLabel, paymentLabel, runStatusLabel, taskStatusLabel } from "@/lib/utils";

type Kind = "payment" | "fulfillment" | "task" | "run";

function presentation(kind: Kind, value: string): {
  label: string;
  tone: "neutral" | "success" | "warning" | "danger" | "info" | "outline";
  icon: React.ReactNode;
} {
  if (kind === "payment") {
    const label = paymentLabel(value);
    switch (value) {
      case "paid":
        return { label, tone: "success", icon: <Check /> };
      case "payout_pending":
        return { label, tone: "warning", icon: <Clock3 /> };
      case "reserved":
        return { label, tone: "warning", icon: <CircleDashed /> };
      case "payout_failed":
        return { label, tone: "danger", icon: <TriangleAlert /> };
      case "cancelled":
      case "expired":
        return { label, tone: "neutral", icon: <Ban /> };
      default:
        return { label, tone: "outline", icon: <CircleDashed /> };
    }
  }
  if (kind === "fulfillment") {
    const label = fulfillmentLabel(value);
    switch (value) {
      case "delivered":
        return { label, tone: "success", icon: <Check /> };
      case "processing":
        return { label, tone: "info", icon: <Loader2 className="animate-spin" /> };
      case "delivery_failed":
        return { label, tone: "danger", icon: <TriangleAlert /> };
      case "unknown":
        return { label, tone: "warning", icon: <ShieldAlert /> };
      default:
        return { label, tone: "neutral", icon: <CircleDashed /> };
    }
  }
  if (kind === "run") {
    const label = runStatusLabel(value);
    switch (value) {
      case "succeeded":
        return { label, tone: "success", icon: <Check /> };
      case "running":
        return { label, tone: "info", icon: <Loader2 className="animate-spin" /> };
      case "partial":
        return { label, tone: "warning", icon: <TriangleAlert /> };
      case "failed":
        return { label, tone: "danger", icon: <TriangleAlert /> };
      default:
        return { label, tone: "neutral", icon: <CircleDashed /> };
    }
  }
  const label = taskStatusLabel(value);
  switch (value) {
    case "active":
      return { label, tone: "success", icon: <span className="size-1.5 rounded-full bg-current" /> };
    case "awaiting_funding":
      return { label, tone: "warning", icon: <Clock3 /> };
    case "paused":
      return { label, tone: "neutral", icon: <Pause /> };
    case "expired":
      return { label, tone: "danger", icon: <Ban /> };
    default:
      return { label, tone: "neutral", icon: <CircleDashed /> };
  }
}

/** Changes between states morph in place: the old badge shrinks away and the new one springs in. */
export function StatusBadge({ kind, value, className }: { kind: Kind; value: string; className?: string }) {
  const { label, tone, icon } = presentation(kind, value);
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span
        key={`${kind}-${value}`}
        className="inline-flex"
        initial={{ opacity: 0, scale: 0.85, y: 2 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.85 }}
        transition={spring.snappy}
      >
        <Badge tone={tone} className={className}>
          {icon}
          {label}
        </Badge>
      </motion.span>
    </AnimatePresence>
  );
}
