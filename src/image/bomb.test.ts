import { describe, expect, test } from "bun:test";
import {
  readDeclaredDimensions,
  assertNotDecompressionBomb,
  DecompressionBombError,
} from "./bomb.ts";

async function fixture(name: string): Promise<Uint8Array> {
  return new Uint8Array(await Bun.file(`fixtures/images/${name}`).arrayBuffer());
}

describe("readDeclaredDimensions — cross-validated against the real fixture corpus", () => {
  test("PNG: reads real dimensions from a real fixture", async () => {
    const bytes = await fixture("medium-64x48.png");
    expect(readDeclaredDimensions(bytes)).toEqual({ width: 64, height: 48 });
  });

  test("JPEG: reads real dimensions from a real Bun.Image-encoded fixture", async () => {
    const bytes = await fixture("photo-48x48.jpg");
    expect(readDeclaredDimensions(bytes)).toEqual({ width: 48, height: 48 });
  });

  test("WebP (VP8): reads real dimensions from a real Bun.Image-encoded fixture", async () => {
    const bytes = await fixture("photo-48x48.webp");
    const dims = readDeclaredDimensions(bytes);
    expect(dims).not.toBeNull();
    expect(dims!.width).toBe(48);
    expect(dims!.height).toBe(48);
  });

  test("BMP: reads real dimensions from a real hand-encoded fixture", async () => {
    const bytes = await fixture("bmp-input-24x24.bmp");
    expect(readDeclaredDimensions(bytes)).toEqual({ width: 24, height: 24 });
  });

  test("non-square fixture reads width and height correctly (not swapped)", async () => {
    const bytes = await fixture("portrait-20x40.png");
    expect(readDeclaredDimensions(bytes)).toEqual({ width: 20, height: 40 });
  });

  test("GIF: reads dimensions from a minimal hand-built GIF header", () => {
    const header = new Uint8Array(13);
    header.set(new TextEncoder().encode("GIF89a"), 0);
    new DataView(header.buffer).setUint16(6, 320, true);
    new DataView(header.buffer).setUint16(8, 240, true);
    expect(readDeclaredDimensions(header)).toEqual({ width: 320, height: 240 });
  });

  test("returns null for an unrecognized format rather than guessing", () => {
    const garbage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(readDeclaredDimensions(garbage)).toBeNull();
  });
});

describe("assertNotDecompressionBomb", () => {
  test("passes for a real, reasonably-sized fixture", async () => {
    const bytes = await fixture("large-256x256.png");
    expect(() => assertNotDecompressionBomb(bytes)).not.toThrow();
  });

  test("rejects a header declaring dimensions over the cap, without decoding anything", () => {
    // A tiny, entirely fake PNG header (no valid IDAT at all — if this
    // function tried to decode it, it would throw for a different
    // reason) declaring an enormous size.
    const fakeHeader = new Uint8Array(24);
    fakeHeader.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    fakeHeader.set(new TextEncoder().encode("IHDR"), 12);
    const view = new DataView(fakeHeader.buffer);
    view.setUint32(16, 50000, false);
    view.setUint32(20, 50000, false); // 2.5 billion pixels
    expect(() => assertNotDecompressionBomb(fakeHeader)).toThrow(DecompressionBombError);
  });

  test("the error carries the declared dimensions for a useful message", () => {
    const fakeHeader = new Uint8Array(24);
    fakeHeader.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    fakeHeader.set(new TextEncoder().encode("IHDR"), 12);
    const view = new DataView(fakeHeader.buffer);
    view.setUint32(16, 20000, false);
    view.setUint32(20, 20000, false);
    try {
      assertNotDecompressionBomb(fakeHeader, 40);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(DecompressionBombError);
      expect((err as DecompressionBombError).width).toBe(20000);
      expect((err as DecompressionBombError).height).toBe(20000);
    }
  });

  test("respects a custom megapixel cap", () => {
    const header = new Uint8Array(13);
    header.set(new TextEncoder().encode("GIF89a"), 0);
    new DataView(header.buffer).setUint16(6, 2000, true);
    new DataView(header.buffer).setUint16(8, 2000, true); // 4MP
    expect(() => assertNotDecompressionBomb(header, 40)).not.toThrow(); // under 40MP cap
    expect(() => assertNotDecompressionBomb(header, 3)).toThrow(DecompressionBombError); // over 3MP cap
  });

  test("does nothing (does not throw) for an unrecognized format — that's a decode-time problem, not this guard's job", () => {
    const garbage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(() => assertNotDecompressionBomb(garbage)).not.toThrow();
  });
});
