import { assertNotArchiveBomb, type ArchiveBombOptions } from "./bomb.ts";

export interface UnpackedEntry {
  name: string;
  data: Uint8Array;
  size: number;
}

export class UnsafeArchiveEntryError extends Error {
  constructor(name: string) {
    super(`archive entry "${name}" has an unsafe path (absolute or traversal) — refusing to process`);
    this.name = "UnsafeArchiveEntryError";
  }
}

/**
 * The Foundation Verification Harness confirmed Bun.Archive.files()
 * returns path-traversal entries (e.g. "../../escape.txt") completely
 * unsanitized — this is where that finding gets enforced: every entry
 * name is validated before it's used for anything beyond this check.
 * In-memory (.files()), not .extract() — this is a request-scoped
 * operation, no reason to touch disk.
 */
function isSafeEntryName(name: string): boolean {
  if (!name || name.length === 0) return false;
  if (name.startsWith("/") || name.startsWith("\\")) return false; // absolute path
  if (/(^|[/\\])\.\.([/\\]|$)/.test(name)) return false; // any ".." path segment
  return true;
}

export async function unpackArchive(bytes: Uint8Array, bombOptions: ArchiveBombOptions = {}): Promise<UnpackedEntry[]> {
  await assertNotArchiveBomb(bytes, bombOptions);

  const archive = new Bun.Archive(bytes);
  const files = await archive.files();

  const entries: UnpackedEntry[] = [];
  for (const [name, file] of files) {
    if (!isSafeEntryName(name)) {
      throw new UnsafeArchiveEntryError(name);
    }
    const data = new Uint8Array(await file.arrayBuffer());
    entries.push({ name, data, size: data.length });
  }
  return entries;
}
