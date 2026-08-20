import test from "node:test";
import assert from "node:assert/strict";
import {
  circularFriction,
  equivalentDiameterMm,
  sizeCircular,
  sizeRectangular,
  frictionFactor,
} from "../src/standards/sizing.js";
import { airDensity } from "../src/units.js";

test("air density falls with temperature", () => {
  assert.ok(Math.abs(airDensity(20) - 1.2) < 1e-9);
  assert.ok(airDensity(40) < airDensity(20));
  assert.ok(airDensity(0) > airDensity(20));
});

test("friction factor is in a sane turbulent range", () => {
  const f = frictionFactor(100000, 0.00015, 0.3);
  assert.ok(f > 0.01 && f < 0.05, `f=${f}`);
});

test("circular friction: velocity matches Q/A", () => {
  // 0.2 m3/s in a 315 mm duct.
  const fr = circularFriction(0.2, 315, { roughnessMm: 0.15, tempC: 20 });
  const area = (Math.PI * 0.315 * 0.315) / 4;
  assert.ok(Math.abs(fr.velocity - 0.2 / area) < 1e-6);
  // ~2.6 m/s in this duct -> a few tenths of a Pa/m.
  assert.ok(fr.gradient > 0.1 && fr.gradient < 5, `gradient=${fr.gradient}`);
});

test("gradient rises steeply with velocity (smaller duct, same flow)", () => {
  const big = circularFriction(0.2, 400, { tempC: 20 });
  const small = circularFriction(0.2, 200, { tempC: 20 });
  assert.ok(small.gradient > big.gradient * 5);
});

test("Huebscher equivalent diameter is between the sides and near-square", () => {
  const de = equivalentDiameterMm(400, 400);
  // Equivalent diameter of a square duct ~ 1.09 * side (roughly).
  assert.ok(de > 400 && de < 460, `de=${de}`);
});

test("sizeCircular (velocity method) respects the velocity cap", () => {
  const r = sizeCircular(0.5, { method: "velocity", maxVelocity: 6 });
  assert.equal(r.shape, "round");
  assert.ok(r.velocity <= 6 + 1e-9, `v=${r.velocity}`);
  // Choosing one size smaller would exceed the cap.
  assert.ok(r.diameterMm >= 315 && r.diameterMm <= 450, `d=${r.diameterMm}`);
});

test("sizeCircular (friction method) meets the target gradient", () => {
  const target = 1.0;
  const r = sizeCircular(0.4, { method: "friction", maxVelocity: 9, targetGradient: target });
  assert.ok(r.gradient <= target + 1e-6, `gradient=${r.gradient}`);
});

test("sizeRectangular keeps aspect ratio within limit and meets velocity cap", () => {
  const r = sizeRectangular(0.6, { method: "velocity", maxVelocity: 6, rectHeight: 300, maxAspect: 4 });
  assert.equal(r.shape, "rect");
  assert.ok(r.velocity <= 6 + 1e-9, `v=${r.velocity}`);
  assert.ok(r.aspect <= 4 + 1e-9, `aspect=${r.aspect}`);
});

test("larger flow selects a larger circular duct", () => {
  const small = sizeCircular(0.1, { method: "velocity", maxVelocity: 6 });
  const large = sizeCircular(1.0, { method: "velocity", maxVelocity: 6 });
  assert.ok(large.diameterMm > small.diameterMm);
});
