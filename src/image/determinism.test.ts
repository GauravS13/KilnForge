import { describe, expect, test } from "bun:test";
import { verifyDeterministicOutput, transformIdentityHash } from "./determinism.ts";
import { processImage } from "./process.ts";
import { encodePng } from "./png.ts";

function makeTestPng(width: number, height: number): Uint8Array {
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4] = (i * 61) % 256;
    pixels[i * 4 + 1] = (i * 97) % 256;
    pixels[i * 4 + 2] = (i * 131) % 256;
    pixels[i * 4 + 3] = 255;
  }
  return encodePng({ width, height, pixels });
}

describe("verifyDeterministicOutput", () => {
  test("confirms the full processImage() pipeline is deterministic across real runs", async () => {
    const src = makeTestPng(20, 20);
    const result = await verifyDeterministicOutput(
      () => processImage(src, { width: 10, height: 10, fit: "cover", format: "jpeg", quality: 85 }),
      3,
    );
    expect(result.deterministic).toBe(true);
    expect(result.hashes.length).toBe(3);
    expect(new Set(result.hashes).size).toBe(1); // all three hashes identical
  });

  test("confirms determinism across the arbitrary-rotation fallback path too", async () => {
    const src = makeTestPng(15, 15);
    const result = await verifyDeterministicOutput(
      () => processImage(src, { rotateDeg: 37, format: "png" }),
      3,
    );
    expect(result.deterministic).toBe(true);
  });

  test("catches a genuinely non-deterministic producer (sanity check on the checker itself)", async () => {
    let counter = 0;
    const result = await verifyDeterministicOutput(async () => {
      counter++;
      return new TextEncoder().encode(`run-${counter}`);
    }, 3);
    expect(result.deterministic).toBe(false);
  });
});

describe("transformIdentityHash", () => {
  test("same inputs always produce the same hash", async () => {
    const a = await transformIdentityHash("img123", "w=100,h=100,fit=cover");
    const b = await transformIdentityHash("img123", "w=100,h=100,fit=cover");
    expect(a).toBe(b);
  });

  test("different source ids produce different hashes", async () => {
    const a = await transformIdentityHash("img123", "w=100");
    const b = await transformIdentityHash("img456", "w=100");
    expect(a).not.toBe(b);
  });

  test("different transform specs produce different hashes", async () => {
    const a = await transformIdentityHash("img123", "w=100");
    const b = await transformIdentityHash("img123", "w=200");
    expect(a).not.toBe(b);
  });

  test("produces a hex sha256-length string", async () => {
    const hash = await transformIdentityHash("x", "y");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
