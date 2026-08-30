/**
 * Never trust a client-supplied Content-Type header or file extension —
 * validates the actual leading bytes against known format magic numbers.
 * A small, from-scratch check that closes a real MIME-confusion class of
 * bug: a file claiming to be a PNG that's actually something else
 * entirely should never reach Bun.Image at all.
 */

export type DetectedFormat = "png" | "jpeg" | "gif" | "bmp" | "webp";

const SIGNATURES: { format: DetectedFormat; matches: (b: Uint8Array) => boolean }[] = [
  {
    format: "png",
    matches: (b) =>
      b.length >= 8 &&
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47 &&
      b[4] === 0x0d &&
      b[5] === 0x0a &&
      b[6] === 0x1a &&
      b[7] === 0x0a,
  },
  {
    format: "jpeg",
    matches: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    format: "gif",
    matches: (b) =>
      b.length >= 6 &&
      b[0] === 0x47 &&
      b[1] === 0x49 &&
      b[2] === 0x46 &&
      b[3] === 0x38 &&
      (b[4] === 0x37 || b[4] === 0x39) &&
      b[5] === 0x61,
  },
  {
    format: "bmp",
    matches: (b) => b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d,
  },
  {
    format: "webp",
    // RIFF....WEBP — the 4-byte size field in between is not checked
    // (it varies), only the two fixed fourCC tags that bracket it.
    matches: (b) =>
      b.length >= 12 &&
      b[0] === 0x52 &&
      b[1] === 0x49 &&
      b[2] === 0x46 &&
      b[3] === 0x46 &&
      b[8] === 0x57 &&
      b[9] === 0x45 &&
      b[10] === 0x42 &&
      b[11] === 0x50,
  },
];

/** Returns the detected format from real leading bytes, or null if none
 * of the five known signatures match — never guesses, never falls back
 * to trusting a Content-Type header. */
export function detectFormat(bytes: Uint8Array): DetectedFormat | null {
  for (const { format, matches } of SIGNATURES) {
    if (matches(bytes)) return format;
  }
  return null;
}

export class UnrecognizedImageFormatError extends Error {
  constructor() {
    super("upload does not match any recognized image format's magic bytes");
    this.name = "UnrecognizedImageFormatError";
  }
}

export function assertRecognizedImageFormat(bytes: Uint8Array): DetectedFormat {
  const format = detectFormat(bytes);
  if (!format) throw new UnrecognizedImageFormatError();
  return format;
}
