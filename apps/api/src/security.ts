import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { base64ToBytes, bytesToBase64, sha256Hex } from "@poolguard/shared";

export const SESSION_COOKIE = "pg_session";
export const CSRF_COOKIE = "pg_csrf";
export const CSRF_HEADER = "x-poolguard-csrf";

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * NEP-413 nonces are raw 32-byte arrays. Browsers decode this string with `atob`,
 * so it must use the standard base64 alphabet rather than base64url.
 */
export function randomNonce(): string {
  return randomBytes(32).toString("base64");
}

export function hashToken(token: string): string {
  return sha256Hex(token);
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function buildChallengeMessage(input: {
  domain: string;
  accountId: string;
  nonce: string;
  network: string;
  issuedAt: Date;
  expiresAt: Date;
}): string {
  return [
    `${input.domain} wants you to sign in with your NEAR account.`,
    "",
    `Account: ${input.accountId}`,
    `Nonce: ${input.nonce}`,
    `Network: ${input.network}`,
    `Issued At: ${input.issuedAt.toISOString()}`,
    `Expiration Time: ${input.expiresAt.toISOString()}`,
  ].join("\n");
}

/** AES-256-GCM for small private documents at rest. */
export function encryptDocument(plaintext: string, keyBase64: string): string {
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) throw new Error("DOCUMENT_ENCRYPTION_KEY must decode to 32 bytes");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${bytesToBase64(iv)}.${bytesToBase64(tag)}.${bytesToBase64(ciphertext)}`;
}

export function decryptDocument(payload: string, keyBase64: string): string {
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") throw new Error("Malformed encrypted document");
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) throw new Error("DOCUMENT_ENCRYPTION_KEY must decode to 32 bytes");
  const iv = Buffer.from(base64ToBytes(parts[1]!));
  const tag = Buffer.from(base64ToBytes(parts[2]!));
  const ciphertext = Buffer.from(base64ToBytes(parts[3]!));
  // Require the full 128-bit tag and 96-bit IV: GCM otherwise accepts truncated
  // tags, which weakens authentication of the stored ciphertext.
  if (iv.length !== 12 || tag.length !== 16) throw new Error("Malformed encrypted document");
  const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function cookieOptions(input: { secure: boolean; maxAgeSeconds: number }) {
  return {
    path: "/",
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure: input.secure,
    maxAge: input.maxAgeSeconds,
  };
}

export function csrfCookieOptions(input: { secure: boolean; maxAgeSeconds: number }) {
  return { ...cookieOptions(input), httpOnly: false as const };
}
