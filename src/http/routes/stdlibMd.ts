import type { RouteHandler } from "../server.ts";

export const stdlibMdRoute: RouteHandler = () => {
  return new Response(Bun.file("STDLIB.md"), { headers: { "content-type": "text/markdown" } });
};
