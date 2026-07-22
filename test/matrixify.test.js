import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildReimportAoa } from "../js/matrixify.js";
import { SUPPLIER_SKU_COLUMN } from "../js/sku/config.js";

const here = dirname(fileURLToPath(import.meta.url));

// Load vendored SheetJS into globalThis so the workbook path can be exercised.
const sheetjs = readFileSync(join(here, "../vendor/xlsx.full.min.js"), "utf-8");
(0, eval)(sheetjs);

test("appends supplier column and sets Variant SKU on variant rows", () => {
  const header = ["Handle", "Title", "Variant SKU"];
  const rows = [
    { Handle: "h", Title: "T", "Variant SKU": "SUPPLIER-1" },
    { Handle: "h", Title: "", "Variant SKU": "" }, // image row
  ];
  const result = {
    rows: [
      { isVariant: true, sku: "AE-AM-ABC123", supplierSku: "SUPPLIER-1" },
      { isVariant: false, sku: "", supplierSku: "" },
    ],
  };
  const aoa = buildReimportAoa(header, rows, result);
  assert.deepEqual(aoa[0], ["Handle", "Title", "Variant SKU", SUPPLIER_SKU_COLUMN]);
  assert.deepEqual(aoa[1], ["h", "T", "AE-AM-ABC123", "SUPPLIER-1"]); // variant: house SKU + code
  assert.deepEqual(aoa[2], ["h", "", "", ""]);                        // image row untouched
});

test("reuses an existing supplier metafield column", () => {
  const col = "Variant Metafield: custom.supplier_sku [single_line_text_field]";
  const header = ["Handle", "Variant SKU", col];
  const rows = [{ Handle: "h", "Variant SKU": "OLD", [col]: "CODE" }];
  const result = { rows: [{ isVariant: true, sku: "AE-AM-1", supplierSku: "CODE" }] };
  const aoa = buildReimportAoa(header, rows, result);
  assert.equal(aoa[0].length, 3); // no extra column appended
  assert.deepEqual(aoa[1], ["h", "AE-AM-1", "CODE"]);
});

test("unresolved variant row keeps its original Variant SKU", () => {
  const header = ["Handle", "Variant SKU"];
  const rows = [{ Handle: "h", "Variant SKU": "REAL-CODE" }];
  const result = { rows: [{ isVariant: true, sku: "", supplierSku: "REAL-CODE" }] };
  const aoa = buildReimportAoa(header, rows, result);
  assert.equal(aoa[1][1], "REAL-CODE"); // not blanked
});

test("buildReimport output re-reads via readProducts", async () => {
  const { buildReimport } = await import("../js/matrixify.js");
  const { readProducts } = await import("../js/xlsx.js");
  const header = ["Handle", "Title", "Variant SKU"];
  const rows = [{ Handle: "h", Title: "T", "Variant SKU": "SUP" }];
  const result = { rows: [{ isVariant: true, sku: "AE-AM-9", supplierSku: "SUP" }] };
  const buf = buildReimport(header, rows, result);
  const back = readProducts(buf);
  assert.deepEqual(back.header, ["Handle", "Title", "Variant SKU", SUPPLIER_SKU_COLUMN]);
  assert.equal(back.rows[0]["Variant SKU"], "AE-AM-9");
  assert.equal(back.rows[0][SUPPLIER_SKU_COLUMN], "SUP");
});
