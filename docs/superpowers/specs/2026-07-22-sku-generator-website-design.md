# SKU Generator Website — Design

**Date:** 2026-07-22
**Status:** Approved

## 1. Goal

A 100%-frontend website (deployable to GitHub Pages) where a user uploads a
Matrixify Shopify product export (`.xlsx`) and gets back the generated Shopify
**Variant SKU** for every variant row — as an on-screen table and a downloadable
CSV.

The SKU generation logic is a faithful JavaScript port of the proven Python
batch tool at `/Users/vicensfayos/Projects/wolfiek/skus-generator-v2` (see its
`SPEC.md`). Correctness is defined as **byte-identical SKU output** to that tool
on the same input.

## 2. Non-goals

- No re-importable enriched file, no separate review-report file. Output is a
  **simple mapping** (Handle, Title, Variant SKU, + informational review reason).
- No backend, no build step, no network calls. Everything is static assets.
- No editing of reference data in the UI. Reference data ships as a snapshot.

## 3. Inputs

### 3.1 Uploaded file
- Matrixify `.xlsx` export. The workbook has a **`Products`** sheet (data) and an
  **`Export Summary`** sheet (ignored). The Products sheet has ~103 columns; the
  algorithm consumes only these 13:
  `Handle, Title, Vendor, Type, Option1 Name, Option1 Value, Option2 Name,
  Option2 Value, Option3 Name, Option3 Value, Variant Price, Variant SKU,
  Image Src`.
- Only `.xlsx` is accepted (per decision).

### 3.2 Reference data (bundled static snapshot, `data/*.csv`)
Copied verbatim from the Python project's `data/`. Source of truth; parsed at
runtime **preserving whitespace** (keys like `" SYSYEM"` have a deliberate
leading space and must match exactly).

| File | Lookup built |
|---|---|
| `vendor_mapping_canonical.csv` | `VENDOR[raw_vendor] = vendor_abv` |
| `type_mapping_canonical.csv` | `TYPE[raw] = (id, needs_review)` |
| `type_abv_reference.csv` (+ type_map) | `TYPE_GROUP[group_upper] = type_abv` |
| `option_names_canonical.csv` | `CONCEPT[raw_option_name] = (concept, concept_id)` |
| `option_values_linked_canonical.csv` | `VALUE[(concept_id, raw_value)] = normalized_value` |

Refreshing reference data = copy the CSVs over and redeploy. No code change.

## 4. SKU algorithm (ported from Python SPEC.md §3–§5)

Format: `VENDOR_id - TYPE_id - <disambiguator>`.

- **Provider-anchored** (row's `Variant SKU` non-empty):
  `disambiguator = HASH6(provider_sku)`. Identical provider SKUs collapse to one
  SKU by design.
- **Generated** (no provider SKU):
  `disambiguator = [CONCEPT_id _ NORMALIZED_VALUE]…` per option slot, joined `-`.
  If a generated core collides with another product's core, append
  `-HASH4(handle)`.

`HASH6(s)` = first 6 chars of `SHA1(s).hexdigest().upper()`; `HASH4` = first 4.
SHA1 is computed over the UTF-8 bytes of the string, matching Python's
`hashlib.sha1(s.encode("utf-8"))`.

Processing (preserve input row order):
1. **Classify** — a *variant row* has non-empty `Title` OR `Variant Price`;
   anything else is an image/continuation row (blank SKU, skipped).
2. **Group** by `Handle` (first-seen order). Vendor/Type come from the lead row
   (first row with a Title).
3. **Prefix** — `vendor_id = VENDOR[raw_vendor]`. If raw `Type` present:
   `(type_id, needs_review) = TYPE[raw_type]` (flag `AMBIGUOUS_TYPE` if review).
   If raw `Type` blank: infer group from title via ordered first-match keyword
   rules → `TYPE_GROUP` id, flag `BLANK_TYPE_TITLE_GUESS`. `prefix =
   "{vendor_id}-{type_id}"`.
4. **Option segments** (generated rows) — forward-fill Option{n} Name down a
   product's rows. For each slot with name+value: `(concept, concept_id) =
   CONCEPT[name]`; skip if concept == `TITLE`; `nv = VALUE[(concept_id, value)]`
   or `value.toUpperCase()` fallback; segment = `{concept_id}_{nv}`.
   `core = [prefix, ...segments].join("-")`.
5. **Pass 1** — provider rows get `{prefix}-{HASH6(provider_sku)}`; generated
   rows record their `core`.
6. **Pass 2** — count generated cores; a core shared by >1 row gets
   `-{HASH4(handle)}`, else written as-is.

Title→type keyword rules are the verbatim table from Python `classify.py`
(`TITLE_TYPE_RULES`), first-match-wins, fallback group `OTHERS`.

## 5. Warn-but-continue behavior (differs from Python, which blocks)

The Python tool aborts if any non-blank vendor/type/option name is missing from
the references. The website instead processes everything resolvable and surfaces
problems:

- **Unresolved vendor** → no prefix → product's rows get blank SKU, reason
  `UNRESOLVED_VENDOR`.
- **Unresolved type** (non-blank, not in refs) → blank SKU, reason
  `UNRESOLVED_TYPE`.
- **Unresolved option name** (generated rows) → that segment is omitted, row
  flagged `UNRESOLVED_OPTION`. Provider-anchored rows are unaffected (they don't
  use options).
- **Blank type** → title-inference + `BLANK_TYPE_TITLE_GUESS` (parity).
- **Ambiguous type** → `AMBIGUOUS_TYPE` (parity).

A **warnings panel** lists every distinct unresolved key (grouped by
vendor/type/option) so the user knows what reference data to fix.

## 6. Architecture

The SKU engine is **pure** — plain row objects + reference lookups in, results
out. It never imports SheetJS or touches the DOM, so the identical code runs in
the browser and in Node parity tests.

```
index.html · styles.css
js/
  sku/loaders.js   parse the 5 reference CSVs → lookups
  sku/classify.js  is_variant_row, group products, resolve prefix, title inference
  sku/assign.js    hash6/hash4 (SHA1), build segments/core, Pass 1 + Pass 2
  sku/engine.js    orchestrator: rows + refs → { assignments, review, warnings, stats }
  csv.js           tiny whitespace-preserving CSV parser (for reference files) + CSV writer
  xlsx.js          read the "Products" sheet into row objects (via SheetJS)
  app.js           UI: file drop/select, run engine, render table, CSV download
vendor/xlsx.full.min.js   vendored SheetJS (Apache-2.0)
vendor/sha1.js            small synchronous SHA1 over UTF-8 (matches hashlib.sha1)
data/*.csv                the 5 reference files (verbatim snapshot)
test/parity.mjs           Node: run engine on effecto fixture, diff vs Python golden
test/fixtures/            export_effecto.csv + expected export_effecto_with_skus.csv
```

### Module contracts
- **csv.js** — `parseCSV(text) -> { header: string[], rows: object[] }`. RFC-4180
  quoting; does **not** trim field whitespace. `toCSV(header, rows)` for download.
- **loaders.js** — `buildReferences({vendorCsv, typeCsv, typeAbvCsv, optionNamesCsv,
  optionValuesCsv}) -> References`. Mirrors Python loader rules (skip blank raw
  rows; conflict detection for VALUE/TYPE_GROUP).
- **classify.js** — `isVariantRow(row)`, `groupProducts(rows, refs) -> Product[]`,
  `inferTypeGroup(title)`. Each `Product` carries handle, prefix, reviewReason,
  unresolved flags, and its rows.
- **assign.js** — `hash6`, `hash4`, `buildSegments(row, names, refs)`,
  `assignPass1(products, refs)`, `assignPass2(pass1)`.
- **engine.js** — `generate(rows, refs) -> { assignments: {handle, title, sku,
  reviewReason}[], warnings, stats }`. Preserves input row order; image/
  continuation rows get an empty sku and are **excluded** from the results
  mapping (only variant rows appear).
- **xlsx.js** — `readProducts(arrayBuffer) -> { header, rows }` reading the
  `Products` sheet; throws a clear error if that sheet is absent.

## 7. UI

Single page:
1. Header + one-line description.
2. Drop zone / file picker (`.xlsx`). Shows filename + row count once parsed.
3. "Generate SKUs" runs the engine (synchronous; hundreds–thousands of rows is
   fast). A spinner covers larger files.
4. **Stats bar**: total variant SKUs, provider-anchored, generated, colliders
   handle-hashed, products flagged for review, unresolved-key count.
5. **Warnings panel** (collapsible) listing unresolved keys, if any.
6. **Results table**: Handle · Title · Variant SKU · Review reason. Client-side
   filter box; sticky header; virtualized or capped render if very large.
7. **Download CSV** button → `Handle,Title,Variant SKU,Review Reason`.

Fully offline; no CDN, no network. Theme: clean, legible, works light/dark.

## 8. Testing / definition of done

- **Parity test (`test/parity.mjs`, hard gate):** feed `export_effecto.csv`
  fixture rows through the JS engine; assert every SKU **exactly equals** the
  Python `export_effecto_with_skus.csv`. Also assert the universal invariants
  (no image-row SKU; generated SKUs unique; duplicate SKUs are provider-origin
  only; every variant row has a SKU).
- **Unit tests** for csv parsing (whitespace preserved, quoted fields), hash6/4
  against known Python values, title inference first-match ordering.
- **Manual UI check:** load the sample `Export_2026-07-22_095923.xlsx` and
  confirm a SKU is produced and downloadable.

## 9. Deployment

Static files served from the repo root (or `/docs`) via GitHub Pages. No build.
A short README documents: how to refresh reference data, how to run the parity
test (`node test/parity.mjs`), and the SKU format.

## 10. Determinism

Output is a pure function of inputs — no wall-clock, no randomness. SHA1 over
stable UTF-8 strings. Re-running on the same file yields identical SKUs.
