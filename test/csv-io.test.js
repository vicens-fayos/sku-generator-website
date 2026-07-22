import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCSV, aoaToCSV } from "../js/csv.js";
import { buildReferences } from "../js/sku/loaders.js";
import { generate } from "../js/sku/engine.js";
import { buildReimportCsv } from "../js/matrixify.js";
import { SUPPLIER_SKU_FIELD } from "../js/sku/config.js";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), "utf-8");

const refs = buildReferences({
  vendor: read("../data/vendor_mapping_canonical.csv"),
  type: read("../data/type_mapping_canonical.csv"),
  typeAbv: read("../data/type_abv_reference.csv"),
  optionNames: read("../data/option_names_canonical.csv"),
  optionValues: read("../data/option_values_linked_canonical.csv"),
});

test("aoaToCSV escapes and joins with CRLF", () => {
  assert.equal(aoaToCSV([["a", "b"], ["x,y", 'q"z']]), 'a,b\r\n"x,y","q""z"');
});

test("full CSV export → CSV out preserves rows/columns and fills SKUs", () => {
  const input = parseCSV(read("fixtures/export_effecto.csv"));
  const golden = parseCSV(read("fixtures/export_effecto_with_skus.csv"));
  const result = generate(input.rows, refs, input.header);

  const csvOut = buildReimportCsv(input.header, input.rows, result);
  const reparsed = parseCSV(csvOut);

  // Same row count; effecto already has a Variant Barcode column, so none is appended.
  assert.equal(reparsed.rows.length, input.rows.length);
  assert.ok(input.header.includes(SUPPLIER_SKU_FIELD), "fixture already has Variant Barcode");
  assert.equal(reparsed.header.length, input.header.length, "no column appended");
  assert.ok(input.header.every((c) => reparsed.header.includes(c)), "original columns preserved");

  // Every variant row's Variant SKU matches the Python golden (byte-identical path).
  let mismatches = 0;
  for (let i = 0; i < reparsed.rows.length; i++) {
    const want = golden.rows[i]["Variant SKU"] || "";
    if (reparsed.rows[i]["Variant SKU"] !== want) mismatches++;
  }
  assert.equal(mismatches, 0);
});

test("supplier code is captured into Variant Barcode on first run", () => {
  const input = parseCSV(read("fixtures/export_effecto.csv"));
  const result = generate(input.rows, refs, input.header);
  const reparsed = parseCSV(buildReimportCsv(input.header, input.rows, result));

  // Pick a provider-anchored variant (had a non-house Variant SKU originally).
  let checked = 0;
  for (let i = 0; i < input.rows.length && checked < 3; i++) {
    const orig = (input.rows[i]["Variant SKU"] || "").trim();
    if (orig && !/^[A-Z0-9]{2,3}-[A-Z0-9]{2}(-|$)/.test(orig)) {
      assert.equal(reparsed.rows[i][SUPPLIER_SKU_FIELD], orig, "supplier code carried in Variant Barcode");
      assert.ok(/^[A-Z0-9]{2,3}-[A-Z0-9]{2}/.test(reparsed.rows[i]["Variant SKU"]), "house SKU written");
      checked++;
    }
  }
  assert.ok(checked > 0, "found provider-anchored rows to verify");
});
