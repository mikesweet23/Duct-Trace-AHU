// Unit conversion and formatting helpers.
// Internal calculation units are SI: airflow in m3/s, length in m,
// pressure in Pa, dimensions in mm, velocity in m/s.

export const FLOW_UNITS = {
  "l/s": { label: "l/s", toM3s: (v) => v / 1000, fromM3s: (v) => v * 1000, dp: 0 },
  "m3/h": { label: "m³/h", toM3s: (v) => v / 3600, fromM3s: (v) => v * 3600, dp: 0 },
  "m3/s": { label: "m³/s", toM3s: (v) => v, fromM3s: (v) => v, dp: 3 },
  cfm: { label: "cfm", toM3s: (v) => v * 0.000471947, fromM3s: (v) => v / 0.000471947, dp: 0 },
};

export function flowToM3s(value, unit) {
  const u = FLOW_UNITS[unit] || FLOW_UNITS["l/s"];
  return u.toM3s(value);
}

export function flowFromM3s(m3s, unit) {
  const u = FLOW_UNITS[unit] || FLOW_UNITS["l/s"];
  return u.fromM3s(m3s);
}

export function formatFlow(m3s, unit) {
  const u = FLOW_UNITS[unit] || FLOW_UNITS["l/s"];
  const v = u.fromM3s(m3s);
  return `${round(v, u.dp)} ${u.label}`;
}

export function round(value, dp = 2) {
  if (!isFinite(value)) return value;
  const f = Math.pow(10, dp);
  return Math.round(value * f) / f;
}

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// Air density (kg/m3) from dry-bulb temperature (deg C) at ~sea level,
// referenced to 1.2 kg/m3 at 20 C (ideal gas, constant pressure).
export function airDensity(tempC) {
  const T = 273.15 + (isFinite(tempC) ? tempC : 20);
  return 1.2 * (293.15 / T);
}

// Dynamic viscosity of air (Pa.s) via Sutherland's law.
export function airViscosity(tempC) {
  const T = 273.15 + (isFinite(tempC) ? tempC : 20);
  const T0 = 273.15;
  const mu0 = 1.716e-5;
  const S = 110.4;
  return mu0 * Math.pow(T / T0, 1.5) * ((T0 + S) / (T + S));
}
