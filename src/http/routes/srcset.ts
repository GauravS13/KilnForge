import type { RouteHandler } from "../server.ts";
import { readLimitedFormData, readAndValidateImageField } from "../uploadLimit.ts";
import { processImage, isSupportedOutputFormat } from "../../image/process.ts";
import { badRequest, resolveDefaultFormat, unsupportedFormat, parseQuality } from "./_shared.ts";

const MAX_VARIANTS = 10;

function parseWidths(url: URL): number[] {
  const raw = url.searchParams.get("widths");
  if (!raw) throw new Error('"widths" is required, e.g. ?widths=320,640,1024');
  const widths = raw.split(",").map((s) => Number(s.trim()));
  if (widths.some((w) => !Number.isFinite(w) || !Number.isInteger(w) || w <= 0)) {
    throw new Error(`"widths" must be a comma-separated list of positive integers, got "${raw}"`);
  }
  if (widths.length === 0) throw new Error('"widths" must contain at least one value');
  if (widths.length > MAX_VARIANTS) {
    throw new Error(`"widths" accepts at most ${MAX_VARIANTS} values, got ${widths.length}`);
  }
  return widths;
}

/**
 * One request, N width variants — the actual most common real-world use
 * of sharp (build-time responsive image pipelines), and genuinely beyond
 * sharp's own scope (sharp requires the caller to loop and call it N
 * times). Response is JSON with each variant base64-encoded, keyed by
 * width — simplest format any HTTP client can consume without
 * multipart-parsing support.
 */
export const srcsetRoute: RouteHandler = async (req) => {
  const url = new URL(req.url);
  let widths: number[];
  let quality: number | undefined;
  try {
    widths = parseWidths(url);
    quality = parseQuality(url);
  } catch (err) {
    return badRequest("query", err instanceof Error ? err.message : String(err));
  }

  const formData = await readLimitedFormData(req);
  const bytes = await readAndValidateImageField(formData, "image");

  const format = url.searchParams.get("format") ?? (await resolveDefaultFormat(bytes));
  if (!isSupportedOutputFormat(format)) return unsupportedFormat(format);

  const variants: Record<string, { width: number; base64: string; bytes: number }> = {};
  for (const width of widths) {
    const out = await processImage(bytes, { width, fit: "contain", format, quality });
    variants[String(width)] = { width, base64: Buffer.from(out).toString("base64"), bytes: out.length };
  }

  return new Response(JSON.stringify({ format, variants }), {
    headers: { "content-type": "application/json" },
  });
};
