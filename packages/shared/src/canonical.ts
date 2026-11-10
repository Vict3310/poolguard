/**
 * Deterministic JSON canonicalization.
 *
 * Rules:
 * - Object keys are sorted by UTF-16 code unit order.
 * - `undefined` object properties are rejected rather than silently dropped.
 * - Only finite numbers are allowed, and financial amounts must be decimal strings.
 * - `bigint` is rejected; convert to a decimal string at the financial boundary.
 *
 * The same canonical form feeds request hashes, operation ids and provider
 * signatures, so every party must agree byte for byte.
 */

export class CanonicalJsonError extends Error {
  override name = "CanonicalJsonError";
}

export type CanonicalJson =
  | null
  | boolean
  | number
  | string
  | CanonicalJson[]
  | { [key: string]: CanonicalJson };

export function canonicalize(value: unknown): string {
  const seen = new Set<object>();

  const visit = (node: unknown, path: string): string => {
    if (node === null) return "null";
    switch (typeof node) {
      case "string":
        return JSON.stringify(node);
      case "boolean":
        return node ? "true" : "false";
      case "number":
        if (!Number.isFinite(node)) throw new CanonicalJsonError(`Non-finite number at ${path}`);
        if (!Number.isSafeInteger(node)) {
          throw new CanonicalJsonError(
            `Unsafe or fractional number at ${path}; use a decimal string for exact values`,
          );
        }
        return JSON.stringify(node);
      case "bigint":
        throw new CanonicalJsonError(`BigInt at ${path}; serialize it as a decimal string`);
      case "undefined":
        throw new CanonicalJsonError(`undefined at ${path}`);
      case "function":
      case "symbol":
        throw new CanonicalJsonError(`Unsupported ${typeof node} at ${path}`);
      default:
        break;
    }

    if (Array.isArray(node)) {
      if (seen.has(node)) throw new CanonicalJsonError(`Circular reference at ${path}`);
      seen.add(node);
      const out = `[${node.map((item, index) => visit(item, `${path}[${index}]`)).join(",")}]`;
      seen.delete(node);
      return out;
    }

    if (typeof node === "object") {
      const object = node as Record<string, unknown>;
      if (seen.has(object)) throw new CanonicalJsonError(`Circular reference at ${path}`);
      seen.add(object);
      const keys = Object.keys(object).sort();
      const parts: string[] = [];
      for (const key of keys) {
        const child = object[key];
        if (child === undefined) {
          throw new CanonicalJsonError(`undefined value at ${path}.${key}`);
        }
        parts.push(`${JSON.stringify(key)}:${visit(child, `${path}.${key}`)}`);
      }
      seen.delete(object);
      return `{${parts.join(",")}}`;
    }

    throw new CanonicalJsonError(`Unsupported value at ${path}`);
  };

  return visit(value, "$");
}

export function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalize(value));
}
