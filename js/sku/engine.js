import { groupProducts } from "./classify.js";
import { assignPass1, assignPass2, supplierSkuColumn } from "./assign.js";

const s = (v) => (v === undefined || v === null ? "" : String(v));

export function generate(rows, refs, header) {
  const cols = header || (rows[0] ? Object.keys(rows[0]) : []);
  const supplierCol = supplierSkuColumn(cols);
  const products = groupProducts(rows, refs);
  const pass1 = assignPass1(products, refs, supplierCol);
  const pass2 = assignPass2(pass1);

  // Map each variant row object -> its assignment (row objects are shared references).
  const byRow = new Map();
  for (const a of pass2.assignments) byRow.set(a.row, a);

  const vendorMissing = new Set();
  const typeMissing = new Set();
  const optionMissing = new Set();
  let unresolvedRows = 0;

  const out = rows.map((row) => {
    const a = byRow.get(row);
    if (!a) {
      return { handle: s(row.Handle), title: s(row.Title), sku: "", supplierSku: "", reviewReason: null, isVariant: false };
    }
    const p = a.product;
    let reviewReason = p.reviewReason;
    if (p.reviewReason === "UNRESOLVED_VENDOR") vendorMissing.add(p.rawVendor);
    if (p.reviewReason === "UNRESOLVED_TYPE") typeMissing.add(p.rawType);
    if (a.unresolvedOption) {
      optionMissing.add(a.row.__unresolvedOption);
      if (!reviewReason) reviewReason = "UNRESOLVED_OPTION";
    }
    const sku = a.sku === null || a.sku === undefined ? "" : a.sku;
    if (sku === "" || reviewReason === "UNRESOLVED_OPTION") unresolvedRows++;
    return { handle: p.handle, title: s(row.Title), sku, supplierSku: a.supplierSku, reviewReason, isVariant: true };
  });

  const review = products.filter((p) => p.reviewReason).length;
  const stats = {
    variantRows: pass2.assignments.length,
    imageRows: out.length - pass2.assignments.length,
    providerAnchored: pass1.providerCount,
    generated: pass1.generatedCount,
    collidersHandleHashed: pass2.colliderCount,
    review,
    unresolvedRows,
  };
  const sortUniq = (set) => [...set].sort();
  return {
    rows: out,
    warnings: { vendor: sortUniq(vendorMissing), type: sortUniq(typeMissing), option: sortUniq(optionMissing) },
    stats,
  };
}
