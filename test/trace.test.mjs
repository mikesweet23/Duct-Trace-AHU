// Tracing the way Pipe Trace does it: a click on a run branches off it
// exactly on the pipe, a click on a unit joins and finishes, and the branch
// is then fed. Before this, a click on a duct dropped a loose node on top of
// it that looked joined and was not.
import test from "node:test";
import assert from "node:assert/strict";
import { Store, newProject, migrateProject } from "../src/state.js";
import { CanvasView, noFlowHint } from "../src/ui/canvas.js";
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
  assert.ok(sNode.x > hrv.x && eNode.x > hrv.x, "supply and extract on the building side");
  const d = store.addComponentAt({ x: 300, y: 0 }, "diffuser", "supply");
  const g = store.addComponentAt({ x: 300, y: 200 }, "grille_extract", "extract");
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

// Fresh air in and stale air out: the other two connections of the unit.
function fourPortJob() {
  const { store, canvas } = setup();
  const hrv = store.addComponentAt({ x: 0, y: 0 }, "hrv", "both");
  const d = store.addComponentAt({ x: 400, y: -100 }, "diffuser", "supply");
  d.props.designFlow_ls = 120;
  const g = store.addComponentAt({ x: 400, y: 100 }, "grille_extract", "extract");
  g.props.designFlow_ls = 110;
  const oda = store.addComponentAt({ x: -400, y: -100 }, "intake_louvre", "supply");
  const eha = store.addComponentAt({ x: -400, y: 100 }, "exhaust_louvre", "supply");
  const node = (id) => store.project.nodes.find((n) => n.id === id);
  store.addSegment(node(hrv.nodeId), node(d.nodeId), "supply");
  store.addSegment(node(hrv.returnNodeId), node(g.nodeId), "extract");
  store.addSegment(node(oda.nodeId), node(hrv.outdoorNodeId), "outdoor");
  store.addSegment(node(hrv.exhaustNodeId), node(eha.nodeId), "exhaust");
  return { store, canvas, hrv, oda, eha };
}

test("an AHU or HRV serving both sides has four connections: SUP and ETA inside, ODA and EHA outside", () => {
  const { store, hrv, oda, eha } = fourPortJob();
  assert.equal(oda.system, "outdoor", "an intake louvre is always fresh air");
  assert.equal(eha.system, "exhaust", "an exhaust louvre is always exhaust");
  const n = (id) => store.project.nodes.find((x) => x.id === id);
  assert.ok(hrv.outdoorNodeId && hrv.exhaustNodeId);
  assert.ok(n(hrv.outdoorNodeId).x < hrv.x && n(hrv.exhaustNodeId).x < hrv.x, "outside connections on the outside face");
  assert.ok(n(hrv.nodeId).x > hrv.x && n(hrv.returnNodeId).x > hrv.x, "building connections on the building face");
  assert.ok(n(hrv.outdoorNodeId).y < n(hrv.exhaustNodeId).y, "fresh air runs straight through to supply");
});

test("fresh air carries the unit's supply flow and exhaust its extract flow", () => {
  const { store } = fourPortJob();
  const res = computeAll(store.project);
  assert.ok(Math.abs(res.outdoor.totalFlowM3s - 0.12) < 1e-9);
  assert.ok(Math.abs(res.exhaust.totalFlowM3s - 0.11) < 1e-9);
  const odaSeg = store.project.segments.find((s) => s.system === "outdoor");
  assert.ok(findSegResult(res, odaSeg.id).flowM3s > 0);
});

test("each fan's static covers both sides of it", () => {
  const { store, hrv } = fourPortJob();
  hrv.props.availableStaticPa = 5;
  const res = computeAll(store.project);
  const total = res.supply.indexStaticPa + res.outdoor.indexStaticPa;
  assert.ok(Math.abs(res.supply.fanStaticPa - total) < 1e-9);
  assert.ok(Math.abs(res.outdoor.marginPa - (5 - total)) < 1e-9);
  assert.ok(res.supply.warnings.some((w) => /Supply fan: fresh air/.test(w)));
});

test("tracing fresh air snaps to the unit's ODA connection, not the supply one", () => {
  const { store, canvas } = setup();
  const hrv = store.addComponentAt({ x: 0, y: 0 }, "hrv", "both");
  store.activeSystem = "outdoor";
  const t = canvas.traceTarget({ x: 0, y: 0 });
  assert.equal(t.snap?.node?.id, hrv.outdoorNodeId);
  store.activeSystem = "exhaust";
  assert.equal(canvas.traceTarget({ x: 0, y: 0 }).snap?.node?.id, hrv.exhaustNodeId);
});

test("extract tracing cannot appear to join an exhaust louvre", () => {
  const { store, canvas } = setup();
  const hrv = store.addComponentAt({ x: 0, y: 0 }, "hrv", "both");
  const louvre = store.addComponentAt({ x: -400, y: 100 }, "exhaust_louvre", "extract");
  store.activeSystem = "extract";
  canvas.traceClick({ x: 0, y: 0 });
  assert.equal(canvas.draft.lastNodeId, hrv.returnNodeId);
  assert.equal(canvas.traceTarget({ x: louvre.x, y: louvre.y }).snap, null);
  canvas.traceClick({ x: louvre.x, y: louvre.y });
  assert.equal(store.project.segments.length, 0, "wrong-system click must not make a loose or misleading join");
  assert.equal(canvas.draft.lastNodeId, hrv.returnNodeId);
});

test("HRV exhaust port feeds an exhaust louvre from the extract duty", () => {
  const { store, canvas } = setup();
  const hrv = store.addComponentAt({ x: 0, y: 0 }, "hrv", "both");
  hrv.props.extractFlow_ls = 110;
  const louvre = store.addComponentAt({ x: -400, y: 100 }, "exhaust_louvre", "exhaust");
  store.activeSystem = "exhaust";
  canvas.traceClick({ x: 0, y: 0 });
  assert.equal(canvas.draft.lastNodeId, hrv.exhaustNodeId);
  canvas.traceClick({ x: louvre.x, y: louvre.y });
  const segment = store.project.segments[0];
  assert.equal(canvas.draft, null);
  assert.equal(segment.system, "exhaust");
  assert.ok([segment.a, segment.b].includes(hrv.exhaustNodeId));
  assert.ok([segment.a, segment.b].includes(louvre.nodeId));
  const result = findSegResult(computeAll(store.project), segment.id);
  assert.equal(result.connectedToPlant, true);
  assert.ok(Math.abs(result.flowM3s - 0.11) < 1e-9);
  assert.equal(noFlowHint(segment, result), null);
});

test("a connected exhaust run without design flow asks for airflow, not a join", () => {
  const { store, hrv } = fourPortJob();
  const segment = store.project.segments.find((s) => s.system === "exhaust");
  hrv.props.extractFlow_ls = 0;
  const grille = store.project.components.find((c) => c.kind === "grille_extract");
  grille.props.designFlow_ls = 0;
  const result = findSegResult(computeAll(store.project), segment.id);
  assert.equal(result.connectedToPlant, true);
  assert.equal(result.flowM3s, 0);
  assert.equal(noFlowHint(segment, result), "connected — set extract airflow");
});

test("an existing extract run ending at an exhaust louvre identifies the wrong air path", () => {
  const { store } = setup();
  const hrv = store.addComponentAt({ x: 0, y: 0 }, "hrv", "both");
  const louvre = store.addComponentAt({ x: -400, y: 100 }, "exhaust_louvre", "exhaust");
  const node = (id) => store.project.nodes.find((n) => n.id === id);
  const segment = store.addSegment(node(hrv.returnNodeId), node(louvre.nodeId), "extract");
  const result = findSegResult(computeAll(store.project), segment.id);
  assert.equal(result.flowM3s, 0);
  assert.equal(noFlowHint(segment, result, store.project), "wrong air path — retrace Exhaust (EHA)");
});

test("every AHU and HRV has internal on one face and external on the other, old files included", () => {
  const { store } = setup();
  const p = store.project;
  // a unit saved with a connection on every face ("sides")
  p.nodes.push({ id: "s", x: 60, y: 0, z: 0.3 }, { id: "r", x: -60, y: 0, z: 0.3 }, { id: "o", x: 0, y: -30, z: 0.3 }, { id: "e", x: 0, y: 30, z: 0.3 });
  p.components.push({ id: "c", kind: "hrv", system: "both", portLayout: "sides", nodeId: "s", returnNodeId: "r", outdoorNodeId: "o", exhaustNodeId: "e", x: 0, y: 0, widthM: 1.2, depthM: 0.7, rot: 0, heightM: 0.3, props: {} });
  const m = migrateProject(JSON.parse(JSON.stringify(p)));
  const c = m.components[0];
  assert.equal(c.portLayout, "inline");
  const at = (id) => m.nodes.find((n) => n.id === id);
  assert.ok(at("s").x > 0 && at("r").x > 0, "IN: supply and extract on one face");
  assert.ok(at("o").x < 0 && at("e").x < 0, "EX: fresh air and exhaust on the other");
  assert.equal(at("s").x, at("r").x);
  assert.equal(at("o").x, at("e").x);
  // mirrored
  store.project = m;
  c.portLayout = "flipped";
  store.syncComponentPorts(c);
  assert.ok(at("s").x < 0 && at("o").x > 0);
});

test("each face of a unit can swap its two connections on its own", () => {
  const { store, hrv } = fourPortJob();
  const at = (id) => store.project.nodes.find((n) => n.id === id);
  const y0 = { s: at(hrv.nodeId).y, e: at(hrv.returnNodeId).y, o: at(hrv.outdoorNodeId).y, x: at(hrv.exhaustNodeId).y };
  const x0 = { s: at(hrv.nodeId).x, o: at(hrv.outdoorNodeId).x };
  const before = computeAll(store.project);
  hrv.swapInternal = true;
  store.syncComponentPorts(hrv);
  assert.equal(at(hrv.nodeId).y, y0.e, "supply now where extract was");
  assert.equal(at(hrv.returnNodeId).y, y0.s, "extract now where supply was");
  assert.equal(at(hrv.nodeId).x, x0.s, "still on the internal face");
  assert.equal(at(hrv.outdoorNodeId).y, y0.o, "the external face did not move");
  assert.equal(at(hrv.exhaustNodeId).y, y0.x);
  hrv.swapExternal = true;
  store.syncComponentPorts(hrv);
  assert.equal(at(hrv.outdoorNodeId).y, y0.x, "fresh air now where exhaust was");
  assert.equal(at(hrv.exhaustNodeId).y, y0.o);
  assert.equal(at(hrv.outdoorNodeId).x, x0.o, "still on the external face");
  // the ducts stay on their airstream: the same flows as before
  const after = computeAll(store.project);
  for (const k of ["supply", "extract", "outdoor", "exhaust"]) {
    assert.ok(Math.abs(after[k].totalFlowM3s - before[k].totalFlowM3s) < 1e-12);
  }
  // and tracing snaps to the moved connection
  const { canvas } = setup();
  canvas.store = store;
  store.activeSystem = "supply";
  assert.equal(canvas.traceTarget({ x: hrv.x, y: hrv.y }).snap.node.id, hrv.nodeId);
  const snapAt = canvas.traceTarget({ x: hrv.x, y: hrv.y }).snap.at;
  assert.ok(Math.abs(snapAt.y - y0.e) < 1e-9, "the ring drawn and the ring snapped to agree");
});
