// 3D review: engineering centreline, simple extrusion, and the
// Stage 2 fabrication model. Orbit with drag, scroll to zoom.

import { isVerticalRiser } from "../geom.js";
import { componentDef } from "../standards/components.js";
import { componentFoot, pxPerMeterOf } from "../layout.js";
import { formatFlow, round } from "../units.js";
import { findSegResult } from "../calc/network.js";
import { meshPiece, pieceFill, airflowArrow, systemColor } from "./fab3d.js";
import { sizeLabel } from "../fab/catalog.js";

export const VISUAL_MODES = [
  { key: "centreline", label: "Centreline" },
  { key: "simple3d", label: "Simple 3D" },
  { key: "fabrication", label: "Fabrication" },
  { key: "transparent", label: "Transparent" },
  { key: "airflow", label: "Airflow" },
  { key: "velocity", label: "Velocity" },
  { key: "pressure", label: "Pressure" },
  { key: "installation", label: "Installation" },
];

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
    this.hitList = [];
    this._bind();
  }

  setResults(r) { this.results = r; }

  mode() {
    return this.store.visualMode || "centreline";
  }

  _bind() {
    const c = this.canvas;
    c.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      this.drag = { sx: e.clientX, sy: e.clientY, az: this.az, el: this.el, px: this.panX, py: this.panY, pan: e.shiftKey, moved: false };
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener("pointermove", (e) => {
      if (!this.drag) return;
      if (Math.hypot(e.clientX - this.drag.sx, e.clientY - this.drag.sy) > 4) this.drag.moved = true;
      if (this.drag.pan) {
        this.panX = this.drag.px + (e.clientX - this.drag.sx);
        this.panY = this.drag.py + (e.clientY - this.drag.sy);
      } else {
        this.az = this.drag.az + (e.clientX - this.drag.sx) * 0.008;
        this.el = Math.max(0.15, Math.min(1.35, this.drag.el + (e.clientY - this.drag.sy) * 0.006));
      }
      this.draw();
    });
    window.addEventListener("pointerup", (e) => {
      if (this.drag && !this.drag.moved && !this.drag.pan) this.hitSelect(e);
      this.drag = null;
    });
    c.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.scale = Math.max(8, Math.min(160, this.scale * (e.deltaY < 0 ? 1.1 : 0.9)));
      this.draw();
    }, { passive: false });
  }

  hitSelect(e) {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    let best = null;
    let bestD = 18;
    for (const h of this.hitList) {
      const d = Math.hypot(h.x - x, h.y - y);
      if (d < bestD) { best = h; bestD = d; }
    }
    if (best) {
      this.store.select(best.type, best.id);
    }
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
    if (!xs.length) return { s, cx: 0, cy: 0, spanM: 8, cxM: 0, cyM: 0 };
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const y0 = Math.min(...ys), y1 = Math.max(...ys);
    return {
      s, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2,
      cxM: ((x0 + x1) / 2) / s, cyM: ((y0 + y1) / 2) / s,
      spanM: Math.max((x1 - x0) / s, (y1 - y0) / s, 4),
    };
  }

  toXYZ(W, p, z) {
    return { X: (p.x - W.cx) / W.s, Y: (p.y - W.cy) / W.s, Z: (z || 0) * this.ex };
  }

  toXYZM(W, p) {
    return { X: p.x - W.cxM, Y: p.y - W.cyM, Z: (p.z || 0) * this.ex };
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

  hidden(system) {
    return this.store.hiddenSystems?.has(system);
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
    this.hitList = [];

    const half = W.spanM * 0.7 + 2;
    const step = W.spanM > 30 ? 5 : W.spanM > 12 ? 2 : 1;
    for (let g = -Math.ceil(half / step) * step; g <= half + 0.001; g += step) {
      const major = Math.abs(g) < 0.001;
      items.push({ t: "line", pts: [this.toXYZ(W, { x: W.cx + g * W.s, y: W.cy - half * W.s }, 0), this.toXYZ(W, { x: W.cx + g * W.s, y: W.cy + half * W.s }, 0)], c: major ? "#334155" : "#1e293b", w: major ? 1.2 : 0.7, ground: true });
      items.push({ t: "line", pts: [this.toXYZ(W, { x: W.cx - half * W.s, y: W.cy + g * W.s }, 0), this.toXYZ(W, { x: W.cx + half * W.s, y: W.cy + g * W.s }, 0)], c: major ? "#334155" : "#1e293b", w: major ? 1.2 : 0.7, ground: true });
    }

    const mode = this.mode();
    const useFab = (mode === "fabrication" || mode === "transparent" || mode === "installation" || mode === "airflow" || mode === "velocity" || mode === "pressure")
      && p.physical?.generated;

    if (useFab) this.drawFabrication(items, W, mode);
    else this.drawEngineering(items, W, mode);

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
      if (this.hidden(comp.system) && comp.system !== "both") continue;
      const foot = componentFoot(comp);
      const z = Number.isFinite(Number(comp.heightM)) ? comp.heightM : 0;
      const center = this.toXYZ(W, comp, z);
      const grow = Math.max(1, (W.spanM / 26) * 0.7 / Math.max(foot.w, foot.d));
      const bw = foot.w * grow;
      const bd = foot.d * grow;
      const bh = Math.max(foot.t, 0.18) * grow;
      const fill = comp.kind === "ahu" ? "#1e3a8a" : def.color;
      cuboid(center, bw, bd, bh / this.ex, foot.rot).forEach((face) => {
        items.push({ t: "poly", pts: face, fill, stroke: "#e2e8f0", z: center.Z, alpha: mode === "transparent" ? 0.35 : 0.92 });
      });
      items.push({ t: "label", at: { X: center.X, Y: center.Y, Z: center.Z + bh / 2 / this.ex + 0.12 }, text: comp.label || def.label, sub: `${round(z, 2)} m` });
    }

    items.sort((a, b) => avgDepth(a, this) - avgDepth(b, this));

    const alpha = mode === "transparent" ? 0.38 : 1;
    for (const it of items) {
      if (it.t === "line") {
        const pts = it.pts.map((q) => this.project(q));
        ctx.beginPath();
        pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
        ctx.strokeStyle = it.c;
        ctx.lineWidth = it.w;
        ctx.globalAlpha = it.ground ? 1 : alpha;
        ctx.setLineDash(it.dash ? [4, 4] : []);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      } else if (it.t === "poly") {
        const pts = it.pts.map((q) => this.project(q));
        ctx.beginPath();
        pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
        ctx.closePath();
        ctx.fillStyle = it.fill;
        ctx.globalAlpha = it.alpha ?? (mode === "transparent" ? 0.32 : 0.92);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = it.stroke || "rgba(226,232,240,0.35)";
        ctx.lineWidth = it.selected ? 1.6 : 0.7;
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

    this.drawStaff(ctx, W, mode);
    ctx.restore();
  }

  drawEngineering(items, W, mode) {
    const p = this.store.project;
    const sel = this.store.selection;
    for (const s of p.segments) {
      if (this.hidden(s.system)) continue;
      const a = p.nodes.find((n) => n.id === s.a);
      const b = p.nodes.find((n) => n.id === s.b);
      if (!a || !b) continue;
      const res = this.segRes(s.id);
      const selected = sel?.type === "segment" && sel.id === s.id;
      const col = selected ? "#38bdf8" : mode === "velocity" ? pieceFill({ velocity: res?.velocity }, "velocity")
        : mode === "pressure" ? pieceFill({ dpPa: res?.dpPa }, "pressure")
        : systemColor(s.system);
      const za = a.z || 0, zb = b.z || 0;
      const poly = [this.toXYZ(W, a, za)];
      if (Math.abs(za - zb) > 0.02 && !isVerticalRiser(a, b, W.s)) poly.push(this.toXYZ(W, b, za));
      poly.push(this.toXYZ(W, b, zb));
      const mm = res?.section?.diameterMm || res?.section?.widthMm || 200;
      const simple = mode === "simple3d";
      items.push({ t: "line", pts: poly, c: col, w: simple ? Math.max(5, Math.min(22, mm / 24)) : Math.max(3.5, Math.min(16, mm / 36)), riser: isVerticalRiser(a, b, W.s) });
      const mid = this.toXYZ(W, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, (za + zb) / 2);
      const scr = this.project(mid);
      this.hitList.push({ type: "segment", id: s.id, x: scr.x, y: scr.y });
      if (mode === "airflow" && res?.flowM3s) {
        items.push({ t: "label", at: mid, text: formatFlow(res.flowM3s, p.settings.flowUnit), sub: `${round(res.velocity, 1)} m/s` });
      }
    }
  }

  drawFabrication(items, W, mode) {
    const p = this.store.project;
    const sel = this.store.selection;
    const explode = this.store.exploded ? 0.18 : 0;
    const pieces = p.physical.pieces || [];
    let i = 0;
    for (const piece of pieces) {
      if (piece.kind === "support") continue;
      if (this.hidden(piece.system)) continue;
      if (mode === "installation" && piece.kind === "coupler") {
        // keep joints visible
      }
      const selected = (sel?.type === "piece" && (sel.id === piece.ref || sel.id === piece.sourceKey))
        || (sel?.type === "segment" && sel.id === piece.segmentId);
      const fill = pieceFill(piece, mode === "installation" ? "fabrication" : mode, selected);
      const mesh = meshPiece(piece, W.s, explode, i++);
      for (const face of mesh.polys) {
        items.push({
          t: "poly",
          pts: face.map((q) => this.toXYZM(W, q)),
          fill,
          stroke: selected ? "#e0f2fe" : "rgba(226,232,240,0.28)",
          selected,
          alpha: mode === "transparent" ? 0.28 : piece.kind === "coupler" ? 0.95 : 0.88,
        });
      }
      for (const line of mesh.lines) {
        items.push({ t: "line", pts: line.map((q) => this.toXYZM(W, q)), c: selected ? "#fff" : "rgba(226,232,240,0.55)", w: piece.construction === "spiral" ? 1.1 : 0.8 });
      }
      if (piece.a && piece.b) {
        const mid = {
          x: ((piece.a.x + piece.b.x) / 2) / W.s,
          y: ((piece.a.y + piece.b.y) / 2) / W.s,
          z: ((piece.a.z || 0) + (piece.b.z || 0)) / 2,
        };
        const at = this.toXYZM(W, mid);
        const scr = this.project(at);
        this.hitList.push({ type: "piece", id: piece.ref, x: scr.x, y: scr.y });
        if (mode === "airflow" && piece.kind === "straight" && piece.a && piece.b) {
          const arrow = airflowArrow(
            { x: piece.a.x / W.s, y: piece.a.y / W.s, z: piece.a.z || 0 },
            { x: piece.b.x / W.s, y: piece.b.y / W.s, z: piece.b.z || 0 },
          );
          if (arrow) {
            items.push({ t: "line", pts: [this.toXYZM(W, arrow.tail), this.toXYZM(W, arrow.tip)], c: "#f8fafc", w: 2.2 });
            items.push({ t: "label", at, text: piece.flowM3s ? formatFlow(piece.flowM3s, p.settings.flowUnit) : piece.ref, sub: piece.velocity ? `${round(piece.velocity, 1)} m/s` : "" });
          }
        }
        if ((mode === "fabrication" || mode === "installation") && selected) {
          items.push({
            t: "label",
            at,
            text: `${piece.ref}  ${piece.label}`,
            sub: `${sizeLabel(piece.section)}${piece.lengthM ? ` · ${round(piece.lengthM, 2)} m` : ""} · ${round(piece.a.z || 0, 2)} m AFFL`,
          });
        }
      }
    }
  }

  drawStaff(ctx, W, mode) {
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
    const exploded = this.store.exploded ? " · exploded" : "";
    ctx.fillText(`Heights above finished floor · ${VISUAL_MODES.find((m) => m.key === mode)?.label || mode}${exploded}`, 16, this.canvas.clientHeight - 16);
    ctx.fillText("Drag to orbit · Shift-drag to pan · scroll to zoom · click a piece to select", 16, this.canvas.clientHeight - 32);
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
