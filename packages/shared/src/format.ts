import { formatYoctoToNear, parseYoctoString } from "./amount.js";

const BLOCK_SECONDS = 1;

/** Exact NEAR display, never rounded through a float. */
export function displayNear(yocto: string, options?: { minFractionDigits?: number }): string {
  try {
    return `${formatYoctoToNear(yocto, {
      trimZeros: true,
      minFractionDigits: options?.minFractionDigits ?? 0,
    })} NEAR`;
  } catch {
    return "—";
  }
}

export function displayNearCompact(yocto: string): string {
  try {
    const value = formatYoctoToNear(yocto, { trimZeros: true });
    return `${value} NEAR`;
  } catch {
    return "—";
  }
}

export function shorten(value: string, head = 8, tail = 6): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function formatBlockTime(block: number | bigint): string {
  return new Date(Number(block) * BLOCK_SECONDS * 1000).toISOString().slice(0, 10);
}

export function blocksToApproxSeconds(blocks: number): number {
  return Math.max(0, Math.round(blocks * BLOCK_SECONDS));
}

export function relativeTime(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const seconds = Math.round((now - then) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function isZeroYocto(value: string): boolean {
  try {
    return parseYoctoString(value) === 0n;
  } catch {
    return false;
  }
}

export function explorerTxUrl(network: "sandbox" | "testnet", txHash: string): string | null {
  if (network !== "testnet") return null;
  return `https://testnet.nearblocks.io/txns/${encodeURIComponent(txHash)}`;
}

export function explorerAccountUrl(network: "sandbox" | "testnet", accountId: string): string | null {
  if (network !== "testnet") return null;
  return `https://testnet.nearblocks.io/address/${encodeURIComponent(accountId)}`;
}
