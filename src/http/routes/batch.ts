import type { RouteHandler } from "../server.ts";
import { readLimitedFormData } from "../uploadLimit.ts";
import { batchProcess } from "../../archive/batch.ts";
import { isSupportedOutputFormat } from "../../image/process.ts";
import { badRequest, parseFit, parseIntParam, parseQuality, readArchiveField, unsupportedFormat } from "./_shared.ts";

/**
 * POST /batch — the one endpoint that only makes sense with both
 * Bun.Image and Bun.Archive present. Upload a tarball of images plus a
 * transform spec, get back a tarball of results. Per-entry failures
 * (non-image, individually bomb-flagged) are reported in the
 * X-Batch-Summary response header as JSON, not fatal to the whole batch.
 */
export const batchRoute: RouteHandler = async (req, url) => {
  const format = url.searchParams.get("format");
  if (!format) return badRequest("format", "required — one of jpeg|png|webp|avif|heic");
  if (!isSupportedOutputFormat(format)) return unsupportedFormat(format);

  let width, height, fit, quality;
  try {
    width = parseIntParam(url, "w");
    height = parseIntParam(url, "h");
    fit = parseFit(url);
    quality = parseQuality(url);
  } catch (err) {
    return badRequest("query", err instanceof Error ? err.message : String(err));
  }

  const formData = await readLimitedFormData(req);
  const archiveBytes = await readArchiveField(formData);

  const { archive, result } = await batchProcess(archiveBytes, { width, height, fit, format, quality });

  return new Response(archive, {
    headers: {
      "content-type": "application/x-tar",
      "x-batch-summary": JSON.stringify(result),
    },
  });
};
