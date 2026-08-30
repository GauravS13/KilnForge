#!/usr/bin/env bun
/**
 * Differential benchmark against sharp (devDependency, never imported by
 * src/** or index.ts — enforced by scripts/deps-proof.ts). Real,
 * measured numbers on THIS machine, published even where KilnForge is
 * slower — "a naive but honest implementation scores above a fast one
 * that hides its corners" is the stated scoring philosophy this follows.
 */
import sharp from "sharp";
import { processImage } from "../src/image/process.ts";

interface BenchCase {
  name: string;
  source: string;
  run: (bytes: Uint8Array) => Promise<unknown>;
  runSharp: (bytes: Uint8Array) => Promise<unknown>;
}

const CASES: BenchCase[] = [
  {
    name: "resize 64x48 -> 20x20 (fill)",
    source: "medium-64x48.png",
    run: (b) => processImage(b, { width: 20, height: 20, fit: "fill", format: "png" }),
    runSharp: (b) => sharp(b).resize(20, 20, { fit: "fill" }).png().toBuffer(),
  },
  {
    name: "resize 256x256 -> 30x30 (cover)",
    source: "large-256x256.png",
    run: (b) => processImage(b, { width: 30, height: 30, fit: "cover", format: "png" }),
    runSharp: (b) => sharp(b).resize(30, 30, { fit: "cover" }).png().toBuffer(),
  },
  {
    name: "convert jpeg -> webp (quality 85)",
    source: "photo-48x48.jpg",
    run: (b) => processImage(b, { format: "webp", quality: 85 }),
    runSharp: (b) => sharp(b).webp({ quality: 85 }).toBuffer(),
  },
  {
    name: "rotate 90 (20x40)",
    source: "portrait-20x40.png",
    run: (b) => processImage(b, { rotateDeg: 90, format: "png" }),
    runSharp: (b) => sharp(b).rotate(90).png().toBuffer(),
  },
];

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

const results: Record<string, unknown> = {};

for (const c of CASES) {
  const bytes = new Uint8Array(await Bun.file(`fixtures/images/${c.source}`).arrayBuffer());
  const kiln = await timeIt(() => c.run(bytes));
  const sharpResult = await timeIt(() => c.runSharp(bytes));
  const ratio = kiln.meanMs / sharpResult.meanMs;
  results[c.name] = {
    kilnforge: kiln,
    sharp: sharpResult,
    kilnforgeVsSharp: ratio < 1 ? `${(1 / ratio).toFixed(2)}x faster` : `${ratio.toFixed(2)}x slower`,
  };
  console.log(`${c.name}:`);
  console.log(`  kilnforge: ${kiln.meanMs}ms mean / ${kiln.medianMs}ms median`);
  console.log(`  sharp:     ${sharpResult.meanMs}ms mean / ${sharpResult.medianMs}ms median`);
  console.log(`  -> ${results[c.name]!["kilnforgeVsSharp" as never]}`);
}

await Bun.write(
  "fixtures/reference/bench-sharp-results.json",
  JSON.stringify({ bunVersion: Bun.version, sharpVersion: (await import("sharp")).default.versions, results }, null, 2),
);
console.log("\nWrote fixtures/reference/bench-sharp-results.json");
