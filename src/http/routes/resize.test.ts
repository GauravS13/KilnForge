import { describe, expect, test, afterEach } from "bun:test";
import { resizeRoute } from "./resize.ts";
import { startTestServer, makeTestImagePng, imageFormData } from "./testServer.ts";
import { decodePng } from "../../image/png.ts";

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  stop = undefined;
});

describe("POST /resize", () => {
  test("resizes a real uploaded image over a real HTTP request", async () => {
    const t = startTestServer("POST", "/resize", resizeRoute);
    stop = t.stop;
    const fd = imageFormData("image", makeTestImagePng(8, 8));
    const res = await fetch(`${t.url}?w=4&h=4&fit=fill&format=png`, { method: "POST", body: fd });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    const decoded = decodePng(new Uint8Array(await res.arrayBuffer()));
    expect(decoded.width).toBe(4);
    expect(decoded.height).toBe(4);
  });

  test("400s with a named field when both w and h are missing", async () => {
    const t = startTestServer("POST", "/resize", resizeRoute);
    stop = t.stop;
    const fd = imageFormData("image", makeTestImagePng());
    const res = await fetch(t.url, { method: "POST", body: fd });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("w/h");
  });

  test("400s with a named field on a non-integer w", async () => {
    const t = startTestServer("POST", "/resize", resizeRoute);
    stop = t.stop;
    const fd = imageFormData("image", makeTestImagePng());
    const res = await fetch(`${t.url}?w=abc`, { method: "POST", body: fd });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.detail).toContain("w");
  });

  test("415s on an unsupported requested format", async () => {
    const t = startTestServer("POST", "/resize", resizeRoute);
    stop = t.stop;
    const fd = imageFormData("image", makeTestImagePng());
    const res = await fetch(`${t.url}?w=2&format=bmp`, { method: "POST", body: fd });
    expect(res.status).toBe(415);
  });

  test("400s (never a raw stack trace) on genuinely corrupt image bytes", async () => {
    const t = startTestServer("POST", "/resize", resizeRoute);
    stop = t.stop;
    const garbage = new Uint8Array(20);
    crypto.getRandomValues(garbage);
    const fd = imageFormData("image", garbage);
    const res = await fetch(`${t.url}?w=4`, { method: "POST", body: fd });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(typeof body.error).toBe("string");
    expect(body.error).not.toContain(" at "); // no stack trace text leaking through
  });

  test("defaults output format to the input's own format when not specified", async () => {
    const t = startTestServer("POST", "/resize", resizeRoute);
    stop = t.stop;
    const fd = imageFormData("image", makeTestImagePng(8, 8));
    const res = await fetch(`${t.url}?w=4`, { method: "POST", body: fd });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png"); // input was PNG
  });
});
