import { describe, expect, test } from "bun:test";
import { deflateSync } from "node:zlib";
import { decodePng, encodePng } from "./png.ts";
import { crc32 } from "./crc32.ts";

const SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const out = new Uint8Array(4 + 4 + data.length + 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  out.set(typeBytes, 4);
  out.set(data, 8);
  const crc = crc32(out.subarray(4, 8 + data.length));
  view.setUint32(8 + data.length, crc, false);
  return out;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

interface TestPngOptions {
  colorType?: 2 | 6; // 2 = RGB, 6 = RGBA
  interlace?: 0 | 1;
  splitIdatEvery?: number; // split the compressed stream into chunks of this many bytes
  rowFilters?: number[]; // per-row filter type override, default all 0 (None)
  corruptCrc?: boolean;
}

/** Test-only PNG encoder — deliberately lives here, not in src/image/png.ts,
 * since this project's own PNG channel is decode-only by design (Bun.Image
 * does the real encoding; see png.ts's module comment). */
function buildTestPng(
  width: number,
  height: number,
  pixels: Uint8Array, // RGBA, width*height*4
  opts: TestPngOptions = {},
): Uint8Array {
  const colorType = opts.colorType ?? 6;
  const bpp = colorType === 6 ? 4 : 3;
  const rowBytes = width * bpp;

  const raw = new Uint8Array((rowBytes + 1) * height);
  let prevRawRow = new Uint8Array(rowBytes);

  for (let y = 0; y < height; y++) {
    const filterType = opts.rowFilters?.[y] ?? 0;
    raw[y * (rowBytes + 1)] = filterType;
    const filteredRow = raw.subarray(y * (rowBytes + 1) + 1, y * (rowBytes + 1) + 1 + rowBytes);

    // Build the RAW (unfiltered) row first — filtering must reference raw
    // reconstructed bytes for left/up neighbors, never already-filtered
    // output bytes, or the math is simply wrong (this was the original
    // bug here: reading back from the filtered buffer mid-row).
    const rawRow = new Uint8Array(rowBytes);
    for (let x = 0; x < width; x++) {
      const srcI = (y * width + x) * 4;
      const destI = x * bpp;
      rawRow[destI] = pixels[srcI]!;
      rawRow[destI + 1] = pixels[srcI + 1]!;
      rawRow[destI + 2] = pixels[srcI + 2]!;
      if (bpp === 4) rawRow[destI + 3] = pixels[srcI + 3]!;
    }

    for (let i = 0; i < rowBytes; i++) {
      const a = i >= bpp ? rawRow[i - bpp]! : 0;
      const b = prevRawRow[i]!;
      let v = rawRow[i]!;
      if (filterType === 1) v = (v - a) & 0xff; // Sub
      else if (filterType === 2) v = (v - b) & 0xff; // Up
      filteredRow[i] = v;
    }

    prevRawRow = rawRow;
  }

  const compressed = new Uint8Array(deflateSync(raw));

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdr[8] = 8; // bit depth
  ihdr[9] = colorType;
  ihdr[10] = 0; // compression method
  ihdr[11] = 0; // filter method
  ihdr[12] = opts.interlace ?? 0;

  const parts: Uint8Array[] = [SIGNATURE, chunk("IHDR", ihdr)];

  const splitEvery = opts.splitIdatEvery ?? compressed.length;
  for (let i = 0; i < compressed.length; i += splitEvery) {
    let idatChunk = chunk("IDAT", compressed.subarray(i, Math.min(i + splitEvery, compressed.length)));
    if (opts.corruptCrc && i === 0) {
      idatChunk = idatChunk.slice();
      idatChunk[idatChunk.length - 1] ^= 0xff;
    }
    parts.push(idatChunk);
  }

  parts.push(chunk("IEND", new Uint8Array(0)));
  return concatBytes(parts);
}

function makePixels(width: number, height: number): Uint8Array {
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4] = (i * 23) % 256;
    pixels[i * 4 + 1] = (i * 41) % 256;
    pixels[i * 4 + 2] = (i * 67) % 256;
    pixels[i * 4 + 3] = i % 3 === 0 ? 255 : 200;
  }
  return pixels;
}

describe("decodePng", () => {
  test("decodes a basic RGBA image with filter type None", () => {
    const pixels = makePixels(4, 4);
    const png = buildTestPng(4, 4, pixels, { colorType: 6 });
    const decoded = decodePng(png);
    expect(decoded.width).toBe(4);
    expect(decoded.height).toBe(4);
    expect(Array.from(decoded.pixels)).toEqual(Array.from(pixels));
  });

  test("decodes RGB (no alpha, color type 2) as fully opaque", () => {
    const pixels = makePixels(3, 3);
    const png = buildTestPng(3, 3, pixels, { colorType: 2 });
    const decoded = decodePng(png);
    for (let i = 0; i < decoded.pixels.length; i += 4) {
      expect(decoded.pixels[i]).toBe(pixels[i]);
      expect(decoded.pixels[i + 1]).toBe(pixels[i + 1]);
      expect(decoded.pixels[i + 2]).toBe(pixels[i + 2]);
      expect(decoded.pixels[i + 3]).toBe(255); // alpha forced opaque, source had 200/255
    }
  });

  test("concatenates multiple IDAT chunks before inflating", () => {
    const pixels = makePixels(8, 8);
    const png = buildTestPng(8, 8, pixels, { colorType: 6, splitIdatEvery: 17 });
    const decoded = decodePng(png);
    expect(Array.from(decoded.pixels)).toEqual(Array.from(pixels));
  });

  test("decodes correctly when rows use Sub and Up filters, not just None", () => {
    const pixels = makePixels(5, 5);
    const png = buildTestPng(5, 5, pixels, { colorType: 6, rowFilters: [0, 1, 2, 1, 2] });
    const decoded = decodePng(png);
    expect(Array.from(decoded.pixels)).toEqual(Array.from(pixels));
  });

  test("throws a named error on interlaced PNGs instead of silently misunfiltering", () => {
    const png = buildTestPng(2, 2, makePixels(2, 2), { interlace: 1 });
    expect(() => decodePng(png)).toThrow(/interlace/i);
  });

  test("throws a named error on unsupported color type / bit depth", () => {
    const pixels = makePixels(2, 2);
    const png = buildTestPng(2, 2, pixels, { colorType: 6 });
    const ihdrStart = SIGNATURE.length + 8; // skip signature + IHDR length/type
    const corrupted = png.slice();
    corrupted[ihdrStart + 9] = 3; // color type 3 = palette, unsupported
    // Recompute IHDR CRC so the failure is attributed to color type, not CRC.
    const ihdrData = corrupted.subarray(ihdrStart, ihdrStart + 13);
    const view = new DataView(corrupted.buffer);
    const newCrc = crc32(corrupted.subarray(ihdrStart - 4, ihdrStart + 13));
    view.setUint32(ihdrStart + 13, newCrc, false);
    expect(() => decodePng(corrupted)).toThrow(/color type|bit depth/i);
  });

  test("throws on CRC mismatch rather than trusting corrupted data", () => {
    const png = buildTestPng(2, 2, makePixels(2, 2), { corruptCrc: true });
    expect(() => decodePng(png)).toThrow(/CRC/i);
  });

  test("throws on missing PNG signature", () => {
    const png = buildTestPng(2, 2, makePixels(2, 2));
    const corrupted = png.slice();
    corrupted[0] = 0x00;
    expect(() => decodePng(corrupted)).toThrow(/signature/i);
  });

  test("throws on truncated chunk data", () => {
    const png = buildTestPng(3, 3, makePixels(3, 3));
    const truncated = png.slice(0, png.length - 20);
    expect(() => decodePng(truncated)).toThrow(/truncated/i);
  });
});

describe("encodePng", () => {
  test("encode → decode is the identity for RGBA pixels, including partial alpha", () => {
    const width = 6, height = 5;
    const pixels = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      pixels[i * 4] = (i * 13) % 256;
      pixels[i * 4 + 1] = (i * 29) % 256;
      pixels[i * 4 + 2] = (i * 71) % 256;
      pixels[i * 4 + 3] = (i * 37) % 256; // deliberately varied, including non-255 values
    }
    const encoded = encodePng({ width, height, pixels });
    const decoded = decodePng(encoded);
    expect(decoded.width).toBe(width);
    expect(decoded.height).toBe(height);
    expect(Array.from(decoded.pixels)).toEqual(Array.from(pixels));
  });

  test("throws on a pixel buffer that doesn't match width*height*4", () => {
    expect(() => encodePng({ width: 2, height: 2, pixels: new Uint8Array(10) })).toThrow(
      /pixel buffer length/i,
    );
  });
});
