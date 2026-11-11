import { describe, expect, it } from "vitest";
import { KeyPair } from "near-api-js";
import { bytesToHex } from "@poolguard/shared";
import { isNearAiBaseUrl, verifyResponseSignature, type AttestationSummary } from "./near-ai.js";
import { implicitAccountPublicKey } from "./outlayer.js";

const evidence = {
  chatId: "chatcmpl-123",
  model: "deepseek/deepseek-v4.1-flash",
  requestSha256: "a".repeat(64),
  responseSha256: "b".repeat(64),
};

function signer() {
  const pair = KeyPair.fromRandom("ed25519");
  const publicBytes = pair.getPublicKey().data;
  return { pair, address: bytesToHex(publicBytes) };
}

function attestation(address: string): AttestationSummary {
  return {
    provider: "near-ai",
    signingAlgo: "ed25519",
    gatewaySigningAddress: address,
    modelSigningAddresses: [],
    hasTdxQuote: true,
    nonceEchoed: true,
    tlsFingerprint: null,
    checkedAt: new Date().toISOString(),
  };
}

describe("NEAR AI private inference", () => {
  it("recognizes the NEAR AI Cloud endpoint", () => {
    expect(isNearAiBaseUrl("https://cloud-api.near.ai/v1")).toBe(true);
    expect(isNearAiBaseUrl("https://api.openai.com/v1")).toBe(false);
  });

  it("verifies a response signed by the attested key over our exact hashes", () => {
    const { pair, address } = signer();
    const text = `${evidence.requestSha256}:${evidence.responseSha256}`;
    const signature = bytesToHex(pair.sign(new TextEncoder().encode(text)).signature);
    const check = verifyResponseSignature({
      evidence,
      signature: { text, signature, signing_address: address, signing_algo: "ed25519", signature_kind: "gateway" },
      attestation: attestation(address),
    });
    expect(check.verified).toBe(true);
  });

  it("rejects a signature over different bytes or from an unattested key", () => {
    const { pair, address } = signer();
    const other = signer();
    const text = `${"c".repeat(64)}:${evidence.responseSha256}`;
    const signature = bytesToHex(pair.sign(new TextEncoder().encode(text)).signature);
    const mismatch = verifyResponseSignature({
      evidence,
      signature: { text, signature, signing_address: address, signing_algo: "ed25519" },
      attestation: attestation(address),
    });
    expect(mismatch.verified).toBe(false);

    const goodText = `${evidence.requestSha256}:${evidence.responseSha256}`;
    const goodSig = bytesToHex(pair.sign(new TextEncoder().encode(goodText)).signature);
    const unattested = verifyResponseSignature({
      evidence,
      signature: { text: goodText, signature: goodSig, signing_address: address, signing_algo: "ed25519" },
      attestation: attestation(other.address),
    });
    expect(unattested.verified).toBe(false);
  });
});

describe("OutLayer custody", () => {
  it("derives the signing key from a 64-hex implicit account id", () => {
    const pair = KeyPair.fromRandom("ed25519");
    const accountId = bytesToHex(pair.getPublicKey().data);
    expect(implicitAccountPublicKey(accountId)).toBe(pair.getPublicKey().toString());
    expect(implicitAccountPublicKey("agent-one.testnet")).toBeNull();
  });
});
