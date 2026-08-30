import type { RouteHandler } from "../server.ts";
import { verifyTransformUrl } from "../signing.ts";
import { safeFetch, SsrfBlockedError } from "../ssrf.ts";
import { computeEtag, checkConditionalRequest, withEtag } from "../etag.ts";
import { processImage, isSupportedOutputFormat, type Fit } from "../../image/process.ts";
import { assertRecognizedImageFormat } from "../../image/magicBytes.ts";
import { assertNotDecompressionBomb } from "../../image/bomb.ts";
import { MIME_BY_FORMAT } from "./_shared.ts";

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), { status, headers: { "content-type": "application/json" } });
}

function parseTransformSpec(spec: string): {
  width?: number;
  height?: number;
  fit?: Fit;
  format?: string;
  quality?: number;
  exp?: number;
} {
  const params: Record<string, string> = {};
  for (const pair of spec.split(",")) {
    const idx = pair.indexOf("_");
    if (idx === -1) continue;
    params[pair.slice(0, idx)] = pair.slice(idx + 1);
  }
  return {
    width: params.w ? Number(params.w) : undefined,
    height: params.h ? Number(params.h) : undefined,
    fit: params.fit as Fit | undefined,
    format: params.fmt,
    quality: params.q ? Number(params.q) : undefined,
    exp: params.exp ? Number(params.exp) : undefined,
  };
}

/**
 * GET /t/<signature>/<transform-spec>/<source>
 *
 * The real product shape (spec §16.1) — a single parameterized,
 * cacheable URL, the pattern imgproxy/Thumbor/Cloudinary all converge on,
 * rather than four separate REST verbs. <source> is a URL-encoded remote
 * image URL, fetched through the SSRF guard (src/http/ssrf.ts). Unsigned,
 * mis-signed, or expired requests all get a flat 403 — never a partial
 * response. ETag is checked BEFORE fetching or processing anything, since
 * it only needs the source+transform-spec strings, not the image itself.
 */
export const transformUrlRoute: RouteHandler = async (req, url) => {
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 4) {
    return jsonError(400, "expected path shape /t/<signature>/<transform-spec>/<source>");
  }
  const [, signature, transformSpec, ...sourceParts] = parts;
  const source = decodeURIComponent(sourceParts.join("/"));

  const parsed = parseTransformSpec(transformSpec!);
  if (parsed.exp === undefined || !Number.isFinite(parsed.exp)) {
    return jsonError(400, 'transform spec must include "exp_<unix-seconds>"');
  }
  const format = parsed.format;
  if (!format || !isSupportedOutputFormat(format)) {
    return jsonError(415, `unsupported or missing output format "${format}"`);
  }

  const secret = process.env.KILNFORGE_SIGNING_SECRET;
  if (!secret) {
    return jsonError(500, "server misconfiguration: KILNFORGE_SIGNING_SECRET is not set");
  }

  const verification = await verifyTransformUrl(secret, transformSpec!, source, parsed.exp, signature!);
  if (!verification.valid) {
    return jsonError(403, `invalid transform URL: ${verification.reason}`);
  }

  // ETag before any fetch/decode work — a cache hit costs nothing beyond
  // one hash computation over strings already in hand.
  const etag = await computeEtag(source, transformSpec!);
  const conditional = checkConditionalRequest(req, etag);
  if (conditional) return conditional;

  let sourceBytes: Uint8Array;
  try {
    const res = await safeFetch(source);
    if (!res.ok) return jsonError(502, `source fetch failed with status ${res.status}`);
    sourceBytes = new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    if (err instanceof SsrfBlockedError) return jsonError(403, err.message);
    return jsonError(502, `source fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    assertRecognizedImageFormat(sourceBytes);
    assertNotDecompressionBomb(sourceBytes);
  } catch (err) {
    return jsonError(400, err instanceof Error ? err.message : String(err));
  }

  const out = await processImage(sourceBytes, {
    width: parsed.width,
    height: parsed.height,
    fit: parsed.fit,
    format,
    quality: parsed.quality,
  });

  const response = new Response(out, { headers: { "content-type": MIME_BY_FORMAT[format]! } });
  return withEtag(response, etag);
};
