import { createRouteTable, createServer, register, type RouteHandler } from "../server.ts";
import { encodePng } from "../../image/png.ts";

/** Test-only helper: spins up a real Bun.serve instance on an
 * auto-assigned port with a single route registered, for genuine
 * request/response-cycle testing rather than calling handlers in
 * isolation. Every route test in this directory exercises the real HTTP
 * stack (multipart parsing, streaming upload limits, status codes),
 * not just the handler function directly. */
export function startTestServer(method: string, path: string, handler: RouteHandler) {
  const table = createRouteTable();
  register(table, method, path, handler);
  const server = createServer(table, 0);
  return {
    url: `http://localhost:${server.port}${path}`,
    stop: () => server.stop(true),
  };
}

export function makeTestImagePng(width = 4, height = 4): Uint8Array {
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4] = (i * 47) % 256;
    pixels[i * 4 + 1] = (i * 89) % 256;
    pixels[i * 4 + 2] = (i * 131) % 256;
    pixels[i * 4 + 3] = 255;
  }
  return encodePng({ width, height, pixels });
}

export function imageFormData(fieldName: string, bytes: Uint8Array, filename = "test.png"): FormData {
  const fd = new FormData();
  fd.set(fieldName, new Blob([bytes]), filename);
  return fd;
}
