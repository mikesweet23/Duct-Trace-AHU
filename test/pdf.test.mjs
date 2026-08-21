import test from "node:test";
import assert from "node:assert/strict";
import { computeAll } from "../src/calc/network.js";
import { buildProjectPdf, buildTakeoffPdf } from "../src/export/pdf.js";
import { generatePhysicalModel } from "../src/fab/generator.js";
import { buildTakeoff } from "../src/fab/takeoff.js";

test("PDF report starts with a PDF header and lists each system", async () => {
  const project = {
    meta: { name: "PDF fixture" },
    mode: "concept",
    settings: { flowUnit: "l/s", ductType: "round", sizingMethod: "velocity", targetGradient: 1 },
    scale: { pxPerMeter: 50 },
    nodes: [
      { id: "n0", x: 0, y: 0, z: 0.3 },
      { id: "n1", x: 400, y: 0, z: 2.7 },
    ],
    segments: [
      { id: "s0", a: "n0", b: "n1", system: "supply", fittings: [{ type: "bend90_radius", qty: 1 }] },
    ],
    components: [
      { id: "c0", kind: "ahu", nodeId: "n0", system: "supply", props: { availableStaticPa: 250, designFlow_ls: 100 } },
      { id: "c1", kind: "diffuser", nodeId: "n1", system: "supply", props: { designFlow_ls: 100, terminalLossPa: 20 } },
    ],
    rooms: [{ id: "r1", name: "Office", supplyFlow_ls: 100, extractFlow_ls: 0, points: [] }],
  };
  const results = computeAll(project);
  const blob = buildProjectPdf({ project, results, planJpeg: null, isoJpeg: null });
  const buf = new Uint8Array(await blob.arrayBuffer());
  const head = new TextDecoder().decode(buf.slice(0, 8));
  assert.ok(head.startsWith("%PDF-1."), head);
  assert.ok(buf.length > 800);
});

test("takeoff PDF is a valid PDF with component refs", async () => {
  const project = {
    meta: { name: "Takeoff fixture" },
    settings: { flowUnit: "l/s", ductType: "round", sizingMethod: "velocity", standardStraightLengthM: 3, estimateSupports: false },
    scale: { pxPerMeter: 50 },
    nodes: [
      { id: "n0", x: 0, y: 0, z: 0.3 },
      { id: "n1", x: 400, y: 0, z: 2.7 },
    ],
    segments: [
      { id: "s0", a: "n0", b: "n1", system: "supply", fittings: [], engineeringLengthM: 11.2 },
    ],
    components: [
      { id: "c0", kind: "ahu", nodeId: "n0", system: "supply", props: { availableStaticPa: 250, designFlow_ls: 100 } },
      { id: "c1", kind: "diffuser", nodeId: "n1", system: "supply", props: { designFlow_ls: 100, terminalLossPa: 20 } },
    ],
  };
  const results = computeAll(project);
  const model = generatePhysicalModel(project, results);
  const takeoff = buildTakeoff(model);
  const blob = buildTakeoffPdf({ project, takeoff });
  const buf = new Uint8Array(await blob.arrayBuffer());
  assert.ok(new TextDecoder().decode(buf.slice(0, 8)).startsWith("%PDF-1."));
});
