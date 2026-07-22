# Supplier-SKU Carrier — Idempotent SKU Generation (Design)

**Date:** 2026-07-22
**Status:** Approved — **carrier migrated from a `custom.supplier_sku` metafield
to the native `Variant Barcode` field** (see
`docs/MIGRATE-supplier-sku-to-barcode.md`). Variant metafields don't round-trip
through native Shopify CSV, so the durable supplier code is now carried in
`Variant Barcode`. Sections below are updated to reflect the barcode carrier.

## Problem

The generator writes the house SKU into `Variant SKU` — the same column it reads
the supplier code from. So `generate → import → re-export → regenerate` double-
hashes: run 2 treats the house SKU as a supplier code and re-hashes it, minting
new SKUs and losing the (unrecoverable) supplier codes. Any pipeline that round-
trips generated SKUs back into the source has this bug, including this website.

## Fix

Store the supplier code in the native per-variant **`Variant Barcode`** field so
it is never overwritten. The house SKU still goes into `Variant SKU` (the
downstream mapping key). The generator reads the supplier code from `Variant SKU`
on the first run, then from `Variant Barcode` on subsequent runs.

**Resolution precedence (per variant), from `Variant SKU` + `Variant Barcode`:**
1. `Variant SKU` non-empty and **not** house-format → first run: it still holds
   the supplier code → use it (ignore any stray barcode).
2. `Variant SKU` is house-format → already processed: read the code back from
   `Variant Barcode`.
3. `Variant SKU` blank → never had a code → generated path (ignore any stray barcode).

**House-format guard:** a `Variant SKU` matching `^[A-Z0-9]{2,3}-[A-Z0-9]{2}(-|$)`
is always our own output, never an input (the `{2,3}` first group covers 3-char
vendor IDs like `CHR-CH`). This keeps re-runs idempotent.

## Scope (port from the updated Python `sku_generator/assign.py` + `config.py`)

### Config — `js/sku/config.js`
- `SUPPLIER_SKU_FIELD = "Variant Barcode"`

### Engine read-side — `js/sku/assign.js`, `js/sku/engine.js`
- `isHouseSku(s)` → `/^[A-Z0-9]{2,3}-[A-Z0-9]{2}(-|$)/.test(s)`.
- `resolveSupplierSku(row)` → precedence above; returns `""` when none.
- `assignPass1(products, refs)` resolves the supplier code per row
  via `resolveSupplierSku`; each `Assignment` carries `supplierSku`. A row is
  provider-anchored iff `supplierSku` is non-empty → `prefix-HASH6(supplierSku)`.
  **Null-prefix (unresolved vendor/type) rows still resolve `supplierSku`** so a
  real code is never dropped.
- `generate(rows, refs)` adds `supplierSku` to each `RowResult`.

### Output: re-import file — `js/matrixify.js` (`.xlsx` via SheetJS, `.csv` via `aoaToCSV`)
`buildReimport`/`buildReimportCsv(header, rows, result)`:
- Output header = original header, **plus** `Variant Barcode` appended only when
  the upload lacks it (real Shopify exports already have it).
- Per original row, aligned by index with `result.rows`:
  - **Variant row with a house SKU** → `Variant SKU` = house SKU; `Variant Barcode` = `supplierSku`.
  - **Variant row, unresolved (no house SKU)** → leave `Variant SKU` untouched
    (never blank a real code); `Variant Barcode` = `supplierSku`.
  - **Generated variant** → `Variant Barcode` cleared (`""`).
  - **Image/continuation row** → unchanged.
- All other cells copied verbatim. Output format matches the input (CSV in → CSV out).

### UI — `js/app.js`, `index.html`
- Accepts `.csv` and `.xlsx`; results table shows a **Supplier SKU** column.
- The download button produces `<original-name>-with-skus.<csv|xlsx>` (the
  re-import file, same format as the upload).

## Testing

- **Parity gate unchanged** — engine output stays byte-identical to the Python
  golden `export_effecto_with_skus.csv`. Verified: no effecto supplier code
  matches the house-format regex, and a stray `Variant Barcode` never turns a
  blank-`Variant SKU` (generated) row into a provider one.
- **Idempotency test (pure JS):** generate → simulate round-trip (set
  `Variant SKU` = house SKU and carry the code in `Variant Barcode` on variant
  rows) → generate again → assert SKUs identical (no double-hash); a second
  round-trip is also stable.
- **Unit tests:** `isHouseSku`, `resolveSupplierSku` (first-run `Variant SKU`,
  barcode read-back, house-format rejection, blank golden-safety).
- **Writer smoke test (Node + SheetJS):** `buildReimport` output re-reads via
  `readProducts` with `Variant SKU` and `Variant Barcode` populated.

## Determinism & safety

- Idempotent: a house-format `Variant SKU` is never re-hashed; the code is
  read back from `Variant Barcode`, which round-trips through native Shopify CSV.
- Unresolved rows never lose their original `Variant SKU`.
- Full file preserved except `Variant SKU` and `Variant Barcode`.
