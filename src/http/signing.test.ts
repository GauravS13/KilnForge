import { describe, expect, test } from "bun:test";
import { signTransformUrl, verifyTransformUrl } from "./signing.ts";

const SECRET = "test-secret-key";

describe("signTransformUrl / verifyTransformUrl", () => {
  test("a correctly signed, unexpired URL verifies", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const sig = await signTransformUrl(SECRET, "w=100,h=100", "img123", exp);
    const result = await verifyTransformUrl(SECRET, "w=100,h=100", "img123", exp, sig);
    expect(result.valid).toBe(true);
  });

  test("rejects an expired signature", async () => {
    const exp = Math.floor(Date.now() / 1000) - 10; // already expired
    const sig = await signTransformUrl(SECRET, "w=100", "img123", exp);
    const result = await verifyTransformUrl(SECRET, "w=100", "img123", exp, sig);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("expired");
  });

  test("rejects a tampered transform spec — the signature no longer matches", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const sig = await signTransformUrl(SECRET, "w=100,h=100", "img123", exp);
    const result = await verifyTransformUrl(SECRET, "w=999,h=999", "img123", exp, sig);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("bad-signature");
  });

  test("rejects a tampered source", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const sig = await signTransformUrl(SECRET, "w=100", "img123", exp);
    const result = await verifyTransformUrl(SECRET, "w=100", "img456", exp, sig);
    expect(result.valid).toBe(false);
  });

  test("rejects an attempt to extend expiry without re-signing — expiry is bound into the signature", async () => {
    const originalExp = Math.floor(Date.now() / 1000) + 60;
    const sig = await signTransformUrl(SECRET, "w=100", "img123", originalExp);
    const extendedExp = originalExp + 100000; // attacker tries to claim a much later expiry
    const result = await verifyTransformUrl(SECRET, "w=100", "img123", extendedExp, sig);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("bad-signature"); // signature doesn't match the new exp value
  });

  test("rejects a signature produced with the wrong secret", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const sig = await signTransformUrl("wrong-secret", "w=100", "img123", exp);
    const result = await verifyTransformUrl(SECRET, "w=100", "img123", exp, sig);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("bad-signature");
  });

  test("rejects a garbage/malformed signature string without throwing", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const result = await verifyTransformUrl(SECRET, "w=100", "img123", exp, "not-hex-at-all!!");
    expect(result.valid).toBe(false);
  });

  test("rejects a signature of the wrong length without throwing", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const result = await verifyTransformUrl(SECRET, "w=100", "img123", exp, "abcd");
    expect(result.valid).toBe(false);
  });

  test("a signature at exactly the expiry boundary (now === exp) is still valid", async () => {
    const exp = 1_000_000;
    const sig = await signTransformUrl(SECRET, "w=100", "img123", exp);
    const result = await verifyTransformUrl(SECRET, "w=100", "img123", exp, sig, exp);
    expect(result.valid).toBe(true);
  });
});
