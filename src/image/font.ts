import type { RgbaImage } from "./bmp.ts";

/**
 * A small, hand-authored 5x7 bitmap font — uppercase A-Z, digits 0-9, and
 * space. Each glyph is 7 rows, each row a 5-bit value (bit 4 = leftmost
 * column, bit 0 = rightmost). Deliberately scoped to the character set
 * that covers the overwhelming majority of real watermark text (brand
 * names, "COPYRIGHT 2026", "SAMPLE", dates) rather than a full ASCII set —
 * an honest scope decision, not an oversight; unsupported characters
 * (lowercase, punctuation) render as a blank cell rather than throwing,
 * and text is uppercased on input so lowercase letters still render using
 * their uppercase glyph.
 */
const FONT_5X7: Record<string, number[]> = {
  " ": [0, 0, 0, 0, 0, 0, 0],
  "0": [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
  "1": [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  "2": [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111],
  "3": [0b11111, 0b00010, 0b00100, 0b00010, 0b00001, 0b10001, 0b01110],
  "4": [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  "5": [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
  "6": [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
  "7": [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  "8": [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  "9": [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100],
  A: [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  B: [0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110],
  C: [0b01111, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b01111],
  D: [0b11100, 0b10010, 0b10001, 0b10001, 0b10001, 0b10010, 0b11100],
  E: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
  F: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000],
  G: [0b01111, 0b10000, 0b10000, 0b10111, 0b10001, 0b10001, 0b01111],
  H: [0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  I: [0b01110, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  J: [0b00111, 0b00010, 0b00010, 0b00010, 0b00010, 0b10010, 0b01100],
  K: [0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001],
  L: [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111],
  M: [0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001],
  N: [0b10001, 0b11001, 0b10101, 0b10101, 0b10011, 0b10001, 0b10001],
  O: [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  P: [0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000],
  Q: [0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101],
  R: [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001],
  S: [0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110],
  T: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
  U: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  V: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100],
  W: [0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b10101, 0b01010],
  X: [0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001],
  Y: [0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100],
  Z: [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111],
};

const GLYPH_WIDTH = 5;
const GLYPH_HEIGHT = 7;
const GLYPH_SPACING = 1;

export interface RasterizeTextOptions {
  color?: [number, number, number];
  /** Integer pixel scale factor, default 1. */
  scale?: number;
}

/**
 * Renders `text` into a transparent RgbaImage with the glyphs drawn at
 * full alpha in the requested color — composited via the same
 * compositeWatermark() used for image-mode watermarks, so text-mode is
 * "render text to an image, then do exactly what image mode already does",
 * not a separate code path.
 */
export function rasterizeText(text: string, opts: RasterizeTextOptions = {}): RgbaImage {
  const [r, g, b] = opts.color ?? [255, 255, 255];
  const scale = Math.max(1, Math.floor(opts.scale ?? 1));
  const chars = text.toUpperCase().split("");
  if (chars.length === 0) {
    return { width: 1, height: 1, pixels: new Uint8Array(4) };
  }

  const cellWidth = (GLYPH_WIDTH + GLYPH_SPACING) * scale;
  const width = chars.length * cellWidth - GLYPH_SPACING * scale;
  const height = GLYPH_HEIGHT * scale;
  const pixels = new Uint8Array(width * height * 4); // fully transparent by default

  for (let ci = 0; ci < chars.length; ci++) {
    const glyph = FONT_5X7[chars[ci]!] ?? FONT_5X7[" "]!;
    const baseX = ci * cellWidth;
    for (let row = 0; row < GLYPH_HEIGHT; row++) {
      const bits = glyph[row]!;
      for (let col = 0; col < GLYPH_WIDTH; col++) {
        const lit = (bits >> (GLYPH_WIDTH - 1 - col)) & 1;
        if (!lit) continue;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const px = baseX + col * scale + sx;
            const py = row * scale + sy;
            const idx = (py * width + px) * 4;
            pixels[idx] = r!;
            pixels[idx + 1] = g!;
            pixels[idx + 2] = b!;
            pixels[idx + 3] = 255;
          }
        }
      }
    }
  }

  return { width, height, pixels };
}
