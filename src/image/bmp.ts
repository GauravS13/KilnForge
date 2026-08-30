export interface RgbaImage {
  width: number;
  height: number;
  /** Row-major, top-down, 4 bytes/pixel (R,G,B,A). */
  pixels: Uint8Array;
}

const FILE_HEADER_SIZE = 14;
const DIB_HEADER_SIZE = 40; // BITMAPINFOHEADER
const BI_RGB = 0;

/**
 * Hand-rolled, uncompressed 32bpp BMP encoder (BITMAPFILEHEADER +
 * BITMAPINFOHEADER, BI_RGB only — no RLE, no BITFIELDS). This is the
 * write-back path used to feed a composited/processed raw-pixel buffer
 * back into Bun.Image for final re-encoding (spec §5) — BMP is chosen
 * for this direction specifically because it needs no compression and no
 * checksum, so it doesn't depend on Bun.Image's own BMP writer being
 * correct, only on its BMP *reader* accepting a spec-correct file.
 *
 * Always writes top-down (negative biHeight) — deliberate, not incidental:
 * it exercises the same signed-height convention the decoder below reads.
 */
export function encodeBmp(image: RgbaImage): Uint8Array {
  const { width, height, pixels } = image;
  if (pixels.length !== width * height * 4) {
    throw new Error(
      `encodeBmp: pixel buffer length ${pixels.length} does not match ${width}x${height}x4`,
    );
  }

  const rowSize = width * 4; // 32bpp rows are always 4-byte aligned already
  const pixelDataSize = rowSize * height;
  const pixelDataOffset = FILE_HEADER_SIZE + DIB_HEADER_SIZE;
  const fileSize = pixelDataOffset + pixelDataSize;

  const buf = new ArrayBuffer(fileSize);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);

  // BITMAPFILEHEADER
  bytes[0] = 0x42; // 'B'
  bytes[1] = 0x4d; // 'M'
  view.setUint32(2, fileSize, true);
  view.setUint32(6, 0, true); // reserved
  view.setUint32(10, pixelDataOffset, true);

  // BITMAPINFOHEADER
  view.setUint32(14, DIB_HEADER_SIZE, true);
  view.setInt32(18, width, true);
  view.setInt32(22, -height, true); // negative = top-down
  view.setUint16(26, 1, true); // planes
  view.setUint16(28, 32, true); // bpp
  view.setUint32(30, BI_RGB, true);
  view.setUint32(34, pixelDataSize, true);
  view.setInt32(38, 2835, true); // ~72 DPI, arbitrary but valid
  view.setInt32(42, 2835, true);
  view.setUint32(46, 0, true); // colors used (0 = all)
  view.setUint32(50, 0, true); // important colors (0 = all)

  let offset = pixelDataOffset;
  for (let y = 0; y < height; y++) {
    const rowStart = y * width * 4;
    for (let x = 0; x < width; x++) {
      const i = rowStart + x * 4;
      // BMP stores BGRA, not RGBA.
      bytes[offset++] = pixels[i + 2]!; // B
      bytes[offset++] = pixels[i + 1]!; // G
      bytes[offset++] = pixels[i]!; // R
      bytes[offset++] = pixels[i + 3]!; // A
    }
  }

  return bytes;
}

/**
 * Hand-rolled BMP decoder. Reads biHeight as SIGNED (per spec — positive
 * means bottom-up, negative means top-down) rather than assuming one or
 * the other, and asserts biCompression === BI_RGB, throwing a named error
 * rather than silently misreading compressed pixel data as raw bytes.
 *
 * Supports 24bpp (no alpha, implied 255) and 32bpp (BGRA) — the two depths
 * Bun.Image is expected to plausibly emit; anything else throws by name
 * rather than guessing.
 */
export function decodeBmp(bytes: Uint8Array): RgbaImage {
  if (bytes.length < FILE_HEADER_SIZE + DIB_HEADER_SIZE) {
    throw new Error("decodeBmp: truncated — shorter than a minimal BMP header");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (bytes[0] !== 0x42 || bytes[1] !== 0x4d) {
    throw new Error("decodeBmp: missing 'BM' magic bytes");
  }

  const pixelDataOffset = view.getUint32(10, true);
  const dibHeaderSize = view.getUint32(14, true);
  if (dibHeaderSize < DIB_HEADER_SIZE) {
    throw new Error(
      `decodeBmp: unsupported DIB header size ${dibHeaderSize} (expected >= ${DIB_HEADER_SIZE}, BITMAPINFOHEADER or later)`,
    );
  }

  const width = view.getInt32(18, true);
  const rawHeight = view.getInt32(22, true); // SIGNED — sign is the row-order signal
  const topDown = rawHeight < 0;
  const height = Math.abs(rawHeight);
  const bpp = view.getUint16(28, true);
  const compression = view.getUint32(30, true);

  if (compression !== BI_RGB) {
    throw new Error(
      `decodeBmp: unsupported compression mode ${compression} (only BI_RGB/0 — uncompressed — is supported)`,
    );
  }
  if (bpp !== 24 && bpp !== 32) {
    throw new Error(`decodeBmp: unsupported bit depth ${bpp} (only 24 and 32 are supported)`);
  }
  if (width <= 0 || height <= 0) {
    throw new Error(`decodeBmp: invalid dimensions ${width}x${height}`);
  }

  const bytesPerPixel = bpp / 8;
  const unpaddedRowSize = width * bytesPerPixel;
  const rowSize = Math.ceil(unpaddedRowSize / 4) * 4; // rows padded to 4-byte boundary
  const requiredLength = pixelDataOffset + rowSize * height;
  if (bytes.length < requiredLength) {
    throw new Error(
      `decodeBmp: truncated pixel data — need ${requiredLength} bytes, have ${bytes.length}`,
    );
  }

  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    // File storage order is always bottom-up-first-in-file for bottom-up
    // BMPs; topDown files store row 0 first. Either way, destRow is the
    // row's position in our own top-down RGBA output.
    const destRow = topDown ? y : height - 1 - y;
    const rowOffset = pixelDataOffset + y * rowSize;
    for (let x = 0; x < width; x++) {
      const srcOffset = rowOffset + x * bytesPerPixel;
      const destOffset = (destRow * width + x) * 4;
      const b = bytes[srcOffset]!;
      const g = bytes[srcOffset + 1]!;
      const r = bytes[srcOffset + 2]!;
      const a = bpp === 32 ? bytes[srcOffset + 3]! : 255;
      pixels[destOffset] = r;
      pixels[destOffset + 1] = g;
      pixels[destOffset + 2] = b;
      pixels[destOffset + 3] = a;
    }
  }

  return { width, height, pixels };
}
