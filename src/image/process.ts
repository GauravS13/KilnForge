import { loadImage } from "./loadImage.ts";
import { toRGBA, fromRGBA } from "./rawPixel.ts";
import { rotateArbitrary } from "./fallbackRotate.ts";
import type { RgbaImage } from "./bmp.ts";

export type Fit = "cover" | "contain" | "fill";
export type OutputFormat = "jpeg" | "png" | "webp" | "avif" | "heic";

const OUTPUT_FORMATS: readonly OutputFormat[] = ["jpeg", "png", "webp", "avif", "heic"];

export function isSupportedOutputFormat(value: string): value is OutputFormat {
  return (OUTPUT_FORMATS as readonly string[]).includes(value);
}

export interface ProcessOptions {
  width?: number;
  height?: number;
  /** Default "cover". Native Bun.Image only exposes "fill" (stretch) and
   * "inside" (aspect-preserving, fits within box) — there is no native
   * crop-to-fill "cover" mode, confirmed by probing resize()'s real
   * fit values. "cover" here is hand-rolled: an aspect-preserving
   * overscale via native fill-mode resize, then a center-crop on the raw
   * pixel buffer. "contain" maps to native "inside"; "fill" passes
   * straight through. */
  fit?: Fit;
  /** Degrees, clockwise. Multiples of 90 use Bun.Image's native rotate();
   * anything else uses the hand-rolled fallback (fallbackRotate.ts) —
   * confirmed necessary, not a hedge: the Foundation Verification Harness
   * found native rotate() throws on any non-90-multiple angle. Applied
   * before resize, so requested dimensions apply to the rotated image. */
  rotateDeg?: number;
  format: OutputFormat;
  quality?: number;
  withoutEnlargement?: boolean;
}

function cropCenter(image: RgbaImage, targetWidth: number, targetHeight: number): RgbaImage {
  const { width, height, pixels } = image;
  const cropX = Math.max(0, Math.floor((width - targetWidth) / 2));
  const cropY = Math.max(0, Math.floor((height - targetHeight) / 2));
  const outWidth = Math.min(targetWidth, width);
  const outHeight = Math.min(targetHeight, height);

  const out = new Uint8Array(outWidth * outHeight * 4);
  for (let y = 0; y < outHeight; y++) {
    const srcRowStart = ((cropY + y) * width + cropX) * 4;
    const destRowStart = y * outWidth * 4;
    out.set(pixels.subarray(srcRowStart, srcRowStart + outWidth * 4), destRowStart);
  }
  return { width: outWidth, height: outHeight, pixels: out };
}

async function resizeCover(
  image: Bun.Image,
  targetWidth: number,
  targetHeight: number,
): Promise<Bun.Image> {
  const meta = await image.metadata();
  const srcWidth = meta.width;
  const srcHeight = meta.height;

  const scale = Math.max(targetWidth / srcWidth, targetHeight / srcHeight);
  const overscaledWidth = Math.max(1, Math.round(srcWidth * scale));
  const overscaledHeight = Math.max(1, Math.round(srcHeight * scale));

  const resized = image.resize(overscaledWidth, overscaledHeight, { fit: "fill" });
  const rgba = await toRGBA(resized);
  const cropped = cropCenter(rgba, targetWidth, targetHeight);
  return loadImage(fromRGBA(cropped));
}

function applyFormat(image: Bun.Image, format: OutputFormat, quality?: number): Bun.Image {
  const opts = quality !== undefined ? { quality } : undefined;
  switch (format) {
    case "jpeg":
      return image.jpeg(opts);
    case "png":
      return image.png();
    case "webp":
      return image.webp(opts);
    case "avif":
      return image.avif(opts);
    case "heic":
      return image.heic(opts);
  }
}

/**
 * Core resize/rotate/encode chain. Does not handle EXIF auto-orientation
 * or arbitrary-angle rotation — those are separate, composed pre/post steps
 * (src/image/exif.ts, src/image/fallbackRotate.ts) since they apply at
 * different points in the pipeline and have their own fixture-driven tests.
 */
export async function processImage(
  inputBytes: Uint8Array,
  opts: ProcessOptions,
): Promise<Uint8Array> {
  let image = loadImage(inputBytes);

  if (opts.rotateDeg !== undefined && opts.rotateDeg !== 0) {
    const normalized = ((opts.rotateDeg % 360) + 360) % 360;
    if (normalized % 90 === 0) {
      if (normalized !== 0) image = image.rotate(normalized as 90 | 180 | 270);
    } else {
      const rgba = await toRGBA(image);
      const rotated = rotateArbitrary(rgba, normalized);
      image = loadImage(fromRGBA(rotated));
    }
  }

  if (opts.width || opts.height) {
    const fit = opts.fit ?? "cover";

    if (fit === "cover" && opts.width && opts.height) {
      // Hand-rolled: only meaningful, and only attempted, when both
      // dimensions are given — with just one, any fit value degenerates
      // to the same proportional scale, which native resize already
      // does correctly on its own.
      image = await resizeCover(image, opts.width, opts.height);
    } else {
      const nativeFit = fit === "contain" ? "inside" : "fill";
      image = image.resize(opts.width, opts.height, {
        fit: nativeFit as "inside" | "fill",
        withoutEnlargement: opts.withoutEnlargement,
      });
    }
  }

  const encoded = applyFormat(image, opts.format, opts.quality);
  return await encoded.bytes();
}
