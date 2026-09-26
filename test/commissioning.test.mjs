// Commissioning sheets, open ends with a bell mouth, and the outside
// louvre sizing.
import test from "node:test";
import assert from "node:assert/strict";
import { Store, newProject, seedDemo } from "../src/state.js";
import { computeAll, findSegResult } from "../src/calc/network.js";
import { buildCommissioning, traversePoints } from "../src/export/commissioning.js";
import { buildProjectPdf } from "../src/export/pdf.js";
import { sizeLouvre, louvreBasis } from "../src/standards/louvres.js";
import { terminalK } from "../src/standards/components.js";

globalThis.localStorage ??= { setItem() {}, getItem() { return null; }, removeItem() {} };

function run(kind, system, bell = false) {
  const store = new Store();
  store.project = newProject("oe");
  store.project.scale.pxPerMeter = 50;
  const ahu = store.addComponentAt({ x: 0, y: 0 }, "ahu", system);
  const t = store.addComponentAt({ x: 500, y: 0 }, kind, system);
  t.props.designFlow_ls = 200;
  t.props.bellMouth = bell;
  store.addSegment(store.project.nodes.find((n) => n.id === ahu.nodeId), store.project.nodes.find((n) => n.id === t.nodeId), t.system);
  return { store, t, res: computeAll(store.project) };
}

test("open ends are supply and extract terminals; their loss is K × Pv at the duct", () => {
  const s = run("open_end_supply", "supply");
  const term = s.res.supply.terminals[0];
  const pv = 0.5 * s.res.supply.density * term.runoutVelocity ** 2;
  assert.equal(s.t.system, "supply");
  assert.ok(Math.abs(term.terminalLossPa - 1.0 * pv) < 1e-9, "supply open end loses its velocity pressure");
  const e = run("open_end_extract", "extract");
  assert.equal(e.t.system, "extract");
  const te = e.res.extract.terminals[0];
  const pve = 0.5 * e.res.extract.density * te.runoutVelocity ** 2;
  assert.ok(Math.abs(te.terminalLossPa - 0.5 * pve) < 1e-9, "plain extract entry K 0.5");
  const b = run("open_end_extract", "extract", true);
  const tb = b.res.extract.terminals[0];
  assert.ok(tb.terminalLossPa < te.terminalLossPa / 5, "a bell mouth all but removes the entry loss");
  assert.equal(terminalK(b.t), 0.04);
});

test("intake is sized at 1.5 m/s through a 50% free area; exhaust at up to 5 m/s", () => {
  const i = sizeLouvre(300, { velocity: 1.5, freeAreaPct: 50 });
  assert.ok(Math.abs(i.freeAreaM2 - 0.2) < 1e-12);
  assert.ok(Math.abs(i.grossAreaM2 - 0.4) < 1e-12);
  assert.ok(i.circular.length >= 1 && i.rectangular.length >= 3);
  for (const o of [...i.circular, ...i.rectangular]) {
    assert.ok(o.grossAreaM2 >= 0.4 - 1e-9, `${o.label} is big enough`);
    assert.ok(o.freeVelocity <= 1.5 + 1e-9, `${o.label} runs at or under 1.5 m/s`);
  }
  assert.equal(i.circular[0].widthMm, 750, "0.4 m2 needs ø750 (ø710 is only 0.396)");
  const x = sizeLouvre(300, { velocity: 5, freeAreaPct: 50 });
  assert.ok(x.grossAreaM2 < i.grossAreaM2 / 3);
  // the free area is adjustable and changes the size
  const y = sizeLouvre(300, { velocity: 1.5, freeAreaPct: 40 });
  assert.ok(Math.abs(y.grossAreaM2 - 0.5) < 1e-12);
  // the basis caps exhaust at 5 m/s and defaults each side
  assert.equal(louvreBasis({ system: "exhaust", props: { designVelocity: 8 } }).velocity, 5);
  assert.equal(louvreBasis({ system: "outdoor", props: {} }).velocity, 1.5);
  assert.equal(louvreBasis({ system: "exhaust", props: {} }).velocity, 5);
});

test("commissioning: every terminal with its design flow and band, the index marked, the traverse and leakage test", () => {
  const store = new Store();
  seedDemo(store);
  const p = store.project;
  const res = computeAll(p);
  const c = buildCommissioning(p, res);
  const sup = c.systems.find((s) => s.systemType === "supply");
  assert.equal(sup.terminals.length, 4);
  const total = sup.terminals.reduce((a, t) => a + t.designLs, 0);
  assert.ok(Math.abs(total - 480) < 1e-9);
  for (const t of sup.terminals) {
    assert.ok(Math.abs(t.minLs - t.designLs * 0.9) < 1e-9 && Math.abs(t.maxLs - t.designLs * 1.1) < 1e-9);
    assert.ok(t.velocity > 0 && t.size.startsWith("dia"));
  }
  assert.equal(sup.terminals.filter((t) => t.index).length, 1);
  assert.ok(sup.indexRef.startsWith("S"));
  assert.ok(Math.abs(sup.totalMaxLs - 528) < 1e-9);
  assert.ok(sup.traverse && sup.traverse.flowLs > 0 && /points/.test(sup.traverse.points));
  assert.equal(sup.leakageClass, "A");
  assert.ok(Math.abs(sup.limitLsPerM2 - 0.027 * 500 ** 0.65) < 1e-9);
  assert.ok(c.systems.some((s) => s.systemType === "outdoor") && c.systems.some((s) => s.systemType === "exhaust"));
  assert.ok(c.louvres.length === 2 && c.louvres.every((l) => l.flowLs > 0));
  // tolerances follow the project settings
  p.settings.commTerminalTolPct = 5;
  const c5 = buildCommissioning(p, res);
  const t0 = c5.systems.find((s) => s.systemType === "supply").terminals[0];
  assert.ok(Math.abs(t0.maxLs - t0.designLs * 1.05) < 1e-9);
  assert.match(traversePoints({ shape: "rect", widthMm: 800, heightMm: 400 }), /6 × 5 = 30/);
  assert.match(traversePoints({ shape: "round", diameterMm: 400 }), /12 points/);
});

test("the PDF report carries the commissioning sheets and the louvre sizing", async () => {
  const store = new Store();
  seedDemo(store);
  const res = computeAll(store.project);
  const blob = buildProjectPdf({ project: store.project, results: res, planJpeg: null, isoJpeg: null });
  const text = new TextDecoder("latin1").decode(new Uint8Array(await blob.arrayBuffer()));
  for (const s of ["Commissioning", "Main duct traverse", "Terminals", "IDX", "DW143 leakage test", "Unit test record", "Room air balance", "Sign-off", "louvre and grille sizing", "Free m/s"]) {
    assert.ok(text.includes(s), `report contains "${s}"`);
  }
  void findSegResult;
});
