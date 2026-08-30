import type { RouteHandler } from "../server.ts";
import { readLimitedFormData, readImageField } from "../uploadLimit.ts";
import { loadImage } from "../../image/loadImage.ts";
import { toRGBA, fromRGBA } from "../../image/rawPixel.ts";
import { compositeWatermark, type Position } from "../../image/watermark.ts";
import { rasterizeText } from "../../image/font.ts";
import { processImage, isSupportedOutputFormat } from "../../image/process.ts";
import {
  badRequest,
  MIME_BY_FORMAT,
  parseQuality,
  resolveDefaultFormat,
  unsupportedFormat,
} from "./_shared.ts";

const POSITIONS: readonly Position[] = ["tl", "tr", "bl", "br", "center"];

function parsePosition(url: URL): Position | undefined {
  const raw = url.searchParams.get("position");
  if (raw === null) return undefined;
  if (!(POSITIONS as readonly string[]).includes(raw)) {
    throw new Error(`"position" must be one of ${POSITIONS.join("|")}, got "${raw}"`);
  }
  return raw as Position;
}

function parseOpacity(url: URL): number | undefined {
  const raw = url.searchParams.get("opacity");
  if (raw === null) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    throw new Error(`"opacity" must be a number between 0 and 1, got "${raw}"`);
  }
  return n;
}

function parseColor(url: URL): [number, number, number] {
  const raw = url.searchParams.get("color");
  if (!raw) return [255, 255, 255];
  const hexMatch = /^#?([0-9a-fA-F]{6})$/.exec(raw);
  if (hexMatch) {
    const hex = hexMatch[1]!;
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  }
  const parts = raw.split(",").map(Number);
  if (parts.length === 3 && parts.every((n) => Number.isFinite(n) && n >= 0 && n <= 255)) {
    return parts as [number, number, number];
  }
  throw new Error(`"color" must be #RRGGBB or "r,g,b", got "${raw}"`);
}

export const watermarkRoute: RouteHandler = async (req) => {
  const url = new URL(req.url);
  let position, opacity, color;
  try {
    position = parsePosition(url);
    opacity = parseOpacity(url);
    color = parseColor(url);
  } catch (err) {
    return badRequest("query", err instanceof Error ? err.message : String(err));
  }

  const x = url.searchParams.has("x") ? Number(url.searchParams.get("x")) : undefined;
  const y = url.searchParams.has("y") ? Number(url.searchParams.get("y")) : undefined;

  const text = url.searchParams.get("text");
  const scaleRaw = url.searchParams.get("scale");
  const scale = scaleRaw !== null ? Number(scaleRaw) : 1;
  if (!Number.isFinite(scale) || scale <= 0) return badRequest("scale", `must be a positive number, got "${scaleRaw}"`);

  const formData = await readLimitedFormData(req);
  const baseBytes = await readImageField(formData, "image");
  const baseRgba = await toRGBA(loadImage(baseBytes));

  const markRgba = text
    ? rasterizeText(text, { color, scale })
    : await toRGBA(loadImage(await readImageField(formData, "logo")));

  const composited = compositeWatermark(baseRgba, markRgba, { position, x, y, opacity });
  const compositeBytes = fromRGBA(composited);

  const format = url.searchParams.get("format") ?? (await resolveDefaultFormat(baseBytes));
  if (!isSupportedOutputFormat(format)) return unsupportedFormat(format);

  let quality;
  try {
    quality = parseQuality(url);
  } catch (err) {
    return badRequest("quality", err instanceof Error ? err.message : String(err));
  }

  const out = await processImage(compositeBytes, { format, quality });
  return new Response(out, { headers: { "content-type": MIME_BY_FORMAT[format]! } });
};
