// Builds the re-import file: the uploaded export returned with `Variant SKU`
// set to the house SKU and the supplier code carried in the native
// `Variant Barcode` field (supplier code for provider variants, cleared for
// generated ones). Native Shopify CSV round-trips `Variant Barcode` reliably,
// unlike variant metafields. Real exports already contain the column, so none
// is appended in practice; the `includes` guard only helps trimmed fixtures.
// Serializes to xlsx (SheetJS) or CSV.

import { SUPPLIER_SKU_FIELD } from "./sku/config.js";
import { aoaToCSV } from "./csv.js";

const s = (v) => (v === undefined || v === null ? "" : String(v));

// Produce the enriched array-of-arrays (header row + data rows). Exported for
// testing without a workbook. `result.rows` must align by index with `rows`.
export function buildReimportAoa(header, rows, result) {
  const field = SUPPLIER_SKU_FIELD; // "Variant Barcode"
  const outHeader = header.includes(field) ? [...header] : [...header, field];

  const aoa = [outHeader];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const r = result.rows[i];
    const cell = {};
    for (const col of outHeader) cell[col] = s(row[col]);
    if (r && r.isVariant) {
      // Never blank a real code: only overwrite Variant SKU when we have a house SKU.
      if (r.sku !== "") cell["Variant SKU"] = r.sku;
      cell[field] = s(r.supplierSku); // supplier code, or "" clears it (generated rows)
    }
    aoa.push(outHeader.map((col) => cell[col]));
  }
  return aoa;
}

export function buildReimport(header, rows, result) {
  const XLSX = globalThis.XLSX;
  if (!XLSX) throw new Error("SheetJS (XLSX) not loaded");
  const aoa = buildReimportAoa(header, rows, result);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Products");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" });
}

// CSV variant of buildReimport: the full export as CSV text, Variant SKU filled
// and the supplier metafield column added/filled. Mirrors Python's
// export_with_skus.csv (plus the supplier column).
export function buildReimportCsv(header, rows, result) {
  return aoaToCSV(buildReimportAoa(header, rows, result));
}
