#!/usr/bin/env node
/**
 * Project-local PostgreSQL for machines without Docker.
 *
 * Downloads a relocatable PostgreSQL binary on first run (no root required),
 * initialises .data/postgres, creates the poolguard database and stays in the
 * foreground until SIGINT/SIGTERM. Docker Compose remains the documented default.
 */
import EmbeddedPostgres from "embedded-postgres";
import { existsSync, mkdirSync, readdirSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

const require = createRequire(import.meta.url);

/**
 * The prebuilt PostgreSQL binaries link against bundled shared libraries whose
 * SONAME symlinks (libpq.so.5, libicuuc.so.60, …) are not shipped. Create them in
 * the installed package and point the dynamic loader at that directory. This only
 * touches node_modules and is reproducible on a fresh install.
 */
function prepareBundledLibs() {
  let libDir;
  try {
    libDir = resolve(dirname(require.resolve("@embedded-postgres/linux-x64")), "..", "native", "lib");
  } catch {
    return;
  }
  if (!existsSync(libDir)) return;
  for (const file of readdirSync(libDir)) {
    const match = /^(lib.+?\.so)\.(\d+)\.\d+$/.exec(file);
    if (!match) continue;
    const linkName = join(libDir, `${match[1]}.${match[2]}`);
    if (!existsSync(linkName)) {
      try {
        symlinkSync(file, linkName);
      } catch {
        /* another process created it */
      }
    }
  }
  process.env.LD_LIBRARY_PATH = [libDir, process.env.LD_LIBRARY_PATH]
    .filter(Boolean)
    .join(":");
}

prepareBundledLibs();

const root = resolve(import.meta.dirname, "..");
const dataDir = resolve(root, ".data/postgres");
const port = Number(process.env.LOCAL_PG_PORT ?? 55432);
const user = process.env.LOCAL_PG_USER ?? "poolguard";
const password = process.env.LOCAL_PG_PASSWORD ?? "poolguard";
const database = process.env.LOCAL_PG_DATABASE ?? "poolguard";

mkdirSync(dataDir, { recursive: true });

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  port,
  user,
  password,
  authMethod: "scram-sha-256",
  persistent: true,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  onLog: (message) => {
    if (process.env.LOCAL_PG_VERBOSE === "1") console.log(`[pg] ${message}`);
  },
});

if (!existsSync(resolve(dataDir, "PG_VERSION"))) {
  console.log(`Initialising PostgreSQL in ${dataDir}…`);
  await pg.initialise();
}

await pg.start();
try {
  await pg.createDatabase(database);
  console.log(`Created database "${database}".`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!/already exists/i.test(message)) console.warn(`createDatabase: ${message}`);
}

console.log(
  `\nPostgreSQL ready on 127.0.0.1:${port}\n` +
    `DATABASE_URL="postgresql://${user}:${password}@127.0.0.1:${port}/${database}"\n`,
);

let stopping = false;
const shutdown = async (signal) => {
  if (stopping) return;
  stopping = true;
  console.log(`\n${signal}: stopping PostgreSQL…`);
  try {
    await pg.stop();
  } finally {
    process.exit(0);
  }
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

// Keep the process alive; the embedded postgres child is unmanaged.
await new Promise(() => {});
