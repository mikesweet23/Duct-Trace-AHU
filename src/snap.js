// Snapping for duct tracing. Ported in spirit from ac-trace:
//
//   A run can only join a point that already exists — an outlet, an AHU,
//   a T-piece, or a corner already traced. The cursor is pulled to the
//   nearest one only when it is nearby. A click on a run whose nearest
//   existing point is further than SNAP_PULL_PX is just the next corner,
//   not a yank to the far end. That is what lets supply and return sit
//   close together without snapping into each other.
//
//   Hold Alt (or use the T-piece tool) to cut a joint exactly where the
//   cursor is.
//
//   Outlets use the *drawn* (grown) box plus a screen-space magnet so a
//   click on the visible grille wins over a nearby junction, a 45° ortho
//   ghost, or the far end of a parallel run.

import { dist, pointSegment, toLocal } from "./geom.js";
import { componentDef, isDualPort } from "./standards/components.js";
import {
  componentBox,
  connPoint,
  preferredPort,
  pxPerMeterOf,
  componentNodeIds,
} from "./layout.js";

export const SNAP_PX = 14;
export const SNAP_PULL_PX = 36;
export const JOINT_HIT_PX = 18;
export const EQUIP_HIT_PX = 22;

const PORT_WORD = { supply: "supply (SUP)", extract: "extract (ETA)", outdoor: "fresh air (ODA)", exhaust: "exhaust (EHA)" };

export function nodeZ(n, fallback = 0) {
  const z = Number(n?.z);
  return Number.isFinite(z) ? z : fallback;
}

export function componentWord(c) {
  const def = componentDef(c.kind);
  if (!def) return "component";
  if (c.kind === "ahu") return "AHU";
  if (c.kind === "hrv") return "HRV";
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

function insideBox(c, p, box) {
  const q = toLocal(c, p, box.rot);
  return Math.abs(q.x) <= box.w / 2 + 1e-6 && Math.abs(q.y) <= box.d / 2 + 1e-6;
}

function systemOk(c, system) {
  if (!system) return true;
  return c.system === system || c.system === "both";
}

export function componentTarget(project, c, system) {
  const px = pxPerMeterOf(project);
  const port = preferredPort(c, system);
  const node = nodeOf(project, port.nodeId) || nodeOf(project, c.nodeId);
  const dual = isDualPort(c.kind) && c.system === "both" && port.off;
  // a unit's outside connections only exist when it serves both sides
  const at = dual
    ? connPoint(c, port.off, px)
    : node
      ? { x: node.x, y: node.y }
      : { x: c.x, y: c.y };
  return { node, at, off: dual ? port.off : null };
}

// Equipment hit: the visible (grown) icon, or a screen-space magnet around
// the connection point. Ranked by distance to that point so a click on a
// grille is not stolen by a larger nearby box or a leftover junction.
export function hitComponentAt(project, p, opts = {}) {
  const zoom = opts.zoom || 1;
  const skipId = opts.skipNodeId || null;
  const system = opts.system || null;
  const magnet = (opts.magnetPx ?? EQUIP_HIT_PX) / zoom;
  const px = pxPerMeterOf(project);
  const hits = [];

  for (const c of project.components) {
    const n = nodeOf(project, c.nodeId);
    if (!n) continue;
    if (componentNodeIds(c).includes(skipId)) continue;
    const tgt = componentTarget(project, c, system);
    if (!tgt.node) continue;
    const drawn = componentBox(c, px, zoom);
    const onIcon = insideBox(c, p, drawn);
    const d = dist(p, tgt.at);
    if (!onIcon && d > magnet) continue;
    // Magnet hits must match the active system so a supply diffuser does not
    // steal an extract run. A click on the visible icon always wins.
    if (!onIcon && !systemOk(c, system)) continue;
    // fresh air and exhaust only join an outside terminal of their own kind,
    // or a unit that serves both sides (it has the ODA / EHA connection)
    if ((system === "outdoor" || system === "exhaust") && !systemOk(c, system)) continue;
    if ((system === "outdoor" || system === "exhaust") && componentDef(c.kind)?.role === "plant" && !(isDualPort(c.kind) && c.system === "both")) continue;
    hits.push({
      kind: "component",
      component: c,
      node: tgt.node,
      at: tgt.at,
      off: tgt.off,
      d,
      onIcon,
      what: componentWord(c) + (tgt.off ? ` ${PORT_WORD[system] || "edge"}` : ""),
      name: c.label || "",
    });
  }

  if (!hits.length) return null;
  hits.sort((a, b) => {
    if (a.onIcon !== b.onIcon) return a.onIcon ? -1 : 1;
    return a.d - b.d;
  });
  return hits[0];
}

// What a click at p would connect to. Pure — draws the same answer it acts on.
export function snapAt(project, p, opts = {}) {
  const zoom = opts.zoom || 1;
  const skipId = opts.skipNodeId || null;
  const system = opts.system || null;
  const alt = !!opts.alt;
  const snapPoints = opts.snapPoints !== false;

  const equip = hitComponentAt(project, p, opts);
  if (equip) return equip;

  const tol = SNAP_PX / zoom;
  let best = null;
  for (const n of project.nodes) {
    if (n.id === skipId) continue;
    const hasComp = project.components.some((c) => componentNodeIds(c).includes(n.id));
    if (hasComp) continue;
    if (opts.runDots && system) {
      const touching = project.segments.filter((s) => s.a === n.id || s.b === n.id);
      if (touching.length && !touching.some((s) => s.system === system)) continue;
    }
    const d = dist(n, p);
    if (d <= tol && (!best || d < best.d)) {
      best = {
        kind: "node",
        node: n,
        at: { x: n.x, y: n.y },
        off: null,
        d,
        what: n.tee ? "T-piece" : "junction",
        name: "",
      };
    }
  }
  if (best) return best;

  // Trace mode: a run of the system being traced shows a dot where the
  // cursor meets it, and a click there cuts a T-piece exactly on the pipe.
  // Without this a click on a duct dropped a loose node on top of it that
  // looked joined and was not — the branch then read "no flow".
  if (opts.runDots) {
    const dot = hitRunDot(project, p, opts);
    if (dot) return dot;
    return null;
  }

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

  // Nearby existing ends only — never the mid-run of a close parallel duct,
  // and never a yank across the room when the click was aimed at an outlet
  // (equipment already returned above).
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

// The branch dot: nearest point on a run of the traced system, within the
// drawn half-width of the duct plus a few screen pixels. An end within
// SNAP_PULL_PX of that point wins, so a click just short of a corner joins
// the corner instead of cutting a stub a few centimetres from it.
export function hitRunDot(project, p, opts = {}) {
  const zoom = opts.zoom || 1;
  const skipId = opts.skipNodeId || null;
  const system = opts.system || null;
  const halfOf = opts.runHalfWorld || (() => 0);
  let best = null;
  for (const s of project.segments) {
    if (system && s.system !== system) continue;
    const a = nodeOf(project, s.a);
    const b = nodeOf(project, s.b);
    if (!a || !b) continue;
    const r = pointSegment(p, a, b);
    const tol = halfOf(s) + 8 / zoom;
    if (r.distance > tol) continue;
    if (!best || r.distance < best.r.distance) best = { seg: s, r, a, b };
  }
  if (!best) return null;
  const endTol = Math.max(SNAP_PX / zoom, halfOf(best.seg) * 1.2);
  for (const end of [best.a, best.b]) {
    if (end.id === skipId) continue;
    if (dist(end, best.r.point) <= endTol) {
      const hasComp = project.components.some((c) => componentNodeIds(c).includes(end.id));
      if (hasComp) continue;
      return { kind: "node", node: end, at: { x: end.x, y: end.y }, off: null, d: dist(end, p), what: end.tee ? "T-piece" : "end of run", name: "" };
    }
  }
  if (best.a.id === skipId && dist(best.a, best.r.point) < 1 / zoom) return null;
  if (best.b.id === skipId && dist(best.b, best.r.point) < 1 / zoom) return null;
  return {
    kind: "run",
    seg: best.seg,
    r: best.r,
    at: { x: best.r.point.x, y: best.r.point.y },
    d: best.r.distance,
    z: heightAlong(best.a, best.b, best.r.t),
    what: "branch here",
    name: "",
  };
}
