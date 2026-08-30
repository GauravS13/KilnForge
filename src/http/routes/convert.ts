import type { RouteHandler } from "../server.ts";
import { readLimitedFormData, readImageField } from "../uploadLimit.ts";
import { processImage, isSupportedOutputFormat } from "../../image/process.ts";
import { badRequest, MIME_BY_FORMAT, parseQuality, unsupportedFormat } from "./_shared.ts";

export const convertRoute: RouteHandler = async (req) => {
  const url = new URL(req.url);
  const format = url.searchParams.get("format");
  if (!format) {
    return badRequest("format", "required — one of jpeg|png|webp|avif|heic");
  }
  if (!isSupportedOutputFormat(format)) return unsupportedFormat(format);

  let quality;
  try {
    quality = parseQuality(url);
  } catch (err) {
    return badRequest("quality", err instanceof Error ? err.message : String(err));
  }

  const formData = await readLimitedFormData(req);
  const bytes = await readImageField(formData, "image");

  const out = await processImage(bytes, { format, quality });
  return new Response(out, { headers: { "content-type": MIME_BY_FORMAT[format]! } });
};
