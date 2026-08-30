# DEMO.md — Five-Minute Demo Script

Required by the rules page's Submission Format: the demo must show the empty dependency manifest on camera, not just features working.

## Script

1. **`cat package.json`** — empty `dependencies: {}`, on camera, before anything else runs. Then `bun index.ts` — one command, no install step, server up.

2. `curl -F image=@sample.jpg localhost:3000/resize?w=400` — show the resized output in a browser tab.

3. `curl -F image=@sample.jpg -F logo=@mark.png "localhost:3000/watermark?position=br&opacity=0.6"` — before/after side by side.

4. `curl "localhost:3000/convert?format=webp" -F image=@sample.jpg -o out.webp` — format-convert proof.

5. `curl -F archive=@photos.tar.gz "localhost:3000/batch?w=400" -o out.tar` — upload a tarball of images, get back a tarball of resized results in one call. The cohesion proof (`STDLIB.md`, `README.md` "Endpoints" section) live.

6. Open `/stdlib.md` and `/build-proof.json` live in the browser — the self-proving meta flex.

7. Open `/` in the browser — the interactive drag-and-drop demo page. Drop an image, click through resize/rotate/watermark live, no terminal needed.

8. Close on the doubled benchmark table (`BENCHMARKS.md`) and the line: *"One cohesive service, two real npm packages replaced — sharp and tar — built on Bun's own native image and archive APIs."*

## Reproducing this yourself

```
bun install
bun run verify
bun index.ts
```

Three commands, no configuration, any machine with Bun installed. `GET /capabilities` shows exactly what this specific host supports, measured live.
