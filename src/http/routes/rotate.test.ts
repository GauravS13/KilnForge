import { describe, expect, test, afterEach } from "bun:test";
import { rotateRoute } from "./rotate.ts";
import { startTestServer, makeTestImagePng, imageFormData } from "./testServer.ts";
import { decodePng } from "../../image/png.ts";

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  stop = undefined;
});

describe("POST /rotate", () => {
  test("rotate?deg=90 uses native rotate and swaps dimensions over a real request", async () => {
    const t = startTestServer("POST", "/rotate", rotateRoute);
    stop = t.stop;
    const fd = imageFormData("image", makeTestImagePng(8, 4));
    const res = await fetch(`${t.url}?deg=90&format=png`, { method: "POST", body: fd });
    expect(res.status).toBe(200);
    const decoded = decodePng(new Uint8Array(await res.arrayBuffer()));
    expect(decoded.width).toBe(4);
    expect(decoded.height).toBe(8);
  });

  test("rotate?deg=45 uses the fallback over a real request and grows the canvas", async () => {
    const t = startTestServer("POST", "/rotate", rotateRoute);
    stop = t.stop;
    const fd = imageFormData("image", makeTestImagePng(10, 10));
    const res = await fetch(`${t.url}?deg=45&format=png`, { method: "POST", body: fd });
    expect(res.status).toBe(200);
    const decoded = decodePng(new Uint8Array(await res.arrayBuffer()));
    expect(decoded.width).toBeGreaterThan(10);
  });

  test("400s with a named field when deg is missing", async () => {
    const t = startTestServer("POST", "/rotate", rotateRoute);
    stop = t.stop;
    const fd = imageFormData("image", makeTestImagePng());
    const res = await fetch(t.url, { method: "POST", body: fd });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("deg");
  });

  test("400s on a non-numeric deg", async () => {
    const t = startTestServer("POST", "/rotate", rotateRoute);
    stop = t.stop;
    const fd = imageFormData("image", makeTestImagePng());
    const res = await fetch(`${t.url}?deg=xyz`, { method: "POST", body: fd });
    expect(res.status).toBe(400);
  });
});
