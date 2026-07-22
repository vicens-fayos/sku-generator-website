// The house SKU goes into `Variant SKU` (the downstream mapping key), so the
// durable supplier code must live elsewhere or re-imports overwrite it and
// re-runs double-hash. Variant metafields don't round-trip through native
// Shopify CSV, so we repurpose the native per-variant `Variant Barcode` field
// (confirmed unused for these shops). The generator owns it: supplier code for
// provider variants, cleared for generated ones.
export const SUPPLIER_SKU_FIELD = "Variant Barcode";
