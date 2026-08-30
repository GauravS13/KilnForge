import { describe, expect, test } from "bun:test";
import { MetricsRegistry } from "./counters.ts";

describe("MetricsRegistry", () => {
  test("counts requests and errors per endpoint independently", () => {
    const reg = new MetricsRegistry();
    reg.record("/resize", 10, false);
    reg.record("/resize", 20, true);
    reg.record("/rotate", 5, false);

    const snap = reg.snapshot();
    expect(snap["/resize"]!.count).toBe(2);
    expect(snap["/resize"]!.errorCount).toBe(1);
    expect(snap["/rotate"]!.count).toBe(1);
    expect(snap["/rotate"]!.errorCount).toBe(0);
  });

  test("computes p50/p95 from recorded durations", () => {
    const reg = new MetricsRegistry();
    for (let i = 1; i <= 100; i++) reg.record("/x", i, false);
    const snap = reg.snapshot();
    expect(snap["/x"]!.p50).toBeGreaterThan(40);
    expect(snap["/x"]!.p50).toBeLessThan(60);
    expect(snap["/x"]!.p95).toBeGreaterThan(90);
  });

  test("bounds memory with a rolling window rather than growing forever", () => {
    const reg = new MetricsRegistry();
    for (let i = 0; i < 5000; i++) reg.record("/y", i, false);
    const snap = reg.snapshot();
    expect(snap["/y"]!.count).toBe(5000); // count keeps accumulating...
    // ...but the underlying sample array is capped, provable indirectly:
    // p95 of the last 1000 durations (4000..4999) should be near 4950+,
    // not near the true p95 of the full 0..4999 range (~4750).
    expect(snap["/y"]!.p95).toBeGreaterThan(4900);
  });

  test("an unknown endpoint has no entry in the snapshot", () => {
    const reg = new MetricsRegistry();
    reg.record("/known", 1, false);
    expect(reg.snapshot()["/unknown"]).toBeUndefined();
  });

  test("toPrometheusText produces valid-shaped exposition lines", () => {
    const reg = new MetricsRegistry();
    reg.record("/resize", 12.3, false);
    const text = reg.toPrometheusText();
    expect(text).toContain('kilnforge_requests_total{endpoint="/resize"} 1');
    expect(text).toContain("kilnforge_request_duration_ms");
  });

  test("toPrometheusText escapes quotes in endpoint labels", () => {
    const reg = new MetricsRegistry();
    reg.record('/weird"path', 1, false);
    const text = reg.toPrometheusText();
    expect(text).toContain('\\"path');
  });

  test("empty registry produces an empty (not malformed) Prometheus text", () => {
    const reg = new MetricsRegistry();
    expect(reg.toPrometheusText()).toBe("");
  });
});
