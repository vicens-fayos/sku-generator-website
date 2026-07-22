// Configurable supplier-SKU metafield identity (SPEC: idempotency).
//
// The house SKU goes into `Variant SKU` (the downstream mapping key), so the
// durable supplier code must live in its own per-variant Shopify metafield or
// it gets overwritten and re-runs double-hash it. Change the key here to point
// the generator at a different metafield.

export const SUPPLIER_SKU_METAFIELD_KEY = "custom.supplier_sku";

// Canonical column added to the output when the upload has no supplier column
// yet, so a Matrixify re-import creates the metafield at variant scope.
export const SUPPLIER_SKU_COLUMN = "Supplier SKU (variant.metafields.custom.supplier_sku)";
