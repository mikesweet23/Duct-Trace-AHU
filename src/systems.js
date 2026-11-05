// The four airstreams of a ventilation unit, named to BS EN 16798-3:
//
//   ODA  outdoor air   fresh air in from outside, to the unit
//   SUP  supply air    from the unit, into the building
//   ETA  extract air   from the building, back to the unit
//   EHA  exhaust air   stale air from the unit, out to outside
//
// The supply fan pushes ODA + SUP in series and the extract fan pulls
// ETA + EHA in series, so each fan's available static has to cover the
// ductwork on both sides of it. That pairing is `fan` below.
//
// Colours follow the usual schematic convention: outdoor green, supply blue,
// extract yellow-orange, exhaust brown.
//
// On screen the codes are IN (internal — supply and extract, the building
// side of the unit) and EX (external — fresh air and exhaust, the outside
// side); `en` keeps the EN 16798-3 abbreviation for reference.

export const SYSTEMS = {
  supply:  { key: "supply",  code: "IN", en: "SUP", label: "Supply",    long: "Supply air — into the building",   color: "#1f6fd1", fan: "supply",  outside: false, towardUnit: false },
  extract: { key: "extract", code: "IN", en: "ETA", label: "Extract",   long: "Extract air — back from the building", color: "#c2410c", fan: "extract", outside: false, towardUnit: true },
  outdoor: { key: "outdoor", code: "EX", en: "ODA", label: "Fresh air", long: "Outdoor air — fresh air in from outside", color: "#15803d", fan: "supply",  outside: true,  towardUnit: true },
  exhaust: { key: "exhaust", code: "EX", en: "EHA", label: "Exhaust",   long: "Exhaust air — stale air out to outside", color: "#7c4a1e", fan: "extract", outside: true,  towardUnit: false },
};

export const SYSTEM_KEYS = ["supply", "extract", "outdoor", "exhaust"];

export function systemInfo(key) {
  return SYSTEMS[key] || SYSTEMS.supply;
}

export function systemColor(key) {
  return systemInfo(key).color;
}

export function systemLabel(key) {
  return systemInfo(key).label;
}

// Which fan of a two-port unit moves this airstream: ODA rides with SUP,
// EHA with ETA.
export function fanSide(key) {
  return systemInfo(key).fan;
}

export function isOutsideSystem(key) {
  return !!SYSTEMS[key]?.outside;
}

// ---------------------------------------------------------------------------
// Named, numbered and coloured systems.
//
// A floor often carries several systems — AHU-01 to the east offices, AHU-02
// to the west, an HRV to the meeting rooms. Each unit or fan is one system:
// it carries a tag (AHU-01), a name (East offices) and a colour, and every
// duct and terminal joined to it takes that colour on the plan, in 3D and in
// the report. The airstream still shows: a stripe down the duct, the ring on
// the unit and the system's name ("AHU-01 East offices — Supply").
//
// Colours avoid the selection gold, the index-run pink and the over-velocity
// red so those still read.
export const SYSTEM_PALETTE = [
  "#1f6fd1", // blue
  "#7c3aed", // violet
  "#0d9488", // teal
  "#ea580c", // orange
  "#4d7c0f", // olive
  "#0891b2", // cyan
  "#9f1239", // wine
  "#475569", // slate
  "#a855f7", // lilac
  "#854d0e", // bronze
  "#15803d", // green
  "#1e3a8a", // navy
];

// How the plan colours ducts: by system (each unit its own colour) or by
// airstream (supply blue, extract orange…, the EN 16798-3 convention).
export const COLOUR_MODES = { system: "By system (unit colour)", airstream: "By airstream (supply / extract / fresh / exhaust)" };

export function nextSystemColor(used = []) {
  const taken = new Set(used.map((c) => String(c || "").toLowerCase()));
  return SYSTEM_PALETTE.find((c) => !taken.has(c.toLowerCase())) || SYSTEM_PALETTE[used.length % SYSTEM_PALETTE.length];
}

// AHU-01, AHU-02, HRV-01, FAN-01 … the next free number for that prefix.
export function nextSystemTag(prefix, usedTags = []) {
  const re = new RegExp(`^${prefix}-(\\d+)$`, "i");
  let max = 0;
  for (const t of usedTags) {
    const m = re.exec(String(t || "").trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${String(max + 1).padStart(2, "0")}`;
}

// "AHU-01 East offices", or just one of the two, or the fallback.
export function systemTitle(plant, fallback = "") {
  if (!plant) return fallback;
  const bits = [plant.tag, plant.label].map((x) => String(x || "").trim()).filter(Boolean);
  return bits.length ? bits.join(" ") : fallback;
}
