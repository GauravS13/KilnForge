#!/usr/bin/env bun
import { runFoundationHarness } from "../src/verify/capabilities.ts";

const capabilities = await runFoundationHarness();

console.log(`kilnforge Foundation Verification Harness — Bun ${Bun.version}\n`);

for (const p of capabilities.probes) {
  const marker = !p.ok ? "\x1b[31m✗ ERROR\x1b[0m" : p.finding ? "\x1b[32m✓\x1b[0m" : "\x1b[33m○\x1b[0m";
  console.log(`${marker} ${p.name}`);
  console.log(`   ${p.detail}`);
}

console.log("\n--- Summary ---");
console.log(`Harness ran clean (no unexpected exceptions): ${capabilities.harnessRanClean ? "yes" : "NO"}`);
console.log("");
console.log("Bun.Image:");
console.log(`  constructor works:            ${capabilities.imageConstructorWorks}`);
console.log(`  PNG channel round-trips exact: ${capabilities.pngChannelRoundTripsExactly}`);
console.log(`  BMP decode preserves alpha:    ${capabilities.bmpDecodePreservesAlpha} (expected false — documented limitation)`);
console.log(`  arbitrary rotation supported:  ${capabilities.arbitraryRotationSupported} (expected false — fallback path required)`);
console.log(`  ICC/color-profile survives:    ${capabilities.iccProfileSurvivesTranscode} (expected false)`);
console.log("");
console.log("Bun.Archive:");
console.log(`  constructor create-mode works: ${capabilities.archiveConstructorCreateModeWorks}`);
console.log(`  constructor parse-mode works:  ${capabilities.archiveConstructorParseModeWorks}`);
console.log(`  files() sanitizes traversal:   ${capabilities.archiveFilesListingSanitizesTraversal} (expected false — self-validate)`);
console.log(`  extract() is traversal-safe:   ${capabilities.archiveExtractRejectsTraversal} (expected true — normalizes into the target dir rather than escaping)`);

if (!capabilities.harnessRanClean) {
  console.error("\nOne or more probes threw an unexpected exception — see ERROR entries above.");
  process.exit(1);
}

if (!capabilities.imageConstructorWorks || !capabilities.pngChannelRoundTripsExactly) {
  console.error(
    "\nThe two load-bearing probes (constructor, PNG round-trip) did not pass. " +
      "Nothing downstream in this codebase can be trusted to work until this is fixed.",
  );
  process.exit(1);
}

console.log("\nAll load-bearing checks passed. Non-nice findings above are expected and already designed around.");
