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
