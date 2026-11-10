import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-[6px] px-2 py-1 text-[12px] font-medium leading-none whitespace-nowrap [&_svg]:size-3",
  {
    variants: {
      tone: {
        neutral: "bg-[var(--surface-muted)] text-[var(--foreground-secondary)]",
        success: "bg-[var(--success-background)] text-[var(--success)]",
        warning: "bg-[var(--warning-background)] text-[var(--warning)]",
        danger: "bg-[var(--danger-background)] text-[var(--danger)]",
        info: "bg-[var(--info-background)] text-[var(--info)]",
        outline: "border border-[var(--border)] bg-transparent text-[var(--foreground-secondary)]",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export function Badge({
  className,
  tone,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
