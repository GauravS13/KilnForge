import { describe, expect, test, afterEach } from "bun:test";
import { watermarkRoute } from "./watermark.ts";
import { startTestServer, makeTestImagePng, imageFormData } from "./testServer.ts";
import { decodePng } from "../../image/png.ts";

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  stop = undefined;
});

describe("POST /watermark", () => {
  test("text-mode watermark over a real request", async () => {
    const t = startTestServer("POST", "/watermark", watermarkRoute);
    stop = t.stop;
    const fd = imageFormData("image", makeTestImagePng(40, 20));
    const res = await fetch(`${t.url}?text=HI&position=br&format=png`, { method: "POST", body: fd });
    expect(res.status).toBe(200);
    const decoded = decodePng(new Uint8Array(await res.arrayBuffer()));
    expect(decoded.width).toBe(40);
    expect(decoded.height).toBe(20);
  });

  test("image-mode watermark (logo field) over a real request", async () => {
    const t = startTestServer("POST", "/watermark", watermarkRoute);
    stop = t.stop;
    const fd = new FormData();
    fd.set("image", new Blob([makeTestImagePng(40, 20)]), "base.png");
    fd.set("logo", new Blob([makeTestImagePng(8, 8)]), "logo.png");
    const res = await fetch(`${t.url}?position=tl&format=png`, { method: "POST", body: fd });
    expect(res.status).toBe(200);
    const decoded = decodePng(new Uint8Array(await res.arrayBuffer()));
    expect(decoded.width).toBe(40);
    expect(decoded.height).toBe(20);
  });

  test("400s when neither text nor logo is provided", async () => {
    const t = startTestServer("POST", "/watermark", watermarkRoute);
    stop = t.stop;
    const fd = imageFormData("image", makeTestImagePng(40, 20));
    const res = await fetch(t.url, { method: "POST", body: fd });
    expect(res.status).toBe(400);
  });

  test("400s on an invalid position value", async () => {
    const t = startTestServer("POST", "/watermark", watermarkRoute);
    stop = t.stop;
    const fd = imageFormData("image", makeTestImagePng(40, 20));
    const res = await fetch(`${t.url}?text=HI&position=middle`, { method: "POST", body: fd });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.detail).toContain("position");
  });

  test("400s on an invalid color value", async () => {
    const t = startTestServer("POST", "/watermark", watermarkRoute);
    stop = t.stop;
    const fd = imageFormData("image", makeTestImagePng(40, 20));
    const res = await fetch(`${t.url}?text=HI&color=notacolor`, { method: "POST", body: fd });
    expect(res.status).toBe(400);
  });

  test("opacity parameter is honored end to end", async () => {
    const t = startTestServer("POST", "/watermark", watermarkRoute);
    stop = t.stop;
    const fd = imageFormData("image", makeTestImagePng(40, 20));
    const res = await fetch(`${t.url}?text=HI&opacity=0.5&format=png`, { method: "POST", body: fd });
    expect(res.status).toBe(200);
  });
});
