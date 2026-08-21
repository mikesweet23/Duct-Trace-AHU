import test from "node:test";
import assert from "node:assert/strict";
import { Store, seedDemo } from "../src/state.js";
import { applyConstruction, downstreamSegments, setSegmentConstruction } from "../src/construction.js";

test("deleting the demo fire damper keeps the supply trunk and branches", () => {
  const store = new Store();
  seedDemo(store);
  const before = store.project.segments.length;
  const trunk = store.project.segments.filter((s) => ["sT0", "sT1", "sB1"].includes(s.id));
  assert.equal(trunk.length, 3);
  store.select("component", "cFD");
  store.deleteSelection();
  assert.equal(store.project.components.some((c) => c.id === "cFD"), false);
  assert.equal(store.project.segments.length, before);
  assert.ok(store.project.segments.some((s) => s.id === "sT0"));
  assert.ok(store.project.segments.some((s) => s.id === "sT1"));
  assert.ok(store.project.segments.some((s) => s.id === "sB1"));
});

test("deleting a terminal keeps its duct", () => {
  const store = new Store();
  seedDemo(store);
  const before = store.project.segments.length;
  store.select("component", "cD1");
  store.deleteSelection();
  assert.equal(store.project.components.some((c) => c.id === "cD1"), false);
  assert.equal(store.project.segments.length, before);
  assert.ok(store.project.segments.some((s) => s.id === "sB1"));
});

test("deleting the AHU does not strip the duct network", () => {
  const store = new Store();
  seedDemo(store);
  const before = store.project.segments.length;
  store.select("component", "cAHU");
  store.deleteSelection();
  assert.equal(store.project.components.some((c) => c.id === "cAHU"), false);
  assert.equal(store.project.segments.length, before);
});

test("section construction override does not change other lengths", () => {
  const store = new Store();
  seedDemo(store);
  const trunk = store.project.segments.find((s) => s.id === "sT1");
  const branch = store.project.segments.find((s) => s.id === "sB1");
  store.setSegmentConstruction(branch, "spiral");
  assert.equal(trunk.shapeOverride, null);
  assert.equal(branch.shapeOverride, "round");
  assert.equal(branch.constructionType, "spiral");
  store.project.settings.ductType = "rect";
  assert.equal(trunk.shapeOverride, null, "trunk still follows the new project default");
  assert.equal(branch.shapeOverride, "round", "the overridden leg stays spiral");
});

test("apply to branch changes the take-off and its downstream run-out only", () => {
  const store = new Store();
  seedDemo(store);
  const branch = store.project.segments.find((s) => s.id === "sB1");
  const changed = applyConstruction(store.project, branch, "rectangular", "branch");
  const ids = changed.map((s) => s.id).sort();
  assert.deepEqual(ids, ["sB1"]);
  assert.equal(branch.shapeOverride, "rect");
  assert.equal(store.project.segments.find((s) => s.id === "sT1").shapeOverride, null);
  assert.equal(store.project.segments.find((s) => s.id === "sB2").shapeOverride, null);
});

test("apply to a trunk section walks downstream to its take-offs", () => {
  const store = new Store();
  seedDemo(store);
  const trunk = store.project.segments.find((s) => s.id === "sT1");
  const ids = downstreamSegments(store.project, trunk).map((s) => s.id).sort();
  assert.ok(ids.includes("sT1"));
  assert.ok(ids.includes("sB2"));
  assert.ok(ids.includes("sB3"));
  assert.ok(ids.includes("sB4"));
  assert.equal(ids.includes("sT0"), false);
  assert.equal(ids.includes("sB1"), false);
});

test("clearing construction returns a length to the project default", () => {
  const seg = { shapeOverride: "rect", constructionType: "rectangular", sizeOverride: { widthMm: 600, heightMm: 400 } };
  setSegmentConstruction(seg, null);
  assert.equal(seg.shapeOverride, null);
  assert.equal(seg.constructionType, null);
});
