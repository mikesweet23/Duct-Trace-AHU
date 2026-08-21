import test from "node:test";
import assert from "node:assert/strict";
import { computeSystem, computeAll } from "../src/calc/network.js";
import {
  parseLengthM,
  splitStandardLengths,
  engineeringLengthM,
  graphicalLengthM,
  transitionLengthM,
  hasLengthOverride,
} from "../src/fab/lengths.js";
import { generatePhysicalModel } from "../src/fab/generator.js";
import { buildTakeoff, filterPieces } from "../src/fab/takeoff.js";
import { diffPhysicalModels, reviewPhysicalChanges, setPieceOverride } from "../src/fab/change.js";
import { simulatorSummary } from "../src/fab/summary.js";
import { takeoffCsv, takeoffExcelXml, procurementCsv } from "../src/fab/export.js";
import { seedDemo, Store } from "../src/state.js";

function demo() {
  return {
    scale: { pxPerMeter: 50 },
    settings: {
      sizingMethod: "velocity",
      ductType: "round",
      supplyTempC: 18,
      velocityCaps: { main: 7, branch: 5, runout: 3.5 },
      standardStraightLengthM: 3,
      maxTransitionAngleDeg: 15,
      defaultConstructionRound: "spiral",
      estimateSupports: true,
      supportSpacingCircularM: 3,
      defaultInsulation: { type: "", thicknessMm: 0, cladding: "" },
      insulationBySystem: { supply: { type: "", thicknessMm: 0, cladding: "" }, extract: { type: "", thicknessMm: 0, cladding: "" } },
    },
    nodes: [
      { id: "n0", x: 0, y: 0, z: 0.3 },
      { id: "n1", x: 500, y: 0, z: 3.2 },
      { id: "n2", x: 500, y: 250, z: 2.7 },
      { id: "n3", x: 750, y: 0, z: 2.7 },
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

test("parseLengthM accepts metres and millimetres", () => {
  assert.equal(parseLengthM("12.5 m"), 12.5);
  assert.equal(parseLengthM("12.5"), 12.5);
  assert.equal(parseLengthM("12500 mm"), 12.5);
  assert.equal(parseLengthM(""), null);
});

test("11.2 m at 3.0 m standard splits into 3 + a 2.2 m cut", () => {
  const cut = splitStandardLengths(11.2, 3);
  assert.equal(cut.standardCount, 3);
  assert.equal(cut.cutCount, 1);
  assert.equal(cut.cutLengthM, 2.2);
  assert.deepEqual(cut.parts.map((p) => p.lengthM), [3, 3, 3, 2.2]);
});

test("engineering length override is used for friction, not the sketch length", () => {
  const p = demo();
  p.nodes[1].z = 0.3;
  p.segments[0].engineeringLengthM = 17.5;
  const graph = graphicalLengthM(p.nodes[0], p.nodes[1], 50);
  assert.ok(Math.abs(graph - 10) < 1e-6);
  assert.equal(engineeringLengthM(p.segments[0], p.nodes[0], p.nodes[1], 50), 17.5);
  const withOver = computeSystem(p, "supply");
  const s0 = withOver.segments.find((s) => s.id === "s0");
  assert.equal(s0.lengthM, 17.5);
  assert.equal(s0.lengthOverride, true);
  assert.ok(Math.abs(s0.graphicalLengthM - 10) < 1e-6);
  const base = demo();
  base.nodes[1].z = 0.3;
  const without = computeSystem(base, "supply");
  const b0 = without.segments.find((s) => s.id === "s0");
  assert.ok(s0.frictionPa > b0.frictionPa, "longer engineering length must raise friction");
});

test("physical model breaks a long override into standard lengths and a cut", () => {
  const p = demo();
  p.segments[1].engineeringLengthM = 11.2;
  const results = computeAll(p);
  const model = generatePhysicalModel(p, results);
  const straights = model.pieces.filter((x) => x.kind === "straight" && x.segmentId === "s1");
  const std = straights.filter((x) => x.standard);
  const cuts = straights.filter((x) => !x.standard);
  assert.ok(std.length >= 3, `expected ≥3 standard pieces, got ${std.length}`);
  assert.ok(cuts.length >= 1);
  assert.ok(straights.every((x) => x.ref.startsWith("D")));
});

test("size change creates a reducer or square-to-round piece", () => {
  const p = demo();
  p.segments[0].shapeOverride = "round";
  p.segments[0].sizeOverride = { diameterMm: 630 };
  p.segments[1].shapeOverride = "round";
  p.segments[1].sizeOverride = { diameterMm: 500 };
  const results = computeAll(p);
  const model = generatePhysicalModel(p, results);
  const red = model.pieces.filter((x) => x.kind === "reducer" || x.kind === "enlarger");
  assert.ok(red.length >= 1, "expected a circular reducer");
  assert.ok(red[0].ref.startsWith("F"));
});

test("rectangular orientation is stored as width × height, not area", () => {
  const p = demo();
  p.settings.ductType = "rect";
  p.segments[0].shapeOverride = "rect";
  p.segments[0].sizeOverride = { widthMm: 600, heightMm: 400 };
  p.segments[1].shapeOverride = "rect";
  p.segments[1].sizeOverride = { widthMm: 400, heightMm: 600 };
  const results = computeAll(p);
  const model = generatePhysicalModel(p, results);
  const a = model.pieces.find((x) => x.kind === "straight" && x.segmentId === "s0");
  const b = model.pieces.find((x) => x.kind === "straight" && x.segmentId === "s1");
  assert.equal(a.section.widthMm, 600);
  assert.equal(a.section.heightMm, 400);
  assert.equal(b.section.widthMm, 400);
  assert.equal(b.section.heightMm, 600);
  assert.notEqual(a.sizeText, b.sizeText);
});

test("square-to-round is generated when families change", () => {
  const p = demo();
  p.segments[0].shapeOverride = "rect";
  p.segments[0].sizeOverride = { widthMm: 600, heightMm: 500 };
  p.segments[1].shapeOverride = "round";
  p.segments[1].sizeOverride = { diameterMm: 500 };
  const results = computeAll(p);
  const model = generatePhysicalModel(p, results);
  assert.ok(model.pieces.some((x) => x.kind === "sqr_to_round"));
});

test("elevation change becomes an orthogonal drop, not only a diagonal", () => {
  const p = demo();
  const results = computeAll(p);
  const model = generatePhysicalModel(p, results);
  assert.ok(model.pieces.some((x) => x.kind === "elbow" && x.vertical), "expected a drop elbow on the AHU riser");
});

test("takeoff reports standard lengths, joints and boots from the physical model", () => {
  const p = demo();
  p.segments[1].engineeringLengthM = 11.2;
  p.settings.defaultInsulation = { type: "foil faced", thicknessMm: 25, cladding: "" };
  const results = computeAll(p);
  const model = generatePhysicalModel(p, results);
  const takeoff = buildTakeoff(model);
  assert.ok(takeoff.circular.length >= 1);
  assert.ok(takeoff.joints.length >= 1);
  assert.ok(takeoff.boots.length >= 1);
  assert.ok(takeoff.fittings.length >= 1);
  assert.ok(takeoff.rows.every((r) => r.ref));
  assert.ok(takeoff.insulation.some((g) => g.thicknessMm === 25 && g.areaM2 > 0));
  const csv = takeoffCsv(takeoff);
  assert.match(csv, /ref,kind/);
  assert.match(takeoffExcelXml(takeoff), /Workbook/);
  assert.match(procurementCsv(takeoff), /Circular duct/);
});

test("takeoff filters by system", () => {
  const store = new Store();
  seedDemo(store);
  const results = computeAll(store.project);
  const model = generatePhysicalModel(store.project, results);
  const supply = filterPieces(model.pieces, { system: "supply" });
  const extract = filterPieces(model.pieces, { system: "extract" });
  assert.ok(supply.length > 0 && extract.length > 0);
  assert.ok(supply.every((p) => p.system === "supply"));
});

test("engineering change marks physical pieces as pending", () => {
  const p = demo();
  const results = computeAll(p);
  p.physical = generatePhysicalModel(p, results);
  p.segments[0].sizeOverride = { diameterMm: 800 };
  p.segments[0].shapeOverride = "round";
  const review = reviewPhysicalChanges(p, computeAll(p));
  assert.equal(review.stale, true);
  assert.ok(review.pending.length >= 1);
  const next = generatePhysicalModel(p, computeAll(p), { previous: p.physical });
  const diff = diffPhysicalModels(p.physical, next);
  assert.ok(diff.length >= 1);
});

test("manual fitting override is retained on the piece", () => {
  const p = demo();
  const model = generatePhysicalModel(p, computeAll(p));
  const elbow = model.pieces.find((x) => x.kind === "elbow");
  assert.ok(elbow);
  const updated = setPieceOverride(model, elbow.sourceKey, { fittingType: "bend90_mitre", label: "90° mitre bend, unvaned" });
  const again = updated.pieces.find((x) => x.sourceKey === elbow.sourceKey);
  assert.equal(again.fittingType, "bend90_mitre");
  assert.equal(again.manual, true);
});

test("simulator summary distinguishes centreline from fabricated straight", () => {
  const p = demo();
  p.segments[1].engineeringLengthM = 17.5;
  const results = computeAll(p);
  const model = generatePhysicalModel(p, results);
  const sum = simulatorSummary(p, results, model);
  assert.ok(sum.totalCentrelineM > sum.totalGraphicalM);
  assert.ok(sum.physicalComponents > 0);
  assert.ok(sum.boots >= 2);
});

test("transition length grows with size change and shrinks with a steeper angle", () => {
  const long = transitionLengthM(200, 15);
  const short = transitionLengthM(200, 30);
  const tiny = transitionLengthM(40, 15);
  assert.ok(long > short);
  assert.ok(long > tiny);
  assert.ok(tiny >= 0.15);
});

test("hasLengthOverride ignores zero and empty", () => {
  assert.equal(hasLengthOverride({}), false);
  assert.equal(hasLengthOverride({ engineeringLengthM: 0 }), false);
  assert.equal(hasLengthOverride({ engineeringLengthM: 4 }), true);
});
