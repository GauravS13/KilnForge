import type { RouteHandler } from "../server.ts";
import { readLimitedFormData } from "../uploadLimit.ts";
import { unpackArchive } from "../../archive/unpack.ts";
import { badRequest } from "./_shared.ts";

async function readArchiveField(formData: FormData): Promise<Uint8Array> {
  const file = formData.get("archive");
  if (!(file instanceof File)) {
    throw new Error('missing or invalid "archive" field — expected a file upload');
  }
  return new Uint8Array(await file.arrayBuffer());
}

/**
 * Default: JSON listing of every entry (name + size), archive-bomb-
 * guarded and path-traversal-validated (src/archive/unpack.ts). With
 * ?extract=<name>, returns that one entry's raw bytes instead — still
 * in-memory only, never writes to disk.
 */
export const archiveUnpackRoute: RouteHandler = async (req, url) => {
  const formData = await readLimitedFormData(req);
  const bytes = await readArchiveField(formData);
  const entries = await unpackArchive(bytes);

  const extractName = url.searchParams.get("extract");
  if (extractName !== null) {
    const entry = entries.find((e) => e.name === extractName);
    if (!entry) return badRequest("extract", `no entry named "${extractName}" in the archive`);
    return new Response(entry.data, { headers: { "content-type": "application/octet-stream" } });
  }

  const listing = entries.map((e) => ({ name: e.name, size: e.size }));
  return new Response(JSON.stringify({ entries: listing }), {
    headers: { "content-type": "application/json" },
  });
};
