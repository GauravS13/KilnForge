import type { RouteHandler } from "../server.ts";
import { runFoundationHarness, type Capabilities } from "../../verify/capabilities.ts";

let cached: Promise<Capabilities> | null = null;

/** Runs the Foundation Verification Harness once and memoizes the
 * result — the harness does several real Bun.Image/Bun.Archive round
 * trips, not something to repeat on every request to this route. */
function getCapabilities(): Promise<Capabilities> {
  if (!cached) cached = runFoundationHarness();
  return cached;
}

export const capabilitiesRoute: RouteHandler = async () => {
  const capabilities = await getCapabilities();
  return new Response(JSON.stringify(capabilities, null, 2), {
    headers: { "content-type": "application/json" },
  });
};
