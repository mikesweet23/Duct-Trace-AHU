// DW144 / BESA "Specification for Sheet Metal Ductwork" reference data,
// plus CIBSE-derived recommended velocities. Sizes are nominal internal
// dimensions in millimetres.

// Standard spiral-wound / circular duct diameters (mm).
export const CIRCULAR_DIAMETERS = [
  63, 80, 100, 125, 140, 150, 160, 180, 200, 224, 250, 280, 300, 315, 355, 400,
  450, 500, 560, 600, 630, 710, 800, 900, 1000, 1120, 1250, 1400, 1600,
];

// Standard rectangular duct side dimensions (mm). Rectangular ducts are made
// up from a width and a height each taken from this list.
export const RECTANGULAR_SIDES = [
  100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 700, 800, 900, 1000,
  1100, 1200, 1250, 1400, 1500, 1600, 1800, 2000, 2250, 2500,
];

// DW144 pressure classes. Static pressure limits in Pa and the associated
// air leakage class. Max velocity is the specification limit for the class.
export const PRESSURE_CLASSES = {
  A: { name: "Class A — Low pressure", maxPressure: 500, maxVelocity: 10, leakage: "A" },
  B: { name: "Class B — Medium pressure", maxPressure: 1000, maxVelocity: 20, leakage: "B" },
  C: { name: "Class C — High pressure", maxPressure: 2000, maxVelocity: 40, leakage: "C" },
  D: { name: "Class D — High pressure", maxPressure: 2500, maxVelocity: 40, leakage: "C" },
};

// DW144 air leakage limits: max leakage factor (l/s per m2 of duct surface)
// at the test pressure. limit = c * p^0.65 where p is in Pa.
export const LEAKAGE_FACTORS = {
  A: 0.027,
  B: 0.009,
  C: 0.003,
  D: 0.001,
};

// CIBSE Guide B recommended maximum air velocities (m/s) for low-noise
// commercial systems, by duct role. Used for sizing caps and warnings.
export const RECOMMENDED_VELOCITY = {
  main: { max: 7.0, typical: 6.0 },
  branch: { max: 5.0, typical: 4.0 },
  runout: { max: 3.5, typical: 3.0 },
  terminal: { max: 2.5, typical: 2.0 },
};

// Surface roughness (mm) by material for pressure-drop calculation.
export const ROUGHNESS_MM = {
  galvanised: 0.15,
  spiral: 0.09,
  aluminium: 0.05,
  flexible: 3.0,
  ductboard: 0.9,
};

export function nearestCircularUp(diameterMm) {
  for (const d of CIRCULAR_DIAMETERS) {
    if (d >= diameterMm - 1e-6) return d;
  }
  return CIRCULAR_DIAMETERS[CIRCULAR_DIAMETERS.length - 1];
}

export function nearestRectSideUp(sideMm) {
  for (const s of RECTANGULAR_SIDES) {
    if (s >= sideMm - 1e-6) return s;
  }
  return RECTANGULAR_SIDES[RECTANGULAR_SIDES.length - 1];
}

// Leakage allowance (l/s) for a given surface area (m2) at test pressure (Pa).
export function leakageAllowance(surfaceAreaM2, testPressurePa, leakageClass) {
  const c = LEAKAGE_FACTORS[leakageClass] ?? LEAKAGE_FACTORS.B;
  const factor = c * Math.pow(Math.max(0, testPressurePa), 0.65); // l/s per m2
  return factor * surfaceAreaM2;
}

export function pressureClassFor(pressurePa) {
  const p = Math.abs(pressurePa);
  if (p <= PRESSURE_CLASSES.A.maxPressure) return "A";
  if (p <= PRESSURE_CLASSES.B.maxPressure) return "B";
  if (p <= PRESSURE_CLASSES.C.maxPressure) return "C";
  return "D";
}
