import { logRequest } from "./logging.ts";

export interface StoppableServer {
  stop: (closeActiveConnections?: boolean) => unknown;
}

/**
 * Registers SIGTERM/SIGINT handlers that call server.stop() with no
 * argument — confirmed by direct test (not assumed) that this stops
 * accepting new connections while letting in-flight requests complete
 * normally, rather than server.stop(true), which force-closes everything
 * immediately. Idempotent: a second signal while already shutting down is
 * a no-op, not a second drain attempt.
 */
export function registerGracefulShutdown(server: StoppableServer): void {
  let shuttingDown = false;

  const handleSignal = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logRequest({
      timestamp: new Date().toISOString(),
      method: "SHUTDOWN",
      path: signal,
      status: 0,
      durationMs: 0,
    });
    server.stop(); // graceful — no argument, confirmed via direct test
  };

  process.on("SIGTERM", () => handleSignal("SIGTERM"));
  process.on("SIGINT", () => handleSignal("SIGINT"));
}
