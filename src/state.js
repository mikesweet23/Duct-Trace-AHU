// Central application state: the project model, selection, active tool, undo
// history, and persistence. A tiny pub/sub lets the UI re-render on change.

import { dist } from "./geom.js";
import { defaultProps, componentDef, isDualPort } from "./standards/components.js";
import { connPoint, defaultFootprint, defaultHeightM, portOffset, pxPerMeterOf } from "./layout.js";
import { heightAlong } from "./snap.js";
import { normalizeFlowUnit } from "./units.js";
import { RECOMMENDED_VELOCITY } from "./standards/dw144.js";
import { applyConstruction, setSegmentConstruction } from "./construction.js";

const STORAGE_KEY = "duct-trace-ahu:project";
const NODE_MERGE_TOL = 8; // px in world space — tight, so close parallel ducts stay apart
const Z_MERGE_TOL = 0.05; // m — stacked riser nodes must not collapse

let idCounter = 1;
export function uid(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;
}

export function defaultSettings() {
  return {
    sizingMethod: "friction", // "friction" | "velocity"
    targetGradient: 1.0, // Pa/m
    ductType: "round", // "round" | "rect" | "square"
    rectHeight: 300, // mm
    maxAspect: 4,
    roughnessMm: 0.15,
    supplyTempC: 18,
    extractTempC: 22,
    velocityCaps: {
      main: RECOMMENDED_VELOCITY.main.max,
      riser: RECOMMENDED_VELOCITY.riser.max,
      branch: RECOMMENDED_VELOCITY.branch.max,
      runout: RECOMMENDED_VELOCITY.runout.max,
    },
    velocityMins: {
      main: RECOMMENDED_VELOCITY.main.min,
      riser: RECOMMENDED_VELOCITY.riser.min,
      branch: RECOMMENDED_VELOCITY.branch.min,
      runout: RECOMMENDED_VELOCITY.runout.min,
    },
    conceptPxPerMeter: 50,
    flowUnit: "l/s",
    snapPoints: true,
    ortho: true,
    showActualDucts: true,
    defaultDuctHeight: 3.2,
    defaultAhuHeight: 0.3,
    defaultTerminalHeight: 2.7,
    standardStraightLengthM: 3.0,
    maxTransitionAngleDeg: 15,
    defaultConstructionRound: "spiral",
    defaultConstructionRect: "rectangular",
    elevationMode: "orthogonal",
    defaultOffsetStyle: "offset_2x45",
    takeoffMode: "cut_lengths",
    estimateSupports: true,
    supportSpacingCircularM: 3.0,
    supportSpacingRectM: 2.4,
    defaultInsulation: { type: "", thicknessMm: 0, cladding: "" },
    insulationBySystem: {
      supply: { type: "", thicknessMm: 0, cladding: "" },
      extract: { type: "", thicknessMm: 0, cladding: "" },
    },
  };
}

export function newProject(name = "Untitled project") {
  return {
    meta: { name, createdAt: Date.now(), app: "duct-trace-ahu", version: 2 },
    mode: "concept", // "concept" | "drawing"
    scale: { pxPerMeter: null, calib: null },
    background: null, // { dataUrl, width, height, x, y, scale }
    view: { offsetX: 0, offsetY: 0, zoom: 1 },
    settings: defaultSettings(),
    nodes: [],
    segments: [],
    components: [],
    rooms: [],
    measures: [], // tape measures: [{ id, pts: [{x,y}] }] — plan metres only, never a duct
    physical: null,
    engineeringLocked: false,
  };
}

function serveSystem(c, systemType) {
  return c.system === systemType || c.system === "both";
}

function migratePlantFlow(props) {
  if (!props || typeof props !== "object") return props;
  const next = { ...props };
  if (next.designFlow_ls == null && next.designFlow != null) {
    const v = Number(next.designFlow);
    if (v > 0) next.designFlow_ls = Math.round(v * 1000);
    else next.designFlow_ls = 0;
  }
  delete next.designFlow;
  if (next.extractFlow_ls == null) next.extractFlow_ls = 0;
  if (next.extractStaticPa == null) {
    const supplyPa = Number(next.availableStaticPa) || Number(next.supplyStaticPa) || 0;
    next.extractStaticPa = supplyPa;
  }
  return next;
}

export function migrateProject(raw) {
  const p = { ...newProject(), ...raw };
  const defaults = defaultSettings();
  p.settings = { ...defaults, ...(p.settings || {}) };
  p.settings.velocityCaps = { ...defaults.velocityCaps, ...(p.settings.velocityCaps || {}) };
  p.settings.velocityMins = { ...defaults.velocityMins, ...(p.settings.velocityMins || {}) };
  p.settings.flowUnit = normalizeFlowUnit(p.settings.flowUnit);
  p.meta = { ...p.meta, version: 4 };
  p.physical = raw.physical || null;
  p.measures = Array.isArray(raw.measures) ? raw.measures.filter((m) => Array.isArray(m?.pts) && m.pts.length >= 2) : [];
  p.engineeringLocked = !!raw.engineeringLocked;
  const settings = p.settings;
  settings.insulationBySystem = {
    supply: { type: "", thicknessMm: 0, cladding: "", ...(defaults.insulationBySystem.supply), ...(p.settings.insulationBySystem?.supply || {}) },
    extract: { type: "", thicknessMm: 0, cladding: "", ...(defaults.insulationBySystem.extract), ...(p.settings.insulationBySystem?.extract || {}) },
  };
  settings.defaultInsulation = { type: "", thicknessMm: 0, cladding: "", ...defaults.defaultInsulation, ...(p.settings.defaultInsulation || {}) };
  for (const n of p.nodes) {
    if (!Number.isFinite(Number(n.z))) n.z = settings.defaultDuctHeight;
  }
  for (const c of p.components) {
    const foot = defaultFootprint(c.kind);
    if (!(Number(c.widthM) > 0)) c.widthM = foot.w;
    if (!(Number(c.depthM) > 0)) c.depthM = foot.d;
    if (!Number.isFinite(Number(c.rot))) c.rot = 0;
    if (!Number.isFinite(Number(c.heightM))) c.heightM = defaultHeightM(c.kind, settings);
    const n = p.nodes.find((x) => x.id === c.nodeId);
    if (n && !Number.isFinite(Number(n.z))) n.z = c.heightM;
    if (componentDef(c.kind)?.role === "plant") c.props = migratePlantFlow(c.props);
    if (c.system === "both" && isDualPort(c.kind) && !c.returnNodeId) {
      const off = portOffset("extract");
      const at = connPoint(c, off, pxPerMeterOf(p));
      const rn = { id: uid("n"), x: at.x, y: at.y, z: c.heightM };
      p.nodes.push(rn);
      c.returnNodeId = rn.id;
      const supplyAt = connPoint(c, portOffset("supply"), pxPerMeterOf(p));
      if (n) { n.x = supplyAt.x; n.y = supplyAt.y; n.z = c.heightM; }
    }
  }
  return p;
}

export class Store {
  constructor() {
    this.project = newProject();
    this.selection = null; // { type, id }
    this.tool = "select";
    this.activeSystem = "supply"; // for new ducts/components
    this.newComponentKind = null; // when tool === "component"
    this.traceHeight = this.project.settings.defaultDuctHeight;
    this.overrideKey = false; // Alt: ignore snap-to-existing / flip ortho
    this.viewMode = "plan"; // "plan" | "3d"
    this.visualMode = "centreline"; // centreline | simple3d | fabrication | transparent | airflow | velocity | pressure | installation
    this.exploded = false;
    this.hiddenSystems = new Set();
    this.takeoffFilters = { scope: "project", system: "", ahu: "", floor: "", zone: "", branch: "", size: "", type: "", area: "" };
    this.listeners = new Set();
    this.undoStack = [];
    this.redoStack = [];
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn(this);
  }

  snapshot() {
    this.undoStack.push(JSON.stringify(this.project));
    if (this.undoStack.length > 60) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(JSON.stringify(this.project));
    this.project = migrateProject(JSON.parse(this.undoStack.pop()));
    this.selection = null;
    this.persist();
    this.emit();
  }

  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(JSON.stringify(this.project));
    this.project = migrateProject(JSON.parse(this.redoStack.pop()));
    this.selection = null;
    this.persist();
    this.emit();
  }

  commit() {
    this.persist();
    this.emit();
  }

  // Continuous changes (a drag, a pan) redraw once per frame, not once per
  // pointer event — every emit re-solves the network.
  emitSoon() {
    if (this._emitRaf) return;
    const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (f) => setTimeout(f, 16);
    this._emitRaf = raf(() => { this._emitRaf = 0; this.emit(); });
  }

  persistSoon() {
    clearTimeout(this._persistT);
    this._persistT = setTimeout(() => this.persist(), 400);
  }

  // The take-off is written every time; the drawing only when it changes,
  // under its own key, because it is by far the biggest part and a sheet too
  // big for the store must not stop the take-off being kept.
  persist() {
    try {
      const bg = this.project.background;
      const lite = bg ? { ...this.project, background: { ...bg, dataUrl: null, stored: true } } : this.project;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(lite));
      const token = bg ? `${bg.dataUrl?.length || 0}:${bg.width}x${bg.height}` : "";
      if (token !== this._bgToken) {
        this._bgToken = token;
        try {
          if (bg?.dataUrl) localStorage.setItem(STORAGE_KEY + ":drawing", bg.dataUrl);
          else localStorage.removeItem(STORAGE_KEY + ":drawing");
          this.drawingNotStored = false;
        } catch (e) {
          this.drawingNotStored = true;
          try { localStorage.removeItem(STORAGE_KEY + ":drawing"); } catch (_) { /* ignore */ }
        }
      }
    } catch (e) {
      /* storage may be unavailable */
    }
  }

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (data.background && !data.background.dataUrl) {
          const img = localStorage.getItem(STORAGE_KEY + ":drawing");
          if (img) data.background.dataUrl = img;
          else data.background = null;
        }
        if (data.background) delete data.background.stored;
        this.project = migrateProject(data);
        this.traceHeight = this.project.settings.defaultDuctHeight;
        const bg = this.project.background;
        this._bgToken = bg ? `${bg.dataUrl?.length || 0}:${bg.width}x${bg.height}` : "";
        return true;
      }
    } catch (e) {
      /* ignore */
    }
    return false;
  }

  setTool(tool, kind = null) {
    this.tool = tool;
    this.newComponentKind = kind;
    this.emit();
  }

  select(type, id) {
    this.selection = type ? { type, id } : null;
    this.emit();
  }

  setTraceHeight(z) {
    const v = Number(z);
    if (!Number.isFinite(v)) return;
    this.traceHeight = v;
    this.emit();
  }

  // ---- Geometry mutation ------------------------------------------------

  findNodeAt(point, tol = NODE_MERGE_TOL, z = null) {
    let best = null;
    let bestD = tol;
    for (const n of this.project.nodes) {
      if (z != null && Math.abs((n.z || 0) - z) > Z_MERGE_TOL) continue;
      const d = dist(n, point);
      if (d <= bestD) {
        best = n;
        bestD = d;
      }
    }
    return best;
  }

  findOrCreateNode(point, z = this.traceHeight) {
    const existing = this.findNodeAt(point, NODE_MERGE_TOL, z);
    if (existing) return existing;
    const n = { id: uid("n"), x: point.x, y: point.y, z };
    this.project.nodes.push(n);
    return n;
  }

  addSegment(aNode, bNode, system = this.activeSystem, extra = {}) {
    if (aNode.id === bNode.id) return null;
    const fittings = extra.fittings || [];
    const atJunction = this.project.segments.filter((s) => s.a === aNode.id || s.b === aNode.id || s.a === bNode.id || s.b === bNode.id).length >= 2;
    if (atJunction && !fittings.some((f) => f.type === "tee_branch" || f.type === "tee_straight")) {
      fittings.push({ type: "tee_branch", qty: 1 });
    }
    const seg = {
      id: uid("s"),
      a: aNode.id,
      b: bNode.id,
      system,
      shapeOverride: extra.shapeOverride ?? null,
      sizeOverride: extra.sizeOverride ?? null,
      flowOverride: extra.flowOverride ?? null,
      roleOverride: extra.roleOverride ?? null,
      engineeringLengthM: extra.engineeringLengthM ?? null,
      constructionType: extra.constructionType ?? null,
      insulationOverride: extra.insulationOverride ?? null,
      standardLengthM: extra.standardLengthM ?? null,
      floor: extra.floor ?? "",
      zone: extra.zone ?? "",
      area: extra.area ?? "",
      aOff: extra.aOff ?? null,
      bOff: extra.bOff ?? null,
      fittings,
    };
    this.project.segments.push(seg);
    return seg;
  }

  syncComponentPorts(c) {
    const px = pxPerMeterOf(this.project);
    const supplyOff = c.system === "both" && isDualPort(c.kind) ? portOffset("supply") : null;
    const extractOff = c.system === "both" && isDualPort(c.kind) ? portOffset("extract") : null;
    const n = this.project.nodes.find((x) => x.id === c.nodeId);
    if (n) {
      const at = connPoint(c, supplyOff, px);
      n.x = at.x;
      n.y = at.y;
      n.z = Number.isFinite(Number(c.heightM)) ? c.heightM : n.z;
    }
    if (c.system === "both" && isDualPort(c.kind)) {
      if (!c.returnNodeId) {
        const at = connPoint(c, extractOff, px);
        const rn = { id: uid("n"), x: at.x, y: at.y, z: c.heightM ?? this.project.settings.defaultAhuHeight };
        this.project.nodes.push(rn);
        c.returnNodeId = rn.id;
      } else {
        const rn = this.project.nodes.find((x) => x.id === c.returnNodeId);
        if (rn) {
          const at = connPoint(c, extractOff, px);
          rn.x = at.x;
          rn.y = at.y;
          rn.z = Number.isFinite(Number(c.heightM)) ? c.heightM : rn.z;
        }
      }
    }
  }

  addComponentAt(point, kind, system = this.activeSystem) {
    const def = componentDef(kind);
    if (!def) return null;
    const foot = defaultFootprint(kind);
    const heightM = defaultHeightM(kind, this.project.settings);
    if (def.role === "terminal" && (kind === "grille_extract" || kind === "valve_extract")) {
      system = "extract";
    }
    const c = {
      id: uid("c"),
      kind,
      nodeId: null,
      returnNodeId: null,
      system: isDualPort(kind) && system === "both" ? "both" : system,
      x: point.x,
      y: point.y,
      widthM: foot.w,
      depthM: foot.d,
      rot: 0,
      heightM,
      props: defaultProps(kind),
    };
    const n = this.findOrCreateNode(point, heightM);
    c.nodeId = n.id;
    n.z = heightM;
    this.project.components.push(c);
    this.syncComponentPorts(c);
    return c;
  }

  addComponentAtNode(node, kind, system = this.activeSystem) {
    return this.addComponentAt({ x: node.x, y: node.y }, kind, system);
  }

  moveComponent(c, x, y) {
    c.x = x;
    c.y = y;
    this.syncComponentPorts(c);
  }

  resizeComponent(c, widthM, depthM, rot) {
    if (widthM != null) c.widthM = Math.max(0.08, widthM);
    if (depthM != null) c.depthM = Math.max(0.08, depthM);
    if (rot != null) c.rot = ((rot % 360) + 360) % 360;
    this.syncComponentPorts(c);
  }

  setComponentSystem(c, system) {
    c.system = system;
    if (isDualPort(c.kind) && system === "both") {
      this.syncComponentPorts(c);
    } else if (c.returnNodeId && system !== "both") {
      const rid = c.returnNodeId;
      c.returnNodeId = null;
      const stillUsed = this.project.segments.some((s) => s.a === rid || s.b === rid);
      if (!stillUsed) this.project.nodes = this.project.nodes.filter((n) => n.id !== rid);
      this.syncComponentPorts(c);
    } else {
      this.syncComponentPorts(c);
    }
  }

  addRoom(points) {
    const room = {
      id: uid("r"),
      name: `Room ${this.project.rooms.length + 1}`,
      points,
      supplyFlow_ls: 0,
      extractFlow_ls: 0,
    };
    this.project.rooms.push(room);
    return room;
  }

  addMeasure(pts) {
    const m = { id: uid("m"), pts: pts.map((q) => ({ x: q.x, y: q.y })) };
    this.project.measures.push(m);
    return m;
  }

  // An in-line device (damper, attenuator, heater...) dropped on a duct sits
  // on the duct: the run is cut there and the device takes the joint, so its
  // loss is on the path it was placed on rather than on a loose node beside it.
  placeOnRun(seg, point, kind) {
    const j = this.splitSegmentAt(seg, point);
    if (!j) return null;
    j.tee = false;
    for (const s of this.project.segments) {
      if (s.a === j.id || s.b === j.id) s.fittings = (s.fittings || []).filter((f) => f.type !== "tee_straight");
    }
    const def = componentDef(kind);
    const foot = defaultFootprint(kind);
    const c = {
      id: uid("c"),
      kind,
      nodeId: j.id,
      returnNodeId: null,
      system: seg.system,
      x: j.x,
      y: j.y,
      widthM: foot.w,
      depthM: foot.d,
      rot: 0,
      heightM: j.z,
      props: defaultProps(kind),
    };
    const a = this.project.nodes.find((n) => n.id === seg.a);
    if (a) c.rot = Math.round((Math.atan2(j.y - a.y, j.x - a.x) * 180) / Math.PI);
    if (!def) return null;
    this.project.components.push(c);
    return c;
  }

  splitSegmentAt(seg, point, z) {
    const a = this.project.nodes.find((n) => n.id === seg.a);
    const b = this.project.nodes.find((n) => n.id === seg.b);
    if (!a || !b) return null;
    const t = dist(a, b) < 1e-6 ? 0 : dist(a, point) / dist(a, b);
    const jz = z != null ? z : heightAlong(a, b, t);
    const j = { id: uid("n"), x: point.x, y: point.y, z: jz, tee: true };
    this.project.nodes.push(j);
    const other = {
      id: uid("s"),
      a: j.id,
      b: seg.b,
      system: seg.system,
      shapeOverride: seg.shapeOverride,
      sizeOverride: seg.sizeOverride ? { ...seg.sizeOverride } : null,
      flowOverride: null,
      roleOverride: seg.roleOverride,
      engineeringLengthM: null,
      constructionType: seg.constructionType || null,
      insulationOverride: seg.insulationOverride ? { ...seg.insulationOverride } : null,
      standardLengthM: seg.standardLengthM || null,
      floor: seg.floor || "",
      zone: seg.zone || "",
      area: seg.area || "",
      aOff: null,
      bOff: seg.bOff || null,
      fittings: (seg.fittings || []).filter((f) => f.type !== "tee_branch").map((f) => ({ ...f })),
    };
    other.fittings.push({ type: "tee_straight", qty: 1 });
    seg.b = j.id;
    seg.bOff = null;
    seg.fittings = (seg.fittings || []).filter((f) => f.type !== "tee_branch");
    seg.fittings.push({ type: "tee_straight", qty: 1 });
    this.project.segments.push(other);
    return j;
  }

  duplicateComponent(c, offsetM = null) {
    const def = componentDef(c.kind);
    if (!def) return null;
    const px = pxPerMeterOf(this.project);
    const dx = offsetM != null ? offsetM * px : Math.max(c.widthM || 0.6, 0.6) * px * 1.25;
    const copy = {
      id: uid("c"),
      kind: c.kind,
      nodeId: null,
      returnNodeId: null,
      system: c.system,
      x: c.x + dx,
      y: c.y,
      widthM: c.widthM,
      depthM: c.depthM,
      rot: c.rot,
      heightM: c.heightM,
      label: c.label ? `${c.label} copy` : "",
      props: JSON.parse(JSON.stringify(c.props || {})),
    };
    const n = this.findOrCreateNode({ x: copy.x, y: copy.y }, copy.heightM);
    copy.nodeId = n.id;
    n.z = copy.heightM;
    this.project.components.push(copy);
    this.syncComponentPorts(copy);
    return copy;
  }

  setNodeHeight(node, z) {
    node.z = Number(z) || 0;
    const c = this.project.components.find((x) => x.nodeId === node.id || x.returnNodeId === node.id);
    if (c) c.heightM = node.z;
  }

  levelRunFrom(nodeId, z) {
    const seen = new Set([nodeId]);
    const q = [nodeId];
    while (q.length) {
      const id = q.shift();
      const n = this.project.nodes.find((x) => x.id === id);
      if (n) n.z = z;
      for (const s of this.project.segments) {
        const other = s.a === id ? s.b : s.b === id ? s.a : null;
        if (other && !seen.has(other)) {
          seen.add(other);
          q.push(other);
        }
      }
    }
    for (const c of this.project.components) {
      if (seen.has(c.nodeId) || seen.has(c.returnNodeId)) c.heightM = z;
    }
  }

  deleteSelection() {
    const sel = this.selection;
    if (!sel) return;
    this.snapshot();
    const p = this.project;
    if (sel.type === "segment") {
      p.segments = p.segments.filter((s) => s.id !== sel.id);
    } else if (sel.type === "component") {
      const c = p.components.find((x) => x.id === sel.id);
      p.components = p.components.filter((x) => x.id !== sel.id);
      if (c && p.physical?.pieces) {
        p.physical.pieces = p.physical.pieces.filter((piece) => {
          if (piece.sourceKey === `damper:${c.id}` || piece.sourceKey === `flex:${c.nodeId}`) return false;
          return true;
        });
      }
    } else if (sel.type === "piece") {
      const piece = (p.physical?.pieces || []).find((x) => x.ref === sel.id || x.sourceKey === sel.id);
      if (piece?.kind === "damper" && piece.sourceKey?.startsWith("damper:")) {
        const cid = piece.sourceKey.slice("damper:".length);
        p.components = p.components.filter((x) => x.id !== cid);
      }
      if (p.physical?.pieces) {
        p.physical.pieces = p.physical.pieces.filter((x) => x.ref !== sel.id && x.sourceKey !== sel.id);
      }
    } else if (sel.type === "room") {
      p.rooms = p.rooms.filter((r) => r.id !== sel.id);
    } else if (sel.type === "measure") {
      p.measures = (p.measures || []).filter((m) => m.id !== sel.id);
    } else if (sel.type === "node") {
      p.nodes = p.nodes.filter((n) => n.id !== sel.id);
      p.segments = p.segments.filter((s) => s.a !== sel.id && s.b !== sel.id);
      p.components = p.components.filter((c) => c.nodeId !== sel.id && c.returnNodeId !== sel.id);
    }
    this.pruneOrphans();
    this.selection = null;
    this.commit();
  }

  pruneOrphans() {
    const used = new Set();
    for (const s of this.project.segments) {
      used.add(s.a);
      used.add(s.b);
    }
    for (const c of this.project.components) {
      used.add(c.nodeId);
      if (c.returnNodeId) used.add(c.returnNodeId);
    }
    this.project.nodes = this.project.nodes.filter((n) => used.has(n.id));
  }

  getSelected() {
    const sel = this.selection;
    if (!sel) return null;
    const p = this.project;
    if (sel.type === "segment") return p.segments.find((s) => s.id === sel.id);
    if (sel.type === "component") return p.components.find((c) => c.id === sel.id);
    if (sel.type === "room") return p.rooms.find((r) => r.id === sel.id);
    if (sel.type === "measure") return (p.measures || []).find((m) => m.id === sel.id);
    if (sel.type === "node") return p.nodes.find((n) => n.id === sel.id);
    if (sel.type === "piece") return (p.physical?.pieces || []).find((x) => x.ref === sel.id || x.sourceKey === sel.id);
    return null;
  }

  setEngineeringLength(seg, lengthM) {
    const v = lengthM == null || lengthM === "" ? null : Number(lengthM);
    seg.engineeringLengthM = Number.isFinite(v) && v > 0 ? v : null;
  }

  setSegmentConstruction(seg, constructionKey) {
    setSegmentConstruction(seg, constructionKey, this.project.settings);
  }

  applyConstruction(seg, constructionKey, scope = "section") {
    return applyConstruction(this.project, seg, constructionKey, scope);
  }

  lockSegmentSize(seg, section) {
    if (!section) return;
    if (section.shape === "rect" || section.shape === "square") {
      seg.sizeOverride = { widthMm: section.widthMm, heightMm: section.heightMm };
      if (!seg.shapeOverride) seg.shapeOverride = section.shape;
    } else {
      seg.sizeOverride = { diameterMm: section.diameterMm };
      if (!seg.shapeOverride) seg.shapeOverride = section.shape || "round";
    }
  }

  setPhysicalModel(model) {
    this.project.physical = model;
  }

  exportJSON() {
    return JSON.stringify(this.project, null, 2);
  }

  importJSON(text) {
    const data = JSON.parse(text);
    this.snapshot();
    this.project = migrateProject(data);
    this.selection = null;
    this.commit();
  }

  reset() {
    this.snapshot();
    this.project = newProject();
    this.selection = null;
    this.traceHeight = this.project.settings.defaultDuctHeight;
    this.commit();
  }
}

export { serveSystem };

// A representative worked example so the tool is useful immediately and easy
// to demonstrate. A combined supply+return AHU feeds a trunk that splits to
// four rooms, with a riser on one extract run.
export function seedDemo(store) {
  store.snapshot();
  const p = newProject("Demo — Office floor (supply + extract)");
  p.mode = "concept";
  p.scale = { pxPerMeter: 40, calib: null };
  p.settings = defaultSettings();
  p.settings.ductType = "round";

  const mk = (id, x, y, z = 3.2) => ({ id, x, y, z });
  const nodes = [
    mk("nAHU", 220, 380, 0.3),
    mk("nAHUr", 20, 380, 0.3),
    mk("nT1", 320, 380, 3.2),
    mk("nT2", 560, 380, 3.2),
    mk("nB1", 320, 200, 2.7),
    mk("nB2", 560, 200, 2.7),
    mk("nB3", 560, 560, 2.7),
    mk("nB4", 800, 380, 2.7),
    mk("nRise", 20, 380, 3.2),
    mk("nE1", 400, 700, 3.2),
    mk("nE2", 400, 560, 2.7),
    mk("nE3", 680, 700, 2.7),
  ];
  p.nodes = nodes;

  const seg = (id, a, b, system, fittings = [], extra = {}) => ({
    id, a, b, system, shapeOverride: null, sizeOverride: null,
    flowOverride: null, roleOverride: null, aOff: null, bOff: null, fittings,
    engineeringLengthM: extra.engineeringLengthM ?? null,
    constructionType: extra.constructionType ?? null,
    insulationOverride: null, standardLengthM: null,
    floor: extra.floor || "", zone: extra.zone || "", area: extra.area || "",
  });
  p.segments = [
    seg("sT0", "nAHU", "nT1", "supply", [{ type: "bend90_radius", qty: 1 }]),
    seg("sT1", "nT1", "nT2", "supply", [], { engineeringLengthM: 17.5, zone: "East", floor: "L2" }),
    seg("sB1", "nT1", "nB1", "supply", [{ type: "tee_branch", qty: 1 }]),
    seg("sB2", "nT2", "nB2", "supply", [{ type: "tee_branch", qty: 1 }]),
    seg("sB3", "nT2", "nB3", "supply", [{ type: "tee_branch", qty: 1 }]),
    seg("sB4", "nT2", "nB4", "supply"),
    seg("sRise", "nAHUr", "nRise", "extract"),
    seg("sE0", "nRise", "nE1", "extract", [{ type: "bend90_radius", qty: 1 }]),
    seg("sE1", "nE1", "nE2", "extract", [{ type: "tee_branch", qty: 1 }]),
    seg("sE2", "nE1", "nE3", "extract"),
  ];

  const comp = (id, kind, nodeId, system, x, y, props = {}, extra = {}) => {
    const foot = defaultFootprint(kind);
    return {
      id, kind, nodeId, system, x, y,
      returnNodeId: extra.returnNodeId || null,
      widthM: extra.widthM ?? foot.w,
      depthM: extra.depthM ?? foot.d,
      rot: extra.rot ?? 0,
      heightM: extra.heightM ?? defaultHeightM(kind, p.settings),
      props: { ...defaultProps(kind), ...props },
    };
  };
  p.components = [
    comp("cAHU", "ahu", "nAHU", "both", 120, 380, {
      availableStaticPa: 350,
      extractStaticPa: 280,
      designFlow_ls: 480,
      extractFlow_ls: 420,
      supplyTempC: 18,
    }, { returnNodeId: "nAHUr", widthM: 2.4, depthM: 1.4, heightM: 0.3 }),
    comp("cFD", "fire_damper", "nT1", "supply", 320, 380, { lossPa: 15 }, { heightM: 3.2 }),
    comp("cD1", "diffuser", "nB1", "supply", 320, 200, { designFlow_ls: 120, terminalLossPa: 25 }, { heightM: 2.7 }),
    comp("cD2", "diffuser", "nB2", "supply", 560, 200, { designFlow_ls: 120, terminalLossPa: 25 }, { heightM: 2.7 }),
    comp("cD3", "diffuser", "nB3", "supply", 560, 560, { designFlow_ls: 90, terminalLossPa: 25 }, { heightM: 2.7 }),
    comp("cD4", "diffuser", "nB4", "supply", 800, 380, { designFlow_ls: 150, terminalLossPa: 25 }, { heightM: 2.7 }),
    comp("cE2", "grille_extract", "nE2", "extract", 400, 560, { designFlow_ls: 200, terminalLossPa: 20 }, { heightM: 2.7 }),
    comp("cE3", "grille_extract", "nE3", "extract", 680, 700, { designFlow_ls: 220, terminalLossPa: 20 }, { heightM: 2.7 }),
  ];

  p.rooms = [
    { id: "rm1", name: "Office A", points: [{ x: 260, y: 120 }, { x: 480, y: 120 }, { x: 480, y: 300 }, { x: 260, y: 300 }], supplyFlow_ls: 120, extractFlow_ls: 100 },
    { id: "rm2", name: "Office B", points: [{ x: 500, y: 120 }, { x: 720, y: 120 }, { x: 720, y: 300 }, { x: 500, y: 300 }], supplyFlow_ls: 120, extractFlow_ls: 0 },
    { id: "rm3", name: "Meeting", points: [{ x: 500, y: 500 }, { x: 760, y: 500 }, { x: 760, y: 640 }, { x: 500, y: 640 }], supplyFlow_ls: 90, extractFlow_ls: 120 },
  ];

  store.project = p;
  store.selection = null;
  store.traceHeight = p.settings.defaultDuctHeight;
  const ahu = p.components.find((c) => c.kind === "ahu");
  if (ahu) store.syncComponentPorts(ahu);
  const ret = p.nodes.find((n) => n.id === "nAHUr");
  const rise = p.nodes.find((n) => n.id === "nRise");
  if (ret && rise) { rise.x = ret.x; rise.y = ret.y; }
  store.commit();
}
