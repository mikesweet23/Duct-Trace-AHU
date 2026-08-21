// Takeoff / bill of materials from the physical model — not from
// centreline estimates. Filters and costing fields stay on each row.

import { round } from "../units.js";
import { sizeKey, sizeLabel } from "./catalog.js";
import { FITTINGS } from "../standards/fittings.js";

function pieceQty(p) {
  return Number(p.qty) > 0 ? Number(p.qty) : 1;
}

export function emptyTakeoffFilters() {
  return {
    scope: "project",
    system: "",
    ahu: "",
    floor: "",
    zone: "",
    branch: "",
    size: "",
    type: "",
    area: "",
  };
}

export function filterPieces(pieces, filters = {}, project = null) {
  const f = { ...emptyTakeoffFilters(), ...filters };
  return (pieces || []).filter((p) => {
    if (p.kind === "support" && f.scope === "fabrication") return false;
    if (f.system && p.system !== f.system) return false;
    if (f.ahu && p.plantId !== f.ahu) return false;
    if (f.floor && (p.floor || "") !== f.floor) return false;
    if (f.zone && (p.zone || "") !== f.zone) return false;
    if (f.area && (p.area || "") !== f.area) return false;
    if (f.branch && p.role && p.role !== f.branch && p.segmentId !== f.branch) return false;
    if (f.size && sizeKey(p.section) !== f.size) return false;
    if (f.type && p.construction !== f.type && p.kind !== f.type) return false;
    if (f.scope === "system" && f.system && p.system !== f.system) return false;
    return true;
  });
}

export function takeoffRow(p) {
  const sizeTo = p.sectionTo ? ` → ${sizeLabel(p.sectionTo)}` : "";
  const branch = p.branchSection ? ` × ${sizeLabel(p.branchSection)}` : "";
  return {
    ref: p.ref,
    kind: p.kind,
    label: p.label,
    description: `${p.label}${p.angleDeg ? ` ${p.angleDeg}°` : ""}${sizeTo}${branch}`,
    system: p.system,
    construction: p.construction,
    size: sizeLabel(p.section) + sizeTo + branch,
    sizeKey: sizeKey(p.section),
    lengthM: p.lengthM || 0,
    qty: pieceQty(p),
    standard: !!p.standard,
    angleDeg: p.angleDeg || null,
    sheetAreaM2: p.sheetAreaM2 || 0,
    weightKg: p.weightKg || 0,
    insulationType: p.insulation?.type || "",
    insulationThicknessMm: p.insulation?.thicknessMm || 0,
    insulationAreaM2: p.insulationAreaM2 || 0,
    insulationVolumeM3: p.insulationVolumeM3 || 0,
    cladding: p.insulation?.cladding || "",
    claddingAreaM2: p.claddingAreaM2 || 0,
    floor: p.floor || "",
    zone: p.zone || "",
    area: p.area || "",
    segmentId: p.segmentId || "",
    plantId: p.plantId || "",
    fittingType: p.fittingType || "",
    costing: p.costing || {},
    estimate: !!p.estimate,
  };
}

function pushGroup(map, key, seed, update) {
  if (!map.has(key)) map.set(key, seed());
  update(map.get(key));
}

export function buildTakeoff(model, filters = {}, project = null) {
  const pieces = filterPieces(model?.pieces || [], filters, project);
  const rows = pieces.map(takeoffRow);

  const circular = new Map();
  const rectangular = new Map();
  const fittings = new Map();
  const joints = new Map();
  const boots = new Map();
  const ancillaries = new Map();
  const supports = new Map();
  const insulation = new Map();

  for (const p of pieces) {
    const qty = pieceQty(p);
    if (p.kind === "straight") {
      const target = p.section?.shape === "rect" || p.section?.shape === "square" ? rectangular : circular;
      const key = `${p.construction}|${sizeKey(p.section)}`;
      pushGroup(target, key, () => ({
        construction: p.construction,
        size: sizeLabel(p.section),
        sizeKey: sizeKey(p.section),
        shape: p.section?.shape,
        widthMm: p.section?.widthMm,
        heightMm: p.section?.heightMm,
        diameterMm: p.section?.diameterMm,
        lengthM: 0,
        standardCount: 0,
        cutCount: 0,
        cutLengthM: 0,
        sections: 0,
        sheetAreaM2: 0,
        weightKg: 0,
        standardM: p.standardLengthM || 3,
      }), (g) => {
        g.lengthM += p.lengthM || 0;
        g.sections += qty;
        g.sheetAreaM2 += p.sheetAreaM2 || 0;
        g.weightKg += p.weightKg || 0;
        if (p.standard) g.standardCount += qty;
        else {
          g.cutCount += qty;
          g.cutLengthM += p.lengthM || 0;
        }
      });
    } else if (p.kind === "coupler") {
      const key = `${p.construction}|${sizeKey(p.section)}`;
      pushGroup(joints, key, () => ({
        label: p.label,
        size: sizeLabel(p.section),
        construction: p.construction,
        qty: 0,
      }), (g) => { g.qty += qty; });
    } else if (p.kind === "boot") {
      const key = `${p.fittingType}|${sizeKey(p.section)}`;
      pushGroup(boots, key, () => ({
        label: p.label,
        size: sizeLabel(p.section),
        qty: 0,
        refs: [],
      }), (g) => { g.qty += qty; g.refs.push(p.ref); });
    } else if (p.kind === "support") {
      const key = p.fittingType || "support";
      pushGroup(supports, key, () => ({ label: p.label, qty: 0 }), (g) => { g.qty += qty; });
    } else if (p.kind === "damper" || p.kind === "flex" || p.kind === "attenuator") {
      const key = `${p.fittingType}|${sizeKey(p.section)}`;
      pushGroup(ancillaries, key, () => ({
        label: p.label,
        size: sizeLabel(p.section),
        qty: 0,
        refs: [],
      }), (g) => { g.qty += qty; g.refs.push(p.ref); });
    } else {
      const angle = p.angleDeg ? ` ${p.angleDeg}°` : "";
      const sizeTo = p.sectionTo ? ` × ${sizeLabel(p.sectionTo)}` : "";
      const branch = p.branchSection ? ` × ${sizeLabel(p.branchSection)}` : "";
      const key = `${p.kind}|${p.fittingType}|${sizeKey(p.section)}|${sizeTo}|${branch}|${angle}`;
      pushGroup(fittings, key, () => ({
        kind: p.kind,
        fittingType: p.fittingType,
        label: (FITTINGS[p.fittingType]?.label || p.label) + angle,
        size: sizeLabel(p.section) + sizeTo + branch,
        qty: 0,
        refs: [],
      }), (g) => { g.qty += qty; g.refs.push(p.ref); });
    }

    if ((p.insulationAreaM2 || 0) > 0) {
      const key = `${p.insulation?.type || "insulation"}|${p.insulation?.thicknessMm || 0}`;
      pushGroup(insulation, key, () => ({
        type: p.insulation?.type || "Insulation",
        thicknessMm: p.insulation?.thicknessMm || 0,
        areaM2: 0,
        volumeM3: 0,
        cladding: p.insulation?.cladding || "",
        claddingAreaM2: 0,
      }), (g) => {
        g.areaM2 += p.insulationAreaM2 || 0;
        g.volumeM3 += p.insulationVolumeM3 || 0;
        g.claddingAreaM2 += p.claddingAreaM2 || 0;
        if (p.insulation?.cladding) g.cladding = p.insulation.cladding;
      });
    }
  }

  const roundGroup = (g) => {
    if (g.lengthM != null) g.lengthM = round(g.lengthM, 2);
    if (g.cutLengthM != null) g.cutLengthM = round(g.cutLengthM, 2);
    if (g.sheetAreaM2 != null) g.sheetAreaM2 = round(g.sheetAreaM2, 2);
    if (g.weightKg != null) g.weightKg = round(g.weightKg, 1);
    if (g.areaM2 != null) g.areaM2 = round(g.areaM2, 2);
    if (g.volumeM3 != null) g.volumeM3 = round(g.volumeM3, 3);
    if (g.claddingAreaM2 != null) g.claddingAreaM2 = round(g.claddingAreaM2, 2);
    return g;
  };

  return {
    generatedAt: Date.now(),
    filters: { ...emptyTakeoffFilters(), ...filters },
    rows,
    circular: [...circular.values()].map(roundGroup),
    rectangular: [...rectangular.values()].map(roundGroup),
    fittings: [...fittings.values()],
    joints: [...joints.values()],
    boots: [...boots.values()],
    ancillaries: [...ancillaries.values()],
    supports: [...supports.values()],
    insulation: [...insulation.values()].map(roundGroup),
    totals: {
      pieces: pieces.filter((p) => p.kind !== "support").length,
      straightM: round(pieces.filter((p) => p.kind === "straight").reduce((s, p) => s + (p.lengthM || 0), 0), 2),
      sheetAreaM2: round(pieces.reduce((s, p) => s + (p.sheetAreaM2 || 0), 0), 2),
      insulationAreaM2: round(pieces.reduce((s, p) => s + (p.insulationAreaM2 || 0), 0), 2),
      claddingAreaM2: round(pieces.reduce((s, p) => s + (p.claddingAreaM2 || 0), 0), 2),
      fittings: pieces.filter((p) => p.category === "fitting").length,
      joints: pieces.filter((p) => p.kind === "coupler").length,
    },
  };
}

export function uniqueFilterValues(pieces) {
  const set = (key) => [...new Set(pieces.map((p) => p[key]).filter(Boolean))].sort();
  return {
    system: set("system"),
    ahu: set("plantId"),
    floor: set("floor"),
    zone: set("zone"),
    area: set("area"),
    branch: [...new Set(pieces.map((p) => p.role).filter(Boolean))].sort(),
    size: [...new Set(pieces.map((p) => sizeKey(p.section)).filter((k) => k && k !== "unknown"))].sort(),
    type: set("construction"),
  };
}
