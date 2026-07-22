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
