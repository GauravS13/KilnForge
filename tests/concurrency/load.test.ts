import { describe, expect, test } from "bun:test";
import { createRouteTable, createServer, register } from "../../src/http/server.ts";
import { resizeRoute } from "../../src/http/routes/resize.ts";
import { convertRoute } from "../../src/http/routes/convert.ts";
import { watermarkRoute } from "../../src/http/routes/watermark.ts";
import { archivePackRoute } from "../../src/http/routes/archivePack.ts";
import { batchRoute } from "../../src/http/routes/batch.ts";
import { decodePng } from "../../src/image/png.ts";
import { encodePng } from "../../src/image/png.ts";

function makeDistinctImage(seed: number, width = 12, height = 12): Uint8Array {
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4] = (seed * 7 + i * 3) % 256;
    pixels[i * 4 + 1] = (seed * 11 + i * 5) % 256;
    pixels[i * 4 + 2] = (seed * 13 + i * 7) % 256;
    pixels[i * 4 + 3] = 255;
  }
  return encodePng({ width, height, pixels });
}

describe("concurrency: N-way concurrent requests never corrupt or cross-contaminate output", () => {
  test("50 concurrent /resize requests with distinct images each return their OWN correct output", async () => {
    const table = createRouteTable();
    register(table, "POST", "/resize", resizeRoute);
    const server = createServer(table, 0);

    const N = 50;
    try {
      const requests = Array.from({ length: N }, async (_, i) => {
        const img = makeDistinctImage(i);
        const fd = new FormData();
        fd.set("image", new Blob([img]), "x.png");
        const res = await fetch(`http://localhost:${server.port}/resize?w=6&format=png`, {
          method: "POST",
          body: fd,
        });
        const out = new Uint8Array(await res.arrayBuffer());
        return { i, status: res.status, decoded: decodePng(out) };
      });

      const results = await Promise.all(requests);
      for (const r of results) {
        expect(r.status).toBe(200);
        expect(r.decoded.width).toBe(6);
        expect(r.decoded.height).toBe(6);
      }

      // Cross-contamination check: every result's pixel content must be
      // genuinely distinct from every other (since every input image was
      // built with a distinct seed) — if requests corrupted each other's
      // in-flight state, some outputs would be identical or garbled.
      const signatures = results.map((r) => Array.from(r.decoded.pixels.slice(0, 16)).join(","));
      expect(new Set(signatures).size).toBe(N);
    } finally {
      server.stop(true);
    }
  });

  test("mixed endpoints (resize, convert, watermark) fired concurrently all complete correctly", async () => {
    const table = createRouteTable();
    register(table, "POST", "/resize", resizeRoute);
    register(table, "POST", "/convert", convertRoute);
    register(table, "POST", "/watermark", watermarkRoute);
    const server = createServer(table, 0);

    try {
      const requests: Promise<number>[] = [];
      for (let i = 0; i < 20; i++) {
        const img = makeDistinctImage(i, 10, 10);
        const fd1 = new FormData();
        fd1.set("image", new Blob([img]), "x.png");
        requests.push(
          fetch(`http://localhost:${server.port}/resize?w=5&format=png`, { method: "POST", body: fd1 }).then(
            (r) => r.status,
          ),
        );

        const fd2 = new FormData();
        fd2.set("image", new Blob([img]), "x.png");
        requests.push(
          fetch(`http://localhost:${server.port}/convert?format=jpeg`, { method: "POST", body: fd2 }).then(
            (r) => r.status,
          ),
        );

        const fd3 = new FormData();
        fd3.set("image", new Blob([img]), "x.png");
        requests.push(
          fetch(`http://localhost:${server.port}/watermark?text=HI&format=png`, {
            method: "POST",
            body: fd3,
          }).then((r) => r.status),
        );
      }

      const statuses = await Promise.all(requests);
      expect(statuses.every((s) => s === 200)).toBe(true);
      expect(statuses.length).toBe(60);
    } finally {
      server.stop(true);
    }
  });

  test("concurrent /archive/pack and /batch requests don't cross-contaminate archive contents", async () => {
    const table = createRouteTable();
    register(table, "POST", "/archive/pack", archivePackRoute);
    register(table, "POST", "/batch", batchRoute);
    const server = createServer(table, 0);

    const N = 20;
    try {
      const requests = Array.from({ length: N }, async (_, i) => {
        const fd = new FormData();
        fd.append("files", new Blob([new TextEncoder().encode(`content-${i}`)]), `file-${i}.txt`);
        const res = await fetch(`http://localhost:${server.port}/archive/pack`, { method: "POST", body: fd });
        const bytes = new Uint8Array(await res.arrayBuffer());
        const archive = new Bun.Archive(bytes);
        const files = await archive.files();
        const text = await files.get(`file-${i}.txt`)!.text();
        return { i, text };
      });

      const results = await Promise.all(requests);
      for (const r of results) {
        expect(r.text).toBe(`content-${r.i}`); // each archive has exactly its OWN content, not another request's
      }
    } finally {
      server.stop(true);
    }
  });

  test("Bun.Archive threading behavior under concurrent load — measures, doesn't assume, the off-main-thread claim", async () => {
    // The Foundation Verification Harness already probes this directly
    // (src/verify/capabilities.ts). This is the complementary check at
    // the HTTP layer: fire a real archive-heavy request alongside many
    // lightweight ones and confirm the lightweight ones aren't starved —
    // a coarse signal, not a precise benchmark, that archive work isn't
    // blocking the event loop badly enough to matter in practice.
    const table = createRouteTable();
    register(table, "POST", "/archive/pack", archivePackRoute);
    const server = createServer(table, 0);

    try {
      const heavyFiles: { name: string; data: Blob }[] = [];
      for (let i = 0; i < 50; i++) {
        heavyFiles.push({ name: `f${i}.txt`, data: new Blob([new Uint8Array(50_000)]) });
      }
      const heavyFd = new FormData();
      for (const f of heavyFiles) heavyFd.append("files", f.data, f.name);

      const heavyPromise = fetch(`http://localhost:${server.port}/archive/pack`, {
        method: "POST",
        body: heavyFd,
      });

      const lightStart = performance.now();
      const lightFd = new FormData();
      lightFd.append("files", new Blob([new Uint8Array(10)]), "tiny.txt");
      const lightRes = await fetch(`http://localhost:${server.port}/archive/pack`, {
        method: "POST",
        body: lightFd,
      });
      const lightDuration = performance.now() - lightStart;

      expect(lightRes.status).toBe(200);
      await heavyPromise;
      // Not a strict assertion on threading model — just confirms the
      // server stays responsive (didn't hang) under concurrent archive load.
      expect(lightDuration).toBeLessThan(5000);
    } finally {
      server.stop(true);
    }
  });
});
