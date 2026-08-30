export type RouteHandler = (req: Request, url: URL) => Response | Promise<Response>;

export type RouteTable = Map<string, RouteHandler>;

function routeKey(method: string, pathname: string): string {
  return `${method} ${pathname}`;
}

export function createRouteTable(): RouteTable {
  return new Map();
}

export function register(
  table: RouteTable,
  method: string,
  pathname: string,
  handler: RouteHandler,
): void {
  table.set(routeKey(method, pathname), handler);
}

/**
 * Dispatches on exact method+pathname match against the table built by
 * register(). Route params (e.g. the transform-URL path, §16.1) are handled
 * by their own prefix-matching handler registered separately, not by this
 * table — kept out of scope here deliberately, wired in when that route
 * lands.
 */
export async function dispatch(table: RouteTable, req: Request): Promise<Response> {
  const url = new URL(req.url);
  const handler = table.get(routeKey(req.method, url.pathname));
  if (!handler) {
    return new Response(JSON.stringify({ error: "not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }
  try {
    return await handler(req, url);
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }
}

export function createServer(table: RouteTable, port = 3000) {
  return Bun.serve({
    port,
    fetch: (req) => dispatch(table, req),
  });
}
