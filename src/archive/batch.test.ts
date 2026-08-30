import { describe, expect, test } from "bun:test";
import { batchProcess } from "./batch.ts";
import { decodePng } from "../image/png.ts";

async function fixture(name: string): Promise<Uint8Array> {
  return new Uint8Array(await Bun.file(`fixtures/images/${name}`).arrayBuffer());
}

describe("batchProcess", () => {
  test("processes every real image in a real archive and packs results into a new archive", async () => {
    const img1 = await fixture("small-16x16.png");
    const img2 = await fixture("medium-64x48.png");
    const inputArchive = new Bun.Archive({ "one.png": img1, "two.png": img2 });
    const inputBytes = await inputArchive.bytes();

    const { archive, result } = await batchProcess(inputBytes, { width: 8, format: "png" });

    expect(result.processed).toEqual(["one.png", "two.png"]);
    expect(result.skipped).toEqual([]);

    const outputArchive = new Bun.Archive(archive);
    const files = await outputArchive.files();
    expect(files.has("one.png")).toBe(true);
    expect(files.has("two.png")).toBe(true);

    const decoded = decodePng(new Uint8Array(await files.get("one.png")!.arrayBuffer()));
    expect(decoded.width).toBe(8);
  });

  test("skips non-image entries and still processes the real images in the same archive", async () => {
    const img = await fixture("small-16x16.png");
    const inputArchive = new Bun.Archive({
      "photo.png": img,
      "readme.txt": "this is not an image",
    });
    const inputBytes = await inputArchive.bytes();

    const { archive, result } = await batchProcess(inputBytes, { width: 4, format: "png" });

    expect(result.processed).toEqual(["photo.png"]);
    expect(result.skipped.length).toBe(1);
    expect(result.skipped[0]!.name).toBe("readme.txt");
    expect(result.skipped[0]!.reason).toContain("not a recognized image format");

    const outputArchive = new Bun.Archive(archive);
    const files = await outputArchive.files();
    expect(files.has("photo.png")).toBe(true);
    expect(files.has("readme.txt")).toBe(false);
  });

  test("skips an entry that individually trips the decompression-bomb guard, without failing the whole batch", async () => {
    const realImg = await fixture("small-16x16.png");
    const fakeHeader = new Uint8Array(24);
    fakeHeader.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    fakeHeader.set(new TextEncoder().encode("IHDR"), 12);
    new DataView(fakeHeader.buffer).setUint32(16, 50000, false);
    new DataView(fakeHeader.buffer).setUint32(20, 50000, false);

    const inputArchive = new Bun.Archive({ "good.png": realImg, "bomb.png": fakeHeader });
    const inputBytes = await inputArchive.bytes();

    const { result } = await batchProcess(inputBytes, { width: 4, format: "png" });
    expect(result.processed).toEqual(["good.png"]);
    expect(result.skipped.length).toBe(1);
    expect(result.skipped[0]!.name).toBe("bomb.png");
  });

  test("converts output extension to match the requested format", async () => {
    const img = await fixture("small-16x16.png");
    const inputArchive = new Bun.Archive({ "photo.png": img });
    const inputBytes = await inputArchive.bytes();

    const { archive } = await batchProcess(inputBytes, { width: 4, format: "jpeg" });
    const outputArchive = new Bun.Archive(archive);
    const files = await outputArchive.files();
    // Extension matches the OutputFormat string exactly ("jpeg", not
    // "jpg") — simpler and internally consistent, no special-case
    // extension-name mapping table to keep in sync.
    expect(files.has("photo.jpeg")).toBe(true);
  });

  test("propagates the archive-level bomb guard for the archive itself", async () => {
    const inputArchive = new Bun.Archive({ "x.png": "a".repeat(10000) });
    const inputBytes = await inputArchive.bytes();
    await expect(
      batchProcess(inputBytes, { width: 4, format: "png" }, { maxTotalBytes: 100 }),
    ).rejects.toThrow();
  });

  test("an archive with only non-image entries processes zero and skips all, without throwing", async () => {
    const inputArchive = new Bun.Archive({ "a.txt": "1", "b.txt": "2" });
    const inputBytes = await inputArchive.bytes();
    const { result } = await batchProcess(inputBytes, { width: 4, format: "png" });
    expect(result.processed).toEqual([]);
    expect(result.skipped.length).toBe(2);
  });
});
