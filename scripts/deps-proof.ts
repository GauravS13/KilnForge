#!/usr/bin/env bun
/**
 * Regenerates deps-proof.txt: scans every import in src/**\/*.ts and root
 * index.ts (via Bun.Transpiler.scanImports — real Bun stdlib, no AST
 * package), filters out bun:/node:/relative specifiers, writes whatever's
 * left. A passing proof is this file being EMPTY — same convention as
 * the LOGQ sibling project's Go-based deps-proof.txt.
 *
 * Deliberately excludes scripts/** — gen-fixtures.ts, bench-sharp.ts, and
 * bench-tar.ts legitimately import sharp/tar as devDependencies (spec
 * §13.9), used only to generate benchmark/fixture-oracle data, never
 * shipped or imported by src/** or index.ts. Scanning scripts/** would
 * make this proof lie about what the actual runtime depends on.
 */

import { Glob } from "bun";

const transpiler = new Bun.Transpiler({ loader: "tsx" });

function isExternal(path: string): boolean {
  if (path.startsWith("bun:")) return false;
  if (path.startsWith("node:")) return false;
  if (path.startsWith(".") || path.startsWith("/")) return false;
  return true;
}

async function scanFile(path: string): Promise<string[]> {
  const source = await Bun.file(path).text();
  let imports: { path: string }[];
  try {
    imports = transpiler.scanImports(source);
  } catch (err) {
    throw new Error(`failed to scan imports in ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
  return imports.map((i) => i.path).filter(isExternal);
}

async function main() {
  const externalByFile = new Map<string, string[]>();

  const srcGlob = new Glob("src/**/*.ts");
  const files = ["index.ts"];
  for await (const f of srcGlob.scan(".")) files.push(f);

  for (const file of files) {
    const external = await scanFile(file);
    if (external.length > 0) externalByFile.set(file, external);
  }

  const lines: string[] = [];
  for (const [file, imports] of externalByFile) {
    for (const imp of imports) lines.push(`${file}: ${imp}`);
  }

  const output = lines.join("\n") + (lines.length ? "\n" : "");
  await Bun.write("deps-proof.txt", output);

  if (lines.length === 0) {
    console.log(`deps-proof.txt is empty — ${files.length} files scanned, zero external runtime imports found.`);
  } else {
    console.error(`deps-proof.txt is NOT empty — ${lines.length} external import(s) found:\n${output}`);
    process.exit(1);
  }
}

await main();
