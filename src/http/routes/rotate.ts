import type { RouteHandler } from "../server.ts";
import { readLimitedFormData, readImageField } from "../uploadLimit.ts";
import { processImage, isSupportedOutputFormat } from "../../image/process.ts";
import {
  badRequest,
  MIME_BY_FORMAT,
  parseQuality,
  resolveDefaultFormat,
  unsupportedFormat,
} from "./_shared.ts";

export const rotateRoute: RouteHandler = async (req) => {
  const url = new URL(req.url);
  const degRaw = url.searchParams.get("deg");
  if (degRaw === null) return badRequest("deg", "required, e.g. ?deg=90 or ?deg=45");
  const deg = Number(degRaw);
  if (!Number.isFinite(deg)) return badRequest("deg", `must be a number, got "${degRaw}"`);

  let quality;
  try {
    quality = parseQuality(url);
  } catch (err) {
    return badRequest("quality", err instanceof Error ? err.message : String(err));
  }

  const formData = await readLimitedFormData(req);
  const bytes = await readImageField(formData, "image");

  const format = url.searchParams.get("format") ?? (await resolveDefaultFormat(bytes));
  if (!isSupportedOutputFormat(format)) return unsupportedFormat(format);

  const out = await processImage(bytes, { rotateDeg: deg, format, quality });
  return new Response(out, { headers: { "content-type": MIME_BY_FORMAT[format]! } });
};
