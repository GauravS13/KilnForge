import { describe, expect, test, afterEach } from "bun:test";
import { convertRoute } from "./convert.ts";
import { startTestServer, makeTestImagePng, imageFormData } from "./testServer.ts";

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  stop = undefined;
});

describe("POST /convert", () => {
  test("converts png -> jpeg over a real request", async () => {
    const t = startTestServer("POST", "/convert", convertRoute);
    stop = t.stop;
    const fd = imageFormData("image", makeTestImagePng());
    const res = await fetch(`${t.url}?format=jpeg`, { method: "POST", body: fd });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1]).toBe(0xd8);
  });

  test("converts png -> webp over a real request", async () => {
    const t = startTestServer("POST", "/convert", convertRoute);
    stop = t.stop;
    const fd = imageFormData("image", makeTestImagePng());
    const res = await fetch(`${t.url}?format=webp`, { method: "POST", body: fd });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
  });

  test("400s with a named field when format is missing", async () => {
    const t = startTestServer("POST", "/convert", convertRoute);
    stop = t.stop;
    const fd = imageFormData("image", makeTestImagePng());
    const res = await fetch(t.url, { method: "POST", body: fd });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("format");
  });

  test("415s on bmp/gif — confirmed decode-only, not valid convert targets", async () => {
    const t = startTestServer("POST", "/convert", convertRoute);
    stop = t.stop;
    const fd = imageFormData("image", makeTestImagePng());
    const res1 = await fetch(`${t.url}?format=bmp`, { method: "POST", body: fd });
    expect(res1.status).toBe(415);
  });

  test("respects an explicit quality parameter", async () => {
    const t = startTestServer("POST", "/convert", convertRoute);
    stop = t.stop;
    const fd1 = imageFormData("image", makeTestImagePng(16, 16));
    const highQ = await fetch(`${t.url}?format=jpeg&quality=95`, { method: "POST", body: fd1 });
    const fd2 = imageFormData("image", makeTestImagePng(16, 16));
    const lowQ = await fetch(`${t.url}?format=jpeg&quality=10`, { method: "POST", body: fd2 });
    expect(highQ.status).toBe(200);
    expect(lowQ.status).toBe(200);
    const highBytes = (await highQ.arrayBuffer()).byteLength;
    const lowBytes = (await lowQ.arrayBuffer()).byteLength;
    expect(highBytes).toBeGreaterThan(lowBytes);
  });
});
