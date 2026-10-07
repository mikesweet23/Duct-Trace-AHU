// Fixes from the review: a traced corner is a bend in the pressure
// calculation, and undo keeps one copy of the drawing.
import test from "node:test";
import assert from "node:assert/strict";
import { Store, newProject } from "../src/state.js";
import { computeAll, findSegResult } from "../src/calc/network.js";
import { cornerBendK } from "../src/standards/fittings.js";

globalThis.localStorage ??= { setItem() {}, getItem() { return null; }, removeItem() {} };

function lJob(corner) {
  const store = new Store();
  store.project = newProject("c");
  store.project.scale.pxPerMeter = 50;
  const ahu = store.addComponentAt({ x: 0, y: 0 }, "ahu", "supply");
  const d = store.addComponentAt(corner === 90 ? { x: 300, y: 300 } : { x: 600, y: 300 }, "diffuser", "supply");
  const n = (id) => store.project.nodes.find((x) => x.id === id);
  const c = store.findOrCreateNode({ x: 300, y: 0 }, 0.3);
  n(d.nodeId).z = 0.3;
  n(ahu.nodeId).z = 0.3;
  store.addSegment(n(ahu.nodeId), c, "supply");
  const s2 = store.addSegment(c, n(d.nodeId), "supply");
  return { store, s2 };
}

test("a traced corner counts as a bend: 90° radius bend K 0.22, 45° bend K 0.15", () => {
  const a = lJob(90);
  const r = findSegResult(computeAll(a.store.project), a.s2.id);
  assert.ok(r.autoBend && Math.abs(r.autoBend.angleDeg - 90) < 1e-6);
  assert.ok(Math.abs(r.autoBend.k - 0.22) < 1e-9);
  assert.ok(Math.abs(r.kTotal - 0.22) < 1e-9, "the bend is in the duct's K");
  assert.ok(r.fittingPa > 0 && Math.abs(r.dpPa - r.frictionPa - r.fittingPa - r.inlinePa) < 1e-9, "and in its pressure drop");
  const b = lJob(45);
  const r45 = findSegResult(computeAll(b.store.project), b.s2.id);
  assert.ok(Math.abs(r45.autoBend.angleDeg - 45) < 1e-6 && Math.abs(r45.autoBend.k - 0.15) < 1e-9);
  assert.equal(cornerBendK(3), 0, "a straight joint is not a bend");
  assert.ok(Math.abs(cornerBendK(90, "rect") - 0.3) < 1e-9);
});

test("a bend listed on the duct replaces the traced one rather than adding to it", () => {
  const a = lJob(90);
  a.s2.fittings.push({ type: "bend90_mitre_vaned", qty: 1 });
  const r = findSegResult(computeAll(a.store.project), a.s2.id);
  assert.equal(r.autoBend, null);
  assert.ok(Math.abs(r.kTotal - 0.35) < 1e-9);
});

test("undo keeps the drawing once, however many steps there are", () => {
  const store = new Store();
  store.project = newProject("u");
  const big = "data:image/jpeg;base64," + "A".repeat(200000);
  store.project.background = { dataUrl: big, width: 10, height: 10, x: 0, y: 0 };
  for (let i = 0; i < 20; i++) {
    store.snapshot();
    store.addMeasure([{ x: 0, y: i }, { x: 10, y: i }]);
  }
  const total = store.undoStack.reduce((a, s) => a + s.length, 0);
  assert.ok(total < 200000, `undo stack holds ${total} chars, not 20 copies of the sheet`);
  store.undo();
  assert.equal(store.project.background.dataUrl, big, "the drawing comes back on undo");
  assert.equal(store.project.measures.length, 19);
  store.redo();
  assert.equal(store.project.background.dataUrl, big);
});
