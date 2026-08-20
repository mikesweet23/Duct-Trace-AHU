import test from "node:test";
import assert from "node:assert/strict";
import { computeSystem, computeAll } from "../src/calc/network.js";

// Build a small supply system:
//   AHU (n0) --seg s0--> junction (n1) --s1--> diffuser A (n2)
//                                    \--s2--> diffuser B (n3)
// Each diffuser: 100 l/s. Trunk should carry 200 l/s.
function demoProject() {
  return {
    scale: { pxPerMeter: 50 },
    settings: {
      sizingMethod: "velocity",
      ductType: "round",
      supplyTempC: 18,
      velocityCaps: { main: 7, branch: 5, runout: 3.5 },
    },
    nodes: [
      { id: "n0", x: 0, y: 0 },
      { id: "n1", x: 500, y: 0 }, // 10 m from n0
      { id: "n2", x: 500, y: 250 }, // 5 m from n1
      { id: "n3", x: 750, y: 0 }, // 5 m from n1
    ],
    segments: [
      { id: "s0", a: "n0", b: "n1", system: "supply", fittings: [] },
      { id: "s1", a: "n1", b: "n2", system: "supply", fittings: [] },
      { id: "s2", a: "n1", b: "n3", system: "supply", fittings: [] },
    ],
    components: [
      { id: "c0", kind: "ahu", nodeId: "n0", system: "supply", props: { availableStaticPa: 250 } },
      { id: "c1", kind: "diffuser", nodeId: "n2", system: "supply", props: { designFlow_ls: 100, terminalLossPa: 25 } },
      { id: "c2", kind: "diffuser", nodeId: "n3", system: "supply", props: { designFlow_ls: 100, terminalLossPa: 25 } },
    ],
  };
}

test("flow accumulates from terminals to the trunk", () => {
  const res = computeSystem(demoProject(), "supply");
  const s0 = res.segments.find((s) => s.id === "s0");
  const s1 = res.segments.find((s) => s.id === "s1");
  assert.ok(Math.abs(s0.flowM3s - 0.2) < 1e-9, `trunk=${s0.flowM3s}`);
  assert.ok(Math.abs(s1.flowM3s - 0.1) < 1e-9, `branch=${s1.flowM3s}`);
});

test("trunk is sized larger than the branches", () => {
  const res = computeSystem(demoProject(), "supply");
  const s0 = res.segments.find((s) => s.id === "s0");
  const s1 = res.segments.find((s) => s.id === "s1");
  assert.ok(s0.section.diameterMm >= s1.section.diameterMm);
});

test("runout segments feeding terminals use the runout velocity cap", () => {
  const res = computeSystem(demoProject(), "supply");
  const s1 = res.segments.find((s) => s.id === "s1");
  assert.equal(s1.role, "runout");
  assert.ok(s1.velocity <= 3.5 + 1e-6);
});

test("index run static includes friction + terminal loss and sets pressure class", () => {
  const res = computeSystem(demoProject(), "supply");
  assert.ok(res.indexStaticPa > 25, `index=${res.indexStaticPa}`); // at least the terminal loss
  assert.ok(res.totalFlowM3s > 0.19 && res.totalFlowM3s < 0.21);
  assert.equal(res.pressureClass, "A"); // small system, low pressure
  assert.equal(res.marginPa, res.availableStaticPa - res.indexStaticPa);
});

test("system with no plant reports a warning and no index run", () => {
  const p = demoProject();
  p.components = p.components.filter((c) => c.kind !== "ahu");
  const res = computeSystem(p, "supply");
  assert.equal(res.indexStaticPa, 0);
  assert.ok(res.warnings.some((w) => /No plant/.test(w)));
});

test("vertical riser uses the riser velocity band, not the branch band", () => {
  const p = demoProject();
  p.nodes.push({ id: "nR0", x: 0, y: 0, z: 0.3 }, { id: "nR1", x: 0, y: 0, z: 3.5 });
  // isolate a riser off the AHU so geometry is vertical
  p.nodes[0].z = 0.3;
  p.nodes[1].x = 0;
  p.nodes[1].y = 0;
  p.nodes[1].z = 3.5;
  p.settings.velocityCaps = { main: 7, riser: 8, branch: 5, runout: 3.5 };
  p.settings.velocityMins = { main: 3, riser: 4, branch: 2.5, runout: 2 };
  const res = computeSystem(p, "supply");
  const s0 = res.segments.find((s) => s.id === "s0");
  assert.equal(s0.role, "riser");
  assert.equal(s0.maxVelocity, 8);
  assert.equal(s0.minVelocity, 4);
});

test("a lower-flow take-off that is not a terminal leaf is a branch", () => {
  const p = {
    scale: { pxPerMeter: 50 },
    settings: {
      sizingMethod: "velocity",
      ductType: "round",
      supplyTempC: 18,
      velocityCaps: { main: 7, riser: 8, branch: 5, runout: 3.5 },
      velocityMins: { main: 3, riser: 4, branch: 2.5, runout: 2 },
    },
    nodes: [
      { id: "n0", x: 0, y: 0, z: 3 },
      { id: "n1", x: 400, y: 0, z: 3 },
      { id: "n2", x: 800, y: 0, z: 3 },
      { id: "n3", x: 400, y: 400, z: 3 },
      { id: "nA", x: 1000, y: 0, z: 2.7 },
      { id: "nB", x: 400, y: 600, z: 2.7 },
    ],
    segments: [
      { id: "s0", a: "n0", b: "n1", system: "supply", fittings: [] },
      { id: "s1", a: "n1", b: "n2", system: "supply", fittings: [] },
      { id: "s2", a: "n2", b: "nA", system: "supply", fittings: [] },
      { id: "s3", a: "n1", b: "n3", system: "supply", fittings: [] },
      { id: "s4", a: "n3", b: "nB", system: "supply", fittings: [] },
    ],
    components: [
      { id: "c0", kind: "ahu", nodeId: "n0", system: "supply", props: { availableStaticPa: 250, designFlow_ls: 150 } },
      { id: "cA", kind: "diffuser", nodeId: "nA", system: "supply", props: { designFlow_ls: 100, terminalLossPa: 25 } },
      { id: "cB", kind: "diffuser", nodeId: "nB", system: "supply", props: { designFlow_ls: 50, terminalLossPa: 25 } },
    ],
  };
  const res = computeSystem(p, "supply");
  assert.equal(res.segments.find((s) => s.id === "s3").role, "branch");
  assert.equal(res.segments.find((s) => s.id === "s2").role, "runout");
  assert.equal(res.segments.find((s) => s.id === "s0").role, "main");
});

test("AHU duty that does not match terminals raises a warning", () => {
  const p = demoProject();
  p.components[0].props.designFlow_ls = 80;
  const res = computeSystem(p, "supply");
  assert.equal(res.totalFlowM3s, 0.2);
  assert.equal(res.balance.matched, false);
  assert.ok(res.warnings.some((w) => /does not match/.test(w)));
});

test("combined AHU uses separate extract static and warns if supply ≠ extract terminals", () => {
  const p = {
    scale: { pxPerMeter: 50 },
    settings: { sizingMethod: "velocity", ductType: "round", supplyTempC: 18, extractTempC: 22 },
    nodes: [
      { id: "nS", x: 100, y: 0, z: 0.3 },
      { id: "nE", x: 0, y: 0, z: 0.3 },
      { id: "nSo", x: 400, y: 0, z: 2.7 },
      { id: "nEo", x: -200, y: 0, z: 2.7 },
    ],
    segments: [
      { id: "sS", a: "nS", b: "nSo", system: "supply", fittings: [] },
      { id: "sE", a: "nE", b: "nEo", system: "extract", fittings: [] },
    ],
    components: [
      {
        id: "cAHU", kind: "ahu", nodeId: "nS", returnNodeId: "nE", system: "both",
        props: { availableStaticPa: 350, extractStaticPa: 220, designFlow_ls: 100, extractFlow_ls: 80 },
      },
      { id: "cS", kind: "diffuser", nodeId: "nSo", system: "supply", props: { designFlow_ls: 100, terminalLossPa: 20 } },
      { id: "cE", kind: "grille_extract", nodeId: "nEo", system: "extract", props: { designFlow_ls: 80, terminalLossPa: 20 } },
    ],
  };
  const all = computeAll(p);
  assert.equal(all.supply.availableStaticPa, 350);
  assert.equal(all.extract.availableStaticPa, 220);
  assert.equal(all.supply.balance.matched, true);
  assert.equal(all.extract.balance.matched, true);
  p.components[2].props.designFlow_ls = 50;
  const unbalanced = computeAll(p);
  assert.ok(unbalanced.projectWarnings.some((w) => /do not match/.test(w)));
});

test("in-line device adds pressure to the index run", () => {
  const base = computeSystem(demoProject(), "supply");
  const p = demoProject();
  p.components.push({ id: "c3", kind: "fire_damper", nodeId: "n2", system: "supply", props: { lossPa: 40 } });
  const withFd = computeSystem(p, "supply");
  assert.ok(withFd.indexStaticPa > base.indexStaticPa);
});
