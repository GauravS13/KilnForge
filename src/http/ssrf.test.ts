import { describe, expect, test } from "bun:test";
import {
  isBlockedIp,
  assertHostnameAllowed,
  safeFetch,
  SsrfBlockedError,
  type LookupFn,
} from "./ssrf.ts";

describe("isBlockedIp — IPv4", () => {
  test("blocks loopback", () => {
    expect(isBlockedIp("127.0.0.1")).toBe(true);
    expect(isBlockedIp("127.255.255.255")).toBe(true);
  });

  test("blocks the cloud-metadata address specifically", () => {
    expect(isBlockedIp("169.254.169.254")).toBe(true);
  });

  test("blocks the broader link-local range", () => {
    expect(isBlockedIp("169.254.1.1")).toBe(true);
  });

  test("blocks private ranges (10/8, 172.16/12, 192.168/16)", () => {
    expect(isBlockedIp("10.0.0.1")).toBe(true);
    expect(isBlockedIp("10.255.255.255")).toBe(true);
    expect(isBlockedIp("172.16.0.1")).toBe(true);
    expect(isBlockedIp("172.31.255.255")).toBe(true);
    expect(isBlockedIp("172.32.0.1")).toBe(false); // just outside 172.16.0.0/12
    expect(isBlockedIp("192.168.1.1")).toBe(true);
  });

  test("blocks carrier-grade NAT range", () => {
    expect(isBlockedIp("100.64.0.1")).toBe(true);
  });

  test("blocks 0.0.0.0/8", () => {
    expect(isBlockedIp("0.0.0.0")).toBe(true);
  });

  test("does not block real public addresses", () => {
    expect(isBlockedIp("8.8.8.8")).toBe(false);
    expect(isBlockedIp("1.1.1.1")).toBe(false);
    expect(isBlockedIp("93.184.216.34")).toBe(false);
  });
});

describe("isBlockedIp — IPv6", () => {
  test("blocks ::1 loopback", () => {
    expect(isBlockedIp("::1")).toBe(true);
  });

  test("blocks fe80::/10 link-local", () => {
    expect(isBlockedIp("fe80::1")).toBe(true);
  });

  test("blocks fc00::/7 unique local", () => {
    expect(isBlockedIp("fc00::1")).toBe(true);
    expect(isBlockedIp("fd12:3456::1")).toBe(true);
  });

  test("catches an IPv4-mapped IPv6 address smuggling a blocked IPv4 address", () => {
    expect(isBlockedIp("::ffff:169.254.169.254")).toBe(true);
    expect(isBlockedIp("::ffff:127.0.0.1")).toBe(true);
  });

  test("does not block a real public IPv6 address", () => {
    expect(isBlockedIp("2001:4860:4860::8888")).toBe(false); // Google public DNS
  });
});

describe("assertHostnameAllowed", () => {
  test("blocks localhost (resolves to a loopback address)", async () => {
    await expect(assertHostnameAllowed("localhost")).rejects.toThrow(SsrfBlockedError);
  });

  test("blocks a hostname when injected lookup returns a mix of public and private addresses", async () => {
    const mockLookup: LookupFn = async () => [{ address: "8.8.8.8" }, { address: "10.0.0.5" }];
    await expect(assertHostnameAllowed("evil.example", mockLookup)).rejects.toThrow(SsrfBlockedError);
  });

  test("allows a hostname whose every resolved address is public", async () => {
    const mockLookup: LookupFn = async () => [{ address: "8.8.8.8" }, { address: "1.1.1.1" }];
    await expect(assertHostnameAllowed("good.example", mockLookup)).resolves.toBeUndefined();
  });

  test("wraps a resolution failure as SsrfBlockedError, not a raw DNS error", async () => {
    const failingLookup: LookupFn = async () => {
      throw new Error("ENOTFOUND");
    };
    await expect(assertHostnameAllowed("nonexistent.invalid", failingLookup)).rejects.toThrow(SsrfBlockedError);
  });
});

describe("safeFetch", () => {
  const mockLookup: LookupFn = async (hostname) => {
    if (hostname === "public.example") return [{ address: "8.8.8.8" }];
    if (hostname === "internal.example") return [{ address: "10.0.0.5" }];
    if (hostname === "rebind.example") return [{ address: "169.254.169.254" }];
    return [{ address: "8.8.8.8" }];
  };

  test("fetches directly when the hostname is public and there's no redirect", async () => {
    const mockFetch = async () => new Response("ok", { status: 200 });
    const res = await safeFetch("http://public.example/", mockLookup, mockFetch);
    expect(res.status).toBe(200);
  });

  test("blocks a request to a hostname that resolves to a private address", async () => {
    const mockFetch = async () => new Response("should not be called");
    await expect(safeFetch("http://internal.example/", mockLookup, mockFetch)).rejects.toThrow(SsrfBlockedError);
  });

  test("follows a redirect to a public hostname", async () => {
    let calls = 0;
    const mockFetch = async () => {
      calls++;
      if (calls === 1) {
        return new Response(null, { status: 302, headers: { location: "http://public.example/next" } });
      }
      return new Response("final", { status: 200 });
    };
    const res = await safeFetch("http://public.example/", mockLookup, mockFetch);
    expect(res.status).toBe(200);
    expect(calls).toBe(2);
  });

  test("re-validates on redirect and blocks a redirect to a private/metadata address — the classic same-hostname-then-open-redirect bypass", async () => {
    const mockFetch = async (url: string) => {
      if (url.includes("public.example")) {
        return new Response(null, { status: 302, headers: { location: "http://rebind.example/steal" } });
      }
      return new Response("should never get here");
    };
    await expect(safeFetch("http://public.example/", mockLookup, mockFetch)).rejects.toThrow(SsrfBlockedError);
  });

  test("caps the number of redirects followed", async () => {
    const mockFetch = async () => new Response(null, { status: 302, headers: { location: "http://public.example/loop" } });
    await expect(safeFetch("http://public.example/", mockLookup, mockFetch)).rejects.toThrow(/redirects/);
  });

  test("rejects a non-http(s) protocol outright", async () => {
    const mockFetch = async () => new Response("should not be called");
    await expect(safeFetch("file:///etc/passwd", mockLookup, mockFetch)).rejects.toThrow(SsrfBlockedError);
  });

  test("rejects a redirect to a non-http(s) protocol", async () => {
    const mockFetch = async () => new Response(null, { status: 302, headers: { location: "file:///etc/passwd" } });
    await expect(safeFetch("http://public.example/", mockLookup, mockFetch)).rejects.toThrow(SsrfBlockedError);
  });
});
