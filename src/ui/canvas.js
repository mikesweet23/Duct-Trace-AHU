// Canvas editor: rendering and pointer interaction on the plan.
//
// Works the way Pipe Trace does:
//   * Trace (T) asks Supply or Extract, then each click is a corner. Start on
//     a unit's ring or a dot on a run; clicking the ring of a unit, or a dot
//     on a run, joins there and drops the pencil. Double-click, Enter or
//     Finish stops in mid-air. There is no T-piece tool: hover a run and a
//     dot appears on it — that is where the branch goes.
//   * Corners lock to 90° and 45°; Alt frees one corner (O turns the lock off).
//   * The Height box is the height of the next point. Change it and click the
//     same point again for a riser.
//   * Drag empty paper to pan in any tool; Space-drag or the middle button
//     also pans. Wheel zooms toward the cursor. Double-click empty paper zooms
//     in there (Shift out).
//   * touch-action is off on the canvas, so a finger or pencil on an iPad
//     traces instead of scrolling the page away.

import { dist, pointInPolygon, polygonCentroid, orthoPoint, offsetPoly, isVerticalRiser, clamp, pointSegment } from "../geom.js";
import { componentDef, isDualPort, symbolOf } from "../standards/components.js";
import { showPrompt, toast } from "./modal.js";
import { formatFlowLs, normalizeFlowUnit, round } from "../units.js";
import { findSegResult, isIndexSegment } from "../calc/network.js";
import { snapAt, hitSegment, hitComponentAt, EQUIP_HIT_PX } from "../snap.js";
import { uid } from "../state.js";
import { systemColor, systemInfo, SYSTEM_KEYS } from "../systems.js";
import { componentBox, componentBoxTrue, handlesOf, hitHandle, pxPerMeterOf, HANDLE_PX, isFourPort, portOffset, unitPortOffset, connPoint, componentNodeIds } from "../layout.js";

const COL = {
  supply: "#1f6fd1",
  extract: "#c2410c",
  sel: "#e0a422",
  index: "#be185d",
  ink: "#1d2433",
  soft: "#56607a",
  accent: "#1d4ed8",
  tape: "#d97706",
  paper: "#fbfaf7",
};
const FONT = "Archivo, system-ui, sans-serif";
const MONO = "'Azeret Mono', ui-monospace, monospace";
const CLICK_SLOP = 5; // screen px a press can wander and still be a click

export function noFlowHint(segment, result, project) {
  if (result?.flowM3s > 0) return null;
  const wrongTerminal = project?.components?.find((c) =>
    componentDef(c.kind)?.role === "terminal"
    && c.system !== segment.system
    && (c.nodeId === segment.a || c.nodeId === segment.b));
  if (wrongTerminal) {
    const target = systemInfo(wrongTerminal.system);
    return `wrong air path — retrace ${target.label} (${target.en})`;
  }
  if (result?.connectedToPlant) return `connected — set ${systemInfo(segment.system).fan} airflow`;
  return "not fed — join it to a unit";
}

export class CanvasView {
  constructor(canvas, store, hooks = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.store = store;
    this.hooks = hooks; // { onHint(), onChange(), onDblZoom() }
    this.results = null;
    this.dpr = window.devicePixelRatio || 1;

    this._bg = null;
    this._bgUrl = null;

    this.pointer = null;
    this.dragging = null; // object drag or pan
    this.pending = null; // pressed, not yet a click or a drag
    this.draft = null; // { lastNodeId, lastOff, count }
    this.roomPts = [];
    this.scalePts = [];
    this.tapePts = [];
    this.spaceDown = false;
    this.touches = new Map();
    this.pinch = null;
    this._raf = 0;

    this._bind();
    this.resize();
  }

  setResults(results) {
    this.results = results;
    this.scheduleDraw();
  }

  get view() { return this.store.project.view; }
  get zoom() { return this.view.zoom; }

  toWorld(sx, sy) {
    const v = this.view;
    return { x: (sx - v.offsetX) / v.zoom, y: (sy - v.offsetY) / v.zoom };
  }
  screenOf(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  eventWorld(e) {
    const s = this.screenOf(e);
    return this.toWorld(s.x, s.y);
  }

  pxPerMeter() { return pxPerMeterOf(this.store.project); }
  isTracing() { return !!this.draft; }
  orthoOn() {
    const on = this.store.project.settings.ortho !== false;
    return this.store.overrideKey ? !on : on;
  }

  // ---------------------------------------------------------------- snapping
  snapOpts(extra = {}) {
    return {
      zoom: this.zoom,
      skipNodeId: this.draft?.lastNodeId || null,
      system: this.store.activeSystem,
      alt: this.store.overrideKey,
      snapPoints: this.store.project.settings.snapPoints !== false,
      runDots: true,
      runHalfWorld: (s) => this.ductWidthWorld(this.segResult(s.id), s) / 2,
      ...extra,
    };
  }

  // What a trace click at `world` would do — the same answer that is drawn.
  traceTarget(world) {
    const p = this.store.project;
    const opts = this.snapOpts();
    let sn = snapAt(p, world, opts);
    if (!sn) {
      // a slightly wider magnet so a click on a small grille is not turned into
      // a corner just short of it
      const wide = snapAt(p, world, { ...opts, magnetPx: EQUIP_HIT_PX * 1.6, runDots: false });
      if (wide?.kind === "component") sn = wide;
    }
    if (sn) return { x: sn.at.x, y: sn.at.y, snap: sn };
    const last = this.draft ? p.nodes.find((n) => n.id === this.draft.lastNodeId) : null;
    if (!last) return { x: world.x, y: world.y, snap: null };
    const lock = this.angleLock(last, world);
    return { x: lock.x, y: lock.y, snap: null, lock };
  }

  // Plan directions (radians) of the ducts of the traced system that meet at
  // a node — the duct being branched off, or the leg just drawn.
  refDirs(node) {
    const p = this.store.project;
    const px = this.pxPerMeter();
    const out = [];
    for (const s of p.segments) {
      if (s.system !== this.store.activeSystem) continue;
      if (s.a !== node.id && s.b !== node.id) continue;
      const o = p.nodes.find((n) => n.id === (s.a === node.id ? s.b : s.a));
      if (!o || dist(o, node) / px < 0.05) continue; // a riser has no plan direction
      out.push(Math.atan2(o.y - node.y, o.x - node.x));
    }
    return out;
  }

  // Corners lock square to the sheet AND at 0 / 45 / 90 / 135° to the duct
  // the leg leaves from, so a branch off an angled run comes off it at a
  // true 90° or 45°. Alt (or the lock off) frees the angle; the label still
  // says when a free leg happens to sit on one of those angles.
  angleLock(from, world) {
    const dx = world.x - from.x, dy = world.y - from.y;
    const len = Math.hypot(dx, dy);
    const cur = Math.atan2(dy, dx);
    const refs = this.refDirs(from);
    const relTo = (ang) => {
      // the smallest angle between this leg and any duct at the node
      let best = null;
      for (const r of refs) {
        let d = Math.abs(((ang - r) * 180) / Math.PI) % 180;
        if (d > 90) d = 180 - d;
        if (!best || d < best.d) best = { d, ref: r };
      }
      return best;
    };
    const near = (d, t) => Math.abs(d - t) < 0.6;
    if (len < 1e-6) return { x: from.x, y: from.y, rel: null };
    let ang = cur;
    let relLock = null;
    if (this.orthoOn()) {
      const cands = [];
      for (let k = 0; k < 8; k++) cands.push({ a: (k * Math.PI) / 4, rel: false });
      for (const r of refs) for (let k = 0; k < 8; k++) cands.push({ a: r + (k * Math.PI) / 4, rel: true, ref: r });
      let best = null;
      for (const c of cands) {
        let d = Math.abs(cur - c.a) % (2 * Math.PI);
        if (d > Math.PI) d = 2 * Math.PI - d;
        // prefer the duct's own angles when they tie with the sheet's
        if (!best || d < best.d - 1e-9 || (Math.abs(d - best.d) < 1e-9 && c.rel && !best.c.rel)) best = { d, c };
      }
      ang = best.c.a;
    }
    const proj = this.orthoOn() ? Math.max(0, dx * Math.cos(ang) + dy * Math.sin(ang)) : len;
    const x = this.orthoOn() ? from.x + Math.cos(ang) * proj : world.x;
    const y = this.orthoOn() ? from.y + Math.sin(ang) * proj : world.y;
    const r = relTo(ang);
    if (r && proj > 0) {
      if (near(r.d, 90)) relLock = { deg: 90, ref: r.ref };
      else if (near(r.d, 45)) relLock = { deg: 45, ref: r.ref };
    }
    return { x, y, rel: relLock, refs };
  }

  // ------------------------------------------------------------------- view
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
    v.zoom = clamp(zoom, 0.05, 40);
    v.offsetX = c.x - before.x * v.zoom;
    v.offsetY = c.y - before.y * v.zoom;
    this.changed();
  }

  extent() {
    const p = this.store.project;
    const pts = [];
    for (const n of p.nodes) pts.push(n);
    for (const c of p.components) pts.push(c);
    for (const r of p.rooms) pts.push(...r.points);
    for (const m of p.measures || []) pts.push(...m.pts);
    if (p.background) pts.push({ x: p.background.x, y: p.background.y }, { x: p.background.x + p.background.width, y: p.background.y + p.background.height });
    if (!pts.length) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const pt of pts) { minX = Math.min(minX, pt.x); minY = Math.min(minY, pt.y); maxX = Math.max(maxX, pt.x); maxY = Math.max(maxY, pt.y); }
    return { minX, minY, maxX, maxY };
  }

  fit() {
    const v = this.view;
    const e = this.extent();
    const w = this.canvas.clientWidth || 800, h = this.canvas.clientHeight || 600;
    if (!e) {
      v.zoom = 1; v.offsetX = w / 2 - 400; v.offsetY = h / 2 - 300; this.changed(); return;
    }
    const pad = 70;
    const zoom = clamp(Math.min((w - pad * 2) / (e.maxX - e.minX || 1), (h - pad * 2) / (e.maxY - e.minY || 1)), 0.05, 3);
    v.zoom = zoom;
    v.offsetX = (w - (e.maxX - e.minX) * zoom) / 2 - e.minX * zoom;
    v.offsetY = (h - (e.maxY - e.minY) * zoom) / 2 - e.minY * zoom;
    this.changed();
  }

  changed() {
    this.store.persistSoon?.();
    this.scheduleDraw();
    this.hooks?.onView?.();
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

  // ---------------------------------------------------------------- hit test
  hit(world) {
    const p = this.store.project;
    const px = this.pxPerMeter();
    const z = this.zoom;
    const sel = this.store.selection;
    if (sel?.type === "component") {
      const c = p.components.find((x) => x.id === sel.id);
      if (c) {
        const hh = hitHandle(c, world, px, z);
        if (hh) return { type: "handle", id: c.id, handle: hh.handle };
      }
    }
    // smallest box first, so a grille on top of an AHU is still pickable
    const comps = [...p.components].sort((a, b) => (a.widthM * a.depthM) - (b.widthM * b.depthM));
    for (const c of comps) {
      const box = componentBox(c, px, z);
      const rot = (box.rot * Math.PI) / 180;
      const lx = (world.x - c.x) * Math.cos(-rot) - (world.y - c.y) * Math.sin(-rot);
      const ly = (world.x - c.x) * Math.sin(-rot) + (world.y - c.y) * Math.cos(-rot);
      if (Math.abs(lx) <= box.w / 2 && Math.abs(ly) <= box.d / 2) return { type: "component", id: c.id };
    }
    for (const n of p.nodes) {
      if (p.components.some((c) => componentNodeIds(c).includes(n.id))) continue;
      if (dist(n, world) <= 8 / z) return { type: "node", id: n.id };
    }
    for (const m of p.measures || []) {
      for (let i = 1; i < m.pts.length; i++) {
        if (pointSegment(world, m.pts[i - 1], m.pts[i]).distance <= 6 / z) return { type: "measure", id: m.id };
      }
    }
    let bestSeg = null;
    for (const s of p.segments) {
      const a = p.nodes.find((x) => x.id === s.a);
      const b = p.nodes.find((x) => x.id === s.b);
      if (!a || !b) continue;
      if (isVerticalRiser(a, b, px)) {
        if (dist(a, world) <= 11 / z) return { type: "segment", id: s.id };
        continue;
      }
      const tol = this.ductWidthWorld(this.segResult(s.id), s) / 2 + 5 / z;
      const r = pointSegment(world, a, b);
      if (r.distance <= tol && (!bestSeg || r.distance < bestSeg.d)) bestSeg = { d: r.distance, id: s.id };
    }
    if (bestSeg) return { type: "segment", id: bestSeg.id };
    // a room is picked by its outline or its name, not anywhere inside it —
    // inside is where a box is dragged to pick the grilles in the room
    for (let i = p.rooms.length - 1; i >= 0; i--) {
      const r = p.rooms[i];
      const pts = r.points || [];
      for (let k = 0; k < pts.length; k++) {
        if (pointSegment(world, pts[k], pts[(k + 1) % pts.length]).distance <= 6 / z) return { type: "room", id: r.id };
      }
      const c = polygonCentroid(pts);
      if (pts.length >= 3 && Math.abs(world.x - c.x) <= 50 / z && world.y >= c.y - 18 / z && world.y <= c.y + 16 / z) return { type: "room", id: r.id };
    }
    return null;
  }

  // ------------------------------------------------------------------ events
  _bind() {
    const c = this.canvas;
    c.addEventListener("pointerdown", (e) => this.onDown(e));
    c.addEventListener("pointermove", (e) => this.onMove(e));
    c.addEventListener("pointerup", (e) => this.onUp(e));
    c.addEventListener("pointercancel", (e) => { this.touches.delete(e.pointerId); this.dropPointerState(); });
    c.addEventListener("pointerleave", () => { if (!this.dragging && !this.pending) { this.pointer = null; this.scheduleDraw(); } });
    c.addEventListener("dblclick", (e) => this.onDblClick(e));
    c.addEventListener("contextmenu", (e) => { e.preventDefault(); if (this.draft || this.tapePts.length || this.roomPts.length) this.endDraft(); });
    c.addEventListener("wheel", (e) => {
      e.preventDefault();
      const f = Math.exp(-clamp(e.deltaY, -120, 120) * (e.ctrlKey ? 0.01 : 0.0018));
      this.setZoom(this.zoom * f, this.screenOf(e));
    }, { passive: false });
    // losing the window mid-drag must not leave the drag alive
    window.addEventListener("blur", () => this.dropPointerState());
  }

  dropPointerState() {
    if (this.dragging?.moved) this.store.commit();
    this.dragging = null;
    this.marquee = null;
    this.pending = null;
    this.pinch = null;
    this.canvas.classList.remove("down");
    this.scheduleDraw();
  }

  onDown(e) {
    if (e.pointerType === "touch") {
      this.touches.set(e.pointerId, this.screenOf(e));
      if (this.touches.size === 2) {
        // two fingers: pinch-zoom and pan, never a click
        const [a, b] = [...this.touches.values()];
        this.pending = null;
        this.dragging = null;
        this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: this.zoom, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, ox: this.view.offsetX, oy: this.view.offsetY };
        return;
      }
    }
    try { this.canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    const scr = this.screenOf(e);
    const world = this.toWorld(scr.x, scr.y);
    this.pointer = world;
    const tool = this.store.tool;
    const panNow = e.button === 1 || this.spaceDown || e.shiftKey && tool !== "select" || tool === "pan";
    if (panNow) {
      this.dragging = { pan: true, sx: e.clientX, sy: e.clientY, ox: this.view.offsetX, oy: this.view.offsetY };
      this.canvas.classList.add("down");
      return;
    }
    if (e.button !== 0) return;

    if (tool === "select") {
      const h = this.hit(world);
      if (h?.type === "handle") {
        const c = this.store.project.components.find((x) => x.id === h.id);
        this.dragging = { kind: "handle", id: h.id, handle: h.handle, moved: false, rot0: c.rot || 0, foot0: { w: c.widthM, d: c.depthM } };
        return;
      }
      if (h && e.shiftKey && h.type !== "piece") {
        // Shift-click adds one thing to the selection or takes it out
        this.store.toggleSelected(h.type, h.id);
        return;
      }
      if (h && this.store.selection?.type === "multi" && this.store.isSelected(h.type, h.id)) {
        // a press on something already picked moves the whole selection
        this.dragging = { kind: "group", last: world, moved: false, sx: scr.x, sy: scr.y };
        return;
      }
      if (h) {
        this.store.select(h.type, h.id);
        const p = this.store.project;
        if (h.type === "node") {
          const n = p.nodes.find((x) => x.id === h.id);
          this.dragging = { kind: "node", id: h.id, dx: world.x - n.x, dy: world.y - n.y, moved: false, sx: scr.x, sy: scr.y };
        } else if (h.type === "component") {
          const c = p.components.find((x) => x.id === h.id);
          this.dragging = { kind: "component", id: h.id, dx: world.x - c.x, dy: world.y - c.y, moved: false, sx: scr.x, sy: scr.y };
        } else if (h.type === "room") {
          const r = p.rooms.find((x) => x.id === h.id);
          this.dragging = { kind: "room", id: h.id, start: world, orig: r.points.map((pt) => ({ ...pt })), moved: false, sx: scr.x, sy: scr.y };
        }
        return;
      }
    }
    // everything else waits: a press that moves is a pan (with Select, a box
    // that picks everything in it), one that does not is a click
    this.pending = { sx: e.clientX, sy: e.clientY, ox: this.view.offsetX, oy: this.view.offsetY, world, shift: e.shiftKey, lasso: tool === "select" };
  }

  onMove(e) {
    if (e.pointerType === "touch" && this.touches.has(e.pointerId)) {
      this.touches.set(e.pointerId, this.screenOf(e));
      if (this.pinch && this.touches.size >= 2) {
        const [a, b] = [...this.touches.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const v = this.view;
        const anchor = { x: (this.pinch.mid.x - this.pinch.ox) / this.pinch.zoom, y: (this.pinch.mid.y - this.pinch.oy) / this.pinch.zoom };
        v.zoom = clamp(this.pinch.zoom * (d / Math.max(1, this.pinch.d)), 0.05, 40);
        v.offsetX = mid.x - anchor.x * v.zoom;
        v.offsetY = mid.y - anchor.y * v.zoom;
        this.changed();
        return;
      }
    }
    const world = this.eventWorld(e);
    this.pointer = world;
    const d = this.dragging;
    if (this.pending && Math.hypot(e.clientX - this.pending.sx, e.clientY - this.pending.sy) > CLICK_SLOP) {
      if (this.pending.lasso) {
        this.marquee = { a: this.pending.world, b: world, add: this.pending.shift };
        this.dragging = { kind: "marquee" };
        this.pending = null;
        this.scheduleDraw();
        return;
      }
      this.dragging = { pan: true, sx: this.pending.sx, sy: this.pending.sy, ox: this.pending.ox, oy: this.pending.oy };
      this.pending = null;
      this.canvas.classList.add("down");
    }
    if (this.dragging?.pan) {
      this.view.offsetX = this.dragging.ox + (e.clientX - this.dragging.sx);
      this.view.offsetY = this.dragging.oy + (e.clientY - this.dragging.sy);
      this.changed();
      return;
    }
    if (d && d.kind && !d.moved && d.sx != null) {
      const scr = this.screenOf(e);
      if (Math.hypot(scr.x - d.sx, scr.y - d.sy) < 3) return;
    }
    if (d?.kind === "marquee") {
      if (this.marquee) this.marquee.b = world;
      this.scheduleDraw();
      return;
    }
    if (d?.kind === "group") {
      if (!d.moved) { this.store.snapshot(); d.moved = true; }
      this.store.moveSelection(world.x - d.last.x, world.y - d.last.y);
      d.last = world;
      this.store.emitSoon();
      return;
    }
    if (d?.kind === "handle") {
      const c = this.store.project.components.find((x) => x.id === d.id);
      if (!c) return;
      if (!d.moved) { this.store.snapshot(); d.moved = true; }
      const px = this.pxPerMeter();
      if (d.handle.kind === "rot") {
        const a = Math.atan2(world.y - c.y, world.x - c.x) * 180 / Math.PI + 90;
        const rot = e.shiftKey ? Math.round(a) : Math.round(a / 15) * 15;
        this.store.resizeComponent(c, null, null, rot);
      } else {
        const rot = (d.rot0 * Math.PI) / 180;
        const lx = (world.x - c.x) * Math.cos(-rot) - (world.y - c.y) * Math.sin(-rot);
        const ly = (world.x - c.x) * Math.sin(-rot) + (world.y - c.y) * Math.cos(-rot);
        let w = Math.max(0.08, Math.abs(lx) * 2 / px);
        let dd = Math.max(0.08, Math.abs(ly) * 2 / px);
        if (e.shiftKey) {
          const r0 = (d.foot0.d || 1) / (d.foot0.w || 1);
          if (Math.abs(lx) / Math.max(d.foot0.w, 1e-6) > Math.abs(ly) / Math.max(d.foot0.d, 1e-6)) dd = w * r0;
          else w = dd / r0;
        }
        this.store.resizeComponent(c, Math.round(w * 1000) / 1000, Math.round(dd * 1000) / 1000, null);
      }
      this.store.emitSoon();
      return;
    }
    if (d?.kind === "node") {
      if (!d.moved) { this.store.snapshot(); d.moved = true; }
      const n = this.store.project.nodes.find((x) => x.id === d.id);
      if (n) { n.x = world.x - d.dx; n.y = world.y - d.dy; }
      this.store.emitSoon();
      return;
    }
    if (d?.kind === "component") {
      if (!d.moved) { this.store.snapshot(); d.moved = true; }
      const c = this.store.project.components.find((x) => x.id === d.id);
      const a = this.alignSnap({ x: world.x - d.dx, y: world.y - d.dy }, [d.id]);
      this.guides = a.guides;
      if (c) this.store.moveComponent(c, a.x, a.y);
      this.store.emitSoon();
      return;
    }
    if (d?.kind === "room") {
      if (!d.moved) { this.store.snapshot(); d.moved = true; }
      const r = this.store.project.rooms.find((x) => x.id === d.id);
      const ddx = world.x - d.start.x;
      const ddy = world.y - d.start.y;
      if (r) r.points = d.orig.map((pt) => ({ x: pt.x + ddx, y: pt.y + ddy }));
      this.store.emitSoon();
      return;
    }
    this.scheduleDraw();
    if (this.store.tool === "duct" || this.store.tool === "tape") this.hooks?.onHint?.();
  }

  onUp(e) {
    this.touches.delete(e.pointerId);
    if (this.pinch) {
      if (this.touches.size < 2) { this.pinch = null; this.store.persist(); }
      return;
    }
    this.canvas.classList.remove("down");
    const pend = this.pending;
    this.pending = null;
    if (this.dragging?.kind === "marquee") {
      const m = this.marquee;
      this.marquee = null;
      this.dragging = null;
      if (m) this.selectInBox(m.a, m.b, m.add);
      return;
    }
    this.guides = null;
    if (this.dragging?.moved) this.store.commit();
    else if (this.dragging?.pan) this.store.persist();
    const wasDrag = !!this.dragging;
    this.dragging = null;
    if (pend && !wasDrag) this.click(pend.world, pend);
  }

  // Everything inside the box: units by their centre, ducts with both ends
  // inside (a duct ending on a unit inside counts), rooms and tapes wholly
  // inside. With Shift the box adds to what is already picked.
  selectInBox(a, b, add = false) {
    const p = this.store.project;
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
    const inside = (q) => q && q.x >= x0 && q.x <= x1 && q.y >= y0 && q.y <= y1;
    const items = add ? this.store.selectedItems().filter((i) => i.type !== "piece") : [];
    const pickedComp = new Set();
    for (const c of p.components) if (inside(c)) { items.push({ type: "component", id: c.id }); for (const id of componentNodeIds(c)) pickedComp.add(id); }
    for (const s of p.segments) {
      const na = p.nodes.find((n) => n.id === s.a), nb = p.nodes.find((n) => n.id === s.b);
      const inA = inside(na) || pickedComp.has(s.a), inB = inside(nb) || pickedComp.has(s.b);
      if (inA && inB) items.push({ type: "segment", id: s.id });
    }
    for (const r of p.rooms) if (r.points.length && r.points.every(inside)) items.push({ type: "room", id: r.id });
    for (const m of p.measures || []) if (m.pts.every(inside)) items.push({ type: "measure", id: m.id });
    this.store.setSelection(items);
  }

  onDblClick(e) {
    const tool = this.store.tool;
    if (tool === "duct" && this.draft) { this.endDraft(); return; }
    if (tool === "room" && this.roomPts.length >= 3) { this.finishRoom(); return; }
    if (tool === "tape" && this.tapePts.length >= 2) { this.finishTape(); return; }
    // double-click empty paper zooms in on that spot (Shift zooms out)
    const scr = this.screenOf(e);
    const world = this.toWorld(scr.x, scr.y);
    if (tool === "select" && this.hit(world)) return;
    this.setZoom(this.zoom * (e.shiftKey ? 0.5 : 2), scr);
  }

  click(world, ev = {}) {
    const tool = this.store.tool;
    if (tool === "select") { if (!ev.shift) this.store.select(null); return; }
    if (tool === "duct") { this.traceClick(world); return; }
    if (tool === "room") {
      if (this.roomPts.length >= 3 && dist(world, this.roomPts[0]) < 10 / this.zoom) { this.finishRoom(); return; }
      const last = this.roomPts[this.roomPts.length - 1];
      this.roomPts.push(last && this.orthoOn() ? orthoPoint(last, world) : world);
      this.hooks?.onHint?.();
      this.scheduleDraw();
      return;
    }
    if (tool === "tape") {
      const last = this.tapePts[this.tapePts.length - 1];
      this.tapePts.push(last && this.orthoOn() ? orthoPoint(last, world) : world);
      this.hooks?.onHint?.();
      this.scheduleDraw();
      return;
    }
    if (tool === "scale") {
      this.scalePts.push(world);
      if (this.scalePts.length === 2) this.finishScale();
      this.hooks?.onHint?.();
      this.scheduleDraw();
      return;
    }
    if (tool === "component") this.placeComponent(world);
  }

  // -------------------------------------------------------------------- trace
  traceClick(world) {
    const store = this.store;
    const p = store.project;
    const equipment = hitComponentAt(p, world, { zoom: this.zoom });
    if (equipment && SYSTEM_KEYS.includes(equipment.component.system) && equipment.component.system !== store.activeSystem) {
      const wanted = systemInfo(equipment.component.system);
      toast(`${equipment.component.label || equipment.what} uses ${wanted.label} (${wanted.en}). Pick ${wanted.label} and trace from the matching unit connection.`);
      return;
    }
    const tgt = this.traceTarget(world);
    const last = this.draft ? p.nodes.find((n) => n.id === this.draft.lastNodeId) : null;

    // Same plan point at a different height: a riser, drawn as a marker on the
    // plan and as a vertical in 3D.
    if (last && !tgt.snap && dist(last, tgt) < 6 / this.zoom && Math.abs((last.z || 0) - store.traceHeight) > 0.05) {
      store.snapshot();
      const risen = { id: uid("n"), x: last.x, y: last.y, z: store.traceHeight };
      p.nodes.push(risen);
      store.addSegment(last, risen);
      this.draft = { lastNodeId: risen.id, lastOff: null, count: this.draft.count + 1 };
      store.commit();
      toast(`Riser to ${round(store.traceHeight, 2)} m`);
      return;
    }
    if (last && !tgt.snap && dist(last, tgt) < 3 / this.zoom) return; // a double tap on the same point

    store.snapshot();
    const { node, off, joined } = this.connect(tgt);
    if (!this.draft) {
      const anchored = p.components.some((c) => componentNodeIds(c).includes(node.id));
      if (!anchored && !joined) node.z = store.traceHeight;
      if (joined && !anchored && Number.isFinite(Number(node.z))) store.traceHeight = round(node.z, 2);
      this.draft = { lastNodeId: node.id, lastOff: off, count: 0 };
      store.commit();
      this.hooks?.onHint?.();
      return;
    }
    if (node.id === this.draft.lastNodeId) { store.commit(); return; }
    const a = p.nodes.find((n) => n.id === this.draft.lastNodeId);
    if (!Number.isFinite(Number(node.z))) node.z = store.traceHeight;
    const seg = store.addSegment(a, node);
    if (seg) { seg.aOff = this.draft.lastOff; seg.bOff = off; store.fitBranch(seg); }
    this.draft = { lastNodeId: node.id, lastOff: off, count: this.draft.count + 1 };
    if (joined) {
      // joined onto a unit or an existing run: that click finishes the run
      const what = tgt.snap?.kind === "component" ? (tgt.snap.name || tgt.snap.what) : "the run";
      this.draft = null;
      store.commit();
      toast(`Joined to ${what} — pencil dropped`);
      this.hooks?.onHint?.();
      return;
    }
    store.commit();
    this.hooks?.onHint?.();
  }

  connect(tgt) {
    const sn = tgt.snap;
    const store = this.store;
    if (sn?.kind === "run") {
      const j = store.splitSegmentAt(sn.seg, sn.at, sn.z);
      return { node: j, off: null, joined: true };
    }
    if (sn?.kind === "component" || sn?.kind === "node") {
      return { node: sn.node, off: sn.off || null, joined: true };
    }
    const n = { id: uid("n"), x: tgt.x, y: tgt.y, z: store.traceHeight };
    store.project.nodes.push(n);
    return { node: n, off: null, joined: false };
  }

  endDraft() {
    if (this.store.tool === "room" && this.roomPts.length >= 3) this.finishRoom();
    if (this.store.tool === "tape" && this.tapePts.length >= 2) this.finishTape();
    if (this.draft && this.draft.count === 0) {
      // a start point with nothing drawn from it is not worth keeping
      this.store.pruneOrphans();
      this.store.persist();
    }
    this.draft = null;
    this.roomPts = [];
    this.scalePts = [];
    this.tapePts = [];
    this.hooks?.onHint?.();
    this.store.emit();
  }

  // Line-up: a unit being placed or dragged pulls into line with the centre
  // of any other unit within a few pixels, across or down, and the guide is
  // drawn so it is obvious. Alt places it exactly where the cursor is.
  alignSnap(pt, excludeIds = []) {
    if (this.store.overrideKey) return { x: pt.x, y: pt.y, guides: [] };
    const tol = 8 / this.zoom;
    const others = this.store.project.components.filter((c) => !excludeIds.includes(c.id));
    let bx = null, by = null;
    for (const c of others) {
      const dx = Math.abs(c.x - pt.x), dy = Math.abs(c.y - pt.y);
      if (dx <= tol && (!bx || dx < bx.d)) bx = { d: dx, v: c.x };
      if (dy <= tol && (!by || dy < by.d)) by = { d: dy, v: c.y };
    }
    const x = bx ? bx.v : pt.x, y = by ? by.v : pt.y;
    const guides = [];
    if (bx) {
      const ys = others.filter((c) => Math.abs(c.x - x) < 1e-6).map((c) => c.y).concat(y);
      guides.push({ axis: "x", v: x, from: Math.min(...ys), to: Math.max(...ys) });
    }
    if (by) {
      const xs = others.filter((c) => Math.abs(c.y - y) < 1e-6).map((c) => c.x).concat(x);
      guides.push({ axis: "y", v: y, from: Math.min(...xs), to: Math.max(...xs) });
    }
    return { x, y, guides };
  }

  drawGuides(ctx, guides) {
    const z = this.zoom;
    if (!guides?.length) return;
    ctx.save();
    ctx.strokeStyle = "#db2777";
    ctx.lineWidth = 1.2 / z;
    ctx.setLineDash([6 / z, 4 / z]);
    const pad = 30 / z;
    for (const g of guides) {
      ctx.beginPath();
      if (g.axis === "x") { ctx.moveTo(g.v, g.from - pad); ctx.lineTo(g.v, g.to + pad); }
      else { ctx.moveTo(g.from - pad, g.v); ctx.lineTo(g.to + pad, g.v); }
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- placing
  placeComponent(world) {
    const store = this.store;
    const kind = store.newComponentKind;
    const def = componentDef(kind);
    if (!def) return;
    if (def.role !== "inline") {
      const a = this.alignSnap(world);
      world = { x: a.x, y: a.y };
    }
    store.snapshot();
    let c = null;
    if (def.role === "inline") {
      const hit = hitSegment(store.project, world, 12 / this.zoom);
      if (hit) c = store.placeOnRun(hit.seg, hit.r.point, kind);
    }
    if (!c) {
      let system = store.activeSystem;
      if (isDualPort(kind)) system = "both";
      c = store.addComponentAt(world, kind, system);
    }
    if (!c) { store.commit(); return; }
    // number it: AHU 1, HRV 2, Supply diffuser 3 ...
    const same = store.project.components.filter((x) => x.kind === kind).length;
    const stem = kind === "ahu" ? "AHU" : kind === "hrv" ? "HRV" : def.label;
    c.label = `${stem} ${same}`;
    store.select("component", c.id);
    store.commit();
    if (def.role === "inline" && c.nodeId && store.project.segments.some((s) => s.a === c.nodeId || s.b === c.nodeId)) {
      toast(`${def.label} placed on the run`);
    }
  }

  finishRoom() {
    if (this.roomPts.length >= 3) {
      this.store.snapshot();
      const r = this.store.addRoom(this.roomPts.map((pt) => ({ ...pt })));
      this.store.select("room", r.id);
      this.store.commit();
    }
    this.roomPts = [];
    this.hooks?.onHint?.();
    this.scheduleDraw();
  }

  finishTape() {
    if (this.tapePts.length >= 2) {
      this.store.snapshot();
      const m = this.store.addMeasure(this.tapePts);
      this.store.commit();
      toast(`Tape ${round(this.polyLengthM(m.pts), 2)} m on plan`);
    }
    this.tapePts = [];
    this.hooks?.onHint?.();
    this.scheduleDraw();
  }

  polyLengthM(pts) {
    let L = 0;
    for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]);
    return L / this.pxPerMeter();
  }

  async finishScale() {
    const [a, b] = this.scalePts;
    const px = dist(a, b);
    if (px < 4) { this.scalePts = []; return; }
    const val = await showPrompt({
      title: "Set the drawing scale",
      label: "Real distance between the two points (m)",
      type: "number",
      value: "",
      placeholder: "e.g. 6.0",
      okText: "Set scale",
      note: `The line is ${Math.round(px)} px on the sheet. Every length after this comes off the drawing, so use the longest dimension you can find.`,
    });
    if (val && Number(val) > 0) {
      this.store.snapshot();
      this.store.project.scale.pxPerMeter = px / Number(val);
      this.store.project.scale.calib = { a, b, meters: Number(val) };
      this.store.commit();
      toast(`Scale set — ${round(px / Number(val), 1)} px per metre`);
      this.hooks?.onScaleSet?.();
    }
    this.scalePts = [];
    this.store.setTool("select");
  }

  // --------------------------------------------------------------- the hint
  angleNow() {
    const p = this.store.project;
    let from = null;
    if (this.store.tool === "duct" && this.draft) from = p.nodes.find((n) => n.id === this.draft.lastNodeId);
    if (this.store.tool === "tape" && this.tapePts.length) from = this.tapePts[this.tapePts.length - 1];
    if (!from || !this.pointer) return null;
    const to = this.store.tool === "duct" ? this.traceTarget(this.pointer) : (this.orthoOn() ? orthoPoint(from, this.pointer) : this.pointer);
    if (dist(from, to) < 2 / this.zoom) return null;
    let a = (Math.atan2(-(to.y - from.y), to.x - from.x) * 180) / Math.PI;
    if (a < 0) a += 360;
    const lenM = dist(from, to) / this.pxPerMeter();
    const rel = to.lock?.rel ? to.lock.rel.deg : null;
    return { deg: a, free: Math.abs(a / 45 - Math.round(a / 45)) > 0.02 && !rel, lenM, rel };
  }

  // -------------------------------------------------------------- rendering
  scheduleDraw() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this.draw(); });
  }

  draw() {
    const ctx = this.ctx;
    const p = this.store.project;
    const v = this.view;
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = COL.paper;
    ctx.fillRect(0, 0, W, H);
    ctx.translate(v.offsetX, v.offsetY);
    ctx.scale(v.zoom, v.zoom);
    try {
      this.loadBackground();
      if (this._bg && p.background && p.mode !== "concept") {
        ctx.fillStyle = "#fff";
        ctx.fillRect(p.background.x, p.background.y, p.background.width, p.background.height);
        ctx.globalAlpha = this.store.dimDrawing ? 0.35 : (p.background.opacity ?? 0.9);
        ctx.drawImage(this._bg, p.background.x, p.background.y, p.background.width, p.background.height);
        ctx.globalAlpha = 1;
      } else {
        this.drawGrid(ctx);
      }
      this.drawRooms(ctx);
      this.drawSegments(ctx);
      this.drawNodes(ctx);
      this.drawComponents(ctx);
      this.drawMeasures(ctx);
      this.drawDrafts(ctx);
    } catch (err) {
      // a bad point must never freeze the plan silently
      console.error(err);
      if (!this._renderFailed) { this._renderFailed = true; toast("Something on the plan could not be drawn — Ctrl+Z steps back"); }
    }
    ctx.restore();
  }

  drawGrid(ctx) {
    const v = this.view;
    const px = this.pxPerMeter();
    let step = px; // one metre
    while (step * v.zoom < 14) step *= 5;
    const w = this.canvas.clientWidth / v.zoom;
    const h = this.canvas.clientHeight / v.zoom;
    const ox = -v.offsetX / v.zoom;
    const oy = -v.offsetY / v.zoom;
    ctx.lineWidth = 1 / v.zoom;
    ctx.strokeStyle = "rgba(29,36,51,0.07)";
    ctx.beginPath();
    for (let x = Math.floor(ox / step) * step; x < ox + w; x += step) { ctx.moveTo(x, oy); ctx.lineTo(x, oy + h); }
    for (let y = Math.floor(oy / step) * step; y < oy + h; y += step) { ctx.moveTo(ox, y); ctx.lineTo(ox + w, y); }
    ctx.stroke();
    const big = step * 5;
    ctx.strokeStyle = "rgba(29,36,51,0.11)";
    ctx.beginPath();
    for (let x = Math.floor(ox / big) * big; x < ox + w; x += big) { ctx.moveTo(x, oy); ctx.lineTo(x, oy + h); }
    for (let y = Math.floor(oy / big) * big; y < oy + h; y += big) { ctx.moveTo(ox, y); ctx.lineTo(ox + w, y); }
    ctx.stroke();
  }

  chip(ctx, text, x, y, opts = {}) {
    const z = this.zoom;
    ctx.font = `${opts.bold ? 600 : 500} ${(opts.size || 10.5) / z}px ${opts.mono ? MONO : FONT}`;
    const w = ctx.measureText(text).width + 8 / z;
    const hgt = (opts.size || 10.5) * 1.45 / z;
    ctx.fillStyle = opts.bg || "rgba(255,255,255,0.92)";
    ctx.fillRect(x - w / 2, y - hgt / 2, w, hgt);
    if (opts.border) { ctx.strokeStyle = opts.border; ctx.lineWidth = 1 / z; ctx.strokeRect(x - w / 2, y - hgt / 2, w, hgt); }
    ctx.fillStyle = opts.color || COL.ink;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x, y + 0.5 / z);
    ctx.textBaseline = "alphabetic";
  }

  drawRooms(ctx) {
    const p = this.store.project;
    const z = this.zoom;
    for (const r of p.rooms) {
      ctx.beginPath();
      r.points.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)));
      ctx.closePath();
      const selected = this.store.isSelected("room", r.id);
      ctx.fillStyle = selected ? "rgba(224,164,34,0.12)" : "rgba(29,78,216,0.04)";
      ctx.fill();
      ctx.lineWidth = (selected ? 2 : 1.2) / z;
      ctx.strokeStyle = selected ? COL.sel : "rgba(29,36,51,0.45)";
      ctx.setLineDash([6 / z, 4 / z]);
      ctx.stroke();
      ctx.setLineDash([]);
      const c = polygonCentroid(r.points);
      ctx.fillStyle = COL.ink;
      ctx.font = `700 ${12.5 / z}px ${FONT}`;
      ctx.textAlign = "center";
      ctx.fillText(r.name, c.x, c.y - 4 / z);
      const unit = normalizeFlowUnit(p.settings.flowUnit);
      const parts = [];
      if (r.supplyFlow_ls) parts.push(`S ${formatFlowLs(r.supplyFlow_ls, unit)}`);
      if (r.extractFlow_ls) parts.push(`E ${formatFlowLs(r.extractFlow_ls, unit)}`);
      if (parts.length) {
        ctx.fillStyle = COL.soft;
        ctx.font = `500 ${10.5 / z}px ${MONO}`;
        ctx.fillText(parts.join("  ·  "), c.x, c.y + 11 / z);
      }
    }
  }

  segResult(id) { return findSegResult(this.results, id); }
  isIndexSeg(id) { return isIndexSegment(this.results, id); }

  ductWidthWorld(res, seg) {
    const px = this.pxPerMeter();
    const z = this.zoom;
    const show = this.store.showDuctSize !== false && this.store.project.settings.showActualDucts !== false;
    const section = res?.section;
    let mm = 200;
    if (section) {
      if (section.shape === "rect" || section.shape === "square") mm = section.widthMm || section.heightMm || 200;
      else mm = section.diameterMm || section.equivDiameterMm || 200;
    }
    const real = (mm / 1000) * px;
    if (show && res && res.flowM3s > 0) return clamp(real, 3 / z, 400);
    return 3 / z;
  }

  drawSegments(ctx) {
    const p = this.store.project;
    const sel = this.store.selection;
    const z = this.zoom;
    const px = this.pxPerMeter();
    const hidden = this.store.hiddenSystems;
    // bodies first, then labels over every body, so a label is never under a duct
    const labels = [];
    for (const s of p.segments) {
      if (hidden?.has(s.system)) continue;
      const a = p.nodes.find((n) => n.id === s.a);
      const b = p.nodes.find((n) => n.id === s.b);
      if (!a || !b) continue;
      const res = this.segResult(s.id);
      const selected = this.store.isSelected("segment", s.id)
        || (sel?.type === "piece" && this.store.getSelected()?.segmentId === s.id);
      const base = systemColor(s.system);
      const noFlow = !res || res.flowM3s <= 0;
      const shape = res?.section?.shape || s.shapeOverride || p.settings.ductType || "round";
      if (isVerticalRiser(a, b, px)) { this.drawRiserMarker(ctx, a, b, s, selected); continue; }
      const width = this.ductWidthWorld(res, s);
      this.drawDuctBody(ctx, a, b, width, shape, base, { selected, index: this.isIndexSeg(s.id), noFlow, overVel: res && res.withinMax === false });
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const segLenScr = dist(a, b) * z;
      labels.push({ s, res, mx, my, a, b, width, segLenScr, noFlow });
    }
    for (const L of labels) {
      const { res, mx, my, a, b, width, segLenScr, noFlow } = L;
      const off = width / 2 + 10 / z;
      const horiz = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
      const lx = horiz ? mx : mx + off + 18 / z;
      const ly = horiz ? my - off : my;
      if (!noFlow && segLenScr > 46) {
        const size = (res.section.shape === "rect" || res.section.shape === "square") ? `${res.section.widthMm}×${res.section.heightMm}` : `ø${res.section.diameterMm}`;
        this.chip(ctx, `${size} · ${round(res.velocity, 1)} m/s`, lx, ly, { mono: true, color: res.withinVelocity ? COL.ink : "#b42318", border: "rgba(29,36,51,0.15)" });
        if (res.lengthOverride) this.chip(ctx, `${round(res.lengthM, 2)} m typed`, lx, ly + 14 / z, { size: 9.5, bg: "#fff4e0", color: "#8a5d00" });
      } else if (noFlow && segLenScr > 60) {
        this.chip(ctx, noFlowHint(L.s, res, p), lx, ly, { size: 9.5, bg: "#fff4e0", color: "#8a5d00" });
      }
      const picked = this.store.selection?.type === "segment" && this.store.selection.id === L.s.id;
      if (picked && Math.abs((a.z || 0) - (b.z || 0)) > 0.05) {
        this.chip(ctx, `slope Δh ${round(Math.abs((a.z || 0) - (b.z || 0)), 2)} m`, mx, my + off + 4 / z, { size: 9, color: COL.soft });
      }
    }
  }

  drawDuctBody(ctx, a, b, width, shape, color, flags) {
    const z = this.zoom;
    const outline = flags.selected ? COL.sel : flags.index ? COL.index : null;
    if (outline) {
      ctx.strokeStyle = outline;
      ctx.lineWidth = width + (flags.selected ? 7 : 3) / z;
      ctx.lineCap = shape === "round" ? "round" : "butt";
      ctx.globalAlpha = flags.selected ? 0.9 : 0.28;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (flags.noFlow) ctx.setLineDash([9 / z, 6 / z]);
    ctx.strokeStyle = flags.overVel ? "#b42318" : color;
    ctx.globalAlpha = flags.noFlow ? 0.6 : 1;
    ctx.lineWidth = width;
    ctx.lineCap = shape === "round" ? "round" : "butt";
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    if (width > 7 / z) {
      if (shape === "round") {
        // spiral: a light centre stripe reads as a round duct
        ctx.strokeStyle = "rgba(255,255,255,0.35)";
        ctx.lineWidth = Math.max(1 / z, width * 0.14);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      } else {
        // rectangular: both sides as crisp edges
        const l = offsetPoly([a, b], width / 2), r = offsetPoly([a, b], -width / 2);
        ctx.strokeStyle = "rgba(0,0,0,0.35)";
        ctx.lineWidth = 1 / z;
        ctx.beginPath(); ctx.moveTo(l[0].x, l[0].y); ctx.lineTo(l[1].x, l[1].y); ctx.moveTo(r[0].x, r[0].y); ctx.lineTo(r[1].x, r[1].y); ctx.stroke();
      }
    }
  }

  drawRiserMarker(ctx, a, b, seg, selected) {
    const z = this.zoom;
    const dz = (b.z || 0) - (a.z || 0);
    const x = a.x, y = a.y, r = 9 / z;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.lineWidth = 2 / z;
    ctx.strokeStyle = selected ? COL.sel : systemColor(seg.system);
    ctx.stroke();
    ctx.beginPath();
    const s = dz >= 0 ? -1 : 1;
    ctx.moveTo(x, y - 4 * s / z); ctx.lineTo(x, y + 4 * s / z);
    ctx.moveTo(x - 3 / z, y + 1 * s / z); ctx.lineTo(x, y + 4 * s / z); ctx.lineTo(x + 3 / z, y + 1 * s / z);
    ctx.stroke();
    this.chip(ctx, `riser ${round(Math.abs(dz), 2)} m`, x, y + 19 / z, { size: 9.5, mono: true });
  }

  drawNodes(ctx) {
    const p = this.store.project;
    const z = this.zoom;
    const sel = this.store.selection;
    for (const n of p.nodes) {
      if (p.components.some((c) => componentNodeIds(c).includes(n.id))) continue;
      const selected = this.store.isSelected("node", n.id);
      const touching = p.segments.filter((s) => s.a === n.id || s.b === n.id);
      if (touching.length === 2 && !n.tee && !selected) continue; // a plain corner
      const sys = touching[0]?.system;
      ctx.beginPath();
      if (n.tee || touching.length >= 3) {
        ctx.arc(n.x, n.y, 4 / z, 0, Math.PI * 2);
        ctx.fillStyle = "#fff";
        ctx.fill();
        ctx.lineWidth = 2 / z;
        ctx.strokeStyle = selected ? COL.sel : systemColor(sys);
        ctx.stroke();
      } else if (touching.length <= 1) {
        // an open end — worth seeing, it usually means a run that stops short
        ctx.arc(n.x, n.y, (selected ? 5 : 4) / z, 0, Math.PI * 2);
        ctx.fillStyle = selected ? COL.sel : "#fff";
        ctx.fill();
        ctx.lineWidth = 1.6 / z;
        ctx.strokeStyle = touching.length ? "#b42318" : COL.soft;
        ctx.stroke();
      } else {
        ctx.arc(n.x, n.y, 5 / z, 0, Math.PI * 2);
        ctx.fillStyle = COL.sel;
        ctx.fill();
      }
    }
  }

  drawComponents(ctx) {
    const p = this.store.project;
    const sel = this.store.selection;
    const z = this.zoom;
    const px = this.pxPerMeter();
    const hidden = this.store.hiddenSystems;
    for (const c of p.components) {
      const def = componentDef(c.kind);
      if (!def) continue;
      if (c.system !== "both" && hidden?.has(c.system)) continue;
      const selected = this.store.isSelected("component", c.id);
      const box = componentBox(c, px, z);
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate((box.rot * Math.PI) / 180);
      this.roundRect(ctx, -box.w / 2, -box.d / 2, box.w, box.d, Math.min(4 / z, Math.min(box.w, box.d) * 0.12));
      ctx.fillStyle = def.color;
      ctx.fill();
      if (isFourPort(c)) {
        ctx.save();
        ctx.clip();
        // building side and outside of the casing, lightly tinted
        ctx.fillStyle = "rgba(255,255,255,0.10)";
        ctx.fillRect(0, -box.d / 2, box.w / 2, box.d);
        if (c.kind === "hrv") {
          // the cross of a plate heat exchanger
          ctx.strokeStyle = "rgba(255,255,255,0.45)";
          ctx.lineWidth = 1.2 / z;
          ctx.beginPath();
          ctx.moveTo(-box.w * 0.25, -box.d / 2); ctx.lineTo(box.w * 0.25, box.d / 2);
          ctx.moveTo(box.w * 0.25, -box.d / 2); ctx.lineTo(-box.w * 0.25, box.d / 2);
          ctx.stroke();
        }
        ctx.restore();
      }
      ctx.lineWidth = (selected ? 2.6 : 1.2) / z;
      ctx.strokeStyle = selected ? COL.sel : "rgba(0,0,0,0.45)";
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.font = `700 ${clamp(Math.min(box.w, box.d) * 0.3, 8 / z, 15 / z)}px ${FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.rotate(-(box.rot * Math.PI) / 180); // turn the symbol, never the text
      ctx.fillText(symbolOf(c), 0, 0);
      ctx.restore();
      ctx.textBaseline = "alphabetic";

      const bottom = c.y + Math.max(box.w, box.d) / 2;
      ctx.fillStyle = COL.ink;
      ctx.font = `600 ${11 / z}px ${FONT}`;
      ctx.textAlign = "center";
      ctx.fillText(c.label || def.label, c.x, bottom + 12 / z);
      const bits = [];
      const unit = normalizeFlowUnit(p.settings.flowUnit);
      if (def.role === "terminal" && c.props?.designFlow_ls) bits.push(formatFlowLs(c.props.designFlow_ls, unit));
      if (def.role === "inline" && c.props?.lossPa) bits.push(`${c.props.lossPa} Pa`);
      bits.push(`${round(Number(c.heightM) || 0, 2)} m`);
      ctx.fillStyle = COL.soft;
      ctx.font = `500 ${9.5 / z}px ${MONO}`;
      ctx.fillText(bits.join(" · "), c.x, bottom + 23 / z);
      if (isFourPort(c)) this.drawUnitPorts(ctx, c, z);
      if (selected && this.store.selection?.type === "component") this.drawHandles(ctx, c);
    }
  }

  // The four connections of an AHU or HRV serving both sides: a coloured
  // stub and its code at each port, so it is obvious where fresh air comes
  // in, where exhaust leaves, and which face is the building side.
  drawUnitPorts(ctx, c, z) {
    const px = this.pxPerMeter();
    const drawn = componentBox(c, px, z);
    const rot = ((Number(c.rot) || 0) * Math.PI) / 180;
    for (const key of SYSTEM_KEYS) {
      const off = unitPortOffset(c, key);
      if (!off) continue;
      // exactly where a trace joins — the true casing, not the grown one
      const { x, y } = connPoint(c, off, px);
      const col = systemColor(key);
      ctx.beginPath();
      ctx.arc(x, y, 4.2 / z, 0, Math.PI * 2);
      ctx.fillStyle = "#fff"; ctx.fill();
      ctx.lineWidth = 2.2 / z; ctx.strokeStyle = col; ctx.stroke();
      if (z * drawn.w > 44) {
        // label outside the casing, in the direction of the face
        let dx = off.u, dy = off.v;
        if (Math.abs(off.u) === 1) dy = 0; else dx = 0;
        const ox = (dx * Math.cos(rot) - dy * Math.sin(rot)) * 17 / z;
        const oy = (dx * Math.sin(rot) + dy * Math.cos(rot)) * 12 / z;
        // IN on the internal face, EX on the external; the colour says which airstream
        this.chip(ctx, systemInfo(key).outside ? "EX" : "IN", x + ox, y + oy, { size: 8.5, mono: true, bold: true, bg: col, color: "#fff" });
      }
    }
  }

  drawHandles(ctx, c) {
    const z = this.zoom;
    const { handles, box } = handlesOf(c, this.pxPerMeter(), z);
    const rot = handles[handles.length - 1];
    ctx.strokeStyle = COL.sel;
    ctx.lineWidth = 1.4 / z;
    ctx.beginPath(); ctx.moveTo(rot.arm.x, rot.arm.y); ctx.lineTo(rot.x, rot.y); ctx.stroke();
    for (const h of handles) {
      if (h.kind === "rot") {
        ctx.beginPath(); ctx.arc(h.x, h.y, HANDLE_PX / z, 0, Math.PI * 2);
        ctx.fillStyle = COL.sel; ctx.fill();
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.4 / z; ctx.stroke();
      } else {
        const s = (HANDLE_PX * 2) / z;
        ctx.fillStyle = "#fff"; ctx.strokeStyle = COL.sel; ctx.lineWidth = 1.6 / z;
        ctx.fillRect(h.x - s / 2, h.y - s / 2, s, s); ctx.strokeRect(h.x - s / 2, h.y - s / 2, s, s);
      }
    }
    const t = `${round(box.foot.w, 2)} × ${round(box.foot.d, 2)} m${box.rot ? `  ${round(box.rot, 1)}°` : ""}`;
    this.chip(ctx, t, c.x, c.y - Math.max(box.w, box.d) / 2 - 36 / z, { mono: true, bg: COL.sel, color: "#241a00", size: 9.5 });
  }

  drawMeasures(ctx) {
    const p = this.store.project;
    const z = this.zoom;
    for (const m of p.measures || []) {
      const selected = this.store.isSelected("measure", m.id);
      this.drawTapeLine(ctx, m.pts, selected);
    }
  }

  drawTapeLine(ctx, pts, selected) {
    const z = this.zoom;
    if (pts.length < 2) return;
    ctx.strokeStyle = selected ? COL.sel : COL.tape;
    ctx.lineWidth = (selected ? 2.4 : 1.6) / z;
    ctx.setLineDash([7 / z, 4 / z]);
    ctx.beginPath();
    pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.stroke();
    ctx.setLineDash([]);
    for (const q of pts) {
      ctx.beginPath(); ctx.moveTo(q.x - 4 / z, q.y - 4 / z); ctx.lineTo(q.x + 4 / z, q.y + 4 / z);
      ctx.moveTo(q.x + 4 / z, q.y - 4 / z); ctx.lineTo(q.x - 4 / z, q.y + 4 / z); ctx.stroke();
    }
    const last = pts[pts.length - 1];
    this.chip(ctx, `${round(this.polyLengthM(pts), 2)} m`, last.x, last.y - 14 / z, { mono: true, bold: true, bg: "#fff4e0", color: "#8a5d00", border: COL.tape });
  }

  // The duct being left, extended through the corner, and a right-angle
  // mark or a 45° arc where the new leg comes off it.
  drawAngleGuide(ctx, a, tgt, rel) {
    const z = this.zoom;
    const L = 140 / z;
    const ux = Math.cos(rel.ref), uy = Math.sin(rel.ref);
    ctx.save();
    ctx.strokeStyle = COL.accent;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 1.2 / z;
    ctx.setLineDash([4 / z, 4 / z]);
    ctx.beginPath(); ctx.moveTo(a.x - ux * L, a.y - uy * L); ctx.lineTo(a.x + ux * L, a.y + uy * L); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    const leg = Math.atan2(tgt.y - a.y, tgt.x - a.x);
    // the side of the duct line the leg is on
    let base = rel.ref;
    let d = leg - base;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    if (Math.abs(d) > Math.PI / 2 + 1e-6) { base += Math.PI; d = d > 0 ? d - Math.PI : d + Math.PI; }
    const r = 16 / z;
    ctx.lineWidth = 1.6 / z;
    if (rel.deg === 90) {
      const vx = Math.cos(leg), vy = Math.sin(leg);
      const bx = Math.cos(base), by = Math.sin(base);
      ctx.beginPath();
      ctx.moveTo(a.x + bx * r, a.y + by * r);
      ctx.lineTo(a.x + bx * r + vx * r, a.y + by * r + vy * r);
      ctx.lineTo(a.x + vx * r, a.y + vy * r);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(a.x, a.y, r * 1.4, base, base + d, d < 0);
      ctx.stroke();
    }
    ctx.restore();
    const mid = leg + (rel.deg === 90 ? 0 : 0);
    this.chip(ctx, `${rel.deg}° to duct`, a.x + Math.cos(mid) * 38 / z + Math.cos(mid + Math.PI / 2) * 14 / z, a.y + Math.sin(mid) * 38 / z + Math.sin(mid + Math.PI / 2) * 14 / z, { bg: COL.accent, color: "#fff", bold: true, size: 9.5 });
  }

  drawDrafts(ctx) {
    const z = this.zoom;
    const p = this.store.project;
    const tool = this.store.tool;
    if (this.marquee) {
      const { a, b } = this.marquee;
      ctx.save();
      ctx.fillStyle = "rgba(29,78,216,0.08)";
      ctx.strokeStyle = COL.accent;
      ctx.lineWidth = 1.2 / z;
      ctx.setLineDash([5 / z, 4 / z]);
      ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      ctx.restore();
    }
    if (tool === "duct" && this.pointer && !this.dragging) {
      const tgt = this.traceTarget(this.pointer);
      const col = systemColor(this.store.activeSystem);
      if (this.draft) {
        const a = p.nodes.find((n) => n.id === this.draft.lastNodeId);
        if (a) {
          ctx.setLineDash([7 / z, 5 / z]);
          ctx.strokeStyle = col; ctx.lineWidth = 2.4 / z;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(tgt.x, tgt.y); ctx.stroke();
          ctx.setLineDash([]);
          ctx.beginPath(); ctx.arc(a.x, a.y, 4 / z, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
          if (tgt.lock?.rel && dist(a, tgt) * z > 12) this.drawAngleGuide(ctx, a, tgt, tgt.lock.rel);
          if (!tgt.snap && Math.abs((a.z || 0) - this.store.traceHeight) > 0.05 && dist(a, tgt) < 8 / z) {
            this.chip(ctx, `riser → ${round(this.store.traceHeight, 2)} m`, a.x, a.y - 16 / z, { bg: col, color: "#fff", bold: true });
          } else if (dist(a, tgt) * z > 30) {
            const L = dist(a, tgt) / this.pxPerMeter();
            this.chip(ctx, `${round(L, 2)} m`, (a.x + tgt.x) / 2, (a.y + tgt.y) / 2 - 12 / z, { mono: true, size: 9.5 });
          }
        }
      }
      this.drawSnapGhost(ctx, tgt.snap, col);
      if (!tgt.snap) {
        ctx.beginPath(); ctx.arc(tgt.x, tgt.y, 3 / z, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
      }
    }
    if (tool === "room" && this.roomPts.length) {
      ctx.beginPath();
      this.roomPts.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)));
      if (this.pointer) {
        const last = this.roomPts[this.roomPts.length - 1];
        const q = this.orthoOn() ? orthoPoint(last, this.pointer) : this.pointer;
        ctx.lineTo(q.x, q.y);
      }
      ctx.strokeStyle = COL.accent; ctx.lineWidth = 1.6 / z; ctx.setLineDash([5 / z, 4 / z]);
      ctx.stroke(); ctx.setLineDash([]);
      for (const pt of this.roomPts) { ctx.beginPath(); ctx.arc(pt.x, pt.y, 3.5 / z, 0, Math.PI * 2); ctx.fillStyle = COL.accent; ctx.fill(); }
    }
    if (tool === "tape" && this.tapePts.length) {
      const pts = [...this.tapePts];
      if (this.pointer) {
        const last = pts[pts.length - 1];
        pts.push(this.orthoOn() ? orthoPoint(last, this.pointer) : this.pointer);
      }
      this.drawTapeLine(ctx, pts, false);
    }
    if (tool === "scale") {
      const pts = [...this.scalePts];
      if (pts.length === 1 && this.pointer) pts.push(this.pointer);
      ctx.strokeStyle = COL.tape; ctx.lineWidth = 2 / z;
      if (pts.length === 2) { ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); ctx.lineTo(pts[1].x, pts[1].y); ctx.stroke(); }
      for (const pt of pts) {
        ctx.beginPath(); ctx.moveTo(pt.x - 7 / z, pt.y); ctx.lineTo(pt.x + 7 / z, pt.y); ctx.moveTo(pt.x, pt.y - 7 / z); ctx.lineTo(pt.x, pt.y + 7 / z); ctx.stroke();
      }
    }
    if (this.guides?.length) this.drawGuides(ctx, this.guides);
    if (tool === "component" && this.pointer && !this.dragging) {
      const def = componentDef(this.store.newComponentKind);
      if (def && def.role !== "inline") {
        // where it would land, lined up
        const a = this.alignSnap(this.pointer);
        this.drawGuides(ctx, a.guides);
        const px = this.pxPerMeter();
        const w = Math.max((def.foot?.w || 0.4) * px, 10 / z), h = Math.max((def.foot?.d || 0.4) * px, 10 / z);
        ctx.save();
        ctx.strokeStyle = def.color; ctx.lineWidth = 1.4 / z; ctx.setLineDash([4 / z, 3 / z]);
        ctx.strokeRect(a.x - w / 2, a.y - h / 2, w, h);
        ctx.restore();
      }
      if (def?.role === "inline") {
        const hit = hitSegment(p, this.pointer, 12 / z);
        if (hit) {
          ctx.beginPath(); ctx.arc(hit.r.point.x, hit.r.point.y, 7 / z, 0, Math.PI * 2);
          ctx.fillStyle = "#fff"; ctx.fill(); ctx.strokeStyle = COL.accent; ctx.lineWidth = 2.2 / z; ctx.stroke();
          this.chip(ctx, `${def.label} on this run`, hit.r.point.x, hit.r.point.y - 16 / z, { bg: COL.accent, color: "#fff", bold: true });
        }
      }
    }
    const cal = p.scale.calib;
    if (cal && tool === "scale") {
      ctx.strokeStyle = "rgba(217,119,6,0.45)"; ctx.lineWidth = 1.5 / z; ctx.setLineDash([4 / z, 3 / z]);
      ctx.beginPath(); ctx.moveTo(cal.a.x, cal.a.y); ctx.lineTo(cal.b.x, cal.b.y); ctx.stroke(); ctx.setLineDash([]);
    }
  }

  drawSnapGhost(ctx, sn, col) {
    if (!sn) return;
    const z = this.zoom;
    if (sn.kind === "run") {
      // the branch dot, on the pipe
      ctx.beginPath(); ctx.arc(sn.at.x, sn.at.y, 6 / z, 0, Math.PI * 2);
      ctx.fillStyle = "#fff"; ctx.fill();
      ctx.lineWidth = 2.4 / z; ctx.strokeStyle = col; ctx.stroke();
      ctx.beginPath(); ctx.arc(sn.at.x, sn.at.y, 2.2 / z, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
    } else {
      ctx.beginPath(); ctx.arc(sn.at.x, sn.at.y, 11 / z, 0, Math.PI * 2);
      ctx.strokeStyle = col; ctx.lineWidth = 2.4 / z; ctx.stroke();
      ctx.beginPath(); ctx.arc(sn.at.x, sn.at.y, 3 / z, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
    }
    const verb = this.draft ? "join" : "start at";
    const t = `${verb} ${sn.name ? sn.name : sn.what}`;
    ctx.font = `600 ${10.5 / z}px ${FONT}`;
    const w = ctx.measureText(t).width + 12 / z;
    ctx.fillStyle = col;
    ctx.fillRect(sn.at.x + 15 / z, sn.at.y - 9 / z, w, 17 / z);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(t, sn.at.x + 21 / z, sn.at.y);
    ctx.textBaseline = "alphabetic";
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
