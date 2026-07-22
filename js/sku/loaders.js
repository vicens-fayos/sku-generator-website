import { parseCSV } from "../csv.js";

export function valueKey(conceptId, rawValue) {
  return `${conceptId} ${rawValue}`;
}

function loadVendor(text) {
  const map = new Map();
  for (const row of parseCSV(text).rows) {
    const raw = row["raw_vendor"];
    if (raw) map.set(raw, row["vendor_abv"]);
  }
  return map;
}

function loadType(text) {
  const map = new Map();
  for (const row of parseCSV(text).rows) {
    const raw = row["raw"];
    if (!raw) continue;
    const needsReview = (row["needs_review"] || "").trim().toLowerCase() === "yes";
    map.set(raw, { id: row["id"], needsReview });
  }
  return map;
}

function loadTypeGroups(typeAbvText, typeMapText) {
  const map = new Map();
  const add = (group, abv) => {
    const key = (group || "").trim().toUpperCase();
    if (!key) return;
    if (map.has(key) && map.get(key) !== abv) {
      throw new Error(`TYPE_GROUP conflict for ${key}: ${map.get(key)} vs ${abv}`);
    }
    map.set(key, abv);
  };
  for (const row of parseCSV(typeAbvText).rows) add(row["type_group"], row["type_abv"]);
  for (const row of parseCSV(typeMapText).rows) add(row["normalized"], row["id"]);
  return map;
}

function loadConcept(text) {
  const map = new Map();
  for (const row of parseCSV(text).rows) {
    map.set(row["raw_option_name"], { concept: row["concept"], conceptId: row["concept_id"] });
  }
  return map;
}

function loadValue(text) {
  const map = new Map();
  for (const row of parseCSV(text).rows) {
    const key = valueKey(row["concept_id"], row["raw_option_value"]);
    const normalized = row["normalized_option_value"];
    if (map.has(key) && map.get(key) !== normalized) {
      throw new Error(`VALUE conflict for ${key}: ${map.get(key)} vs ${normalized}`);
    }
    map.set(key, normalized);
  }
  return map;
}

export function buildReferences(texts) {
  return {
    vendor: loadVendor(texts.vendor),
    type: loadType(texts.type),
    typeGroup: loadTypeGroups(texts.typeAbv, texts.type),
    concept: loadConcept(texts.optionNames),
    value: loadValue(texts.optionValues),
  };
}
