import { describe, expect, test } from "bun:test";
import { decodeBmp, encodeBmp, type RgbaImage } from "./bmp.ts";

function makeKnownImage(width: number, height: number): RgbaImage {
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4] = (i * 17) % 256;
    pixels[i * 4 + 1] = (i * 31) % 256;
    pixels[i * 4 + 2] = (i * 53) % 256;
    pixels[i * 4 + 3] = (i % 2 === 0 ? 255 : 128);
  }
  return { width, height, pixels };
}

describe("bmp encode/decode round-trip", () => {
  test("recovers exact pixel values for a small non-square image", () => {
    const original = makeKnownImage(5, 3);
    const bytes = encodeBmp(original);
    const decoded = decodeBmp(bytes);
    expect(decoded.width).toBe(original.width);
    expect(decoded.height).toBe(original.height);
    expect(Array.from(decoded.pixels)).toEqual(Array.from(original.pixels));
  });

  test("recovers exact pixel values for a 1x1 image", () => {
    const original = makeKnownImage(1, 1);
    const decoded = decodeBmp(encodeBmp(original));
    expect(Array.from(decoded.pixels)).toEqual(Array.from(original.pixels));
  });

  test("row padding: width not a multiple of 4 pixels still round-trips", () => {
    // 32bpp rows are always 4-byte aligned already, but exercise a width
    // that would NOT be aligned at 24bpp, to make sure nothing assumes
    // padding is always zero.
    const original = makeKnownImage(7, 4);
    const decoded = decodeBmp(encodeBmp(original));
    expect(Array.from(decoded.pixels)).toEqual(Array.from(original.pixels));
  });

  test("bottom-up (positive biHeight) BMPs decode to the same top-down pixel order as top-down ones", () => {
    const original = makeKnownImage(3, 3);
    const topDown = encodeBmp(original);

    // Flip the sign of biHeight and physically reverse the row order in
    // the pixel data, to synthesize a valid bottom-up BMP encoding the
    // exact same image — proves the signed-height read path, not just
    // the write path this module happens to produce.
    const view = new DataView(topDown.buffer);
    const height = original.height;
    view.setInt32(22, height, true); // now positive: bottom-up
    const pixelDataOffset = view.getUint32(10, true);
    const rowSize = original.width * 4;
    const rows: Uint8Array[] = [];
    for (let y = 0; y < height; y++) {
      rows.push(topDown.slice(pixelDataOffset + y * rowSize, pixelDataOffset + (y + 1) * rowSize));
    }
    const bottomUp = new Uint8Array(topDown);
    for (let y = 0; y < height; y++) {
      bottomUp.set(rows[height - 1 - y]!, pixelDataOffset + y * rowSize);
    }

    const decoded = decodeBmp(bottomUp);
    expect(Array.from(decoded.pixels)).toEqual(Array.from(original.pixels));
  });

  test("throws a named error on RLE compression instead of misreading bytes", () => {
    const bytes = encodeBmp(makeKnownImage(2, 2));
    const view = new DataView(bytes.buffer);
    view.setUint32(30, 1, true); // BI_RLE8
    expect(() => decodeBmp(bytes)).toThrow(/compression/i);
  });

  test("throws on unsupported bit depth rather than misreading", () => {
    const bytes = encodeBmp(makeKnownImage(2, 2));
    const view = new DataView(bytes.buffer);
    view.setUint16(28, 16, true);
    expect(() => decodeBmp(bytes)).toThrow(/bit depth/i);
  });

  test("throws on truncated pixel data rather than reading past the buffer", () => {
    const bytes = encodeBmp(makeKnownImage(4, 4));
    const truncated = bytes.slice(0, bytes.length - 10);
    expect(() => decodeBmp(truncated)).toThrow(/truncated/i);
  });

  test("throws on missing 'BM' magic", () => {
    const bytes = encodeBmp(makeKnownImage(2, 2));
    bytes[0] = 0x00;
    expect(() => decodeBmp(bytes)).toThrow(/magic/i);
  });
});
