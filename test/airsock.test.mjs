import test from "node:test";
import assert from "node:assert/strict";
import { computeAll } from "../src/calc/network.js";
import { sizeSockDiameterMm, sockFigures, sockSchedule, sockTakeoff, sockById, defaultSockProps } from "../src/standards/airsock.js";
import { Store, migrateProject } from "../src/state.js";
import { generatePhysicalModel } from "../src/fab/generator.js";

globalThis.localStorage ??= { getItem() { return null; }, setItem() {}, removeItem() {} };

// 50 px per metre.
//   AHU n0 ──galv 5 m── n1 ──fabric 10 m── nA1
//                        │                   └─fabric 5 m (a 90)── nA2      sock A, L-shaped, 15 m
//                        └─galv 5 m── n3 ──fabric 5 m── nB1                  sock B, 5 m
function job({ duty = 800, aFlow = 0, bFlow = 0, settings = {}, tee = false } = {}) {
  const fab = (id, a, b, sockId) => ({ id, a, b, system: "supply", fabric: true, sockId, fittings: [] });
  const p = {
    scale: { pxPerMeter: 50 },
    settings: { sizingMethod: "friction", ductType: "round", supplyTempC: 18, ...settings },
    nodes: [
      { id: "n0", x: 0, y: 0, z: 3 }, { id: "n1", x: 250, y: 0, z: 3 },
      { id: "nA1", x: 750, y: 0, z: 3 }, { id: "nA2", x: 750, y: 250, z: 3 },
      { id: "n3", x: 250, y: 250, z: 3 }, { id: "nB1", x: 500, y: 250, z: 3 },
    ],
    segments: [
      { id: "g0", a: "n0", b: "n1", system: "supply", fittings: [] },
      fab("fA1", "n1", "nA1", "kA"),
      fab("fA2", "nA1", "nA2", "kA"),
      { id: "g1", a: "n1", b: "n3", system: "supply", fittings: [] },
      fab("fB1", "n3", "nB1", "kB"),
    ],
    components: [
      { id: "u1", kind: "ahu", nodeId: "n0", system: "supply", tag: "AHU-01", label: "Hall", color: "#7c3aed", props: { availableStaticPa: 400, designFlow_ls: duty } },
    ],
    socks: [
      { id: "kA", label: "Sock A", props: { ...defaultSockProps(), designFlow_ls: aFlow } },
      { id: "kB", label: "Sock B", props: { ...defaultSockProps(), designFlow_ls: bFlow } },
    ],
    rooms: [],
  };
  if (tee) {
    // split sock A's first length at 5 m and branch 5 m off it: a fabric tee
    p.nodes.push({ id: "nT", x: 500, y: 0, z: 3 }, { id: "nA3", x: 500, y: -250, z: 3 });
    p.segments = p.segments.filter((s) => s.id !== "fA1");
    p.segments.push(fab("fA1a", "n1", "nT", "kA"), fab("fA1b", "nT", "nA1", "kA"), fab("fA3", "nT", "nA3", "kA"));
  }
  return p;
}

const sockOf = (res, id) => res.supply.socks.find((k) => k.sockId === id);

test("sock diameter is the smallest standard size at or under the target inlet velocity", () => {
  // 500 l/s at 6 m/s needs 0.0833 m²: ø315 is 0.078 (6.4 m/s), ø355 is 0.099 (5.05 m/s)
  assert.equal(sizeSockDiameterMm(500, 6), 355);
  assert.equal(sizeSockDiameterMm(0, 6), 160);
});

test("blank socks share the unit's duty by vented length, bends and all", () => {
  const res = computeAll(job({ duty: 800 }));
  assert.ok(Math.abs(sockOf(res, "kA").flowLs - 600) < 1e-6, "15 m of 20 m");
  assert.ok(Math.abs(sockOf(res, "kB").flowLs - 200) < 1e-6, "5 m of 20 m");
  assert.ok(Math.abs(res.supply.totalFlowM3s * 1000 - 800) < 1e-6);
  assert.ok(res.supply.balance.matched);
  // the air leaves along the sock: all of it into the first length, a third into the 90
  const seg = (id) => res.supply.segments.find((s) => s.id === id);
  assert.ok(Math.abs(seg("fA1").flowM3s - 0.6) < 1e-9);
  assert.ok(Math.abs(seg("fA2").flowM3s - 0.2) < 1e-9);
  assert.ok(Math.abs(seg("g0").flowM3s - 0.8) < 1e-9, "the galvanised feed carries both socks");
});

test("a typed sock total is kept and the rest of the duty goes to the blank sock", () => {
  const res = computeAll(job({ duty: 800, aFlow: 700 }));
  assert.ok(Math.abs(sockOf(res, "kA").flowLs - 700) < 1e-6);
  assert.ok(Math.abs(sockOf(res, "kB").flowLs - 100) < 1e-6);
});

test("blank socks with no unit duty warn rather than carry air", () => {
  const res = computeAll(job({ duty: 0 }));
  assert.equal(res.supply.totalFlowM3s, 0);
  assert.ok(res.supply.warnings.some((w) => /air sock has no airflow/i.test(w)));
});

test("fabric has no friction of its own; the sock's inlet static goes in the index run once", () => {
  const p = job({ duty: 800, settings: { sockNominalStaticPa: 100 } });
  let res = computeAll(p);
  const fA2 = res.supply.segments.find((s) => s.id === "fA2");
  assert.equal(fA2.role, "sock");
  assert.equal(fA2.dpPa, 0);
  const tA = res.supply.terminals.find((t) => t.sockId === "kA");
  assert.equal(tA.terminalLossPa, 100);
  assert.ok(tA.connected);
  const galv = res.supply.segments.find((s) => s.id === "g0").dpPa;
  assert.ok(Math.abs(tA.totalPa - (galv + 100)) < 1e-6, "duct to the inlet + the sock's static");
  const a = p.socks.find((k) => k.id === "kA");
  a.props.mfrStaticPa = 140;
  assert.equal(computeAll(p).supply.terminals.find((t) => t.sockId === "kA").terminalLossPa, 100, "still nominal until the basis changes");
  a.props.basis = "manufacturer";
  res = computeAll(p);
  assert.equal(res.supply.terminals.find((t) => t.sockId === "kA").terminalLossPa, 140);
});

test("an L-shaped sock: one leg, one 90, one end, sized at its inlet", () => {
  const p = job({ duty: 800 });
  const fig = sockFigures(p, sockById(p, "kA"), computeAll(p));
  assert.deepEqual(fig.bends, [90]);
  assert.equal(fig.tees, 0);
  assert.equal(fig.ends, 1);
  assert.equal(fig.lengthM, 15);
  assert.equal(fig.diameterMm, sizeSockDiameterMm(600, 6));
  assert.ok(Math.abs(fig.flowPerM_ls - 40) < 1e-9);
  assert.equal(fig.legs.length, 1);
});

test("a tee in a sock: three legs, each sized for the air entering it", () => {
  const p = job({ duty: 800, tee: true });
  const res = computeAll(p);
  const fig = sockFigures(p, sockById(p, "kA"), res);
  assert.equal(fig.tees, 1);
  assert.equal(fig.lengthM, 20);
  assert.equal(fig.legs.length, 3);
  const inlet = fig.legs.find((l) => l.fromInlet);
  assert.ok(Math.abs(inlet.flowLs - sockOf(res, "kA").flowLs) < 1e-6);
  for (const l of fig.legs.filter((x) => !x.fromInlet)) assert.ok(l.diameterMm <= inlet.diameterMm);
});

test("part-length venting spreads the air over the vented length only", () => {
  const p = job({ duty: 800 });
  p.socks[0].props.ventilatedThroughout = false;
  p.socks[0].props.ventedLengthM = 7.5;
  const fig = sockFigures(p, sockById(p, "kA"), computeAll(p));
  assert.equal(fig.ventedLengthM, 7.5);
  assert.ok(fig.flowPerM_ls > 0);
});

test("the schedule and take-off: system, fabric by leg, bends, end caps, drops, inlet spigots", () => {
  const p = job({ duty: 800, settings: { sockDropSpacingM: 1.5 } });
  const res = computeAll(p);
  const rows = sockSchedule(p, res);
  assert.equal(rows.find((r) => r.id === "kA").system, "AHU-01 Hall");
  assert.equal(rows[0].basisLabel, "Nominal");
  const t = sockTakeoff(p, res);
  assert.equal(t.inlets, 2);
  assert.equal(t.fittings.find((g) => g.label === "Fabric 90° bend").qty, 1);
  assert.equal(t.fittings.find((g) => g.label === "Fabric end cap").qty, 2);
  // single cable: 10 m → 8 drops, 5 m → 5, 5 m → 5
  assert.equal(t.drops, 18);
  assert.equal(t.suspension[0].lengthM, 20);
});

test("fabric gets no sheet-metal pieces; the galvanised end at a sock is a spigot, not a cap", () => {
  const p = job({ duty: 800 });
  const model = generatePhysicalModel(p, computeAll(p));
  assert.ok(!model.pieces.some((pc) => ["fA1", "fA2", "fB1"].includes(pc.segmentId) && pc.kind === "straight"));
  assert.ok(model.pieces.some((pc) => pc.kind === "boot"), "a spigot where the galvanised meets sock B");
  assert.ok(!model.pieces.some((pc) => pc.kind === "cap" || /cap/i.test(pc.fittingType || "")));
});

test("drawing: a sock traced off a duct end joins it, and a branch off the sock joins the same sock", () => {
  const store = new Store();
  store.project = migrateProject({ scale: { pxPerMeter: 50 }, nodes: [], segments: [], components: [] });
  const ahu = store.addComponentAt({ x: 0, y: 0 }, "ahu", "supply");
  ahu.props.designFlow_ls = 500;
  const a = store.project.nodes.find((n) => n.id === ahu.nodeId);
  const end = store.findOrCreateNode({ x: 250, y: 0 }, 3.2);
  store.addSegment(a, end, "supply");
  // what the Air sock tool does: lengths from the duct end, a 90, all one sock
  const k = store.newSock();
  const c1 = store.findOrCreateNode({ x: 750, y: 0 }, 3.2);
  const c2 = store.findOrCreateNode({ x: 750, y: 300 }, 3.2);
  store.addSegment(end, c1, "supply", { fabric: true, sockId: k.id });
  const leg2 = store.addSegment(c1, c2, "supply", { fabric: true, sockId: k.id });
  // a tee cut in the sock stays in the sock
  const j = store.splitSegmentAt(leg2, { x: 750, y: 150 }, 3.2);
  assert.ok(store.project.segments.filter((s) => s.a === j.id || s.b === j.id).every((s) => s.fabric && s.sockId === k.id));
  store.emit();
  const res = computeAll(store.project);
  const r = res.supply.socks[0];
  assert.ok(r.connected);
  assert.ok(Math.abs(r.flowLs - 500) < 1e-6);
});

test("a duct length switched to fabric joins the sock it touches, and back again", () => {
  const store = new Store();
  const base = job({ duty: 800 });
  base.nodes.push({ id: "nX", x: 250, y: 500, z: 3 });
  base.segments.push({ id: "g2", a: "n3", b: "nX", system: "supply", fittings: [] });
  store.project = migrateProject(base);
  const g2 = store.project.segments.find((s) => s.id === "g2");
  store.setFabric([g2], true);
  assert.equal(g2.sockId, "kB", "it touches sock B at n3");
  assert.equal(computeAll(store.project).supply.socks.find((k) => k.sockId === "kB").legs.length, 2, "a fabric tee at n3 now");
  store.setFabric([g2], false);
  assert.equal(g2.fabric, false);
  store.setFabric(store.project.segments.filter((s) => s.sockId === "kB"), false);
  store.emit();
  assert.equal(sockById(store.project, "kB"), null, "an empty sock record goes");
});

test("a sock made as a one-piece terminal opens as a traced fabric length", () => {
  const p = migrateProject({
    scale: { pxPerMeter: 50 },
    nodes: [{ id: "n0", x: 0, y: 0, z: 3 }, { id: "n1", x: 250, y: 0, z: 3 }],
    segments: [{ id: "g0", a: "n0", b: "n1", system: "supply", fittings: [] }],
    components: [
      { id: "u1", kind: "ahu", nodeId: "n0", system: "supply", props: { availableStaticPa: 300, designFlow_ls: 600 } },
      { id: "old", kind: "air_sock", nodeId: "n1", system: "supply", x: 650, y: 0, widthM: 16, depthM: 0.4, rot: 0, label: "Warehouse sock",
        props: { designFlow_ls: 0, ventilatedThroughout: true, basis: "nominal", manufacturer: "Acme", terminalLossPa: 0 } },
    ],
  });
  assert.ok(!p.components.some((c) => c.kind === "air_sock"));
  assert.equal(p.socks.length, 1);
  assert.equal(p.socks[0].label, "Warehouse sock");
  assert.equal(p.socks[0].props.manufacturer, "Acme");
  const fab = p.segments.filter((s) => s.fabric);
  assert.equal(fab.length, 1);
  assert.equal(fab[0].a, "n1", "from the old inlet");
  const end = p.nodes.find((n) => n.id === fab[0].b);
  assert.ok(Math.abs(end.x - (250 + 16 * 50)) < 1e-6);
  assert.ok(Math.abs(computeAll(p).supply.socks[0].flowLs - 600) < 1e-6);
});
