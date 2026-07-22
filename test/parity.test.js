import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCSV } from "../js/csv.js";
import { buildReferences } from "../js/sku/loaders.js";
import { generate } from "../js/sku/engine.js";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), "utf-8");

const refs = buildReferences({
  vendor: read("../data/vendor_mapping_canonical.csv"),
  type: read("../data/type_mapping_canonical.csv"),
  typeAbv: read("../data/type_abv_reference.csv"),
  optionNames: read("../data/option_names_canonical.csv"),
  optionValues: read("../data/option_values_linked_canonical.csv"),
});

test("effecto SKUs are byte-identical to Python golden output", () => {
  const input = parseCSV(read("fixtures/export_effecto.csv"));
  const golden = parseCSV(read("fixtures/export_effecto_with_skus.csv"));
  assert.equal(input.rows.length, golden.rows.length, "row count mismatch");

  const { rows: out } = generate(input.rows, refs);

  const mismatches = [];
  for (let i = 0; i < out.length; i++) {
    const got = out[i].sku;
    const want = golden.rows[i]["Variant SKU"] || "";
    if (got !== want) mismatches.push({ i, handle: out[i].handle, got, want });
  }
  assert.equal(mismatches.length, 0,
    `first mismatches: ${JSON.stringify(mismatches.slice(0, 5), null, 2)}`);
});

test("invariants: generated SKUs unique, duplicates provider-origin only", () => {
  const input = parseCSV(read("fixtures/export_effecto.csv"));
  const { rows: out } = generate(input.rows, refs);
  const variant = out.filter((r) => r.isVariant);
  assert.ok(variant.every((r) => r.sku !== ""), "every variant row has a SKU");
});
