#!/usr/bin/env bun
/**
 * Generates golden-corpus reference outputs using sharp (image side) and
 * tar (archive side) as oracles — the exact packages this project
 * replaces. Runs at fixture-build time only; sharp/tar are devDependencies
 * imported here and in scripts/bench-*.ts, never by src/** or index.ts
 * (enforced by scripts/deps-proof.ts, which only scans those paths).
 *
 * This is the differential-testing pattern named directly in the
 * cross-source hackathon ranking as the single highest-leverage move
 * available: differential-test against the thing you replace.
 */
import sharp from "sharp";
import * as tar from "tar";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const REFERENCE_DIR = "fixtures/reference";
mkdirSync(`${REFERENCE_DIR}/images`, { recursive: true });
mkdirSync(`${REFERENCE_DIR}/archives`, { recursive: true });

function sha256(buf: Buffer | Uint8Array): string {
  return createHash("sha256").update(buf).digest("hex");
}

interface ImageCase {
  name: string;
  source: string; // fixtures/images/<source>
  op: (img: sharp.Sharp) => sharp.Sharp;
}

const IMAGE_CASES: ImageCase[] = [
  { name: "resize-medium-to-20x20-fill", source: "medium-64x48.png", op: (i) => i.resize(20, 20, { fit: "fill" }) },
  { name: "resize-medium-to-20-contain", source: "medium-64x48.png", op: (i) => i.resize(20, null, { fit: "inside" }) },
  { name: "resize-large-to-cover-30x30", source: "large-256x256.png", op: (i) => i.resize(30, 30, { fit: "cover" }) },
  { name: "convert-photo-to-webp", source: "photo-48x48.jpg", op: (i) => i.webp({ quality: 85 }) },
  { name: "convert-alpha-to-png", source: "alpha-32x32.png", op: (i) => i.png() },
  { name: "rotate90-portrait", source: "portrait-20x40.png", op: (i) => i.rotate(90) },
];

const hashManifest: Record<string, { sha256: string; width: number; height: number }> = {};

for (const c of IMAGE_CASES) {
  const inputPath = `fixtures/images/${c.source}`;
  const input = readFileSync(inputPath);
  const pipeline = c.op(sharp(input));
  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
  // Store the raw RGBA (or RGB) buffer plus its dimensions/channel count —
  // comparing raw decoded pixels, not re-encoded bytes, since KilnForge
  // and sharp use different underlying encoders and will never produce
  // byte-identical compressed output even for pixel-identical results.
  const outPath = `${REFERENCE_DIR}/images/${c.name}.raw`;
  writeFileSync(outPath, data);
  const meta = { width: info.width, height: info.height, channels: info.channels };
  writeFileSync(`${REFERENCE_DIR}/images/${c.name}.json`, JSON.stringify(meta, null, 2));
  hashManifest[`images/${c.name}`] = { sha256: sha256(data), width: info.width, height: info.height };
  console.log(`✓ ${c.name}: ${info.width}x${info.height}x${info.channels}, sha256 ${sha256(data).slice(0, 16)}...`);
}

// Archive side: a small real tarball built by the real `tar` package, for
// the archive golden-diff suite to compare KilnForge's own pack/unpack
// against.
const archiveInputDir = `${REFERENCE_DIR}/archive-input`;
mkdirSync(archiveInputDir, { recursive: true });
writeFileSync(`${archiveInputDir}/one.txt`, "first file contents");
writeFileSync(`${archiveInputDir}/two.txt`, "second file, a bit longer than the first one");

const tarOutPath = `${REFERENCE_DIR}/archives/reference.tar`;
await tar.create({ file: tarOutPath, cwd: archiveInputDir, portable: true }, ["one.txt", "two.txt"]);
const tarBytes = readFileSync(tarOutPath);
hashManifest["archives/reference.tar"] = { sha256: sha256(tarBytes), width: 0, height: 0 };
console.log(`✓ archives/reference.tar: ${tarBytes.length} bytes, sha256 ${sha256(tarBytes).slice(0, 16)}...`);

writeFileSync(`${REFERENCE_DIR}/manifest.json`, JSON.stringify(hashManifest, null, 2));
console.log(`\nWrote ${Object.keys(hashManifest).length} reference fixtures + manifest.json`);
