import { handlePreflight, withCors, type CorsOptions } from "./cors.ts";
import { TokenBucketRateLimiter, rateLimitKeyFor } from "./rateLimit.ts";
import { logRequest, formatLogEntry } from "./logging.ts";
import { metricsRegistry } from "../metrics/counters.ts";

export type RouteHandler = (req: Request, url: URL) => Response | Promise<Response>;

export interface PrefixRouteHandler {
  method: string;
  prefix: string;
  handler: RouteHandler;
}

export interface RouteTable {
  exact: Map<string, RouteHandler>;
  prefixes: PrefixRouteHandler[];
}

function routeKey(method: string, pathname: string): string {
  return `${method} ${pathname}`;
}

export function createRouteTable(): RouteTable {
  return { exact: new Map(), prefixes: [] };
}

export function register(table: RouteTable, method: string, pathname: string, handler: RouteHandler): void {
  table.exact.set(routeKey(method, pathname), handler);
}

/** For routes with a path parameter (e.g. the signed transform-URL path,
 * §16.1) — matched by pathname prefix rather than exact string. */
export function registerPrefix(table: RouteTable, method: string, prefix: string, handler: RouteHandler): void {
  table.prefixes.push({ method, prefix, handler });
}

function findHandler(table: RouteTable, method: string, pathname: string): RouteHandler | null {
  const exact = table.exact.get(routeKey(method, pathname));
  if (exact) return exact;
  for (const p of table.prefixes) {
    if (p.method === method && pathname.startsWith(p.prefix)) return p.handler;
  }
  return null;
}

const STATUS_BY_ERROR_NAME: Record<string, number> = {
  UploadTooLargeError: 413,
  DecompressionBombError: 413,
  UnrecognizedImageFormatError: 400,
  SsrfBlockedError: 403,
  ArchiveBombError: 413,
  UnsafeArchiveEntryError: 400,
};

function statusForError(err: unknown): number {
  if (err instanceof Error && err.name in STATUS_BY_ERROR_NAME) {
    return STATUS_BY_ERROR_NAME[err.name]!;
  }
  return 400;
}

export interface DispatchOptions {
  cors?: CorsOptions;
  rateLimiter?: TokenBucketRateLimiter;
  server?: { requestIP(req: Request): { address: string } | null };
}

export async function dispatch(table: RouteTable, req: Request, options: DispatchOptions = {}): Promise<Response> {
  const startedAt = performance.now();
  const url = new URL(req.url);

  const preflight = handlePreflight(req, options.cors);
  if (preflight) return preflight;

  if (options.rateLimiter && options.server) {
    const key = rateLimitKeyFor(req, options.server);
    if (!options.rateLimiter.tryConsume(key)) {
      const res = new Response(JSON.stringify({ error: "rate limit exceeded" }), {
        status: 429,
        headers: { "content-type": "application/json" },
      });
      finish(req, url, res, startedAt);
      return withCors(res, req, options.cors);
    }
  }

  const handler = findHandler(table, req.method, url.pathname);
  if (!handler) {
    const res = new Response(JSON.stringify({ error: "not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
    finish(req, url, res, startedAt);
    return withCors(res, req, options.cors);
  }

  let res: Response;
  try {
    res = await handler(req, url);
  } catch (err) {
    res = new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: statusForError(err),
      headers: { "content-type": "application/json" },
    });
  }

  finish(req, url, res, startedAt);
  return withCors(res, req, options.cors);
}

function finish(req: Request, url: URL, res: Response, startedAt: number): void {
  const durationMs = performance.now() - startedAt;
  logRequest(formatLogEntry(req.method, url.pathname, res.status, startedAt));
  metricsRegistry.record(url.pathname, durationMs, res.status >= 400);
}

export function createServer(table: RouteTable, port = 3000, options: Omit<DispatchOptions, "server"> = {}) {
  const server = Bun.serve({
    port,
    fetch: (req, srv) => dispatch(table, req, { ...options, server: srv }),
  });
  return server;
}
