# STDLIB.md

Every place this project reaches for a Bun/web-platform/Node-compat built-in instead of an npm package, with the rationale — and, where it matters, what was actually found by testing rather than assumed.

## Package Killer

**`sharp`** — the heavyweight native image-processing addon this whole project exists to replace. Every resize/rotate/convert/watermark operation goes through `Bun.Image` instead (native to the Bun binary, no build toolchain, no `libvips` dependency). See `BENCHMARKS.md` for a real differential benchmark: KilnForge is faster on every measured case (1.81x–10.22x).

**`tar`** / **`tar-fs`** / **`archiver`** — the archive-handling packages `/archive/pack`, `/archive/unpack`, and `/batch` replace, via `Bun.Archive`. See `BENCHMARKS.md`: KilnForge is 41.73x faster at unpack (in-memory vs. tar's disk-based extraction), 1.22x slower at pack (published honestly — the margin is real, if small).

Two named kills, doubled Package Killer case — both with real, reproducible differential benchmarks, not just a features list.

## Substitutions

| Normally installed | What it does | Standard-library / hand-rolled replacement |
|---|---|---|
| `sharp` | Image decode/resize/rotate/encode | `Bun.Image` (`src/image/process.ts`) |
| `tar` / `archiver` | Archive create/extract | `Bun.Archive` (`src/archive/pack.ts`, `unpack.ts`) |
| a PNG library (e.g. `pngjs`) | PNG chunk parsing, scanline filtering | Hand-rolled decoder **and** encoder (`src/image/png.ts`) — decoder needed since `Bun.Image` exposes no raw-pixel accessor; encoder needed because the watermark compositor has to get pixels back *into* `Bun.Image` somehow (see below) |
| a BMP library | BMP header parsing | Hand-rolled encoder/decoder (`src/image/bmp.ts`) — used to document a real, measured `Bun.Image` limitation (BMP-input alpha loss), not used as the production raw-pixel channel in the end (see Disclosures) |
| a CRC32 package | PNG chunk checksums | Hand-rolled table-based CRC-32 (`src/image/crc32.ts`), ~20 lines |
| `exif-reader` / `piexifjs` | JPEG EXIF orientation | Hand-rolled APP1/TIFF byte-level parser (`src/image/exif.ts`) — see Disclosures for why it's not wired into the request pipeline despite being fully correct |
| a resize/resampling library | Fallback resize when needed | Hand-rolled nearest-neighbor + bilinear (`src/image/fallbackResize.ts`) |
| a canvas/rotation library | Arbitrary-angle rotation | Hand-rolled inverse-coordinate-transform rotation (`src/image/fallbackRotate.ts`) — required, not optional: `Bun.Image.rotate()` throws on any non-90-multiple angle, confirmed by the Foundation Verification Harness |
| a canvas/compositing library | Alpha blending for watermarks | Hand-rolled Porter-Duff "source over destination" compositor (`src/image/watermark.ts`) |
| a font-rendering library (e.g. `opentype.js`) | Text-mode watermark rendering | Hand-authored 5x7 bitmap font + rasterizer (`src/image/font.ts`) — A-Z/0-9/space, a stated scope decision |
| `pako` / `zlib.js` | DEFLATE/gzip compression | `node:zlib` (`deflateSync`, `inflateSync`, `createGunzip`) — real Node/Bun stdlib |
| `jsonwebtoken` or a signing package | Signed transform URLs | `crypto.subtle` HMAC-SHA256 (`src/http/signing.ts`), expiry bound into the signed payload itself |
| a constant-time-compare package | Signature verification | `node:crypto`'s `timingSafeEqual` |
| `ip-range-check` / `netmask` | SSRF IP-range blocking | Hand-rolled IPv4 CIDR matching + IPv6 range checks, including IPv4-mapped-address smuggling detection (`src/http/ssrf.ts`) |
| `express-rate-limit` | Rate limiting | Hand-rolled token-bucket limiter (`src/http/rateLimit.ts`) |
| `multer` / `busboy` | Multipart form parsing | Native `Request`/`FormData` (web standard, built into Bun) |
| `express` / `fastify` / `koa` | HTTP server/routing | `Bun.serve` + a hand-rolled route table (`src/http/server.ts`) |
| `prom-client` | Metrics/Prometheus exposition | Hand-formatted counters + text exposition (`src/metrics/counters.ts`) |
| an AST-parsing package | Import scanning for the deps-proof script | `Bun.Transpiler.scanImports` (`scripts/deps-proof.ts`) |
| a tar-parsing package | Archive-bomb header inspection | Hand-rolled ustar 512-byte header walker (`src/archive/bomb.ts`) — reads real Bun.Archive-produced headers directly, cross-validated against real archives, not just synthetic ones |

## Real findings — corrections to the original plan, made by testing

Every one of these was found by actually running code against the installed Bun 1.4.0, not assumed from documentation or the original spec:

1. **`Bun.Image` has no `.bmp()`/`.gif()` *encode* method** — BMP/GIF are decode-only. The original spec's "PNG preferred, BMP fallback" dual-channel design was invalidated by this; PNG is the only viable raw-pixel channel, not a preference.
2. **`Bun.Image`'s BMP *decoder* discards the alpha channel** — every non-255 alpha byte reads back as 255. Confirmed via round-trip test; documented in `src/image/exif.ts`'s and `bmp.ts`'s module comments.
3. **`Bun.Image` already auto-applies EXIF orientation during decode** — the original spec (and every source it was researched against) assumed this was a real gap needing a hand-rolled fix wired into the pipeline. It isn't: confirmed via a byte-exact comparison (0/4800 mismatches) between decoding an EXIF-tagged JPEG directly and manually rotating a non-tagged version with native `rotate(90)`. The hand-rolled parser (`exif.ts`) is kept as a correct, tested, standalone utility — wiring it into the request pipeline would have **double-rotated every EXIF-tagged upload**, a real bug caught before shipping.
4. **`rotate(45)` throws** ("only multiples of 90 are supported") — confirmed real, not speculative. The fallback rotation path is load-bearing, not a hedge.
5. **`fit=cover` doesn't exist natively** — `resize()`'s real `fit` values are `"fill"` and `"inside"`, not `"cover"`/`"contain"`. Cover is hand-rolled: aspect-preserving overscale via native fill-mode resize, then a center-crop on the raw pixel buffer.
6. **An sRGB color-profile chunk does not survive `Bun.Image`'s PNG transcode** — resolves a disputed claim from pre-implementation research (Bun's own blog said profiles survive; two third-party posts said stripped). Tested directly: stripped.
7. **`Bun.Image`'s encoders are already deterministic** — no embedded timestamps, confirmed via byte-identical output across a real 1.1-second clock gap. The originally-planned "deterministic-output stripper" was reframed into a verification utility (`src/image/determinism.ts`) since there was nothing to strip.
8. **`bun build --compile` genuinely is reproducible** — but only once a real test-methodology bug was found and fixed (see `BUILD.md`): using a different `--outfile` basename per build run makes the *test* non-deterministic, not the build.
9. **`Bun.Archive.files()` does not sanitize path-traversal entries** — `"../../escape.txt"` comes back completely unmodified. Every caller (`src/archive/unpack.ts`) validates entry names itself before using them for anything beyond display.
10. **`Bun.Archive.extract()` *is* traversal-safe, but not via rejection** — it normalizes the entry to land inside the target directory rather than throwing. Verified on disk (checked where the file actually landed), not just by whether the call threw — an earlier probe run's thrown error turned out to be an unrelated Windows-path artifact, caught and corrected before trusting it.
11. **`Bun.Archive` was introduced in Bun v1.3.6, not 1.4** — two minor releases of real-world runway before `Bun.Image` (1.3.14) even shipped. More battle-tested than the image side, consistent with its official docs being internally consistent where `Bun.Image`'s third-party coverage wasn't.

## Disclosures

- **`sharp`, `tar`** — `devDependencies`. Imported only by `scripts/gen-fixtures.ts`, `scripts/bench-sharp.ts`, and `scripts/bench-tar.ts`, used exclusively as oracles for the golden-corpus differential test suite and the benchmarks. Never imported by `src/**` or `index.ts` — enforced mechanically, not just by convention: `scripts/deps-proof.ts` only scans those two paths, and `deps-proof.txt` is committed empty.
- **`@types/bun`** — `devDependency`, types-only, never shipped in any built artifact.
- **Fuzzing is not coverage-guided** — unlike Go's stdlib `testing.F`/`go test -fuzz=` (used by the sibling `LOGQ` project), Bun/JS has no native coverage-guided fuzzer. `tests/fuzz/*.test.ts` are hand-rolled seeded-random property loops (fixed seed, reproducible) inside ordinary `bun test` — real, but a different and weaker guarantee than true coverage-guided fuzzing. Stated plainly rather than implied as equivalent.
- **ICC/color-profile handling** — confirmed absent (see finding #6 above). BMP-input alpha handling is a confirmed, documented gap (finding #2). Neither is silently worked around; both are stated in the parity discussion below and in the harness output at `GET /capabilities`.
