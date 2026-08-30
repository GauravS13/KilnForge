import { describe, expect, test, afterEach } from "bun:test";
import { archivePackRoute } from "./archivePack.ts";
import { startTestServer } from "./testServer.ts";

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  stop = undefined;
});

describe("POST /archive/pack", () => {
  test("packs multiple uploaded files into a real, readable archive", async () => {
    const t = startTestServer("POST", "/archive/pack", archivePackRoute);
    stop = t.stop;
    const fd = new FormData();
    fd.append("files", new Blob([new TextEncoder().encode("hello")]), "a.txt");
    fd.append("files", new Blob([new TextEncoder().encode("world")]), "b.txt");
    const res = await fetch(t.url, { method: "POST", body: fd });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/x-tar");

    const archive = new Bun.Archive(new Uint8Array(await res.arrayBuffer()));
    const files = await archive.files();
    expect(files.has("a.txt")).toBe(true);
    expect(files.has("b.txt")).toBe(true);
    expect(await files.get("a.txt")!.text()).toBe("hello");
  });

  test("400s when no files field is provided", async () => {
    const t = startTestServer("POST", "/archive/pack", archivePackRoute);
    stop = t.stop;
    const fd = new FormData();
    const res = await fetch(t.url, { method: "POST", body: fd });
    expect(res.status).toBe(400);
  });

  test("400s on an invalid compress value", async () => {
    const t = startTestServer("POST", "/archive/pack", archivePackRoute);
    stop = t.stop;
    const fd = new FormData();
    fd.append("files", new Blob([new Uint8Array(1)]), "a.bin");
    const res = await fetch(`${t.url}?compress=bogus`, { method: "POST", body: fd });
    expect(res.status).toBe(400);
  });

  test("respects compress=gzip", async () => {
    const t = startTestServer("POST", "/archive/pack", archivePackRoute);
    stop = t.stop;
    const fd = new FormData();
    fd.append("files", new Blob([new TextEncoder().encode("x".repeat(10000))]), "big.txt");
    const res = await fetch(`${t.url}?compress=gzip`, { method: "POST", body: fd });
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes[0]).toBe(0x1f);
    expect(bytes[1]).toBe(0x8b);
  });
});
