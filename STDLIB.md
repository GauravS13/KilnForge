# STDLIB.md

> Built incrementally as each substitution is actually implemented, not backfilled — this file's real substance lands in C5, once every substitution below has real code behind it.

Every place this project reaches for a Bun/web-platform built-in instead of an npm package, with the rationale.

## Package Killer

_(filled in C5 — `sharp` and `tar`, the two packages this replaces, with the differential benchmark numbers)_

## Substitutions

_(filled in C5 — full table: CBOR/PNG/BMP-adjacent parsing, HMAC signing, IP-range parsing, rate limiting, etc.)_

## Disclosures

_(filled in C5 — `@types/bun` (types-only, never shipped), `sharp`/`tar` (benchmark and fixture-oracle only, pinned exact versions, never imported by `src/**` or `index.ts`), and the fuzzing-is-not-coverage-guided disclosure from `TASKS.md`)_
