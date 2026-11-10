"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { spring } from "@/lib/motion";
import { feedback } from "@/lib/feedback";
import { copyText } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function CopyButton({
  value,
  label = "Copy",
  className,
  size = "icon-sm",
}: {
  value: string;
  label?: string;
  className?: string;
  size?: "icon-sm" | "sm";
}) {
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1_600);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <Tooltip content={copied ? "Copied" : label}>
      <Button
        type="button"
        variant="ghost"
        size={size}
        className={cn("shrink-0 text-[var(--foreground-muted)]", className)}
        onClick={async (event) => {
          event.stopPropagation();
          await copyText(value);
          setCopied(true);
          feedback("tap");
        }}
        aria-label={copied ? "Copied" : label}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={copied ? "copied" : "copy"}
            className="inline-flex"
            initial={{ scale: 0.4, opacity: 0, rotate: -30 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            exit={{ scale: 0.4, opacity: 0 }}
            transition={spring.snappy}
          >
            {copied ? <Check className="text-[var(--success)]" /> : <Copy />}
          </motion.span>
        </AnimatePresence>
        {size === "sm" ? <span>{copied ? "Copied" : label}</span> : null}
      </Button>
    </Tooltip>
  );
}
