import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCSV } from "../js/csv.js";
import { buildReferences } from "../js/sku/loaders.js";
import { generate } from "../js/sku/engine.js";
import { SUPPLIER_SKU_COLUMN } from "../js/sku/config.js";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), "utf-8");

const refs = buildReferences({
  vendor: read("../data/vendor_mapping_canonical.csv"),
  type: read("../data/type_mapping_canonical.csv"),
  typeAbv: read("../data/type_abv_reference.csv"),
  optionNames: read("../data/option_names_canonical.csv"),
  optionValues: read("../data/option_values_linked_canonical.csv"),
});

// Simulate what the store returns after importing the generated file and
// re-exporting: Variant SKU now holds the house SKU, and the supplier code
// lives in the supplier metafield column. Image rows are untouched.
function roundTrip(rows, header, result) {
  const outHeader = header.includes(SUPPLIER_SKU_COLUMN) ? header : [...header, SUPPLIER_SKU_COLUMN];
  const outRows = rows.map((row, i) => {
    const r = result.rows[i];
    const copy = {};
    for (const c of outHeader) copy[c] = row[c] !== undefined ? row[c] : "";
    if (r.isVariant) {
      if (r.sku !== "") copy["Variant SKU"] = r.sku; // house SKU written back
      copy[SUPPLIER_SKU_COLUMN] = r.supplierSku;       // durable code preserved
    }
    return copy;
  });
  return { header: outHeader, rows: outRows };
}

test("regeneration after round-trip is idempotent (no double-hash)", () => {
  const parsed = parseCSV(read("fixtures/export_effecto.csv"));
  const header = parsed.header;

  const run1 = generate(parsed.rows, refs, header);

  // Round-trip once and regenerate.
  const rt1 = roundTrip(parsed.rows, header, run1);
  const run2 = generate(rt1.rows, refs, rt1.header);

  const skus1 = run1.rows.map((r) => r.sku);
  const skus2 = run2.rows.map((r) => r.sku);
  assert.deepEqual(skus2, skus1, "SKUs changed after round-trip");

  // Round-trip a second time — still stable.
  const rt2 = roundTrip(rt1.rows, rt1.header, run2);
  const run3 = generate(rt2.rows, refs, rt2.header);
  assert.deepEqual(run3.rows.map((r) => r.sku), skus1, "SKUs drifted on 2nd round-trip");
});

test("supplier code is preserved through round-trips", () => {
  const parsed = parseCSV(read("fixtures/export_effecto.csv"));
  const run1 = generate(parsed.rows, refs, parsed.header);
  const rt1 = roundTrip(parsed.rows, parsed.header, run1);
  const run2 = generate(rt1.rows, refs, rt1.header);

  const supplier1 = run1.rows.map((r) => r.supplierSku);
  const supplier2 = run2.rows.map((r) => r.supplierSku);
  assert.deepEqual(supplier2, supplier1, "supplier codes not preserved");

  // Every provider-anchored variant kept a non-empty supplier code.
  const providerVariants = run1.rows.filter((r) => r.isVariant && r.supplierSku !== "");
  assert.ok(providerVariants.length > 0);
  assert.ok(providerVariants.every((r) => r.sku !== ""));
});
