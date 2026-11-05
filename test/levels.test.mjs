import test from "node:test";
import assert from "node:assert/strict";
import { Store, migrateProject } from "../src/state.js";
import { computeAll } from "../src/calc/network.js";
import { resolveLevels, levelView, levelIdOf, multiLevel } from "../src/levels.js";
import { generatePhysicalModel } from "../src/fab/generator.js";

globalThis.localStorage ??= { getItem() { return null; }, setItem() {}, removeItem() {} };

function twoFloorStore() {
  const store = new Store();
  store.project = migrateProject({ scale: { pxPerMeter: 50 }, nodes: [], segments: [], components: [] });
  const ahu = store.addComponentAt({ x: 0, y: 0 }, "ahu", "supply");
  ahu.props.availableStaticPa = 300;
  const a = store.project.nodes.find((n) => n.id === ahu.nodeId);
  const corner = store.findOrCreateNode({ x: 250, y: 0 }, 3.2);
  store.addSegment(a, corner, "supply");
  store.emit();
  const l1 = store.addLevel("First floor", 4.2);
  const made = store.riserToLevel(corner, l1);
  store.setActiveLevel(l1);
  const d = store.addComponentAt({ x: 500, y: 0 }, "diffuser", "supply");
  d.props.designFlow_ls = 150;
  store.addSegment(made.node, store.project.nodes.find((n) => n.id === d.nodeId), "supply");
  store.emit();
  return { store, ahu, corner, top: made.node, riser: made.seg, d, l1 };
}

test("old files open on one level with everything on it", () => {
  const p = migrateProject({ nodes: [{ id: "n1", x: 0, y: 0 }], segments: [], components: [] });
  assert.equal(p.levels.length, 1);
  assert.equal(p.nodes[0].levelId, p.levels[0].id);
  assert.equal(multiLevel(p), false);
  assert.equal(resolveLevels(p), p, "single level passes straight through");
});

test("new items go on the level in view, and the plan shows only that level", () => {
  const { store, ahu, d, l1 } = twoFloorStore();
  const p = store.project;
  assert.equal(levelIdOf(p, d), l1);
  assert.notEqual(levelIdOf(p, ahu), l1);
  const v = levelView(p);
  assert.ok(v.components.includes(d) && !v.components.includes(ahu));
  assert.ok(v.segments.every((s) => v.nodes.some((n) => n.id === s.a) && v.nodes.some((n) => n.id === s.b)), "no cross-floor riser in the plan view");
});

test("a riser between floors carries the air and its length is the floor-to-floor rise", () => {
  const { store, riser } = twoFloorStore();
  const res = computeAll(store.project);
  const r = res.supply.segments.find((s) => s.id === riser.id);
  assert.ok(Math.abs(r.flowM3s - 0.15) < 1e-9, `riser flow ${r.flowM3s}`);
  assert.equal(r.role, "riser");
  assert.ok(Math.abs(r.lengthM - 4.2) < 1e-6, `riser ${r.lengthM} m`); // both ends 3.2 m AFFL, floors 4.2 m apart
  assert.ok(res.supply.terminals[0].connected);
});

test("heights are absolute only where floors are compared; floors name the ducts", () => {
  const { store, top } = twoFloorStore();
  const rp = resolveLevels(store.project);
  assert.ok(Math.abs(rp.nodes.find((n) => n.id === top.id).z - (3.2 + 4.2)) < 1e-9);
  assert.equal(store.project.nodes.find((n) => n.id === top.id).z, 3.2, "the project keeps AFFL");
  const model = generatePhysicalModel(store.project, computeAll(store.project));
  assert.ok(model.pieces.some((pc) => pc.floor === "First floor"));
});

test("nodes never join across floors, and each level keeps its own drawing", () => {
  const { store, corner, l1 } = twoFloorStore();
  // same point on plan, same height, on the first floor: a new node, not the ground floor's
  const n = store.findOrCreateNode({ x: corner.x, y: corner.y }, corner.z);
  assert.notEqual(n.id, corner.id);
  store.project.background = { dataUrl: "data:first", width: 10, height: 10, x: 0, y: 0 };
  const ground = store.project.levels[0].id;
  store.setActiveLevel(ground);
  assert.equal(store.project.background, null);
  store.setActiveLevel(l1);
  assert.equal(store.project.background.dataUrl, "data:first");
  assert.equal(store.levelIsEmpty(l1), false);
  assert.equal(store.deleteLevel(l1), false, "a level with work on it is not deleted");
});
