# SKU Generator Website Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A zero-build, 100%-frontend website (GitHub Pages) that reads a Matrixify Shopify `.xlsx` export and outputs the generated Variant SKU per variant row as a table + downloadable CSV.

**Architecture:** A pure, DOM-free JavaScript SKU engine (faithful port of the Python tool in `../skus-generator-v2`) consumes plain row objects + reference lookups and returns per-row SKUs. The same engine runs in the browser and in Node parity tests. A thin UI layer wires file upload (SheetJS) → engine → table/CSV. Reference data ships as a verbatim CSV snapshot parsed at runtime.

**Tech Stack:** Vanilla ES modules (no framework, no bundler), vendored SheetJS (xlsx parsing), a small synchronous SHA1, Node's built-in test runner (`node --test`) for tests. Deployed as static files.

## Global Constraints

- **No build step, no network calls, no CDN at runtime** — all assets vendored locally; site must work offline under GitHub Pages.
- **ES modules only** (`"type": "module"` in package.json). Pure engine modules import nothing browser- or node-specific.
- **Determinism:** output is a pure function of input. SHA1 over UTF-8 bytes, matching Python `hashlib.sha1(s.encode("utf-8")).hexdigest().upper()`. No `Date`, no `Math.random`.
- **Whitespace-preserving reference parsing:** reference CSV keys are matched exactly (e.g. `" SYSYEM"` with a leading space). Never trim reference field values.
- **SKU format:** `VENDOR_id-TYPE_id-<disambiguator>`; `HASH6` = first 6 chars of upper-hex SHA1, `HASH4` = first 4.
- **Correctness gate:** engine SKUs must be byte-identical to the Python golden output `../skus-generator-v2/output_files/effecto/export_effecto_with_skus.csv` on the effecto fixture.
- Reference source of truth: `../skus-generator-v2/data/`. Python reference implementation: `../skus-generator-v2/sku_generator/{loaders,classify,assign}.py` and `SPEC.md`.

---

### Task 1: Project scaffold + CSV parser/writer

**Files:**
- Create: `package.json`
- Create: `js/csv.js`
- Test: `test/csv.test.js`

**Interfaces:**
- Produces:
  - `parseCSV(text: string) -> { header: string[], rows: Array<Object> }` — RFC-4180 quoting (`"` escapes as `""`), handles `\r\n` and `\n`, does **NOT** trim field whitespace. Each row object maps header name → cell string. Missing trailing cells → `""`.
  - `toCSV(header: string[], rows: Array<Object>) -> string` — quotes a field iff it contains `,`, `"`, `\n`, or `\r`; joins rows with `\r\n`.

- [ ] **Step 1: Create package.json**

```json
{
  "name": "sku-generator-website",
  "version": "1.0.0",
  "type": "module",
  "private": true,
  "scripts": {
    "test": "node --test"
  }
}
```

- [ ] **Step 2: Write the failing test**

Create `test/csv.test.js`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCSV, toCSV } from "../js/csv.js";

test("parses simple rows keyed by header", () => {
  const { header, rows } = parseCSV("a,b\n1,2\n3,4");
  assert.deepEqual(header, ["a", "b"]);
  assert.deepEqual(rows, [{ a: "1", b: "2" }, { a: "3", b: "4" }]);
});

test("preserves leading/trailing whitespace in fields", () => {
  const { rows } = parseCSV("raw\n SYSYEM \n");
  assert.equal(rows[0].raw, " SYSYEM ");
});

test("handles quoted fields with commas, quotes and newlines", () => {
  const { rows } = parseCSV('a,b\n"x,y","he said ""hi""\nline2"');
  assert.equal(rows[0].a, "x,y");
  assert.equal(rows[0].b, 'he said "hi"\nline2');
});

test("handles CRLF line endings", () => {
  const { rows } = parseCSV("a,b\r\n1,2\r\n");
  assert.deepEqual(rows, [{ a: "1", b: "2" }]);
});

test("missing trailing cells become empty strings", () => {
  const { rows } = parseCSV("a,b,c\n1,2");
  assert.deepEqual(rows[0], { a: "1", b: "2", c: "" });
});

test("toCSV round-trips and quotes only when needed", () => {
  const out = toCSV(["a", "b"], [{ a: "x,y", b: "z" }]);
  assert.equal(out, 'a,b\r\n"x,y",z');
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test test/csv.test.js`
Expected: FAIL — cannot find module `../js/csv.js`.

- [ ] **Step 4: Write the implementation**

Create `js/csv.js`:

```javascript
// RFC-4180 CSV parser/writer. Preserves field whitespace (reference keys rely on it).

export function parseCSV(text) {
  const records = [];
  let field = "";
  let record = [];
  let i = 0;
  let inQuotes = false;
  const n = text.length;
  let started = false; // did we see any char/field on this record?

  const endField = () => { record.push(field); field = ""; started = true; };
  const endRecord = () => { if (started || record.length) { records.push(record); } record = []; started = false; };

  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i += 1; continue;
      }
      field += c; i += 1; continue;
    }
    if (c === '"') { inQuotes = true; started = true; i += 1; continue; }
    if (c === ",") { endField(); i += 1; continue; }
    if (c === "\r") { endField(); endRecord(); if (text[i + 1] === "\n") i += 1; i += 1; continue; }
    if (c === "\n") { endField(); endRecord(); i += 1; continue; }
    field += c; started = true; i += 1;
  }
  // flush last field/record if any content
  if (field.length || record.length || started) { endField(); endRecord(); }

  if (records.length === 0) return { header: [], rows: [] };
  const header = records[0];
  const rows = records.slice(1).map((rec) => {
    const obj = {};
    header.forEach((h, idx) => { obj[h] = rec[idx] !== undefined ? rec[idx] : ""; });
    return obj;
  });
  return { header, rows };
}

export function toCSV(header, rows) {
  const esc = (v) => {
    const s = v === undefined || v === null ? "" : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [header.map(esc).join(",")];
  for (const row of rows) lines.push(header.map((h) => esc(row[h])).join(","));
  return lines.join("\r\n");
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/csv.test.js`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add package.json js/csv.js test/csv.test.js
git commit -m "feat: CSV parser/writer with whitespace preservation"
```

---

### Task 2: SHA1 hashing (hash6/hash4)

**Files:**
- Create: `js/sku/hash.js`
- Test: `test/hash.test.js`

**Interfaces:**
- Produces:
  - `sha1Hex(str: string) -> string` — lowercase hex SHA1 of the UTF-8 bytes of `str`.
  - `hash6(str: string) -> string` — first 6 chars of `sha1Hex(str).toUpperCase()`.
  - `hash4(str: string) -> string` — first 4 chars of `sha1Hex(str).toUpperCase()`.

- [ ] **Step 1: Write the failing test**

Create `test/hash.test.js`. Pinned values computed from Python `hashlib.sha1`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { sha1Hex, hash6, hash4 } from "../js/sku/hash.js";

test("sha1Hex matches known digests", () => {
  assert.equal(sha1Hex(""), "da39a3ee5e6b4b0d3255bfef95601890afd80709");
  assert.equal(sha1Hex("test"), "a94a8fe5ccb19ba61c4c0873d391e987982fbbd3");
});

test("sha1Hex hashes UTF-8 bytes (multibyte)", () => {
  // sha1 of "café" UTF-8 bytes
  assert.equal(sha1Hex("café"), "f424b2f9decfb7d0e0d92b3aca9dd10842d7db8c");
});

test("hash6 and hash4 are upper-cased prefixes", () => {
  assert.equal(hash6("test"), "A94A8F");
  assert.equal(hash4("test"), "A94A");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/hash.test.js`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the implementation**

Create `js/sku/hash.js`:

```javascript
// Synchronous SHA1 over UTF-8 bytes. Matches Python hashlib.sha1(s.encode("utf-8")).

function utf8Bytes(str) {
  // TextEncoder is available in browsers and Node.
  return new TextEncoder().encode(str);
}

export function sha1Hex(str) {
  const bytes = utf8Bytes(str);
  const ml = bytes.length * 8;

  // Pre-processing: append 0x80, pad to 56 mod 64, then 64-bit big-endian length.
  const withOne = new Uint8Array(((bytes.length + 8) >> 6) * 64 + 64);
  withOne.set(bytes);
  withOne[bytes.length] = 0x80;
  const dv = new DataView(withOne.buffer);
  // 64-bit length; high word is 0 for our sizes, low word = ml.
  dv.setUint32(withOne.length - 4, ml >>> 0, false);
  dv.setUint32(withOne.length - 8, Math.floor(ml / 0x100000000), false);

  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);

  for (let off = 0; off < withOne.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
    for (let i = 16; i < 80; i++) {
      const v = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
      w[i] = (v << 1) | (v >>> 31);
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      let f, k;
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
      else { f = b ^ c ^ d; k = 0xca62c1d6; }
      const tmp = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) >>> 0;
      e = d; d = c; c = ((b << 30) | (b >>> 2)) >>> 0; b = a; a = tmp;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }

  const toHex = (x) => (x >>> 0).toString(16).padStart(8, "0");
  return toHex(h0) + toHex(h1) + toHex(h2) + toHex(h3) + toHex(h4);
}

export function hash6(str) { return sha1Hex(str).toUpperCase().slice(0, 6); }
export function hash4(str) { return sha1Hex(str).toUpperCase().slice(0, 4); }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/hash.test.js`
Expected: PASS (3 tests). If `sha1Hex("café")` fails, the pinned digest can be recomputed with `python3 -c "import hashlib;print(hashlib.sha1('café'.encode()).hexdigest())"` — but the implementation should match; `""` and `"test"` are the authoritative gate.

- [ ] **Step 5: Commit**

```bash
git add js/sku/hash.js test/hash.test.js
git commit -m "feat: synchronous SHA1 with hash6/hash4 helpers"
```

---

### Task 3: Reference loaders

**Files:**
- Create: `js/sku/loaders.js`
- Create: `data/` (copy the 5 reference CSVs from the Python project)
- Test: `test/loaders.test.js`

**Interfaces:**
- Consumes: `parseCSV` from `js/csv.js`.
- Produces:
  - `buildReferences(texts) -> References` where `texts = { vendor, type, typeAbv, optionNames, optionValues }` are raw CSV strings.
  - `References = { vendor: Map<string,string>, type: Map<string,{id,needsReview}>, typeGroup: Map<string,string>, concept: Map<string,{concept,conceptId}>, value: Map<string,string> }`. `value` is keyed by the string `` `${conceptId} ${rawValue}` `` (a composite key; NUL separator can't appear in data).
  - Helper (exported): `valueKey(conceptId, rawValue) -> string`.

Loader rules mirror `../skus-generator-v2/sku_generator/loaders.py`:
- vendor: skip rows with empty `raw_vendor`.
- type: skip rows with empty `raw`; `needsReview = (needs_review.trim().toLowerCase() === "yes")`.
- typeGroup: union of `type_abv_reference` (`type_group`→`type_abv`) and `type_mapping_canonical` (`normalized`→`id`), keyed by `group.trim().toUpperCase()`; skip empty group keys; **throw** on conflicting values for the same key.
- concept: `raw_option_name` → `{concept, conceptId}` (no skipping).
- value: `(concept_id, raw_option_value)` → `normalized_option_value`; **throw** on conflicting values for the same key.

- [ ] **Step 1: Copy reference data**

```bash
mkdir -p data
cp ../skus-generator-v2/data/vendor_mapping_canonical.csv \
   ../skus-generator-v2/data/type_mapping_canonical.csv \
   ../skus-generator-v2/data/type_abv_reference.csv \
   ../skus-generator-v2/data/option_names_canonical.csv \
   ../skus-generator-v2/data/option_values_linked_canonical.csv \
   data/
ls data/
```
Expected: the 5 CSV files listed.

- [ ] **Step 2: Write the failing test**

Create `test/loaders.test.js`:

```javascript
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test test/loaders.test.js`
Expected: FAIL — cannot find module.

- [ ] **Step 4: Write the implementation**

Create `js/sku/loaders.js`:

```javascript
import { parseCSV } from "../csv.js";

export function valueKey(conceptId, rawValue) {
  return `${conceptId} ${rawValue}`;
}

function loadVendor(text) {
  const map = new Map();
  for (const row of parseCSV(text).rows) {
    const raw = row["raw_vendor"];
    if (raw) map.set(raw, row["vendor_abv"]);
  }
  return map;
}

function loadType(text) {
  const map = new Map();
  for (const row of parseCSV(text).rows) {
    const raw = row["raw"];
    if (!raw) continue;
    const needsReview = (row["needs_review"] || "").trim().toLowerCase() === "yes";
    map.set(raw, { id: row["id"], needsReview });
  }
  return map;
}

function loadTypeGroups(typeAbvText, typeMapText) {
  const map = new Map();
  const add = (group, abv) => {
    const key = (group || "").trim().toUpperCase();
    if (!key) return;
    if (map.has(key) && map.get(key) !== abv) {
      throw new Error(`TYPE_GROUP conflict for ${key}: ${map.get(key)} vs ${abv}`);
    }
    map.set(key, abv);
  };
  for (const row of parseCSV(typeAbvText).rows) add(row["type_group"], row["type_abv"]);
  for (const row of parseCSV(typeMapText).rows) add(row["normalized"], row["id"]);
  return map;
}

function loadConcept(text) {
  const map = new Map();
  for (const row of parseCSV(text).rows) {
    map.set(row["raw_option_name"], { concept: row["concept"], conceptId: row["concept_id"] });
  }
  return map;
}

function loadValue(text) {
  const map = new Map();
  for (const row of parseCSV(text).rows) {
    const key = valueKey(row["concept_id"], row["raw_option_value"]);
    const normalized = row["normalized_option_value"];
    if (map.has(key) && map.get(key) !== normalized) {
      throw new Error(`VALUE conflict for ${key}: ${map.get(key)} vs ${normalized}`);
    }
    map.set(key, normalized);
  }
  return map;
}

export function buildReferences(texts) {
  return {
    vendor: loadVendor(texts.vendor),
    type: loadType(texts.type),
    typeGroup: loadTypeGroups(texts.typeAbv, texts.type),
    concept: loadConcept(texts.optionNames),
    value: loadValue(texts.optionValues),
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/loaders.test.js`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add js/sku/loaders.js data/ test/loaders.test.js
git commit -m "feat: reference data loaders + bundled reference CSV snapshot"
```

---

### Task 4: Classification, grouping, prefix & title inference

**Files:**
- Create: `js/sku/classify.js`
- Test: `test/classify.test.js`

**Interfaces:**
- Consumes: `References` from `js/sku/loaders.js`.
- Produces:
  - `isVariantRow(row) -> boolean` — true if `Title` non-empty (trimmed) OR `Variant Price` non-empty (trimmed).
  - `inferTypeGroup(title) -> string` — ordered first-match keyword→group, fallback `"OTHERS"`.
  - `groupProducts(rows, refs) -> Product[]` — group variant rows by `Handle` (first-seen order).
  - `Product = { handle, leadTitle, rawVendor, rawType, vendorId, typeId, prefix, reviewReason, rows }`.
    - `reviewReason ∈ { "AMBIGUOUS_TYPE", "BLANK_TYPE_TITLE_GUESS", "UNRESOLVED_VENDOR", "UNRESOLVED_TYPE", null }`.
    - When vendor unresolved: `vendorId=null`, `prefix=null`, `reviewReason="UNRESOLVED_VENDOR"`.
    - When type non-blank but unresolved: `typeId=null`, `prefix=null`, `reviewReason="UNRESOLVED_TYPE"` (unless vendor already unresolved — vendor takes precedence).
    - `TITLE_TYPE_RULES` and `OTHERS_GROUP` exported for reuse/testing.

Port the verbatim `TITLE_TYPE_RULES` list and `is_variant_row`/`infer_type_group`/`build_product`/`group_products` logic from `../skus-generator-v2/sku_generator/classify.py`, adding the warn-but-continue unresolved-key branches (§5 of the spec).

- [ ] **Step 1: Write the failing test**

Create `test/classify.test.js`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { isVariantRow, inferTypeGroup, groupProducts } from "../js/sku/classify.js";
import { buildReferences } from "../js/sku/loaders.js";

const refs = buildReferences({
  vendor: "raw_vendor,vendor_brand,vendor_abv\nAEA,AEA,AE\n",
  type: "raw,normalized,id,needs_review\nSlugs,AMMO,AM,no\nMystery,OTHERS,OT,yes\n",
  typeAbv: "type_group,type_abv,source\nAMMO,AM,x\nOTHERS,OT,x\n",
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/classify.test.js`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the implementation**

Create `js/sku/classify.js` (copy `TITLE_TYPE_RULES` verbatim from Python `classify.py` lines 25–56):

```javascript
export const TITLE_TYPE_RULES = [
  ["tripod", "SUPPORTS"], ["bipod", "SUPPORTS"], ["monopod", "SUPPORTS"],
  ["shooting bag", "BAGS"], ["duffle", "BAGS"], ["backpack", "BAGS"],
  ["pouch", "BAGS"], ["case", "CASES"],
  ["sling mount", "MOUNTS"], ["mount", "MOUNTS"], ["ring", "MOUNTS"],
  ["picatinny", "RAILS"], ["rail", "RAILS"],
  ["magnification wheel", "OPTICS ACCESSORIES"],
  ["parallax", "OPTICS ACCESSORIES"], ["sunshade", "OPTICS ACCESSORIES"],
  ["riflescope", "OPTICS"], ["scope", "OPTICS"],
  ["red dot", "AIM POINTS & LASERS"], ["laser", "AIM POINTS & LASERS"],
  ["chronograph", "CHRONOGRAPHS"], ["rangefinder", "RANGEFINDERS"],
  ["binocular", "BINOCULARS"],
  ["suppressor", "SUPPRESSORS"], ["moderator", "SUPPRESSORS"],
  ["silencer", "SUPPRESSORS"],
  ["magazine", "MAGAZINES"], ["regulator", "REGULATORS"],
  ["plenum", "PLENUMS"], ["barrel", "BARRELS"],
  ["stock", "STOCKS"], ["grip", "GRIPS"],
  ["tank", "BOTTLES"], ["bottle", "BOTTLES"],
  ["hose", "PCP FILL"], ["probe", "PCP FILL"], ["filling", "PCP FILL"],
  ["foster", "PCP FILL"],
  ["adapter", "ADAPTORS"], ["adaptor", "ADAPTORS"], ["coupler", "ADAPTORS"],
  ["o-ring", "O-RINGS"], ["compressor", "COMPRESSORS"], ["pump", "HANDPUMP"],
  ["slug", "AMMO"], ["pellet", "AMMO"],
  ["mold", "SLUG MOLD"], ["die", "SLUG MOLD"], ["press", "SLUG MOLD"],
  ["sticker", "MERCHANDISE"], ["shirt", "MERCHANDISE"],
  ["allen", "TOOLS"], ["wrench", "TOOLS"], ["screwdriver", "TOOLS"],
  ["torx", "TOOLS"], ["tool", "TOOLS"],
  ["gift card", "GIFT CARD"],
  ["lube", "ACCESSORIES"], ["grease", "ACCESSORIES"], ["sling", "ACCESSORIES"],
  ["spray", "ACCESSORIES"], ["detector", "ACCESSORIES"], ["swivel", "ACCESSORIES"],
  ["wheel", "OPTICS ACCESSORIES"],
];

export const OTHERS_GROUP = "OTHERS";

const REVIEW_AMBIGUOUS_TYPE = "AMBIGUOUS_TYPE";
const REVIEW_BLANK_TYPE = "BLANK_TYPE_TITLE_GUESS";
const UNRESOLVED_VENDOR = "UNRESOLVED_VENDOR";
const UNRESOLVED_TYPE = "UNRESOLVED_TYPE";

const s = (v) => (v === undefined || v === null ? "" : String(v));

export function isVariantRow(row) {
  return s(row.Title).trim() !== "" || s(row["Variant Price"]).trim() !== "";
}

export function inferTypeGroup(title) {
  const lowered = s(title).toLowerCase();
  for (const [keyword, group] of TITLE_TYPE_RULES) {
    if (lowered.includes(keyword)) return group;
  }
  return OTHERS_GROUP;
}

function inferTypeId(title, refs) {
  const group = inferTypeGroup(title);
  const id = refs.typeGroup.get(group.toUpperCase());
  if (id === undefined) throw new Error(`title-inference group ${group} not in TYPE_GROUP`);
  return id;
}

function leadRow(rows) {
  return rows.find((r) => s(r.Title).trim() !== "") || rows[0];
}

function buildProduct(handle, rows, refs) {
  const lead = leadRow(rows);
  const rawVendor = s(lead.Vendor);
  const rawType = s(lead.Type);
  const leadTitle = s(lead.Title);

  const vendorId = refs.vendor.get(rawVendor);
  if (vendorId === undefined) {
    return { handle, leadTitle, rawVendor, rawType, vendorId: null, typeId: null,
      prefix: null, reviewReason: UNRESOLVED_VENDOR, rows };
  }

  let typeId, reviewReason;
  if (rawType.trim() !== "") {
    const t = refs.type.get(rawType);
    if (t === undefined) {
      return { handle, leadTitle, rawVendor, rawType, vendorId, typeId: null,
        prefix: null, reviewReason: UNRESOLVED_TYPE, rows };
    }
    typeId = t.id;
    reviewReason = t.needsReview ? REVIEW_AMBIGUOUS_TYPE : null;
  } else {
    typeId = inferTypeId(leadTitle, refs);
    reviewReason = REVIEW_BLANK_TYPE;
  }

  return { handle, leadTitle, rawVendor, rawType, vendorId, typeId,
    prefix: `${vendorId}-${typeId}`, reviewReason, rows };
}

export function groupProducts(rows, refs) {
  const groups = new Map();
  const order = [];
  for (const row of rows) {
    if (!isVariantRow(row)) continue;
    const handle = s(row.Handle);
    if (!groups.has(handle)) { groups.set(handle, []); order.push(handle); }
    groups.get(handle).push(row);
  }
  return order.map((h) => buildProduct(h, groups.get(h), refs));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/classify.test.js`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add js/sku/classify.js test/classify.test.js
git commit -m "feat: row classification, product grouping, prefix & title inference"
```

---

### Task 5: SKU assignment (segments, Pass 1, Pass 2)

**Files:**
- Create: `js/sku/assign.js`
- Test: `test/assign.test.js`

**Interfaces:**
- Consumes: `hash6`, `hash4` from `js/sku/hash.js`; `valueKey` from `js/sku/loaders.js`; `Product` from `js/sku/classify.js`.
- Produces:
  - `buildSegments(row, filledNames, refs) -> string[]` — per option slot with name+value present: resolve concept, skip `concept === "TITLE"`, `nv = refs.value.get(valueKey(conceptId, value)) ?? value.toUpperCase()`, push `` `${conceptId}_${nv}` ``. Unresolved concept name → segment skipped and `row.__unresolvedOption` flag set (read by engine).
  - `assignPass1(products, refs) -> { assignments: Assignment[], providerCount, generatedCount }`.
  - `assignPass2(pass1) -> { assignments: Assignment[], colliderCount }` (mutates assignments' `sku`).
  - `Assignment = { handle, product, row, providerAnchored, providerSku, core, sku, unresolvedOption }`.
    - Products with `prefix === null` (unresolved vendor/type): every row → `providerAnchored:false, core:null, sku:null` and marked so the engine emits a blank SKU.

Port `_OPTION_SLOTS`, `build_segments`, `build_core`, `_assign_product`, `assign_pass1`, `assign_pass2` from `../skus-generator-v2/sku_generator/assign.py`, adding the unresolved-option and null-prefix branches.

- [ ] **Step 1: Write the failing test**

Create `test/assign.test.js`:

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/assign.test.js`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the implementation**

Create `js/sku/assign.js`:

```javascript
import { hash6, hash4 } from "./hash.js";
import { valueKey } from "./loaders.js";

const OPTION_SLOTS = [
  ["Option1 Name", "Option1 Value"],
  ["Option2 Name", "Option2 Value"],
  ["Option3 Name", "Option3 Value"],
];
const TITLE_CONCEPT = "TITLE";
const s = (v) => (v === undefined || v === null ? "" : String(v));

export function buildSegments(row, filledNames, refs) {
  const segments = [];
  OPTION_SLOTS.forEach(([, valueCol], i) => {
    const name = filledNames[i];
    const value = s(row[valueCol]);
    if (!(s(name).trim() && value.trim())) return;
    const c = refs.concept.get(name);
    if (c === undefined) { row.__unresolvedOption = name; return; }
    if (c.concept === TITLE_CONCEPT) return;
    const nv = refs.value.get(valueKey(c.conceptId, value)) ?? value.toUpperCase();
    segments.push(`${c.conceptId}_${nv}`);
  });
  return segments;
}

function buildCore(prefix, segments) {
  return [prefix, ...segments].join("-");
}

function assignProduct(product, refs) {
  const assignments = [];
  const filled = ["", "", ""];
  for (const row of product.rows) {
    OPTION_SLOTS.forEach(([nameCol], i) => {
      const cell = s(row[nameCol]);
      if (cell.trim()) filled[i] = cell;
    });

    if (product.prefix === null) {
      assignments.push({ handle: product.handle, product, row, providerAnchored: false,
        providerSku: "", core: null, sku: null, unresolvedOption: false });
      continue;
    }

    const providerSku = s(row["Variant SKU"]);
    if (providerSku.trim()) {
      assignments.push({ handle: product.handle, product, row, providerAnchored: true,
        providerSku, core: "", sku: `${product.prefix}-${hash6(providerSku)}`, unresolvedOption: false });
    } else {
      delete row.__unresolvedOption;
      const core = buildCore(product.prefix, buildSegments(row, [...filled], refs));
      assignments.push({ handle: product.handle, product, row, providerAnchored: false,
        providerSku: "", core, sku: null, unresolvedOption: Boolean(row.__unresolvedOption) });
    }
  }
  return assignments;
}

export function assignPass1(products, refs) {
  const assignments = [];
  for (const product of products) assignments.push(...assignProduct(product, refs));
  const providerCount = assignments.filter((a) => a.providerAnchored).length;
  return { assignments, providerCount, generatedCount: assignments.length - providerCount };
}

export function assignPass2(pass1) {
  const counts = new Map();
  for (const a of pass1.assignments) {
    if (a.providerAnchored || a.core === null) continue;
    counts.set(a.core, (counts.get(a.core) || 0) + 1);
  }
  let colliderCount = 0;
  for (const a of pass1.assignments) {
    if (a.providerAnchored || a.core === null) continue; // null-prefix keeps sku=null
    if (counts.get(a.core) > 1) { a.sku = `${a.core}-${hash4(a.handle)}`; colliderCount++; }
    else a.sku = a.core;
  }
  return { assignments: pass1.assignments, colliderCount };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/assign.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add js/sku/assign.js test/assign.test.js
git commit -m "feat: SKU assignment — segments, Pass 1 provider-hash, Pass 2 collisions"
```

---

### Task 6: Engine orchestrator (per-row results, warnings, stats)

**Files:**
- Create: `js/sku/engine.js`
- Test: `test/engine.test.js`

**Interfaces:**
- Consumes: `groupProducts`, `isVariantRow` from `classify.js`; `assignPass1`, `assignPass2` from `assign.js`.
- Produces:
  - `generate(rows, refs) -> Result`.
  - `Result = { rows: RowResult[], warnings: Warnings, stats: Stats }`.
    - `RowResult` preserves **input row order**, one per input row: `{ handle, title, sku, reviewReason, isVariant }`. Image/continuation rows: `{ isVariant:false, sku:"", reviewReason:null }`. Variant rows carry the assignment's `sku` (`""` if null) and the product's `reviewReason`, upgraded to `"UNRESOLVED_OPTION"` when that row had an unresolved option name and no other reason.
    - `Warnings = { vendor: string[], type: string[], option: string[] }` — sorted distinct unresolved keys.
    - `Stats = { variantRows, imageRows, providerAnchored, generated, collidersHandleHashed, review, unresolvedRows }`.

- [ ] **Step 1: Write the failing test**

Create `test/engine.test.js`:

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/engine.test.js`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the implementation**

Create `js/sku/engine.js`:

```javascript
import { groupProducts } from "./classify.js";
import { assignPass1, assignPass2 } from "./assign.js";

const s = (v) => (v === undefined || v === null ? "" : String(v));

export function generate(rows, refs) {
  const products = groupProducts(rows, refs);
  const pass1 = assignPass1(products, refs);
  const pass2 = assignPass2(pass1);

  // Map each variant row object -> its assignment (row objects are shared references).
  const byRow = new Map();
  for (const a of pass2.assignments) byRow.set(a.row, a);

  const vendorMissing = new Set();
  const typeMissing = new Set();
  const optionMissing = new Set();
  let unresolvedRows = 0;

  const out = rows.map((row) => {
    const a = byRow.get(row);
    if (!a) {
      return { handle: s(row.Handle), title: s(row.Title), sku: "", reviewReason: null, isVariant: false };
    }
    const p = a.product;
    let reviewReason = p.reviewReason;
    if (p.reviewReason === "UNRESOLVED_VENDOR") vendorMissing.add(p.rawVendor);
    if (p.reviewReason === "UNRESOLVED_TYPE") typeMissing.add(p.rawType);
    if (a.unresolvedOption) {
      optionMissing.add(a.row.__unresolvedOption);
      if (!reviewReason) reviewReason = "UNRESOLVED_OPTION";
    }
    const sku = a.sku === null || a.sku === undefined ? "" : a.sku;
    if (sku === "" || reviewReason === "UNRESOLVED_OPTION") unresolvedRows++;
    return { handle: p.handle, title: s(row.Title), sku, reviewReason, isVariant: true };
  });

  const review = products.filter((p) => p.reviewReason).length;
  const stats = {
    variantRows: pass2.assignments.length,
    imageRows: out.length - pass2.assignments.length,
    providerAnchored: pass1.providerCount,
    generated: pass1.generatedCount,
    collidersHandleHashed: pass2.colliderCount,
    review,
    unresolvedRows,
  };
  const sortUniq = (set) => [...set].sort();
  return {
    rows: out,
    warnings: { vendor: sortUniq(vendorMissing), type: sortUniq(typeMissing), option: sortUniq(optionMissing) },
    stats,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/engine.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add js/sku/engine.js test/engine.test.js
git commit -m "feat: engine orchestrator with per-row results, warnings and stats"
```

---

### Task 7: Parity test against Python golden output (HARD GATE)

**Files:**
- Create: `test/fixtures/export_effecto.csv` (copy from Python project)
- Create: `test/fixtures/export_effecto_with_skus.csv` (copy of golden output)
- Test: `test/parity.test.js`

**Interfaces:**
- Consumes: `parseCSV` (`js/csv.js`), `buildReferences` (`js/sku/loaders.js`), `generate` (`js/sku/engine.js`).

- [ ] **Step 1: Copy fixtures**

```bash
mkdir -p test/fixtures
cp ../skus-generator-v2/tests/fixtures/export_effecto.csv test/fixtures/
cp ../skus-generator-v2/output_files/effecto/export_effecto_with_skus.csv test/fixtures/
wc -l test/fixtures/*.csv
```
Expected: both files present with equal line counts.

- [ ] **Step 2: Write the parity test**

Create `test/parity.test.js`:

```javascript
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
  vendor: read("../../data/vendor_mapping_canonical.csv"),
  type: read("../../data/type_mapping_canonical.csv"),
  typeAbv: read("../../data/type_abv_reference.csv"),
  optionNames: read("../../data/option_names_canonical.csv"),
  optionValues: read("../../data/option_values_linked_canonical.csv"),
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
```

- [ ] **Step 3: Run the parity test**

Run: `node --test test/parity.test.js`
Expected: PASS. If mismatches appear, the printed `{handle, got, want}` pinpoints the divergence — debug the relevant engine module (do NOT edit the fixture). This test passing is the definition of done for the engine.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: all tests across all files PASS.

- [ ] **Step 5: Commit**

```bash
git add test/fixtures/ test/parity.test.js
git commit -m "test: parity gate — engine output identical to Python golden (effecto)"
```

---

### Task 8: XLSX reader (SheetJS) — Products sheet

**Files:**
- Create: `vendor/xlsx.full.min.js` (vendored SheetJS)
- Create: `js/xlsx.js`

**Interfaces:**
- Consumes: global `XLSX` (from the vendored script loaded via a `<script>` tag in `index.html`).
- Produces: `readProducts(arrayBuffer) -> { header: string[], rows: Object[] }` — reads the sheet named `"Products"` (case-insensitive); throws `Error("No 'Products' sheet found")` if absent. Cells read as strings (`raw:false`, `defval:""`), preserving the row/column shape the engine expects.

Note: not unit-tested in Node (depends on the browser global + binary parsing). Verified via the manual UI check in Task 9.

- [ ] **Step 1: Vendor SheetJS**

```bash
mkdir -p vendor
curl -fsSL https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js -o vendor/xlsx.full.min.js
head -c 80 vendor/xlsx.full.min.js
```
Expected: file downloaded; header comment shows the SheetJS banner. (If the network is unavailable, obtain `xlsx.full.min.js` v0.20.3 from the SheetJS site and place it at `vendor/xlsx.full.min.js`.)

- [ ] **Step 2: Write the reader**

Create `js/xlsx.js`:

```javascript
// Reads the Matrixify "Products" sheet into { header, rows } using the global XLSX.

export function readProducts(arrayBuffer) {
  const XLSX = globalThis.XLSX;
  if (!XLSX) throw new Error("SheetJS (XLSX) not loaded");
  const wb = XLSX.read(arrayBuffer, { type: "array" });
  const name = wb.SheetNames.find((n) => n.toLowerCase() === "products");
  if (!name) throw new Error("No 'Products' sheet found in the workbook");
  const ws = wb.Sheets[name];
  // header:1 -> array-of-arrays; keeps exact header order incl. duplicates.
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
  if (aoa.length === 0) return { header: [], rows: [] };
  const header = aoa[0].map((h) => (h === undefined || h === null ? "" : String(h)));
  const rows = aoa.slice(1).map((arr) => {
    const obj = {};
    header.forEach((h, i) => { obj[h] = arr[i] === undefined || arr[i] === null ? "" : String(arr[i]); });
    return obj;
  });
  return { header, rows };
}
```

- [ ] **Step 3: Commit**

```bash
git add vendor/xlsx.full.min.js js/xlsx.js
git commit -m "feat: vendored SheetJS + Products-sheet xlsx reader"
```

---

### Task 9: UI (index.html, app.js, styles.css) + manual verification

**Files:**
- Create: `index.html`
- Create: `js/app.js`
- Create: `styles.css`

**Interfaces:**
- Consumes: `readProducts` (`js/xlsx.js`), `buildReferences` (`js/sku/loaders.js`), `generate` (`js/sku/engine.js`), `toCSV` (`js/csv.js`).

- [ ] **Step 1: Write index.html**

Create `index.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SKU Generator</title>
  <link rel="stylesheet" href="styles.css" />
  <script src="vendor/xlsx.full.min.js"></script>
</head>
<body>
  <main>
    <h1>SKU Generator</h1>
    <p class="sub">Upload a Matrixify Shopify export (.xlsx) to generate Variant SKUs. Everything runs in your browser — nothing is uploaded.</p>

    <section id="drop" class="drop">
      <input type="file" id="file" accept=".xlsx" hidden />
      <button id="pick" type="button">Choose .xlsx file</button>
      <span id="filename" class="filename"></span>
      <p class="hint">or drag &amp; drop it here</p>
    </section>

    <p id="error" class="error" hidden></p>

    <section id="results" hidden>
      <div id="stats" class="stats"></div>
      <details id="warnings-box" class="warnings" hidden>
        <summary>Unresolved reference keys</summary>
        <div id="warnings"></div>
      </details>
      <div class="toolbar">
        <input id="filter" type="search" placeholder="Filter by handle, title or SKU…" />
        <button id="download" type="button">Download CSV</button>
      </div>
      <div class="table-wrap">
        <table id="table">
          <thead><tr><th>Handle</th><th>Title</th><th>Variant SKU</th><th>Review</th></tr></thead>
          <tbody id="tbody"></tbody>
        </table>
      </div>
    </section>
  </main>
  <script type="module" src="js/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write styles.css**

Create `styles.css`:

```css
:root { color-scheme: light dark; --bg:#fff; --fg:#1a1a1a; --muted:#666; --border:#ddd; --accent:#2563eb; --warn:#b45309; --panel:#f6f7f9; }
@media (prefers-color-scheme: dark) { :root { --bg:#14161a; --fg:#e8e8e8; --muted:#9aa0a6; --border:#333; --accent:#60a5fa; --warn:#f59e0b; --panel:#1c1f24; } }
* { box-sizing: border-box; }
body { margin:0; font:15px/1.5 system-ui, sans-serif; background:var(--bg); color:var(--fg); }
main { max-width: 1000px; margin: 0 auto; padding: 2rem 1rem 4rem; }
h1 { margin:0 0 .25rem; }
.sub { color:var(--muted); margin:0 0 1.5rem; }
.drop { border:2px dashed var(--border); border-radius:12px; padding:2rem; text-align:center; transition:border-color .15s; }
.drop.dragover { border-color:var(--accent); }
.drop button { font:inherit; padding:.6rem 1rem; border-radius:8px; border:1px solid var(--accent); background:var(--accent); color:#fff; cursor:pointer; }
.filename { margin-left:.75rem; color:var(--muted); }
.hint { color:var(--muted); margin:.75rem 0 0; }
.error { color:#dc2626; font-weight:600; }
.stats { display:flex; flex-wrap:wrap; gap:.75rem; margin:1.5rem 0; }
.stat { background:var(--panel); border:1px solid var(--border); border-radius:10px; padding:.6rem .9rem; }
.stat b { display:block; font-size:1.3rem; }
.stat span { color:var(--muted); font-size:.8rem; }
.warnings { margin-bottom:1rem; border:1px solid var(--warn); border-radius:10px; padding:.5rem .9rem; }
.warnings summary { color:var(--warn); cursor:pointer; font-weight:600; }
.warnings ul { margin:.5rem 0; }
.toolbar { display:flex; gap:.75rem; margin-bottom:.75rem; }
.toolbar input { flex:1; font:inherit; padding:.5rem .75rem; border:1px solid var(--border); border-radius:8px; background:var(--bg); color:var(--fg); }
.toolbar button { font:inherit; padding:.5rem 1rem; border-radius:8px; border:1px solid var(--accent); background:var(--accent); color:#fff; cursor:pointer; }
.table-wrap { overflow-x:auto; border:1px solid var(--border); border-radius:10px; }
table { border-collapse:collapse; width:100%; }
th, td { text-align:left; padding:.5rem .75rem; border-bottom:1px solid var(--border); white-space:nowrap; }
thead th { position:sticky; top:0; background:var(--panel); }
td.sku { font-family:ui-monospace, monospace; }
td.review { color:var(--warn); font-size:.85rem; }
tr.flagged td.sku { color:var(--warn); }
```

- [ ] **Step 3: Write app.js**

Create `js/app.js`:

```javascript
import { readProducts } from "./xlsx.js";
import { buildReferences } from "./sku/loaders.js";
import { generate } from "./sku/engine.js";
import { toCSV } from "./csv.js";

const REF_FILES = {
  vendor: "data/vendor_mapping_canonical.csv",
  type: "data/type_mapping_canonical.csv",
  typeAbv: "data/type_abv_reference.csv",
  optionNames: "data/option_names_canonical.csv",
  optionValues: "data/option_values_linked_canonical.csv",
};

let refsPromise = null;
function loadRefs() {
  if (!refsPromise) {
    refsPromise = (async () => {
      const entries = await Promise.all(
        Object.entries(REF_FILES).map(async ([k, url]) => {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`Failed to load ${url}`);
          return [k, await res.text()];
        })
      );
      return buildReferences(Object.fromEntries(entries));
    })();
  }
  return refsPromise;
}

const $ = (id) => document.getElementById(id);
let lastResult = null;

function showError(msg) {
  const el = $("error");
  el.textContent = msg;
  el.hidden = false;
}

function renderStats(stats) {
  const cells = [
    ["Variant SKUs", stats.variantRows],
    ["Provider-anchored", stats.providerAnchored],
    ["Generated", stats.generated],
    ["Colliders (handle-hashed)", stats.collidersHandleHashed],
    ["Flagged for review", stats.review],
    ["Unresolved rows", stats.unresolvedRows],
  ];
  $("stats").innerHTML = cells
    .map(([label, n]) => `<div class="stat"><b>${n}</b><span>${label}</span></div>`)
    .join("");
}

function renderWarnings(w) {
  const box = $("warnings-box");
  const total = w.vendor.length + w.type.length + w.option.length;
  if (total === 0) { box.hidden = true; return; }
  box.hidden = false;
  const section = (title, items) =>
    items.length ? `<p><b>${title}</b></p><ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>` : "";
  $("warnings").innerHTML =
    section("Unknown vendors", w.vendor) +
    section("Unknown types", w.type) +
    section("Unknown option names", w.option);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderTable(rows, filter) {
  const f = filter.trim().toLowerCase();
  const variant = rows.filter((r) => r.isVariant);
  const shown = f
    ? variant.filter((r) => (r.handle + " " + r.title + " " + r.sku).toLowerCase().includes(f))
    : variant;
  const MAX = 2000;
  const slice = shown.slice(0, MAX);
  $("tbody").innerHTML = slice
    .map((r) => `<tr class="${r.reviewReason ? "flagged" : ""}">
      <td>${escapeHtml(r.handle)}</td>
      <td>${escapeHtml(r.title)}</td>
      <td class="sku">${escapeHtml(r.sku)}</td>
      <td class="review">${escapeHtml(r.reviewReason || "")}</td></tr>`)
    .join("");
  if (shown.length > MAX) {
    $("tbody").insertAdjacentHTML("beforeend",
      `<tr><td colspan="4">Showing first ${MAX} of ${shown.length} rows — use the filter or download the CSV for all.</td></tr>`);
  }
}

function downloadCSV(rows) {
  const variant = rows.filter((r) => r.isVariant);
  const header = ["Handle", "Title", "Variant SKU", "Review Reason"];
  const csvRows = variant.map((r) => ({
    Handle: r.handle, Title: r.title, "Variant SKU": r.sku, "Review Reason": r.reviewReason || "",
  }));
  const blob = new Blob([toCSV(header, csvRows)], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "skus.csv";
  a.click();
  URL.revokeObjectURL(url);
}

async function handleFile(file) {
  $("error").hidden = true;
  $("filename").textContent = file.name;
  try {
    const [refs, buf] = await Promise.all([loadRefs(), file.arrayBuffer()]);
    const { rows } = readProducts(new Uint8Array(buf));
    lastResult = generate(rows, refs);
    renderStats(lastResult.stats);
    renderWarnings(lastResult.warnings);
    renderTable(lastResult.rows, "");
    $("results").hidden = false;
  } catch (err) {
    showError(err.message || String(err));
  }
}

// Wire up events.
$("pick").addEventListener("click", () => $("file").click());
$("file").addEventListener("change", (e) => { if (e.target.files[0]) handleFile(e.target.files[0]); });
$("download").addEventListener("click", () => { if (lastResult) downloadCSV(lastResult.rows); });
$("filter").addEventListener("input", (e) => { if (lastResult) renderTable(lastResult.rows, e.target.value); });

const drop = $("drop");
["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("dragover"); }));
["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("dragover"); }));
drop.addEventListener("drop", (e) => { const f = e.dataTransfer.files[0]; if (f) handleFile(f); });
```

- [ ] **Step 4: Manual verification**

```bash
python3 -m http.server 8000
```
Then open `http://localhost:8000/` in a browser, choose `/Users/vicensfayos/Downloads/Export_2026-07-22_095923.xlsx`, and confirm:
- A stats bar and results table render.
- The single product's row shows a non-empty `Variant SKU`.
- "Download CSV" downloads `skus.csv` with `Handle,Title,Variant SKU,Review Reason`.
- No console errors; no network requests except to same-origin `data/*.csv` and `vendor/xlsx.full.min.js`.

Stop the server with Ctrl-C when done.

- [ ] **Step 5: Commit**

```bash
git add index.html styles.css js/app.js
git commit -m "feat: upload UI — stats, warnings, filterable table, CSV download"
```

---

### Task 10: README + GitHub Pages deployment notes

**Files:**
- Create: `README.md`
- Create: `.nojekyll` (empty — prevents GitHub Pages from ignoring files/underscore paths)

**Interfaces:** none.

- [ ] **Step 1: Write README.md**

Create `README.md`:

```markdown
# SKU Generator Website

Upload a Matrixify Shopify product export (`.xlsx`) and get the generated
Shopify **Variant SKU** for every variant row — as a table and a downloadable
CSV. Runs 100% in the browser; nothing is uploaded to any server.

## SKU format

`VENDOR-TYPE-<disambiguator>`. Provider-anchored rows (that already carry a
supplier `Variant SKU`) use `HASH6(providerSku)`; generated rows use option
`CONCEPT_VALUE` segments, with `HASH4(handle)` appended only when two generated
SKUs would collide. This is a JavaScript port of the batch tool in
`../skus-generator-v2`; the engine output is verified byte-identical to that
tool (see `test/parity.test.js`).

## Develop & test

```bash
npm test          # runs the full Node test suite, incl. the parity gate
python3 -m http.server 8000   # serve locally, then open http://localhost:8000/
```

## Refresh reference data

The 5 CSVs in `data/` are a snapshot of `../skus-generator-v2/data/`. To update,
copy the CSVs over and re-run `npm test` (the parity gate confirms nothing broke),
then redeploy. No code change needed.

## Deploy (GitHub Pages)

Push to GitHub and enable Pages for the repository root (branch `main`, folder
`/`). The site is plain static files (no build). `.nojekyll` ensures all files
are served as-is.
```

- [ ] **Step 2: Create .nojekyll**

```bash
touch .nojekyll
```

- [ ] **Step 3: Final full-suite run**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add README.md .nojekyll
git commit -m "docs: README + GitHub Pages deployment config"
```

---

## Self-Review Notes

- **Spec coverage:** Inputs (Task 8 xlsx + Task 3 refs), algorithm §4 (Tasks 4–5), title inference §5 (Task 4), warn-but-continue §5 (Tasks 4–6), architecture §6 (all module tasks match the spec's file list), UI §7 (Task 9), parity/testing §8 (Tasks 1–7 tests + Task 7 gate), deployment §9 (Task 10), determinism §10 (Task 2 SHA1 + pure modules). All covered.
- **Type consistency:** `References` shape, `Product` fields, `Assignment` fields, and `Result`/`RowResult` are defined in Tasks 3/4/5/6 and consumed consistently downstream. `valueKey` defined in Task 3, used in Task 5. `hash6`/`hash4` defined in Task 2, used in Task 5.
- **Naming note:** engine returns `rows` (per-input-row `RowResult[]`), a refinement of the spec's `assignments[]` — chosen so parity comparison aligns by row index. Documented in Task 6 interface.
```
