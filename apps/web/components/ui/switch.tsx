"use client";

import * as React from "react";
import { motion } from "motion/react";
import { spring } from "@/lib/motion";
import { feedback } from "@/lib/feedback";
import { cn } from "@/lib/utils";

export function Switch({
  checked,
  onCheckedChange,
  label,
  disabled,
  id,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        onCheckedChange(!checked);
        feedback("select");
      }}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors duration-200 disabled:opacity-50",
        checked ? "bg-[var(--action)]" : "bg-[var(--surface-selected)]",
      )}
    >
      <motion.span
        layout
        transition={spring.snappy}
        className={cn("block size-5 rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0_/_45%)]", checked ? "ml-auto" : "ml-0")}
      />
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  id,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  label: string;
  id: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex gap-1 rounded-[14px] border border-[var(--border)] bg-[#0c0c10] p-1">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => {
              onChange(option.value);
              feedback("select");
            }}
            className={cn(
              "relative h-9 rounded-[10px] px-4 text-[14px] transition-colors duration-150",
              active ? "font-medium text-[var(--action)]" : "text-[var(--foreground-secondary)] hover:text-[var(--foreground)]",
            )}
          >
            {active ? (
              <motion.span
                layoutId={`${id}-indicator`}
                className="absolute inset-0 rounded-[10px] bg-[var(--action-soft)] shadow-[inset_0_1px_0_rgb(255_255_255_/_6%),inset_0_0_0_1px_rgb(165_166_246_/_14%)]"
                transition={spring.glide}
              />
            ) : null}
            <span className="relative">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
