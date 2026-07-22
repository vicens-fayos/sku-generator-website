import { test } from "node:test";
import assert from "node:assert/strict";
import { isVariantRow, inferTypeGroup, groupProducts } from "../js/sku/classify.js";
import { buildReferences } from "../js/sku/loaders.js";

const refs = buildReferences({
  vendor: "raw_vendor,vendor_brand,vendor_abv\nAEA,AEA,AE\n",
  type: "raw,normalized,id,needs_review\nSlugs,AMMO,AM,no\nMystery,OTHERS,OT,yes\n",
  typeAbv: "type_group,type_abv,source\nAMMO,AM,x\nOTHERS,OT,x\nMOUNTS,MO,x\n",
  optionNames: "raw_option_name,concept,concept_id,needs_review\n",
  optionValues: "option_name_normalized,concept,concept_id,name_needs_review,raw_option_value,normalized_option_value\n",
});

const row = (o) => ({ Handle: "", Title: "", Vendor: "", Type: "", "Variant Price": "", ...o });

test("variant row detection", () => {
  assert.equal(isVariantRow(row({ Title: "X" })), true);
  assert.equal(isVariantRow(row({ "Variant Price": "9.99" })), true);
  assert.equal(isVariantRow(row({})), false);
});

test("title inference first-match wins with fallback", () => {
  assert.equal(inferTypeGroup("Long Range Slug pellet"), "AMMO"); // "slug" before "pellet", both AMMO
  assert.equal(inferTypeGroup("Sling Mount kit"), "MOUNTS");      // "sling mount" before "sling"
  assert.equal(inferTypeGroup("Opaque PH"), "OTHERS");
});

test("resolved type product builds prefix", () => {
  const rows = [row({ Handle: "h1", Title: "AEA Slugs", Vendor: "AEA", Type: "Slugs" })];
  const [p] = groupProducts(rows, refs);
  assert.equal(p.prefix, "AE-AM");
  assert.equal(p.reviewReason, null);
});

test("ambiguous type flagged", () => {
  const rows = [row({ Handle: "h", Title: "T", Vendor: "AEA", Type: "Mystery" })];
  assert.equal(groupProducts(rows, refs)[0].reviewReason, "AMBIGUOUS_TYPE");
});

test("blank type infers from title and flags", () => {
  const rows = [row({ Handle: "h", Title: "Box of Slugs", Vendor: "AEA", Type: "" })];
  const [p] = groupProducts(rows, refs);
  assert.equal(p.prefix, "AE-AM");
  assert.equal(p.reviewReason, "BLANK_TYPE_TITLE_GUESS");
});

test("unresolved vendor yields null prefix and flag", () => {
  const rows = [row({ Handle: "h", Title: "T", Vendor: "Unknown Co", Type: "Slugs" })];
  const [p] = groupProducts(rows, refs);
  assert.equal(p.prefix, null);
  assert.equal(p.reviewReason, "UNRESOLVED_VENDOR");
});

test("unresolved non-blank type yields null prefix and flag", () => {
  const rows = [row({ Handle: "h", Title: "T", Vendor: "AEA", Type: "Nope" })];
  const [p] = groupProducts(rows, refs);
  assert.equal(p.prefix, null);
  assert.equal(p.reviewReason, "UNRESOLVED_TYPE");
});

test("groups by handle preserving first-seen order", () => {
  const rows = [
    row({ Handle: "b", Title: "B", Vendor: "AEA", Type: "Slugs" }),
    row({ Handle: "a", Title: "A", Vendor: "AEA", Type: "Slugs" }),
    row({ Handle: "b", "Variant Price": "1" }),
  ];
  const ps = groupProducts(rows, refs);
  assert.deepEqual(ps.map((p) => p.handle), ["b", "a"]);
  assert.equal(ps[0].rows.length, 2);
});
