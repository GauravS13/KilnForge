import { describe, expect, test } from "bun:test";
import { resizeRoute } from "../../src/http/routes/resize.ts";
import { rotateRoute } from "../../src/http/routes/rotate.ts";
import { convertRoute } from "../../src/http/routes/convert.ts";
import { watermarkRoute } from "../../src/http/routes/watermark.ts";
import { startTestServer, imageFormData } from "../../src/http/routes/testServer.ts";

/**
 * Hand-rolled seeded-random property loop, NOT coverage-guided fuzzing —
 * disclosed honestly (see TASKS.md): unlike Go's stdlib `testing.F`,
 * Bun/JS has no native fuzzer. What this does have: a fixed seed for
 * reproducibility, a real HTTP round trip per iteration (not calling
 * handlers in isolation), and one property checked every time: garbage
 * input never produces anything but a clean 4xx and never crashes the
 * server or leaks a raw stack trace.
 */
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomBytes(rand: () => number, length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = Math.floor(rand() * 256);
  return out;
}

const SEED = 0xc0ffee;
const ITERATIONS = 200;

async function assertNeverCrashes(url: string, body: FormData): Promise<void> {
  const res = await fetch(url, { method: "POST", body });
  expect(res.status).toBeGreaterThanOrEqual(400);
  expect(res.status).toBeLessThan(500);
  const text = await res.text();
  // A real leaked stack trace has the shape "at <file>:<line>:<col>" or
  // "at <fn> (<file>:<line>:<col>)" — not the bare word "at", which
  // legitimately appears in real messages ("... at offset 0").
  expect(text).not.toMatch(/\bat\s+(\S+\s*\()?[^\s:]+:\d+:\d+/);
  expect(() => JSON.parse(text)).not.toThrow(); // always well-formed JSON error
}

describe("fuzz: image endpoints never crash on malformed input", () => {
  test(`${ITERATIONS} random-byte payloads against /resize always produce a clean 4xx`, async () => {
    const t = startTestServer("POST", "/resize", resizeRoute);
    const rand = mulberry32(SEED);
    try {
      for (let i = 0; i < ITERATIONS; i++) {
        const length = Math.floor(rand() * 500);
        const fd = imageFormData("image", randomBytes(rand, length));
        await assertNeverCrashes(`${t.url}?w=${Math.floor(rand() * 100)}`, fd);
      }
    } finally {
      t.stop();
    }
  });

  test(`${ITERATIONS} random-byte payloads against /rotate always produce a clean 4xx`, async () => {
    const t = startTestServer("POST", "/rotate", rotateRoute);
    const rand = mulberry32(SEED + 1);
    try {
      for (let i = 0; i < ITERATIONS; i++) {
        const length = Math.floor(rand() * 500);
        const fd = imageFormData("image", randomBytes(rand, length));
        await assertNeverCrashes(`${t.url}?deg=${Math.floor(rand() * 720 - 360)}`, fd);
      }
    } finally {
      t.stop();
    }
  });

  test(`${ITERATIONS} random-byte payloads against /convert always produce a clean 4xx`, async () => {
    const t = startTestServer("POST", "/convert", convertRoute);
    const rand = mulberry32(SEED + 2);
    const formats = ["jpeg", "png", "webp", "avif", "heic", "bmp", "gif", "bogus"];
    try {
      for (let i = 0; i < ITERATIONS; i++) {
        const length = Math.floor(rand() * 500);
        const fd = imageFormData("image", randomBytes(rand, length));
        const format = formats[Math.floor(rand() * formats.length)];
        await assertNeverCrashes(`${t.url}?format=${format}`, fd);
      }
    } finally {
      t.stop();
    }
  });

  test(`${ITERATIONS} random-byte payloads against /watermark always produce a clean 4xx`, async () => {
    const t = startTestServer("POST", "/watermark", watermarkRoute);
    const rand = mulberry32(SEED + 3);
    try {
      for (let i = 0; i < ITERATIONS; i++) {
        const fd = new FormData();
        fd.set("image", new Blob([randomBytes(rand, Math.floor(rand() * 300))]), "x.png");
        if (rand() > 0.5) {
          fd.set("logo", new Blob([randomBytes(rand, Math.floor(rand() * 300))]), "y.png");
        } else {
          fd.set("text", "HI");
        }
        await assertNeverCrashes(t.url, fd);
      }
    } finally {
      t.stop();
    }
  });

  test("truncated real PNG headers (valid signature, garbage/missing rest) never crash /resize", async () => {
    const t = startTestServer("POST", "/resize", resizeRoute);
    const rand = mulberry32(SEED + 4);
    const pngSig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    try {
      for (let i = 0; i < ITERATIONS; i++) {
        const truncLength = Math.floor(rand() * 50);
        const body = new Uint8Array(8 + truncLength);
        body.set(pngSig, 0);
        for (let j = 8; j < body.length; j++) body[j] = Math.floor(rand() * 256);
        const fd = imageFormData("image", body);
        await assertNeverCrashes(`${t.url}?w=10`, fd);
      }
    } finally {
      t.stop();
    }
  });
});
