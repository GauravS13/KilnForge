import { createRouteTable, createServer } from "./src/http/server.ts";

const routes = createRouteTable();

// Routes are registered here as each phase lands — empty table today,
// every request gets a clean 404 rather than a crash.

if (import.meta.main) {
  const server = createServer(routes, Number(process.env.PORT ?? 3000));
  console.log(`kilnforge listening on http://localhost:${server.port}`);
}

export { routes };
