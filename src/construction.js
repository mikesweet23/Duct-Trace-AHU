// Project-default construction vs per-section / per-branch overrides.
// Changing the project default never rewrites a section that already
// has its own construction. A branch apply walks downstream from the
// plant so a take-off can be spiral while the trunk stays rectangular.

import { componentDef } from "./standards/components.js";

export const PROJECT_CONSTRUCTIONS = [
  { key: "round", construction: "spiral", label: "Spiral" },
  { key: "square", construction: "square", label: "Square" },
  { key: "rect", construction: "rectangular", label: "Rectangular" },
];

export const SECTION_CONSTRUCTIONS = [
  { key: "spiral", shape: "round", label: "Spiral" },
  { key: "plain_circular", shape: "round", label: "Plain circular" },
  { key: "square", shape: "square", label: "Square" },
  { key: "rectangular", shape: "rect", label: "Rectangular" },
];

export function constructionToShape(key) {
  if (key === "spiral" || key === "plain_circular") return "round";
  if (key === "square") return "square";
  if (key === "rectangular") return "rect";
  return null;
}

export function shapeToConstruction(shape, settings = {}) {
  if (shape === "round") return settings.defaultConstructionRound || "spiral";
  if (shape === "square") return "square";
  if (shape === "rect") return settings.defaultConstructionRect || "rectangular";
  return settings.defaultConstructionRound || "spiral";
}

export function projectConstructionLabel(settings) {
  const shape = settings?.ductType || "round";
  const found = PROJECT_CONSTRUCTIONS.find((c) => c.key === shape);
  return found?.label || "Spiral";
}

export function sectionConstructionKey(seg, settings) {
  if (seg?.constructionType) return seg.constructionType;
  if (seg?.shapeOverride) return shapeToConstruction(seg.shapeOverride, settings);
  return shapeToConstruction(settings?.ductType || "round", settings);
}

export function setSegmentConstruction(seg, constructionKey, settings = {}) {
  if (!constructionKey) {
    seg.shapeOverride = null;
    seg.constructionType = null;
    return seg;
  }
  const shape = constructionToShape(constructionKey);
  seg.shapeOverride = shape;
  seg.constructionType = constructionKey;
  if (seg.sizeOverride) {
    if (shape === "round") {
      seg.sizeOverride = seg.sizeOverride.diameterMm
        ? { diameterMm: seg.sizeOverride.diameterMm }
        : null;
    } else if (shape === "square") {
      const side = seg.sizeOverride.widthMm || seg.sizeOverride.heightMm;
      seg.sizeOverride = side ? { widthMm: side, heightMm: side } : null;
    } else {
      const w = seg.sizeOverride.widthMm;
      const h = seg.sizeOverride.heightMm;
      seg.sizeOverride = w || h ? { widthMm: w || h, heightMm: h || w } : null;
    }
  }
  return seg;
}

function plantRoots(project, system) {
  const ids = [];
  for (const c of project.components || []) {
    const def = componentDef(c.kind);
    if (def?.role !== "plant") continue;
    if (c.system !== system && c.system !== "both") continue;
    const key = { extract: "returnNodeId", outdoor: "outdoorNodeId", exhaust: "exhaustNodeId" }[system];
    if (c.system === "both" && key && c[key]) ids.push(c[key]);
    else if (c.nodeId) ids.push(c.nodeId);
  }
  return ids;
}

export function downstreamSegments(project, startSeg) {
  if (!startSeg) return [];
  const segs = (project.segments || []).filter((s) => s.system === startSeg.system);
  const adj = new Map();
  for (const s of segs) {
    if (!adj.has(s.a)) adj.set(s.a, []);
    if (!adj.has(s.b)) adj.set(s.b, []);
    adj.get(s.a).push({ seg: s, other: s.b });
    adj.get(s.b).push({ seg: s, other: s.a });
  }
  const roots = plantRoots(project, startSeg.system);
  const parentNode = new Map();
  const visited = new Set(roots);
  const q = [...roots];
  while (q.length) {
    const n = q.shift();
    for (const { other } of adj.get(n) || []) {
      if (visited.has(other)) continue;
      visited.add(other);
      parentNode.set(other, n);
      q.push(other);
    }
  }

  let child = null;
  if (parentNode.get(startSeg.b) === startSeg.a) child = startSeg.b;
  else if (parentNode.get(startSeg.a) === startSeg.b) child = startSeg.a;

  const ids = new Set([startSeg.id]);
  if (child) {
    const qq = [child];
    const seen = new Set([child]);
    while (qq.length) {
      const n = qq.shift();
      for (const { seg, other } of adj.get(n) || []) {
        if (parentNode.get(other) !== n) continue;
        ids.add(seg.id);
        if (!seen.has(other)) {
          seen.add(other);
          qq.push(other);
        }
      }
    }
  }
  return segs.filter((s) => ids.has(s.id));
}

export function applyConstruction(project, startSeg, constructionKey, scope = "section") {
  const settings = project.settings || {};
  const targets = scope === "branch"
    ? downstreamSegments(project, startSeg)
    : [startSeg];
  for (const s of targets) setSegmentConstruction(s, constructionKey, settings);
  return targets;
}
