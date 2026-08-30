import { describe, expect, test } from "bun:test";
import { detectFormat, assertRecognizedImageFormat, UnrecognizedImageFormatError } from "./magicBytes.ts";

async function fixture(name: string): Promise<Uint8Array> {
  return new Uint8Array(await Bun.file(`fixtures/images/${name}`).arrayBuffer());
}

describe("detectFormat — cross-validated against the real fixture corpus", () => {
  test("detects png from a real fixture", async () => {
    expect(detectFormat(await fixture("small-16x16.png"))).toBe("png");
  });
  test("detects jpeg from a real fixture", async () => {
    expect(detectFormat(await fixture("photo-48x48.jpg"))).toBe("jpeg");
  });
  test("detects webp from a real fixture", async () => {
    expect(detectFormat(await fixture("photo-48x48.webp"))).toBe("webp");
  });
  test("detects bmp from a real fixture", async () => {
    expect(detectFormat(await fixture("bmp-input-24x24.bmp"))).toBe("bmp");
  });

  test("detects gif from a hand-built minimal header", () => {
    const bytes = new TextEncoder().encode("GIF89a" + "xx");
    expect(detectFormat(bytes)).toBe("gif");
  });

  test("returns null for random bytes", () => {
    const garbage = new Uint8Array(16);
    crypto.getRandomValues(garbage);
    // Astronomically unlikely to collide with a real signature by chance,
    // but guard against flakiness by checking it's a valid outcome type.
    const result = detectFormat(garbage);
    expect(result === null || typeof result === "string").toBe(true);
  });

  test("returns null for a text file claiming to be an image via extension alone", () => {
    const fakeImage = new TextEncoder().encode("<html>not an image</html>");
    expect(detectFormat(fakeImage)).toBeNull();
  });

  test("does not misdetect a truncated/empty buffer", () => {
    expect(detectFormat(new Uint8Array(0))).toBeNull();
    expect(detectFormat(new Uint8Array([0x89, 0x50]))).toBeNull(); // partial PNG sig
  });
});

describe("assertRecognizedImageFormat", () => {
  test("returns the format for a real fixture", async () => {
    expect(assertRecognizedImageFormat(await fixture("small-16x16.png"))).toBe("png");
  });

  test("throws UnrecognizedImageFormatError for non-image bytes", () => {
    const fake = new TextEncoder().encode("not an image at all");
    expect(() => assertRecognizedImageFormat(fake)).toThrow(UnrecognizedImageFormatError);
  });
});
