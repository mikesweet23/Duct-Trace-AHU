// 2D geometry helpers used by the canvas editor.

export function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function scale(a, k) {
  return { x: a.x * k, y: a.y * k };
}

export function mid(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function len(v) {
  return Math.hypot(v.x, v.y);
}

export function norm(v) {
  const l = len(v) || 1;
  return { x: v.x / l, y: v.y / l };
}

// Shortest distance from point p to segment ab, plus the closest point.
export function pointSegment(p, a, b) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const l2 = abx * abx + aby * aby;
  let t = l2 === 0 ? 0 : (apx * abx + apy * aby) / l2;
  t = Math.max(0, Math.min(1, t));
  const cp = { x: a.x + t * abx, y: a.y + t * aby };
  return { distance: Math.hypot(p.x - cp.x, p.y - cp.y), point: cp, t };
}

// Angle in degrees between vectors (v1 -> v2), 0..180.
export function angleBetween(v1, v2) {
  const d = (v1.x * v2.x + v1.y * v2.y) / ((len(v1) || 1) * (len(v2) || 1));
  return (Math.acos(Math.max(-1, Math.min(1, d))) * 180) / Math.PI;
}

export function pointInPolygon(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x;
    const yi = pts[i].y;
    const xj = pts[j].x;
    const yj = pts[j].y;
    const intersect =
      yi > p.y !== yj > p.y &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function polygonArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
  }
  return Math.abs(a / 2);
}

export function polygonCentroid(pts) {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  return { x: x / pts.length, y: y / pts.length };
}

export function lerp(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function rotate(p, deg) {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

export function toLocal(origin, p, rotDeg) {
  const q = { x: p.x - origin.x, y: p.y - origin.y };
  return rotate(q, -(rotDeg || 0));
}

export function fromLocal(origin, local, rotDeg) {
  const q = rotate(local, rotDeg || 0);
  return { x: origin.x + q.x, y: origin.y + q.y };
}

// Intersection of infinite lines a1–a2 and b1–b2. Null if parallel.
export function lineHit(a1, a2, b1, b2) {
  const x1 = a1.x, y1 = a1.y, x2 = a2.x, y2 = a2.y;
  const x3 = b1.x, y3 = b1.y, x4 = b2.x, y4 = b2.y;
  const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(den) < 1e-9) return null;
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
  return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) };
}

// True parallel offset of a polyline, mitred at corners. Same discipline as
// ac-trace: do not average headings or the band flares at a bend.
export function offsetPoly(pts, off) {
  if (Math.abs(off) < 1e-9 || !pts || pts.length < 2) {
    return (pts || []).map((p) => ({ x: p.x, y: p.y }));
  }
  const nrm = [];
  const lens = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const ux = pts[i + 1].x - pts[i].x;
    const uy = pts[i + 1].y - pts[i].y;
    const L = Math.hypot(ux, uy) || 1;
    lens.push(L);
    nrm.push({ x: (-uy / L) * off, y: (ux / L) * off });
  }
  const minLeg = Math.abs(off) * 2.4;
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    if (i === 0) {
      const n = lens[0] < minLeg && nrm[1] ? nrm[1] : nrm[0];
      out.push({ x: pts[0].x + n.x, y: pts[0].y + n.y });
      continue;
    }
    if (i === pts.length - 1) {
      const last = nrm.length - 1;
      const n = lens[last] < minLeg && last > 0 ? nrm[last - 1] : nrm[last];
      out.push({ x: pts[i].x + n.x, y: pts[i].y + n.y });
      continue;
    }
    if (lens[i - 1] < minLeg || lens[i] < minLeg) {
      const n = lens[i] >= lens[i - 1] ? nrm[i] : nrm[i - 1];
      out.push({ x: pts[i].x + n.x, y: pts[i].y + n.y });
      continue;
    }
    const a1 = { x: pts[i - 1].x + nrm[i - 1].x, y: pts[i - 1].y + nrm[i - 1].y };
    const a2 = { x: pts[i].x + nrm[i - 1].x, y: pts[i].y + nrm[i - 1].y };
    const b1 = { x: pts[i].x + nrm[i].x, y: pts[i].y + nrm[i].y };
    const b2 = { x: pts[i + 1].x + nrm[i].x, y: pts[i + 1].y + nrm[i].y };
    const hit = lineHit(a1, a2, b1, b2);
    const far = hit && Math.hypot(hit.x - pts[i].x, hit.y - pts[i].y) > Math.abs(off) * 8;
    out.push(hit && !far ? hit : { x: (a2.x + b1.x) / 2, y: (a2.y + b1.y) / 2 });
  }
  return out;
}

// Lock a free click to square / 45° off the previous point (ac-trace ortho).
export function orthoPoint(prev, p) {
  if (!prev) return { x: p.x, y: p.y };
  const dx = p.x - prev.x;
  const dy = p.y - prev.y;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax > ay * 2.4142) return { x: p.x, y: prev.y };
  if (ay > ax * 2.4142) return { x: prev.x, y: p.y };
  const m = (ax + ay) / 2;
  return { x: prev.x + (dx < 0 ? -m : m), y: prev.y + (dy < 0 ? -m : m) };
}

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// 3D length of a run: plan metres plus the vertical between the two ends.
export function routeLengthM(a, b, pxPerMeter) {
  const plan = dist(a, b) / (pxPerMeter || 1);
  const rise = Math.abs((a.z || 0) - (b.z || 0));
  return Math.hypot(plan, rise);
}

export function isVerticalRiser(a, b, pxPerMeter, minPlanM = 0.15) {
  const plan = dist(a, b) / (pxPerMeter || 1);
  const rise = Math.abs((a.z || 0) - (b.z || 0));
  return rise > 0.05 && plan < minPlanM;
}
