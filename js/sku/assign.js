import { hash6, hash4 } from "./hash.js";
import { valueKey } from "./loaders.js";

const OPTION_SLOTS = [
  ["Option1 Name", "Option1 Value"],
  ["Option2 Name", "Option2 Value"],
  ["Option3 Name", "Option3 Value"],
];
const TITLE_CONCEPT = "TITLE";
const s = (v) => (v === undefined || v === null ? "" : String(v));

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

function assignProduct(product, refs) {
  const assignments = [];
  const filled = ["", "", ""];
  for (const row of product.rows) {
    OPTION_SLOTS.forEach(([nameCol], i) => {
      const cell = s(row[nameCol]);
      if (cell.trim()) filled[i] = cell;
    });

    if (product.prefix === null) {
      assignments.push({ handle: product.handle, product, row, providerAnchored: false,
        providerSku: "", core: null, sku: null, unresolvedOption: false });
      continue;
    }

    const providerSku = s(row["Variant SKU"]);
    if (providerSku.trim()) {
      assignments.push({ handle: product.handle, product, row, providerAnchored: true,
        providerSku, core: "", sku: `${product.prefix}-${hash6(providerSku)}`, unresolvedOption: false });
    } else {
      delete row.__unresolvedOption;
      const core = buildCore(product.prefix, buildSegments(row, [...filled], refs));
      assignments.push({ handle: product.handle, product, row, providerAnchored: false,
        providerSku: "", core, sku: null, unresolvedOption: Boolean(row.__unresolvedOption) });
    }
  }
  return assignments;
}

export function assignPass1(products, refs) {
  const assignments = [];
  for (const product of products) assignments.push(...assignProduct(product, refs));
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
