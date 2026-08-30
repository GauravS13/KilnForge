import { transformIdentityHash } from "../image/determinism.ts";

/**
 * The ETag is the hash of (source id + transform spec) only — it never
 * runs the actual transform to answer a conditional request, safe to do
 * because src/image/determinism.ts's tests confirm the pipeline really is
 * deterministic for identical inputs, so the identity hash IS the content
 * identity, not just a proxy for it.
 */
export async function computeEtag(sourceId: string, transformSpec: string): Promise<string> {
  const hash = await transformIdentityHash(sourceId, transformSpec);
  return `"${hash.slice(0, 32)}"`; // quoted per RFC 9110, truncated — still 128 bits, plenty
}

/** Returns a 304 Not Modified response if the request's If-None-Match
 * matches the computed ETag, or null if it doesn't (caller should
 * proceed to actually run the transform and attach the ETag itself). */
export function checkConditionalRequest(req: Request, etag: string): Response | null {
  const ifNoneMatch = req.headers.get("if-none-match");
  if (ifNoneMatch && (ifNoneMatch === etag || ifNoneMatch === "*")) {
    return new Response(null, { status: 304, headers: { etag } });
  }
  return null;
}

export function withEtag(res: Response, etag: string): Response {
  const headers = new Headers(res.headers);
  headers.set("etag", etag);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
