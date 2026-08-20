// Read-only 3D review. A plan cannot show a riser; this is where heights
// are checked. Orbit with drag, scroll to zoom, same job as the plan.

import { isVerticalRiser } from "../geom.js";
import { componentDef } from "../standards/components.js";
import { componentFoot, pxPerMeterOf } from "../layout.js";
import { round } from "../units.js";
import { findSegResult } from "../calc/network.js";

export class View3D {
  constructor(canvas, store) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.store = store;
    this.results = null;
    this.az = -0.62;
    this.el = 0.62;
    this.scale = 40;
    this.panX = 0;
    this.panY = 0;
    this.ex = 1.6;
    this.drag = null;
    this.dpr = window.devicePixelRatio || 1;
    this._bind();
  }

  setResults(r) { this.results = r; }

  _bind() {
    const c = this.canvas;
    c.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      this.drag = { sx: e.clientX, sy: e.clientY, az: this.az, el: this.el, px: this.panX, py: this.panY, pan: e.shiftKey };
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener("pointermove", (e) => {
      if (!this.drag) return;
      if (this.drag.pan) {
        this.panX = this.drag.px + (e.clientX - this.drag.sx);
        this.panY = this.drag.py + (e.clientY - this.drag.sy);
      } else {
        this.az = this.drag.az + (e.clientX - this.drag.sx) * 0.008;
        this.el = Math.max(0.15, Math.min(1.35, this.drag.el + (e.clientY - this.drag.sy) * 0.006));
      }
      this.draw();
    });
    window.addEventListener("pointerup", () => { this.drag = null; });
    c.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.scale = Math.max(8, Math.min(160, this.scale * (e.deltaY < 0 ? 1.1 : 0.9)));
      this.draw();
    }, { passive: false });
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.floor(r.width * this.dpr));
    this.canvas.height = Math.max(1, Math.floor(r.height * this.dpr));
    this.draw();
  }

  world() {
    const p = this.store.project;
    const s = pxPerMeterOf(p);
    const xs = [], ys = [];
    for (const n of p.nodes) { xs.push(n.x); ys.push(n.y); }
    for (const c of p.components) { xs.push(c.x); ys.push(c.y); }
    if (!xs.length) return { s, cx: 0, cy: 0, spanM: 8 };
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const y0 = Math.min(...ys), y1 = Math.max(...ys);
    return { s, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, spanM: Math.max((x1 - x0) / s, (y1 - y0) / s, 4) };
  }

  toXYZ(W, p, z) {
    return { X: (p.x - W.cx) / W.s, Y: (p.y - W.cy) / W.s, Z: (z || 0) * this.ex };
  }

  project(pt) {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const ca = Math.cos(this.az), sa = Math.sin(this.az);
    const ce = Math.cos(this.el), se = Math.sin(this.el);
    const x = pt.X * ca - pt.Y * sa;
    const y = pt.X * sa + pt.Y * ca;
    const sx = x * this.scale + w / 2 + this.panX;
    const sy = (-pt.Z * ce + y * se) * this.scale + h * 0.62 + this.panY;
    const depth = y * ce + pt.Z * se;
    return { x: sx, y: sy, depth };
  }

  draw() {
    const ctx = this.ctx;
    const p = this.store.project;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);
    ctx.fillStyle = "#0d1526";
    ctx.fillRect(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);

    const W = this.world();
    const items = [];

    const half = W.spanM * 0.7 + 2;
    const step = W.spanM > 30 ? 5 : W.spanM > 12 ? 2 : 1;
    for (let g = -Math.ceil(half / step) * step; g <= half + 0.001; g += step) {
      const major = Math.abs(g) < 0.001;
      items.push({ t: "line", pts: [this.toXYZ(W, { x: W.cx + g * W.s, y: W.cy - half * W.s }, 0), this.toXYZ(W, { x: W.cx + g * W.s, y: W.cy + half * W.s }, 0)], c: major ? "#334155" : "#1e293b", w: major ? 1.2 : 0.7, ground: true });
      items.push({ t: "line", pts: [this.toXYZ(W, { x: W.cx - half * W.s, y: W.cy + g * W.s }, 0), this.toXYZ(W, { x: W.cx + half * W.s, y: W.cy + g * W.s }, 0)], c: major ? "#334155" : "#1e293b", w: major ? 1.2 : 0.7, ground: true });
    }

    for (const s of p.segments) {
      const a = p.nodes.find((n) => n.id === s.a);
      const b = p.nodes.find((n) => n.id === s.b);
      if (!a || !b) continue;
      const res = this.segRes(s.id);
      const col = s.system === "extract" ? "#d97706" : "#3b82f6";
      const za = a.z || 0, zb = b.z || 0;
      const poly = [this.toXYZ(W, a, za)];
      if (Math.abs(za - zb) > 0.02 && !isVerticalRiser(a, b, W.s)) {
        poly.push(this.toXYZ(W, b, za));
      }
      poly.push(this.toXYZ(W, b, zb));
      const mm = res?.section?.diameterMm || res?.section?.widthMm || 200;
      items.push({ t: "line", pts: poly, c: col, w: Math.max(3.5, Math.min(16, mm / 36)), riser: isVerticalRiser(a, b, W.s) });
    }

    for (const n of p.nodes) {
      const z = n.z || 0;
      const c = this.toXYZ(W, n, z);
      if (Math.abs(z) > 0.02) {
        items.push({ t: "line", pts: [this.toXYZ(W, n, 0), c], c: "#64748b", w: 1, dash: true });
      }
    }

    for (const comp of p.components) {
      const def = componentDef(comp.kind);
      if (!def) continue;
      const foot = componentFoot(comp);
      const z = Number.isFinite(Number(comp.heightM)) ? comp.heightM : 0;
      const center = this.toXYZ(W, comp, z);
      const grow = Math.max(1, (W.spanM / 26) * 0.7 / Math.max(foot.w, foot.d));
      const bw = foot.w * grow;
      const bd = foot.d * grow;
      const bh = Math.max(foot.t, 0.18) * grow;
      const fill = comp.kind === "ahu" ? "#1e3a8a" : def.color;
      cuboid(center, bw, bd, bh / this.ex, foot.rot).forEach((face) => {
        items.push({ t: "poly", pts: face, fill, stroke: "#e2e8f0", z: center.Z });
      });
      items.push({ t: "label", at: { X: center.X, Y: center.Y, Z: center.Z + bh / 2 / this.ex + 0.12 }, text: comp.label || def.label, sub: `${round(z, 2)} m` });
    }

    items.sort((a, b) => {
      const da = avgDepth(a, this);
      const db = avgDepth(b, this);
      return da - db;
    });

    for (const it of items) {
      if (it.t === "line") {
        const pts = it.pts.map((q) => this.project(q));
        ctx.beginPath();
        pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
        ctx.strokeStyle = it.c;
        ctx.lineWidth = it.w;
        ctx.setLineDash(it.dash ? [4, 4] : []);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (it.t === "poly") {
        const pts = it.pts.map((q) => this.project(q));
        ctx.beginPath();
        pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
        ctx.closePath();
        ctx.fillStyle = it.fill;
        ctx.globalAlpha = 0.92;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = it.stroke;
        ctx.lineWidth = 0.8;
        ctx.stroke();
      } else if (it.t === "label") {
        const q = this.project(it.at);
        ctx.fillStyle = "#e6edf7";
        ctx.font = "11px system-ui";
        ctx.textAlign = "center";
        ctx.fillText(it.text, q.x, q.y);
        ctx.fillStyle = "#93a4c3";
        ctx.font = "10px system-ui";
        ctx.fillText(it.sub, q.x, q.y + 12);
      }
    }

    this.drawStaff(ctx, W);
    ctx.restore();
  }

  drawStaff(ctx, W) {
    let zMax = 1;
    for (const n of this.store.project.nodes) zMax = Math.max(zMax, n.z || 0);
    for (const c of this.store.project.components) zMax = Math.max(zMax, c.heightM || 0);
    const top = Math.ceil(zMax + 0.5);
    const sx = -W.spanM * 0.55;
    const sy = -W.spanM * 0.55;
    const a = { X: sx, Y: sy, Z: 0 };
    const b = { X: sx, Y: sy, Z: top * this.ex };
    const pa = this.project(a), pb = this.project(b);
    ctx.strokeStyle = "#94a3b8";
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
    ctx.fillStyle = "#94a3b8";
    ctx.font = "10px system-ui";
    ctx.textAlign = "right";
    for (let m = 0; m <= top; m++) {
      const t = this.project({ X: sx, Y: sy, Z: m * this.ex });
      ctx.fillText(`${m} m`, t.x - 6, t.y + 3);
    }
    ctx.textAlign = "left";
    ctx.fillStyle = "#64748b";
    ctx.fillText("Heights above finished floor · vertical × " + this.ex, 16, this.canvas.clientHeight - 16);
    ctx.fillText("Drag to orbit · Shift-drag to pan · scroll to zoom", 16, this.canvas.clientHeight - 32);
  }

  segRes(id) {
    return findSegResult(this.results, id);
  }
}

function cuboid(c, w, d, h, rotDeg) {
  const r = ((rotDeg || 0) * Math.PI) / 180;
  const co = Math.cos(r), si = Math.sin(r);
  const at = (lx, ly, z) => ({ X: c.X + lx * co - ly * si, Y: c.Y + lx * si + ly * co, Z: z });
  const x0 = -w / 2, x1 = w / 2, y0 = -d / 2, y1 = d / 2;
  const z0 = c.Z - h / 2, z1 = c.Z + h / 2;
  const v = [
    at(x0, y0, z0), at(x1, y0, z0), at(x1, y1, z0), at(x0, y1, z0),
    at(x0, y0, z1), at(x1, y0, z1), at(x1, y1, z1), at(x0, y1, z1),
  ];
  const f = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
  return f.map((ix) => ix.map((k) => v[k]));
}

function avgDepth(it, view) {
  if (it.t === "label") return view.project(it.at).depth;
  const pts = (it.pts || []).map((q) => view.project(q));
  if (!pts.length) return 0;
  return pts.reduce((s, p) => s + p.depth, 0) / pts.length;
}
