import { describe, expect, it } from "vitest";
import { parseTrustProxy } from "./config.js";

describe("parseTrustProxy", () => {
  it("defaults to no trusted proxy", () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy("")).toBe(false);
    expect(parseTrustProxy("false")).toBe(false);
    expect(parseTrustProxy("0")).toBe(false);
  });

  it("accepts a proxy IP or CIDR list", () => {
    expect(parseTrustProxy("127.0.0.1")).toBe("127.0.0.1");
    expect(parseTrustProxy("127.0.0.1, 10.0.0.0/8")).toEqual(["127.0.0.1", "10.0.0.0/8"]);
  });

  it("accepts explicit trust-all only when requested", () => {
    expect(parseTrustProxy("true")).toBe(true);
  });

  it("rejects hop counts because Fastify fails them closed", () => {
    expect(() => parseTrustProxy("1")).toThrow(/hop count/);
    expect(() => parseTrustProxy("2")).toThrow(/hop count/);
  });
});