import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        "focus-ring flex h-11 w-full rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-[15px] text-[var(--foreground)] placeholder:text-[var(--foreground-muted)] disabled:cursor-not-allowed disabled:opacity-60",
        "aria-[invalid=true]:border-[var(--danger)]",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "focus-ring flex min-h-28 w-full rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2.5 text-[15px] leading-6 text-[var(--foreground)] placeholder:text-[var(--foreground-muted)] disabled:cursor-not-allowed disabled:opacity-60",
      "aria-[invalid=true]:border-[var(--danger)]",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export const Label = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label
      ref={ref}
      className={cn("text-[13px] font-medium leading-5 text-[var(--foreground)]", className)}
      {...props}
    />
  ),
);
Label.displayName = "Label";

export const FieldHint = ({ children, error }: { children: React.ReactNode; error?: boolean }) => (
  <p
    className={cn(
      "text-[12px] leading-5",
      error ? "text-[var(--danger)]" : "text-[var(--foreground-muted)]",
    )}
  >
    {children}
  </p>
);

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "flex h-11 w-full appearance-none rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-[15px] text-[var(--foreground)]",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = "Select";
