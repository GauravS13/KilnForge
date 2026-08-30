import type { RouteHandler } from "../server.ts";
import { metricsRegistry } from "../../metrics/counters.ts";

export const metricsRoute: RouteHandler = (req, url) => {
  const wantsPrometheus =
    url.searchParams.get("format") === "prometheus" ||
    (req.headers.get("accept")?.includes("text/plain") ?? false);

  if (wantsPrometheus) {
    return new Response(metricsRegistry.toPrometheusText(), {
      headers: { "content-type": "text/plain; version=0.0.4" },
    });
  }

  return new Response(JSON.stringify(metricsRegistry.snapshot(), null, 2), {
    headers: { "content-type": "application/json" },
  });
};
