import { deflateSync, inflateSync } from "node:zlib";
import { crc32 } from "./crc32.ts";
import type { RgbaImage } from "./bmp.ts";

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

interface Chunk {
  type: string;
  data: Uint8Array;
}

function readChunks(bytes: Uint8Array): Chunk[] {
  for (let i = 0; i < SIGNATURE.length; i++) {
    if (bytes[i] !== SIGNATURE[i]) {
      throw new Error("decodePng: missing PNG signature");
    }
  }

  const chunks: Chunk[] = [];
  let offset = SIGNATURE.length;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) {
      throw new Error("decodePng: truncated — incomplete chunk header");
    }
    const length = view.getUint32(offset, false);
    const type = String.fromCharCode(
      bytes[offset + 4]!,
      bytes[offset + 5]!,
      bytes[offset + 6]!,
      bytes[offset + 7]!,
    );
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const crcOffset = dataEnd;
    if (crcOffset + 4 > bytes.length) {
      throw new Error(`decodePng: truncated — chunk '${type}' data/CRC runs past end of file`);
    }

    const data = bytes.subarray(dataStart, dataEnd);
    const expectedCrc = view.getUint32(crcOffset, false);
    const typeAndData = bytes.subarray(offset + 4, dataEnd);
    const actualCrc = crc32(typeAndData);
    if (actualCrc !== expectedCrc) {
      throw new Error(
        `decodePng: CRC mismatch on chunk '${type}' (expected ${expectedCrc.toString(16)}, got ${actualCrc.toString(16)})`,
      );
    }

    chunks.push({ type, data });
    offset = crcOffset + 4;

    if (type === "IEND") break;
  }

  return chunks;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Un-applies PNG's per-scanline filtering (RFC 2083 §6), producing raw,
 * unfiltered pixel bytes. Generic over bytesPerPixel so it works for both
 * supported color types (RGB=3, RGBA=4) without duplicating the algorithm.
 */
function unfilter(raw: Uint8Array, width: number, height: number, bpp: number): Uint8Array {
  const rowBytes = width * bpp;
  const stride = rowBytes + 1; // +1 for the filter-type byte prefixing each row
  if (raw.length < stride * height) {
    throw new Error(
      `decodePng: decompressed IDAT stream too short — need ${stride * height} bytes, have ${raw.length}`,
    );
  }

  const out = new Uint8Array(rowBytes * height);
  let prevRow = new Uint8Array(rowBytes); // implicit zero row above the first

  for (let y = 0; y < height; y++) {
    const rowStart = y * stride;
    const filterType = raw[rowStart]!;
    const filtered = raw.subarray(rowStart + 1, rowStart + 1 + rowBytes);
    const outRow = out.subarray(y * rowBytes, (y + 1) * rowBytes);

    for (let x = 0; x < rowBytes; x++) {
      const a = x >= bpp ? outRow[x - bpp]! : 0; // left
      const b = prevRow[x]!; // up
      const c = x >= bpp ? prevRow[x - bpp]! : 0; // upper-left

      let value: number;
      switch (filterType) {
        case 0: // None
          value = filtered[x]!;
          break;
        case 1: // Sub
          value = (filtered[x]! + a) & 0xff;
          break;
        case 2: // Up
          value = (filtered[x]! + b) & 0xff;
          break;
        case 3: // Average
          value = (filtered[x]! + Math.floor((a + b) / 2)) & 0xff;
          break;
        case 4: // Paeth
          value = (filtered[x]! + paeth(a, b, c)) & 0xff;
          break;
        default:
          throw new Error(`decodePng: unknown scanline filter type ${filterType} on row ${y}`);
      }
      outRow[x] = value;
    }

    prevRow = outRow;
  }

  return out;
}

/**
 * Hand-rolled PNG decoder producing raw RGBA pixels. Deliberately strict
 * rather than general-purpose:
 *
 *  - concatenates EVERY IDAT chunk's payload (in file order) before a
 *    single inflateSync call — PNG allows the compressed stream to be
 *    split across multiple IDAT chunks, and assuming exactly one is a
 *    real, silent-corruption-shaped bug this decoder does not have.
 *  - reads IHDR's interlace-method byte and throws a named error on
 *    Adam7 (1) rather than silently unfiltering it wrong — Adam7 support
 *    is a defined extension to add only if the harness actually observes
 *    Bun.Image emitting it, never a blind assumption either way.
 *  - reads IHDR's color-type/bit-depth and only accepts the two
 *    plausible truecolor cases (RGB-8 = type 2, RGBA-8 = type 6),
 *    throwing a named error on anything else (palette, grayscale,
 *    16-bit) rather than misinterpreting bytes.
 */
export function decodePng(bytes: Uint8Array): RgbaImage {
  const chunks = readChunks(bytes);

  const ihdr = chunks.find((c) => c.type === "IHDR");
  if (!ihdr) throw new Error("decodePng: missing IHDR chunk");
  if (ihdr.data.length < 13) throw new Error("decodePng: IHDR chunk too short");

  const ihdrView = new DataView(ihdr.data.buffer, ihdr.data.byteOffset, ihdr.data.byteLength);
  const width = ihdrView.getUint32(0, false);
  const height = ihdrView.getUint32(4, false);
  const bitDepth = ihdr.data[8]!;
  const colorType = ihdr.data[9]!;
  const interlaceMethod = ihdr.data[12]!;

  if (interlaceMethod !== 0) {
    throw new Error(
      `decodePng: unsupported PNG variant — interlace method ${interlaceMethod} (only non-interlaced/0 is supported; Adam7 needs a defined extension, not a guess)`,
    );
  }

  let bpp: number;
  let hasAlpha: boolean;
  if (colorType === 2 && bitDepth === 8) {
    bpp = 3;
    hasAlpha = false;
  } else if (colorType === 6 && bitDepth === 8) {
    bpp = 4;
    hasAlpha = true;
  } else {
    throw new Error(
      `decodePng: unsupported PNG variant — color type ${colorType} / bit depth ${bitDepth} (only truecolor-8 (2) and truecolor-alpha-8 (6) are supported)`,
    );
  }

  const idatChunks = chunks.filter((c) => c.type === "IDAT");
  if (idatChunks.length === 0) throw new Error("decodePng: no IDAT chunks found");
  let totalLength = 0;
  for (const c of idatChunks) totalLength += c.data.length;
  const compressed = new Uint8Array(totalLength);
  let pos = 0;
  for (const c of idatChunks) {
    compressed.set(c.data, pos);
    pos += c.data.length;
  }

  const decompressed = new Uint8Array(inflateSync(compressed));
  const rawPixels = unfilter(decompressed, width, height, bpp);

  if (!hasAlpha) {
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0, j = 0; i < rawPixels.length; i += 3, j += 4) {
      rgba[j] = rawPixels[i]!;
      rgba[j + 1] = rawPixels[i + 1]!;
      rgba[j + 2] = rawPixels[i + 2]!;
      rgba[j + 3] = 255;
    }
    return { width, height, pixels: rgba };
  }

  return { width, height, pixels: rawPixels };
}

function writeChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const out = new Uint8Array(4 + 4 + data.length + 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  out.set(typeBytes, 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)), false);
  return out;
}

/**
 * Hand-rolled PNG encoder — the write-back path used to feed a
 * composited/processed raw-pixel buffer back into Bun.Image for final
 * re-encoding (spec §5). PNG, not BMP, is used for this direction: empirical
 * testing (see the Foundation Verification Harness) found Bun.Image's BMP
 * *decoder* discards the alpha channel entirely (every non-255 alpha byte in
 * a 32bpp BMP came back as 255), which silently breaks anything relying on
 * partial transparency — exactly the property the watermark compositor
 * needs. PNG round-trips alpha exactly (confirmed: 0 mismatches across a
 * 16-pixel fixture with varied alpha values), so it's used for both
 * directions, not just decode.
 *
 * Always emits color type 6 (RGBA), bit depth 8, filter type 0 (None) on
 * every row, non-interlaced — correctness and simplicity over compression
 * ratio, since this output is never the final response to a client, only an
 * intermediate vehicle back into Bun.Image.
 */
export function encodePng(image: RgbaImage): Uint8Array {
  const { width, height, pixels } = image;
  if (pixels.length !== width * height * 4) {
    throw new Error(
      `encodePng: pixel buffer length ${pixels.length} does not match ${width}x${height}x4`,
    );
  }

  const rowBytes = width * 4;
  const raw = new Uint8Array((rowBytes + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (rowBytes + 1)] = 0; // filter type None
    raw.set(pixels.subarray(y * rowBytes, (y + 1) * rowBytes), y * (rowBytes + 1) + 1);
  }
  const compressed = new Uint8Array(deflateSync(raw));

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: truecolor + alpha
  ihdr[10] = 0; // compression method (only valid value)
  ihdr[11] = 0; // filter method (only valid value)
  ihdr[12] = 0; // interlace method: none

  const parts = [
    new Uint8Array(SIGNATURE),
    writeChunk("IHDR", ihdr),
    writeChunk("IDAT", compressed),
    writeChunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
