import { encodeBmp, type RgbaImage } from "../image/bmp.ts";

/**
 * A small, deliberately varied set of known pixel values — enough to catch
 * row-order, channel-order (R/B swap), and off-by-one errors, not just
 * "is the image black." 4x4 keeps every probe in this harness fast.
 */
export function buildKnownPixelFixture(): RgbaImage {
  const width = 4;
  const height = 4;
  const colors: [number, number, number, number][] = [
    [255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [255, 255, 0, 128],
    [0, 255, 255, 255], [255, 0, 255, 255], [128, 128, 128, 255], [0, 0, 0, 255],
    [255, 255, 255, 255], [64, 32, 16, 200], [200, 100, 50, 255], [10, 20, 30, 40],
    [1, 2, 3, 4], [250, 249, 248, 255], [5, 5, 5, 5], [255, 128, 0, 255],
  ];
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < colors.length; i++) {
    const [r, g, b, a] = colors[i]!;
    pixels[i * 4] = r;
    pixels[i * 4 + 1] = g;
    pixels[i * 4 + 2] = b;
    pixels[i * 4 + 3] = a;
  }
  return { width, height, pixels };
}

/**
 * Encodes the known-pixel fixture as BMP bytes — a valid, hand-rolled,
 * uncompressed BMP that any spec-correct decoder (including Bun.Image's)
 * should read identically. This is the starting input every probe below
 * feeds into `new Bun.Image(bytes)` / `Bun.image(bytes)` / etc.
 */
export function buildKnownPixelBmp(): Uint8Array {
  return encodeBmp(buildKnownPixelFixture());
}

export function pixelsApproximatelyEqual(
  a: Uint8Array,
  b: Uint8Array,
  tolerance = 0,
): { equal: boolean; maxDelta: number; firstMismatchIndex: number } {
  if (a.length !== b.length) {
    return { equal: false, maxDelta: -1, firstMismatchIndex: -1 };
  }
  let maxDelta = 0;
  let firstMismatchIndex = -1;
  for (let i = 0; i < a.length; i++) {
    const delta = Math.abs(a[i]! - b[i]!);
    if (delta > maxDelta) maxDelta = delta;
    if (delta > tolerance && firstMismatchIndex === -1) firstMismatchIndex = i;
  }
  return { equal: firstMismatchIndex === -1, maxDelta, firstMismatchIndex };
}
