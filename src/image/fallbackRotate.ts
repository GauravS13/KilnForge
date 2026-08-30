import type { RgbaImage } from "./bmp.ts";

/**
 * Arbitrary-angle rotation via inverse coordinate transform — required,
 * not optional: the Foundation Verification Harness confirmed
 * `Bun.Image.rotate()` throws on anything that isn't a multiple of 90
 * ("only multiples of 90 are supported"), so this is the only way this
 * project supports a non-90-multiple rotation request at all.
 *
 * Output canvas is sized to the rotated bounding box (never crops the
 * source). Nearest-neighbor sampling — simple and predictable; pixels
 * that map outside the source are transparent (alpha 0), which is the
 * standard "rotate on a transparent canvas" behavior most callers expect.
 * Positive `degrees` rotates clockwise, matching Bun.Image's own
 * rotate(90)/rotate(180)/rotate(270) convention.
 */
export function rotateArbitrary(image: RgbaImage, degrees: number): RgbaImage {
  const radians = (((degrees % 360) + 360) % 360) * (Math.PI / 180);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const { width, height, pixels } = image;

  const corners: [number, number][] = [
    [0, 0],
    [width, 0],
    [0, height],
    [width, height],
  ];
  const rotatedCorners = corners.map(([x, y]) => [x * cos - y * sin, x * sin + y * cos]);
  const xs = rotatedCorners.map((c) => c[0]!);
  const ys = rotatedCorners.map((c) => c[1]!);
  const outWidth = Math.max(1, Math.round(Math.max(...xs) - Math.min(...xs)));
  const outHeight = Math.max(1, Math.round(Math.max(...ys) - Math.min(...ys)));

  const out = new Uint8Array(outWidth * outHeight * 4);
  const srcCenterX = width / 2;
  const srcCenterY = height / 2;
  const destCenterX = outWidth / 2;
  const destCenterY = outHeight / 2;

  for (let dy = 0; dy < outHeight; dy++) {
    // Pixel index i occupies the continuous interval [i, i+1) with its
    // CENTER at i+0.5 — sampling must rotate from that center, not from
    // the raw integer index, or the whole mapping is off by half a pixel
    // (verified by hand against Bun.Image's native rotate(90), which has
    // an exact, unambiguous discrete answer to check against).
    const relY = dy + 0.5 - destCenterY;
    for (let dx = 0; dx < outWidth; dx++) {
      const relX = dx + 0.5 - destCenterX;
      // Inverse rotation (by -degrees) maps a destination pixel's center
      // back to its continuous source coordinate.
      const srcX = relX * cos + relY * sin + srcCenterX;
      const srcY = -relX * sin + relY * cos + srcCenterY;
      // floor: that continuous coordinate belongs to the cell that
      // CONTAINS it, i.e. floor(coordinate) — not the nearest cell index.
      const sx = Math.floor(srcX);
      const sy = Math.floor(srcY);

      const destIdx = (dy * outWidth + dx) * 4;
      if (sx >= 0 && sx < width && sy >= 0 && sy < height) {
        const srcIdx = (sy * width + sx) * 4;
        out[destIdx] = pixels[srcIdx]!;
        out[destIdx + 1] = pixels[srcIdx + 1]!;
        out[destIdx + 2] = pixels[srcIdx + 2]!;
        out[destIdx + 3] = pixels[srcIdx + 3]!;
      }
      // else: leave as zeroed (transparent) — already the default.
    }
  }

  return { width: outWidth, height: outHeight, pixels: out };
}
