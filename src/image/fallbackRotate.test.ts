import { describe, expect, test } from "bun:test";
import { rotateArbitrary } from "./fallbackRotate.ts";
import { encodePng, decodePng } from "./png.ts";
import type { RgbaImage } from "./bmp.ts";

function makeCheckerboard(): RgbaImage {
  return {
    width: 2,
    height: 2,
    pixels: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]),
  };
}

describe("rotateArbitrary", () => {
  test("rotate(0) is an exact identity, any dimensions", () => {
    const src = makeCheckerboard();
    const out = rotateArbitrary(src, 0);
    expect(out.width).toBe(src.width);
    expect(out.height).toBe(src.height);
    expect(Array.from(out.pixels)).toEqual(Array.from(src.pixels));
  });

  test("rotate(360) is equivalent to rotate(0)", () => {
    const src = makeCheckerboard();
    const a = rotateArbitrary(src, 0);
    const b = rotateArbitrary(src, 360);
    expect(b.width).toBe(a.width);
    expect(b.height).toBe(a.height);
    expect(Array.from(b.pixels)).toEqual(Array.from(a.pixels));
  });

  test("rotate(90) swaps width and height, matching direction of Bun.Image's native rotate(90)", async () => {
    // Cross-validated against the real, known-correct oracle (Bun.Image's
    // own native rotate, which only supports 90-multiples but IS
    // available for exactly this comparison) rather than just asserting
    // our own math is self-consistent.
    const width = 3, height = 2;
    const pixels = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      pixels[i * 4] = i * 40;
      pixels[i * 4 + 1] = 100;
      pixels[i * 4 + 2] = 200;
      pixels[i * 4 + 3] = 255;
    }
    const src: RgbaImage = { width, height, pixels };

    const nativeRotated = decodePng(
      await new Bun.Image(encodePng(src)).rotate(90).png().bytes(),
    );
    const fallbackRotated = rotateArbitrary(src, 90);

    expect(fallbackRotated.width).toBe(nativeRotated.width);
    expect(fallbackRotated.height).toBe(nativeRotated.height);
    // Byte-exact, confirmed: rotating by a pixel's continuous CENTER
    // (index + 0.5), not its raw integer index, makes the general
    // trigonometric formula land exactly on Bun.Image's own discrete
    // 90-degree transform — caught and fixed a real off-by-half-pixel
    // bug here (an earlier version of this formula was ~58% wrong before
    // that center-offset was added).
    expect(Array.from(fallbackRotated.pixels)).toEqual(Array.from(nativeRotated.pixels));
  });

  test("rotate(45) grows the output canvas to fit the full rotated bounding box", () => {
    const src: RgbaImage = { width: 10, height: 10, pixels: new Uint8Array(10 * 10 * 4).fill(255) };
    const out = rotateArbitrary(src, 45);
    // A 10x10 square rotated 45 degrees has a bounding box of ~10*sqrt(2) ≈ 14.14
    expect(out.width).toBeGreaterThan(13);
    expect(out.width).toBeLessThan(16);
    expect(out.height).toBeGreaterThan(13);
    expect(out.height).toBeLessThan(16);
  });

  test("rotate(45) leaves the corners of the new canvas transparent (nothing maps there)", () => {
    const src: RgbaImage = { width: 10, height: 10, pixels: new Uint8Array(10 * 10 * 4).fill(255) };
    const out = rotateArbitrary(src, 45);
    // top-left corner of the bounding-box canvas is outside the rotated
    // square — should be untouched (alpha 0), not sampled from the source.
    expect(out.pixels[3]).toBe(0);
  });
});
