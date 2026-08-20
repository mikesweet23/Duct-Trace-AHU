// Snapping for duct tracing. Ported in spirit from ac-trace:
//
//   A run can only join a point that already exists — an outlet, an AHU,
//   a T-piece, or a corner already traced. The cursor is pulled to the
//   nearest one only when it is nearby (SNAP_PX). A click on a run whose
//   nearest existing point is further than SNAP_PULL_PX is just the next
//   corner, not a yank to the far end. That is what lets supply and return
//   sit close together without snapping into each other.
//
//   Hold Alt (or use the T-piece tool) to cut a joint exactly where the
//   cursor is.

import { dist, pointSegment } from "./geom.js";
import { componentDef } from "./standards/components.js";
import {
  connPoint,
  distToComponentBox,
  preferredPort,
  pxPerMeterOf,
  snapOnComponent,
} from "./layout.js";

export const SNAP_PX = 14;
export const SNAP_PULL_PX = 36;
export const JOINT_HIT_PX = 18;

export function nodeZ(n, fallback = 0) {
  const z = Number(n?.z);
  return Number.isFinite(z) ? z : fallback;
}

export function componentWord(c) {
  const def = componentDef(c.kind);
  if (!def) return "component";
  if (c.kind === "ahu") return "AHU";
  return def.label.toLowerCase();
}

function nodeOf(project, id) {
  return project.nodes.find((n) => n.id === id) || null;
}

export function hitSegment(project, p, tolWorld) {
  let best = null;
  for (const s of project.segments) {
    const a = nodeOf(project, s.a);
    const b = nodeOf(project, s.b);
    if (!a || !b) continue;
    const r = pointSegment(p, a, b);
    if (r.distance <= tolWorld && (!best || r.distance < best.r.distance)) {
      best = { seg: s, r, a, b };
    }
  }
  return best;
}

export function heightAlong(a, b, t) {
  const z0 = nodeZ(a);
  const z1 = nodeZ(b);
  return z0 + (z1 - z0) * Math.max(0, Math.min(1, t));
}

// What a click at p would connect to. Pure — draws the same answer it acts on.
export function snapAt(project, p, opts = {}) {
  const zoom = opts.zoom || 1;
  const skipId = opts.skipNodeId || null;
  const system = opts.system || null;
  const alt = !!opts.alt;
  const snapPoints = opts.snapPoints !== false;
  const pxPerMeter = pxPerMeterOf(project);
  const tol = SNAP_PX / zoom;

  let best = null;
  const take = (d, c) => {
    if (d <= tol && (!best || d < best.d)) best = { ...c, d };
  };

  for (const c of project.components) {
    const n = nodeOf(project, c.nodeId);
    if (!n) continue;
    if (n.id === skipId) continue;
    if (c.returnNodeId && c.returnNodeId === skipId) continue;
    const boxD = distToComponentBox(c, p, pxPerMeter);
    const land = snapOnComponent(c, p, pxPerMeter);
    const port = preferredPort(c, system);
    const targetNode = nodeOf(project, port.nodeId) || n;
    const dualOnCasing = c.kind === "ahu" && c.system === "both" && boxD <= 0 && port.off;
    const at = dualOnCasing ? connPoint(c, port.off, pxPerMeter) : land.at;
    const off = dualOnCasing ? port.off : land.off;
    take(boxD, {
      kind: "component",
      component: c,
      node: targetNode,
      at,
      off,
      what: componentWord(c) + (off ? " edge" : ""),
      name: c.label || "",
    });
  }

  for (const n of project.nodes) {
    if (n.id === skipId) continue;
    const hasComp = project.components.some((c) => c.nodeId === n.id || c.returnNodeId === n.id);
    if (hasComp) continue;
    take(dist(n, p), {
      kind: "node",
      node: n,
      at: { x: n.x, y: n.y },
      off: null,
      what: n.tee ? "T-piece" : "junction",
      name: "",
    });
  }

  if (best) return best;

  const hit = hitSegment(project, p, 10 / zoom);
  if (!hit) return null;
  if (!snapPoints || alt) {
    return {
      kind: "run",
      seg: hit.seg,
      r: hit.r,
      at: { x: hit.r.point.x, y: hit.r.point.y },
      d: hit.r.distance,
      z: heightAlong(hit.a, hit.b, hit.r.t),
      what: "new T-piece here",
      name: "",
    };
  }

  // Nearby existing ends only — never the mid-run of a close parallel duct.
  let bp = null;
  const consider = (c) => {
    const d = dist(c.at, p);
    if (!bp || d < bp.d) bp = { ...c, d };
  };
  if (hit.a.id !== skipId) {
    consider({ kind: "node", node: hit.a, at: { x: hit.a.x, y: hit.a.y }, off: null, what: "end", name: "" });
  }
  if (hit.b.id !== skipId) {
    consider({ kind: "node", node: hit.b, at: { x: hit.b.x, y: hit.b.y }, off: null, what: "end", name: "" });
  }
  if (bp && bp.d <= SNAP_PULL_PX / zoom) {
    bp.pulled = true;
    return bp;
  }
  return null;
}

export function hitJointAt(project, p, zoom) {
  return hitSegment(project, p, JOINT_HIT_PX / (zoom || 1));
}
