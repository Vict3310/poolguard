import { describe, expect, it } from "vitest";
import {
  AmountError,
  canonicalize,
  computeOperationId,
  computeRequestHash,
  deriveTaskLifecycle,
  formatYoctoToNear,
  operationBindingPayload,
  parseNearToYocto,
  parseYoctoString,
  providerAuthPayload,
  sha256Hex,
  extractDenialCode,
  canTransitionPayment,
} from "./index.js";

describe("sha256", () => {
  it("matches FIPS 180-4 vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
  });

  it("handles multi-block input and UTF-8", () => {
    expect(sha256Hex("a".repeat(1000))).toHaveLength(64);
    expect(sha256Hex("héllo")).toBe(sha256Hex(new TextEncoder().encode("héllo")));
  });
});

describe("canonicalize", () => {
  it("sorts keys at every depth and is stable", () => {
    const a = { b: 1, a: { d: "x", c: [3, 2, 1] } };
    const b = { a: { c: [3, 2, 1], d: "x" }, b: 1 };
    expect(canonicalize(a)).toBe('{"a":{"c":[3,2,1],"d":"x"},"b":1}');
    expect(canonicalize(a)).toBe(canonicalize(b));
  });

  it("rejects non-exact numbers and undefined", () => {
    expect(() => canonicalize({ amount: 0.1 })).toThrow();
    expect(() => canonicalize({ x: undefined })).toThrow();
    expect(() => canonicalize({ x: 2n })).toThrow();
    expect(() => canonicalize({ n: Number.NaN })).toThrow();
  });
});

describe("amounts", () => {
  it("parses NEAR exactly and rejects float input", () => {
    expect(parseNearToYocto("0.03")).toBe(30_000_000_000_000_000_000_000n);
    expect(parseNearToYocto("1")).toBe(10n ** 24n);
    expect(parseNearToYocto("0.000000000000000000000001")).toBe(1n);
    expect(() => parseNearToYocto("1e-3")).toThrow(AmountError);
    expect(() => parseNearToYocto("0.0000000000000000000000001")).toThrow(AmountError);
    // @ts-expect-error numbers are rejected at runtime too
    expect(() => parseNearToYocto(0.1)).toThrow(AmountError);
  });

  it("formats without losing precision", () => {
    expect(formatYoctoToNear("30000000000000000000000")).toBe("0.03");
    expect(formatYoctoToNear("1")).toBe("0.000000000000000000000001");
    expect(formatYoctoToNear("20000000000000000000000000")).toBe("20");
    expect(formatYoctoToNear("10000000000000000000000", { minFractionDigits: 4 })).toBe("0.0100");
    // Exactness beats prettiness: a nonzero dust balance must not render as zero.
    expect(formatYoctoToNear("1", { minFractionDigits: 4 })).toBe(
      "0.000000000000000000000001",
    );
  });

  it("rejects non-canonical yocto strings", () => {
    expect(() => parseYoctoString("01")).toThrow();
    expect(() => parseYoctoString("-1")).toThrow();
    expect(() => parseYoctoString("1.0")).toThrow();
  });
});

describe("operation identity", () => {
  const binding = {
    network: "testnet",
    contractId: "poolguard.testnet",
    taskId: "supplier-review",
    agentAccountId: "agent-one.testnet",
    providerAccountId: "extract.provider.testnet",
    amountYocto: "20000000000000000000000",
    serviceId: "doc-extract-v1",
    requestHash: "a".repeat(64),
    outputSchemaHash: "b".repeat(64),
    policyVersion: 1,
    expiresAtBlock: 1000,
  };

  it("is deterministic regardless of property order", () => {
    const reordered = {
      expiresAtBlock: 1000,
      policyVersion: 1,
      outputSchemaHash: "b".repeat(64),
      requestHash: "a".repeat(64),
      serviceId: "doc-extract-v1",
      amountYocto: "20000000000000000000000",
      providerAccountId: "extract.provider.testnet",
      agentAccountId: "agent-one.testnet",
      taskId: "supplier-review",
      contractId: "poolguard.testnet",
      network: "testnet",
    };
    expect(computeOperationId(binding)).toBe(computeOperationId(reordered));
    expect(computeOperationId(binding)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when any bound field changes", () => {
    const base = computeOperationId(binding);
    const variants = [
      { ...binding, amountYocto: "19999999999999999999999" },
      { ...binding, policyVersion: 2 },
      { ...binding, expiresAtBlock: 1001 },
      { ...binding, requestHash: "c".repeat(64) },
      { ...binding, agentAccountId: "agent-two.testnet" },
      { ...binding, providerAccountId: "other.provider.testnet" },
      { ...binding, serviceId: "doc-summary-v1" },
    ];
    for (const variant of variants) expect(computeOperationId(variant)).not.toBe(base);
    expect(operationBindingPayload(binding).domain).toBe("poolguard/operation/v1");
  });

  it("request hashes bind service and input", () => {
    expect(computeRequestHash("doc-extract-v1", { text: "hello" })).toBe(
      computeRequestHash("doc-extract-v1", { text: "hello" }),
    );
    expect(computeRequestHash("doc-extract-v1", { text: "hello" })).not.toBe(
      computeRequestHash("doc-extract-v1", { text: "hello!" }),
    );
    expect(computeRequestHash("doc-extract-v1", { text: "hello" })).not.toBe(
      computeRequestHash("doc-summary-v1", { text: "hello" }),
    );
  });
});

describe("provider auth payload", () => {
  it("is canonical and binds every authorization field", () => {
    const payload = providerAuthPayload({
      domain: "provider.test",
      network: "testnet",
      contractId: "poolguard.testnet",
      action: "purchase",
      operationId: "a".repeat(64),
      requestHash: "b".repeat(64),
      issuedAt: "2026-10-29T10:00:00.000Z",
      nonce: "nonce-1234567890",
    });
    expect(canonicalize(payload)).toContain('"action":"purchase"');
    expect(canonicalize({ ...payload, action: "result" })).not.toBe(canonicalize(payload));
  });
});

describe("state helpers", () => {
  it("payment transitions are one-way", () => {
    expect(canTransitionPayment("reserved", "payout_pending")).toBe(true);
    expect(canTransitionPayment("paid", "payout_pending")).toBe(false);
    expect(canTransitionPayment("payout_pending", "paid")).toBe(true);
    expect(extractDenialCode("Smart contract panicked: INSUFFICIENT_AVAILABLE_BUDGET")).toBe(
      "INSUFFICIENT_AVAILABLE_BUDGET",
    );
    expect(extractDenialCode("something else")).toBeNull();
  });

  it("derives task lifecycle", () => {
    const base = {
      paused: false,
      totalFunded: "100",
      available: "100",
      reserved: "0",
      currentBlock: 10,
      expiresAtBlock: 100,
    };
    expect(deriveTaskLifecycle(base)).toBe("active");
    expect(deriveTaskLifecycle({ ...base, paused: true })).toBe("paused");
    expect(deriveTaskLifecycle({ ...base, currentBlock: 101 })).toBe("expired");
    expect(deriveTaskLifecycle({ ...base, totalFunded: "0", available: "0" })).toBe(
      "awaiting_funding",
    );
    expect(deriveTaskLifecycle({ ...base, available: "0" })).toBe("completed");
  });
});
