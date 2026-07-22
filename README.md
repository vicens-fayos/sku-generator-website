# SKU Generator Website

Upload a **full** Matrixify Shopify product export (`.csv` or `.xlsx`) and get
the generated Shopify **Variant SKU** for every row — as a review table and a
downloadable re-import file in the **same format you uploaded** (CSV in → CSV
out, xlsx in → xlsx out). Runs 100% in the browser; nothing is uploaded to any
server.

> Upload the **whole** export, not a single product. SKU disambiguation is a
> whole-catalog property: a collider suffix like `-6EDD` only appears because
> several products share a `VENDOR-TYPE` base, so a partial upload can't
> reproduce it. The engine classifies each row (product lead / variant /
> image placeholder) exactly like the Python batch tool.

## Idempotency (supplier code in `Variant Barcode`)

The house SKU goes into `Variant SKU`, so the durable supplier code is kept in
the native per-variant **`Variant Barcode`** field instead of being overwritten.
(Variant metafields don't round-trip through native Shopify CSV — export/import
drops them — so the barcode field, confirmed unused for these shops, carries the
code.) Resolution per row: a non-house `Variant SKU` is the supplier code on the
first run; once the SKU is house-format (`VENDOR-TYPE…`) the code is read back
from `Variant Barcode`; a blank `Variant SKU` is a generated row (any stray
barcode ignored). A house-format `Variant SKU` is never re-hashed. So
`generate → import → re-export → regenerate` is stable — no double-hashing, no
lost supplier codes. The downloaded file is the uploaded file with `Variant SKU`
set to the house SKU and `Variant Barcode` holding the supplier code (cleared for
generated rows). The carrier field is configurable in `js/sku/config.js`.

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
