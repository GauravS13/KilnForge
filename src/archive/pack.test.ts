import { describe, expect, test } from "bun:test";
import { packArchive } from "./pack.ts";
import { parseTarHeaders } from "./bomb.ts";

describe("packArchive", () => {
  test("produces a real archive readable by Bun.Archive itself", async () => {
    const bytes = await packArchive([
      { name: "a.txt", data: new TextEncoder().encode("hello") },
      { name: "b.txt", data: new TextEncoder().encode("world") },
    ]);
    const archive = new Bun.Archive(bytes);
    const files = await archive.files();
    expect(files.has("a.txt")).toBe(true);
    expect(files.has("b.txt")).toBe(true);
    expect(await files.get("a.txt")!.text()).toBe("hello");
  });

  test("produces headers our own tar parser reads correctly (cross-validated, not just Bun.Archive round-tripping itself)", async () => {
    const bytes = await packArchive([{ name: "x.bin", data: new Uint8Array(1234) }]);
    const entries = parseTarHeaders(bytes);
    expect(entries).toEqual([{ name: "x.bin", size: 1234 }]);
  });

  test("gzip compression option produces smaller output for compressible data", async () => {
    const data = new TextEncoder().encode("a".repeat(100_000));
    const plain = await packArchive([{ name: "f.txt", data }]);
    const compressed = await packArchive([{ name: "f.txt", data }], { compress: "gzip" });
    expect(compressed.length).toBeLessThan(plain.length);
  });

  test("an empty entry list produces a valid (empty) archive", async () => {
    const bytes = await packArchive([]);
    const archive = new Bun.Archive(bytes);
    const files = await archive.files();
    expect(files.size).toBe(0);
  });
});
