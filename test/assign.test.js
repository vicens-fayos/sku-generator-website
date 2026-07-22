import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSegments, assignPass1, assignPass2 } from "../js/sku/assign.js";
import { buildReferences } from "../js/sku/loaders.js";
import { groupProducts } from "../js/sku/classify.js";
import { hash6, hash4 } from "../js/sku/hash.js";

const refs = buildReferences({
  vendor: "raw_vendor,vendor_brand,vendor_abv\nAEA,AEA,AE\n",
  type: "raw,normalized,id,needs_review\nSlugs,AMMO,AM,no\n",
  typeAbv: "type_group,type_abv,source\nAMMO,AM,x\n",
  optionNames: "raw_option_name,concept,concept_id,needs_review\nColor,COLOR,COL,no\nTitle,TITLE,TTL,no\n",
  optionValues: "option_name_normalized,concept,concept_id,name_needs_review,raw_option_value,normalized_option_value\nCOLOR,COLOR,COL,no,Red,RED\n",
});

const base = { Handle: "", Title: "", Vendor: "AEA", Type: "Slugs", "Variant Price": "",
  "Option1 Name": "", "Option1 Value": "", "Option2 Name": "", "Option2 Value": "",
  "Option3 Name": "", "Option3 Value": "", "Variant SKU": "" };

test("buildSegments resolves value, upper-cases fallback, skips TITLE", () => {
  const row = { ...base, "Option1 Value": "Red", "Option2 Value": "Large", "Option3 Value": "x" };
  const seg = buildSegments(row, ["Color", "Color", "Title"], refs);
  assert.deepEqual(seg, ["COL_RED", "COL_LARGE"]); // slot3 Title skipped
});

test("provider-anchored SKU is prefix + HASH6(providerSku)", () => {
  const rows = [{ ...base, Handle: "h", Title: "AEA Slugs", "Variant SKU": "PROV123" }];
  const products = groupProducts(rows, refs);
  const p1 = assignPass1(products, refs);
  const p2 = assignPass2(p1);
  assert.equal(p2.assignments[0].sku, `AE-AM-${hash6("PROV123")}`);
  assert.equal(p1.providerCount, 1);
});

test("generated unique core written as-is", () => {
  const rows = [{ ...base, Handle: "h", Title: "AEA Slugs", "Option1 Name": "Color", "Option1 Value": "Red" }];
  const p2 = assignPass2(assignPass1(groupProducts(rows, refs), refs));
  assert.equal(p2.assignments[0].sku, "AE-AM-COL_RED");
});

test("colliding generated cores get HASH4(handle) suffix", () => {
  const rows = [
    { ...base, Handle: "h1", Title: "AEA Slugs" },
    { ...base, Handle: "h2", Title: "AEA Slugs" },
  ];
  const p2 = assignPass2(assignPass1(groupProducts(rows, refs), refs));
  assert.equal(p2.colliderCount, 2);
  assert.equal(p2.assignments[0].sku, `AE-AM-${hash4("h1")}`);
  assert.equal(p2.assignments[1].sku, `AE-AM-${hash4("h2")}`);
});

test("unresolved option name is skipped and flagged", () => {
  const rows = [{ ...base, Handle: "h", Title: "AEA Slugs", "Option1 Name": "Nope", "Option1 Value": "V" }];
  const p2 = assignPass2(assignPass1(groupProducts(rows, refs), refs));
  assert.equal(p2.assignments[0].unresolvedOption, true);
  assert.equal(p2.assignments[0].sku, "AE-AM"); // no segment added
});

test("null-prefix product yields null sku", () => {
  const rows = [{ ...base, Handle: "h", Title: "T", Vendor: "Unknown" }];
  const p2 = assignPass2(assignPass1(groupProducts(rows, refs), refs));
  assert.equal(p2.assignments[0].sku, null);
});
