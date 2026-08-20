// Footprints, connection ports and resize handles for plant and terminals.
// Sizes are real metres on the scaled drawing — the same rule as ac-trace.

import { clamp, fromLocal, toLocal } from "./geom.js";
import { componentDef } from "./standards/components.js";

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
  const min = (c.kind === "ahu" ? 46 : 32) * k;
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

export function componentAtNode(project, nodeId) {
  if (!nodeId || !project?.components) return null;
  return project.components.find((c) => c.nodeId === nodeId || c.returnNodeId === nodeId) || null;
}

// Closest point on the rectangle perimeter. Inside clicks are pushed out
// to the nearest face so a duct never lands in the middle of the casing.
export function closestOnRectPerimeter(x, y, hw, hd) {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const inside = ax <= hw + 1e-9 && ay <= hd + 1e-9;
  if (inside) {
    const dx = hw - ax;
    const dy = hd - ay;
    if (dx <= dy) return { x: x < 0 ? -hw : hw, y: clamp(y, -hd, hd) };
    return { x: clamp(x, -hw, hw), y: y < 0 ? -hd : hd };
  }
  return { x: clamp(x, -hw, hw), y: clamp(y, -hd, hd) };
}

function rayRectEntry(fx, fy, tx, ty, hw, hd, extend = false) {
  const dx = tx - fx;
  const dy = ty - fy;
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return null;
  let tMin = 0;
  let tMax = extend ? Infinity : 1;
  if (Math.abs(dx) < 1e-9) {
    if (fx < -hw || fx > hw) return null;
  } else {
    let t1 = (-hw - fx) / dx;
    let t2 = (hw - fx) / dx;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }
  if (Math.abs(dy) < 1e-9) {
    if (fy < -hd || fy > hd) return null;
  } else {
    let t1 = (-hd - fy) / dy;
    let t2 = (hd - fy) / dy;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }
  if (tMin <= 1e-6 || tMin > tMax) return null;
  return { x: fx + dx * tMin, y: fy + dy * tMin };
}

function slideOnFace(hit, q, hw, hd) {
  const onRight = Math.abs(hit.x - hw) < 1e-3;
  const onLeft = Math.abs(hit.x + hw) < 1e-3;
  const onBottom = Math.abs(hit.y - hd) < 1e-3;
  const onTop = Math.abs(hit.y + hd) < 1e-3;
  if (onRight || onLeft) return { x: onRight ? hw : -hw, y: clamp(q.y, -hd, hd) };
  if (onTop || onBottom) return { x: clamp(q.x, -hw, hw), y: onBottom ? hd : -hd };
  return closestOnRectPerimeter(q.x, q.y, hw, hd);
}

function constrainSide(local, q, hw, hd, sign) {
  const onEnd = Math.abs(Math.abs(local.y) - hd) < 1e-3;
  if (onEnd && local.x * sign > hw * 0.15) {
    return { x: clamp(local.x, Math.min(0, sign * hw), Math.max(0, sign * hw)), y: local.y };
  }
  return { x: sign * hw, y: clamp(q.y, -hd, hd) };
}

// Landing on the outside of the casing. Optional `from` (the previous
// corner) prefers the face the run actually hits; `side` keeps a dual
// AHU supply on the right and extract on the left.
export function snapOnComponent(c, p, pxPerMeter, opts = {}) {
  const b = componentBoxTrue(c, pxPerMeter);
  const hw = Math.max(b.w / 2, 1e-6);
  const hd = Math.max(b.d / 2, 1e-6);
  const q = toLocal(c, p, b.rot);
  let local = closestOnRectPerimeter(q.x, q.y, hw, hd);
  if (opts.from) {
    const f = toLocal(c, opts.from, b.rot);
    const hit = rayRectEntry(f.x, f.y, q.x, q.y, hw, hd, true);
    if (hit) local = slideOnFace(hit, q, hw, hd);
    else if (Math.abs(f.x) > hw || Math.abs(f.y) > hd) {
      local = closestOnRectPerimeter(f.x, f.y, hw, hd);
      local = slideOnFace(local, q, hw, hd);
    }
  }
  if (opts.side === "supply") local = constrainSide(local, q, hw, hd, 1);
  if (opts.side === "extract") local = constrainSide(local, q, hw, hd, -1);
  const off = { u: +(local.x / hw).toFixed(4), v: +(local.y / hd).toFixed(4) };
  return { at: connPoint(c, off, pxPerMeter), off, box: b, local: q };
}

// Visual end of a duct: stored edge stub, else the face toward the other end.
export function segmentEndPoint(project, node, other, off, pxPerMeter) {
  if (!node) return null;
  const c = componentAtNode(project, node.id);
  if (!c) return { x: node.x, y: node.y };
  const px = pxPerMeter || pxPerMeterOf(project);
  if (off && (off.u != null || off.v != null)) return connPoint(c, off, px);
  if (other) return snapOnComponent(c, other, px).at;
  return { x: node.x, y: node.y };
}

export function approachHitsComponent(c, from, p, pxPerMeter) {
  if (!from || !p) return false;
  const b = componentBoxTrue(c, pxPerMeter);
  const hw = Math.max(b.w / 2, 1e-6);
  const hd = Math.max(b.d / 2, 1e-6);
  const f = toLocal(c, from, b.rot);
  const q = toLocal(c, p, b.rot);
  return !!rayRectEntry(f.x, f.y, q.x, q.y, hw, hd, true);
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

// Dual-system AHU: supply lands on the right, return/extract on the left.
export function portOffset(system) {
  if (system === "extract") return { u: -1, v: 0 };
  if (system === "supply") return { u: 1, v: 0 };
  return null;
}

export function preferredPort(c, system) {
  if (c.kind === "ahu" && c.system === "both") {
    if (system === "extract") return { nodeId: c.returnNodeId || c.nodeId, off: portOffset("extract") };
    return { nodeId: c.nodeId, off: portOffset("supply") };
  }
  return { nodeId: c.nodeId, off: null };
}
