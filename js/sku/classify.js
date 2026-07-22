export const TITLE_TYPE_RULES = [
  ["tripod", "SUPPORTS"], ["bipod", "SUPPORTS"], ["monopod", "SUPPORTS"],
  ["shooting bag", "BAGS"], ["duffle", "BAGS"], ["backpack", "BAGS"],
  ["pouch", "BAGS"], ["case", "CASES"],
  ["sling mount", "MOUNTS"], ["mount", "MOUNTS"], ["ring", "MOUNTS"],
  ["picatinny", "RAILS"], ["rail", "RAILS"],
  ["magnification wheel", "OPTICS ACCESSORIES"],
  ["parallax", "OPTICS ACCESSORIES"], ["sunshade", "OPTICS ACCESSORIES"],
  ["riflescope", "OPTICS"], ["scope", "OPTICS"],
  ["red dot", "AIM POINTS & LASERS"], ["laser", "AIM POINTS & LASERS"],
  ["chronograph", "CHRONOGRAPHS"], ["rangefinder", "RANGEFINDERS"],
  ["binocular", "BINOCULARS"],
  ["suppressor", "SUPPRESSORS"], ["moderator", "SUPPRESSORS"],
  ["silencer", "SUPPRESSORS"],
  ["magazine", "MAGAZINES"], ["regulator", "REGULATORS"],
  ["plenum", "PLENUMS"], ["barrel", "BARRELS"],
  ["stock", "STOCKS"], ["grip", "GRIPS"],
  ["tank", "BOTTLES"], ["bottle", "BOTTLES"],
  ["hose", "PCP FILL"], ["probe", "PCP FILL"], ["filling", "PCP FILL"],
  ["foster", "PCP FILL"],
  ["adapter", "ADAPTORS"], ["adaptor", "ADAPTORS"], ["coupler", "ADAPTORS"],
  ["o-ring", "O-RINGS"], ["compressor", "COMPRESSORS"], ["pump", "HANDPUMP"],
  ["slug", "AMMO"], ["pellet", "AMMO"],
  ["mold", "SLUG MOLD"], ["die", "SLUG MOLD"], ["press", "SLUG MOLD"],
  ["sticker", "MERCHANDISE"], ["shirt", "MERCHANDISE"],
  ["allen", "TOOLS"], ["wrench", "TOOLS"], ["screwdriver", "TOOLS"],
  ["torx", "TOOLS"], ["tool", "TOOLS"],
  ["gift card", "GIFT CARD"],
  ["lube", "ACCESSORIES"], ["grease", "ACCESSORIES"], ["sling", "ACCESSORIES"],
  ["spray", "ACCESSORIES"], ["detector", "ACCESSORIES"], ["swivel", "ACCESSORIES"],
  ["wheel", "OPTICS ACCESSORIES"],
];

export const OTHERS_GROUP = "OTHERS";

const REVIEW_AMBIGUOUS_TYPE = "AMBIGUOUS_TYPE";
const REVIEW_BLANK_TYPE = "BLANK_TYPE_TITLE_GUESS";
const UNRESOLVED_VENDOR = "UNRESOLVED_VENDOR";
const UNRESOLVED_TYPE = "UNRESOLVED_TYPE";

const s = (v) => (v === undefined || v === null ? "" : String(v));

export function isVariantRow(row) {
  return s(row.Title).trim() !== "" || s(row["Variant Price"]).trim() !== "";
}

export function inferTypeGroup(title) {
  const lowered = s(title).toLowerCase();
  for (const [keyword, group] of TITLE_TYPE_RULES) {
    if (lowered.includes(keyword)) return group;
  }
  return OTHERS_GROUP;
}

function inferTypeId(title, refs) {
  const group = inferTypeGroup(title);
  const id = refs.typeGroup.get(group.toUpperCase());
  if (id === undefined) throw new Error(`title-inference group ${group} not in TYPE_GROUP`);
  return id;
}

function leadRow(rows) {
  return rows.find((r) => s(r.Title).trim() !== "") || rows[0];
}

function buildProduct(handle, rows, refs) {
  const lead = leadRow(rows);
  const rawVendor = s(lead.Vendor);
  const rawType = s(lead.Type);
  const leadTitle = s(lead.Title);

  const vendorId = refs.vendor.get(rawVendor);
  if (vendorId === undefined) {
    return { handle, leadTitle, rawVendor, rawType, vendorId: null, typeId: null,
      prefix: null, reviewReason: UNRESOLVED_VENDOR, rows };
  }

  let typeId, reviewReason;
  if (rawType.trim() !== "") {
    const t = refs.type.get(rawType);
    if (t === undefined) {
      return { handle, leadTitle, rawVendor, rawType, vendorId, typeId: null,
        prefix: null, reviewReason: UNRESOLVED_TYPE, rows };
    }
    typeId = t.id;
    reviewReason = t.needsReview ? REVIEW_AMBIGUOUS_TYPE : null;
  } else {
    typeId = inferTypeId(leadTitle, refs);
    reviewReason = REVIEW_BLANK_TYPE;
  }

  return { handle, leadTitle, rawVendor, rawType, vendorId, typeId,
    prefix: `${vendorId}-${typeId}`, reviewReason, rows };
}

export function groupProducts(rows, refs) {
  const groups = new Map();
  const order = [];
  for (const row of rows) {
    if (!isVariantRow(row)) continue;
    const handle = s(row.Handle);
    if (!groups.has(handle)) { groups.set(handle, []); order.push(handle); }
    groups.get(handle).push(row);
  }
  return order.map((h) => buildProduct(h, groups.get(h), refs));
}
