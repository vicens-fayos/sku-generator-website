# Migration: store the supplier SKU in `Variant Barcode`, not a custom metafield

## Why

This project currently keeps the durable **supplier code** in a per-variant
Shopify metafield (`custom.supplier_sku`), written back on re-import so re-runs
stay idempotent (the house SKU lives in `Variant SKU`, which we overwrite).

That approach was validated in the Python generator and then **fails in
practice with native Shopify CSV**, confirmed empirically:

- Native Shopify **import** does not write *variant* metafields.
- Native Shopify **export** does not emit *variant* metafields either (defining
  the metafield does not make a `variant.metafields.*` column appear).

So the metafield never round-trips: after import→export the supplier code is
gone, and the next generation run treats the house SKU as input and double-hashes
everything. Matrixify would round-trip it, but the shops use native CSV.

**Fix:** carry the supplier code in the native, per-variant **`Variant Barcode`**
field instead. It round-trips reliably through native import/export. The field is
confirmed unused for these shops (≈2–3% filled, internal codes, not real UPCs),
so the generator takes it over: it holds the supplier code for provider variants
and is cleared for generated ones.

The Python generator (`skus-generator-v2`) has already been migrated this way;
this change brings the website's JS engine to parity.

## The rule (identical to Python)

Per variant row, resolve the supplier code from `Variant SKU` + `Variant Barcode`:

1. `Variant SKU` non-empty **and not** a house SKU → **first run**: `Variant SKU`
   still holds the supplier code → use it (ignore any stray barcode).
2. `Variant SKU` is a house SKU → **already processed**: the code was moved to
   `Variant Barcode` → read it back from there.
3. `Variant SKU` blank → never had a supplier code → generated (ignore any stray
   barcode).

A house-format `Variant SKU` is never fed back as a provider code, so re-runs
never hash our own output. On write: house SKU → `Variant SKU`; supplier code →
`Variant Barcode` for provider variants, `""` (cleared) for generated ones.

## Code changes (file by file)

### `js/sku/config.js`
Replace the metafield constants with the carrier-field constant:

```js
// The house SKU goes into `Variant SKU` (the downstream mapping key), so the
// durable supplier code must live elsewhere or re-imports overwrite it and
// re-runs double-hash. Variant metafields don't round-trip through native
// Shopify CSV, so we repurpose the native per-variant `Variant Barcode` field
// (confirmed unused for these shops). The generator owns it: supplier code for
// provider variants, cleared for generated ones.
export const SUPPLIER_SKU_FIELD = "Variant Barcode";
```

Delete `SUPPLIER_SKU_METAFIELD_KEY` and `SUPPLIER_SKU_COLUMN`.

### `js/sku/assign.js`
- Keep `isHouseSku` and the `HOUSE_SKU_RE` **as-is** — keep the broader
  `/^[A-Z0-9]{2,3}-[A-Z0-9]{2}(-|$)/` (3-char vendor IDs like `CHR-CH`); do not
  narrow it.
- **Delete** `supplierSkuColumn` and the `SUPPLIER_COLUMN_KEY` constant + the
  `SUPPLIER_SKU_METAFIELD_KEY` import. Import `SUPPLIER_SKU_FIELD` instead.
- Rewrite `resolveSupplierSku` to take only the row:

```js
import { SUPPLIER_SKU_FIELD } from "./config.js";

export function resolveSupplierSku(row) {
  const variantSku = s(row["Variant SKU"]).trim();
  if (!variantSku) return "";
  if (!isHouseSku(variantSku)) return variantSku;   // first run: code still in Variant SKU
  return s(row[SUPPLIER_SKU_FIELD]).trim();          // later run: read it back from the barcode
}
```

- `assignProduct(product, refs)` — drop the `supplierCol` param; call
  `resolveSupplierSku(row)`. (Keep resolving before the null-prefix branch so a
  real code is still captured for unresolved-prefix rows.)
- `assignPass1(products, refs)` — drop the `supplierCol` param and stop threading
  it into `assignProduct`.

### `js/matrixify.js`
- Drop the `supplierSkuColumn` / `SUPPLIER_SKU_COLUMN` imports; import
  `SUPPLIER_SKU_FIELD` from `./sku/config.js`.
- In `buildReimportAoa`, write the supplier code into the barcode field instead
  of a metafield column:

```js
export function buildReimportAoa(header, rows, result) {
  const field = SUPPLIER_SKU_FIELD;                       // "Variant Barcode"
  const outHeader = header.includes(field) ? [...header] : [...header, field];
  const aoa = [outHeader];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const r = result.rows[i];
    const cell = {};
    for (const col of outHeader) cell[col] = s(row[col]);
    if (r && r.isVariant) {
      if (r.sku !== "") cell["Variant SKU"] = r.sku;       // only when we have a house SKU
      cell[field] = s(r.supplierSku);                      // supplier code, or "" clears it
    }
    aoa.push(outHeader.map((col) => cell[col]));
  }
  return aoa;
}
```

Update the file's top comment (it no longer creates a metafield column). Real
Shopify exports already contain `Variant Barcode`, so no column is appended in
practice; the `includes` guard only helps trimmed fixtures.

### `js/sku/engine.js`
Remove the `supplierSkuColumn` import and the `supplierCol` plumbing:

```js
import { assignPass1, assignPass2 } from "./assign.js";
// ...
export function generate(rows, refs, header) {
  const products = groupProducts(rows, refs);
  const pass1 = assignPass1(products, refs);
  const pass2 = assignPass2(pass1);
  // ...unchanged...
}
```

(`header`/`cols` may now be unused here — drop if so.)

### Design doc (`docs/superpowers/specs/2026-07-22-sku-generator-website-design.md`)
Update any mention of the supplier metafield / `custom.supplier_sku` column to
the `Variant Barcode` carrier and the resolution rule above.

## Tests to update
Mirror the Python test changes:
- Drop tests for `supplierSkuColumn` / metafield-column detection.
- `resolveSupplierSku` now takes only `(row)`:
  - non-house `Variant SKU` → returns it (first run); a stray `Variant Barcode`
    is ignored.
  - house-format `Variant SKU` + `Variant Barcode` set → returns the barcode.
  - house-format `Variant SKU` + no barcode → `""` (double-hash guard).
  - blank `Variant SKU` + stray barcode → `""` (golden-safe).
- Re-import builder: supplier code lands in `Variant Barcode`; generated rows'
  barcode is cleared; no metafield column is added when the export already has
  `Variant Barcode`.

## Invariants to preserve (must still hold after the change)
- **Idempotency:** generate → re-import → re-export → generate yields identical
  SKUs (0 differences). This is the whole point.
- **Golden parity:** the effecto reference split is unchanged (blank `Variant SKU`
  rows stay generated; a stray barcode never turns a generated row into a provider
  one — that's why blank `Variant SKU` returns `""` regardless of barcode).
- House-format `Variant SKU` is never used as a provider code.

## Shopify housekeeping (not code)
The `custom.supplier_sku` variant-metafield definition is now unused — it can be
deleted in Shopify. Import/export uses native CSV with the supplier code in
`Variant Barcode`.
