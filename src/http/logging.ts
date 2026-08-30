export interface RequestLogEntry {
  timestamp: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
}

/** One JSON line per request — real stdlib (JSON.stringify + console.log),
 * no logging package. Emits to stdout; a real deployment would pipe this
 * into whatever log aggregation it uses, unchanged. */
export function logRequest(entry: RequestLogEntry): void {
  console.log(JSON.stringify(entry));
}

export function formatLogEntry(
  method: string,
  path: string,
  status: number,
  startedAt: number,
): RequestLogEntry {
  return {
    timestamp: new Date().toISOString(),
    method,
    path,
    status,
    durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
  };
}
