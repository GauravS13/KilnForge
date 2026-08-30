import { describe, expect, test } from "bun:test";
import { archiveUnpackRoute } from "../../src/http/routes/archiveUnpack.ts";
import { batchRoute } from "../../src/http/routes/batch.ts";
import { startTestServer } from "../../src/http/routes/testServer.ts";

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

const SEED = 0xdecafbad;
const ITERATIONS = 150;

async function assertNeverCrashes(url: string, body: FormData): Promise<void> {
  const res = await fetch(url, { method: "POST", body });
  expect(res.status).toBeGreaterThanOrEqual(400);
  expect(res.status).toBeLessThan(500);
  const text = await res.text();
  // A real leaked stack trace has the shape "at <file>:<line>:<col>" or
  // "at <fn> (<file>:<line>:<col>)" — checking for that shape, not the
  // bare word "at", which legitimately appears in real error messages
  // like "malformed tar header at offset 0" and would otherwise false-
  // positive here.
  expect(text).not.toMatch(/\bat\s+(\S+\s*\()?[^\s:]+:\d+:\d+/);
  expect(() => JSON.parse(text)).not.toThrow();
}

describe("fuzz: archive endpoints never crash on malformed input", () => {
  test(`${ITERATIONS} random-byte payloads against /archive/unpack always produce a clean 4xx`, async () => {
    const t = startTestServer("POST", "/archive/unpack", archiveUnpackRoute);
    const rand = mulberry32(SEED);
    try {
      for (let i = 0; i < ITERATIONS; i++) {
        const fd = new FormData();
        fd.set("archive", new Blob([randomBytes(rand, Math.floor(rand() * 2000))]), "x.tar");
        await assertNeverCrashes(t.url, fd);
      }
    } finally {
      t.stop();
    }
  });

  test(`${ITERATIONS} random-byte payloads against /batch always produce a clean 4xx`, async () => {
    const t = startTestServer("POST", "/batch", batchRoute);
    const rand = mulberry32(SEED + 1);
    try {
      for (let i = 0; i < ITERATIONS; i++) {
        const fd = new FormData();
        fd.set("archive", new Blob([randomBytes(rand, Math.floor(rand() * 2000))]), "x.tar");
        await assertNeverCrashes(`${t.url}?format=png`, fd);
      }
    } finally {
      t.stop();
    }
  });

  test("truncated real tar headers (valid-looking start, garbage rest) never crash /archive/unpack", async () => {
    const t = startTestServer("POST", "/archive/unpack", archiveUnpackRoute);
    const rand = mulberry32(SEED + 2);
    try {
      for (let i = 0; i < ITERATIONS; i++) {
        // A plausible-looking name field followed by random bytes where
        // the rest of a real ustar header would be — the interesting
        // fuzz surface for a byte-level header parser, not just pure
        // noise, which random full-file bytes already covers above.
        const block = new Uint8Array(512);
        const name = new TextEncoder().encode(`file-${i}.txt`);
        block.set(name, 0);
        for (let j = 100; j < 512; j++) block[j] = Math.floor(rand() * 256);
        const fd = new FormData();
        fd.set("archive", new Blob([block]), "x.tar");
        await assertNeverCrashes(t.url, fd);
      }
    } finally {
      t.stop();
    }
  });
});
