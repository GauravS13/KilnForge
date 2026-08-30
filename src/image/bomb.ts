/**
 * Decompression-bomb defense: reads ONLY the image header (never a full
 * decode) to learn declared width/height, and rejects before Bun.Image is
 * ever called if the product exceeds a documented cap. A tiny file that
 * decodes to an enormous pixel buffer (e.g. a 50KB PNG claiming
 * 50000x50000) is a classic single-request memory-exhaustion attack
 * against exactly this category of service — this is the one hardening
 * item in this project where skipping it turns into an actual outage,
 * not just a bad response.
 *
 * Covers the five formats this project's own /convert accepts as input:
 * PNG, JPEG, GIF, BMP, WebP. AVIF/HEIC/TIFF (decode-supported on some
 * platforms per Bun.Image, but far more complex ISOBMFF-based headers)
 * are NOT covered by this specific guard — a stated, honest limitation,
 * not a silent gap. Callers should still enforce the byte-level upload
 * cap (src/http/uploadLimit.ts) as a first line of defense regardless of
 * format.
 */

export const DEFAULT_MAX_MEGAPIXELS = 40;

export interface ImageDimensions {
  width: number;
  height: number;
}

export class DecompressionBombError extends Error {
  constructor(
    public readonly width: number,
    public readonly height: number,
    public readonly maxMegapixels: number,
  ) {
    super(
      `image dimensions ${width}x${height} (${((width * height) / 1_000_000).toFixed(1)}MP) exceed the ${maxMegapixels}MP cap`,
    );
    this.name = "DecompressionBombError";
  }
}

function readPngDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 24) return null;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) if (bytes[i] !== sig[i]) return null;
  // IHDR is always the first chunk: sig(8) + length(4) + type(4) + width(4) + height(4)...
  if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) return null; // "IHDR"
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16, false), height: view.getUint32(20, false) };
}

function readGifDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 10) return null;
  const header = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!, bytes[4]!, bytes[5]!);
  if (header !== "GIF87a" && header !== "GIF89a") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
}

function readBmpDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 26 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) return null; // "BM"
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getInt32(18, true);
  const height = Math.abs(view.getInt32(22, true)); // sign is row-order, not relevant here
  return { width, height };
}

function readJpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1]!;
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (offset + 9 > bytes.length) return null;
    // SOF0-SOF15 except the DHT/JPG/DAC markers (0xC4, 0xC8, 0xCC) carry
    // dimensions: length(2) + precision(1) + height(2) + width(2) + ...
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      return { height: view.getUint16(offset + 5, false), width: view.getUint16(offset + 7, false) };
    }
    const segmentLength = view.getUint16(offset + 2, false);
    if (marker === 0xda) return null; // SOS — image data follows, no SOF found before it
    offset += 2 + segmentLength;
  }
  return null;
}

function readWebpDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 30) return null;
  const riff = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
  const webp = String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!);
  if (riff !== "RIFF" || webp !== "WEBP") return null;
  const fourcc = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (fourcc === "VP8X") {
    // Extended format: width/height are 24-bit little-endian, minus 1, at
    // fixed offsets within the VP8X chunk payload (which starts at 20).
    const width = (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16)) + 1;
    const height = (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16)) + 1;
    return { width, height };
  }
  if (fourcc === "VP8 ") {
    // Lossy: 3-byte frame tag, then a 3-byte start code (0x9d 0x01 0x2a),
    // then width/height as 14-bit little-endian values (top 2 bits are a
    // scale factor, masked off here since only dimensions are needed).
    const frameStart = 20;
    if (bytes.length < frameStart + 10) return null;
    if (bytes[frameStart + 3] !== 0x9d || bytes[frameStart + 4] !== 0x01 || bytes[frameStart + 5] !== 0x2a) {
      return null;
    }
    const width = view.getUint16(frameStart + 6, true) & 0x3fff;
    const height = view.getUint16(frameStart + 8, true) & 0x3fff;
    return { width, height };
  }
  if (fourcc === "VP8L") {
    // Lossless: a 1-byte signature (0x2f) then 4 bytes packing 14-bit
    // width-1 and 14-bit height-1 as little-endian bits.
    const payloadStart = 20;
    if (bytes.length < payloadStart + 5) return null;
    if (bytes[payloadStart] !== 0x2f) return null;
    const b = bytes.subarray(payloadStart + 1, payloadStart + 5);
    const bits = b[0]! | (b[1]! << 8) | (b[2]! << 16) | (b[3]! << 24);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >>> 14) & 0x3fff) + 1;
    return { width, height };
  }
  return null;
}

const READERS = [readPngDimensions, readJpegDimensions, readGifDimensions, readBmpDimensions, readWebpDimensions];

/** Returns declared dimensions from whichever header format matches, or
 * null if none of the five known formats' headers are recognized (an
 * unrecognized/unsupported format is not this function's problem to
 * flag — that's magicBytes.ts's job). */
export function readDeclaredDimensions(bytes: Uint8Array): ImageDimensions | null {
  for (const reader of READERS) {
    const result = reader(bytes);
    if (result) return result;
  }
  return null;
}

/** Throws DecompressionBombError if the declared dimensions exceed the
 * cap. Silently passes through (does nothing) if the format's header
 * isn't recognized — an unrecognized format fails later, at actual
 * decode time, with its own clear error; this function's only job is
 * catching the bomb case before that decode is ever attempted. */
export function assertNotDecompressionBomb(
  bytes: Uint8Array,
  maxMegapixels = DEFAULT_MAX_MEGAPIXELS,
): void {
  const dims = readDeclaredDimensions(bytes);
  if (!dims) return;
  const megapixels = (dims.width * dims.height) / 1_000_000;
  if (megapixels > maxMegapixels) {
    throw new DecompressionBombError(dims.width, dims.height, maxMegapixels);
  }
}
