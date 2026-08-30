export interface CorsOptions {
  /** Explicit allowlist. Omit/empty to allow any origin (a public,
   * unauthenticated image-processing API — permissive by default is the
   * right call here since there's no session/credential to leak; pass an
   * explicit list to lock it down). */
  allowedOrigins?: string[];
}

function resolveAllowOrigin(req: Request, options: CorsOptions): string | null {
  const origin = req.headers.get("origin");
  if (!options.allowedOrigins || options.allowedOrigins.length === 0) return "*";
  if (origin && options.allowedOrigins.includes(origin)) return origin;
  return null;
}

export function corsHeaders(req: Request, options: CorsOptions = {}): Record<string, string> {
  const allowOrigin = resolveAllowOrigin(req, options);
  const headers: Record<string, string> = {
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  };
  if (allowOrigin) headers["access-control-allow-origin"] = allowOrigin;
  return headers;
}

/** Returns a 204 preflight response for an OPTIONS request, or null if
 * the request isn't a preflight — callers check for null and continue
 * to their normal handler. */
export function handlePreflight(req: Request, options: CorsOptions = {}): Response | null {
  if (req.method !== "OPTIONS") return null;
  return new Response(null, { status: 204, headers: corsHeaders(req, options) });
}

export function withCors(res: Response, req: Request, options: CorsOptions = {}): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders(req, options))) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
