import type { RouteHandler } from "../server.ts";
import { readLimitedFormData } from "../uploadLimit.ts";
import { packArchive } from "../../archive/pack.ts";
import { badRequest } from "./_shared.ts";

export const archivePackRoute: RouteHandler = async (req, url) => {
  const compress = url.searchParams.get("compress");
  if (compress !== null && compress !== "gzip") {
    return badRequest("compress", `must be "gzip" if provided, got "${compress}"`);
  }

  const formData = await readLimitedFormData(req);
  const files = formData.getAll("files");
  if (files.length === 0) {
    return badRequest("files", "at least one file is required under the \"files\" field");
  }

  const entries = [];
  for (const f of files) {
    if (!(f instanceof File)) continue;
    entries.push({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) });
  }
  if (entries.length === 0) {
    return badRequest("files", "no valid file entries found");
  }

  const archiveBytes = await packArchive(entries, compress === "gzip" ? { compress: "gzip" } : {});
  return new Response(archiveBytes, {
    headers: { "content-type": "application/x-tar" },
  });
};
