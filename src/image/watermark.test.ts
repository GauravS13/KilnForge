import { describe, expect, test } from "bun:test";
import { compositeWatermark } from "./watermark.ts";
import type { RgbaImage } from "./bmp.ts";

function solidImage(width: number, height: number, r: number, g: number, b: number, a = 255): RgbaImage {
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4] = r;
    pixels[i * 4 + 1] = g;
    pixels[i * 4 + 2] = b;
    pixels[i * 4 + 3] = a;
  }
  return { width, height, pixels };
}

describe("compositeWatermark — placement", () => {
  const base = solidImage(10, 10, 0, 0, 0);
  const mark = solidImage(2, 2, 255, 255, 255);

  test("position=tl places at (0,0)", () => {
    const out = compositeWatermark(base, mark, { position: "tl" });
    expect(Array.from(out.pixels.slice(0, 4))).toEqual([255, 255, 255, 255]);
  });

  test("position=tr places at (width-markWidth, 0)", () => {
    const out = compositeWatermark(base, mark, { position: "tr" });
    const idx = (0 * 10 + 8) * 4;
    expect(Array.from(out.pixels.slice(idx, idx + 4))).toEqual([255, 255, 255, 255]);
  });

  test("position=bl places at (0, height-markHeight)", () => {
    const out = compositeWatermark(base, mark, { position: "bl" });
    const idx = (8 * 10 + 0) * 4;
    expect(Array.from(out.pixels.slice(idx, idx + 4))).toEqual([255, 255, 255, 255]);
  });

  test("position=br places at (width-markWidth, height-markHeight)", () => {
    const out = compositeWatermark(base, mark, { position: "br" });
    const idx = (8 * 10 + 8) * 4;
    expect(Array.from(out.pixels.slice(idx, idx + 4))).toEqual([255, 255, 255, 255]);
  });

  test("position=center places at the middle", () => {
    const out = compositeWatermark(base, mark, { position: "center" });
    const idx = (4 * 10 + 4) * 4;
    expect(Array.from(out.pixels.slice(idx, idx + 4))).toEqual([255, 255, 255, 255]);
  });

  test("explicit x/y overrides position", () => {
    const out = compositeWatermark(base, mark, { position: "tl", x: 5, y: 5 });
    const idx = (5 * 10 + 5) * 4;
    expect(Array.from(out.pixels.slice(idx, idx + 4))).toEqual([255, 255, 255, 255]);
    // top-left should NOT have been touched
    expect(Array.from(out.pixels.slice(0, 4))).toEqual([0, 0, 0, 255]);
  });
});

describe("compositeWatermark — alpha blending", () => {
  test("fully opaque watermark completely replaces the underlying pixel", () => {
    const base = solidImage(2, 2, 10, 20, 30, 255);
    const mark = solidImage(2, 2, 200, 100, 50, 255);
    const out = compositeWatermark(base, mark);
    expect(Array.from(out.pixels.slice(0, 4))).toEqual([200, 100, 50, 255]);
  });

  test("50% alpha watermark blends exactly halfway", () => {
    const base = solidImage(2, 2, 0, 0, 0, 255);
    const mark = solidImage(2, 2, 200, 200, 200, 128); // ~50%
    const out = compositeWatermark(base, mark);
    // out = src*a + dst*(1-a), a = 128/255 ≈ 0.502
    const alpha = 128 / 255;
    const expected = Math.round(200 * alpha + 0 * (1 - alpha));
    expect(out.pixels[0]).toBe(expected);
  });

  test("opacity option scales down an otherwise-opaque watermark", () => {
    const base = solidImage(2, 2, 0, 0, 0, 255);
    const mark = solidImage(2, 2, 200, 200, 200, 255);
    const out = compositeWatermark(base, mark, { opacity: 0.5 });
    expect(out.pixels[0]).toBe(100); // 200 * 0.5 + 0 * 0.5
  });

  test("zero-alpha watermark pixels leave the base pixel completely untouched", () => {
    const base = solidImage(2, 2, 10, 20, 30, 255);
    const mark = solidImage(2, 2, 200, 100, 50, 0);
    const out = compositeWatermark(base, mark);
    expect(Array.from(out.pixels.slice(0, 4))).toEqual([10, 20, 30, 255]);
  });
});

describe("compositeWatermark — clipping", () => {
  test("a watermark larger than the base is clipped, not an error", () => {
    const base = solidImage(4, 4, 0, 0, 0);
    const mark = solidImage(10, 10, 255, 255, 255);
    expect(() => compositeWatermark(base, mark)).not.toThrow();
    const out = compositeWatermark(base, mark);
    expect(out.width).toBe(4);
    expect(out.height).toBe(4);
  });

  test("a watermark placed partially off-edge via explicit offset is clipped, not an error", () => {
    const base = solidImage(4, 4, 0, 0, 0);
    const mark = solidImage(4, 4, 255, 255, 255);
    expect(() => compositeWatermark(base, mark, { x: 2, y: 2 })).not.toThrow();
    const out = compositeWatermark(base, mark, { x: 2, y: 2 });
    // top-left of base untouched (mark starts at 2,2)
    expect(Array.from(out.pixels.slice(0, 4))).toEqual([0, 0, 0, 255]);
    // (2,2) should be watermarked
    const idx = (2 * 4 + 2) * 4;
    expect(Array.from(out.pixels.slice(idx, idx + 4))).toEqual([255, 255, 255, 255]);
  });
});
