import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatYoctoToNear } from "@poolguard/shared";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Exact amount, no float. `0` stays `0`; tiny remainders are never rounded away. */
export function near(yocto: string | null | undefined, minFractionDigits = 0): string {
  if (yocto == null) return "—";
  try {
    return formatYoctoToNear(yocto, { trimZeros: true, minFractionDigits });
  } catch {
    return "—";
  }
}

export function tokenAmount(yocto: string | null | undefined): string {
  return `${near(yocto)} testNEAR`;
}

export function shortId(value: string | null | undefined, head = 8, tail = 6): string {
  if (!value) return "—";
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

export function relative(iso: string | null | undefined): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function progressPercent(part: string, total: string): number {
  try {
    const p = BigInt(part);
    const t = BigInt(total);
    if (t === 0n) return 0;
    const scaled = Number((p * 10_000n) / t) / 100;
    return Math.max(0, Math.min(100, scaled));
  } catch {
    return 0;
  }
}

export function blocksApprox(blocks: number): string {
  if (blocks < 60) return `${blocks}s`;
  if (blocks < 3600) return `${Math.round(blocks / 60)}m`;
  return `${Math.round(blocks / 3600)}h`;
}

export function serviceLabel(serviceId: string): string {
  const map: Record<string, string> = {
    "doc-extract-v1": "Supplier document extraction",
    "doc-summary-v1": "Supplier document summary",
  };
  return map[serviceId] ?? serviceId.replace(/-/g, " ");
}

export function taskStatusLabel(status: string): string {
  return (
    {
      draft: "Draft",
      awaiting_funding: "Awaiting funding",
      active: "Active",
      paused: "Paused",
      expired: "Expired",
    }[status] ?? status
  );
}

export function paymentLabel(state: string): string {
  return (
    {
      reserved: "Reserved",
      payout_pending: "Payment pending",
      paid: "Paid",
      payout_failed: "Payment failed",
      cancelled: "Cancelled",
      expired: "Expired",
    }[state] ?? state
  );
}

export function fulfillmentLabel(state: string): string {
  return (
    {
      not_requested: "Not requested",
      processing: "Processing",
      delivered: "Delivered",
      delivery_failed: "Delivery failed",
      unknown: "Checking status",
    }[state] ?? state
  );
}

export function runStatusLabel(status: string): string {
  return (
    {
      queued: "Queued",
      running: "Running",
      succeeded: "Completed",
      partial: "Stopped",
      failed: "Failed",
    }[status] ?? status
  );
}

export function severityClasses(severity: string): string {
  switch (severity) {
    case "success":
      return "text-[var(--success)] bg-[var(--success-background)]";
    case "warning":
      return "text-[var(--warning)] bg-[var(--warning-background)]";
    case "danger":
      return "text-[var(--danger)] bg-[var(--danger-background)]";
    case "info":
      return "text-[var(--info)] bg-[var(--info-background)]";
    default:
      return "text-[var(--foreground-secondary)] bg-[var(--surface-muted)]";
  }
}
