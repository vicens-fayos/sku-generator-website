// Builds a Matrixify re-import workbook: the uploaded file returned with
// `Variant SKU` set to the house SKU and the supplier code written into the
// `custom.supplier_sku` variant-metafield column (added if the upload lacked
// one). Re-importing sets both, so the durable supplier code survives and
// re-runs stay idempotent. Uses the global XLSX (vendored SheetJS).

import { supplierSkuColumn } from "./sku/assign.js";
import { SUPPLIER_SKU_COLUMN } from "./sku/config.js";

const s = (v) => (v === undefined || v === null ? "" : String(v));

// Produce the enriched array-of-arrays (header row + data rows). Exported for
// testing without a workbook. `result.rows` must align by index with `rows`.
export function buildReimportAoa(header, rows, result) {
  const supplierCol = supplierSkuColumn(header) || SUPPLIER_SKU_COLUMN;
  const outHeader = header.includes(supplierCol) ? [...header] : [...header, supplierCol];

  const aoa = [outHeader];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const r = result.rows[i];
    const cell = {};
    for (const col of outHeader) cell[col] = s(row[col]);
    if (r && r.isVariant) {
      // Never blank a real code: only overwrite Variant SKU when we have a house SKU.
      if (r.sku !== "") cell["Variant SKU"] = r.sku;
      cell[supplierCol] = s(r.supplierSku);
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
