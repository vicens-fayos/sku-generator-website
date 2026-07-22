import { readProducts } from "./xlsx.js";
import { buildReferences } from "./sku/loaders.js";
import { generate } from "./sku/engine.js";
import { toCSV } from "./csv.js";

const REF_FILES = {
  vendor: "data/vendor_mapping_canonical.csv",
  type: "data/type_mapping_canonical.csv",
  typeAbv: "data/type_abv_reference.csv",
  optionNames: "data/option_names_canonical.csv",
  optionValues: "data/option_values_linked_canonical.csv",
};

let refsPromise = null;
function loadRefs() {
  if (!refsPromise) {
    refsPromise = (async () => {
      const entries = await Promise.all(
        Object.entries(REF_FILES).map(async ([k, url]) => {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`Failed to load ${url}`);
          return [k, await res.text()];
        })
      );
      return buildReferences(Object.fromEntries(entries));
    })();
  }
  return refsPromise;
}

const $ = (id) => document.getElementById(id);
let lastResult = null;

function showError(msg) {
  const el = $("error");
  el.textContent = msg;
  el.hidden = false;
}

function renderStats(stats) {
  const cells = [
    ["Variant SKUs", stats.variantRows],
    ["Provider-anchored", stats.providerAnchored],
    ["Generated", stats.generated],
    ["Colliders (handle-hashed)", stats.collidersHandleHashed],
    ["Flagged for review", stats.review],
    ["Unresolved rows", stats.unresolvedRows],
  ];
  $("stats").innerHTML = cells
    .map(([label, n]) => `<div class="stat"><b>${n}</b><span>${label}</span></div>`)
    .join("");
}

function renderWarnings(w) {
  const box = $("warnings-box");
  const total = w.vendor.length + w.type.length + w.option.length;
  if (total === 0) { box.hidden = true; return; }
  box.hidden = false;
  const section = (title, items) =>
    items.length ? `<p><b>${title}</b></p><ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>` : "";
  $("warnings").innerHTML =
    section("Unknown vendors", w.vendor) +
    section("Unknown types", w.type) +
    section("Unknown option names", w.option);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderTable(rows, filter) {
  const f = filter.trim().toLowerCase();
  const variant = rows.filter((r) => r.isVariant);
  const shown = f
    ? variant.filter((r) => (r.handle + " " + r.title + " " + r.sku).toLowerCase().includes(f))
    : variant;
  const MAX = 2000;
  const slice = shown.slice(0, MAX);
  $("tbody").innerHTML = slice
    .map((r) => `<tr class="${r.reviewReason ? "flagged" : ""}">
      <td>${escapeHtml(r.handle)}</td>
      <td>${escapeHtml(r.title)}</td>
      <td class="sku">${escapeHtml(r.sku)}</td>
      <td class="review">${escapeHtml(r.reviewReason || "")}</td></tr>`)
    .join("");
  if (shown.length > MAX) {
    $("tbody").insertAdjacentHTML("beforeend",
      `<tr><td colspan="4">Showing first ${MAX} of ${shown.length} rows — use the filter or download the CSV for all.</td></tr>`);
  }
}

function downloadCSV(rows) {
  const variant = rows.filter((r) => r.isVariant);
  const header = ["Handle", "Title", "Variant SKU", "Review Reason"];
  const csvRows = variant.map((r) => ({
    Handle: r.handle, Title: r.title, "Variant SKU": r.sku, "Review Reason": r.reviewReason || "",
  }));
  const blob = new Blob([toCSV(header, csvRows)], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "skus.csv";
  a.click();
  URL.revokeObjectURL(url);
}

async function handleFile(file) {
  $("error").hidden = true;
  $("filename").textContent = file.name;
  try {
    const [refs, buf] = await Promise.all([loadRefs(), file.arrayBuffer()]);
    const { rows } = readProducts(new Uint8Array(buf));
    lastResult = generate(rows, refs);
    renderStats(lastResult.stats);
    renderWarnings(lastResult.warnings);
    renderTable(lastResult.rows, "");
    $("results").hidden = false;
  } catch (err) {
    showError(err.message || String(err));
  }
}

// Wire up events.
$("pick").addEventListener("click", () => $("file").click());
$("file").addEventListener("change", (e) => { if (e.target.files[0]) handleFile(e.target.files[0]); });
$("download").addEventListener("click", () => { if (lastResult) downloadCSV(lastResult.rows); });
$("filter").addEventListener("input", (e) => { if (lastResult) renderTable(lastResult.rows, e.target.value); });

const drop = $("drop");
["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("dragover"); }));
["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("dragover"); }));
drop.addEventListener("drop", (e) => { const f = e.dataTransfer.files[0]; if (f) handleFile(f); });
