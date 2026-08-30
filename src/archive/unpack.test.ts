import { describe, expect, test } from "bun:test";
import { unpackArchive, UnsafeArchiveEntryError } from "./unpack.ts";
import { ArchiveBombError } from "./bomb.ts";

describe("unpackArchive", () => {
  test("unpacks real entries with correct content and size", async () => {
    const archive = new Bun.Archive({ "hello.txt": "Hello, World!" });
    const bytes = await archive.bytes();
    const entries = await unpackArchive(bytes);
    expect(entries.length).toBe(1);
    expect(entries[0]!.name).toBe("hello.txt");
    expect(entries[0]!.size).toBe(13);
    expect(new TextDecoder().decode(entries[0]!.data)).toBe("Hello, World!");
  });

  test("unpacks the real committed path-traversal fixture and throws UnsafeArchiveEntryError", async () => {
    const bytes = await Bun.file("fixtures/archives/traversal.tar").arrayBuffer();
    await expect(unpackArchive(new Uint8Array(bytes))).rejects.toThrow(UnsafeArchiveEntryError);
  });

  test("rejects a synthetic archive with a '..' path segment anywhere, not just at the start", async () => {
    const archive = new Bun.Archive({ "safe/../../escape.txt": "x" });
    const bytes = await archive.bytes();
    await expect(unpackArchive(bytes)).rejects.toThrow(UnsafeArchiveEntryError);
  });

  test("rejects an absolute-path entry", async () => {
    const archive = new Bun.Archive({ "/etc/passwd": "x" });
    const bytes = await archive.bytes();
    await expect(unpackArchive(bytes)).rejects.toThrow(UnsafeArchiveEntryError);
  });

  test("allows a normal relative path with dots that aren't traversal (e.g. a filename with two dots)", async () => {
    const archive = new Bun.Archive({ "my..file.txt": "fine" });
    const bytes = await archive.bytes();
    const entries = await unpackArchive(bytes);
    expect(entries[0]!.name).toBe("my..file.txt");
  });

  test("propagates the archive-bomb guard's rejection", async () => {
    const archive = new Bun.Archive({ "big.txt": "x".repeat(10000) });
    const bytes = await archive.bytes();
    await expect(unpackArchive(bytes, { maxEntryBytes: 100 })).rejects.toThrow(ArchiveBombError);
  });

  test("handles multiple safe entries together", async () => {
    const archive = new Bun.Archive({ "a.txt": "1", "b.txt": "2", "c.txt": "3" });
    const bytes = await archive.bytes();
    const entries = await unpackArchive(bytes);
    expect(entries.length).toBe(3);
  });
});
