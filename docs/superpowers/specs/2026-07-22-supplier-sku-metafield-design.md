# Supplier-SKU Metafield — Idempotent SKU Generation (Design)

**Date:** 2026-07-22
**Status:** Approved

## Problem

The generator writes the house SKU into `Variant SKU` — the same column it reads
the supplier code from. So `generate → import → re-export → regenerate` double-
hashes: run 2 treats the house SKU as a supplier code and re-hashes it, minting
new SKUs and losing the (unrecoverable) supplier codes. Any pipeline that round-
trips generated SKUs back into the source has this bug, including this website.

## Fix

Store the supplier code in its own durable per-variant field (a Shopify metafield
`custom.supplier_sku`) so it is never overwritten. The house SKU still goes into
`Variant SKU` (the downstream mapping key). The generator reads the supplier code
from the metafield, not from `Variant SKU`.

**Resolution precedence (per variant):**
1. Metafield present and non-empty → genuine supplier code (already-processed run).
2. Else `Variant SKU` present and **not** house-format → genuine supplier code
   (first run — the column still holds it); it is copied into the metafield on output.
3. Else (blank, or `Variant SKU` is house-format) → no supplier code → generated path.

**House-format guard:** a `Variant SKU` matching `^[A-Z0-9]{2}-[A-Z0-9]{2}(-|$)`
is always our own output, never an input — even if the metafield is missing
(Shopify drops empty metafields) and even after a later Type/Vendor change. This
is what keeps re-runs idempotent.

## Scope (port from the updated Python `sku_generator/assign.py` + `config.py`)

### Config — `js/sku/config.js`
- `SUPPLIER_SKU_METAFIELD_KEY = "custom.supplier_sku"`
- `SUPPLIER_SKU_COLUMN = "Supplier SKU (variant.metafields.custom.supplier_sku)"`

### Engine read-side — `js/sku/assign.js`, `js/sku/engine.js`
- `isHouseSku(s)` → `/^[A-Z0-9]{2}-[A-Z0-9]{2}(-|$)/.test(s)`.
- `supplierSkuColumn(header)` → first column whose lowercased name contains
  `"metafields." + SUPPLIER_SKU_METAFIELD_KEY`, else `null`.
- `resolveSupplierSku(row, col)` → precedence above; returns `""` when none.
- `assignPass1(products, refs, supplierCol)` resolves the supplier code per row
  via `resolveSupplierSku`; each `Assignment` carries `supplierSku`. A row is
  provider-anchored iff `supplierSku` is non-empty → `prefix-HASH6(supplierSku)`.
  **Null-prefix (unresolved vendor/type) rows still resolve `supplierSku`** so a
  real code is never dropped.
- `generate(rows, refs, header)` detects the supplier column from `header`
  (defaulting to `Object.keys(rows[0])` when omitted) and adds `supplierSku` to
  each `RowResult`.

### Output: Matrixify re-import file — `js/matrixify.js` (SheetJS write)
`buildReimport(header, rows, result) -> ArrayBuffer` (single `Products` sheet):
- Output header = original header, **plus** `SUPPLIER_SKU_COLUMN` appended when
  the upload has no supplier column (else reuse the existing one).
- Per original row, aligned by index with `result.rows`:
  - **Variant row with a house SKU** → `Variant SKU` = house SKU; supplier col = `supplierSku`.
  - **Variant row, unresolved (no house SKU)** → leave `Variant SKU` untouched
    (never blank a real code); supplier col = `supplierSku`.
  - **Image/continuation row** → unchanged.
- All other cells copied verbatim. Serialized to `.xlsx` (same format as input).

### UI — `js/app.js`, `index.html`
- Results table gains a **Supplier SKU** column.
- The download button produces `<original-name>-with-skus.xlsx` (the re-import
  file), replacing the previous mapping CSV.

## Testing

- **Parity gate unchanged** — engine output stays byte-identical to the Python
  golden `export_effecto_with_skus.csv`. Verified: no effecto supplier code
  matches the house-format regex, so the guard is a no-op on that input.
- **Idempotency test (pure JS):** generate → simulate round-trip (set
  `Variant SKU` = house SKU and fill the supplier metafield column on variant
  rows) → generate again → assert SKUs identical (no double-hash); a second
  round-trip is also stable.
- **Unit tests:** `isHouseSku`, `supplierSkuColumn`, `resolveSupplierSku`
  (metafield precedence, house-format rejection, first-run `Variant SKU` fallback).
- **Writer smoke test (Node + SheetJS):** `buildReimport` output re-reads via
  `readProducts` with `Variant SKU` and the supplier column populated.

## Determinism & safety

- Idempotent even when the metafield is dropped (house-format guard).
- Unresolved rows never lose their original `Variant SKU`.
- Output is xlsx; full file preserved except the two columns.
