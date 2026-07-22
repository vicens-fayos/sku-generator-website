# SKU Generator Website

Upload a Matrixify Shopify product export (`.xlsx`) and get the generated
Shopify **Variant SKU** for every variant row — as a review table and a
downloadable **re-import `.xlsx`**. Runs 100% in the browser; nothing is
uploaded to any server.

## Idempotency (supplier-SKU metafield)

The house SKU goes into `Variant SKU`, so the durable supplier code is kept in a
per-variant metafield (`custom.supplier_sku`) instead of being overwritten. The
generator reads the supplier code from that metafield first, falling back to a
non-house `Variant SKU` on the first run. A `Variant SKU` already in our house
format (`VENDOR-TYPE…`) is never re-hashed. So `generate → import → re-export →
regenerate` is stable — no double-hashing, no lost supplier codes. The
downloaded file is the uploaded file with `Variant SKU` set to the house SKU and
the `custom.supplier_sku` column filled (added if absent) — re-import it via
Matrixify to complete the round-trip. The metafield key is configurable in
`js/sku/config.js`.

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
