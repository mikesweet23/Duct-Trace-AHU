// Canvas editor: rendering + pointer interaction for all drawing tools.

import { dist, pointSegment, pointInPolygon, polygonCentroid } from "../geom.js";
import { componentDef } from "../standards/components.js";
import { showPrompt } from "./modal.js";
import { round } from "../units.js";

const GRID = 40;

export class CanvasView {
  constructor(canvas, store, onHint) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.store = store;
    this.onHint = onHint || (() => {});
    this.results = null;
    this.dpr = window.devicePixelRatio || 1;

    this._bg = null;
    this._bgUrl = null;

    // interaction state
    this.pointer = null; // world coords of cursor
    this.dragging = null; // { kind, id, dx, dy } | { pan }
    this.ductLastNodeId = null;
    this.roomPts = [];
    this.scalePts = [];

    this._bind();
    this.resize();
  }

  setResults(results) {
    this.results = results;
    this.draw();
  }

  // ---- transforms ----
  get view() { return this.store.project.view; }

  toScreen(p) {
    const v = this.view;
    return { x: p.x * v.zoom + v.offsetX, y: p.y * v.zoom + v.offsetY };
  }
  toWorld(sx, sy) {
    const v = this.view;
    return { x: (sx - v.offsetX) / v.zoom, y: (sy - v.offsetY) / v.zoom };
  }
  eventWorld(e) {
    const r = this.canvas.getBoundingClientRect();
    return this.toWorld(e.clientX - r.left, e.clientY - r.top);
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.floor(r.width * this.dpr));
    this.canvas.height = Math.max(1, Math.floor(r.height * this.dpr));
    this.draw();
  }

  setZoom(zoom, center) {
    const v = this.view;
    const c = center || { x: this.canvas.clientWidth / 2, y: this.canvas.clientHeight / 2 };
    const before = this.toWorld(c.x, c.y);
    v.zoom = Math.max(0.1, Math.min(6, zoom));
    const after = this.toWorld(c.x, c.y);
    v.offsetX += (after.x - before.x) * v.zoom;
    v.offsetY += (after.y - before.y) * v.zoom;
    this.store.emit();
  }

  fit() {
    const p = this.store.project;
    const pts = [];
    for (const n of p.nodes) pts.push(n);
    for (const r of p.rooms) pts.push(...r.points);
    if (p.background) pts.push({ x: p.background.x, y: p.background.y }, { x: p.background.x + p.background.width, y: p.background.y + p.background.height });
    const v = this.view;
    if (!pts.length) {
      v.zoom = 1; v.offsetX = 60; v.offsetY = 60; this.store.emit(); return;
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const pt of pts) { minX = Math.min(minX, pt.x); minY = Math.min(minY, pt.y); maxX = Math.max(maxX, pt.x); maxY = Math.max(maxY, pt.y); }
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const pad = 60;
    const zoom = Math.max(0.1, Math.min(3, Math.min((w - pad * 2) / (maxX - minX || 1), (h - pad * 2) / (maxY - minY || 1))));
    v.zoom = zoom;
    v.offsetX = pad - minX * zoom;
    v.offsetY = pad - minY * zoom;
    this.store.emit();
  }

  loadBackground() {
    const bg = this.store.project.background;
    if (!bg) { this._bg = null; this._bgUrl = null; return; }
    if (this._bgUrl === bg.dataUrl && this._bg) return;
    const img = new Image();
    img.onload = () => { this._bg = img; this.draw(); };
    img.src = bg.dataUrl;
    this._bgUrl = bg.dataUrl;
  }

  // ---- hit testing ----
  hit(world) {
    const p = this.store.project;
    const tol = 10 / this.view.zoom;
    for (const c of p.components) {
      const n = p.nodes.find((x) => x.id === c.nodeId) || c;
      if (dist(n, world) <= 16 / this.view.zoom) return { type: "component", id: c.id };
    }
    for (const n of p.nodes) {
      if (dist(n, world) <= 8 / this.view.zoom) return { type: "node", id: n.id };
    }
    for (const s of p.segments) {
      const a = p.nodes.find((x) => x.id === s.a);
      const b = p.nodes.find((x) => x.id === s.b);
      if (a && b && pointSegment(world, a, b).distance <= tol) return { type: "segment", id: s.id };
    }
    for (let i = p.rooms.length - 1; i >= 0; i--) {
      if (pointInPolygon(world, p.rooms[i].points)) return { type: "room", id: p.rooms[i].id };
    }
    return null;
  }

  // ---- events ----
  _bind() {
    const c = this.canvas;
    c.addEventListener("pointerdown", (e) => this.onDown(e));
    c.addEventListener("pointermove", (e) => this.onMove(e));
    window.addEventListener("pointerup", (e) => this.onUp(e));
    c.addEventListener("dblclick", (e) => this.onDblClick(e));
    c.addEventListener("contextmenu", (e) => { e.preventDefault(); this.endDraft(); });
    c.addEventListener("wheel", (e) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      const center = { x: e.clientX - r.left, y: e.clientY - r.top };
      this.setZoom(this.view.zoom * (e.deltaY < 0 ? 1.1 : 0.9), center);
    }, { passive: false });
  }

  updateHint() {
    const t = this.store.tool;
    const map = {
      select: "Select: click to select · drag to move · Del to delete",
      pan: "Pan: drag to move the view · scroll to zoom",
      scale: `Scale: click two points a known distance apart${this.scalePts.length === 1 ? " · click the second point" : ""}`,
      room: "Room: click to add corners · double-click or Enter to finish",
      duct: `Duct (${this.store.activeSystem}): click to place duct runs · double-click / Esc to finish`,
      component: `Place ${componentDef(this.store.newComponentKind)?.label || "component"} (${this.store.activeSystem}): click a duct point`,
      delete: "Delete: click an element to remove it",
    };
    this.onHint(map[t] || "");
  }

  async onDown(e) {
    if (e.button === 1) { this.dragging = { pan: true, sx: e.clientX, sy: e.clientY, ox: this.view.offsetX, oy: this.view.offsetY }; return; }
    if (e.button !== 0) return;
    const world = this.eventWorld(e);
    const tool = this.store.tool;
    this.pointer = world;

    if (tool === "pan") {
      this.dragging = { pan: true, sx: e.clientX, sy: e.clientY, ox: this.view.offsetX, oy: this.view.offsetY };
      return;
    }
    if (tool === "select") {
      const h = this.hit(world);
      this.store.select(h?.type, h?.id);
      if (h) {
        const p = this.store.project;
        if (h.type === "node") {
          const n = p.nodes.find((x) => x.id === h.id);
          this.dragging = { kind: "node", id: h.id, dx: world.x - n.x, dy: world.y - n.y, moved: false };
        } else if (h.type === "component") {
          const c = p.components.find((x) => x.id === h.id);
          const n = p.nodes.find((x) => x.id === c.nodeId);
          this.dragging = { kind: "node", id: c.nodeId, dx: world.x - n.x, dy: world.y - n.y, moved: false };
        } else if (h.type === "room") {
          const r = p.rooms.find((x) => x.id === h.id);
          this.dragging = { kind: "room", id: h.id, start: world, orig: r.points.map((pt) => ({ ...pt })), moved: false };
        }
      }
      return;
    }
    if (tool === "delete") {
      const h = this.hit(world);
      if (h) { this.store.select(h.type, h.id); this.store.deleteSelection(); }
      return;
    }
    if (tool === "scale") {
      this.scalePts.push(world);
      if (this.scalePts.length === 2) await this.finishScale();
      this.updateHint();
      this.draw();
      return;
    }
    if (tool === "room") {
      this.roomPts.push(world);
      this.draw();
      return;
    }
    if (tool === "duct") {
      this.placeDuctPoint(world);
      return;
    }
    if (tool === "component") {
      this.placeComponent(world);
      return;
    }
  }

  onMove(e) {
    const world = this.eventWorld(e);
    this.pointer = world;
    if (this.dragging?.pan) {
      this.view.offsetX = this.dragging.ox + (e.clientX - this.dragging.sx);
      this.view.offsetY = this.dragging.oy + (e.clientY - this.dragging.sy);
      this.draw();
      return;
    }
    if (this.dragging?.kind === "node") {
      if (!this.dragging.moved) { this.store.snapshot(); this.dragging.moved = true; }
      const n = this.store.project.nodes.find((x) => x.id === this.dragging.id);
      if (n) { n.x = world.x - this.dragging.dx; n.y = world.y - this.dragging.dy; }
      const c = this.store.project.components.find((x) => x.nodeId === this.dragging.id);
      if (c) { c.x = n.x; c.y = n.y; }
      this.draw();
      return;
    }
    if (this.dragging?.kind === "room") {
      if (!this.dragging.moved) { this.store.snapshot(); this.dragging.moved = true; }
      const r = this.store.project.rooms.find((x) => x.id === this.dragging.id);
      const ddx = world.x - this.dragging.start.x;
      const ddy = world.y - this.dragging.start.y;
      r.points = this.dragging.orig.map((pt) => ({ x: pt.x + ddx, y: pt.y + ddy }));
      this.draw();
      return;
    }
    // live preview for chained tools
    if (this.store.tool === "duct" || this.store.tool === "room" || this.store.tool === "scale") this.draw();
  }

  onUp() {
    if (this.dragging?.moved) this.store.commit();
    else if (this.dragging?.pan) this.store.persist();
    this.dragging = null;
  }

  onDblClick() {
    if (this.store.tool === "room") this.finishRoom();
    else this.endDraft();
  }

  endDraft() {
    if (this.store.tool === "room" && this.roomPts.length >= 3) this.finishRoom();
    this.ductLastNodeId = null;
    this.roomPts = [];
    this.scalePts = [];
    this.updateHint();
    this.draw();
  }

  placeDuctPoint(world) {
    const node = this.store.findOrCreateNode(world);
    if (this.ductLastNodeId == null) {
      this.store.snapshot();
      this.ductLastNodeId = node.id;
    } else if (this.ductLastNodeId !== node.id) {
      const a = this.store.project.nodes.find((n) => n.id === this.ductLastNodeId);
      this.store.addSegment(a, node);
      this.ductLastNodeId = node.id;
    }
    this.store.commit();
  }

  placeComponent(world) {
    const h = this.hit(world);
    let node;
    if (h?.type === "node") node = this.store.project.nodes.find((n) => n.id === h.id);
    else if (h?.type === "component") node = this.store.project.nodes.find((n) => n.id === this.store.project.components.find((c) => c.id === h.id).nodeId);
    else node = this.store.findOrCreateNode(world);
    this.store.snapshot();
    const c = this.store.addComponentAtNode(node, this.store.newComponentKind);
    this.store.select("component", c.id);
    this.store.commit();
  }

  finishRoom() {
    if (this.roomPts.length >= 3) {
      this.store.snapshot();
      const r = this.store.addRoom(this.roomPts.map((p) => ({ ...p })));
      this.store.select("room", r.id);
      this.store.commit();
    }
    this.roomPts = [];
    this.updateHint();
    this.draw();
  }

  async finishScale() {
    const [a, b] = this.scalePts;
    const px = dist(a, b);
    const val = await showPrompt({
      title: "Set drawing scale",
      label: `The line you drew is ${Math.round(px)} px. Enter the real-world distance in metres:`,
      type: "number",
      value: "5",
    });
    if (val && Number(val) > 0) {
      this.store.snapshot();
      this.store.project.scale.pxPerMeter = px / Number(val);
      this.store.project.scale.calib = { a, b, meters: Number(val) };
      this.store.commit();
    }
    this.scalePts = [];
    this.store.setTool("select");
  }

  // ---- rendering ----
  draw() {
    const ctx = this.ctx;
    const p = this.store.project;
    const v = this.view;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);

    ctx.translate(v.offsetX, v.offsetY);
    ctx.scale(v.zoom, v.zoom);

    this.drawGrid(ctx);
    this.loadBackground();
    if (this._bg && p.background) {
      ctx.globalAlpha = p.background.opacity ?? 0.85;
      ctx.drawImage(this._bg, p.background.x, p.background.y, p.background.width, p.background.height);
      ctx.globalAlpha = 1;
    }
    this.drawRooms(ctx);
    this.drawSegments(ctx);
    this.drawNodes(ctx);
    this.drawComponents(ctx);
    this.drawDrafts(ctx);

    ctx.restore();
  }

  drawGrid(ctx) {
    const v = this.view;
    const w = this.canvas.clientWidth / v.zoom;
    const h = this.canvas.clientHeight / v.zoom;
    const ox = -v.offsetX / v.zoom;
    const oy = -v.offsetY / v.zoom;
    ctx.lineWidth = 1 / v.zoom;
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.beginPath();
    const startX = Math.floor(ox / GRID) * GRID;
    const startY = Math.floor(oy / GRID) * GRID;
    for (let x = startX; x < ox + w; x += GRID) { ctx.moveTo(x, oy); ctx.lineTo(x, oy + h); }
    for (let y = startY; y < oy + h; y += GRID) { ctx.moveTo(ox, y); ctx.lineTo(ox + w, y); }
    ctx.stroke();
  }

  drawRooms(ctx) {
    const p = this.store.project;
    const sel = this.store.selection;
    for (const r of p.rooms) {
      ctx.beginPath();
      r.points.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)));
      ctx.closePath();
      const selected = sel?.type === "room" && sel.id === r.id;
      ctx.fillStyle = selected ? "rgba(56,189,248,0.12)" : "rgba(148,163,184,0.07)";
      ctx.fill();
      ctx.lineWidth = (selected ? 2 : 1.2) / this.view.zoom;
      ctx.strokeStyle = selected ? "#38bdf8" : "rgba(148,163,184,0.5)";
      ctx.setLineDash([6 / this.view.zoom, 4 / this.view.zoom]);
      ctx.stroke();
      ctx.setLineDash([]);
      const c = polygonCentroid(r.points);
      ctx.fillStyle = "#cbd5e1";
      ctx.font = `${13 / this.view.zoom}px system-ui`;
      ctx.textAlign = "center";
      ctx.fillText(r.name, c.x, c.y - 4 / this.view.zoom);
      ctx.fillStyle = "#93a4c3";
      ctx.font = `${11 / this.view.zoom}px system-ui`;
      const parts = [];
      if (r.supplyFlow_ls) parts.push(`S ${r.supplyFlow_ls} l/s`);
      if (r.extractFlow_ls) parts.push(`E ${r.extractFlow_ls} l/s`);
      if (parts.length) ctx.fillText(parts.join("  ·  "), c.x, c.y + 12 / this.view.zoom);
    }
  }

  segResult(id) {
    if (!this.results) return null;
    return (
      this.results.supply.segments.find((s) => s.id === id) ||
      this.results.extract.segments.find((s) => s.id === id) ||
      null
    );
  }

  isIndexSeg(id) {
    if (!this.results) return false;
    return this.results.supply.indexPath.includes(id) || this.results.extract.indexPath.includes(id);
  }

  drawSegments(ctx) {
    const p = this.store.project;
    const sel = this.store.selection;
    const z = this.view.zoom;
    for (const s of p.segments) {
      const a = p.nodes.find((n) => n.id === s.a);
      const b = p.nodes.find((n) => n.id === s.b);
      if (!a || !b) continue;
      const res = this.segResult(s.id);
      const selected = sel?.type === "segment" && sel.id === s.id;
      const base = s.system === "extract" ? "#d97706" : "#2563eb";
      // width proportional to duct size (fallback fixed)
      let widthPx = 6;
      if (res?.section) {
        const dmm = res.section.diameterMm || res.section.equivDiameterMm || 200;
        widthPx = Math.max(3, Math.min(22, dmm / 40));
      }
      ctx.lineCap = "round";
      // outline
      ctx.lineWidth = (widthPx + 3) / z;
      ctx.strokeStyle = selected ? "#38bdf8" : this.isIndexSeg(s.id) ? "#f43f5e" : "rgba(0,0,0,0.35)";
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      // fill
      let color = base;
      if (res && !res.withinVelocity) color = "#ef4444";
      ctx.lineWidth = widthPx / z;
      ctx.strokeStyle = color;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();

      // label
      if (res && res.flowM3s > 0) {
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const label = res.section.shape === "rect"
          ? `${res.section.widthMm}×${res.section.heightMm}`
          : `⌀${res.section.diameterMm}`;
        ctx.font = `${11 / z}px system-ui`;
        ctx.textAlign = "center";
        const txt = `${label}  ${round(res.velocity, 1)} m/s`;
        const w = ctx.measureText(txt).width + 8 / z;
        ctx.fillStyle = "rgba(10,15,28,0.82)";
        ctx.fillRect(mx - w / 2, my - 16 / z, w, 14 / z);
        ctx.fillStyle = res.withinVelocity ? "#e6edf7" : "#fca5a5";
        ctx.fillText(txt, mx, my - 5 / z);
      }
    }
  }

  drawNodes(ctx) {
    const p = this.store.project;
    const z = this.view.zoom;
    for (const n of p.nodes) {
      const hasComp = p.components.some((c) => c.nodeId === n.id);
      if (hasComp) continue;
      ctx.beginPath();
      ctx.arc(n.x, n.y, 3.5 / z, 0, Math.PI * 2);
      ctx.fillStyle = "#cbd5e1";
      ctx.fill();
    }
  }

  drawComponents(ctx) {
    const p = this.store.project;
    const sel = this.store.selection;
    const z = this.view.zoom;
    for (const c of p.components) {
      const n = p.nodes.find((x) => x.id === c.nodeId) || c;
      const def = componentDef(c.kind);
      if (!def) continue;
      const selected = sel?.type === "component" && sel.id === c.id;
      const size = 22 / z;
      ctx.save();
      ctx.translate(n.x, n.y);
      ctx.fillStyle = def.color;
      ctx.strokeStyle = selected ? "#38bdf8" : "rgba(255,255,255,0.5)";
      ctx.lineWidth = (selected ? 2.5 : 1) / z;
      if (def.role === "terminal") {
        ctx.beginPath(); ctx.arc(0, 0, size / 2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      } else {
        this.roundRect(ctx, -size / 2, -size / 2, size, size, 4 / z); ctx.fill(); ctx.stroke();
      }
      ctx.fillStyle = "#fff";
      ctx.font = `${9 / z}px system-ui`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(def.symbol, 0, 0);
      ctx.textBaseline = "alphabetic";
      ctx.restore();
    }
  }

  drawDrafts(ctx) {
    const z = this.view.zoom;
    // duct chain preview
    if (this.store.tool === "duct" && this.ductLastNodeId != null && this.pointer) {
      const a = this.store.project.nodes.find((n) => n.id === this.ductLastNodeId);
      if (a) {
        ctx.setLineDash([6 / z, 4 / z]);
        ctx.strokeStyle = "#38bdf8"; ctx.lineWidth = 2 / z;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(this.pointer.x, this.pointer.y); ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    // room preview
    if (this.store.tool === "room" && this.roomPts.length) {
      ctx.beginPath();
      this.roomPts.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)));
      if (this.pointer) ctx.lineTo(this.pointer.x, this.pointer.y);
      ctx.strokeStyle = "#38bdf8"; ctx.lineWidth = 1.5 / z; ctx.setLineDash([5 / z, 4 / z]);
      ctx.stroke(); ctx.setLineDash([]);
      for (const pt of this.roomPts) { ctx.beginPath(); ctx.arc(pt.x, pt.y, 3 / z, 0, Math.PI * 2); ctx.fillStyle = "#38bdf8"; ctx.fill(); }
    }
    // scale preview
    if (this.store.tool === "scale") {
      const pts = [...this.scalePts];
      if (pts.length === 1 && this.pointer) pts.push(this.pointer);
      if (pts.length === 2) {
        ctx.strokeStyle = "#22d3ee"; ctx.lineWidth = 2 / z;
        ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); ctx.lineTo(pts[1].x, pts[1].y); ctx.stroke();
        for (const pt of pts) { ctx.beginPath(); ctx.arc(pt.x, pt.y, 4 / z, 0, Math.PI * 2); ctx.fillStyle = "#22d3ee"; ctx.fill(); }
      }
    }
    // existing calibration marker
    const cal = this.store.project.scale.calib;
    if (cal && this.store.tool !== "scale") {
      ctx.strokeStyle = "rgba(34,211,238,0.4)"; ctx.lineWidth = 1.5 / z; ctx.setLineDash([4 / z, 3 / z]);
      ctx.beginPath(); ctx.moveTo(cal.a.x, cal.a.y); ctx.lineTo(cal.b.x, cal.b.y); ctx.stroke(); ctx.setLineDash([]);
    }
  }

  roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
