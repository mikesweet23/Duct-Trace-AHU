import test from "node:test";
import assert from "node:assert/strict";
import { computeSystem, computeAll } from "../src/calc/network.js";
import { resolveBand, warnLevel, warnMessage, DW144_CLASS_B_WARN_MS } from "../src/standards/playbook.js";

function project(extra = {}) {
  return {
    scale: { pxPerMeter: 50 },
    settings: {
      applicationType: "commercial",
      sizingMethod: "hybrid",
      ductType: "round",
      supplyTempC: 18,
      dw144Class: "B",
      targetGradient: 1.0,
      ...(extra.settings || {}),
    },
    rooms: extra.rooms || [],
    nodes: extra.nodes || [
      { id: "n0", x: 0, y: 0, z: 0.3 },
      { id: "n1", x: 500, y: 0, z: 3.2 },
      { id: "n2", x: 500, y: 250, z: 2.7 },
    ],
    segments: extra.segments || [
      { id: "s0", a: "n0", b: "n1", system: "supply", fittings: [] },
      { id: "s1", a: "n1", b: "n2", system: "supply", fittings: [] },
    ],
    components: extra.components || [
      { id: "c0", kind: "ahu", nodeId: "n0", system: "supply", props: { availableStaticPa: 250, designFlow_ls: 200 } },
      { id: "c1", kind: "diffuser", nodeId: "n2", system: "supply", props: { designFlow_ls: 200, terminalLossPa: 25 } },
    ],
  };
}

test("commercial profile keeps riser target with the main, not a quieter branch", () => {
  const main = resolveBand("main", { applicationType: "commercial" });
  const riser = resolveBand("riser", { applicationType: "commercial" });
  const branch = resolveBand("branch", { applicationType: "commercial" });
  assert.equal(main.target, 6.5);
  assert.equal(riser.target, 6.5);
  assert.ok(riser.target > branch.target);
});

test("office / critical profiles step velocities down toward the terminal", () => {
  const office = resolveBand("discharge", { applicationType: "office" });
  const run = resolveBand("runout", { applicationType: "office" });
  const crit = resolveBand("runout", { applicationType: "critical_acoustic" });
  assert.ok(office.target > run.target);
  assert.ok(crit.max < run.max);
});

test("velocityCaps still override the application table (legacy tests)", () => {
  const band = resolveBand("runout", { applicationType: "commercial", velocityCaps: { runout: 3.5 } });
  assert.equal(band.max, 3.5);
});

test("first hop from the AHU is discharge; the leaf is a run-out", () => {
  const res = computeSystem(project(), "supply");
  assert.equal(res.segments.find((s) => s.id === "s0").role, "discharge");
  assert.equal(res.segments.find((s) => s.id === "s1").role, "runout");
  assert.ok(res.segments.find((s) => s.id === "s0").maxVelocity > res.segments.find((s) => s.id === "s1").maxVelocity);
});

test("Class B velocity above 9.5 m/s is a critical construction warning", () => {
  const p = project({
    settings: { applicationType: "commercial", sizingMethod: "velocity", dw144Class: "B", ductType: "round" },
    segments: [{
      id: "s0", a: "n0", b: "n1", system: "supply", fittings: [],
      sizeOverride: { diameterMm: 160 }, sizeLocked: true,
    }],
    components: [
      { id: "c0", kind: "ahu", nodeId: "n0", system: "supply", props: { availableStaticPa: 400, designFlow_ls: 200 } },
      { id: "c1", kind: "diffuser", nodeId: "n1", system: "supply", props: { designFlow_ls: 200, terminalLossPa: 10 } },
    ],
    nodes: [
      { id: "n0", x: 0, y: 0, z: 0.3 },
      { id: "n1", x: 400, y: 0, z: 2.7 },
    ],
  });
  const res = computeSystem(p, "supply");
  const s0 = res.segments.find((s) => s.id === "s0");
  assert.ok(s0.velocity > DW144_CLASS_B_WARN_MS, `v=${s0.velocity}`);
  assert.equal(s0.warnLevel, "critical");
  assert.match(warnMessage(s0.velocity, { max: 8, role: "main", applicationLabel: "General Commercial" }, "critical", { dw144Class: "B" }), /9\.5 m\/s/);
});

test("locked size is not overwritten by auto-size", () => {
  const p = project({
    segments: [{
      id: "s0", a: "n0", b: "n1", system: "supply", fittings: [],
      sizeOverride: { diameterMm: 200 }, sizeLocked: true,
    }],
    components: [
      { id: "c0", kind: "ahu", nodeId: "n0", system: "supply", props: { availableStaticPa: 250, designFlow_ls: 200 } },
      { id: "c1", kind: "diffuser", nodeId: "n1", system: "supply", props: { designFlow_ls: 200, terminalLossPa: 10 } },
    ],
    nodes: [
      { id: "n0", x: 0, y: 0, z: 0.3 },
      { id: "n1", x: 500, y: 0, z: 2.7 },
    ],
  });
  const res = computeSystem(p, "supply");
  const s0 = res.segments.find((s) => s.id === "s0");
  assert.equal(s0.section.diameterMm, 200);
  assert.equal(s0.sizeLocked, true);
});

test("air sock uses the manufacturer flow, diameter and spec Pa", () => {
  const p = project({
    nodes: [
      { id: "n0", x: 0, y: 0, z: 0.3 },
      { id: "n1", x: 200, y: 0, z: 2.8 },
      { id: "n2", x: 700, y: 0, z: 2.8 },
    ],
    segments: [
      { id: "s0", a: "n0", b: "n1", system: "supply", fittings: [] },
      {
        id: "s1", a: "n1", b: "n2", system: "supply", fittings: [],
        ductKind: "sock", sizeLocked: true, sizeOverride: { diameterMm: 400 },
        sock: { designFlow_ls: 150, specPa: 80, diameterMm: 400, heightM: 2.8 },
      },
    ],
    components: [
      { id: "c0", kind: "ahu", nodeId: "n0", system: "supply", props: { availableStaticPa: 250, designFlow_ls: 150 } },
    ],
  });
  const res = computeSystem(p, "supply");
  const s0 = res.segments.find((s) => s.id === "s0");
  const s1 = res.segments.find((s) => s.id === "s1");
  assert.ok(Math.abs(s0.flowM3s - 0.15) < 1e-6, `sheet=${s0.flowM3s}`);
  assert.ok(Math.abs(s1.flowM3s - 0.15) < 1e-6, `sock=${s1.flowM3s}`);
  assert.equal(s1.section.diameterMm, 400);
  assert.equal(s1.ductKind, "sock");
  assert.equal(s1.role, "runout");
  assert.ok(Math.abs(s1.dpPa - 80) < 1e-6, `sock Pa=${s1.dpPa}`);
  assert.ok(res.indexStaticPa >= 80);
});

test("distributed sock leakage reduces flow along the run", () => {
  const p = project({
    nodes: [
      { id: "n0", x: 0, y: 0, z: 0.3 },
      { id: "n1", x: 200, y: 0, z: 2.8 },
      { id: "n2", x: 450, y: 0, z: 2.8 },
      { id: "n3", x: 700, y: 0, z: 2.8 },
    ],
    segments: [
      { id: "s0", a: "n0", b: "n1", system: "supply", fittings: [] },
      { id: "s1", a: "n1", b: "n2", system: "supply", ductKind: "sock", sock: { designFlow_ls: 200, specPa: 60, diameterMm: 500, heightM: 2.8 }, sizeOverride: { diameterMm: 500 }, sizeLocked: true, fittings: [] },
      { id: "s2", a: "n2", b: "n3", system: "supply", ductKind: "sock", sock: { designFlow_ls: 200, specPa: 60, diameterMm: 500, heightM: 2.8 }, sizeOverride: { diameterMm: 500 }, sizeLocked: true, fittings: [] },
    ],
    components: [
      { id: "c0", kind: "ahu", nodeId: "n0", system: "supply", props: { availableStaticPa: 250, designFlow_ls: 200 } },
    ],
  });
  const res = computeSystem(p, "supply");
  const s1 = res.segments.find((s) => s.id === "s1");
  const s2 = res.segments.find((s) => s.id === "s2");
  assert.ok(s1.flowM3s > s2.flowM3s, `${s1.flowM3s} vs ${s2.flowM3s}`);
  assert.ok(Math.abs(s1.flowM3s - 0.2) < 1e-6);
  assert.ok(Math.abs(s1.dpPa - 60) < 1e-6);
  assert.equal(s2.dpPa, 0);
});

test("design summary reports application, method and warning counts", () => {
  const all = computeAll(project());
  assert.equal(all.summary.applicationType, "commercial");
  assert.equal(all.summary.sizingMethod, "hybrid");
  assert.equal(all.summary.mainTarget, 6.5);
  assert.ok(all.summary.totalResistance > 0);
  assert.ok(all.summary.highestVelocity > 0);
});

test("a room application override applies to ducts that end in that room", () => {
  const p = project({
    rooms: [{
      id: "rm", name: "Studio", applicationType: "critical_acoustic",
      points: [{ x: 450, y: 200 }, { x: 600, y: 200 }, { x: 600, y: 320 }, { x: 450, y: 320 }],
    }],
  });
  const res = computeSystem(p, "supply");
  const s1 = res.segments.find((s) => s.id === "s1");
  assert.equal(s1.applicationType, "critical_acoustic");
  assert.ok(s1.maxVelocity <= 2.5);
});

test("warnLevel steps normal → advisory → warning → critical", () => {
  const band = { target: 5, max: 6, min: 2, role: "branch", applicationLabel: "Office" };
  assert.equal(warnLevel(4.8, band, { dw144Class: "B", classMaxVelocity: 20 }), "normal");
  assert.equal(warnLevel(5.4, band, { dw144Class: "B", classMaxVelocity: 20 }), "advisory");
  assert.equal(warnLevel(6.5, band, { dw144Class: "B", classMaxVelocity: 20 }), "warning");
  assert.equal(warnLevel(9.6, band, { dw144Class: "B", classMaxVelocity: 20 }), "critical");
});
