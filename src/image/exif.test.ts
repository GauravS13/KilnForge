import { describe, expect, test } from "bun:test";
import { readExifOrientation } from "./exif.ts";

function u16(view: DataView, offset: number, value: number, littleEndian: boolean) {
  view.setUint16(offset, value, littleEndian);
}
function u32(view: DataView, offset: number, value: number, littleEndian: boolean) {
  view.setUint32(offset, value, littleEndian);
}

/** Builds a minimal JPEG-shaped byte sequence carrying just enough
 * structure (SOI, APP1/Exif, one-entry IFD with the orientation tag, EOI)
 * to exercise readExifOrientation() without needing a real decodable image. */
function buildJpegWithOrientation(orientation: number | null, littleEndian: boolean): Uint8Array {
  const tiffBody = new Uint8Array(8 + (orientation !== null ? 2 + 12 + 4 : 2 + 4));
  const view = new DataView(tiffBody.buffer);

  tiffBody[0] = littleEndian ? 0x49 : 0x4d;
  tiffBody[1] = littleEndian ? 0x49 : 0x4d;
  u16(view, 2, 0x002a, littleEndian);
  u32(view, 4, 8, littleEndian); // IFD starts right after the 8-byte TIFF header

  if (orientation !== null) {
    u16(view, 8, 1, littleEndian); // entry count = 1
    u16(view, 10, 0x0112, littleEndian); // tag: orientation
    u16(view, 12, 3, littleEndian); // type: SHORT
    u32(view, 14, 1, littleEndian); // count: 1
    u16(view, 18, orientation, littleEndian); // value (first 2 bytes of the 4-byte field)
    u32(view, 22, 0, littleEndian); // next IFD offset: none
  } else {
    u16(view, 8, 0, littleEndian); // entry count = 0
    u32(view, 10, 0, littleEndian);
  }

  const exifHeader = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]); // "Exif\0\0"
  const app1Data = new Uint8Array(exifHeader.length + tiffBody.length);
  app1Data.set(exifHeader, 0);
  app1Data.set(tiffBody, exifHeader.length);

  const app1SegmentLength = 2 + app1Data.length; // includes the 2 length bytes themselves
  const out = new Uint8Array(2 + 2 + 2 + app1Data.length + 2);
  out[0] = 0xff;
  out[1] = 0xd8; // SOI
  out[2] = 0xff;
  out[3] = 0xe1; // APP1
  new DataView(out.buffer).setUint16(4, app1SegmentLength, false); // segment length is always big-endian in JPEG markers
  out.set(app1Data, 6);
  out[6 + app1Data.length] = 0xff;
  out[6 + app1Data.length + 1] = 0xd9; // EOI

  return out;
}

describe("readExifOrientation", () => {
  test.each([1, 2, 3, 4, 5, 6, 7, 8])("reads orientation %d correctly, little-endian (II)", (o) => {
    const jpeg = buildJpegWithOrientation(o, true);
    expect(readExifOrientation(jpeg)).toBe(o);
  });

  test.each([1, 2, 3, 4, 5, 6, 7, 8])("reads orientation %d correctly, big-endian (MM)", (o) => {
    const jpeg = buildJpegWithOrientation(o, false);
    expect(readExifOrientation(jpeg)).toBe(o);
  });

  test("returns 1 when there is no orientation tag in the IFD", () => {
    const jpeg = buildJpegWithOrientation(null, true);
    expect(readExifOrientation(jpeg)).toBe(1);
  });

  test("returns 1 for a non-JPEG (no SOI marker)", () => {
    const notJpeg = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]);
    expect(readExifOrientation(notJpeg)).toBe(1);
  });

  test("returns 1 for a JPEG with no APP1/Exif segment at all", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]); // just SOI + EOI
    expect(readExifOrientation(jpeg)).toBe(1);
  });

  test("returns 1 rather than throwing on a truncated file", () => {
    const jpeg = buildJpegWithOrientation(6, true);
    const truncated = jpeg.slice(0, 10);
    expect(readExifOrientation(truncated)).toBe(1);
  });

  test("returns 1 rather than throwing on garbage bytes", () => {
    const garbage = new Uint8Array(50);
    crypto.getRandomValues(garbage);
    expect(() => readExifOrientation(garbage)).not.toThrow();
  });

  test("stops scanning at SOS (start of scan) rather than reading into image data", () => {
    // APP1 placed AFTER a SOS marker should not be found — SOS means the
    // rest of the file is entropy-coded scan data, not more markers.
    const withOrientation = buildJpegWithOrientation(6, true);
    const sos = new Uint8Array([0xff, 0xda, 0x00, 0x02]); // minimal SOS-shaped bytes
    const reordered = new Uint8Array(sos.length + withOrientation.slice(2).length + 2);
    reordered[0] = 0xff;
    reordered[1] = 0xd8;
    reordered.set(sos, 2);
    reordered.set(withOrientation.slice(2), 2 + sos.length);
    expect(readExifOrientation(reordered)).toBe(1);
  });
});
