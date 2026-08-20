// Unit conversion and formatting helpers.
// Internal calculation units are SI: airflow in m3/s, length in m,
// pressure in Pa, dimensions in mm, velocity in m/s.
//
// The UI toggles only between l/s and m³/h (UK HVAC practice). m³/s is
// kept for the calculation core and for migrating old project files.

export const FLOW_UNITS = {
  "l/s": { label: "l/s", toM3s: (v) => v / 1000, fromM3s: (v) => v * 1000, dp: 0 },
  "m3/h": { label: "m³/h", toM3s: (v) => v / 3600, fromM3s: (v) => v * 3600, dp: 0 },
  "m3/s": { label: "m³/s", toM3s: (v) => v, fromM3s: (v) => v, dp: 3 },
  cfm: { label: "cfm", toM3s: (v) => v * 0.000471947, fromM3s: (v) => v / 0.000471947, dp: 0 },
};

export const DISPLAY_FLOW_UNITS = ["l/s", "m3/h"];

export function normalizeFlowUnit(unit) {
  return unit === "m3/h" ? "m3/h" : "l/s";
}

export function flowUnitLabel(unit) {
  return (FLOW_UNITS[normalizeFlowUnit(unit)] || FLOW_UNITS["l/s"]).label;
}

export function flowToM3s(value, unit) {
  const u = FLOW_UNITS[unit] || FLOW_UNITS["l/s"];
  return u.toM3s(Number(value) || 0);
}

export function flowFromM3s(m3s, unit) {
  const u = FLOW_UNITS[unit] || FLOW_UNITS["l/s"];
  return u.fromM3s(Number(m3s) || 0);
}

export function formatFlow(m3s, unit) {
  const key = normalizeFlowUnit(unit);
  const u = FLOW_UNITS[key];
  const v = u.fromM3s(Number(m3s) || 0);
  return `${round(v, u.dp)} ${u.label}`;
}

export function formatFlowLs(ls, unit) {
  return formatFlow((Number(ls) || 0) / 1000, unit);
}

export function lsToDisplay(ls, unit) {
  return round(flowFromM3s((Number(ls) || 0) / 1000, normalizeFlowUnit(unit)), FLOW_UNITS[normalizeFlowUnit(unit)].dp);
}

export function displayToLs(value, unit) {
  return flowFromM3s(flowToM3s(value, normalizeFlowUnit(unit)), "l/s");
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

// Plant duty stored as l/s. Older files used designFlow in m³/s.
export function plantDutyLs(props, side = "supply") {
  if (!props) return 0;
  if (side === "extract") {
    const ext = Number(props.extractFlow_ls);
    if (ext > 0) return ext;
  }
  const supplyNamed = Number(props.supplyFlow_ls);
  if (side === "supply" && supplyNamed > 0) return supplyNamed;
  const ls = Number(props.designFlow_ls);
  if (ls > 0) return ls;
  const m3s = Number(props.designFlow);
  if (m3s > 0) return m3s * 1000;
  return 0;
}

// Available static (Pa). Dual AHUs can set a different extract ESP.
export function plantStaticPa(props, side = "supply") {
  if (!props) return 0;
  if (side === "extract") {
    const ext = Number(props.extractStaticPa);
    if (Number.isFinite(ext) && ext > 0) return ext;
  }
  const supplyNamed = Number(props.supplyStaticPa);
  if (side === "supply" && Number.isFinite(supplyNamed) && supplyNamed > 0) return supplyNamed;
  return Number(props.availableStaticPa) || 0;
}
