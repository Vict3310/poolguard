import { cn } from "@/lib/utils";

export function NetworkBadge({
  network,
  sandbox,
  className,
}: {
  network: "sandbox" | "testnet" | string | undefined;
  sandbox?: boolean;
  className?: string;
}) {
  const label = sandbox || network === "sandbox" ? "Local sandbox" : "Testnet";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[12px] font-medium text-[var(--foreground-secondary)]",
        className,
      )}
      title="Experimental network. Tokens have no monetary value."
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          sandbox || network === "sandbox" ? "bg-[var(--warning)]" : "bg-[var(--success)]",
        )}
      />
      {label}
    </span>
  );
}
