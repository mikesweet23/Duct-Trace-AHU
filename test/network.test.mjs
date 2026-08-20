import test from "node:test";
import assert from "node:assert/strict";
import { computeSystem } from "../src/calc/network.js";

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

test("in-line device adds pressure to the index run", () => {
  const base = computeSystem(demoProject(), "supply");
  const p = demoProject();
  p.components.push({ id: "c3", kind: "fire_damper", nodeId: "n2", system: "supply", props: { lossPa: 40 } });
  const withFd = computeSystem(p, "supply");
  assert.ok(withFd.indexStaticPa > base.indexStaticPa);
});
