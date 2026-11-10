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
        checked ? "bg-[var(--accent)]" : "bg-[var(--surface-selected)]",
      )}
    >
      <motion.span
        layout
        transition={spring.snappy}
        className={cn("block size-5 rounded-full bg-white shadow-[0_1px_3px_rgb(24_28_20_/_25%)]", checked ? "ml-auto" : "ml-0")}
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
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-[9px] bg-[var(--surface-selected)] p-0.5">
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
              "relative h-8 rounded-[7px] px-3 text-[13px] transition-colors duration-150",
              active ? "font-medium text-[var(--foreground)]" : "text-[var(--foreground-secondary)] hover:text-[var(--foreground)]",
            )}
          >
            {active ? (
              <motion.span
                layoutId={`${id}-indicator`}
                className="absolute inset-0 rounded-[7px] bg-[var(--surface)] shadow-[0_1px_2px_rgb(24_28_20_/_10%)]"
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
