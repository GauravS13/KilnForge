import { describe, expect, test, afterEach } from "bun:test";
import { archiveUnpackRoute } from "./archiveUnpack.ts";
import { startTestServer } from "./testServer.ts";

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  stop = undefined;
});

async function archiveFormData(entries: Record<string, string>): Promise<FormData> {
  const archive = new Bun.Archive(entries);
  const bytes = await archive.bytes();
  const fd = new FormData();
  fd.set("archive", new Blob([bytes]), "archive.tar");
  return fd;
}

describe("POST /archive/unpack", () => {
  test("lists real entries with names and sizes", async () => {
    const t = startTestServer("POST", "/archive/unpack", archiveUnpackRoute);
    stop = t.stop;
    const fd = await archiveFormData({ "a.txt": "hello", "b.txt": "world!" });
    const res = await fetch(t.url, { method: "POST", body: fd });
    expect(res.status).toBe(200);
    const body = await res.json();
    const byName = Object.fromEntries(body.entries.map((e: any) => [e.name, e.size]));
    expect(byName["a.txt"]).toBe(5);
    expect(byName["b.txt"]).toBe(6);
  });

  test("extracts a specific entry's bytes with ?extract=", async () => {
    const t = startTestServer("POST", "/archive/unpack", archiveUnpackRoute);
    stop = t.stop;
    const fd = await archiveFormData({ "a.txt": "hello" });
    const res = await fetch(`${t.url}?extract=a.txt`, { method: "POST", body: fd });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello");
  });

  test("400s extracting a nonexistent entry name", async () => {
    const t = startTestServer("POST", "/archive/unpack", archiveUnpackRoute);
    stop = t.stop;
    const fd = await archiveFormData({ "a.txt": "hello" });
    const res = await fetch(`${t.url}?extract=nope.txt`, { method: "POST", body: fd });
    expect(res.status).toBe(400);
  });

  test("400s on the real committed path-traversal fixture", async () => {
    const t = startTestServer("POST", "/archive/unpack", archiveUnpackRoute);
    stop = t.stop;
    const bytes = await Bun.file("fixtures/archives/traversal.tar").arrayBuffer();
    const fd = new FormData();
    fd.set("archive", new Blob([bytes]), "traversal.tar");
    const res = await fetch(t.url, { method: "POST", body: fd });
    expect(res.status).toBe(400);
  });

  test("400s when no archive field is provided", async () => {
    const t = startTestServer("POST", "/archive/unpack", archiveUnpackRoute);
    stop = t.stop;
    const res = await fetch(t.url, { method: "POST", body: new FormData() });
    expect(res.status).toBe(400);
  });
});
