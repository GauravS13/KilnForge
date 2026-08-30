import { describe, expect, test, afterEach } from "bun:test";
import { batchRoute } from "./batch.ts";
import { startTestServer } from "./testServer.ts";
import { decodePng } from "../../image/png.ts";

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  stop = undefined;
});

async function fixture(name: string): Promise<Uint8Array> {
  return new Uint8Array(await Bun.file(`fixtures/images/${name}`).arrayBuffer());
}

describe("POST /batch", () => {
  test("processes real images from a real archive over a real HTTP request end to end", async () => {
    const t = startTestServer("POST", "/batch", batchRoute);
    stop = t.stop;

    const img1 = await fixture("small-16x16.png");
    const img2 = await fixture("medium-64x48.png");
    const inputArchive = new Bun.Archive({ "one.png": img1, "two.png": img2 });
    const inputBytes = await inputArchive.bytes();

    const fd = new FormData();
    fd.set("archive", new Blob([inputBytes]), "batch.tar");

    const res = await fetch(`${t.url}?w=8&format=png`, { method: "POST", body: fd });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/x-tar");

    const summary = JSON.parse(res.headers.get("x-batch-summary")!);
    expect(summary.processed).toEqual(["one.png", "two.png"]);
    expect(summary.skipped).toEqual([]);

    const outputArchive = new Bun.Archive(new Uint8Array(await res.arrayBuffer()));
    const files = await outputArchive.files();
    const decoded = decodePng(new Uint8Array(await files.get("one.png")!.arrayBuffer()));
    expect(decoded.width).toBe(8);
  });

  test("skips non-image entries via the summary header, still processes real images", async () => {
    const t = startTestServer("POST", "/batch", batchRoute);
    stop = t.stop;

    const img = await fixture("small-16x16.png");
    const inputArchive = new Bun.Archive({ "photo.png": img, "notes.txt": "not an image" });
    const inputBytes = await inputArchive.bytes();

    const fd = new FormData();
    fd.set("archive", new Blob([inputBytes]), "batch.tar");
    const res = await fetch(`${t.url}?w=4&format=png`, { method: "POST", body: fd });
    expect(res.status).toBe(200);

    const summary = JSON.parse(res.headers.get("x-batch-summary")!);
    expect(summary.processed).toEqual(["photo.png"]);
    expect(summary.skipped.length).toBe(1);
    expect(summary.skipped[0].name).toBe("notes.txt");
  });

  test("400s when format is missing", async () => {
    const t = startTestServer("POST", "/batch", batchRoute);
    stop = t.stop;
    const inputArchive = new Bun.Archive({ "x.png": await fixture("small-16x16.png") });
    const fd = new FormData();
    fd.set("archive", new Blob([await inputArchive.bytes()]), "batch.tar");
    const res = await fetch(t.url, { method: "POST", body: fd });
    expect(res.status).toBe(400);
  });

  test("400s when no archive field is provided", async () => {
    const t = startTestServer("POST", "/batch", batchRoute);
    stop = t.stop;
    const res = await fetch(`${t.url}?format=png`, { method: "POST", body: new FormData() });
    expect(res.status).toBe(400);
  });

  test("413s at the route level when the archive-bomb guard trips — a tar header declaring a huge size, tiny actual bytes", async () => {
    const t = startTestServer("POST", "/batch", batchRoute);
    stop = t.stop;

    const smallArchive = new Bun.Archive({ "x.png": "a" });
    const bytes = await smallArchive.bytes();
    // Patch the declared size field (offset 124, 12-byte octal ASCII) to
    // claim ~1GB while the actual tar data blocks that follow stay tiny
    // — this is exactly the shape a real archive bomb's header takes,
    // and it's what parseTarHeaders() (src/archive/bomb.ts) reads to
    // reject before Bun.Archive ever materializes anything.
    const patched = new Uint8Array(bytes);
    const hugeSizeOctal = "10000000000 "; // ~1GB in octal, 12 bytes incl. trailing space
    const sizeField = new TextEncoder().encode(hugeSizeOctal.padStart(12, "0"));
    patched.set(sizeField.subarray(0, 12), 124);

    const fd = new FormData();
    fd.set("archive", new Blob([patched]), "bomb.tar");
    const res = await fetch(`${t.url}?format=png`, { method: "POST", body: fd });
    expect(res.status).toBe(413);
  });
});
