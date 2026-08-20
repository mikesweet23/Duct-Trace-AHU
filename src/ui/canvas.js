// Canvas editor: rendering + pointer interaction for all drawing tools.
// Snapping, real duct bodies, T-pieces and resize handles follow ac-trace.

import { dist, pointInPolygon, polygonCentroid, orthoPoint, offsetPoly, isVerticalRiser, clamp } from "../geom.js";
import { componentDef } from "../standards/components.js";
import { showPrompt } from "./modal.js";
import { formatFlowLs, normalizeFlowUnit, round } from "../units.js";
import { findSegResult, isIndexSegment } from "../calc/network.js";
import { snapAt, hitJointAt, EQUIP_HIT_PX } from "../snap.js";
import {
  componentBox,
  componentBoxTrue,
  handlesOf,
  hitHandle,
  pxPerMeterOf,
  HANDLE_PX,
} from "../layout.js";

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

    this.pointer = null;
    this.dragging = null;
    this.ductLastNodeId = null;
    this.ductLastOff = null;
    this.roomPts = [];
    this.scalePts = [];
    this.hoverSnap = null;

    this._bind();
    this.resize();
  }

  setResults(results) {
    this.results = results;
    this.draw();
  }

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

  pxPerMeter() { return pxPerMeterOf(this.store.project); }

  snapOpts() {
    return {
      zoom: this.view.zoom,
      skipNodeId: this.ductLastNodeId,
      system: this.store.activeSystem,
      alt: this.store.overrideKey,
      snapPoints: this.store.project.settings.snapPoints !== false,
    };
  }

  previewPoint(world) {
    const opts = this.snapOpts();
    const sn = snapAt(this.store.project, world, opts);
    if (sn) return { x: sn.at.x, y: sn.at.y, snap: sn };
    // A slightly wider magnet so a click on the last outlet is not turned
    // into a 45° / square ghost corner just short of the grille.
    const intent = snapAt(this.store.project, world, { ...opts, magnetPx: EQUIP_HIT_PX * 1.6 });
    if (intent?.kind === "component") return { x: intent.at.x, y: intent.at.y, snap: intent };
    const last = this.ductLastNodeId
      ? this.store.project.nodes.find((n) => n.id === this.ductLastNodeId)
      : null;
    const ortho = this.store.project.settings.ortho !== false;
    const useOrtho = this.store.overrideKey ? !ortho : ortho;
    const q = useOrtho ? orthoPoint(last, world) : { x: world.x, y: world.y };
    return { ...q, snap: null };
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
    for (const c of p.components) pts.push(c);
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

  hit(world) {
    const p = this.store.project;
    const px = this.pxPerMeter();
    const z = this.view.zoom;
    const sel = this.store.selection;
    if (sel?.type === "component") {
      const c = p.components.find((x) => x.id === sel.id);
      if (c) {
        const hh = hitHandle(c, world, px, z);
        if (hh) return { type: "handle", id: c.id, handle: hh.handle };
      }
    }
    for (const c of p.components) {
      const box = componentBoxTrue(c, px);
      const localX = world.x - c.x;
      const localY = world.y - c.y;
      const rot = (box.rot * Math.PI) / 180;
      const lx = localX * Math.cos(-rot) - localY * Math.sin(-rot);
      const ly = localX * Math.sin(-rot) + localY * Math.cos(-rot);
      if (Math.abs(lx) <= box.w / 2 && Math.abs(ly) <= box.d / 2) return { type: "component", id: c.id };
    }
    for (const n of p.nodes) {
      if (dist(n, world) <= 8 / z) return { type: "node", id: n.id };
    }
    for (const s of p.segments) {
      const a = p.nodes.find((x) => x.id === s.a);
      const b = p.nodes.find((x) => x.id === s.b);
      if (!a || !b) continue;
      const res = this.segResult(s.id);
      const width = this.ductWidthWorld(res, s) / 2 + 6 / z;
      const r = (world.x - a.x) * (b.x - a.x) + (world.y - a.y) * (b.y - a.y);
      const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
      const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, r / l2));
      const cx = a.x + t * (b.x - a.x);
      const cy = a.y + t * (b.y - a.y);
      if (Math.hypot(world.x - cx, world.y - cy) <= width) return { type: "segment", id: s.id };
    }
    for (let i = p.rooms.length - 1; i >= 0; i--) {
      if (pointInPolygon(world, p.rooms[i].points)) return { type: "room", id: p.rooms[i].id };
    }
    return null;
  }

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
    const h = this.store.traceHeight;
    const map = {
      select: "Select: click to select · drag to move · corners to resize · Del to delete · Ctrl+D to duplicate an outlet",
      pan: "Pan: drag to move the view · scroll to zoom",
      scale: `Scale: click two points a known distance apart${this.scalePts.length === 1 ? " · click the second point" : ""}`,
      room: "Room: click to add corners · double-click or Enter to finish",
      duct: `Duct (${this.store.activeSystem}) at ${round(h, 2)} m AFFL: snap to an outlet or AHU · [ ] change height · Alt cuts a T-piece`,
      tee: "T-piece: click a duct to cut a branch joint · then trace a new run off it",
      component: `Place ${componentDef(this.store.newComponentKind)?.label || "component"} (${this.store.activeSystem}): click to drop · drag corners later to size it`,
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
      if (h?.type === "handle") {
        const c = this.store.project.components.find((x) => x.id === h.id);
        this.store.select("component", h.id);
        this.dragging = {
          kind: "handle",
          id: h.id,
          handle: h.handle,
          moved: false,
          rot0: c.rot || 0,
          foot0: { w: c.widthM, d: c.depthM },
        };
        return;
      }
      this.store.select(h?.type, h?.id);
      if (h) {
        const p = this.store.project;
        if (h.type === "node") {
          const n = p.nodes.find((x) => x.id === h.id);
          this.dragging = { kind: "node", id: h.id, dx: world.x - n.x, dy: world.y - n.y, moved: false };
        } else if (h.type === "component") {
          const c = p.components.find((x) => x.id === h.id);
          this.dragging = { kind: "component", id: h.id, dx: world.x - c.x, dy: world.y - c.y, moved: false };
        } else if (h.type === "room") {
          const r = p.rooms.find((x) => x.id === h.id);
          this.dragging = { kind: "room", id: h.id, start: world, orig: r.points.map((pt) => ({ ...pt })), moved: false };
        }
      }
      return;
    }
    if (tool === "delete") {
      const h = this.hit(world);
      if (h && h.type !== "handle") { this.store.select(h.type, h.id); this.store.deleteSelection(); }
      return;
    }
    if (tool === "tee") {
      this.cutTee(world);
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
    if (this.dragging?.kind === "handle") {
      const c = this.store.project.components.find((x) => x.id === this.dragging.id);
      if (!c) return;
      if (!this.dragging.moved) { this.store.snapshot(); this.dragging.moved = true; }
      const px = this.pxPerMeter();
      if (this.dragging.handle.kind === "rot") {
        const a = Math.atan2(world.y - c.y, world.x - c.x) * 180 / Math.PI + 90;
        const rot = e.shiftKey ? Math.round(a / 15) * 15 : Math.round(a * 10) / 10;
        this.store.resizeComponent(c, null, null, rot);
      } else {
        const rot = (this.dragging.rot0 * Math.PI) / 180;
        const lx = (world.x - c.x) * Math.cos(-rot) - (world.y - c.y) * Math.sin(-rot);
        const ly = (world.x - c.x) * Math.sin(-rot) + (world.y - c.y) * Math.cos(-rot);
        let w = Math.max(0.08, Math.abs(lx) * 2 / px);
        let d = Math.max(0.08, Math.abs(ly) * 2 / px);
        if (e.shiftKey) {
          const r0 = (this.dragging.foot0.d || 1) / (this.dragging.foot0.w || 1);
          if (Math.abs(lx) / Math.max(this.dragging.foot0.w, 1e-6) > Math.abs(ly) / Math.max(this.dragging.foot0.d, 1e-6)) d = w * r0;
          else w = d / r0;
        }
        this.store.resizeComponent(c, Math.round(w * 1000) / 1000, Math.round(d * 1000) / 1000, null);
      }
      this.draw();
      return;
    }
    if (this.dragging?.kind === "node") {
      if (!this.dragging.moved) { this.store.snapshot(); this.dragging.moved = true; }
      const n = this.store.project.nodes.find((x) => x.id === this.dragging.id);
      if (n) { n.x = world.x - this.dragging.dx; n.y = world.y - this.dragging.dy; }
      const c = this.store.project.components.find((x) => x.nodeId === this.dragging.id || x.returnNodeId === this.dragging.id);
      if (c && c.nodeId === this.dragging.id && !c.returnNodeId) {
        this.store.moveComponent(c, n.x, n.y);
      }
      this.draw();
      return;
    }
    if (this.dragging?.kind === "component") {
      if (!this.dragging.moved) { this.store.snapshot(); this.dragging.moved = true; }
      const c = this.store.project.components.find((x) => x.id === this.dragging.id);
      if (c) this.store.moveComponent(c, world.x - this.dragging.dx, world.y - this.dragging.dy);
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
    if (this.store.tool === "duct" || this.store.tool === "tee" || this.store.tool === "room" || this.store.tool === "scale") this.draw();
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
    this.ductLastOff = null;
    this.roomPts = [];
    this.scalePts = [];
    this.updateHint();
    this.draw();
  }

  connectSnap(sn, world) {
    if (sn?.kind === "run") {
      this.store.snapshot();
      const j = this.store.splitSegmentAt(sn.seg, sn.at, sn.z ?? this.store.traceHeight);
      return { node: j, off: null };
    }
    if (sn?.kind === "component" || sn?.kind === "node") {
      return { node: sn.node, off: sn.off || null };
    }
    return { node: this.store.findOrCreateNode(world, this.store.traceHeight), off: null };
  }

  placeDuctPoint(world) {
    const prev = this.previewPoint(world);
    const last = this.ductLastNodeId
      ? this.store.project.nodes.find((n) => n.id === this.ductLastNodeId)
      : null;

    // Changing height on the same plan point creates a riser that does not
    // draw as a run — it only appears as a marker, and in 3D.
    if (last && dist(last, prev) < 6 / this.view.zoom && Math.abs((last.z || 0) - this.store.traceHeight) > 0.05) {
      this.store.snapshot();
      const risen = this.store.findOrCreateNode({ x: last.x, y: last.y }, this.store.traceHeight);
      this.store.addSegment(last, risen);
      this.ductLastNodeId = risen.id;
      this.store.commit();
      return;
    }

    const { node, off } = this.connectSnap(prev.snap, prev);
    if (this.ductLastNodeId == null) {
      this.store.snapshot();
      this.ductLastNodeId = node.id;
      this.ductLastOff = off;
      const anchored = this.store.project.components.some((c) => c.nodeId === node.id || c.returnNodeId === node.id);
      if (!anchored) node.z = this.store.traceHeight;
    } else if (this.ductLastNodeId !== node.id) {
      const a = this.store.project.nodes.find((n) => n.id === this.ductLastNodeId);
      node.z = Number.isFinite(Number(node.z)) ? node.z : this.store.traceHeight;
      const seg = this.store.addSegment(a, node);
      if (seg) {
        seg.aOff = this.ductLastOff;
        seg.bOff = off;
      }
      this.ductLastNodeId = node.id;
      this.ductLastOff = off;
    }
    this.store.commit();
  }

  cutTee(world) {
    const hit = hitJointAt(this.store.project, world, this.view.zoom);
    if (!hit) return;
    this.store.snapshot();
    const j = this.store.splitSegmentAt(hit.seg, hit.r.point);
    this.store.select("node", j.id);
    this.store.setTool("duct");
    this.ductLastNodeId = j.id;
    this.store.commit();
  }

  placeComponent(world) {
    this.store.snapshot();
    const c = this.store.addComponentAt(world, this.store.newComponentKind);
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
      const unit = normalizeFlowUnit(p.settings.flowUnit);
      if (r.supplyFlow_ls) parts.push(`S ${formatFlowLs(r.supplyFlow_ls, unit)}`);
      if (r.extractFlow_ls) parts.push(`E ${formatFlowLs(r.extractFlow_ls, unit)}`);
      if (parts.length) ctx.fillText(parts.join("  ·  "), c.x, c.y + 12 / this.view.zoom);
    }
  }

  segResult(id) {
    return findSegResult(this.results, id);
  }

  isIndexSeg(id) {
    return isIndexSegment(this.results, id);
  }

  ductWidthWorld(res, seg) {
    const px = this.pxPerMeter();
    const z = this.view.zoom;
    const show = this.store.project.settings.showActualDucts !== false;
    const section = res?.section;
    let mm = 200;
    if (section) {
      if (section.shape === "rect" || section.shape === "square") mm = section.widthMm || section.heightMm || 200;
      else mm = section.diameterMm || section.equivDiameterMm || 200;
    }
    const real = (mm / 1000) * px;
    if (show) return clamp(real, 4 / z, 80 / z);
    return clamp(real / 2, 4 / z, 22 / z);
  }

  drawSegments(ctx) {
    const p = this.store.project;
    const sel = this.store.selection;
    const z = this.view.zoom;
    const px = this.pxPerMeter();
    for (const s of p.segments) {
      const a = p.nodes.find((n) => n.id === s.a);
      const b = p.nodes.find((n) => n.id === s.b);
      if (!a || !b) continue;
      const res = this.segResult(s.id);
      const selected = sel?.type === "segment" && sel.id === s.id;
      const base = s.system === "extract" ? "#d97706" : "#2563eb";
      const noFlow = !res || res.flowM3s <= 0;
      const shape = (res?.section?.shape) || s.shapeOverride || p.settings.ductType || "round";

      if (isVerticalRiser(a, b, px)) {
        this.drawRiserMarker(ctx, a, b, s, selected);
        continue;
      }

      const width = this.ductWidthWorld(res, s);
      this.drawDuctBody(ctx, a, b, width, shape, base, {
        selected,
        index: this.isIndexSeg(s.id),
        noFlow,
        overVel: res && !res.withinVelocity,
      });

      if (Math.abs((a.z || 0) - (b.z || 0)) > 0.05) {
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        ctx.fillStyle = "rgba(10,15,28,0.82)";
        ctx.font = `${10 / z}px system-ui`;
        ctx.textAlign = "center";
        const txt = `Δh ${round(Math.abs((a.z || 0) - (b.z || 0)), 2)} m`;
        ctx.fillText(txt, mx, my + 18 / z);
      }

      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      ctx.font = `${11 / z}px system-ui`;
      ctx.textAlign = "center";
      if (res && res.flowM3s > 0) {
        const label = (res.section.shape === "rect" || res.section.shape === "square")
          ? `${res.section.widthMm}×${res.section.heightMm}`
          : `⌀${res.section.diameterMm}`;
        const txt = `${label}  ${round(res.velocity, 1)} m/s`;
        const w = ctx.measureText(txt).width + 8 / z;
        ctx.fillStyle = "rgba(10,15,28,0.82)";
        ctx.fillRect(mx - w / 2, my - 16 / z, w, 14 / z);
        ctx.fillStyle = res.withinVelocity ? "#e6edf7" : "#fca5a5";
        ctx.fillText(txt, mx, my - 5 / z);
      } else {
        const txt = "no flow · connect to plant";
        const w = ctx.measureText(txt).width + 8 / z;
        ctx.fillStyle = "rgba(10,15,28,0.82)";
        ctx.fillRect(mx - w / 2, my - 16 / z, w, 14 / z);
        ctx.fillStyle = "#fcd34d";
        ctx.fillText(txt, mx, my - 5 / z);
      }
    }
  }

  drawDuctBody(ctx, a, b, width, shape, color, flags) {
    const z = this.view.zoom;
    const pts = [a, b];
    const half = width / 2;
    const left = offsetPoly(pts, half);
    const right = offsetPoly(pts, -half);
    ctx.beginPath();
    ctx.moveTo(left[0].x, left[0].y);
    ctx.lineTo(left[1].x, left[1].y);
    ctx.lineTo(right[1].x, right[1].y);
    ctx.lineTo(right[0].x, right[0].y);
    ctx.closePath();
    if (shape === "round") {
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = flags.selected ? "#38bdf8" : flags.index ? "#f43f5e" : "rgba(0,0,0,0.45)";
      ctx.lineWidth = width + 3 / z;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.strokeStyle = flags.overVel ? "#ef4444" : flags.noFlow ? (color + "99") : color;
      if (flags.noFlow) ctx.setLineDash([10 / z, 7 / z]);
      ctx.lineWidth = width;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = "rgba(255,255,255,0.28)";
      ctx.lineWidth = Math.max(1 / z, width * 0.12);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    } else {
      ctx.fillStyle = flags.overVel ? "rgba(239,68,68,0.85)" : flags.noFlow ? "rgba(37,99,235,0.35)" : color;
      if (color === "#d97706" && flags.noFlow) ctx.fillStyle = "rgba(217,119,6,0.35)";
      ctx.fill();
      ctx.lineJoin = "miter";
      ctx.strokeStyle = flags.selected ? "#38bdf8" : flags.index ? "#f43f5e" : "rgba(255,255,255,0.45)";
      ctx.lineWidth = (flags.selected ? 2.2 : 1.1) / z;
      if (flags.noFlow) ctx.setLineDash([8 / z, 5 / z]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  drawRiserMarker(ctx, a, b, seg, selected) {
    const z = this.view.zoom;
    const dz = (b.z || 0) - (a.z || 0);
    const x = a.x, y = a.y;
    const r = 9 / z;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = selected ? "rgba(56,189,248,0.25)" : "rgba(10,15,28,0.9)";
    ctx.fill();
    ctx.lineWidth = 2 / z;
    ctx.strokeStyle = selected ? "#38bdf8" : (seg.system === "extract" ? "#d97706" : "#2563eb");
    ctx.stroke();
    ctx.beginPath();
    if (dz >= 0) {
      ctx.moveTo(x, y + 4 / z); ctx.lineTo(x, y - 4 / z);
      ctx.moveTo(x - 3 / z, y - 1 / z); ctx.lineTo(x, y - 4 / z); ctx.lineTo(x + 3 / z, y - 1 / z);
    } else {
      ctx.moveTo(x, y - 4 / z); ctx.lineTo(x, y + 4 / z);
      ctx.moveTo(x - 3 / z, y + 1 / z); ctx.lineTo(x, y + 4 / z); ctx.lineTo(x + 3 / z, y + 1 / z);
    }
    ctx.stroke();
    ctx.fillStyle = "#e6edf7";
    ctx.font = `${10 / z}px system-ui`;
    ctx.textAlign = "center";
    ctx.fillText(`riser ${round(Math.abs(dz), 2)} m`, x, y + 18 / z);
  }

  drawNodes(ctx) {
    const p = this.store.project;
    const z = this.view.zoom;
    const sel = this.store.selection;
    for (const n of p.nodes) {
      const hasComp = p.components.some((c) => c.nodeId === n.id || c.returnNodeId === n.id);
      if (hasComp) continue;
      const selected = sel?.type === "node" && sel.id === n.id;
      const degree = p.segments.filter((s) => s.a === n.id || s.b === n.id).length;
      ctx.beginPath();
      if (n.tee || degree >= 3) {
        ctx.moveTo(n.x - 6 / z, n.y);
        ctx.lineTo(n.x + 6 / z, n.y);
        ctx.moveTo(n.x, n.y);
        ctx.lineTo(n.x, n.y + 7 / z);
        ctx.lineWidth = 2.4 / z;
        ctx.strokeStyle = selected ? "#38bdf8" : "#e2e8f0";
        ctx.stroke();
      } else {
        ctx.arc(n.x, n.y, (selected ? 5 : 3.5) / z, 0, Math.PI * 2);
        ctx.fillStyle = selected ? "#38bdf8" : "#cbd5e1";
        ctx.fill();
      }
    }
  }

  drawComponents(ctx) {
    const p = this.store.project;
    const sel = this.store.selection;
    const z = this.view.zoom;
    const px = this.pxPerMeter();
    for (const c of p.components) {
      const def = componentDef(c.kind);
      if (!def) continue;
      const selected = sel?.type === "component" && sel.id === c.id;
      const box = componentBox(c, px, z);
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate((box.rot * Math.PI) / 180);
      ctx.fillStyle = def.color;
      ctx.strokeStyle = selected ? "#38bdf8" : "rgba(255,255,255,0.55)";
      ctx.lineWidth = (selected ? 2.4 : 1.2) / z;
      this.roundRect(ctx, -box.w / 2, -box.d / 2, box.w, box.d, Math.min(6 / z, Math.min(box.w, box.d) * 0.12));
      ctx.globalAlpha = 0.92;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.stroke();
      if (c.kind === "ahu" && c.system === "both") {
        ctx.fillStyle = "rgba(37,99,235,0.35)";
        ctx.fillRect(0, -box.d / 2, box.w / 2, box.d);
        ctx.fillStyle = "rgba(217,119,6,0.35)";
        ctx.fillRect(-box.w / 2, -box.d / 2, box.w / 2, box.d);
      }
      ctx.fillStyle = "#fff";
      ctx.font = `${clamp(Math.min(box.w, box.d) * 0.22, 9 / z, 16 / z)}px system-ui`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(def.symbol, 0, 0);
      ctx.restore();

      ctx.fillStyle = "#cbd5e1";
      ctx.font = `${11 / z}px system-ui`;
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      const name = c.label || def.label;
      ctx.fillText(name, c.x, c.y + box.d / 2 + 13 / z);
      ctx.fillStyle = "#93a4c3";
      ctx.font = `${10 / z}px system-ui`;
      const hz = Number.isFinite(Number(c.heightM)) ? c.heightM : 0;
      ctx.fillText(`${round(hz, 2)} m AFFL`, c.x, c.y + box.d / 2 + 25 / z);

      if (selected) this.drawHandles(ctx, c);
    }
  }

  drawHandles(ctx, c) {
    const z = this.view.zoom;
    const { handles, box } = handlesOf(c, this.pxPerMeter(), z);
    const rot = handles[handles.length - 1];
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 1.4 / z;
    ctx.beginPath();
    ctx.moveTo(rot.arm.x, rot.arm.y);
    ctx.lineTo(rot.x, rot.y);
    ctx.stroke();
    for (const h of handles) {
      if (h.kind === "rot") {
        ctx.beginPath();
        ctx.arc(h.x, h.y, HANDLE_PX / z, 0, Math.PI * 2);
        ctx.fillStyle = "#38bdf8";
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.4 / z;
        ctx.stroke();
      } else {
        const s = (HANDLE_PX * 2) / z;
        ctx.fillStyle = "#fff";
        ctx.strokeStyle = "#38bdf8";
        ctx.lineWidth = 1.6 / z;
        ctx.fillRect(h.x - s / 2, h.y - s / 2, s, s);
        ctx.strokeRect(h.x - s / 2, h.y - s / 2, s, s);
      }
    }
    const t = `${round(box.foot.w, 2)} × ${round(box.foot.d, 2)} m${box.rot ? `  ${round(box.rot, 1)}°` : ""}`;
    ctx.font = `${10 / z}px system-ui`;
    ctx.textAlign = "center";
    const w = ctx.measureText(t).width + 10 / z;
    ctx.fillStyle = "#38bdf8";
    ctx.fillRect(c.x - w / 2, c.y + box.d / 2 + 30 / z, w, 14 / z);
    ctx.fillStyle = "#04212f";
    ctx.fillText(t, c.x, c.y + box.d / 2 + 40 / z);
  }

  drawDrafts(ctx) {
    const z = this.view.zoom;
    if (this.store.tool === "duct" && this.pointer) {
      const prev = this.previewPoint(this.pointer);
      this.hoverSnap = prev.snap;
      if (this.ductLastNodeId != null) {
        const a = this.store.project.nodes.find((n) => n.id === this.ductLastNodeId);
        if (a) {
          ctx.setLineDash([6 / z, 4 / z]);
          ctx.strokeStyle = "#38bdf8"; ctx.lineWidth = 2 / z;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(prev.x, prev.y); ctx.stroke();
          ctx.setLineDash([]);
          if (Math.abs((a.z || 0) - this.store.traceHeight) > 0.05 && dist(a, prev) < 8 / z) {
            ctx.fillStyle = "#38bdf8";
            ctx.font = `${11 / z}px system-ui`;
            ctx.textAlign = "left";
            ctx.fillText(`riser → ${round(this.store.traceHeight, 2)} m`, a.x + 12 / z, a.y - 8 / z);
          }
        }
      }
      this.drawSnapGhost(ctx, prev.snap);
    }
    if (this.store.tool === "tee" && this.pointer) {
      const hit = hitJointAt(this.store.project, this.pointer, this.view.zoom);
      if (hit) {
        ctx.beginPath();
        ctx.arc(hit.r.point.x, hit.r.point.y, 7 / z, 0, Math.PI * 2);
        ctx.fillStyle = "#fff";
        ctx.fill();
        ctx.strokeStyle = "#38bdf8";
        ctx.lineWidth = 2.2 / z;
        ctx.stroke();
        ctx.fillStyle = "#0a0f1c";
        ctx.font = `${10 / z}px system-ui`;
        ctx.textAlign = "left";
        ctx.fillStyle = "#e6edf7";
        ctx.fillText("T-piece here", hit.r.point.x + 12 / z, hit.r.point.y + 4 / z);
      }
    }
    if (this.store.tool === "room" && this.roomPts.length) {
      ctx.beginPath();
      this.roomPts.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)));
      if (this.pointer) ctx.lineTo(this.pointer.x, this.pointer.y);
      ctx.strokeStyle = "#38bdf8"; ctx.lineWidth = 1.5 / z; ctx.setLineDash([5 / z, 4 / z]);
      ctx.stroke(); ctx.setLineDash([]);
      for (const pt of this.roomPts) { ctx.beginPath(); ctx.arc(pt.x, pt.y, 3 / z, 0, Math.PI * 2); ctx.fillStyle = "#38bdf8"; ctx.fill(); }
    }
    if (this.store.tool === "scale") {
      const pts = [...this.scalePts];
      if (pts.length === 1 && this.pointer) pts.push(this.pointer);
      if (pts.length === 2) {
        ctx.strokeStyle = "#22d3ee"; ctx.lineWidth = 2 / z;
        ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); ctx.lineTo(pts[1].x, pts[1].y); ctx.stroke();
        for (const pt of pts) { ctx.beginPath(); ctx.arc(pt.x, pt.y, 4 / z, 0, Math.PI * 2); ctx.fillStyle = "#22d3ee"; ctx.fill(); }
      }
    }
    const cal = this.store.project.scale.calib;
    if (cal && this.store.tool !== "scale") {
      ctx.strokeStyle = "rgba(34,211,238,0.4)"; ctx.lineWidth = 1.5 / z; ctx.setLineDash([4 / z, 3 / z]);
      ctx.beginPath(); ctx.moveTo(cal.a.x, cal.a.y); ctx.lineTo(cal.b.x, cal.b.y); ctx.stroke(); ctx.setLineDash([]);
    }
  }

  drawSnapGhost(ctx, sn) {
    if (!sn) return;
    const z = this.view.zoom;
    ctx.beginPath();
    ctx.arc(sn.at.x, sn.at.y, 10 / z, 0, Math.PI * 2);
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 2 / z;
    ctx.stroke();
    if (sn.pulled && this.pointer) {
      ctx.setLineDash([3 / z, 3 / z]);
      ctx.beginPath(); ctx.moveTo(this.pointer.x, this.pointer.y); ctx.lineTo(sn.at.x, sn.at.y); ctx.stroke();
      ctx.setLineDash([]);
    }
    const t = sn.what + (sn.name ? `  ${sn.name}` : "");
    ctx.font = `${10 / z}px system-ui`;
    const w = ctx.measureText(t).width + 10 / z;
    ctx.fillStyle = "rgba(10,15,28,0.92)";
    ctx.fillRect(sn.at.x + 13 / z, sn.at.y - 8 / z, w, 16 / z);
    ctx.fillStyle = "#e6edf7";
    ctx.textAlign = "left";
    ctx.fillText(t, sn.at.x + 18 / z, sn.at.y + 4 / z);
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
