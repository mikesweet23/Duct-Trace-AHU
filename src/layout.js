// Footprints, connection ports and resize handles for plant and terminals.
// Sizes are real metres on the scaled drawing — the same rule as ac-trace.

import { clamp, fromLocal, toLocal } from "./geom.js";
import { componentDef, isDualPort } from "./standards/components.js";

export const MIN_FOOT_M = 0.08;
export const HANDLE_PX = 5;

export function defaultFootprint(kind) {
  const def = componentDef(kind);
  if (!def) return { w: 0.4, d: 0.4, t: 0.3 };
  return { w: def.foot.w, d: def.foot.d, t: def.foot.t };
}

export function defaultHeightM(kind, settings = {}) {
  const def = componentDef(kind);
  if (!def) return settings.defaultDuctHeight ?? 3.2;
  if (def.role === "plant") return settings.defaultAhuHeight ?? 0.3;
  if (def.role === "terminal") return settings.defaultTerminalHeight ?? 2.7;
  return settings.defaultDuctHeight ?? 3.2;
}

export function componentFoot(c) {
  const def = defaultFootprint(c.kind);
  const w = Number(c.widthM);
  const d = Number(c.depthM);
  return {
    w: w > 0 ? w : def.w,
    d: d > 0 ? d : def.d,
    t: def.t,
    sized: w > 0 || d > 0,
    rot: Number(c.rot) || 0,
  };
}

export function pxPerMeterOf(project) {
  return (project.scale && project.scale.pxPerMeter) || project.settings?.conceptPxPerMeter || 50;
}

// True footprint in world pixels. Used for snapping and lengths — never the
// zoomed-out legibility box, or a connection would slide as you zoom.
export function componentBoxTrue(c, pxPerMeter) {
  const f = componentFoot(c);
  const s = pxPerMeter || 50;
  return { w: f.w * s, d: f.d * s, rot: f.rot, foot: f };
}

// Drawn box: real size once zoomed in, grown (aspect kept) when zoomed out.
export function componentBox(c, pxPerMeter, zoom) {
  const trueBox = componentBoxTrue(c, pxPerMeter);
  const k = 1 / (zoom || 1);
  const min = (componentDef(c.kind)?.role === "plant" ? 46 : 32) * k;
  const f = Math.max(1, min / Math.max(trueBox.w, trueBox.d, 1e-6));
  return { w: trueBox.w * f, d: trueBox.d * f, rot: trueBox.rot, foot: trueBox.foot, grown: f > 1.01 };
}

export function connPoint(c, off, pxPerMeter) {
  if (!c) return null;
  if (!off) return { x: c.x, y: c.y };
  const b = componentBoxTrue(c, pxPerMeter);
  return fromLocal(c, {
    x: clamp(off.u, -1, 1) * b.w / 2,
    y: clamp(off.v, -1, 1) * b.d / 2,
  }, b.rot);
}

// Where a click on the casing would land. Centre is a magnet so "just
// connect it" is still one click; otherwise the landing is the nearest
// point on the box (an edge stub).
export function snapOnComponent(c, p, pxPerMeter) {
  const b = componentBoxTrue(c, pxPerMeter);
  const q = toLocal(c, p, b.rot);
  let u = clamp(q.x / Math.max(b.w / 2, 1e-6), -1, 1);
  let v = clamp(q.y / Math.max(b.d / 2, 1e-6), -1, 1);
  if (Math.abs(u) < 0.18 && Math.abs(v) < 0.18) {
    u = 0;
    v = 0;
  }
  const off = u === 0 && v === 0 ? null : { u: +u.toFixed(4), v: +v.toFixed(4) };
  return { at: connPoint(c, off, pxPerMeter), off, box: b, local: q };
}

// Signed distance to the box: negative inside, so a click on the casing
// beats a nearby free node.
export function distToComponentBox(c, p, pxPerMeter) {
  const b = componentBoxTrue(c, pxPerMeter);
  const q = toLocal(c, p, b.rot);
  return Math.max(Math.abs(q.x) - b.w / 2, Math.abs(q.y) - b.d / 2);
}

export function handlesOf(c, pxPerMeter, zoom) {
  const b = componentBox(c, pxPerMeter, zoom);
  const corners = [
    { u: -1, v: -1 },
    { u: 1, v: -1 },
    { u: 1, v: 1 },
    { u: -1, v: 1 },
  ].map((h) => {
    const at = fromLocal(c, { x: h.u * b.w / 2, y: h.v * b.d / 2 }, b.rot);
    return { kind: "resize", u: h.u, v: h.v, x: at.x, y: at.y };
  });
  const top = fromLocal(c, { x: 0, y: -b.d / 2 }, b.rot);
  const rotAt = fromLocal(c, { x: 0, y: -b.d / 2 - 22 / (zoom || 1) }, b.rot);
  corners.push({ kind: "rot", x: rotAt.x, y: rotAt.y, arm: top });
  return { handles: corners, box: b };
}

export function hitHandle(c, p, pxPerMeter, zoom) {
  const { handles } = handlesOf(c, pxPerMeter, zoom);
  const tol = (HANDLE_PX + 3) / (zoom || 1);
  let best = null;
  for (const h of handles) {
    const d = Math.hypot(h.x - p.x, h.y - p.y);
    if (d <= tol && (!best || d < best.d)) best = { handle: h, d };
  }
  return best;
}

// A two-port unit (AHU, HRV) serving supply and extract has four
// connections, two on each face: the INTERNAL face (IN) carries supply and
// extract to and from the building, the EXTERNAL face (EX) fresh air in and
// exhaust out. Each airstream runs straight through the box. `portLayout`
// says which way round, in the unit's own frame (u across its width, v
// across its depth):
//
//   "inline"  — internal on the right, external on the left
//         EX ODA (-1,-0.5) ──► IN SUP (1,-0.5)
//         EX EHA (-1, 0.5) ◄── IN ETA (1, 0.5)
//   "flipped" — the same, mirrored: internal on the left
//
// Turning the unit with its handle turns the faces with it. There is no
// layout with a connection on every face: a unit saved with the old
// supply-right / extract-left / fresh-air-top layout ("sides") opens as
// "inline", and its ducts follow the connections round.
export const PORT_LAYOUTS = {
  inline: { supply: { u: 1, v: -0.5 }, extract: { u: 1, v: 0.5 }, outdoor: { u: -1, v: -0.5 }, exhaust: { u: -1, v: 0.5 } },
  flipped: { supply: { u: -1, v: -0.5 }, extract: { u: -1, v: 0.5 }, outdoor: { u: 1, v: -0.5 }, exhaust: { u: 1, v: 0.5 } },
};

export function portOffset(system, layout = "inline") {
  const L = PORT_LAYOUTS[layout] || PORT_LAYOUTS.inline;
  return L[system] ? { ...L[system] } : null;
}

// The node a unit presents to one airstream.
export const PORT_NODE_KEY = { supply: "nodeId", extract: "returnNodeId", outdoor: "outdoorNodeId", exhaust: "exhaustNodeId" };

export function isFourPort(c) {
  return isDualPort(c.kind) && c.system === "both";
}

export function preferredPort(c, system) {
  if (isFourPort(c)) {
    const key = PORT_NODE_KEY[system] || "nodeId";
    return { nodeId: c[key] || c.nodeId, off: portOffset(system in PORT_NODE_KEY ? system : "supply", c.portLayout) };
  }
  return { nodeId: c.nodeId, off: null };
}

// Every node id a component owns.
export function componentNodeIds(c) {
  return [c.nodeId, c.returnNodeId, c.outdoorNodeId, c.exhaustNodeId].filter(Boolean);
}
