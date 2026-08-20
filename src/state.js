// Central application state: the project model, selection, active tool, undo
// history, and persistence. A tiny pub/sub lets the UI re-render on change.

import { dist } from "./geom.js";
import { defaultProps, componentDef } from "./standards/components.js";

const STORAGE_KEY = "duct-trace-ahu:project";
const NODE_MERGE_TOL = 12; // px in world space

let idCounter = 1;
export function uid(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;
}

export function defaultSettings() {
  return {
    sizingMethod: "friction", // "friction" | "velocity"
    targetGradient: 1.0, // Pa/m
    ductType: "round", // "round" | "rect"
    rectHeight: 300, // mm
    maxAspect: 4,
    roughnessMm: 0.15,
    supplyTempC: 18,
    extractTempC: 22,
    velocityCaps: { main: 7.0, branch: 5.0, runout: 3.5 },
    conceptPxPerMeter: 50,
    flowUnit: "l/s",
  };
}

export function newProject(name = "Untitled project") {
  return {
    meta: { name, createdAt: Date.now(), app: "duct-trace-ahu", version: 1 },
    mode: "concept", // "concept" | "drawing"
    scale: { pxPerMeter: null, calib: null },
    background: null, // { dataUrl, width, height, x, y, scale }
    view: { offsetX: 0, offsetY: 0, zoom: 1 },
    settings: defaultSettings(),
    nodes: [],
    segments: [],
    components: [],
    rooms: [],
  };
}

export class Store {
  constructor() {
    this.project = newProject();
    this.selection = null; // { type, id }
    this.tool = "select";
    this.activeSystem = "supply"; // for new ducts/components
    this.newComponentKind = null; // when tool === "component"
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
    this.project = JSON.parse(this.undoStack.pop());
    this.selection = null;
    this.persist();
    this.emit();
  }

  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(JSON.stringify(this.project));
    this.project = JSON.parse(this.redoStack.pop());
    this.selection = null;
    this.persist();
    this.emit();
  }

  commit() {
    this.persist();
    this.emit();
  }

  persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.project));
    } catch (e) {
      /* storage may be unavailable */
    }
  }

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        this.project = { ...newProject(), ...JSON.parse(raw) };
        this.project.settings = { ...defaultSettings(), ...(this.project.settings || {}) };
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

  // ---- Geometry mutation ------------------------------------------------

  findNodeAt(point, tol = NODE_MERGE_TOL) {
    let best = null;
    let bestD = tol;
    for (const n of this.project.nodes) {
      const d = dist(n, point);
      if (d <= bestD) {
        best = n;
        bestD = d;
      }
    }
    return best;
  }

  findOrCreateNode(point) {
    const existing = this.findNodeAt(point);
    if (existing) return existing;
    const n = { id: uid("n"), x: point.x, y: point.y };
    this.project.nodes.push(n);
    return n;
  }

  addSegment(aNode, bNode, system = this.activeSystem) {
    if (aNode.id === bNode.id) return null;
    const seg = {
      id: uid("s"),
      a: aNode.id,
      b: bNode.id,
      system,
      shapeOverride: null,
      sizeOverride: null,
      flowOverride: null,
      roleOverride: null,
      fittings: [],
    };
    this.project.segments.push(seg);
    return seg;
  }

  addComponentAtNode(node, kind, system = this.activeSystem) {
    const def = componentDef(kind);
    if (!def) return null;
    const c = {
      id: uid("c"),
      kind,
      nodeId: node.id,
      system,
      x: node.x,
      y: node.y,
      props: defaultProps(kind),
    };
    this.project.components.push(c);
    return c;
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

  deleteSelection() {
    const sel = this.selection;
    if (!sel) return;
    this.snapshot();
    const p = this.project;
    if (sel.type === "segment") {
      p.segments = p.segments.filter((s) => s.id !== sel.id);
    } else if (sel.type === "component") {
      p.components = p.components.filter((c) => c.id !== sel.id);
    } else if (sel.type === "room") {
      p.rooms = p.rooms.filter((r) => r.id !== sel.id);
    } else if (sel.type === "node") {
      p.nodes = p.nodes.filter((n) => n.id !== sel.id);
      p.segments = p.segments.filter((s) => s.a !== sel.id && s.b !== sel.id);
      p.components = p.components.filter((c) => c.nodeId !== sel.id);
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
    for (const c of this.project.components) used.add(c.nodeId);
    this.project.nodes = this.project.nodes.filter((n) => used.has(n.id));
  }

  getSelected() {
    const sel = this.selection;
    if (!sel) return null;
    const p = this.project;
    if (sel.type === "segment") return p.segments.find((s) => s.id === sel.id);
    if (sel.type === "component") return p.components.find((c) => c.id === sel.id);
    if (sel.type === "room") return p.rooms.find((r) => r.id === sel.id);
    if (sel.type === "node") return p.nodes.find((n) => n.id === sel.id);
    return null;
  }

  exportJSON() {
    return JSON.stringify(this.project, null, 2);
  }

  importJSON(text) {
    const data = JSON.parse(text);
    this.snapshot();
    this.project = { ...newProject(), ...data };
    this.project.settings = { ...defaultSettings(), ...(this.project.settings || {}) };
    this.selection = null;
    this.commit();
  }

  reset() {
    this.snapshot();
    this.project = newProject();
    this.selection = null;
    this.commit();
  }
}

// A representative worked example so the tool is useful immediately and easy
// to demonstrate. A supply AHU feeds a trunk that splits to four rooms.
export function seedDemo(store) {
  store.snapshot();
  const p = newProject("Demo — Office floor (supply + extract)");
  p.mode = "concept";
  p.scale = { pxPerMeter: 40, calib: null };
  p.settings = defaultSettings();
  p.settings.ductType = "round";

  const mk = (id, x, y) => ({ id, x, y });
  const nodes = [
    mk("nAHU", 120, 380),
    mk("nT1", 320, 380),
    mk("nT2", 560, 380),
    mk("nB1", 320, 200),
    mk("nB2", 560, 200),
    mk("nB3", 560, 560),
    mk("nB4", 800, 380),
    // extract
    mk("nEF", 120, 700),
    mk("nE1", 400, 700),
    mk("nE2", 400, 560),
    mk("nE3", 680, 700),
  ];
  p.nodes = nodes;

  const seg = (id, a, b, system, fittings = []) => ({
    id, a, b, system, shapeOverride: null, sizeOverride: null,
    flowOverride: null, roleOverride: null, fittings,
  });
  p.segments = [
    seg("sT0", "nAHU", "nT1", "supply", [{ type: "bend90_radius", qty: 1 }]),
    seg("sT1", "nT1", "nT2", "supply"),
    seg("sB1", "nT1", "nB1", "supply", [{ type: "tee_branch", qty: 1 }]),
    seg("sB2", "nT2", "nB2", "supply", [{ type: "tee_branch", qty: 1 }]),
    seg("sB3", "nT2", "nB3", "supply", [{ type: "tee_branch", qty: 1 }]),
    seg("sB4", "nT2", "nB4", "supply"),
    // extract
    seg("sE0", "nEF", "nE1", "extract", [{ type: "bend90_radius", qty: 1 }]),
    seg("sE1", "nE1", "nE2", "extract", [{ type: "tee_branch", qty: 1 }]),
    seg("sE2", "nE1", "nE3", "extract"),
  ];

  const comp = (id, kind, nodeId, system, props = {}) => ({
    id, kind, nodeId, system,
    x: nodes.find((n) => n.id === nodeId).x,
    y: nodes.find((n) => n.id === nodeId).y,
    props: { ...defaultProps(kind), ...props },
  });
  p.components = [
    comp("cAHU", "ahu", "nAHU", "supply", { availableStaticPa: 300, supplyTempC: 18 }),
    comp("cFD", "fire_damper", "nT1", "supply", { lossPa: 15 }),
    comp("cD1", "diffuser", "nB1", "supply", { designFlow_ls: 120, terminalLossPa: 25 }),
    comp("cD2", "diffuser", "nB2", "supply", { designFlow_ls: 120, terminalLossPa: 25 }),
    comp("cD3", "diffuser", "nB3", "supply", { designFlow_ls: 90, terminalLossPa: 25 }),
    comp("cD4", "diffuser", "nB4", "supply", { designFlow_ls: 150, terminalLossPa: 25 }),
    comp("cEF", "fan_centrifugal", "nEF", "extract", { availableStaticPa: 250 }),
    comp("cE2", "grille_extract", "nE2", "extract", { designFlow_ls: 200, terminalLossPa: 20 }),
    comp("cE3", "grille_extract", "nE3", "extract", { designFlow_ls: 220, terminalLossPa: 20 }),
  ];

  p.rooms = [
    { id: "rm1", name: "Office A", points: [{ x: 260, y: 120 }, { x: 480, y: 120 }, { x: 480, y: 300 }, { x: 260, y: 300 }], supplyFlow_ls: 120, extractFlow_ls: 100 },
    { id: "rm2", name: "Office B", points: [{ x: 500, y: 120 }, { x: 720, y: 120 }, { x: 720, y: 300 }, { x: 500, y: 300 }], supplyFlow_ls: 120, extractFlow_ls: 0 },
    { id: "rm3", name: "Meeting", points: [{ x: 500, y: 500 }, { x: 760, y: 500 }, { x: 760, y: 640 }, { x: 500, y: 640 }], supplyFlow_ls: 90, extractFlow_ls: 120 },
  ];

  store.project = p;
  store.selection = null;
  store.commit();
}
