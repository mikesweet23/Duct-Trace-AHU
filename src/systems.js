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

export const SYSTEMS = {
  supply:  { key: "supply",  code: "SUP", label: "Supply",    long: "Supply air — into the building",   color: "#1f6fd1", fan: "supply",  outside: false, towardUnit: false },
  extract: { key: "extract", code: "ETA", label: "Extract",   long: "Extract air — back from the building", color: "#c2410c", fan: "extract", outside: false, towardUnit: true },
  outdoor: { key: "outdoor", code: "ODA", label: "Fresh air", long: "Outdoor air — fresh air in from outside", color: "#15803d", fan: "supply",  outside: true,  towardUnit: true },
  exhaust: { key: "exhaust", code: "EHA", label: "Exhaust",   long: "Exhaust air — stale air out to outside", color: "#7c4a1e", fan: "extract", outside: true,  towardUnit: false },
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
