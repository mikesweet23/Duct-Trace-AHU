// Sizing the outside terminals: the fresh-air intake and the exhaust.
//
// The velocity is taken through the louvre's FREE area, which is the gross
// face area times its free-area percentage (50% by default, adjustable per
// terminal, to be replaced by the chosen product's figure):
//
//   free area  = flow / velocity
//   gross area = free area / free-area fraction
//
// Intake is sized slow — 1.5 m/s by default — so rain and snow are not
// drawn in and the louvre does not whistle. Exhaust may run up to 5 m/s so
// the stale air is thrown clear of the building and its own intake; a
// faster design figure than that is capped.
//
// A range of standard circular and rectangular sizes is offered, smallest
// first, each with the free-area and face velocity it would actually give.

import { CIRCULAR_DIAMETERS, RECTANGULAR_SIDES } from "./dw144.js";

export const LOUVRE_DEFAULTS = {
  outdoor: { velocity: 1.5, maxVelocity: 2.5, freeAreaPct: 50, label: "Fresh-air intake" },
  exhaust: { velocity: 5.0, maxVelocity: 5.0, freeAreaPct: 50, label: "Exhaust discharge" },
};

export function louvreBasis(c) {
  const side = c?.system === "exhaust" ? "exhaust" : "outdoor";
  const d = LOUVRE_DEFAULTS[side];
  const v = Number(c?.props?.designVelocity);
  const fa = Number(c?.props?.freeAreaPct);
  return {
    side,
    velocity: Math.min(v > 0 ? v : d.velocity, d.maxVelocity),
    maxVelocity: d.maxVelocity,
    freeAreaPct: fa > 0 && fa <= 100 ? fa : d.freeAreaPct,
    label: d.label,
  };
}

function option(shape, wMm, hMm, areaM2, q, frac) {
  const free = areaM2 * frac;
  return {
    shape,
    widthMm: wMm,
    heightMm: hMm,
    label: shape === "circular" ? `ø${wMm}` : `${wMm} × ${hMm}`,
    grossAreaM2: areaM2,
    freeAreaM2: free,
    freeVelocity: free > 0 ? q / free : 0,
    faceVelocity: areaM2 > 0 ? q / areaM2 : 0,
  };
}

// flowLs: the terminal's airflow; opts: { velocity, freeAreaPct, count }.
export function sizeLouvre(flowLs, opts = {}) {
  const q = Math.max(0, Number(flowLs) || 0) / 1000;
  const v = Number(opts.velocity) > 0 ? Number(opts.velocity) : 1.5;
  const frac = (Number(opts.freeAreaPct) > 0 ? Number(opts.freeAreaPct) : 50) / 100;
  const count = Math.max(1, Math.round(Number(opts.count) || 5));
  const freeAreaM2 = q / v;
  const grossAreaM2 = freeAreaM2 / frac;
  if (!(q > 0)) return { flowM3s: 0, velocity: v, freeAreaPct: frac * 100, freeAreaM2: 0, grossAreaM2: 0, circular: [], rectangular: [] };

  const circular = CIRCULAR_DIAMETERS
    .map((d) => option("circular", d, d, Math.PI * (d / 1000) ** 2 / 4, q, frac))
    .filter((o) => o.grossAreaM2 >= grossAreaM2 - 1e-12)
    .slice(0, Math.min(3, count));

  // rectangular: for each standard height, the narrowest standard width that
  // gives the area, kept to a sensible aspect ratio; then smallest first
  const rect = [];
  const seen = new Set();
  for (const h of RECTANGULAR_SIDES.filter((x) => x >= 150)) {
    const w = RECTANGULAR_SIDES.find((x) => x >= h && (x / 1000) * (h / 1000) >= grossAreaM2 - 1e-12);
    if (!w || w / h > 4) continue;
    const key = `${w}x${h}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rect.push(option("rectangular", w, h, (w / 1000) * (h / 1000), q, frac));
  }
  rect.sort((a, b) => a.grossAreaM2 - b.grossAreaM2 || Math.abs(1 - a.widthMm / a.heightMm) - Math.abs(1 - b.widthMm / b.heightMm));
  return {
    flowM3s: q,
    velocity: v,
    freeAreaPct: frac * 100,
    freeAreaM2,
    grossAreaM2,
    circular,
    rectangular: rect.slice(0, count),
  };
}
