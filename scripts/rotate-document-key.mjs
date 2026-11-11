#!/usr/bin/env node
/**
 * Re-encrypts every stored document from OLD_DOCUMENT_ENCRYPTION_KEY to
 * NEW_DOCUMENT_ENCRYPTION_KEY (both base64 of 32 bytes), in one transaction.
 *
 *   DATABASE_URL=... OLD_DOCUMENT_ENCRYPTION_KEY=... NEW_DOCUMENT_ENCRYPTION_KEY=... \
 *     node scripts/rotate-document-key.mjs            # dry run: decrypts and reports
 *   ... node scripts/rotate-document-key.mjs --apply  # writes
 *
 * Stop the API and worker first (see docs/OPERATIONS.md): a document written with
 * the old key after this runs would become unreadable.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "packages/db/package.json"));
const { PrismaClient } = require("@prisma/client");

const apply = process.argv.includes("--apply");
const key = (name) => {
  const value = Buffer.from(process.env[name] ?? "", "base64");
  if (value.length !== 32) throw new Error(`${name} must be base64 of exactly 32 bytes`);
  return value;
};
const oldKey = key("OLD_DOCUMENT_ENCRYPTION_KEY");
const newKey = key("NEW_DOCUMENT_ENCRYPTION_KEY");
if (oldKey.equals(newKey)) throw new Error("The new key is the same as the old key");

function decrypt(payload) {
  const [version, iv, tag, data] = payload.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Malformed encrypted document");
  const decipher = createDecipheriv("aes-256-gcm", oldKey, Buffer.from(iv, "base64"), { authTagLength: 16 });
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}
function encrypt(plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", newKey, iv, { authTagLength: 16 });
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64")}.${cipher.getAuthTag().toString("base64")}.${data.toString("base64")}`;
}

const prisma = new PrismaClient();
try {
  const documents = await prisma.document.findMany({ where: { removedAt: null }, select: { id: true, contentCiphertext: true } });
  // Decrypt everything first: if any document fails, nothing is written.
  const rewritten = documents.map((doc) => ({ id: doc.id, contentCiphertext: encrypt(decrypt(doc.contentCiphertext)) }));
  console.log(`${documents.length} document(s) decrypt with the old key.`);
  if (!apply) {
    console.log("Dry run. Re-run with --apply to write them with the new key.");
  } else {
    await prisma.$transaction(rewritten.map((doc) => prisma.document.update({ where: { id: doc.id }, data: { contentCiphertext: doc.contentCiphertext } })));
    console.log(`Re-encrypted ${rewritten.length} document(s). Now set DOCUMENT_ENCRYPTION_KEY to the new key on the API and worker.`);
  }
} finally {
  await prisma.$disconnect();
}
