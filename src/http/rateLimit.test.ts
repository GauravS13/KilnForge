import { describe, expect, test } from "bun:test";
import { TokenBucketRateLimiter } from "./rateLimit.ts";

describe("TokenBucketRateLimiter", () => {
  test("allows requests up to capacity, then rejects", () => {
    let now = 0;
    const limiter = new TokenBucketRateLimiter({ capacity: 3, refillPerSecond: 1, now: () => now });
    expect(limiter.tryConsume("a")).toBe(true);
    expect(limiter.tryConsume("a")).toBe(true);
    expect(limiter.tryConsume("a")).toBe(true);
    expect(limiter.tryConsume("a")).toBe(false); // capacity exhausted
  });

  test("refills over time at the configured rate", () => {
    let now = 0;
    const limiter = new TokenBucketRateLimiter({ capacity: 2, refillPerSecond: 1, now: () => now });
    expect(limiter.tryConsume("a")).toBe(true);
    expect(limiter.tryConsume("a")).toBe(true);
    expect(limiter.tryConsume("a")).toBe(false);

    now += 1000; // 1 second elapsed -> 1 token refilled
    expect(limiter.tryConsume("a")).toBe(true);
    expect(limiter.tryConsume("a")).toBe(false); // only 1 was refilled
  });

  test("never refills past capacity, even after a very long gap", () => {
    let now = 0;
    const limiter = new TokenBucketRateLimiter({ capacity: 2, refillPerSecond: 100, now: () => now });
    limiter.tryConsume("a");
    limiter.tryConsume("a");
    now += 1_000_000; // enormous gap
    expect(limiter.tryConsume("a")).toBe(true);
    expect(limiter.tryConsume("a")).toBe(true);
    expect(limiter.tryConsume("a")).toBe(false); // still capped at capacity
  });

  test("different keys have independent buckets", () => {
    let now = 0;
    const limiter = new TokenBucketRateLimiter({ capacity: 1, refillPerSecond: 1, now: () => now });
    expect(limiter.tryConsume("a")).toBe(true);
    expect(limiter.tryConsume("a")).toBe(false);
    expect(limiter.tryConsume("b")).toBe(true); // separate key, separate bucket
  });

  test("cost > 1 consumes multiple tokens per call", () => {
    let now = 0;
    const limiter = new TokenBucketRateLimiter({ capacity: 5, refillPerSecond: 1, now: () => now });
    expect(limiter.tryConsume("a", 3)).toBe(true);
    expect(limiter.tryConsume("a", 3)).toBe(false); // only 2 tokens left
    expect(limiter.tryConsume("a", 2)).toBe(true);
  });

  test("sweeps stale buckets to bound memory over many distinct keys", () => {
    let now = 0;
    const limiter = new TokenBucketRateLimiter({
      capacity: 1,
      refillPerSecond: 1,
      now: () => now,
      staleAfterMs: 500,
    });
    for (let i = 0; i < 100; i++) limiter.tryConsume(`key-${i}`);
    expect(limiter.size).toBe(100);

    now += 1000; // past staleAfterMs for all of them
    // One more call triggers the sweep (sweep runs every 100 checks).
    for (let i = 0; i < 100; i++) limiter.tryConsume(`key-${i}-again`);
    expect(limiter.size).toBeLessThan(200); // old ones swept, not just accumulating forever
  });
});
