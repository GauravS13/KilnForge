#!/usr/bin/env bun
/**
 * Differential benchmark against the `tar` npm package (devDependency,
 * never imported by src/** or index.ts). Same honesty rule as
 * bench-sharp.ts: real numbers on this machine, published either way.
 */
import * as tarPkg from "tar";
import { packArchive } from "../src/archive/pack.ts";
import { unpackArchive } from "../src/archive/unpack.ts";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const WARMUP = 5;
const ITERATIONS = 30;

async function timeIt(fn: () => Promise<unknown>): Promise<{ meanMs: number; medianMs: number }> {
  for (let i = 0; i < WARMUP; i++) await fn();
  const samples: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    await fn();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const median = samples[Math.floor(samples.length / 2)]!;
  return { meanMs: Math.round(mean * 100) / 100, medianMs: Math.round(median * 100) / 100 };
}

// Build a small fixture directory with a handful of files for `tar` to
// pack — tar's own API packs from disk, not from in-memory buffers, so
// this mirrors its normal real-world usage rather than an unfair
// in-memory-vs-disk comparison favoring one side.
const fixtureDir = mkdtempSync(join(tmpdir(), "kilnforge-bench-tar-"));
const entryNames = ["a.txt", "b.txt", "c.txt", "d.txt", "e.txt"];
for (const name of entryNames) {
  writeFileSync(join(fixtureDir, name), "x".repeat(5000));
}

console.log("pack (5 files, 5KB each):");
const kilnPack = await timeIt(async () => {
  const entries = entryNames.map((name) => ({ name, data: new Uint8Array(5000).fill(120) }));
  await packArchive(entries);
});
const tarPack = await timeIt(async () => {
  await tarPkg.create({ cwd: fixtureDir, portable: true }, entryNames);
});
console.log(`  kilnforge: ${kilnPack.meanMs}ms mean`);
console.log(`  tar:       ${tarPack.meanMs}ms mean`);
const packRatio = kilnPack.meanMs / tarPack.meanMs;
console.log(`  -> ${packRatio < 1 ? `${(1 / packRatio).toFixed(2)}x faster` : `${packRatio.toFixed(2)}x slower`}`);

console.log("\nunpack (same archive):");
const archiveBytes = await packArchive(
  entryNames.map((name) => ({ name, data: new Uint8Array(5000).fill(120) })),
);
const kilnUnpack = await timeIt(() => unpackArchive(archiveBytes));

const archiveFile = join(fixtureDir, "bench.tar");
await Bun.write(archiveFile, archiveBytes);
const extractDir = mkdtempSync(join(tmpdir(), "kilnforge-bench-tar-extract-"));
const tarUnpack = await timeIt(() => tarPkg.extract({ file: archiveFile, cwd: extractDir }));
console.log(`  kilnforge: ${kilnUnpack.meanMs}ms mean`);
console.log(`  tar:       ${tarUnpack.meanMs}ms mean`);
const unpackRatio = kilnUnpack.meanMs / tarUnpack.meanMs;
console.log(`  -> ${unpackRatio < 1 ? `${(1 / unpackRatio).toFixed(2)}x faster` : `${unpackRatio.toFixed(2)}x slower`}`);

await Bun.write(
  "fixtures/reference/bench-tar-results.json",
  JSON.stringify(
    { bunVersion: Bun.version, tarVersion: tarPkg.version, pack: { kilnforge: kilnPack, tar: tarPack }, unpack: { kilnforge: kilnUnpack, tar: tarUnpack } },
    null,
    2,
  ),
);
console.log("\nWrote fixtures/reference/bench-tar-results.json");

rmSync(fixtureDir, { recursive: true, force: true });
rmSync(extractDir, { recursive: true, force: true });
