import type { RgbaImage } from "./bmp.ts";

export type Position = "tl" | "tr" | "bl" | "br" | "center";

export interface WatermarkOptions {
  /** Default "br". Ignored if x and y are both given explicitly. */
  position?: Position;
  x?: number;
  y?: number;
  /** 0-1, default 1. Multiplies the watermark's own per-pixel alpha —
   * for a fully-opaque watermark source, this is the only opacity
   * control; for one with its own alpha channel, the two compose. */
  opacity?: number;
}

function computePlacement(
  base: RgbaImage,
  mark: RgbaImage,
  opts: WatermarkOptions,
): { x: number; y: number } {
  if (opts.x !== undefined && opts.y !== undefined) return { x: opts.x, y: opts.y };
  switch (opts.position ?? "br") {
    case "tl":
      return { x: 0, y: 0 };
    case "tr":
      return { x: base.width - mark.width, y: 0 };
    case "bl":
      return { x: 0, y: base.height - mark.height };
    case "br":
      return { x: base.width - mark.width, y: base.height - mark.height };
    case "center":
      return {
        x: Math.floor((base.width - mark.width) / 2),
        y: Math.floor((base.height - mark.height) / 2),
      };
  }
}

/**
 * Alpha-composites `mark` onto `base` — standard "source over destination"
 * Porter-Duff compositing, operating on the raw RGBA buffers exposed by
 * src/image/rawPixel.ts. Pixels outside `base`'s bounds are silently
 * clipped (a watermark placed or sized such that it partially hangs off
 * an edge is a normal case, not an error).
 */
export function compositeWatermark(
  base: RgbaImage,
  mark: RgbaImage,
  opts: WatermarkOptions = {},
): RgbaImage {
  const { x: offsetX, y: offsetY } = computePlacement(base, mark, opts);
  const opacity = opts.opacity ?? 1;
  const out = new Uint8Array(base.pixels);

  for (let my = 0; my < mark.height; my++) {
    const by = offsetY + my;
    if (by < 0 || by >= base.height) continue;
    for (let mx = 0; mx < mark.width; mx++) {
      const bx = offsetX + mx;
      if (bx < 0 || bx >= base.width) continue;

      const markIdx = (my * mark.width + mx) * 4;
      const baseIdx = (by * base.width + bx) * 4;
      const markAlpha = (mark.pixels[markIdx + 3]! / 255) * opacity;
      if (markAlpha <= 0) continue;

      for (let c = 0; c < 3; c++) {
        const src = mark.pixels[markIdx + c]!;
        const dst = out[baseIdx + c]!;
        out[baseIdx + c] = Math.round(src * markAlpha + dst * (1 - markAlpha));
      }
      const dstAlpha = out[baseIdx + 3]! / 255;
      const outAlpha = markAlpha + dstAlpha * (1 - markAlpha);
      out[baseIdx + 3] = Math.round(outAlpha * 255);
    }
  }

  return { width: base.width, height: base.height, pixels: out };
}
