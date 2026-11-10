import { describe, expect, it } from "vitest";
import { AccountQuota, KeyedLock, parseAccountAllowlist } from "./limits.js";

describe("KeyedLock", () => {
  it("serializes callbacks that share a key", async () => {
    const lock = new KeyedLock();
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const first = lock.run("k", async () => {
      order.push("first:start");
      await gate;
      order.push("first:end");
    });
    const second = lock.run("k", async () => {
      order.push("second");
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(order).toEqual(["first:start"]);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "first:end", "second"]);
    expect(lock.size).toBe(0);
  });

  it("keeps running after a callback throws", async () => {
    const lock = new KeyedLock();
    await expect(lock.run("k", async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(lock.run("k", async () => 7)).resolves.toBe(7);
  });
});

describe("AccountQuota", () => {
  it("limits actions per account within the window", () => {
    let now = 0;
    const quota = new AccountQuota(2, 1_000, () => now);
    expect(quota.consume("a.testnet").ok).toBe(true);
    expect(quota.consume("a.testnet").ok).toBe(true);
    const denied = quota.consume("a.testnet");
    expect(denied).toEqual({ ok: false, retryAfterSeconds: 1 });
    expect(quota.consume("b.testnet").ok).toBe(true);
    now = 1_001;
    expect(quota.consume("a.testnet").ok).toBe(true);
  });
});

describe("parseAccountAllowlist", () => {
  it("normalizes entries and treats empty as allow-all", () => {
    expect(parseAccountAllowlist(undefined)).toEqual([]);
    expect(parseAccountAllowlist(" Alice.testnet, ,bob.testnet ")).toEqual(["alice.testnet", "bob.testnet"]);
  });
});
