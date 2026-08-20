// DW144 / BESA "Specification for Sheet Metal Ductwork" reference data,
// plus CIBSE-derived recommended velocities. Sizes are nominal internal
// dimensions in millimetres.

// Spiral / circular diameters (mm). EN 1506 preferred series plus the
// common UK extras (150, 300, 600) used with DW144 spiral.
export const CIRCULAR_DIAMETERS = [
  63, 80, 100, 125, 140, 150, 160, 180, 200, 224, 250, 280, 300, 315, 350, 355,
  400, 450, 500, 560, 600, 630, 710, 750, 800, 900, 1000, 1120, 1250, 1400,
  1500, 1600, 1800, 2000,
];

// Rectangular / square side dimensions (mm). EN 1505 / DW144: 50 mm steps
// to 1000 mm, then 50–100 mm steps through the large-section range.
export const RECTANGULAR_SIDES = [
  100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 650, 700, 750, 800,
  850, 900, 950, 1000, 1050, 1100, 1150, 1200, 1250, 1300, 1400, 1500, 1600,
  1700, 1800, 1900, 2000, 2100, 2200, 2250, 2300, 2400, 2500, 2600, 2800, 3000,
];

// Square ducts use the same side list (width = height).
export const SQUARE_SIDES = RECTANGULAR_SIDES;

// DW144 pressure classes. Static pressure limits in Pa and the associated
// air leakage class. Max velocity is the specification limit for the class
// (construction / leakage), not a comfort design target.
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

// CIBSE Guide B (2016) recommended air velocities for low-noise commercial
// comfort systems, sense-checked against DW144 construction limits.
//
// Maxima follow Guide B Table 2.16 (mains / branches / run-outs; noise is
// the controlling factor) and Table 2.18 (risers and shafts — unoccupied,
// so a higher velocity is acceptable). DW144 Class A still caps any duct
// at 10 m/s, so the riser design max sits at 8 m/s, below that limit.
//
// Minima are not a DW144 figure. CIBSE / common UK practice uses a floor
// so dust does not drop out (higher on extract and in vertical risers).
export const RECOMMENDED_VELOCITY = {
  main: {
    min: 3.0,
    typical: 6.0,
    max: 7.0,
    source: "CIBSE Guide B Table 2.16 — main ducts in occupied spaces (comfort / NR 35–40)",
  },
  riser: {
    min: 4.0,
    typical: 7.0,
    max: 8.0,
    source: "CIBSE Guide B Table 2.18 — risers / shafts; DW144 Class A construction limit 10 m/s",
  },
  branch: {
    min: 2.5,
    typical: 4.0,
    max: 5.0,
    source: "CIBSE Guide B Table 2.16 — branch ducts (3–5 m/s comfort band)",
  },
  runout: {
    min: 2.0,
    typical: 3.0,
    max: 3.5,
    source: "CIBSE Guide B Table 2.16 — final connections / run-outs",
  },
  terminal: {
    min: 1.5,
    typical: 2.0,
    max: 2.5,
    source: "CIBSE Guide B Table 2.19 — supply / return openings",
  },
};

export const VELOCITY_ROLES = ["main", "riser", "branch", "runout"];

export const VELOCITY_GUIDANCE = [
  "CIBSE Guide B Table 2.16 sets comfort maxima (noise). Typical office: mains ~6–7 m/s, branches 3–5 m/s, run-outs ~3.5 m/s.",
  "CIBSE Guide B Table 2.18 allows higher velocity in risers and shafts (unoccupied). Default riser band is 4–8 m/s.",
  "DW144 Class A construction / leakage limit is 10 m/s and 500 Pa. Classes B/C/D allow 20–40 m/s — those are not comfort targets.",
  "Minimum velocities keep dust in suspension (CIBSE / good practice): higher on extract and in vertical risers than on small supply branches.",
];

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

export function recommendedFor(role) {
  return RECOMMENDED_VELOCITY[role] || RECOMMENDED_VELOCITY.main;
}
