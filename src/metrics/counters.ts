interface EndpointStats {
  count: number;
  errorCount: number;
  /** Rolling window, bounded — not an ever-growing array. */
  durationsMs: number[];
}

const MAX_SAMPLES_PER_ENDPOINT = 1000;

export interface EndpointSnapshot {
  count: number;
  errorCount: number;
  p50: number;
  p95: number;
}

/** In-memory per-endpoint counters — plain objects and `performance.now()`
 * (a web-platform built-in, not a metrics package), hand-formatted into
 * both JSON and Prometheus text exposition. */
export class MetricsRegistry {
  private readonly stats = new Map<string, EndpointStats>();

  record(endpoint: string, durationMs: number, isError: boolean): void {
    let s = this.stats.get(endpoint);
    if (!s) {
      s = { count: 0, errorCount: 0, durationsMs: [] };
      this.stats.set(endpoint, s);
    }
    s.count++;
    if (isError) s.errorCount++;
    s.durationsMs.push(durationMs);
    if (s.durationsMs.length > MAX_SAMPLES_PER_ENDPOINT) s.durationsMs.shift();
  }

  private percentile(durations: number[], p: number): number {
    if (durations.length === 0) return 0;
    const sorted = [...durations].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
    return Math.round(sorted[idx]! * 100) / 100;
  }

  snapshot(): Record<string, EndpointSnapshot> {
    const out: Record<string, EndpointSnapshot> = {};
    for (const [endpoint, s] of this.stats) {
      out[endpoint] = {
        count: s.count,
        errorCount: s.errorCount,
        p50: this.percentile(s.durationsMs, 0.5),
        p95: this.percentile(s.durationsMs, 0.95),
      };
    }
    return out;
  }

  toPrometheusText(): string {
    const lines: string[] = [];
    for (const [endpoint, snap] of Object.entries(this.snapshot())) {
      const label = endpoint.replace(/"/g, '\\"');
      lines.push(`kilnforge_requests_total{endpoint="${label}"} ${snap.count}`);
      lines.push(`kilnforge_errors_total{endpoint="${label}"} ${snap.errorCount}`);
      lines.push(`kilnforge_request_duration_ms{endpoint="${label}",quantile="0.5"} ${snap.p50}`);
      lines.push(`kilnforge_request_duration_ms{endpoint="${label}",quantile="0.95"} ${snap.p95}`);
    }
    return lines.join("\n") + (lines.length ? "\n" : "");
  }
}

/** One process-wide registry — every route records into this via
 * src/http/server.ts's dispatch, so no route needs to know metrics
 * exist. */
export const metricsRegistry = new MetricsRegistry();
