import { describe, expect, test, afterEach } from "bun:test";
import { createRouteTable, createServer, register } from "./server.ts";
import { TokenBucketRateLimiter } from "./rateLimit.ts";

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  stop = undefined;
});

describe("dispatch — CORS", () => {
  test("OPTIONS request gets a 204 preflight response with CORS headers", async () => {
    const table = createRouteTable();
    register(table, "GET", "/x", () => new Response("ok"));
    const server = createServer(table, 0);
    stop = () => server.stop(true);

    const res = await fetch(`http://localhost:${server.port}/x`, { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  test("a normal response carries CORS headers too", async () => {
    const table = createRouteTable();
    register(table, "GET", "/x", () => new Response("ok"));
    const server = createServer(table, 0);
    stop = () => server.stop(true);

    const res = await fetch(`http://localhost:${server.port}/x`);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  test("a 404 response also carries CORS headers", async () => {
    const table = createRouteTable();
    const server = createServer(table, 0);
    stop = () => server.stop(true);

    const res = await fetch(`http://localhost:${server.port}/nope`);
    expect(res.status).toBe(404);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  test("an explicit allowlist restricts the allow-origin header", async () => {
    const table = createRouteTable();
    register(table, "GET", "/x", () => new Response("ok"));
    const server = createServer(table, 0, { cors: { allowedOrigins: ["https://good.example"] } });
    stop = () => server.stop(true);

    const allowed = await fetch(`http://localhost:${server.port}/x`, {
      headers: { origin: "https://good.example" },
    });
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://good.example");

    const denied = await fetch(`http://localhost:${server.port}/x`, {
      headers: { origin: "https://evil.example" },
    });
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("dispatch — rate limiting", () => {
  test("blocks a client after its bucket is exhausted, with a 429", async () => {
    const table = createRouteTable();
    register(table, "GET", "/x", () => new Response("ok"));
    const limiter = new TokenBucketRateLimiter({ capacity: 2, refillPerSecond: 0.001 });
    const server = createServer(table, 0, { rateLimiter: limiter });
    stop = () => server.stop(true);

    const url = `http://localhost:${server.port}/x`;
    const r1 = await fetch(url);
    const r2 = await fetch(url);
    const r3 = await fetch(url);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(429);
  });

  test("without a rate limiter configured, requests are never blocked", async () => {
    const table = createRouteTable();
    register(table, "GET", "/x", () => new Response("ok"));
    const server = createServer(table, 0);
    stop = () => server.stop(true);

    const url = `http://localhost:${server.port}/x`;
    for (let i = 0; i < 10; i++) {
      const res = await fetch(url);
      expect(res.status).toBe(200);
    }
  });
});

describe("dispatch — prefix routes", () => {
  test("a registered prefix route matches any pathname starting with it", async () => {
    const { registerPrefix } = await import("./server.ts");
    const table = createRouteTable();
    registerPrefix(table, "GET", "/t/", (req, url) => new Response(url.pathname));
    const server = createServer(table, 0);
    stop = () => server.stop(true);

    const res = await fetch(`http://localhost:${server.port}/t/abc123/w_100/source.jpg`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("/t/abc123/w_100/source.jpg");
  });

  test("an exact route takes precedence over an overlapping prefix", async () => {
    const { registerPrefix } = await import("./server.ts");
    const table = createRouteTable();
    registerPrefix(table, "GET", "/t/", () => new Response("prefix"));
    register(table, "GET", "/t/exact", () => new Response("exact"));
    const server = createServer(table, 0);
    stop = () => server.stop(true);

    const res = await fetch(`http://localhost:${server.port}/t/exact`);
    expect(await res.text()).toBe("exact");
  });
});
