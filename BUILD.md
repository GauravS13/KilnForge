# BUILD.md — Reproducible Build Proof

## The claim

Building this project three times, independently, from the same source, produces byte-identical binaries.

## The proof

Run it yourself:

```
bun run proof:build
```

This runs `scripts/build-proof.sh`, which:

1. Builds `bun build --compile --outfile <dir>/kilnforge index.ts` three times, each into its own temporary directory.
2. Hashes each resulting binary with SHA-256.
3. Writes the result to `build-proof.json`, served live at `GET /build-proof.json`.

Latest run on this machine (Bun 1.4.0, Windows):

```json
{
  "reproducible": true,
  "bunVersion": "1.4.0",
  "hashes": [
    "b538dc462315f6fab038aaa8efd2e1c3ac551a8ddb5f20078c69c1e37a3776e0",
    "b538dc462315f6fab038aaa8efd2e1c3ac551a8ddb5f20078c69c1e37a3776e0",
    "b538dc462315f6fab038aaa8efd2e1c3ac551a8ddb5f20078c69c1e37a3776e0"
  ]
}
```

All three hashes identical. `cmp` confirms zero differing bytes across the full ~89MB binary.

## A real non-determinism, found and fixed — not hidden

Earlier iterations of this proof script gave each of the three builds a **different** `--outfile` name (`kilnforge-1`, `kilnforge-2`, `kilnforge-3`). That version reported the build as **not reproducible** — three genuinely different hashes.

Investigating rather than accepting that result: diffing the two binaries byte-for-byte found only two differing regions across the entire ~89MB file. One of them was literal, readable ASCII text: `B:/~BUN/root/b1.` vs `B:/~BUN/root/b2.` — `bun build --compile` embeds the output file's own basename into the binary as a synthetic module path, used internally for module resolution metadata. Giving each build a different `--outfile` name was making the *test itself* produce different output — nothing to do with real build non-determinism.

Confirmed directly: two builds using the **identical** `--outfile` basename (in separate directories, to keep them as distinct files to hash) are **byte-for-byte identical** — `cmp` reports no difference at all across the full binary.

`scripts/build-proof.sh` now uses the same basename (`kilnforge`) for all three runs, each in its own temp directory. The fix is one line; the finding is the point — `bun build --compile` genuinely is deterministic, and this is what it took to prove that rather than assume it either way.

## What's pinned

- Exact Bun version: see `.bun-version` (currently `1.4.0`) and `engines.bun` in `package.json`. A reproducibility claim against a floating toolchain version is meaningless.
- No `--outfile` naming variance across runs (see above).

## What's NOT claimed

This proof covers the compiled standalone binary (`bun build --compile`). It does not, on its own, prove that every *image processing operation* this service performs is deterministic — that's a separate, narrower claim, proven separately in `src/image/determinism.test.ts` (same-input-same-output across repeated runs of the actual `processImage()` pipeline, including the arbitrary-rotation fallback path) and used directly by the ETag implementation (`src/http/etag.ts`), which computes a cache key from `(source id + transform spec)` alone — safe only because that determinism is measured, not assumed.
