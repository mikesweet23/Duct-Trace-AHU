import test from "node:test";
import assert from "node:assert/strict";
import { computeAll } from "../src/calc/network.js";
import { sizeSockDiameterMm, sockFigures, sockStaticPa, sockSchedule } from "../src/standards/airsock.js";
import { Store, migrateProject } from "../src/state.js";
import { connPoint, terminalPortOffset } from "../src/layout.js";

// AHU (n0) --s0--> tee (n1) --s1--> sock A (n2), 20 m
//                           \--s2--> sock B (n3), 10 m
function sockProject({ duty = 900, aFlow = 0, bFlow = 0, settings = {} } = {}) {
  return {
    scale: { pxPerMeter: 50 },
    settings: { sizingMethod: "friction", ductType: "round", supplyTempC: 18, ...settings },
    nodes: [
      { id: "n0", x: 0, y: 0 },
      { id: "n1", x: 250, y: 0 },
      { id: "n2", x: 250, y: 250 },
      { id: "n3", x: 500, y: 0 },
    ],
    segments: [
      { id: "s0", a: "n0", b: "n1", system: "supply", fittings: [] },
      { id: "s1", a: "n1", b: "n2", system: "supply", fittings: [] },
      { id: "s2", a: "n1", b: "n3", system: "supply", fittings: [] },
    ],
    components: [
      { id: "c0", kind: "ahu", nodeId: "n0", system: "supply", tag: "AHU-01", label: "East", color: "#7c3aed", props: { availableStaticPa: 300, designFlow_ls: duty } },
      { id: "sa", kind: "air_sock", nodeId: "n2", system: "supply", widthM: 20, depthM: 0.4, props: { designFlow_ls: aFlow, ventilatedThroughout: true, basis: "nominal" } },
      { id: "sb", kind: "air_sock", nodeId: "n3", system: "supply", widthM: 10, depthM: 0.4, props: { designFlow_ls: bFlow, ventilatedThroughout: true, basis: "nominal" } },
    ],
    rooms: [],
  };
}

test("sock diameter is the smallest standard size at or under the target inlet velocity", () => {
  // 500 l/s at 6 m/s needs 0.0833 m2: ø315 is 0.078 (6.4 m/s), ø355 is 0.099 (5.05 m/s)
  assert.equal(sizeSockDiameterMm(500, 6), 355);
  assert.equal(sizeSockDiameterMm(0, 6), 160);
});

test("blank socks share the unit's supply duty by vented length — ventilated throughout", () => {
  const res = computeAll(sockProject({ duty: 900 }));
  const sup = res.supply;
  const flowAt = (n) => sup.terminals.find((t) => t.nodeId === n).flowM3s * 1000;
  assert.ok(Math.abs(flowAt("n2") - 600) < 1e-6, `A ${flowAt("n2")}`); // 20 m of 30 m
  assert.ok(Math.abs(flowAt("n3") - 300) < 1e-6, `B ${flowAt("n3")}`); // 10 m of 30 m
  assert.ok(Math.abs(sup.totalFlowM3s * 1000 - 900) < 1e-6);
  assert.ok(sup.balance.matched);
});

test("a typed sock flow is kept and the rest of the duty goes to the blank sock", () => {
  const res = computeAll(sockProject({ duty: 900, aFlow: 700 }));
  const flowAt = (n) => res.supply.terminals.find((t) => t.nodeId === n).flowM3s * 1000;
  assert.ok(Math.abs(flowAt("n2") - 700) < 1e-6);
  assert.ok(Math.abs(flowAt("n3") - 200) < 1e-6);
});

test("blank socks with no unit duty warn rather than carry air", () => {
  const res = computeAll(sockProject({ duty: 0 }));
  assert.equal(res.supply.totalFlowM3s, 0);
  assert.ok(res.supply.warnings.some((w) => /air sock has no airflow/i.test(w)));
});

test("nominal inlet static goes in the index run until the manufacturer's figure replaces it", () => {
  const p = sockProject({ duty: 900, settings: { sockNominalStaticPa: 100 } });
  const nominal = computeAll(p).supply.terminals.find((t) => t.nodeId === "n2").terminalLossPa;
  assert.equal(nominal, 100);
  const sock = p.components.find((c) => c.id === "sa");
  sock.props.mfrStaticPa = 140;
  assert.equal(sockStaticPa(sock, p.settings), 100, "still nominal until the basis changes");
  sock.props.basis = "manufacturer";
  const confirmed = computeAll(p).supply.terminals.find((t) => t.nodeId === "n2").terminalLossPa;
  assert.equal(confirmed, 140);
});

test("sock figures: flow per metre, part-length venting and warnings", () => {
  const c = { kind: "air_sock", widthM: 20, props: { ventilatedThroughout: false, ventedLengthM: 15, diameterMm: 250, basis: "nominal" } };
  const f = sockFigures(c, 600, {});
  assert.equal(f.ventedLengthM, 15);
  assert.ok(Math.abs(f.flowPerM_ls - 40) < 1e-9);
  assert.equal(f.diameterMm, 250);
  assert.equal(f.autoDia, false);
  assert.ok(f.inletVelocity > 8);
  assert.ok(f.warnings.some((w) => /Inlet velocity/.test(w)));
});

test("the sock schedule carries the system it is on and its basis", () => {
  const p = sockProject({ duty: 900 });
  const rows = sockSchedule(p, computeAll(p));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].system, "AHU-01 East");
  assert.equal(rows[0].basisLabel, "Nominal");
  assert.ok(rows[0].shared);
});

test("a sock joins its duct at the inlet end and keeps it there when stretched or turned", () => {
  const store = new Store();
  store.project = migrateProject({ scale: { pxPerMeter: 50 }, nodes: [], segments: [], components: [] });
  const c = store.addComponentAt({ x: 100, y: 100 }, "air_sock", "supply");
  const node = () => store.project.nodes.find((n) => n.id === c.nodeId);
  assert.deepEqual(terminalPortOffset(c), { u: -1, v: 0 });
  assert.ok(Math.abs(node().x - 100) < 1e-6 && Math.abs(node().y - 100) < 1e-6, "the click is the inlet");
  store.resizeComponent(c, 16, null, null);
  assert.ok(Math.abs(node().x - 100) < 1e-6 && Math.abs(node().y - 100) < 1e-6, "stretching keeps the inlet");
  store.resizeComponent(c, null, null, 90);
  assert.ok(Math.abs(node().x - 100) < 1e-6 && Math.abs(node().y - 100) < 1e-6, "turning keeps the inlet");
  const at = connPoint(c, terminalPortOffset(c), 50);
  assert.ok(Math.abs(at.x - 100) < 1e-6 && Math.abs(at.y - 100) < 1e-6);
});
