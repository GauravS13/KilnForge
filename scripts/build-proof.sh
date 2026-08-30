#!/usr/bin/env bash
# Reproducible Build proof (spec §6): builds the standalone binary three
# times independently and confirms the output is byte-identical each
# time. Writes build-proof.json — the artifact served live at
# GET /build-proof.json so a judge can verify it against their own fresh
# build without reading a file.
set -euo pipefail

cd "$(dirname "$0")/.."

BUN_VERSION="$(bun --version)"
OUT_DIR="$(mktemp -d)"
trap 'rm -rf "$OUT_DIR"' EXIT

# IMPORTANT: every build below uses the SAME --outfile basename
# ("kilnforge"), just in a different directory per run. Found by testing,
# not assumed: bun build --compile embeds the outfile's basename into the
# binary as a synthetic module path (visible as literal ASCII
# "B:/~BUN/root/<basename>." partway through the file) — using DIFFERENT
# basenames per build (e.g. "kilnforge-1", "kilnforge-2") makes the
# output differ for a reason that has nothing to do with real build
# non-determinism, and earlier iterations of this script did exactly
# that, incorrectly reporting the build as non-reproducible. Confirmed by
# direct A/B test: two builds with the same basename in different temp
# dirs are byte-for-byte IDENTICAL (cmp reports no difference across the
# full ~89MB binary); two builds with different basenames are not.
HASHES=()
for i in 1 2 3; do
  echo "build $i/3..." >&2
  BUILD_DIR="$OUT_DIR/run-$i"
  mkdir -p "$BUILD_DIR"
  bun build --compile --outfile "$BUILD_DIR/kilnforge" index.ts >&2
  # bun build --compile appends .exe on Windows; find whatever it actually produced.
  BIN=$(ls "$BUILD_DIR/kilnforge"* 2>/dev/null | head -n1)
  if [ -z "$BIN" ]; then
    echo "build $i produced no output file" >&2
    exit 1
  fi
  HASH=$(sha256sum "$BIN" | awk '{print $1}')
  HASHES+=("$HASH")
  echo "build $i hash: $HASH" >&2
done

MATCH=true
for h in "${HASHES[@]}"; do
  if [ "$h" != "${HASHES[0]}" ]; then
    MATCH=false
  fi
done

TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

if [ "$MATCH" = true ]; then
  echo "REPRODUCIBLE — all 3 builds produced identical output: ${HASHES[0]}" >&2
else
  echo "NOT REPRODUCIBLE — hashes differ: ${HASHES[*]}" >&2
fi

cat > build-proof.json <<EOF
{
  "reproducible": $MATCH,
  "bunVersion": "$BUN_VERSION",
  "hashes": [$(printf '"%s",' "${HASHES[@]}" | sed 's/,$//')],
  "generatedAt": "$TIMESTAMP"
}
EOF

echo "wrote build-proof.json" >&2

if [ "$MATCH" != true ]; then
  exit 1
fi
