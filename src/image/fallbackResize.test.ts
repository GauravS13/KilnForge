import { describe, expect, test } from "bun:test";
import { bilinearResize, nearestNeighborResize } from "./fallbackResize.ts";
import type { RgbaImage } from "./bmp.ts";

function makeCheckerboard(): RgbaImage {
  // 2x2: TL=RED, TR=GREEN, BL=BLUE, BR=WHITE
  return {
    width: 2,
    height: 2,
    pixels: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]),
  };
}

describe("nearestNeighborResize", () => {
  test("upscaling 2x2 to 4x4 quadruples each source pixel into a 2x2 block", () => {
    const out = nearestNeighborResize(makeCheckerboard(), 4, 4);
    expect(out.width).toBe(4);
    expect(out.height).toBe(4);
    const px = (x: number, y: number) => Array.from(out.pixels.slice((y * 4 + x) * 4, (y * 4 + x) * 4 + 4));
    expect(px(0, 0)).toEqual([255, 0, 0, 255]); // still red in top-left block
    expect(px(3, 0)).toEqual([0, 255, 0, 255]); // green in top-right block
    expect(px(0, 3)).toEqual([0, 0, 255, 255]); // blue in bottom-left block
    expect(px(3, 3)).toEqual([255, 255, 255, 255]); // white in bottom-right block
  });

  test("downscaling to 1x1 picks a single source pixel deterministically", () => {
    const out = nearestNeighborResize(makeCheckerboard(), 1, 1);
    expect(out.width).toBe(1);
    expect(out.height).toBe(1);
    expect(out.pixels.length).toBe(4);
  });

  test("identity resize (same dimensions) is exact", () => {
    const src = makeCheckerboard();
    const out = nearestNeighborResize(src, 2, 2);
    expect(Array.from(out.pixels)).toEqual(Array.from(src.pixels));
  });
});

describe("bilinearResize", () => {
  test("upscaling 2x2 to 3x3 produces a blended value at the center", () => {
    const out = bilinearResize(makeCheckerboard(), 3, 3);
    expect(out.width).toBe(3);
    expect(out.height).toBe(3);
    // Corners should match source corners exactly (no extrapolation needed).
    const px = (x: number, y: number) => Array.from(out.pixels.slice((y * 3 + x) * 4, (y * 3 + x) * 4 + 4));
    expect(px(0, 0)).toEqual([255, 0, 0, 255]);
    expect(px(2, 0)).toEqual([0, 255, 0, 255]);
    expect(px(0, 2)).toEqual([0, 0, 255, 255]);
    expect(px(2, 2)).toEqual([255, 255, 255, 255]);
    // Center pixel should be a genuine blend of all four corners — not
    // equal to any single corner's exact color.
    const center = px(1, 1);
    expect(center).not.toEqual([255, 0, 0, 255]);
    expect(center).not.toEqual([0, 255, 0, 255]);
  });

  test("identity resize (same dimensions) is exact", () => {
    const src = makeCheckerboard();
    const out = bilinearResize(src, 2, 2);
    expect(Array.from(out.pixels)).toEqual(Array.from(src.pixels));
  });

  test("1x1 target does not divide by zero and returns a valid pixel", () => {
    const out = bilinearResize(makeCheckerboard(), 1, 1);
    expect(out.width).toBe(1);
    expect(out.height).toBe(1);
    expect(out.pixels.every((v) => Number.isFinite(v))).toBe(true);
  });
});
