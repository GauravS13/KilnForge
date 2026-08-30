import type { RgbaImage } from "./bmp.ts";

/** Fast, low-quality resize: each output pixel copies its nearest source
 * pixel. Used as the insurance path if the harness ever finds native
 * resize misbehaving on some input class — operates directly on the raw
 * RGBA buffer already exposed for the watermark compositor (src/image/
 * rawPixel.ts), no new plumbing. */
export function nearestNeighborResize(
  image: RgbaImage,
  targetWidth: number,
  targetHeight: number,
): RgbaImage {
  const { width, height, pixels } = image;
  const out = new Uint8Array(targetWidth * targetHeight * 4);
  const xRatio = width / targetWidth;
  const yRatio = height / targetHeight;

  for (let y = 0; y < targetHeight; y++) {
    const srcY = Math.min(height - 1, Math.floor(y * yRatio));
    for (let x = 0; x < targetWidth; x++) {
      const srcX = Math.min(width - 1, Math.floor(x * xRatio));
      const srcIdx = (srcY * width + srcX) * 4;
      const destIdx = (y * targetWidth + x) * 4;
      out[destIdx] = pixels[srcIdx]!;
      out[destIdx + 1] = pixels[srcIdx + 1]!;
      out[destIdx + 2] = pixels[srcIdx + 2]!;
      out[destIdx + 3] = pixels[srcIdx + 3]!;
    }
  }

  return { width: targetWidth, height: targetHeight, pixels: out };
}

/** Higher-quality resize: each output pixel is a weighted blend of its
 * four nearest source pixels. Same insurance role as the nearest-neighbor
 * version above, offered as the better-quality option when it's worth the
 * extra arithmetic. */
export function bilinearResize(
  image: RgbaImage,
  targetWidth: number,
  targetHeight: number,
): RgbaImage {
  const { width, height, pixels } = image;
  const out = new Uint8Array(targetWidth * targetHeight * 4);

  const xRatio = targetWidth > 1 ? (width - 1) / (targetWidth - 1) : 0;
  const yRatio = targetHeight > 1 ? (height - 1) / (targetHeight - 1) : 0;

  for (let y = 0; y < targetHeight; y++) {
    const srcYf = y * yRatio;
    const y0 = Math.floor(srcYf);
    const y1 = Math.min(height - 1, y0 + 1);
    const yFrac = srcYf - y0;

    for (let x = 0; x < targetWidth; x++) {
      const srcXf = x * xRatio;
      const x0 = Math.floor(srcXf);
      const x1 = Math.min(width - 1, x0 + 1);
      const xFrac = srcXf - x0;

      const destIdx = (y * targetWidth + x) * 4;
      for (let c = 0; c < 4; c++) {
        const p00 = pixels[(y0 * width + x0) * 4 + c]!;
        const p10 = pixels[(y0 * width + x1) * 4 + c]!;
        const p01 = pixels[(y1 * width + x0) * 4 + c]!;
        const p11 = pixels[(y1 * width + x1) * 4 + c]!;
        const top = p00 + (p10 - p00) * xFrac;
        const bottom = p01 + (p11 - p01) * xFrac;
        out[destIdx + c] = Math.round(top + (bottom - top) * yFrac);
      }
    }
  }

  return { width: targetWidth, height: targetHeight, pixels: out };
}
