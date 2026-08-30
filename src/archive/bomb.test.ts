import { describe, expect, test } from "bun:test";
import { parseTarHeaders, assertNotArchiveBomb, ArchiveBombError } from "./bomb.ts";

describe("parseTarHeaders — cross-validated against real Bun.Archive output", () => {
  test("reads real entry names and sizes from an uncompressed archive", async () => {
    const archive = new Bun.Archive({
      "hello.txt": "Hello, World!", // 13 bytes
      "data.json": '{"a":1}', // 7 bytes
    });
    const bytes = await archive.bytes();
    const entries = parseTarHeaders(bytes);
    expect(entries.length).toBe(2);
    const byName = Object.fromEntries(entries.map((e) => [e.name, e.size]));
    expect(byName["hello.txt"]).toBe(13);
    expect(byName["data.json"]).toBe(7);
  });

  test("stops at the end-of-archive marker rather than reading trailing padding as entries", async () => {
    const archive = new Bun.Archive({ "a.txt": "x" });
    const bytes = await archive.bytes();
    const entries = parseTarHeaders(bytes);
    expect(entries.length).toBe(1); // not more, despite the archive being padded to a full block size
  });

  test("correctly sums multi-block entries (data spanning more than one 512-byte block)", async () => {
    const bigContent = "x".repeat(2000); // spans 4 header blocks of data
    const archive = new Bun.Archive({ "big.txt": bigContent });
    const bytes = await archive.bytes();
    const entries = parseTarHeaders(bytes);
    expect(entries[0]!.size).toBe(2000);
  });
});

describe("assertNotArchiveBomb", () => {
  test("passes for a real, reasonably-sized archive", async () => {
    const archive = new Bun.Archive({ "a.txt": "hello", "b.txt": "world" });
    const bytes = await archive.bytes();
    await expect(assertNotArchiveBomb(bytes)).resolves.toBeUndefined();
  });

  test("passes for a real gzip-compressed archive", async () => {
    const archive = new Bun.Archive({ "a.txt": "hello world".repeat(100) }, { compress: "gzip" });
    const bytes = await archive.bytes();
    await expect(assertNotArchiveBomb(bytes)).resolves.toBeUndefined();
  });

  test("rejects when declared entry size exceeds the per-file cap", async () => {
    const archive = new Bun.Archive({ "big.txt": "x".repeat(10000) });
    const bytes = await archive.bytes();
    await expect(
      assertNotArchiveBomb(bytes, { maxEntryBytes: 5000 }),
    ).rejects.toThrow(ArchiveBombError);
  });

  test("rejects when total size exceeds the total cap", async () => {
    const archive = new Bun.Archive({
      "a.txt": "x".repeat(3000),
      "b.txt": "y".repeat(3000),
    });
    const bytes = await archive.bytes();
    await expect(
      assertNotArchiveBomb(bytes, { maxTotalBytes: 5000, maxEntryBytes: 4000 }),
    ).rejects.toThrow(ArchiveBombError);
  });

  test("rejects when entry count exceeds the cap", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 20; i++) files[`file-${i}.txt`] = "x";
    const archive = new Bun.Archive(files);
    const bytes = await archive.bytes();
    await expect(
      assertNotArchiveBomb(bytes, { maxEntryCount: 10 }),
    ).rejects.toThrow(ArchiveBombError);
  });

  test("rejects a gzip archive whose DECOMPRESSED size exceeds the cap, even though the compressed bytes are tiny — the real zip-bomb case", async () => {
    // Highly compressible content — small on disk, large once inflated.
    const hugeButCompressible = "a".repeat(2_000_000);
    const archive = new Bun.Archive({ "bomb.txt": hugeButCompressible }, { compress: "gzip" });
    const bytes = await archive.bytes();
    expect(bytes.length).toBeLessThan(50_000); // confirms it really is small on the wire
    await expect(
      assertNotArchiveBomb(bytes, { maxTotalBytes: 100_000 }),
    ).rejects.toThrow(ArchiveBombError);
  });

  test("rejects an uncompressed archive larger than the total cap without needing to parse headers first", async () => {
    const archive = new Bun.Archive({ "a.txt": "x".repeat(50_000) });
    const bytes = await archive.bytes();
    await expect(assertNotArchiveBomb(bytes, { maxTotalBytes: 10_000 })).rejects.toThrow(ArchiveBombError);
  });
});
