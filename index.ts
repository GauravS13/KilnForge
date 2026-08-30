import { createRouteTable, createServer, register } from "./src/http/server.ts";
import { resizeRoute } from "./src/http/routes/resize.ts";
import { rotateRoute } from "./src/http/routes/rotate.ts";
import { convertRoute } from "./src/http/routes/convert.ts";
import { watermarkRoute } from "./src/http/routes/watermark.ts";

const routes = createRouteTable();
register(routes, "POST", "/resize", resizeRoute);
register(routes, "POST", "/rotate", rotateRoute);
register(routes, "POST", "/convert", convertRoute);
register(routes, "POST", "/watermark", watermarkRoute);

if (import.meta.main) {
  const server = createServer(routes, Number(process.env.PORT ?? 3000));
  console.log(`kilnforge listening on http://localhost:${server.port}`);
}

export { routes };
