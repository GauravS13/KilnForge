import { timingSafeEqual } from "node:crypto";

/**
 * HMAC-SHA256 signing for transform URLs (spec §16.1). The expiry is
 * bound INTO the signed payload itself, not checked as a separate step —
 * an attacker can't strip or extend it without invalidating the
 * signature, since it's part of what got signed.
 */

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function signedMessage(transformSpec: string, source: string, exp: number): string {
  return `${transformSpec}|${source}|${exp}`;
}

export async function signTransformUrl(
  secret: string,
  transformSpec: string,
  source: string,
  expiresAt: number,
): Promise<string> {
  return hmacSha256Hex(secret, signedMessage(transformSpec, source, expiresAt));
}

export interface VerifyResult {
  valid: boolean;
  reason?: "expired" | "bad-signature";
}

/**
 * Constant-time signature comparison (node:crypto's timingSafeEqual, both
 * sides decoded from hex to equal-length byte buffers first — it throws
 * on unequal-length inputs, which a forged signature of the wrong length
 * would trigger, so that case is caught explicitly rather than left to
 * throw past this function).
 */
export async function verifyTransformUrl(
  secret: string,
  transformSpec: string,
  source: string,
  expiresAt: number,
  providedSignature: string,
  nowSeconds = Date.now() / 1000,
): Promise<VerifyResult> {
  if (nowSeconds > expiresAt) return { valid: false, reason: "expired" };

  const expected = await hmacSha256Hex(secret, signedMessage(transformSpec, source, expiresAt));
  if (expected.length !== providedSignature.length) return { valid: false, reason: "bad-signature" };

  const expectedBuf = Buffer.from(expected, "hex");
  const providedBuf = Buffer.from(providedSignature, "hex");
  if (expectedBuf.length !== providedBuf.length || !timingSafeEqual(expectedBuf, providedBuf)) {
    return { valid: false, reason: "bad-signature" };
  }
  return { valid: true };
}
