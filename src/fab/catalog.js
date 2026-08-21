// Construction types, insulation inheritance, and takeoff categories.
// Costing fields live on every item so a later estimating module can
// attach rates without rebuilding the data model.

import { emptyCosting } from "./lengths.js";

export const CONSTRUCTION_TYPES = {
  spiral: { key: "spiral", label: "Spiral duct", shape: "round", family: "circular" },
  plain_circular: { key: "plain_circular", label: "Plain circular duct", shape: "round", family: "circular" },
  square: { key: "square", label: "Square duct", shape: "square", family: "rectangular" },
  rectangular: { key: "rectangular", label: "Rectangular duct", shape: "rect", family: "rectangular" },
};

export const FUTURE_CONSTRUCTION = ["flat_oval", "flexible", "fabric", "pre_insulated"];

export const PIECE_KINDS = {
  straight: { prefix: "D", label: "Straight duct", category: "straight" },
  coupler: { prefix: "J", label: "Coupler / joint", category: "joint" },
  elbow: { prefix: "F", label: "Bend", category: "fitting" },
  reducer: { prefix: "F", label: "Reducer", category: "fitting" },
  enlarger: { prefix: "F", label: "Enlarger", category: "fitting" },
  transition: { prefix: "F", label: "Transition", category: "fitting" },
  sqr_to_round: { prefix: "F", label: "Square-to-round", category: "fitting" },
  tee: { prefix: "F", label: "Tee", category: "fitting" },
  y_branch: { prefix: "F", label: "Y branch", category: "fitting" },
  lateral: { prefix: "F", label: "Lateral branch", category: "fitting" },
  saddle: { prefix: "F", label: "Saddle", category: "fitting" },
  shoe: { prefix: "F", label: "Shoe", category: "fitting" },
  offset: { prefix: "F", label: "Offset", category: "fitting" },
  boot: { prefix: "B", label: "Boot", category: "boot" },
  end_cap: { prefix: "F", label: "End cap", category: "fitting" },
  flex: { prefix: "A", label: "Flexible connector", category: "ancillary" },
  damper: { prefix: "A", label: "Damper", category: "ancillary" },
  attenuator: { prefix: "A", label: "Attenuator", category: "ancillary" },
  support: { prefix: "S", label: "Support", category: "support" },
};

export function emptyInsulation() {
  return { type: "", thicknessMm: 0, cladding: "", source: "none" };
}

function insulationSet(ins) {
  if (!ins) return false;
  return Boolean(ins.type) || Number(ins.thicknessMm) > 0 || Boolean(ins.cladding);
}

export function inheritInsulation(project, seg, systemType) {
  const settings = project.settings || {};
  const sysIns = (settings.insulationBySystem || {})[systemType] || {};
  const def = settings.defaultInsulation || {};
  const over = seg?.insulationOverride || {};
  const chosen = insulationSet(over) ? over : insulationSet(sysIns) ? sysIns : def;
  const type = chosen.type || "";
  const thicknessMm = Number(chosen.thicknessMm) || 0;
  const cladding = chosen.cladding || "";
  const source = insulationSet(over) ? "section" : insulationSet(sysIns) ? "system" : insulationSet(def) ? "project" : "none";
  return { type, thicknessMm, cladding, source };
}

export function constructionFor(seg, settings, shape) {
  if (seg?.constructionType && CONSTRUCTION_TYPES[seg.constructionType]) {
    return seg.constructionType;
  }
  const sh = shape || seg?.shapeOverride || settings?.ductType || "round";
  if (sh === "square") return "square";
  if (sh === "rect") return settings?.defaultConstructionRect || "rectangular";
  return settings?.defaultConstructionRound || "spiral";
}

export function constructionLabel(key) {
  return CONSTRUCTION_TYPES[key]?.label || key || "—";
}

export function isCircularConstruction(key) {
  return CONSTRUCTION_TYPES[key]?.family === "circular";
}

export function sizeKey(section) {
  if (!section) return "unknown";
  if (section.shape === "rect" || section.shape === "square") {
    return `${section.widthMm || 0}x${section.heightMm || 0}`;
  }
  return `dia${section.diameterMm || 0}`;
}

export function sizeLabel(section) {
  if (!section) return "—";
  if (section.shape === "rect" || section.shape === "square") {
    return `${section.widthMm || "—"} × ${section.heightMm || "—"}`;
  }
  return section.diameterMm ? `Ø${section.diameterMm}` : "—";
}

export function sheetAreaM2(section, lengthM) {
  const L = Number(lengthM) || 0;
  if (!section || L <= 0) return 0;
  if (section.shape === "rect" || section.shape === "square") {
    const w = (section.widthMm || 0) / 1000;
    const h = (section.heightMm || 0) / 1000;
    return 2 * (w + h) * L;
  }
  const d = (section.diameterMm || 0) / 1000;
  return Math.PI * d * L;
}

export function outerAreaM2(section, lengthM, extraMm = 0) {
  if (!section) return 0;
  const grown = section.shape === "rect" || section.shape === "square"
    ? { ...section, widthMm: (section.widthMm || 0) + extraMm * 2, heightMm: (section.heightMm || 0) + extraMm * 2 }
    : { ...section, diameterMm: (section.diameterMm || 0) + extraMm * 2 };
  return sheetAreaM2(grown, lengthM);
}

export function steelWeightKg(areaM2, thicknessMm = 0.8, density = 7850) {
  return (Number(areaM2) || 0) * ((Number(thicknessMm) || 0.8) / 1000) * density;
}

export function withCosting(item) {
  return { ...item, costing: item.costing || emptyCosting() };
}

export const TAKEOFF_FILTERS = [
  { key: "project", label: "Complete project" },
  { key: "system", label: "Air system" },
  { key: "ahu", label: "AHU" },
  { key: "floor", label: "Floor" },
  { key: "zone", label: "Zone" },
  { key: "branch", label: "Branch" },
  { key: "size", label: "Duct size" },
  { key: "type", label: "Duct type" },
  { key: "area", label: "Installation area" },
];
