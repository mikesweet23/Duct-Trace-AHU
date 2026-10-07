// Several things at once: pick, change together, line up, move, duplicate,
// delete.
import test from "node:test";
import assert from "node:assert/strict";
import { Store, newProject } from "../src/state.js";
import { CanvasView } from "../src/ui/canvas.js";
import { computeAll } from "../src/calc/network.js";

globalThis.localStorage ??= { setItem() {}, getItem() { return null; }, removeItem() {} };

function job() {
  const store = new Store();
  store.project = newProject("m");
  store.project.scale.pxPerMeter = 50;
  const ahu = store.addComponentAt({ x: 0, y: 0 }, "ahu", "supply");
  const g = [
    store.addComponentAt({ x: 300, y: 103 }, "grille_supply", "supply"),
    store.addComponentAt({ x: 500, y: 96 }, "grille_supply", "supply"),
    store.addComponentAt({ x: 820, y: 100 }, "grille_supply", "supply"),
  ];
  const n = (id) => store.project.nodes.find((x) => x.id === id);
  const main = store.findOrCreateNode({ x: 300, y: 0 }, 3.2);
  store.addSegment(n(ahu.nodeId), main, "supply");
  const s1 = store.addSegment(main, n(g[0].nodeId), "supply");
  return { store, ahu, g, s1, n };
}

test("a box picks the units inside it and the ducts with both ends inside", () => {
  const { store, g, s1 } = job();
  const canvas = Object.create(CanvasView.prototype);
  canvas.store = store;
  canvas.selectInBox({ x: 250, y: 50 }, { x: 900, y: 150 });
  assert.equal(store.selection.type, "multi");
  assert.deepEqual(store.selectedObjects().components.map((c) => c.id).sort(), g.map((c) => c.id).sort());
  assert.ok(!store.isSelected("segment", s1.id), "a duct running out of the box is not picked");
  canvas.selectInBox({ x: 250, y: -50 }, { x: 350, y: 150 });
  assert.ok(store.isSelected("segment", s1.id), "the run-out with both ends inside is picked");
});

test("shift-click toggles; one left settles to a single selection; Ctrl+A takes the lot", () => {
  const { store, g } = job();
  store.select("component", g[0].id);
  store.toggleSelected("component", g[1].id);
  assert.equal(store.selection.type, "multi");
  store.toggleSelected("component", g[0].id);
  assert.deepEqual(store.selection, { type: "component", id: g[1].id });
  store.selectAll();
  assert.equal(store.selectedItems().length, store.project.components.length + store.project.segments.length);
});

test("batch edit sets flow and loss on every picked grille and nothing else", () => {
  const { store, ahu, g } = job();
  store.setSelection([...g.map((c) => ({ type: "component", id: c.id })), { type: "component", id: ahu.id }]);
  const n = store.batchEdit({ "props.designFlow_ls": 75, "props.terminalLossPa": 18, heightM: 2.9 });
  assert.equal(n, 4);
  for (const c of g) {
    assert.equal(c.props.designFlow_ls, 75);
    assert.equal(c.props.terminalLossPa, 18);
    assert.equal(c.heightM, 2.9);
  }
  assert.ok(!("terminalLossPa" in ahu.props), "a parameter the AHU does not have is not added to it");
  store.batchEdit({ kind: "diffuser" });
  assert.ok(g.every((c) => c.kind === "diffuser" && c.props.designFlow_ls === 75), "type changes, flows kept");
});

test("line up in a row and space evenly", () => {
  const { store, g } = job();
  store.setSelection(g.map((c) => ({ type: "component", id: c.id })));
  store.alignSelection("y");
  assert.ok(g.every((c) => Math.abs(c.y - 299 / 3) < 1e-9), "same centre line");
  store.alignSelection("spreadX");
  assert.deepEqual(g.map((c) => c.x), [300, 560, 820]);
  const nodeOf = (c) => store.project.nodes.find((x) => x.id === c.nodeId);
  assert.ok(g.every((c) => nodeOf(c).x === c.x && nodeOf(c).y === c.y), "connections move with the units");
});

test("move, duplicate and delete several at once", () => {
  const { store, g, s1, n } = job();
  store.setSelection([...g.map((c) => ({ type: "component", id: c.id })), { type: "segment", id: s1.id }]);
  const before = g.map((c) => ({ x: c.x, y: c.y }));
  const mainBefore = { ...n(s1.a) };
  store.moveSelection(50, -20);
  g.forEach((c, i) => { assert.equal(c.x, before[i].x + 50); assert.equal(c.y, before[i].y - 20); });
  assert.equal(n(s1.a).x, mainBefore.x + 50, "a picked duct takes both its ends");
  const comps = store.project.components.length;
  const items = store.duplicateSelection();
  assert.equal(store.project.components.length, comps + 3);
  assert.equal(items.length, 4, "three grilles and the duct between them");
  const copySeg = store.project.segments[store.project.segments.length - 1];
  assert.ok(copySeg.a !== s1.a && copySeg.b !== s1.b, "the copy has its own nodes");
  store.deleteSelection();
  assert.equal(store.project.components.length, comps);
  assert.ok(computeAll(store.project));
});
