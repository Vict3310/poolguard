import { createDecipheriv } from "node:crypto";
import { base64ToBytes } from "@poolguard/shared";

/** AES-256-GCM document decryption; the key never leaves server configuration. */
export function decryptDocument(payload: string, keyBase64: string): string {
  if (!keyBase64) throw new Error("DOCUMENT_ENCRYPTION_KEY is required");
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
