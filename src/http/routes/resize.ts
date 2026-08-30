import type { RouteHandler } from "../server.ts";
import { readLimitedFormData, readImageField } from "../uploadLimit.ts";
import { processImage, isSupportedOutputFormat } from "../../image/process.ts";
import {
  badRequest,
  MIME_BY_FORMAT,
  parseFit,
  parseIntParam,
  parseQuality,
  resolveDefaultFormat,
  unsupportedFormat,
} from "./_shared.ts";

export const resizeRoute: RouteHandler = async (req) => {
  const url = new URL(req.url);
  let width, height, fit, quality;
  try {
    width = parseIntParam(url, "w");
    height = parseIntParam(url, "h");
    fit = parseFit(url);
    quality = parseQuality(url);
  } catch (err) {
    return badRequest("query", err instanceof Error ? err.message : String(err));
  }

  if (!width && !height) {
    return badRequest("w/h", "at least one of w or h must be provided");
  }

  const formData = await readLimitedFormData(req);
  const bytes = await readImageField(formData, "image");

  const format = url.searchParams.get("format") ?? (await resolveDefaultFormat(bytes));
  if (!isSupportedOutputFormat(format)) return unsupportedFormat(format);

  const out = await processImage(bytes, { width, height, fit, format, quality });
  return new Response(out, { headers: { "content-type": MIME_BY_FORMAT[format]! } });
};
