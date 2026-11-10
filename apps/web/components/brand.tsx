import Link from "next/link";
import { cn } from "@/lib/utils";

export function PoolGuardMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden
      className={cn("size-7", className)}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12.5 5.5H9.5A4 4 0 0 0 5.5 9.5v13a4 4 0 0 0 4 4h3" />
      <path d="M19.5 26.5h3a4 4 0 0 0 4-4v-13a4 4 0 0 0-4-4h-3" />
      <rect x="12.5" y="12.5" width="7" height="7" rx="1.2" />
    </svg>
  );
}

export function Brand({ href = "/", compact = false }: { href?: string; compact?: boolean }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2.5 rounded-[6px] text-[var(--foreground)]"
      aria-label="PoolGuard home"
    >
      <PoolGuardMark className="size-6" />
      {compact ? null : (
        <span className="text-[15px] font-semibold tracking-[-0.01em]">PoolGuard</span>
      )}
    </Link>
  );
}
