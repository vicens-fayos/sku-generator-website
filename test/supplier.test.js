import { test } from "node:test";
import assert from "node:assert/strict";
import { isHouseSku, resolveSupplierSku } from "../js/sku/assign.js";
import { SUPPLIER_SKU_FIELD } from "../js/sku/config.js";

test("isHouseSku recognizes our VENDOR-TYPE output, rejects supplier codes", () => {
  assert.equal(isHouseSku("AE-AM-95286A"), true);
  assert.equal(isHouseSku("AE-AM"), true);
  assert.equal(isHouseSku("CHR-CH"), true);        // 3-char vendor id
  assert.equal(isHouseSku("CHR-CH-32604A"), true); // 3-char vendor id + hash
  assert.equal(isHouseSku("PC-SU-HED_BOWL_HEAD-1A2B"), true);
  assert.equal(isHouseSku("AEAM-S-58-291"), false); // real supplier code: 4-char first group
  assert.equal(isHouseSku("SCFF-70_D"), false);
  assert.equal(isHouseSku(""), false);
});

test("resolveSupplierSku: first run uses non-house Variant SKU (ignores stray barcode)", () => {
  const row = { "Variant SKU": "AEAM-S-58-291", [SUPPLIER_SKU_FIELD]: "STRAY" };
  assert.equal(resolveSupplierSku(row), "AEAM-S-58-291");
});

test("resolveSupplierSku: already processed reads the code back from Variant Barcode", () => {
  const row = { "Variant SKU": "AE-AM-95286A", [SUPPLIER_SKU_FIELD]: "REAL-CODE-1" };
  assert.equal(resolveSupplierSku(row), "REAL-CODE-1");
});

test("resolveSupplierSku: house-format Variant SKU with no barcode yields '' (double-hash guard)", () => {
  const row = { "Variant SKU": "AE-AM-95286A" };
  assert.equal(resolveSupplierSku(row), "");
});

test("resolveSupplierSku: blank Variant SKU yields '' even with a stray barcode (golden-safe)", () => {
  assert.equal(resolveSupplierSku({ "Variant SKU": "", [SUPPLIER_SKU_FIELD]: "STRAY" }), "");
  assert.equal(resolveSupplierSku({ "Variant SKU": "" }), "");
});
