import { cn } from "@/lib/utils";

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-6 py-14 text-center",
        className,
      )}
    >
      <div className="flex size-11 items-center justify-center rounded-[10px] border border-[var(--border)] bg-[var(--surface-muted)] text-[var(--foreground-muted)]">
        {icon}
      </div>
      <h2 className="mt-4 text-[16px] font-semibold text-[var(--foreground)]">{title}</h2>
      <p className="mt-1.5 max-w-sm text-[13px] leading-5 text-[var(--foreground-secondary)]">
        {description}
      </p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
