import { createRouteTable, createServer, register, registerPrefix } from "./src/http/server.ts";
import { resizeRoute } from "./src/http/routes/resize.ts";
import { rotateRoute } from "./src/http/routes/rotate.ts";
import { convertRoute } from "./src/http/routes/convert.ts";
import { watermarkRoute } from "./src/http/routes/watermark.ts";
import { srcsetRoute } from "./src/http/routes/srcset.ts";
import { transformUrlRoute } from "./src/http/routes/transformUrl.ts";
import { capabilitiesRoute } from "./src/http/routes/capabilities.ts";
import { metricsRoute } from "./src/http/routes/metrics.ts";
import { archivePackRoute } from "./src/http/routes/archivePack.ts";
import { archiveUnpackRoute } from "./src/http/routes/archiveUnpack.ts";
import { batchRoute } from "./src/http/routes/batch.ts";
import { buildProofJsonRoute } from "./src/http/routes/buildProofJson.ts";
import { stdlibMdRoute } from "./src/http/routes/stdlibMd.ts";
import { demoPageRoute } from "./src/http/demoPage.ts";
import { TokenBucketRateLimiter } from "./src/http/rateLimit.ts";
import { registerGracefulShutdown } from "./src/http/shutdown.ts";

const routes = createRouteTable();
register(routes, "POST", "/resize", resizeRoute);
register(routes, "POST", "/rotate", rotateRoute);
register(routes, "POST", "/convert", convertRoute);
register(routes, "POST", "/watermark", watermarkRoute);
register(routes, "POST", "/srcset", srcsetRoute);
register(routes, "GET", "/capabilities", capabilitiesRoute);
register(routes, "GET", "/metrics", metricsRoute);
register(routes, "POST", "/archive/pack", archivePackRoute);
register(routes, "POST", "/archive/unpack", archiveUnpackRoute);
register(routes, "POST", "/batch", batchRoute);
register(routes, "GET", "/build-proof.json", buildProofJsonRoute);
register(routes, "GET", "/stdlib.md", stdlibMdRoute);
register(routes, "GET", "/", demoPageRoute);
registerPrefix(routes, "GET", "/t/", transformUrlRoute);

const rateLimiter = new TokenBucketRateLimiter({
  capacity: Number(process.env.RATE_LIMIT_CAPACITY ?? 60),
  refillPerSecond: Number(process.env.RATE_LIMIT_REFILL_PER_SECOND ?? 1),
});

if (import.meta.main) {
  const server = createServer(routes, Number(process.env.PORT ?? 3000), { rateLimiter });
  registerGracefulShutdown(server);
  console.log(`kilnforge listening on http://localhost:${server.port}`);
}

export { routes };
