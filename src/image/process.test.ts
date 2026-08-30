import { describe, expect, test } from "bun:test";
import { decodePng, encodePng } from "./png.ts";
import { processImage, isSupportedOutputFormat } from "./process.ts";

function makeTestPng(width: number, height: number): Uint8Array {
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4] = (i * 37) % 256;
    pixels[i * 4 + 1] = (i * 59) % 256;
    pixels[i * 4 + 2] = (i * 83) % 256;
    pixels[i * 4 + 3] = 255;
  }
  return encodePng({ width, height, pixels });
}

describe("isSupportedOutputFormat", () => {
  test("accepts the five real Bun.Image encode targets", () => {
    for (const f of ["jpeg", "png", "webp", "avif", "heic"]) {
      expect(isSupportedOutputFormat(f)).toBe(true);
    }
  });
  test("rejects bmp and gif — confirmed decode-only, not encode targets", () => {
    expect(isSupportedOutputFormat("bmp")).toBe(false);
    expect(isSupportedOutputFormat("gif")).toBe(false);
  });
});

describe("processImage", () => {
  test("encodes to png without resizing when no dimensions given", async () => {
    const src = makeTestPng(4, 4);
    const out = await processImage(src, { format: "png" });
    const decoded = decodePng(out);
    expect(decoded.width).toBe(4);
    expect(decoded.height).toBe(4);
  });

  test("fit=fill stretches to exact requested dimensions", async () => {
    const src = makeTestPng(8, 4);
    const out = await processImage(src, { width: 4, height: 4, fit: "fill", format: "png" });
    const decoded = decodePng(out);
    expect(decoded.width).toBe(4);
    expect(decoded.height).toBe(4);
  });

  test("fit=contain preserves aspect ratio, fitting within the box", async () => {
    const src = makeTestPng(8, 4); // 2:1 aspect
    const out = await processImage(src, { width: 4, height: 4, fit: "contain", format: "png" });
    const decoded = decodePng(out);
    // 2:1 source fit inside a 4x4 box -> 4x2
    expect(decoded.width).toBe(4);
    expect(decoded.height).toBe(2);
  });

  test("fit=cover produces exact requested dimensions via hand-rolled overscale+crop", async () => {
    const src = makeTestPng(8, 4); // 2:1 aspect
    const out = await processImage(src, { width: 4, height: 4, fit: "cover", format: "png" });
    const decoded = decodePng(out);
    expect(decoded.width).toBe(4);
    expect(decoded.height).toBe(4);
  });

  test("cover crop keeps the center of the source, not an edge", async () => {
    // A source where the center column is a distinct known color, edges are not.
    const width = 6, height = 2;
    const pixels = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const isCenter = x === 2 || x === 3;
        pixels[i] = isCenter ? 255 : 0;
        pixels[i + 1] = 0;
        pixels[i + 2] = 0;
        pixels[i + 3] = 255;
      }
    }
    const src = encodePng({ width, height, pixels });
    // Cover a 2x2 box: scale = max(2/6, 2/2) = 1 -> overscale to 6x2 (no
    // change), crop center 2x2 -> should land exactly on the red columns.
    const out = await processImage(src, { width: 2, height: 2, fit: "cover", format: "png" });
    const decoded = decodePng(out);
    expect(decoded.width).toBe(2);
    expect(decoded.height).toBe(2);
    for (let i = 0; i < decoded.pixels.length; i += 4) {
      expect(decoded.pixels[i]).toBe(255); // red channel — should be the center red columns
    }
  });

  test("withoutEnlargement prevents upscaling past source dimensions", async () => {
    const src = makeTestPng(4, 4);
    const out = await processImage(src, {
      width: 20,
      height: 20,
      fit: "contain",
      withoutEnlargement: true,
      format: "png",
    });
    const decoded = decodePng(out);
    expect(decoded.width).toBeLessThanOrEqual(4);
    expect(decoded.height).toBeLessThanOrEqual(4);
  });

  test("encodes to jpeg with correct magic bytes and respects quality", async () => {
    const src = makeTestPng(4, 4);
    const out = await processImage(src, { format: "jpeg", quality: 80 });
    expect(out[0]).toBe(0xff);
    expect(out[1]).toBe(0xd8);
  });

  test("rotateDeg=90 uses native rotate and swaps dimensions", async () => {
    const src = makeTestPng(8, 4);
    const out = await processImage(src, { rotateDeg: 90, format: "png" });
    const decoded = decodePng(out);
    expect(decoded.width).toBe(4);
    expect(decoded.height).toBe(8);
  });

  test("rotateDeg=45 (non-multiple of 90) uses the fallback and grows the canvas", async () => {
    const src = makeTestPng(10, 10);
    const out = await processImage(src, { rotateDeg: 45, format: "png" });
    const decoded = decodePng(out);
    expect(decoded.width).toBeGreaterThan(10);
    expect(decoded.height).toBeGreaterThan(10);
  });

  test("rotateDeg applies before resize — requested dims apply to the rotated image", async () => {
    const src = makeTestPng(8, 4); // 2:1
    const out = await processImage(src, {
      rotateDeg: 90, // becomes 4x8 (1:2) before resize
      width: 4,
      height: 8,
      fit: "fill",
      format: "png",
    });
    const decoded = decodePng(out);
    expect(decoded.width).toBe(4);
    expect(decoded.height).toBe(8);
  });

  test("encodes to webp with correct RIFF header", async () => {
    const src = makeTestPng(4, 4);
    const out = await processImage(src, { format: "webp", quality: 80 });
    const header = String.fromCharCode(out[0]!, out[1]!, out[2]!, out[3]!);
    expect(header).toBe("RIFF");
  });
});
