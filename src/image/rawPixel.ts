import { decodePng, encodePng } from "./png.ts";
import type { RgbaImage } from "./bmp.ts";

/**
 * The one raw-pixel channel, not a choice between two. The Foundation
 * Verification Harness found Bun.Image has no BMP/GIF *encode* method
 * (decode-only for those formats), so PNG is the only viable Bun.Image
 * encode target for reading raw pixels back out — and it round-trips
 * alpha exactly (0 mismatches, confirmed), unlike BMP input decode, which
 * discards alpha entirely. See src/verify/capabilities.ts for the probes
 * that established this.
 *
 * toRGBA reads pixels FROM a Bun.Image instance (whatever it currently
 * holds — decoded, resized, rotated, whatever chain led here).
 * fromRGBA writes pixels BACK INTO a form Bun.Image can decode, for
 * further processing or final format conversion.
 */

export async function toRGBA(image: Bun.Image): Promise<RgbaImage> {
  const bytes = await image.png().bytes();
  return decodePng(bytes);
}

export function fromRGBA(pixels: RgbaImage): Uint8Array {
  return encodePng(pixels);
}
