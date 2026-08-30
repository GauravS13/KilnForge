/**
 * Wraps the one real Bun.Image constructor confirmed by the Foundation
 * Verification Harness (src/verify/capabilities.ts) — `new Bun.Image(bytes)`.
 * `Bun.image` (lowercase function) does not exist on the Bun version this
 * was verified against. Kept as a single call site so if a future Bun
 * version changes the shape, only this function needs updating — nothing
 * downstream cares how the instance was constructed.
 */
export function loadImage(bytes: Uint8Array): Bun.Image {
  return new Bun.Image(bytes);
}
