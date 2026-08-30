import { isSupportedOutputFormat, type Fit } from "../../image/process.ts";
import { loadImage } from "../../image/loadImage.ts";

export const MIME_BY_FORMAT: Record<string, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
  heic: "image/heic",
};

export function badRequest(field: string, detail: string): Response {
  return new Response(JSON.stringify({ error: `invalid "${field}"`, detail }), {
    status: 400,
    headers: { "content-type": "application/json" },
  });
}

export function unsupportedFormat(format: string): Response {
  return new Response(JSON.stringify({ error: `unsupported output format "${format}"` }), {
    status: 415,
    headers: { "content-type": "application/json" },
  });
}

/** Picks a default output format when the caller didn't ask for one
 * explicitly: whatever the input's own format is, if it's one of the five
 * real Bun.Image encode targets — otherwise (a decode-only input format
 * like BMP or GIF, which can't be re-encoded) falls back to PNG. */
export async function resolveDefaultFormat(bytes: Uint8Array): Promise<string> {
  try {
    const meta = await loadImage(bytes).metadata();
    if (isSupportedOutputFormat(meta.format)) return meta.format;
  } catch {
    // fall through
  }
  return "png";
}

export function parseIntParam(url: URL, name: string): number | undefined {
  const raw = url.searchParams.get(name);
  if (raw === null) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new Error(`"${name}" must be a positive integer, got "${raw}"`);
  }
  return n;
}

export function parseFit(url: URL): Fit | undefined {
  const raw = url.searchParams.get("fit");
  if (raw === null) return undefined;
  if (raw !== "cover" && raw !== "contain" && raw !== "fill") {
    throw new Error(`"fit" must be one of cover|contain|fill, got "${raw}"`);
  }
  return raw;
}

export function parseQuality(url: URL): number | undefined {
  const raw = url.searchParams.get("quality");
  if (raw === null) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1 || n > 100) {
    throw new Error(`"quality" must be a number between 1 and 100, got "${raw}"`);
  }
  return n;
}

// NOTE: this module deliberately does NOT auto-apply EXIF orientation
// before handing bytes to Bun.Image. Empirical testing (see
// src/image/exif.ts's module comment) found Bun.Image already applies
// EXIF orientation correction internally during decode — confirmed via
// metadata() reporting swapped dimensions immediately and 0 pixel
// mismatches against a manual native .rotate(90) on the same source.
// Calling our own applyOrientation() on top of that would double-rotate
// every EXIF-tagged upload. src/image/exif.ts's readExifOrientation() and
// applyOrientation() are kept as real, tested, standalone utilities (and
// as a documented correction to the original spec's assumption) but are
// not wired into this request pipeline.
