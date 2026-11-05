import test from "node:test";
import assert from "node:assert/strict";
import { computeAll } from "../src/calc/network.js";
import { roomPlantId, roomMismatch, roomAirflow } from "../src/rooms.js";
import { sockTakeoff } from "../src/standards/airsock.js";
import { scopeToSystem, buildProjectPdf } from "../src/export/pdf.js";
import { applyPreset, presetFromSock, savePreset, listPresets, deletePreset } from "../src/sockPresets.js";

const mem = new Map();
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };

// Two units. AHU-01 feeds two socks in two rooms (20 x 10 m and 10 x 10 m
// at 50 px/m); AHU-02 feeds one diffuser in room C.
function job(shareBy = "length") {
  const box = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
  return {
    scale: { pxPerMeter: 50 },
    settings: { ductType: "round", sockShareBy: shareBy, sockDropSpacingM: 1.5 },
    nodes: [
      { id: "a0", x: 0, y: 300 }, { id: "a1", x: 200, y: 300 }, { id: "sA", x: 200, y: 250 }, { id: "sB", x: 1100, y: 250 },
      { id: "b0", x: 0, y: 900 }, { id: "b1", x: 300, y: 900 },
    ],
    segments: [
      { id: "s0", a: "a0", b: "a1", system: "supply", fittings: [] },
      { id: "s1", a: "a1", b: "sA", system: "supply", fittings: [] },
      { id: "s2", a: "a1", b: "sB", system: "supply", fittings: [] },
      { id: "s3", a: "b0", b: "b1", system: "supply", fittings: [] },
    ],
    components: [
      { id: "u1", kind: "ahu", nodeId: "a0", system: "supply", tag: "AHU-01", label: "Hall", color: "#7c3aed", props: { availableStaticPa: 300, designFlow_ls: 900 } },
      { id: "u2", kind: "ahu", nodeId: "b0", system: "supply", tag: "AHU-02", label: "Office", color: "#0d9488", props: { availableStaticPa: 300 } },
      // sock A: 8 m from x=200 → centre 400,250, in room A; sock B: 4 m from 1100 → centre 1200,250, in room B
      { id: "kA", kind: "air_sock", nodeId: "sA", system: "supply", x: 400, y: 250, widthM: 8, depthM: 0.4, rot: 0, label: "Sock A", props: { designFlow_ls: 0, ventilatedThroughout: true, suspension: "cable2", basis: "nominal", manufacturer: "Acme", product: "PES", discharge: "perforated" } },
      { id: "kB", kind: "air_sock", nodeId: "sB", system: "supply", x: 1200, y: 250, widthM: 4, depthM: 0.4, rot: 0, label: "Sock B", props: { designFlow_ls: 0, ventilatedThroughout: true, suspension: "track1", basis: "nominal" } },
      { id: "dC", kind: "diffuser", nodeId: "b1", system: "supply", props: { designFlow_ls: 100, terminalLossPa: 25 } },
    ],
    rooms: [
      { id: "rA", name: "Hall A", points: box(100, 0, 1000, 500), supplyFlow_ls: 0, extractFlow_ls: 0, plantId: "u1" },
      { id: "rB", name: "Hall B", points: box(1100, 0, 500, 500), supplyFlow_ls: 0, extractFlow_ls: 0 },
      { id: "rC", name: "Office C", points: box(200, 800, 300, 300), supplyFlow_ls: 0, extractFlow_ls: 0, plantId: "u1" },
    ],
  };
}

const flowOf = (res, node) => res.systems.flatMap((s) => s.terminals).find((t) => t.nodeId === node).flowM3s * 1000;

test("blank socks share by room floor area when asked", () => {
  const byLen = computeAll(job("length"));
  assert.ok(Math.abs(flowOf(byLen, "sA") - 600) < 1e-6); // 8 m of 12 m
  const byArea = computeAll(job("area"));
  // room A 200 m², room B 100 m² → 600 and 300 l/s
  assert.ok(Math.abs(flowOf(byArea, "sA") - 600) < 1e-6);
  assert.ok(Math.abs(flowOf(byArea, "sB") - 300) < 1e-6);
  const p = job("area");
  p.components.find((c) => c.id === "kB").widthM = 10; // longer, same room: area still decides
  assert.ok(Math.abs(flowOf(computeAll(p), "sB") - 300) < 1e-6);
});

test("a sock outside every room falls back to length, with a warning", () => {
  const p = job("area");
  p.rooms = p.rooms.filter((r) => r.id !== "rB");
  const res = computeAll(p);
  assert.ok(Math.abs(flowOf(res, "sA") - 600) < 1e-6);
  assert.ok(res.supply.warnings.some((w) => /not inside a room outline/.test(w)));
});

test("rooms know their system, and a room on the wrong one is flagged", () => {
  const p = job();
  const res = computeAll(p);
  assert.equal(roomPlantId(p, p.rooms[1], res), "u1", "follows its socks");
  assert.deepEqual(roomMismatch(p, p.rooms[2], res), ["u2"], "assigned AHU-01, fed by AHU-02");
  assert.ok(Math.abs(roomAirflow(p, p.rooms[2]).supplyLsM2 - 100 / 36) < 1e-9);
  // a shared sock counts by the air it gets: room A, 600 l/s over 200 m²
  assert.ok(Math.abs(roomAirflow(p, p.rooms[0], res).supplyLsM2 - 3) < 1e-9);
});

test("sock take-off: bodies, suspension runs and drops", () => {
  const p = job();
  const t = sockTakeoff(p, computeAll(p));
  assert.equal(t.inlets, 2);
  assert.equal(t.bodies.reduce((a, g) => a + g.qty, 0), 2);
  const cable = t.suspension.find((g) => g.label === "Suspension cable");
  const track = t.suspension.find((g) => g.label === "Suspension track");
  assert.equal(cable.lengthM, 16); // twin cable on 8 m
  assert.equal(track.lengthM, 4);
  // 8 m twin: 2 × (ceil(8/1.5)+1) = 14; 4 m single: ceil(4/1.5)+1 = 4
  assert.equal(t.drops, 18);
  assert.equal(sockTakeoff(p, computeAll(p), { ahu: "u2" }).inlets, 0);
});

test("a report for one system keeps only that system", async () => {
  const p = job();
  const res = computeAll(p);
  const s = scopeToSystem(p, res, "u2");
  assert.ok(s.results.systems.every((x) => x.plant.id === "u2"));
  assert.deepEqual(s.project.components.map((c) => c.id).sort(), ["dC", "u2"]);
  assert.deepEqual(s.project.rooms, [], "Office C is assigned to AHU-01");
  const blob = buildProjectPdf({ project: p, results: res, planJpeg: null, isoJpeg: null, plantId: "u1" });
  const text = new TextDecoder("latin1").decode(new Uint8Array(await blob.arrayBuffer()));
  assert.ok(text.startsWith("%PDF-1."));
  assert.ok(text.includes("AHU-01 Hall"), "cover names the system");
  assert.ok(!text.includes("AHU-02 Office - Supply"), "the other system is left out");
});

test("presets: save from a sock, apply to another, delete", () => {
  const p = job();
  const a = p.components.find((c) => c.id === "kA");
  a.props.basis = "manufacturer"; a.props.mfrStaticPa = 130; a.props.mfrThrow_m = 9; a.props.mfrNR = 30;
  savePreset(p, presetFromSock(a, "Acme PES perforated"));
  assert.equal(listPresets({}).length, 1, "kept in the browser too");
  const b = p.components.find((c) => c.id === "kB");
  applyPreset(b, listPresets(p)[0]);
  assert.equal(b.props.nominalStaticPa, 130);
  assert.equal(b.props.manufacturer, "Acme");
  assert.equal(b.props.basis, "nominal", "still nominal until the job's own selection is in");
  assert.equal(b.props.typThrow_m, 9);
  deletePreset(p, "Acme PES perforated");
  assert.equal(listPresets(p).length, 0);
});
