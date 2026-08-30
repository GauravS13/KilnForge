/**
 * Hand-rolled JPEG EXIF orientation reader. Scans for the APP1 (0xFFE1)
 * marker, walks into the TIFF/EXIF sub-structure, and reads the
 * orientation tag (0x0112) as a big/little-endian uint16 depending on the
 * "II"/"MM" byte-order marker — respecting whichever the file declares,
 * never assuming one.
 *
 * Never throws — returns 1 (normal, no correction needed) for anything
 * malformed, truncated, or simply not carrying an EXIF/orientation tag at
 * all, since the overwhelming majority of uploads won't be JPEGs with
 * orientation metadata and that's not an error condition.
 *
 * IMPORTANT CORRECTION, found by testing, not assumed: the original spec
 * for this project (and every source it was researched against) treated
 * EXIF auto-orientation as a real gap in Bun.Image that this module needed
 * to close. Empirical testing found otherwise — Bun.Image already applies
 * EXIF orientation correction internally during decode (confirmed:
 * `.metadata()` reports swapped width/height immediately for an
 * orientation-6-tagged JPEG, and the actual decoded pixel content is a
 * byte-exact match, 0/4800 mismatches, against manually rotating a
 * non-EXIF-tagged version of the same source with native `.rotate(90)`).
 * `readExifOrientation()` and `applyOrientation()` below are kept as real,
 * independently correct, tested utilities — but are deliberately NOT
 * wired into the request pipeline (see src/http/routes/_shared.ts),
 * because calling applyOrientation() on top of Bun.Image's own
 * auto-orientation would double-rotate every EXIF-tagged upload.
 */
export function readExifOrientation(bytes: Uint8Array): number {
  try {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1; // not a JPEG (no SOI)

    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 0xff) break; // not a marker — malformed, bail safely

      const marker = bytes[offset + 1]!;

      // Markers with no length field: SOI/EOI, RSTn (0xD0-0xD7), TEM (0x01).
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }

      if (offset + 4 > bytes.length) break;
      const segmentLength = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;

      if (marker === 0xe1) {
        const segStart = offset + 4;
        const isExif =
          bytes[segStart] === 0x45 && // 'E'
          bytes[segStart + 1] === 0x78 && // 'x'
          bytes[segStart + 2] === 0x69 && // 'i'
          bytes[segStart + 3] === 0x66 && // 'f'
          bytes[segStart + 4] === 0x00 &&
          bytes[segStart + 5] === 0x00;
        if (isExif) {
          const orientation = readTiffOrientation(bytes, segStart + 6);
          if (orientation !== null) return orientation;
        }
      }

      if (marker === 0xda) break; // SOS — start of scan, image data follows, stop scanning

      offset += 2 + segmentLength;
    }
  } catch {
    // fall through to the safe default
  }
  return 1;
}

function readTiffOrientation(bytes: Uint8Array, tiffStart: number): number | null {
  if (tiffStart + 8 > bytes.length) return null;

  const b0 = bytes[tiffStart]!;
  const b1 = bytes[tiffStart + 1]!;
  let littleEndian: boolean;
  if (b0 === 0x49 && b1 === 0x49) littleEndian = true; // "II"
  else if (b0 === 0x4d && b1 === 0x4d) littleEndian = false; // "MM"
  else return null;

  const read16 = (o: number): number =>
    littleEndian ? bytes[o]! | (bytes[o + 1]! << 8) : (bytes[o]! << 8) | bytes[o + 1]!;
  const read32 = (o: number): number =>
    (littleEndian
      ? bytes[o]! | (bytes[o + 1]! << 8) | (bytes[o + 2]! << 16) | (bytes[o + 3]! << 24)
      : (bytes[o]! << 24) | (bytes[o + 1]! << 16) | (bytes[o + 2]! << 8) | bytes[o + 3]!) >>> 0;

  if (read16(tiffStart + 2) !== 0x002a) return null; // TIFF magic

  const ifdStart = tiffStart + read32(tiffStart + 4);
  if (ifdStart + 2 > bytes.length) return null;

  const entryCount = read16(ifdStart);
  for (let i = 0; i < entryCount; i++) {
    const entryOffset = ifdStart + 2 + i * 12;
    if (entryOffset + 12 > bytes.length) break;
    const tag = read16(entryOffset);
    if (tag === 0x0112) {
      const value = read16(entryOffset + 8); // SHORT value, first 2 bytes of the 4-byte value field
      return value >= 1 && value <= 8 ? value : null;
    }
  }
  return null;
}

/**
 * Applies the transform sequence for a given EXIF orientation value (1-8)
 * to a Bun.Image chain, using only native .flip()/.flop()/.rotate()
 * (confirmed empirically: .flip() = vertical mirror, .flop() = horizontal
 * mirror, matching the standard convention). Orientation 1 is a no-op.
 */
export function applyOrientation(image: Bun.Image, orientation: number): Bun.Image {
  switch (orientation) {
    case 2:
      return image.flop();
    case 3:
      return image.rotate(180);
    case 4:
      return image.flip();
    case 5:
      return image.flip().rotate(90);
    case 6:
      return image.rotate(90);
    case 7:
      return image.flip().rotate(270);
    case 8:
      return image.rotate(270);
    case 1:
    default:
      return image;
  }
}
