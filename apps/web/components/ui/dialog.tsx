"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  variant = "center",
  hideClose = false,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  variant?: "center" | "side";
  hideClose?: boolean;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[rgb(24_28_20_/_28%)] backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out" />
      <DialogPrimitive.Content
        className={cn(
          "fixed z-50 flex flex-col border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-popover)]",
          variant === "center"
            ? "left-1/2 top-1/2 max-h-[min(88dvh,760px)] w-[calc(100%-32px)] max-w-[560px] -translate-x-1/2 -translate-y-1/2 rounded-[14px]"
            : "bottom-0 right-0 top-0 h-dvh w-full max-w-[560px] rounded-none border-y-0 border-r-0 sm:rounded-l-[14px] sm:border-l",
          className,
        )}
        {...props}
      >
        {children}
        {hideClose ? null : (
          <DialogPrimitive.Close className="absolute right-4 top-4 inline-flex size-9 items-center justify-center rounded-[8px] text-[var(--foreground-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]">
            <X className="size-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1.5 px-6 pb-4 pt-6 pr-14", className)} {...props} />;
}

export function DialogTitle({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn("text-[18px] font-semibold leading-6 text-[var(--foreground)]", className)}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn("text-[13px] leading-5 text-[var(--foreground-secondary)]", className)}
      {...props}
    />
  );
}

export function DialogBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("scrollbar-quiet flex-1 overflow-y-auto border-t border-[var(--border)] px-6 py-5", className)}
      {...props}
    />
  );
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-col-reverse gap-2 border-t border-[var(--border)] px-6 py-4 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    />
  );
}
