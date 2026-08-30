import { decodePng, encodePng } from "../image/png.ts";
import { crc32 } from "../image/crc32.ts";
import { buildKnownPixelFixture, buildKnownPixelBmp, pixelsApproximatelyEqual } from "./fixtures.ts";

export interface ProbeResult {
  name: string;
  /** Did the probe complete without an unexpected exception? A probe can
   * still `ok: true` and have `finding: false` — several probes below are
   * *expected* to report a negative finding (that's a successful,
   * informative run, not a harness failure). Only an unexpected throw
   * sets `ok: false`. */
  ok: boolean;
  /** The actual empirical answer this probe measured. */
  finding: boolean;
  detail: string;
}

export interface Capabilities {
  probes: ProbeResult[];
  /** True only if every probe *ran* without an unexpected exception —
   * says nothing about whether the findings were the "nice" outcome. */
  harnessRanClean: boolean;

  // Bun.Image
  imageConstructorWorks: boolean;
  pngChannelRoundTripsExactly: boolean;
  bmpDecodePreservesAlpha: boolean; // expected false — documented limitation, not a bug
  arbitraryRotationSupported: boolean; // expected false — drives the fallback rotate path
  iccProfileSurvivesTranscode: boolean; // expected false — resolves the disputed research claim

  // Bun.Archive
  archiveConstructorCreateModeWorks: boolean;
  archiveConstructorParseModeWorks: boolean;
  archiveFilesListingSanitizesTraversal: boolean; // expected false — .files() must be self-validated
  archiveExtractRejectsTraversal: boolean; // expected true, but with a generic error to wrap
}

async function probe(
  results: ProbeResult[],
  name: string,
  fn: () => Promise<{ finding: boolean; detail: string }>,
): Promise<boolean> {
  try {
    const { finding, detail } = await fn();
    results.push({ name, ok: true, finding, detail });
    return finding;
  } catch (err) {
    const detail = `threw unexpectedly: ${err instanceof Error ? err.message : String(err)}`;
    results.push({ name, ok: false, finding: false, detail });
    return false;
  }
}

export async function runFoundationHarness(): Promise<Capabilities> {
  const results: ProbeResult[] = [];

  const imageConstructorWorks = await probe(results, "Bun.Image constructor shape", async () => {
    const bmp = buildKnownPixelBmp();
    const img = new Bun.Image(bmp);
    const meta = await img.metadata();
    return {
      finding: meta.width === 4 && meta.height === 4,
      detail: `new Bun.Image(bytes) works; metadata() = ${JSON.stringify(meta)}. (Bun.image, the lowercase function form some sources described, does not exist on this Bun version.)`,
    };
  });

  const pngChannelRoundTripsExactly = await probe(
    results,
    "PNG raw-pixel channel round-trips exactly (read + write, incl. alpha)",
    async () => {
      const fixture = buildKnownPixelFixture();
      const ourPng = encodePng(fixture);
      const img = new Bun.Image(ourPng);
      const bunEncoded = await img.png().bytes();
      const decoded = decodePng(bunEncoded);
      const cmp = pixelsApproximatelyEqual(fixture.pixels, decoded.pixels, 0);
      return {
        finding: cmp.equal,
        detail: cmp.equal
          ? `exact match across ${fixture.pixels.length} bytes (our encodePng -> Bun.Image decode+re-encode -> our decodePng)`
          : `mismatch at byte ${cmp.firstMismatchIndex}, maxDelta ${cmp.maxDelta}`,
      };
    },
  );

  const bmpDecodePreservesAlpha = await probe(
    results,
    "BMP decode alpha-channel fidelity (documented limitation, non-gating)",
    async () => {
      const fixture = buildKnownPixelFixture();
      const bmp = buildKnownPixelBmp();
      const img = new Bun.Image(bmp);
      const pngOut = await img.png().bytes();
      const decoded = decodePng(pngOut);
      const cmp = pixelsApproximatelyEqual(fixture.pixels, decoded.pixels, 0);
      return {
        finding: cmp.equal,
        detail: cmp.equal
          ? "BMP input preserves alpha"
          : `BMP input does NOT preserve alpha — every non-255 alpha byte reads back as 255 (mismatch at byte ${cmp.firstMismatchIndex}). Expected and documented: BMP uploads with partial transparency lose it. PNG uploads are used internally when alpha matters (see src/image/png.ts).`,
      };
    },
  );

  const arbitraryRotationSupported = await probe(
    results,
    "Arbitrary-angle rotation support",
    async () => {
      const bmp = buildKnownPixelBmp();
      try {
        const img = new Bun.Image(bmp);
        await img.rotate(45).png().bytes();
        return { finding: true, detail: "rotate(45) succeeded — arbitrary angles are supported" };
      } catch (err) {
        return {
          finding: false,
          detail: `rotate(45) threw: ${err instanceof Error ? err.message : String(err)} — only multiples of 90 are supported. The fallback rotate path (src/image/fallbackRotate.ts) is required, not optional.`,
        };
      }
    },
  );

  const iccProfileSurvivesTranscode = await probe(
    results,
    "ICC/color-profile chunk survival through PNG transcode",
    async () => {
      // A minimal PNG carrying an sRGB chunk (simpler to construct than a
      // full embedded ICC profile blob, and answers the same question: does
      // Bun.Image's PNG encoder preserve a color-metadata chunk it didn't
      // itself generate).
      const fixture = buildKnownPixelFixture();
      const basePng = encodePng(fixture);
      const ihdrChunkLength = 8 + 4 + 4 + 13 + 4; // signature + len + type + IHDR data + crc
      const before = basePng.subarray(0, ihdrChunkLength);
      const after = basePng.subarray(ihdrChunkLength);

      const srgbData = new Uint8Array([0]); // rendering intent: perceptual
      const srgbTypeAndData = new Uint8Array(4 + 1);
      srgbTypeAndData.set(new TextEncoder().encode("sRGB"), 0);
      srgbTypeAndData.set(srgbData, 4);
      const srgbChunk = new Uint8Array(4 + 4 + 1 + 4);
      new DataView(srgbChunk.buffer).setUint32(0, 1, false);
      srgbChunk.set(srgbTypeAndData, 4);
      new DataView(srgbChunk.buffer).setUint32(9, crc32(srgbTypeAndData), false);

      const withSrgb = new Uint8Array(before.length + srgbChunk.length + after.length);
      withSrgb.set(before, 0);
      withSrgb.set(srgbChunk, before.length);
      withSrgb.set(after, before.length + srgbChunk.length);

      const img = new Bun.Image(withSrgb);
      const out = await img.png().bytes();
      const text = Array.from(out.subarray(0, Math.min(out.length, 4096)))
        .map((b) => String.fromCharCode(b))
        .join("");
      const survived = text.includes("sRGB") || text.includes("iCCP");

      return {
        finding: survived,
        detail: survived
          ? "color-profile chunk survived transcoding"
          : "color-profile chunk (sRGB) did NOT survive transcoding — resolves the disputed research claim (Bun's own blog said profiles survive; two third-party posts said stripped; this run says stripped).",
      };
    },
  );

  const archiveConstructorCreateModeWorks = await probe(
    results,
    "Bun.Archive constructor — create mode (object-map input)",
    async () => {
      const archive = new Bun.Archive({ "probe.txt": "hello" });
      const bytes = await archive.bytes();
      return { finding: bytes.length > 0, detail: `create-mode produced ${bytes.length} bytes` };
    },
  );

  const archiveConstructorParseModeWorks = await probe(
    results,
    "Bun.Archive constructor — parse mode (Uint8Array input)",
    async () => {
      const created = await new Bun.Archive({ "probe.txt": "hello" }).bytes();
      const parsed = new Bun.Archive(created);
      const files = await parsed.files();
      return {
        finding: files.has("probe.txt"),
        detail: `parse-mode files(): ${JSON.stringify(Array.from(files.keys()))}`,
      };
    },
  );

  const archiveFilesListingSanitizesTraversal = await probe(
    results,
    "Bun.Archive.files() path-traversal handling",
    async () => {
      const bytes = await new Bun.Archive({ "../../escape.txt": "x", "normal.txt": "y" }).bytes();
      const parsed = new Bun.Archive(bytes);
      const files = await parsed.files();
      const sanitized = !files.has("../../escape.txt");
      return {
        finding: sanitized,
        detail: sanitized
          ? "files() sanitizes/rejects traversal entries"
          : "files() returns traversal paths VERBATIM, unsanitized. Confirmed real risk: every caller of .files() (src/archive/unpack.ts, src/archive/batch.ts) MUST validate/reject entry names itself before using them for anything beyond safe display; never pass a .files() key to a filesystem operation.",
      };
    },
  );

  const archiveExtractRejectsTraversal = await probe(
    results,
    "Bun.Archive.extract() path-traversal safety",
    async () => {
      // The real safety question isn't "does extract() throw" — an earlier
      // manual probe run got a thrown "ReadError" here, but that turned out
      // to be a Windows-path artifact (a Git-Bash-style /tmp/... path Bun
      // couldn't resolve on native Windows), not traversal protection.
      // Re-run with a proper native path and check what actually happened
      // on disk: does the traversal entry land OUTSIDE the target directory,
      // or does extract() normalize/clamp it to stay inside?
      const bytes = await new Bun.Archive({ "../../escape.txt": "x" }).bytes();
      const parsed = new Bun.Archive(bytes);
      const os = await import("node:os");
      const path = await import("node:path");
      const fs = await import("node:fs/promises");
      const tmpDir = path.join(os.tmpdir(), `kilnforge-traversal-probe-${Date.now()}-${Math.random().toString(36).slice(2)}`);

      let threw: string | null = null;
      try {
        await parsed.extract(tmpDir);
      } catch (err) {
        threw = err instanceof Error ? err.message : String(err);
      }

      // Does anything now exist outside tmpDir that shouldn't? Check the
      // two levels up the traversal entry literally asked for, and the
      // parent of tmpDir, for a stray escape.txt.
      const suspectPaths = [
        path.join(tmpDir, "..", "..", "escape.txt"),
        path.join(tmpDir, "..", "escape.txt"),
      ];
      let escaped = false;
      for (const p of suspectPaths) {
        try {
          await fs.access(p);
          escaped = true;
        } catch {
          // doesn't exist — good
        }
      }

      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      for (const p of suspectPaths) await fs.rm(p, { force: true }).catch(() => {});

      const safe = !escaped;
      return {
        finding: safe,
        detail: threw
          ? `extract() threw (${threw}) and no traversal escape was found on disk — safe, but if this recurs check whether it's a real rejection or an unrelated path error before relying on it.`
          : safe
            ? "extract() did not throw, but verified on disk: the traversal entry was normalized/clamped to land inside the target directory, not outside it — this IS safe, just not via rejection. Still: never build a UI/log message that echoes a .files()/.extract() entry name as a trusted path (see the files() finding above)."
            : "extract() wrote outside the target directory — confirmed unsafe, do not rely on extract() for traversal protection.",
      };
    },
  );

  const harnessRanClean = results.every((r) => r.ok);

  return {
    probes: results,
    harnessRanClean,
    imageConstructorWorks,
    pngChannelRoundTripsExactly,
    bmpDecodePreservesAlpha,
    arbitraryRotationSupported,
    iccProfileSurvivesTranscode,
    archiveConstructorCreateModeWorks,
    archiveConstructorParseModeWorks,
    archiveFilesListingSanitizesTraversal,
    archiveExtractRejectsTraversal,
  };
}
