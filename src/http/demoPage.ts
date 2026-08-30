import type { RouteHandler } from "./server.ts";

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>KilnForge demo</title>
<style>
  body { font-family: -apple-system, sans-serif; max-width: 900px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; }
  h1 { font-size: 1.4rem; }
  #drop { border: 2px dashed #999; border-radius: 8px; padding: 40px; text-align: center; margin: 20px 0; cursor: pointer; }
  #drop.over { border-color: #333; background: #f5f5f5; }
  .row { display: flex; gap: 10px; flex-wrap: wrap; margin: 12px 0; }
  button { padding: 8px 14px; cursor: pointer; }
  input[type=text], input[type=number] { padding: 6px; width: 80px; }
  #preview { display: flex; gap: 20px; margin-top: 20px; flex-wrap: wrap; }
  #preview img { max-width: 300px; border: 1px solid #ccc; }
  .col { text-align: center; }
  .col p { font-size: 0.85rem; color: #666; }
  #status { color: #a00; margin: 10px 0; min-height: 1.2em; }
</style>
</head>
<body>
<h1>KilnForge — try it</h1>
<p>Zero-dependency image processing. Drop an image, pick an operation.</p>

<div id="drop">Drag an image here, or click to choose one</div>
<input type="file" id="fileInput" accept="image/*" style="display:none">

<div class="row">
  <label>w <input type="number" id="w" value="200"></label>
  <label>h <input type="number" id="h" value="200"></label>
  <select id="fit"><option>cover</option><option>contain</option><option>fill</option></select>
  <select id="format"><option>png</option><option>jpeg</option><option>webp</option></select>
</div>
<div class="row">
  <button id="btnResize">Resize</button>
  <button id="btnRotate90">Rotate 90°</button>
  <button id="btnRotate37">Rotate 37° (fallback)</button>
  <label>text <input type="text" id="wmText" value="SAMPLE"></label>
  <button id="btnWatermark">Watermark (text)</button>
</div>

<div id="status"></div>
<div id="preview"></div>

<script>
let currentFile = null;

const drop = document.getElementById("drop");
const fileInput = document.getElementById("fileInput");
const status = document.getElementById("status");
const preview = document.getElementById("preview");

drop.addEventListener("click", () => fileInput.click());
drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("over");
  if (e.dataTransfer.files.length) setFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener("change", () => {
  if (fileInput.files.length) setFile(fileInput.files[0]);
});

function setFile(f) {
  currentFile = f;
  drop.textContent = "Loaded: " + f.name + " (" + f.size + " bytes) — click to change";
  showOriginal(f);
}

function showOriginal(f) {
  preview.innerHTML = "";
  const col = document.createElement("div");
  col.className = "col";
  const img = document.createElement("img");
  img.src = URL.createObjectURL(f);
  col.appendChild(img);
  const p = document.createElement("p");
  p.textContent = "original";
  col.appendChild(p);
  preview.appendChild(col);
}

async function callEndpoint(path, params, extraFields) {
  if (!currentFile) { status.textContent = "Pick an image first."; return; }
  status.textContent = "Processing...";
  const fd = new FormData();
  fd.set("image", currentFile);
  if (extraFields) for (const [k, v] of Object.entries(extraFields)) fd.set(k, v);
  const url = path + "?" + new URLSearchParams(params).toString();
  try {
    const res = await fetch(url, { method: "POST", body: fd });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      status.textContent = "Error " + res.status + ": " + (body.error || res.statusText);
      return;
    }
    const blob = await res.blob();
    const col = document.createElement("div");
    col.className = "col";
    const img = document.createElement("img");
    img.src = URL.createObjectURL(blob);
    col.appendChild(img);
    const p = document.createElement("p");
    p.textContent = path + " (" + blob.size + " bytes)";
    col.appendChild(p);
    preview.appendChild(col);
    status.textContent = "Done.";
  } catch (err) {
    status.textContent = "Request failed: " + err;
  }
}

document.getElementById("btnResize").addEventListener("click", () => {
  callEndpoint("/resize", {
    w: document.getElementById("w").value,
    h: document.getElementById("h").value,
    fit: document.getElementById("fit").value,
    format: document.getElementById("format").value,
  });
});
document.getElementById("btnRotate90").addEventListener("click", () => {
  callEndpoint("/rotate", { deg: "90", format: document.getElementById("format").value });
});
document.getElementById("btnRotate37").addEventListener("click", () => {
  callEndpoint("/rotate", { deg: "37", format: document.getElementById("format").value });
});
document.getElementById("btnWatermark").addEventListener("click", () => {
  callEndpoint("/watermark", {
    text: document.getElementById("wmText").value,
    position: "br",
    format: document.getElementById("format").value,
  });
});
</script>
</body>
</html>`;

export const demoPageRoute: RouteHandler = () => {
  return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } });
};
