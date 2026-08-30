import zlib from "node:zlib";

/**
 * Archive-bomb defense — the same "reject before the expensive operation
 * completes" discipline as src/image/bomb.ts, extended to the different
 * shape of risk an archive presents: total uncompressed size, entry
 * count, and per-file size, all checked before any entry's contents are
 * materialized via Bun.Archive.
 *
 * Real, confirmed via inspection: Bun.Archive produces standard POSIX
 * ustar tar (512-byte header blocks, "ustar\0" magic at offset 257,
 * octal size field at offset 124), optionally gzip-wrapped. This module
 * parses that header structure directly, the same way bomb.ts parses
 * PNG/JPEG/etc. headers directly, rather than trusting `.files()` (which
 * the Foundation Verification Harness already found doesn't sanitize
 * even path-traversal entries — no reason to trust it for size either).
 *
 * HONEST LIMITATION: for a gzip-compressed archive, there's no header to
 * peek at without decompressing — the classic zip-bomb attack IS the
 * decompression itself, achieved via an extreme compression ratio.
 * There's no way to fully avoid that cost while still validating; what
 * this does instead is decompress through a byte-counted stream that
 * aborts the moment output exceeds the cap, so a bomb is caught as soon
 * as it crosses the limit rather than after fully expanding. That
 * decompressed copy is then discarded — Bun.Archive still decompresses
 * again internally when the (now-validated) original bytes are handed to
 * it. Redundant work, but the accepted cost of validating something
 * before trusting it with an expensive operation.
 */

export const DEFAULT_MAX_TOTAL_BYTES = 200 * 1024 * 1024; // 200MB
export const DEFAULT_MAX_ENTRY_COUNT = 10_000;
export const DEFAULT_MAX_ENTRY_BYTES = 100 * 1024 * 1024; // 100MB

export class ArchiveBombError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArchiveBombError";
  }
}

export interface ArchiveBombOptions {
  maxTotalBytes?: number;
  maxEntryCount?: number;
  maxEntryBytes?: number;
}

function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

function decompressGzipWithCap(bytes: Uint8Array, maxBytes: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const gunzip = zlib.createGunzip();
    const chunks: Buffer[] = [];
    let total = 0;
    let capExceeded = false;

    gunzip.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        capExceeded = true;
        gunzip.destroy();
        return;
      }
      chunks.push(chunk);
    });
    gunzip.on("error", (err) => {
      if (!capExceeded) reject(err);
    });
    gunzip.on("close", () => {
      if (capExceeded) {
        reject(new ArchiveBombError(`decompressed archive exceeds the ${maxBytes}-byte cap`));
      } else {
        resolve(new Uint8Array(Buffer.concat(chunks)));
      }
    });
    gunzip.end(bytes);
  });
}

export interface TarEntry {
  name: string;
  size: number;
}

/** Walks 512-byte ustar header blocks directly — no decompression
 * needed for an already-uncompressed tar stream. Stops at the first
 * all-zero block (the standard tar end-of-archive marker). */
export function parseTarHeaders(bytes: Uint8Array): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;

  while (offset + 512 <= bytes.length) {
    const block = bytes.subarray(offset, offset + 512);

    let allZero = true;
    for (let i = 0; i < 512; i++) {
      if (block[i] !== 0) {
        allZero = false;
        break;
      }
    }
    if (allZero) break;

    const nameRaw = new TextDecoder().decode(block.subarray(0, 100));
    const name = nameRaw.slice(0, nameRaw.indexOf("\0") === -1 ? undefined : nameRaw.indexOf("\0"));

    const sizeRaw = new TextDecoder().decode(block.subarray(124, 136)).replace(/\0/g, "").trim();
    const size = sizeRaw ? parseInt(sizeRaw, 8) : 0;
    if (!Number.isFinite(size) || size < 0) {
      throw new Error(`malformed tar header at offset ${offset}: unreadable size field`);
    }

    entries.push({ name, size });

    const dataBlocks = Math.ceil(size / 512);
    offset += 512 + dataBlocks * 512;
  }

  return entries;
}

export async function assertNotArchiveBomb(bytes: Uint8Array, options: ArchiveBombOptions = {}): Promise<void> {
  const maxTotal = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  const maxEntries = options.maxEntryCount ?? DEFAULT_MAX_ENTRY_COUNT;
  const maxEntryBytes = options.maxEntryBytes ?? DEFAULT_MAX_ENTRY_BYTES;

  let tarBytes: Uint8Array;
  if (isGzip(bytes)) {
    tarBytes = await decompressGzipWithCap(bytes, maxTotal);
  } else {
    if (bytes.length > maxTotal) {
      throw new ArchiveBombError(`archive size ${bytes.length} exceeds the ${maxTotal}-byte cap`);
    }
    tarBytes = bytes;
  }

  const entries = parseTarHeaders(tarBytes);
  if (entries.length > maxEntries) {
    throw new ArchiveBombError(`entry count ${entries.length} exceeds the ${maxEntries}-entry cap`);
  }

  let total = 0;
  for (const entry of entries) {
    if (entry.size > maxEntryBytes) {
      throw new ArchiveBombError(
        `entry "${entry.name}" (${entry.size} bytes) exceeds the ${maxEntryBytes}-byte per-file cap`,
      );
    }
    total += entry.size;
  }
  if (total > maxTotal) {
    throw new ArchiveBombError(`total entry size ${total} exceeds the ${maxTotal}-byte cap`);
  }
}
