import { describe, expect, test } from "bun:test";
import { computeEtag, checkConditionalRequest, withEtag } from "./etag.ts";

describe("computeEtag", () => {
  test("is deterministic for the same inputs", async () => {
    const a = await computeEtag("img1", "w=100");
    const b = await computeEtag("img1", "w=100");
    expect(a).toBe(b);
  });

  test("is quoted per RFC 9110", async () => {
    const etag = await computeEtag("img1", "w=100");
    expect(etag.startsWith('"')).toBe(true);
    expect(etag.endsWith('"')).toBe(true);
  });

  test("differs for different transform specs", async () => {
    const a = await computeEtag("img1", "w=100");
    const b = await computeEtag("img1", "w=200");
    expect(a).not.toBe(b);
  });
});

describe("checkConditionalRequest", () => {
  test("returns a 304 when If-None-Match exactly matches", async () => {
    const etag = await computeEtag("img1", "w=100");
    const req = new Request("http://x/", { headers: { "if-none-match": etag } });
    const res = checkConditionalRequest(req, etag);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(304);
    expect(res!.headers.get("etag")).toBe(etag);
  });

  test("returns a 304 for a wildcard If-None-Match", async () => {
    const etag = await computeEtag("img1", "w=100");
    const req = new Request("http://x/", { headers: { "if-none-match": "*" } });
    expect(checkConditionalRequest(req, etag)).not.toBeNull();
  });

  test("returns null when If-None-Match does not match", async () => {
    const etag = await computeEtag("img1", "w=100");
    const req = new Request("http://x/", { headers: { "if-none-match": '"something-else"' } });
    expect(checkConditionalRequest(req, etag)).toBeNull();
  });

  test("returns null when there is no If-None-Match header at all", async () => {
    const etag = await computeEtag("img1", "w=100");
    const req = new Request("http://x/");
    expect(checkConditionalRequest(req, etag)).toBeNull();
  });
});

describe("withEtag", () => {
  test("attaches the etag header to a response", () => {
    const res = withEtag(new Response("body"), '"abc123"');
    expect(res.headers.get("etag")).toBe('"abc123"');
  });
});
