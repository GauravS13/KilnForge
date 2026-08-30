interface Bucket {
  tokens: number;
  lastRefill: number;
}

export interface TokenBucketOptions {
  /** Max tokens a bucket can hold — the burst size. */
  capacity: number;
  /** Tokens added per second. */
  refillPerSecond: number;
  /** Injectable clock, for deterministic tests. Defaults to Date.now. */
  now?: () => number;
  /** Evict a key's bucket if untouched for this many ms — bounds memory
   * for a long-running process seeing many distinct IPs. Default 10 min. */
  staleAfterMs?: number;
}

/**
 * Stdlib token-bucket rate limiter, keyed by a caller-supplied string
 * (typically an IP — extraction is the HTTP layer's job, kept separate
 * here so this class is testable without a real request/server). Lazily
 * refills on each check rather than running a background timer, and
 * lazily sweeps stale entries on a fraction of calls rather than a
 * separate interval — no setInterval keeping the process alive.
 */
export class TokenBucketRateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly capacity: number;
  private readonly refillPerSecond: number;
  private readonly now: () => number;
  private readonly staleAfterMs: number;
  private checksSinceSweep = 0;

  constructor(options: TokenBucketOptions) {
    this.capacity = options.capacity;
    this.refillPerSecond = options.refillPerSecond;
    this.now = options.now ?? (() => Date.now());
    this.staleAfterMs = options.staleAfterMs ?? 10 * 60 * 1000;
  }

  /** Returns true and consumes `cost` tokens if the key has enough;
   * returns false (consuming nothing) otherwise. */
  tryConsume(key: string, cost = 1): boolean {
    const now = this.now();
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: this.capacity, lastRefill: now };
      this.buckets.set(key, bucket);
    }

    const elapsedSeconds = Math.max(0, (now - bucket.lastRefill) / 1000);
    bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsedSeconds * this.refillPerSecond);
    bucket.lastRefill = now;

    this.maybeSweep(now);

    if (bucket.tokens >= cost) {
      bucket.tokens -= cost;
      return true;
    }
    return false;
  }

  private maybeSweep(now: number): void {
    this.checksSinceSweep++;
    if (this.checksSinceSweep < 100) return;
    this.checksSinceSweep = 0;
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.lastRefill > this.staleAfterMs) this.buckets.delete(key);
    }
  }

  /** For tests/observability — not part of the rate-limiting contract. */
  get size(): number {
    return this.buckets.size;
  }
}

/** Extracts a rate-limit key from a request: the real client IP via
 * Bun's server.requestIP() when available, falling back to a shared
 * "unknown" bucket only if the runtime genuinely can't determine one
 * (never silently exempting unidentifiable clients from the limit). */
export function rateLimitKeyFor(req: Request, server: { requestIP(req: Request): { address: string } | null }): string {
  const ip = server.requestIP(req);
  return ip?.address ?? "unknown";
}
