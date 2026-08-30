import { describe, expect, test, afterEach, beforeAll, afterAll } from "bun:test";
import { transformUrlRoute } from "./transformUrl.ts";
import { registerPrefix, createRouteTable, createServer } from "../server.ts";
import { signTransformUrl } from "../signing.ts";

const SECRET = "test-transform-secret";
let originalSecret: string | undefined;

beforeAll(() => {
  originalSecret = process.env.KILNFORGE_SIGNING_SECRET;
  process.env.KILNFORGE_SIGNING_SECRET = SECRET;
});
afterAll(() => {
  process.env.KILNFORGE_SIGNING_SECRET = originalSecret;
});

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  stop = undefined;
});

function startServer() {
  const table = createRouteTable();
  registerPrefix(table, "GET", "/t/", transformUrlRoute);
  const server = createServer(table, 0);
  stop = () => server.stop(true);
  return `http://localhost:${server.port}`;
}

async function buildUrl(base: string, transformSpec: string, source: string, exp: number, secret = SECRET) {
  const sig = await signTransformUrl(secret, transformSpec, source, exp);
  return `${base}/t/${sig}/${transformSpec}/${encodeURIComponent(source)}`;
}

describe("GET /t/<signature>/<transform-spec>/<source>", () => {
  test("403s an unsigned/mis-signed request", async () => {
    const base = startServer();
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const url = `${base}/t/bogus-signature/w_100,fmt_png,exp_${exp}/${encodeURIComponent("http://localhost/x.png")}`;
    const res = await fetch(url);
    expect(res.status).toBe(403);
  });

  test("403s an expired signature", async () => {
    const base = startServer();
    const exp = Math.floor(Date.now() / 1000) - 10;
    const url = await buildUrl(base, `w_100,fmt_png,exp_${exp}`, "http://localhost/x.png", exp);
    const res = await fetch(url);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("expired");
  });

  test("415s an unsupported/missing output format even with a valid signature", async () => {
    const base = startServer();
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const url = await buildUrl(base, `w_100,fmt_bmp,exp_${exp}`, "http://localhost/x.png", exp);
    const res = await fetch(url);
    expect(res.status).toBe(415);
  });

  test("400s when exp is missing from the transform spec", async () => {
    const base = startServer();
    const url = await buildUrl(base, "w_100,fmt_png", "http://localhost/x.png", 0);
    // sign against a spec that has no exp_ token at all
    const specWithoutExp = "w_100,fmt_png";
    const sig = await signTransformUrl(SECRET, specWithoutExp, "http://localhost/x.png", 9999999999);
    const res = await fetch(`${base}/t/${sig}/${specWithoutExp}/${encodeURIComponent("http://localhost/x.png")}`);
    expect(res.status).toBe(400);
  });

  test("403s a validly signed request whose source is SSRF-blocked (localhost) — proves the guard is really wired in, not just unit-tested in isolation", async () => {
    const base = startServer();
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const source = "http://localhost:1/some-image.png"; // loopback — always blocked, no network needed
    const url = await buildUrl(base, `w_100,fmt_png,exp_${exp}`, source, exp);
    const res = await fetch(url);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/localhost|loopback|blocked/i);
  });

  test("500s clearly when the signing secret isn't configured", async () => {
    const saved = process.env.KILNFORGE_SIGNING_SECRET;
    delete process.env.KILNFORGE_SIGNING_SECRET;
    try {
      const base = startServer();
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const res = await fetch(`${base}/t/x/w_100,fmt_png,exp_${exp}/${encodeURIComponent("http://localhost/x.png")}`);
      expect(res.status).toBe(500);
    } finally {
      process.env.KILNFORGE_SIGNING_SECRET = saved;
    }
  });
});
