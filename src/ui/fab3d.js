// 3D meshes for fabrication pieces. Canvas 2D, painter's algorithm.
// Recognisable assembly, not photorealism.

export function velColor(v, max = 8) {
  const t = Math.max(0, Math.min(1, (Number(v) || 0) / max));
  const r = Math.round(56 + t * 200);
  const g = Math.round(189 - t * 140);
  const b = Math.round(248 - t * 180);
  return `rgb(${r},${g},${b})`;
}

export function pressureColor(pa, max = 200) {
  const t = Math.max(0, Math.min(1, (Number(pa) || 0) / max));
  return `rgb(${Math.round(34 + t * 200)},${Math.round(197 - t * 120)},${Math.round(94 + t * 40)})`;
}

export function systemColor(system) {
  return system === "extract" ? "#d97706" : "#3b82f6";
}

export function pieceFill(piece, mode, selected) {
  if (selected) return "#38bdf8";
  if (mode === "velocity") return velColor(piece.velocity, 8);
  if (mode === "pressure") return pressureColor(piece.dpPa, 80);
  if (mode === "airflow") return systemColor(piece.system);
  if (piece.kind === "coupler") return "#cbd5e1";
  if (piece.kind === "elbow") return piece.system === "extract" ? "#f59e0b" : "#60a5fa";
  if (piece.kind === "reducer" || piece.kind === "enlarger" || piece.kind === "transition" || piece.kind === "sqr_to_round") {
    return "#a78bfa";
  }
  if (piece.kind === "tee" || piece.kind === "y_branch" || piece.kind === "lateral" || piece.kind === "saddle" || piece.kind === "shoe") {
    return "#34d399";
  }
  if (piece.kind === "boot") return "#22c55e";
  if (piece.kind === "flex") return "#94a3b8";
  if (piece.kind === "damper") return "#f43f5e";
  if (piece.kind === "end_cap") return "#64748b";
  return systemColor(piece.system);
}

function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: (a.z || 0) - (b.z || 0) }; }
function add(a, b) { return { x: a.x + b.x, y: a.y + b.y, z: (a.z || 0) + (b.z || 0) }; }
function scale(a, k) { return { x: a.x * k, y: a.y * k, z: (a.z || 0) * k }; }
function len(v) { return Math.hypot(v.x, v.y, v.z || 0); }
function norm(v) {
  const L = len(v) || 1;
  return { x: v.x / L, y: v.y / L, z: (v.z || 0) / L };
}
function cross(a, b) {
  return {
    x: a.y * (b.z || 0) - (a.z || 0) * b.y,
    y: (a.z || 0) * b.x - a.x * (b.z || 0),
    z: a.x * b.y - a.y * b.x,
  };
}
function lerp(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: (a.z || 0) + ((b.z || 0) - (a.z || 0)) * t };
}

function orthonormal(axis) {
  const a = norm(axis);
  const helper = Math.abs(a.z) < 0.8 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
  const u = norm(cross(a, helper));
  const v = norm(cross(a, u));
  return [u, v];
}

function explodePair(a, b, gap, index) {
  if (!gap) return [a, b];
  const d = norm(sub(b, a));
  const off = scale(d, gap * (index % 5) * 0.15 + gap * 0.35);
  return [add(a, off), add(b, off)];
}

export function meshPiece(piece, px, explodeGap = 0, index = 0) {
  if (!piece.a || piece.kind === "support") return { polys: [], lines: [], labels: [] };
  const toM = (p) => ({ x: p.x / (px || 1), y: p.y / (px || 1), z: p.z || 0 });
  const a = toM(piece.a);
  const b = piece.b ? toM(piece.b) : a;
  const [ea, eb] = explodePair(a, b, explodeGap, index);
  const section = piece.section || {};
  const circular = !(section.shape === "rect" || section.shape === "square");
  const dMm = circular ? (section.diameterMm || 200) : Math.max(section.widthMm || 200, section.heightMm || 200);
  const r = (dMm / 1000) / 2;
  const w = (section.widthMm || 300) / 1000;
  const h = (section.heightMm || 200) / 1000;

  if (piece.kind === "coupler") {
    return circular
      ? tube(ea, eb, r * 1.12, 8, { ring: true })
      : box(ea, eb, w * 1.08, h * 1.08);
  }
  if (piece.kind === "elbow") {
    return elbowMesh(ea, eb, circular ? r : Math.max(w, h) / 2, circular, piece.angleDeg || 90, w, h);
  }
  if (piece.kind === "reducer" || piece.kind === "enlarger" || piece.kind === "transition" || piece.kind === "sqr_to_round") {
    const r2 = piece.sectionTo
      ? ((piece.sectionTo.diameterMm || Math.max(piece.sectionTo.widthMm || 200, piece.sectionTo.heightMm || 200)) / 1000) / 2
      : r * 0.75;
    return frustum(ea, eb, r, r2, circular, w, h, piece.alignment);
  }
  if (piece.kind === "boot") {
    return bootMesh(ea, circular, r, w, h);
  }
  if (piece.kind === "tee" || piece.kind === "y_branch" || piece.kind === "lateral" || piece.kind === "saddle" || piece.kind === "shoe") {
    return teeMesh(ea, eb, r, circular, w, h, piece);
  }
  if (circular) {
    const mesh = tube(ea, eb, r, piece.construction === "spiral" ? 10 : 8, { spiral: piece.construction === "spiral" });
    return mesh;
  }
  return box(ea, eb, w, h);
}

function tube(a, b, r, sides, flags = {}) {
  const axis = sub(b, a);
  if (len(axis) < 1e-6) return { polys: [], lines: [], labels: [] };
  const [u, v] = orthonormal(axis);
  const ring = (pt, scaleR = 1) => {
    const pts = [];
    for (let i = 0; i < sides; i++) {
      const ang = (i / sides) * Math.PI * 2;
      pts.push(add(pt, add(scale(u, Math.cos(ang) * r * scaleR), scale(v, Math.sin(ang) * r * scaleR))));
    }
    return pts;
  };
  const A = ring(a, flags.ring ? 1 : 1);
  const B = ring(b, flags.ring ? 1 : 1);
  const polys = [];
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    polys.push([A[i], A[j], B[j], B[i]]);
  }
  const lines = [];
  if (flags.spiral) {
    const turns = Math.max(2, Math.round(len(axis) / (r * 4)));
    const n = 24;
    const helix = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const ang = t * turns * Math.PI * 2;
      helix.push(add(lerp(a, b, t), add(scale(u, Math.cos(ang) * r), scale(v, Math.sin(ang) * r))));
    }
    lines.push(helix);
  }
  if (flags.ring) {
    lines.push([...A, A[0]]);
    lines.push([...B, B[0]]);
  }
  return { polys, lines, labels: [] };
}

function box(a, b, w, h) {
  const axis = sub(b, a);
  if (len(axis) < 1e-6) return { polys: [], lines: [], labels: [] };
  const [u, v] = orthonormal(axis);
  // u ~ plan-horizontal width, v ~ height (prefer world Z).
  const up = Math.abs(v.z) >= Math.abs(u.z) ? v : u;
  const side = Math.abs(v.z) >= Math.abs(u.z) ? u : v;
  const hw = w / 2, hh = h / 2;
  const corner = (pt, sw, sh) => add(pt, add(scale(side, sw * hw), scale(up, sh * hh)));
  const A = [corner(a, -1, -1), corner(a, 1, -1), corner(a, 1, 1), corner(a, -1, 1)];
  const B = [corner(b, -1, -1), corner(b, 1, -1), corner(b, 1, 1), corner(b, -1, 1)];
  const polys = [
    A, B,
    [A[0], A[1], B[1], B[0]],
    [A[1], A[2], B[2], B[1]],
    [A[2], A[3], B[3], B[2]],
    [A[3], A[0], B[0], B[3]],
  ];
  return { polys, lines: [], labels: [] };
}

function frustum(a, b, r1, r2, circular, w, h, alignment) {
  if (!circular) {
    const axis = sub(b, a);
    if (len(axis) < 1e-6) return { polys: [], lines: [], labels: [] };
    const [u, v] = orthonormal(axis);
    const up = Math.abs(v.z) >= Math.abs(u.z) ? v : u;
    const side = Math.abs(v.z) >= Math.abs(u.z) ? u : v;
    const w2 = w * (r2 / (r1 || r2 || 1));
    const h2 = h * (r2 / (r1 || r2 || 1));
    let ox = 0, oy = 0;
    if (alignment === "flat_top") oy = (h - h2) / 2;
    if (alignment === "flat_bottom") oy = -(h - h2) / 2;
    if (alignment === "flat_left") ox = -(w - w2) / 2;
    if (alignment === "flat_right") ox = (w - w2) / 2;
    if (alignment === "offset") { ox = (w - w2) / 4; oy = (h - h2) / 4; }
    const ca = (pt, sw, sh, ww, hh, oxx = 0, oyy = 0) =>
      add(pt, add(scale(side, sw * ww / 2 + oxx), scale(up, sh * hh / 2 + oyy)));
    const A = [ca(a, -1, -1, w, h), ca(a, 1, -1, w, h), ca(a, 1, 1, w, h), ca(a, -1, 1, w, h)];
    const B = [ca(b, -1, -1, w2, h2, ox, oy), ca(b, 1, -1, w2, h2, ox, oy), ca(b, 1, 1, w2, h2, ox, oy), ca(b, -1, 1, w2, h2, ox, oy)];
    return { polys: [A, B, [A[0], A[1], B[1], B[0]], [A[1], A[2], B[2], B[1]], [A[2], A[3], B[3], B[2]], [A[3], A[0], B[0], B[3]]], lines: [], labels: [] };
  }
  const sides = 8;
  const axis = sub(b, a);
  if (len(axis) < 1e-6) return { polys: [], lines: [], labels: [] };
  const [u, v] = orthonormal(axis);
  const ring = (pt, rad) => {
    const pts = [];
    for (let i = 0; i < sides; i++) {
      const ang = (i / sides) * Math.PI * 2;
      pts.push(add(pt, add(scale(u, Math.cos(ang) * rad), scale(v, Math.sin(ang) * rad))));
    }
    return pts;
  };
  const A = ring(a, r1), B = ring(b, r2);
  const polys = [];
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    polys.push([A[i], A[j], B[j], B[i]]);
  }
  return { polys, lines: [], labels: [] };
}

function elbowMesh(a, b, r, circular, angle, w, h) {
  const mid = lerp(a, b, 0.5);
  const lift = { x: mid.x, y: mid.y, z: mid.z + r * 0.8 };
  const segs = 4;
  const polys = [];
  const lines = [];
  let prev = a;
  for (let i = 1; i <= segs; i++) {
    const t = i / segs;
    const p = add(lerp(a, b, t), scale(sub(lift, mid), Math.sin(t * Math.PI) * 0.6));
    const mesh = circular ? tube(prev, p, r, 7) : box(prev, p, w, h);
    polys.push(...mesh.polys);
    prev = p;
  }
  return { polys, lines, labels: [] };
}

function bootMesh(a, circular, r, w, h) {
  const top = { x: a.x, y: a.y, z: (a.z || 0) + Math.max(r, h) * 1.2 };
  if (circular) return tube(a, top, r * 1.15, 8);
  return box(a, top, w * 1.2, h * 1.1);
}

function teeMesh(a, b, r, circular, w, h, piece) {
  const main = circular ? tube(a, b, r, 8) : box(a, b, w, h);
  const mid = lerp(a, b, 0.5);
  const br = piece.branchSection;
  const brR = br
    ? ((br.diameterMm || Math.max(br.widthMm || 160, br.heightMm || 160)) / 1000) / 2
    : r * 0.7;
  const side = { x: mid.x + Math.max(r * 2.4, 0.25), y: mid.y, z: mid.z };
  const bw = (br?.widthMm || 200) / 1000;
  const bh = (br?.heightMm || 160) / 1000;
  const branch = circular ? tube(mid, side, brR, 7) : box(mid, side, bw, bh);
  return { polys: [...main.polys, ...branch.polys], lines: [...main.lines, ...branch.lines], labels: [] };
}

export function airflowArrow(a, b) {
  const d = sub(b, a);
  const L = len(d);
  if (L < 4) return null;
  const n = norm(d);
  const tip = lerp(a, b, 0.62);
  const tail = add(tip, scale(n, -Math.min(28, L * 0.25)));
  return { tail, tip };
}

export function centroid(pts) {
  if (!pts.length) return { x: 0, y: 0, z: 0 };
  let x = 0, y = 0, z = 0;
  for (const p of pts) { x += p.x; y += p.y; z += p.z || 0; }
  return { x: x / pts.length, y: y / pts.length, z: z / pts.length };
}
