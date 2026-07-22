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

// Serialize an array-of-arrays (first row = header) to RFC-4180 CSV text.
export function aoaToCSV(aoa) {
  const esc = (v) => {
    const s = v === undefined || v === null ? "" : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return aoa.map((row) => row.map(esc).join(",")).join("\r\n");
}
