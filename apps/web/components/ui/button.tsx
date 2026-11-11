import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-[12px] text-sm font-medium transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--primary)] text-[var(--primary-foreground)] hover:bg-[var(--primary-hover)] shadow-[inset_0_-1px_0_rgb(0_0_0_/_12%),0_6px_18px_rgb(255_255_255_/_6%)]",
        action:
          "bg-[var(--action)] text-[var(--action-foreground)] hover:bg-[var(--action-hover)] shadow-[inset_0_1px_0_rgb(255_255_255_/_35%),0_8px_24px_rgb(132_134_245_/_28%)] focus-visible:outline-[var(--action)]",
        secondary:
          "border border-[var(--border)] bg-[linear-gradient(180deg,#17171c,#101014)] text-[var(--foreground)] shadow-[inset_0_1px_0_rgb(255_255_255_/_5%)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]",
        ghost: "text-[var(--foreground-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]",
        destructive:
          "bg-[var(--danger-background)] text-[var(--danger)] shadow-[inset_0_0_0_1px_rgb(248_113_113_/_25%)] hover:bg-[#3a1519]",
        outline:
          "border border-[var(--border-strong)] bg-transparent text-[var(--foreground)] hover:bg-[var(--surface-hover)]",
        link: "text-[var(--action)] underline-offset-4 hover:text-[var(--action-hover)] hover:underline",
      },
      size: {
        sm: "h-8 px-3 text-[13px] [&_svg]:size-3.5",
        default: "h-10 px-4 [&_svg]:size-4",
        lg: "h-11 px-5 text-[15px] [&_svg]:size-4",
        icon: "h-10 w-10 [&_svg]:size-4",
        "icon-sm": "h-8 w-8 [&_svg]:size-3.5",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, children, disabled, asChild, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={asChild ? undefined : disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {asChild ? (
          children
        ) : (
          <>
            {loading ? (
              <span
                aria-hidden
                className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
              />
            ) : null}
            <span className={cn("inline-flex items-center gap-2 transition-opacity duration-150", loading && "opacity-80")}>
              {children}
            </span>
          </>
        )}
      </Comp>
    );
  },
);
Button.displayName = "Button";
