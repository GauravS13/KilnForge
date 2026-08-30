# Tasks

`package.json`'s `"scripts"` block is KilnForge's task runner (`bun run <name>`) — there's no Makefile here because `make` isn't on the machine this project was built on (`which make` fails; confirmed, not assumed). This file carries the rationale comments a Makefile target would otherwise hold.

## `bun run verify`

Runs `scripts/verify-harness.ts` — the Foundation Verification Harness (spec §10, extended in §17.3). **Its actual pass/fail output was unknown as of the scaffold commit.** Every downstream decision in this codebase — which raw-pixel channel (`PNG+zlib` vs `BMP`) the watermark compositor uses, which `Bun.Image`/`Bun.Archive` constructor shape is called, whether arbitrary-angle rotation uses the native API or the hand-rolled fallback, whether `Bun.Archive`'s path-traversal protection is trusted — is gated on this script's real, measured output against the installed Bun binary, not on the spec's best-guess pseudocode. Run this first, before writing anything that calls `Bun.Image` or `Bun.Archive` directly.

## `bun test`

Standard unit test suite. Runs fast, no fixtures generation needed — fixtures required for golden tests are checked into the repo already.

## `bun run test:golden`

Differential tests: decodes KilnForge's own output back to raw pixels/archive entries and diffs against reference output the fixtures were built from (`sharp` for images, `tar` for archives — both generated at fixture-build time only, never a runtime dependency of this project). This is the pattern named directly in the cross-source hackathon idea ranking as the single highest-leverage move available: differential-test against the thing you're replacing.

## `bun run test:fuzz`

**Honest disclosure:** unlike Go's stdlib coverage-guided fuzzing (`go test -fuzz=`), Bun/JS has no standard-library fuzzer. These are hand-rolled seeded-random property loops inside ordinary `bun test` — real, but not coverage-guided fuzzing. Stated plainly here rather than implied as equivalent.

## `bun run test:concurrency`

Fires N concurrent requests at a running server instance across mixed endpoints (image and archive) and asserts no corrupted or cross-contaminated output. Turns "Bun.serve is inherently concurrent" from an assumed property into a measured one — and, via the harness's threading probe, checks the same claim for `Bun.Archive` operations specifically, since Bun's own official docs do not confirm the "off-main-thread" claim the original pitch made.

## `bun run fixtures:gen`

Regenerates the golden-corpus reference outputs using `sharp` and `tar` as oracles. `sharp` and `tar` are `devDependencies`, imported only by `scripts/gen-fixtures.ts`, `scripts/bench-sharp.ts`, and `scripts/bench-tar.ts` — never by anything under `src/` or `index.ts`. `bun run proof:deps` enforces this boundary by construction (it only scans `src/**` and `index.ts`).

## `bun run bench:sharp` / `bun run bench:tar`

Differential benchmarks — real, measured numbers on this machine, published in `BENCHMARKS.md` alongside (never instead of) the public numbers cited in the spec. Publishes losses too, not just wins.

## `bun run proof:deps`

Regenerates `deps-proof.txt` by scanning every import in `src/**/*.ts` and root `index.ts` (via Bun's transpiler import-scanning), filtering out `bun:`/`node:`/relative specifiers. A passing proof is this file being **empty**. Deliberately excludes `scripts/**`, where the benchmark/fixture-generation devDependencies are legitimately imported.

## `bun run proof:build`

Runs `bun build --compile` three times, hashes each output, and asserts all three match — the Reproducible Build bonus proof (spec §6), written to `build-proof.json` and served live at `GET /build-proof.json`.
