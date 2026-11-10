import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EnvConfigurationError, findRepoRoot, loadRootEnv, resolveEnvPlan } from "./env.js";

const roots: string[] = [];

function fixture(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "poolguard-env-"));
  roots.push(root);
  writeFileSync(join(root, "pnpm-workspace.yaml"), 'packages:\n  - "apps/*"\n');
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(root, name), content);
  }
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("environment loader", () => {
  it("loads .env then .env.testnet, and the process environment wins", () => {
    const root = fixture({
      ".env": "NEAR_NETWORK=sandbox\nSHARED=base\n",
      ".env.testnet":
        "NEAR_NETWORK=testnet\nPOOLGUARD_CONTRACT_ID=poolguard.testnet\nSHARED=testnet\n",
    });
    const environ = { SHARED: "process" } as NodeJS.ProcessEnv;

    loadRootEnv({ root, environ });

    expect(environ.NEAR_NETWORK).toBe("testnet");
    expect(environ.POOLGUARD_CONTRACT_ID).toBe("poolguard.testnet");
    expect(environ.SHARED).toBe("process");
  });

  it("loads .env.testnet when .env is absent", () => {
    const root = fixture({ ".env.testnet": "NEAR_NETWORK=testnet\nNODE_ENV=production\n" });
    const environ = {} as NodeJS.ProcessEnv;

    loadRootEnv({ root, environ });

    expect(environ.NEAR_NETWORK).toBe("testnet");
    expect(environ.NODE_ENV).toBe("production");
  });

  it("refuses .env.local in testnet mode and does not leak sandbox keys", () => {
    const root = fixture({
      ".env": "NEAR_NETWORK=sandbox\n",
      ".env.testnet": "NEAR_NETWORK=testnet\n",
      ".env.local": "SANDBOX_OWNER_PRIVATE_KEY=ed25519:test\n",
    });
    const environ = {} as NodeJS.ProcessEnv;

    expect(() => loadRootEnv({ root, environ })).toThrow(EnvConfigurationError);
    expect(environ.SANDBOX_OWNER_PRIVATE_KEY).toBeUndefined();
  });

  it("refuses .env.local in production mode", () => {
    const root = fixture({
      ".env": "NODE_ENV=production\nNEAR_NETWORK=testnet\n",
      ".env.local": "ALLOW_DEV_SESSION=true\n",
    });
    const environ = {} as NodeJS.ProcessEnv;

    expect(() => loadRootEnv({ root, environ })).toThrow(/Refusing to load/);
    expect(environ.ALLOW_DEV_SESSION).toBeUndefined();
  });

  it("loads .env.local outside production and testnet", () => {
    const root = fixture({
      ".env": "NODE_ENV=development\nNEAR_NETWORK=sandbox\nSHARED=base\n",
      ".env.local": "SHARED=local\nSANDBOX_OWNER_PRIVATE_KEY=ed25519:test\n",
    });
    const environ = {} as NodeJS.ProcessEnv;

    loadRootEnv({ root, environ });

    expect(environ.SHARED).toBe("local");
    expect(environ.SANDBOX_OWNER_PRIVATE_KEY).toBe("ed25519:test");
  });

  it("honours POOLGUARD_ENV_FILE over the default testnet overlay", () => {
    const root = fixture({
      ".env": "NEAR_NETWORK=sandbox\n",
      ".env.testnet": "NEAR_NETWORK=testnet\nPOOLGUARD_CONTRACT_ID=poolguard.testnet\n",
      ".env.staging": "NEAR_NETWORK=testnet\nPOOLGUARD_CONTRACT_ID=staging.testnet\n",
    });
    const environ = { POOLGUARD_ENV_FILE: ".env.staging" } as NodeJS.ProcessEnv;

    loadRootEnv({ root, environ });

    expect(environ.POOLGUARD_CONTRACT_ID).toBe("staging.testnet");
  });

  it("fails when POOLGUARD_ENV_FILE points at a missing file", () => {
    const root = fixture({ ".env": "NEAR_NETWORK=sandbox\n" });

    expect(() =>
      resolveEnvPlan({ root, environ: { POOLGUARD_ENV_FILE: ".env.missing" } as NodeJS.ProcessEnv }),
    ).toThrow(/does not exist/);
  });

  it("finds the workspace root from a package directory", () => {
    const root = fixture();
    mkdirSync(join(root, "apps", "api"), { recursive: true });

    expect(findRepoRoot(join(root, "apps", "api"))).toBe(root);
  });
});
