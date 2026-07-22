import { test } from "node:test";
import assert from "node:assert/strict";
import { isHouseSku, supplierSkuColumn, resolveSupplierSku } from "../js/sku/assign.js";

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

test("supplierSkuColumn finds the metafield column regardless of prefix/scope", () => {
  assert.equal(
    supplierSkuColumn(["Handle", "Variant Metafield: custom.supplier_sku [single_line_text_field]"]),
    "Variant Metafield: custom.supplier_sku [single_line_text_field]"
  );
  assert.equal(
    supplierSkuColumn(["Handle", "Supplier SKU (variant.metafields.custom.supplier_sku)"]),
    "Supplier SKU (variant.metafields.custom.supplier_sku)"
  );
  assert.equal(supplierSkuColumn(["Handle", "Variant SKU"]), null);
  assert.equal(supplierSkuColumn([]), null);
  assert.equal(supplierSkuColumn(undefined), null);
});

test("resolveSupplierSku: metafield takes precedence", () => {
  const col = "Variant Metafield: custom.supplier_sku [single_line_text_field]";
  const row = { "Variant SKU": "AE-AM-95286A", [col]: "REAL-CODE-1" };
  assert.equal(resolveSupplierSku(row, col), "REAL-CODE-1");
});

test("resolveSupplierSku: first-run falls back to non-house Variant SKU", () => {
  const row = { "Variant SKU": "AEAM-S-58-291" };
  assert.equal(resolveSupplierSku(row, null), "AEAM-S-58-291");
});

test("resolveSupplierSku: house-format Variant SKU is ignored (no double-hash)", () => {
  const row = { "Variant SKU": "AE-AM-95286A" };
  assert.equal(resolveSupplierSku(row, null), "");
});

test("resolveSupplierSku: blank metafield falls through to Variant SKU", () => {
  const col = "Variant Metafield: custom.supplier_sku [single_line_text_field]";
  const row = { "Variant SKU": "AEAM-S-58-291", [col]: "  " };
  assert.equal(resolveSupplierSku(row, col), "AEAM-S-58-291");
});

test("resolveSupplierSku: nothing resolvable yields empty string", () => {
  assert.equal(resolveSupplierSku({ "Variant SKU": "" }, null), "");
});
