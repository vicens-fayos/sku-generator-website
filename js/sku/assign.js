import { hash6, hash4 } from "./hash.js";
import { valueKey } from "./loaders.js";
import { SUPPLIER_SKU_METAFIELD_KEY } from "./config.js";

const OPTION_SLOTS = [
  ["Option1 Name", "Option1 Value"],
  ["Option2 Name", "Option2 Value"],
  ["Option3 Name", "Option3 Value"],
];
const TITLE_CONCEPT = "TITLE";
const s = (v) => (v === undefined || v === null ? "" : String(v));

// A SKU already in our own VENDOR-TYPE house format: our *output*, never a
// supplier code. Vendor IDs are 2-3 chars and type IDs exactly 2 (per the
// reference data), optionally followed by more segments. Broader than the
// Python's `{2}-{2}` — that regex misses 3-char vendor IDs (e.g. `CHR-CH`),
// which would be re-hashed on round-trip; `{2,3}-{2}` still matches zero real
// supplier codes in the reference exports, so parity is preserved.
const HOUSE_SKU_RE = /^[A-Z0-9]{2,3}-[A-Z0-9]{2}(-|$)/;

// Substring that marks the supplier-SKU metafield column. We match on the bare
// `namespace.key` so both Matrixify header styles are recognized: the xlsx
// `Variant Metafield: custom.supplier_sku [single_line_text_field]` and the csv
// `Supplier SKU (variant.metafields.custom.supplier_sku)`. Broader than the
// Python (which keys on `metafields.custom.supplier_sku`) — required because the
// xlsx style carries no literal `metafields.` prefix.
const SUPPLIER_COLUMN_KEY = SUPPLIER_SKU_METAFIELD_KEY.toLowerCase();

export function isHouseSku(str) {
  return HOUSE_SKU_RE.test(s(str));
}

export function supplierSkuColumn(header) {
  if (!header) return null;
  for (const col of header) {
    if (s(col).toLowerCase().includes(SUPPLIER_COLUMN_KEY)) return col;
  }
  return null;
}

export function resolveSupplierSku(row, supplierCol) {
  if (supplierCol) {
    const meta = s(row[supplierCol]).trim();
    if (meta) return meta;
  }
  const variantSku = s(row["Variant SKU"]).trim();
  if (variantSku && !isHouseSku(variantSku)) return variantSku;
  return "";
}

export function buildSegments(row, filledNames, refs) {
  const segments = [];
  OPTION_SLOTS.forEach(([, valueCol], i) => {
    const name = filledNames[i];
    const value = s(row[valueCol]);
    if (!(s(name).trim() && value.trim())) return;
    const c = refs.concept.get(name);
    if (c === undefined) { row.__unresolvedOption = name; return; }
    if (c.concept === TITLE_CONCEPT) return;
    const nv = refs.value.get(valueKey(c.conceptId, value)) ?? value.toUpperCase();
    segments.push(`${c.conceptId}_${nv}`);
  });
  return segments;
}

function buildCore(prefix, segments) {
  return [prefix, ...segments].join("-");
}

function assignProduct(product, refs, supplierCol) {
  const assignments = [];
  const filled = ["", "", ""];
  for (const row of product.rows) {
    OPTION_SLOTS.forEach(([nameCol], i) => {
      const cell = s(row[nameCol]);
      if (cell.trim()) filled[i] = cell;
    });

    // Resolve the durable supplier code first — even for unresolved-prefix rows,
    // so a real code is captured into the metafield and never lost.
    const supplierSku = resolveSupplierSku(row, supplierCol);

    if (product.prefix === null) {
      assignments.push({ handle: product.handle, product, row, providerAnchored: false,
        providerSku: "", supplierSku, core: null, sku: null, unresolvedOption: false });
      continue;
    }

    if (supplierSku) {
      assignments.push({ handle: product.handle, product, row, providerAnchored: true,
        providerSku: supplierSku, supplierSku, core: "",
        sku: `${product.prefix}-${hash6(supplierSku)}`, unresolvedOption: false });
    } else {
      delete row.__unresolvedOption;
      const core = buildCore(product.prefix, buildSegments(row, [...filled], refs));
      assignments.push({ handle: product.handle, product, row, providerAnchored: false,
        providerSku: "", supplierSku: "", core, sku: null,
        unresolvedOption: Boolean(row.__unresolvedOption) });
    }
  }
  return assignments;
}

export function assignPass1(products, refs, supplierCol = null) {
  const assignments = [];
  for (const product of products) assignments.push(...assignProduct(product, refs, supplierCol));
  const providerCount = assignments.filter((a) => a.providerAnchored).length;
  return { assignments, providerCount, generatedCount: assignments.length - providerCount };
}

export function assignPass2(pass1) {
  const counts = new Map();
  for (const a of pass1.assignments) {
    if (a.providerAnchored || a.core === null) continue;
    counts.set(a.core, (counts.get(a.core) || 0) + 1);
  }
  let colliderCount = 0;
  for (const a of pass1.assignments) {
    if (a.providerAnchored || a.core === null) continue; // null-prefix keeps sku=null
    if (counts.get(a.core) > 1) { a.sku = `${a.core}-${hash4(a.handle)}`; colliderCount++; }
    else a.sku = a.core;
  }
  return { assignments: pass1.assignments, colliderCount };
}
