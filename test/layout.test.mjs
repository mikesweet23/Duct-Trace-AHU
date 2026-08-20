import test from "node:test";
import assert from "node:assert/strict";
import { Store, seedDemo, migrateProject, newProject } from "../src/state.js";
import { snapAt } from "../src/snap.js";
import { routeLengthM, isVerticalRiser, offsetPoly, orthoPoint } from "../src/geom.js";
import { computeAll } from "../src/calc/network.js";

function emptyStore() {
  const store = new Store();
  store.project = newProject("test");
  store.project.settings.conceptPxPerMeter = 50;
  store.project.scale.pxPerMeter = 50;
  return store;
}

test("snap pulls to an AHU or outlet only when nearby", () => {
  const store = emptyStore();
  const ahu = store.addComponentAt({ x: 100, y: 100 }, "ahu", "supply");
  const near = snapAt(store.project, { x: 102, y: 101 }, { zoom: 1, system: "supply" });
  assert.equal(near.kind, "component");
  assert.equal(near.component.id, ahu.id);
  const far = snapAt(store.project, { x: 400, y: 400 }, { zoom: 1, system: "supply" });
  assert.equal(far, null);
});

test("a click on a close parallel run does not yank to the far end", () => {
  const store = emptyStore();
  const a = store.findOrCreateNode({ x: 0, y: 0 }, 3.2);
  const b = store.findOrCreateNode({ x: 400, y: 0 }, 3.2);
  store.addSegment(a, b, "supply");
  // 20 px off the run, 200 px from either end — closer than SNAP_PULL would
  // be if we measured to the run, but the nearest existing point is 200 px away.
  const sn = snapAt(store.project, { x: 200, y: 20 }, { zoom: 1 });
  assert.equal(sn, null, "must not snap to the mid-run of a nearby duct");
  const atEnd = snapAt(store.project, { x: 6, y: 4 }, { zoom: 1 });
  assert.ok(atEnd && atEnd.node.id === a.id);
});

test("Alt (or snapPoints off) cuts a T-piece on the run", () => {
  const store = emptyStore();
  const a = store.findOrCreateNode({ x: 0, y: 0 }, 3.2);
  const b = store.findOrCreateNode({ x: 400, y: 0 }, 3.2);
  store.addSegment(a, b, "supply");
  const sn = snapAt(store.project, { x: 200, y: 4 }, { zoom: 1, alt: true });
  assert.equal(sn.kind, "run");
  const j = store.splitSegmentAt(sn.seg, sn.at, 3.2);
  assert.equal(store.project.segments.length, 2);
  assert.equal(j.tee, true);
  assert.ok(store.project.segments.every((s) => s.a === j.id || s.b === j.id));
});

test("duplicate outlet copies size, height and design flow", () => {
  const store = emptyStore();
  const c = store.addComponentAt({ x: 50, y: 50 }, "diffuser", "supply");
  c.props.designFlow_ls = 85;
  c.widthM = 0.55;
  c.heightM = 2.6;
  const copy = store.duplicateComponent(c);
  assert.ok(copy);
  assert.equal(copy.kind, "diffuser");
  assert.equal(copy.props.designFlow_ls, 85);
  assert.equal(copy.widthM, 0.55);
  assert.equal(copy.heightM, 2.6);
  assert.ok(copy.x > c.x);
  assert.notEqual(copy.id, c.id);
  assert.notEqual(copy.nodeId, c.nodeId);
});

test("route length includes the riser, which does not show as a plan run", () => {
  const a = { x: 0, y: 0, z: 3.2 };
  const b = { x: 0, y: 0, z: 6.0 };
  assert.equal(isVerticalRiser(a, b, 50), true);
  assert.ok(Math.abs(routeLengthM(a, b, 50) - 2.8) < 1e-9);
  const slope = { x: 100, y: 0, z: 4.2 }; // 2 m plan + 1 m rise
  assert.ok(Math.abs(routeLengthM(a, slope, 50) - Math.hypot(2, 1)) < 1e-9);
});

test("a combined AHU is plant for both supply and extract", () => {
  const store = emptyStore();
  const ahu = store.addComponentAt({ x: 0, y: 0 }, "ahu", "both");
  store.setComponentSystem(ahu, "both");
  assert.equal(ahu.system, "both");
  assert.ok(ahu.returnNodeId);
  assert.notEqual(ahu.nodeId, ahu.returnNodeId);

  const sN = store.project.nodes.find((n) => n.id === ahu.nodeId);
  const eN = store.project.nodes.find((n) => n.id === ahu.returnNodeId);
  const sOut = store.findOrCreateNode({ x: 200, y: 0 }, 2.7);
  const eOut = store.findOrCreateNode({ x: -200, y: 0 }, 2.7);
  store.addSegment(sN, sOut, "supply");
  store.addSegment(eN, eOut, "extract");
  store.addComponentAt({ x: 200, y: 0 }, "diffuser", "supply").props.designFlow_ls = 100;
  store.addComponentAt({ x: -200, y: 0 }, "grille_extract", "extract").props.designFlow_ls = 90;

  const all = computeAll(store.project);
  assert.equal(all.supply.plant.id, ahu.id);
  assert.equal(all.extract.plant.id, ahu.id);
  assert.ok(Math.abs(all.supply.totalFlowM3s - 0.1) < 1e-9);
  assert.ok(Math.abs(all.extract.totalFlowM3s - 0.09) < 1e-9);
  assert.equal(all.supply.rootNode, ahu.nodeId);
  assert.equal(all.extract.rootNode, ahu.returnNodeId);
});

test("dual AHU snap lands supply and extract on opposite sides", () => {
  const store = emptyStore();
  const ahu = store.addComponentAt({ x: 0, y: 0 }, "ahu", "both");
  store.setComponentSystem(ahu, "both");
  const supply = snapAt(store.project, { x: 0, y: 0 }, { zoom: 1, system: "supply" });
  const extract = snapAt(store.project, { x: 0, y: 0 }, { zoom: 1, system: "extract" });
  assert.equal(supply.node.id, ahu.nodeId);
  assert.equal(extract.node.id, ahu.returnNodeId);
  assert.ok(supply.at.x > extract.at.x);
});

test("offset poly keeps a constant width (no flare)", () => {
  const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }];
  const off = offsetPoly(pts, 10);
  const d0 = Math.hypot(off[0].x - pts[0].x, off[0].y - pts[0].y);
  const d2 = Math.hypot(off[2].x - pts[2].x, off[2].y - pts[2].y);
  assert.ok(Math.abs(d0 - 10) < 1e-6);
  assert.ok(Math.abs(d2 - 10) < 1e-6);
});

test("ortho lock squares a free click", () => {
  const q = orthoPoint({ x: 0, y: 0 }, { x: 40, y: 3 });
  assert.equal(q.y, 0);
  assert.equal(q.x, 40);
});

test("demo combined AHU still sizes both systems", () => {
  const store = new Store();
  seedDemo(store);
  const all = computeAll(store.project);
  assert.ok(all.supply.totalFlowM3s > 0.4);
  assert.ok(all.extract.totalFlowM3s > 0.3);
  assert.equal(all.supply.plant.kind, "ahu");
  assert.equal(all.extract.plant.kind, "ahu");
  const riser = store.project.segments.find((s) => s.id === "sRise");
  const a = store.project.nodes.find((n) => n.id === riser.a);
  const b = store.project.nodes.find((n) => n.id === riser.b);
  assert.ok(isVerticalRiser(a, b, 40));
});

test("migrate adds footprints and heights to an old project", () => {
  const old = {
    settings: {},
    nodes: [{ id: "n1", x: 0, y: 0 }],
    segments: [],
    components: [{ id: "c1", kind: "diffuser", nodeId: "n1", system: "supply", x: 0, y: 0, props: { designFlow_ls: 40 } }],
    rooms: [],
  };
  const p = migrateProject(old);
  const c = p.components[0];
  assert.ok(c.widthM > 0 && c.depthM > 0);
  assert.ok(Number.isFinite(c.heightM));
  assert.ok(Number.isFinite(p.nodes[0].z));
});
