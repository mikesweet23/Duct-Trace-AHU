// Tracing the way Pipe Trace does it: a click on a run branches off it
// exactly on the pipe, a click on a unit joins and finishes, and the branch
// is then fed. Before this, a click on a duct dropped a loose node on top of
// it that looked joined and was not.
import test from "node:test";
import assert from "node:assert/strict";
import { Store, newProject } from "../src/state.js";
import { CanvasView } from "../src/ui/canvas.js";
import { computeAll, findSegResult } from "../src/calc/network.js";
import { isDualPort, recoveredSupplyTempC, recoveredHeatKw, COMPONENTS } from "../src/standards/components.js";

function setup() {
  const store = new Store();
  store.project = newProject("t");
  store.project.scale.pxPerMeter = 50;
  store.project.view.zoom = 1;
  const canvas = Object.create(CanvasView.prototype);
  canvas.store = store;
  canvas.draft = null;
  canvas.results = null;
  store.activeSystem = "supply";
  store.overrideKey = false;
  return { store, canvas };
}

test("a click on a run of the traced system cuts a T-piece on the pipe and the branch is fed", () => {
  const { store, canvas } = setup();
  const ahu = store.addComponentAt({ x: 0, y: 0 }, "ahu", "supply");
  const d1 = store.addComponentAt({ x: 500, y: 0 }, "diffuser", "supply");
  const d2 = store.addComponentAt({ x: 250, y: 200 }, "diffuser", "supply");
  canvas.traceClick({ x: 0, y: 0 });
  canvas.traceClick({ x: 500, y: 0 });
  assert.equal(canvas.draft, null, "finishing on a diffuser drops the pencil");
  // branch: start on the main, 3 px off its centreline
  canvas.traceClick({ x: 250, y: 3 });
  const tee = store.project.nodes.find((n) => n.tee);
  assert.ok(tee, "a tee was cut into the main");
  assert.ok(Math.abs(tee.y) < 1e-6, "the tee sits on the pipe, not beside it");
  canvas.traceClick({ x: 250, y: 200 });
  const res = computeAll(store.project);
  const branch = store.project.segments.find((s) => [s.a, s.b].includes(d2.nodeId));
  assert.ok([branch.a, branch.b].includes(tee.id), "the branch runs from the tee to the diffuser");
  const r = findSegResult(res, branch.id);
  assert.ok(r && r.flowM3s > 0, "the branch carries flow from the unit");
  const main = store.project.segments.find((s) => [s.a, s.b].includes(ahu.nodeId));
  const rm = findSegResult(res, main.id);
  assert.ok(Math.abs(rm.flowM3s - 0.08) < 1e-9, "the main carries both diffusers");
  assert.ok(d1);
});

test("an extract trace does not branch off a supply run", () => {
  const { store, canvas } = setup();
  const a = store.findOrCreateNode({ x: 0, y: 0 }, 3.2);
  const b = store.findOrCreateNode({ x: 400, y: 0 }, 3.2);
  store.addSegment(a, b, "supply");
  store.activeSystem = "extract";
  const t = canvas.traceTarget({ x: 200, y: 2 });
  assert.equal(t.snap, null);
});

test("corners square up to 90 and 45 unless Alt is held", () => {
  const { store, canvas } = setup();
  canvas.traceClick({ x: 0, y: 0 });
  const sq = canvas.traceTarget({ x: 300, y: 17 });
  assert.equal(sq.y, 0);
  store.overrideKey = true;
  const free = canvas.traceTarget({ x: 300, y: 17 });
  assert.equal(free.y, 17);
});

test("the same point at a new height is a riser", () => {
  const { store, canvas } = setup();
  canvas.traceClick({ x: 0, y: 0 });
  canvas.traceClick({ x: 200, y: 0 });
  store.traceHeight = 6.2;
  canvas.traceClick({ x: 200, y: 0 });
  const last = store.project.segments[store.project.segments.length - 1];
  const na = store.project.nodes.find((n) => n.id === last.a);
  const nb = store.project.nodes.find((n) => n.id === last.b);
  assert.equal(na.x, nb.x);
  assert.ok(Math.abs(nb.z - 6.2) < 1e-9);
});

test("an in-line device dropped on a duct sits on the duct", () => {
  const { store } = setup();
  const a = store.findOrCreateNode({ x: 0, y: 0 }, 3.2);
  const b = store.findOrCreateNode({ x: 400, y: 0 }, 3.2);
  const s = store.addSegment(a, b, "supply");
  const fd = store.placeOnRun(s, { x: 150, y: 0 }, "fire_damper");
  assert.equal(store.project.segments.length, 2);
  assert.ok(store.project.segments.every((x) => x.a === fd.nodeId || x.b === fd.nodeId));
  assert.equal(fd.system, "supply");
});

test("a heat recovery unit is a two-port plant that serves supply and extract", () => {
  const { store } = setup();
  assert.ok(isDualPort("hrv") && isDualPort("ahu"));
  assert.equal(COMPONENTS.hrv.role, "plant");
  const hrv = store.addComponentAt({ x: 0, y: 0 }, "hrv", "both");
  assert.equal(hrv.system, "both");
  assert.ok(hrv.returnNodeId && hrv.returnNodeId !== hrv.nodeId, "separate extract port");
  const sNode = store.project.nodes.find((n) => n.id === hrv.nodeId);
  const eNode = store.project.nodes.find((n) => n.id === hrv.returnNodeId);
  assert.ok(sNode.x > eNode.x, "supply on the right, extract on the left");
  const d = store.addComponentAt({ x: 300, y: 0 }, "diffuser", "supply");
  const g = store.addComponentAt({ x: -300, y: 0 }, "grille_extract", "extract");
  store.addSegment(sNode, store.project.nodes.find((n) => n.id === d.nodeId), "supply");
  store.addSegment(eNode, store.project.nodes.find((n) => n.id === g.nodeId), "extract");
  const res = computeAll(store.project);
  assert.equal(res.supply.plant?.id, hrv.id);
  assert.equal(res.extract.plant?.id, hrv.id);
});

test("heat recovery: supply temperature and heat recovered", () => {
  assert.equal(recoveredSupplyTempC(-4, 21, 80), 16);
  const kw = recoveredHeatKw(100, -4, 21, 80);
  assert.ok(Math.abs(kw - 0.1 * 1.2 * 1.006 * 20) < 1e-9);
});
