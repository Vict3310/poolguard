/**
 * Exact yoctoNEAR arithmetic. Financial values never touch IEEE-754 floats.
 */

export const YOCTO_PER_NEAR = 10n ** 24n;
export const MAX_U128 = (1n << 128n) - 1n;
export const MAX_SAFE_NEAR_INTEGER = 10n ** 15n;

export class AmountError extends Error {
  override name = "AmountError";
}

const NEAR_DECIMAL = /^\d+(?:\.\d{1,24})?$/;
const YOCTO_DECIMAL = /^(?:0|[1-9]\d*)$/;

/** Parse a human NEAR decimal string into yoctoNEAR. Never accepts a number. */
export function parseNearToYocto(input: string): bigint {
  if (typeof input !== "string") throw new AmountError("NEAR amount must be a string");
  const value = input.trim();
  if (!NEAR_DECIMAL.test(value)) {
    throw new AmountError("Use a positive decimal amount with at most 24 decimal places");
  }
  const [whole, fraction = ""] = value.split(".");
  const yocto = BigInt(whole!) * YOCTO_PER_NEAR + BigInt(fraction.padEnd(24, "0"));
  if (yocto > MAX_U128) throw new AmountError("Amount exceeds the u128 range");
  return yocto;
}

/** Format exact yoctoNEAR as a NEAR decimal string. No rounding, ever. */
export function formatYoctoToNear(
  yocto: string | bigint,
  options: { trimZeros?: boolean; minFractionDigits?: number } = {},
): string {
  const { trimZeros = true, minFractionDigits = 0 } = options;
  const value = typeof yocto === "string" ? parseYoctoString(yocto) : yocto;
  if (value < 0n) throw new AmountError("Negative NEAR amount");
  const whole = value / YOCTO_PER_NEAR;
  let fraction = (value % YOCTO_PER_NEAR).toString().padStart(24, "0");
  if (trimZeros) fraction = fraction.replace(/0+$/, "");
  const minPadded = fraction.padEnd(Math.min(minFractionDigits, 24), "0");
  return minPadded.length > 0 ? `${whole}.${minPadded}` : whole.toString();
}

export function parseYoctoString(value: string): bigint {
  if (typeof value !== "string" || !YOCTO_DECIMAL.test(value)) {
    throw new AmountError("Yocto amount must be a canonical non-negative integer string");
  }
  const parsed = BigInt(value);
  if (parsed > MAX_U128) throw new AmountError("Amount exceeds the u128 range");
  return parsed;
}

export function isYoctoString(value: unknown): value is string {
  if (typeof value !== "string" || !YOCTO_DECIMAL.test(value)) return false;
  try {
    parseYoctoString(value);
    return true;
  } catch {
    return false;
  }
}

export function nearToYoctoString(input: string): string {
  return parseNearToYocto(input).toString();
}

/** Parse an integer expected to fit a u64 (block heights, versions). */
export function parseU64(value: string | number | bigint, label = "value"): bigint {
  let parsed: bigint;
  if (typeof value === "bigint") parsed = value;
  else if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new AmountError(`${label} must be a safe integer`);
    parsed = BigInt(value);
  } else parsed = BigInt(value);
  if (parsed < 0n || parsed > 18_446_744_073_709_551_615n) {
    throw new AmountError(`${label} is outside the u64 range`);
  }
  return parsed;
}

/** Basis points helper for the accounting bar; display only, not financial math. */
export function shareOfTotal(part: string, total: string): number {
  const p = parseYoctoString(part);
  const t = parseYoctoString(total);
  if (t === 0n) return 0;
  return Number((p * 10_000n) / t) / 100;
}
