// Engineering vs graphical length, standard-length cutting, and
// transition geometry. Pressure loss, takeoff and costing all use the
// engineering length; the sketch can stay out of scale.

import { routeLengthM } from "../geom.js";
import { round } from "../units.js";

export const DEFAULT_STANDARD_LENGTH_M = 3.0;
export const DEFAULT_TRANSITION_ANGLE_DEG = 15;

export function graphicalLengthM(a, b, pxPerMeter) {
  if (!a || !b) return 0;
  return routeLengthM(a, b, pxPerMeter);
}

export function hasLengthOverride(seg) {
  const v = Number(seg?.engineeringLengthM);
  return Number.isFinite(v) && v > 0;
}

export function engineeringLengthM(seg, a, b, pxPerMeter) {
  if (hasLengthOverride(seg)) return Number(seg.engineeringLengthM);
  return graphicalLengthM(a, b, pxPerMeter);
}

// Accept "12.5", "12.5 m", "12500 mm", "12,5m".
export function parseLengthM(text) {
  if (text == null) return null;
  const raw = String(text).trim().toLowerCase().replace(/,/g, ".");
  if (raw === "") return null;
  const m = raw.match(/^(-?[\d.]+)\s*(mm|cm|m|metres|meters)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 0) return null;
  const u = m[2] || "m";
  if (u === "mm") return n / 1000;
  if (u === "cm") return n / 100;
  return n;
}

export function formatLengthM(m, dp = 2) {
  return `${round(Number(m) || 0, dp)} m`;
}

// 11.2 m at 3.0 m → three standards + one 2.2 m cut.
export function splitStandardLengths(lengthM, standardM = DEFAULT_STANDARD_LENGTH_M) {
  const L = Number(lengthM) || 0;
  const std = Number(standardM) > 0 ? Number(standardM) : DEFAULT_STANDARD_LENGTH_M;
  if (L <= 1e-9) return { parts: [], standardCount: 0, cutCount: 0, totalM: 0 };
  const n = Math.floor((L + 1e-9) / std);
  const rem = round(L - n * std, 3);
  const parts = [];
  for (let i = 0; i < n; i++) parts.push({ lengthM: std, standard: true });
  if (rem > 0.001) parts.push({ lengthM: rem, standard: false });
  return {
    parts,
    standardCount: n,
    cutCount: rem > 0.001 ? 1 : 0,
    cutLengthM: rem > 0.001 ? rem : 0,
    totalM: round(L, 3),
    standardM: std,
  };
}

export function circularDeltaMm(fromMm, toMm) {
  return Math.abs((Number(fromMm) || 0) - (Number(toMm) || 0));
}

export function rectDeltaMm(from, to) {
  const dw = Math.abs((from?.widthMm || 0) - (to?.widthMm || 0));
  const dh = Math.abs((from?.heightMm || 0) - (to?.heightMm || 0));
  return Math.max(dw, dh);
}

// Concentric transition length from a maximum wall angle.
export function transitionLengthM(deltaMm, maxAngleDeg = DEFAULT_TRANSITION_ANGLE_DEG) {
  const delta = Math.max(0, Number(deltaMm) || 0) / 1000;
  const ang = ((Number(maxAngleDeg) || DEFAULT_TRANSITION_ANGLE_DEG) * Math.PI) / 180;
  const tan = Math.tan(ang);
  if (tan < 1e-6) return 0.15;
  return Math.max(0.15, round((delta / 2) / tan, 3));
}

export function elbowCentrelineM(sizeMm, angleDeg = 90, radiusRatio = 1.5) {
  const d = (Number(sizeMm) || 200) / 1000;
  const r = Math.max(d * (Number(radiusRatio) || 1.5), d * 0.5);
  return round(((Number(angleDeg) || 90) / 360) * 2 * Math.PI * r, 3);
}

export function sectionMajorMm(section) {
  if (!section) return 200;
  if (section.shape === "rect" || section.shape === "square") {
    return Math.max(section.widthMm || 0, section.heightMm || 0) || 200;
  }
  return section.diameterMm || 200;
}

export function emptyCosting() {
  return {
    materialRate: null,
    fabricationRate: null,
    installationRate: null,
    labourHours: null,
    insulationRate: null,
    purchaseCost: null,
    sellRate: null,
  };
}
