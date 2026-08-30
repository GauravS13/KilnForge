export interface ArchiveEntry {
  name: string;
  data: Uint8Array;
}

export interface PackOptions {
  compress?: "gzip";
}

export async function packArchive(entries: ArchiveEntry[], options: PackOptions = {}): Promise<Uint8Array> {
  const fileMap: Record<string, Uint8Array> = {};
  for (const entry of entries) fileMap[entry.name] = entry.data;
  const archive = options.compress
    ? new Bun.Archive(fileMap, { compress: options.compress })
    : new Bun.Archive(fileMap);
  return await archive.bytes();
}
