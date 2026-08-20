import test from "node:test";
import assert from "node:assert/strict";
import {
  displayToLs,
  formatFlow,
  lsToDisplay,
  normalizeFlowUnit,
  plantDutyLs,
  plantStaticPa,
} from "../src/units.js";

test("display unit is only l/s or m3/h", () => {
  assert.equal(normalizeFlowUnit("l/s"), "l/s");
  assert.equal(normalizeFlowUnit("m3/h"), "m3/h");
  assert.equal(normalizeFlowUnit("m3/s"), "l/s");
  assert.equal(normalizeFlowUnit("cfm"), "l/s");
});

test("l/s and m3/h convert without losing the SI value", () => {
  assert.equal(lsToDisplay(1000, "l/s"), 1000);
  assert.equal(lsToDisplay(1000, "m3/h"), 3600);
  assert.equal(displayToLs(3600, "m3/h"), 1000);
  assert.equal(displayToLs(250, "l/s"), 250);
  assert.equal(formatFlow(0.5, "m3/h"), "1800 m³/h");
  assert.equal(formatFlow(0.5, "l/s"), "500 l/s");
});

test("AHU can store different supply and extract flow and Pa", () => {
  const props = {
    designFlow_ls: 480,
    extractFlow_ls: 420,
    availableStaticPa: 350,
    extractStaticPa: 280,
  };
  assert.equal(plantDutyLs(props, "supply"), 480);
  assert.equal(plantDutyLs(props, "extract"), 420);
  assert.equal(plantStaticPa(props, "supply"), 350);
  assert.equal(plantStaticPa(props, "extract"), 280);
});
