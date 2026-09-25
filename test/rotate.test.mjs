// Rotating the drawing turns the take-off with it and changes no length.
import test from "node:test";
import assert from "node:assert/strict";
import { Store, newProject } from "../src/state.js";
import { rotatedSize, normDeg, turnTakeoff } from "../src/rotate.js";
import { computeAll } from "../src/calc/network.js";

function job() {
  const store = new Store();
  store.project = newProject("r");
  store.project.scale = { pxPerMeter: 40, calib: { a: { x: 10, y: 10 }, b: { x: 250, y: 10 }, meters: 6 } };
  store.project.background = { dataUrl: "x", width: 800, height: 500, x: 0, y: 0, rotDeg: 0 };
  const ahu = store.addComponentAt({ x: 200, y: 200 }, "ahu", "supply");
  const d = store.addComponentAt({ x: 600, y: 350 }, "diffuser", "supply");
  const n = (id) => store.project.nodes.find((x) => x.id === id);
  const mid = store.findOrCreateNode({ x: 600, y: 200 }, 3.2);
  store.addSegment(n(ahu.nodeId), mid, "supply");
  store.addSegment(mid, n(d.nodeId), "supply");
  store.addRoom([{ x: 500, y: 300 }, { x: 700, y: 300 }, { x: 700, y: 420 }, { x: 500, y: 420 }]);
  store.addMeasure([{ x: 100, y: 450 }, { x: 400, y: 450 }]);
  return { store, ahu };
}

const lengths = (res) => res.supply.segments.map((s) => s.lengthM).sort();

test("a quarter turn swaps the sheet's width and height", () => {
  assert.deepEqual(rotatedSize(800, 500, 90), { w: 500, h: 800 });
  assert.deepEqual(rotatedSize(800, 500, 180), { w: 800, h: 500 });
  const f = rotatedSize(800, 500, 2);
  assert.ok(f.w > 800 && f.h > 500, "off square the canvas grows to hold the corners");
  assert.equal(normDeg(270), -90);
  assert.equal(normDeg(-450), -90);
});

test("rotating turns every traced thing and changes no length, size or scale", () => {
  const { store, ahu } = job();
  const p = store.project;
  const before = lengths(computeAll(p));
  const calLen = Math.hypot(p.scale.calib.b.x - p.scale.calib.a.x, p.scale.calib.b.y - p.scale.calib.a.y);
  const from = { x: 400, y: 250 };
  const to = { x: 250, y: 400 }; // a 500 × 800 sheet after a quarter turn
  turnTakeoff(p, 90, from, to);
  for (const c of p.components) store.syncComponentPorts(c);
  const after = lengths(computeAll(p));
  before.forEach((L, i) => assert.ok(Math.abs(L - after[i]) < 1e-9, "duct lengths unchanged"));
  const cal2 = Math.hypot(p.scale.calib.b.x - p.scale.calib.a.x, p.scale.calib.b.y - p.scale.calib.a.y);
  assert.ok(Math.abs(calLen - cal2) < 1e-9, "the calibration line turns with the sheet");
  assert.equal(p.scale.pxPerMeter, 40);
  assert.equal(ahu.rot, 90, "units turn with the sheet");
  // (200,200) is 200 left and 50 up of the centre; a quarter turn clockwise
  // puts it 50 right and 200 up of the new centre
  assert.ok(Math.abs(ahu.x - 300) < 1e-9 && Math.abs(ahu.y - 200) < 1e-9);
  const room = p.rooms[0].points[0];
  assert.ok(Math.abs(room.x - (250 - 50)) < 1e-9 && Math.abs(room.y - (400 + 100)) < 1e-9);
  assert.ok(Math.abs(p.measures[0].pts[1].y - (400 + 0)) < 1e-9);
});

test("turning there and back again puts everything where it was", () => {
  const { store } = job();
  const p = store.project;
  const snap = JSON.stringify([p.nodes, p.rooms, p.measures]);
  turnTakeoff(p, 3.5, { x: 400, y: 250 }, { x: 415, y: 262 });
  turnTakeoff(p, -3.5, { x: 415, y: 262 }, { x: 400, y: 250 });
  const back = [p.nodes, p.rooms, p.measures];
  const orig = JSON.parse(snap);
  back[0].forEach((n, i) => assert.ok(Math.abs(n.x - orig[0][i].x) < 1e-9 && Math.abs(n.y - orig[0][i].y) < 1e-9));
});
