import { test } from "node:test";
import assert from "node:assert/strict";
import { generate } from "../js/sku/engine.js";
import { buildReferences } from "../js/sku/loaders.js";

const refs = buildReferences({
  vendor: "raw_vendor,vendor_brand,vendor_abv\nAEA,AEA,AE\n",
  type: "raw,normalized,id,needs_review\nSlugs,AMMO,AM,no\n",
  typeAbv: "type_group,type_abv,source\nAMMO,AM,x\n",
  optionNames: "raw_option_name,concept,concept_id,needs_review\nColor,COLOR,COL,no\n",
  optionValues: "option_name_normalized,concept,concept_id,name_needs_review,raw_option_value,normalized_option_value\n",
});
const base = { Handle: "", Title: "", Vendor: "AEA", Type: "Slugs", "Variant Price": "",
  "Option1 Name": "", "Option1 Value": "", "Option2 Name": "", "Option2 Value": "",
  "Option3 Name": "", "Option3 Value": "", "Variant SKU": "", "Image Src": "" };

test("preserves row order; image rows blank & non-variant", () => {
  const rows = [
    { ...base, Handle: "h", Title: "AEA Slugs", "Variant SKU": "P1" },
    { ...base, Handle: "h", "Image Src": "img.jpg" }, // continuation/image row
  ];
  const { rows: out, stats } = generate(rows, refs);
  assert.equal(out.length, 2);
  assert.equal(out[0].isVariant, true);
  assert.notEqual(out[0].sku, "");
  assert.equal(out[1].isVariant, false);
  assert.equal(out[1].sku, "");
  assert.equal(stats.variantRows, 1);
  assert.equal(stats.imageRows, 1);
});

test("collects distinct unresolved keys sorted", () => {
  const rows = [
    { ...base, Handle: "a", Title: "T", Vendor: "ZCo" },
    { ...base, Handle: "b", Title: "T", Vendor: "ACo" },
    { ...base, Handle: "c", Title: "T", Type: "Weird" },
    { ...base, Handle: "d", Title: "AEA Slugs", "Option1 Name": "Size", "Option1 Value": "L" },
  ];
  const { warnings, stats } = generate(rows, refs);
  assert.deepEqual(warnings.vendor, ["ACo", "ZCo"]);
  assert.deepEqual(warnings.type, ["Weird"]);
  assert.deepEqual(warnings.option, ["Size"]);
  assert.ok(stats.unresolvedRows >= 3);
});

test("stats count provider vs generated vs colliders", () => {
  const rows = [
    { ...base, Handle: "h1", Title: "AEA Slugs" },
    { ...base, Handle: "h2", Title: "AEA Slugs" },
    { ...base, Handle: "h3", Title: "AEA Slugs", "Variant SKU": "P9" },
  ];
  const { stats } = generate(rows, refs);
  assert.equal(stats.providerAnchored, 1);
  assert.equal(stats.generated, 2);
  assert.equal(stats.collidersHandleHashed, 2);
});
