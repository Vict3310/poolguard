import { cn } from "@/lib/utils";

/** Deterministic colour per task, used for its avatar, card glow and chart. */
const TONES = [
  { solid: "#f7931a", glow: "rgb(247 147 26 / 26%)", soft: "rgb(247 147 26 / 14%)" },
  { solid: "#7c8cf8", glow: "rgb(124 140 248 / 28%)", soft: "rgb(124 140 248 / 14%)" },
  { solid: "#26a17b", glow: "rgb(38 161 123 / 26%)", soft: "rgb(38 161 123 / 14%)" },
  { solid: "#e5484d", glow: "rgb(229 72 77 / 24%)", soft: "rgb(229 72 77 / 14%)" },
  { solid: "#14b8d4", glow: "rgb(20 184 212 / 24%)", soft: "rgb(20 184 212 / 14%)" },
  { solid: "#c084fc", glow: "rgb(192 132 252 / 26%)", soft: "rgb(192 132 252 / 14%)" },
] as const;

export type TaskTone = (typeof TONES)[number];

export function taskTone(seed: string): TaskTone {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  return TONES[hash % TONES.length]!;
}

export function taskInitials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "PG";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

/** Round avatar, like a coin icon in a market table. */
export function TaskAvatar({ id, name, size = "md", className }: { id: string; name: string; size?: "sm" | "md" | "lg"; className?: string }) {
  const tone = taskTone(id);
  const dims = size === "sm" ? "size-6 text-[9px]" : size === "lg" ? "size-9 text-[12px]" : "size-8 text-[10.5px]";
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold tracking-[0.02em] text-white", dims, className)}
      style={{ background: `radial-gradient(circle at 30% 25%, ${tone.solid}, color-mix(in srgb, ${tone.solid} 70%, black))`, boxShadow: `0 0 0 1px rgb(255 255 255 / 8%) inset, 0 4px 14px ${tone.soft}` }}
    >
      {taskInitials(name)}
    </span>
  );
}

/** Rounded-square tile holding the avatar, as on the large cards. */
export function TaskTile({ id, name }: { id: string; name: string }) {
  const tone = taskTone(id);
  return (
    <span className="icon-tile size-12" style={{ boxShadow: `inset 0 1px 0 rgb(255 255 255 / 5%), 0 0 24px ${tone.soft}` }}>
      <TaskAvatar id={id} name={name} />
    </span>
  );
}
