// Duct sizing and pressure-drop engine.
//
// Pressure drop uses the Darcy-Weisbach equation with the Colebrook-White
// friction factor (Swamee-Jain explicit approximation), the standard method
// used by CIBSE Guide C for duct friction. Rectangular ducts use the
// Huebscher circular equivalent diameter for friction.

import { airDensity, airViscosity, round } from "../units.js";
import {
  CIRCULAR_DIAMETERS,
  RECTANGULAR_SIDES,
  nearestCircularUp,
  nearestRectSideUp,
} from "./dw144.js";

// Swamee-Jain explicit approximation of the Colebrook-White equation.
export function frictionFactor(reynolds, roughnessM, diameterM) {
  if (reynolds < 2300) {
    // Laminar (rare in ducts, but keep it continuous).
    return 64 / Math.max(reynolds, 1);
  }
  const rel = roughnessM / (3.7 * diameterM);
  const term = rel + 5.74 / Math.pow(reynolds, 0.9);
  const denom = Math.pow(Math.log10(term), 2);
  return 0.25 / denom;
}

// Circular equivalent diameter for a rectangular duct (Huebscher), mm.
export function equivalentDiameterMm(widthMm, heightMm) {
  const a = widthMm;
  const b = heightMm;
  return 1.3 * Math.pow(a * b, 0.625) / Math.pow(a + b, 0.25);
}

// Core friction gradient (Pa/m) for a circular section of diameter d (mm)
// carrying flow (m3/s), plus the derived velocity, Re, etc.
export function circularFriction(flowM3s, diameterMm, opts = {}) {
  const density = opts.density ?? airDensity(opts.tempC ?? 20);
  const viscosity = opts.viscosity ?? airViscosity(opts.tempC ?? 20);
  const roughnessM = (opts.roughnessMm ?? 0.15) / 1000;
  const d = diameterMm / 1000;
  const area = (Math.PI * d * d) / 4;
  const velocity = flowM3s / area;
  const reynolds = (density * velocity * d) / viscosity;
  const f = frictionFactor(reynolds, roughnessM, d);
  const gradient = f * (1 / d) * 0.5 * density * velocity * velocity; // Pa/m
  return { velocity, reynolds, frictionFactor: f, gradient, area, density };
}

// Friction for a rectangular section using the equivalent diameter for the
// friction term but the true area for velocity.
export function rectangularFriction(flowM3s, widthMm, heightMm, opts = {}) {
  const density = opts.density ?? airDensity(opts.tempC ?? 20);
  const viscosity = opts.viscosity ?? airViscosity(opts.tempC ?? 20);
  const roughnessM = (opts.roughnessMm ?? 0.15) / 1000;
  const area = (widthMm / 1000) * (heightMm / 1000);
  const velocity = flowM3s / area;
  const de = equivalentDiameterMm(widthMm, heightMm) / 1000;
  const reynolds = (density * velocity * de) / viscosity;
  const f = frictionFactor(reynolds, roughnessM, de);
  const gradient = f * (1 / de) * 0.5 * density * velocity * velocity;
  return { velocity, reynolds, frictionFactor: f, gradient, area, equivDiameterMm: de * 1000, density };
}

export function dynamicPressure(velocity, density) {
  return 0.5 * density * velocity * velocity;
}

// Size a circular duct for a target flow.
// method: "velocity" picks the smallest standard diameter whose velocity is
// <= maxVelocity. "friction" picks the smallest standard diameter meeting the
// target gradient AND the velocity cap.
export function sizeCircular(flowM3s, opts = {}) {
  const method = opts.method ?? "friction";
  const maxVelocity = opts.maxVelocity ?? 7;
  const target = opts.targetGradient ?? 1.0; // Pa/m
  const warnings = [];
  let chosen = null;

  for (const d of CIRCULAR_DIAMETERS) {
    const fr = circularFriction(flowM3s, d, opts);
    const velOk = fr.velocity <= maxVelocity;
    const fricOk = fr.gradient <= target;
    if (method === "velocity" ? velOk : velOk && fricOk) {
      chosen = { diameterMm: d, ...fr };
      break;
    }
  }

  if (!chosen) {
    // Nothing met both constraints; fall back to the smallest that meets the
    // velocity cap, else the largest available.
    for (const d of CIRCULAR_DIAMETERS) {
      const fr = circularFriction(flowM3s, d, opts);
      if (fr.velocity <= maxVelocity) {
        chosen = { diameterMm: d, ...fr };
        warnings.push("Friction target could not be met within velocity cap.");
        break;
      }
    }
  }
  if (!chosen) {
    const d = CIRCULAR_DIAMETERS[CIRCULAR_DIAMETERS.length - 1];
    const fr = circularFriction(flowM3s, d, opts);
    chosen = { diameterMm: d, ...fr };
    warnings.push("Flow exceeds largest standard diameter; velocity too high.");
  }

  return {
    shape: "round",
    diameterMm: chosen.diameterMm,
    areaM2: chosen.area,
    velocity: chosen.velocity,
    gradient: chosen.gradient,
    reynolds: chosen.reynolds,
    equivDiameterMm: chosen.diameterMm,
    warnings,
  };
}

// Size a rectangular duct. The height is fixed (nearest standard) and the
// width is increased through the standard sizes until constraints are met and
// the aspect ratio stays within maxAspect (bumping the height if needed).
export function sizeRectangular(flowM3s, opts = {}) {
  const method = opts.method ?? "friction";
  const maxVelocity = opts.maxVelocity ?? 7;
  const target = opts.targetGradient ?? 1.0;
  const maxAspect = opts.maxAspect ?? 4;
  const warnings = [];

  const heightStart = nearestRectSideUp(opts.rectHeight ?? 250);
  const heightOptions = RECTANGULAR_SIDES.filter((h) => h >= heightStart);

  for (const height of heightOptions) {
    for (const width of RECTANGULAR_SIDES) {
      if (width < height && opts.preferWide !== false) {
        // Prefer width >= height for typical flat commercial ducts.
      }
      const fr = rectangularFriction(flowM3s, width, height, opts);
      const aspect = Math.max(width, height) / Math.min(width, height);
      if (aspect > maxAspect) continue;
      const velOk = fr.velocity <= maxVelocity;
      const fricOk = fr.gradient <= target;
      if (method === "velocity" ? velOk : velOk && fricOk) {
        return {
          shape: "rect",
          widthMm: width,
          heightMm: height,
          areaM2: fr.area,
          velocity: fr.velocity,
          gradient: fr.gradient,
          reynolds: fr.reynolds,
          equivDiameterMm: fr.equivDiameterMm,
          aspect: round(aspect, 2),
          warnings,
        };
      }
    }
  }

  // Fallback: largest section within aspect limit.
  const height = heightOptions[heightOptions.length - 1];
  const width = RECTANGULAR_SIDES[RECTANGULAR_SIDES.length - 1];
  const fr = rectangularFriction(flowM3s, width, height, opts);
  warnings.push("Could not meet constraints within standard sizes.");
  return {
    shape: "rect",
    widthMm: width,
    heightMm: height,
    areaM2: fr.area,
    velocity: fr.velocity,
    gradient: fr.gradient,
    reynolds: fr.reynolds,
    equivDiameterMm: fr.equivDiameterMm,
    aspect: round(Math.max(width, height) / Math.min(width, height), 2),
    warnings,
  };
}

export function sizeDuct(flowM3s, opts = {}) {
  if (flowM3s <= 0) {
    return {
      shape: opts.shape === "rect" ? "rect" : "round",
      diameterMm: opts.shape === "rect" ? undefined : 0,
      widthMm: opts.shape === "rect" ? 0 : undefined,
      heightMm: opts.shape === "rect" ? 0 : undefined,
      areaM2: 0,
      velocity: 0,
      gradient: 0,
      reynolds: 0,
      equivDiameterMm: 0,
      warnings: ["No flow assigned."],
    };
  }
  return opts.shape === "rect"
    ? sizeRectangular(flowM3s, opts)
    : sizeCircular(flowM3s, opts);
}

// Friction for an already-fixed section (used when a size is overridden).
export function frictionForSection(flowM3s, section, opts = {}) {
  if (section.shape === "rect") {
    return rectangularFriction(flowM3s, section.widthMm, section.heightMm, opts);
  }
  return circularFriction(flowM3s, section.diameterMm, opts);
}
