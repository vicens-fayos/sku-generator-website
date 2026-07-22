import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReferences, valueKey } from "../js/sku/loaders.js";

const texts = {
  vendor: "raw_vendor,vendor_brand,vendor_abv\nAEA,AEA,AE\n,,\nFoo Bar,Foo,FB\n",
  type: "raw,normalized,id,needs_review\nAdaptor,ADAPTORS,AD,no\nWeird,OTHERS,OT,yes\n,,,\n",
  typeAbv: "type_group,type_abv,source\nACCESSORIES,AC,employee\n",
  optionNames: "raw_option_name,concept,concept_id,needs_review\n SYSYEM,SYSTEM,SYS,no\nColor,COLOR,COL,no\n",
  optionValues:
    "option_name_normalized,concept,concept_id,name_needs_review,raw_option_value,normalized_option_value\n" +
    "COLOR,COLOR,COL,no,Red,RED\n",
};

test("builds vendor lookup, skipping blank raw", () => {
  const refs = buildReferences(texts);
  assert.equal(refs.vendor.get("AEA"), "AE");
  assert.equal(refs.vendor.get("Foo Bar"), "FB");
  assert.equal(refs.vendor.has(""), false);
});

test("type lookup carries needsReview flag", () => {
  const refs = buildReferences(texts);
  assert.deepEqual(refs.type.get("Adaptor"), { id: "AD", needsReview: false });
  assert.deepEqual(refs.type.get("Weird"), { id: "OT", needsReview: true });
});

test("typeGroup unions abv reference and type map normalized ids, upper-cased", () => {
  const refs = buildReferences(texts);
  assert.equal(refs.typeGroup.get("ACCESSORIES"), "AC");
  assert.equal(refs.typeGroup.get("ADAPTORS"), "AD"); // from type map normalized
  assert.equal(refs.typeGroup.get("OTHERS"), "OT");
});

test("concept preserves leading-space keys", () => {
  const refs = buildReferences(texts);
  assert.deepEqual(refs.concept.get(" SYSYEM"), { concept: "SYSTEM", conceptId: "SYS" });
});

test("value keyed by conceptId + raw value", () => {
  const refs = buildReferences(texts);
  assert.equal(refs.value.get(valueKey("COL", "Red")), "RED");
});

test("throws on typeGroup conflict", () => {
  const bad = { ...texts, typeAbv: "type_group,type_abv,source\nACCESSORIES,AC,x\nACCESSORIES,ZZ,y\n" };
  assert.throws(() => buildReferences(bad), /TYPE_GROUP conflict/);
});
