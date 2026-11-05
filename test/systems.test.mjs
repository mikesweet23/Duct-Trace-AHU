import test from "node:test";
import assert from "node:assert/strict";
import { computeAll, memberColor } from "../src/calc/network.js";
import { Store, migrateProject } from "../src/state.js";
import { nextSystemTag, nextSystemColor, systemTitle, SYSTEM_PALETTE } from "../src/systems.js";

// Two AHUs on one floor, each with one diffuser.
function twoSystems(colourBy = "system") {
  return {
    scale: { pxPerMeter: 50 },
    settings: { ductType: "round", colourBy },
    nodes: [
      { id: "a0", x: 0, y: 0 }, { id: "a1", x: 250, y: 0 },
      { id: "b0", x: 0, y: 500 }, { id: "b1", x: 250, y: 500 },
    ],
    segments: [
      { id: "sa", a: "a0", b: "a1", system: "supply", fittings: [] },
      { id: "sb", a: "b0", b: "b1", system: "supply", fittings: [] },
    ],
    components: [
      { id: "ahuA", kind: "ahu", nodeId: "a0", system: "supply", tag: "AHU-01", label: "East offices", color: "#7c3aed", props: { availableStaticPa: 250 } },
      { id: "ahuB", kind: "ahu", nodeId: "b0", system: "supply", tag: "AHU-02", label: "West offices", color: "#0d9488", props: { availableStaticPa: 250 } },
      { id: "dA", kind: "diffuser", nodeId: "a1", system: "supply", props: { designFlow_ls: 100, terminalLossPa: 25 } },
      { id: "dB", kind: "diffuser", nodeId: "b1", system: "supply", props: { designFlow_ls: 80, terminalLossPa: 25 } },
    ],
    rooms: [],
  };
}

test("tags number on per prefix and colours do not repeat", () => {
  assert.equal(nextSystemTag("AHU", []), "AHU-01");
  assert.equal(nextSystemTag("AHU", ["AHU-01", "AHU-07", "HRV-09"]), "AHU-08");
  assert.equal(nextSystemColor([SYSTEM_PALETTE[0]]), SYSTEM_PALETTE[1]);
  assert.equal(systemTitle({ tag: "AHU-01", label: "East" }), "AHU-01 East");
  assert.equal(systemTitle({}, "Air Handling Unit"), "Air Handling Unit");
});

test("systems are named by tag and name, then airstream", () => {
  const res = computeAll(twoSystems());
  const names = res.systems.map((s) => s.name).sort();
  assert.deepEqual(names, ["AHU-01 East offices — Supply", "AHU-02 West offices — Supply"]);
  const a = res.systems.find((s) => s.plant.id === "ahuA");
  assert.equal(a.tag, "AHU-01");
  assert.equal(a.color, "#7c3aed");
});

test("ducts and terminals take their unit's colour, or the airstream's when colouring by airstream", () => {
  const p = twoSystems();
  const res = computeAll(p);
  assert.equal(res.plantOf.seg.get("sa"), "ahuA");
  assert.equal(res.plantOf.comp.get("dB"), "ahuB");
  assert.equal(memberColor(p, res, "seg", "sa", "#1f6fd1"), "#7c3aed");
  assert.equal(memberColor(p, res, "comp", "dB", "#059669"), "#0d9488");
  const q = twoSystems("airstream");
  assert.equal(memberColor(q, computeAll(q), "seg", "sa", "#1f6fd1"), "#1f6fd1");
});

test("a new unit gets the next tag and an unused colour; an old file is given them on open", () => {
  const store = new Store();
  store.project = migrateProject({ scale: { pxPerMeter: 50 }, nodes: [], segments: [], components: [] });
  const a = store.addComponentAt({ x: 0, y: 0 }, "ahu", "both");
  const b = store.addComponentAt({ x: 400, y: 0 }, "ahu", "both");
  const h = store.addComponentAt({ x: 800, y: 0 }, "hrv", "both");
  assert.equal(a.tag, "AHU-01");
  assert.equal(b.tag, "AHU-02");
  assert.equal(h.tag, "HRV-01");
  assert.equal(new Set([a.color, b.color, h.color]).size, 3);
  const d = store.addComponentAt({ x: 0, y: 300 }, "diffuser", "supply");
  assert.equal(d.tag, undefined, "terminals are not systems");

  const old = twoSystems();
  for (const c of old.components) { delete c.tag; delete c.color; }
  const m = migrateProject(old);
  const units = m.components.filter((c) => c.kind === "ahu");
  assert.deepEqual(units.map((c) => c.tag), ["AHU-01", "AHU-02"]);
  assert.ok(units.every((c) => /^#/.test(c.color)));
});
