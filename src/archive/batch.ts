import { unpackArchive } from "./unpack.ts";
import type { ArchiveBombOptions } from "./bomb.ts";
import { assertRecognizedImageFormat } from "../image/magicBytes.ts";
import { assertNotDecompressionBomb } from "../image/bomb.ts";
import { processImage, type ProcessOptions } from "../image/process.ts";

export interface BatchResult {
  processed: string[];
  skipped: { name: string; reason: string }[];
}

export interface BatchOutput {
  archive: Uint8Array;
  result: BatchResult;
}

/**
 * The cohesion endpoint's core logic — the one operation that only makes
 * sense with BOTH Bun.Image and Bun.Archive present, not two features
 * sharing a port. Unpacks a tarball (through the same bomb guard and
 * unsafe-path check as /archive/unpack), runs the existing image
 * pipeline over every entry that passes magic-byte validation, and
 * re-packs the results into a new archive. Non-image entries — or images
 * that individually fail their own decompression-bomb check — are
 * skipped and reported, never fatal to the whole batch.
 */
export async function batchProcess(
  archiveBytes: Uint8Array,
  transformOptions: ProcessOptions,
  bombOptions: ArchiveBombOptions = {},
): Promise<BatchOutput> {
  const entries = await unpackArchive(archiveBytes, bombOptions);

  const outputFiles: Record<string, Uint8Array> = {};
  const processed: string[] = [];
  const skipped: { name: string; reason: string }[] = [];

  for (const entry of entries) {
    try {
      assertRecognizedImageFormat(entry.data);
    } catch {
      skipped.push({ name: entry.name, reason: "not a recognized image format" });
      continue;
    }

    try {
      assertNotDecompressionBomb(entry.data);
    } catch (err) {
      skipped.push({ name: entry.name, reason: err instanceof Error ? err.message : String(err) });
      continue;
    }

    try {
      const out = await processImage(entry.data, transformOptions);
      const baseName = entry.name.replace(/\.[^./]+$/, "");
      const outputName = `${baseName}.${transformOptions.format}`;
      outputFiles[outputName] = out;
      processed.push(entry.name);
    } catch (err) {
      skipped.push({ name: entry.name, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  const outputArchive = new Bun.Archive(outputFiles);
  return { archive: await outputArchive.bytes(), result: { processed, skipped } };
}
