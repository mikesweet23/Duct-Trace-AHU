// HVAC component library. Each component kind has a category, default
// properties, and how it contributes to the network (plant = system source,
// terminal = leaf demand, inline = pressure loss on the run).

export const CATEGORIES = {
  plant: "Plant",
  terminal: "Terminals",
  inline: "In-line devices",
};

// role:
//   "plant"    -> system root (fan / AHU). Provides available static pressure.
//   "terminal" -> demand point (diffuser / grille / outlet). Carries design flow.
//   "inline"   -> device on a run that adds a fixed / K-based pressure loss.
export const COMPONENTS = {
  ahu: {
    kind: "ahu",
    label: "Air Handling Unit",
    category: "plant",
    role: "plant",
    symbol: "AHU",
    color: "#2563eb",
    foot: { w: 2.0, d: 1.2, t: 1.3 },
    props: {
      availableStaticPa: 250, // supply ESP
      extractStaticPa: 250,
      designFlow_ls: 0, // supply duty; 0 = follow connected outlets
      extractFlow_ls: 0, // extract duty; 0 = follow connected inlets
      supplyTempC: 18,
      returnTempC: 22,
      note: "",
    },
  },
  fan_centrifugal: {
    kind: "fan_centrifugal",
    label: "Centrifugal fan",
    category: "plant",
    role: "plant",
    symbol: "FAN",
    color: "#2563eb",
    foot: { w: 0.9, d: 0.7, t: 0.8 },
    props: { availableStaticPa: 400, designFlow_ls: 0, note: "" },
  },
  fan_axial: {
    kind: "fan_axial",
    label: "Axial fan",
    category: "plant",
    role: "plant",
    symbol: "AXF",
    color: "#2563eb",
    foot: { w: 0.7, d: 0.7, t: 0.5 },
    props: { availableStaticPa: 200, designFlow_ls: 0, note: "" },
  },
  fan_plug: {
    kind: "fan_plug",
    label: "EC plug fan",
    category: "plant",
    role: "plant",
    symbol: "ECP",
    color: "#2563eb",
    foot: { w: 0.8, d: 0.6, t: 0.7 },
    props: { availableStaticPa: 350, designFlow_ls: 0, note: "" },
  },
  diffuser: {
    kind: "diffuser",
    label: "Supply diffuser",
    category: "terminal",
    role: "terminal",
    symbol: "◇",
    color: "#059669",
    foot: { w: 0.6, d: 0.6, t: 0.15 },
    props: { designFlow_ls: 40, terminalLossPa: 25, throw_m: 0, note: "" },
  },
  grille_supply: {
    kind: "grille_supply",
    label: "Supply grille",
    category: "terminal",
    role: "terminal",
    symbol: "▷",
    color: "#059669",
    foot: { w: 0.4, d: 0.2, t: 0.12 },
    props: { designFlow_ls: 40, terminalLossPa: 20, note: "" },
  },
  grille_extract: {
    kind: "grille_extract",
    label: "Extract grille",
    category: "terminal",
    role: "terminal",
    symbol: "◁",
    color: "#d97706",
    foot: { w: 0.4, d: 0.2, t: 0.12 },
    props: { designFlow_ls: 40, terminalLossPa: 20, note: "" },
  },
  valve_extract: {
    kind: "valve_extract",
    label: "Extract valve",
    category: "terminal",
    role: "terminal",
    symbol: "⊗",
    color: "#d97706",
    foot: { w: 0.2, d: 0.2, t: 0.1 },
    props: { designFlow_ls: 15, terminalLossPa: 30, note: "" },
  },
  louvre: {
    kind: "louvre",
    label: "Louvre / outlet",
    category: "terminal",
    role: "terminal",
    symbol: "☰",
    color: "#059669",
    foot: { w: 0.6, d: 0.3, t: 0.2 },
    props: { designFlow_ls: 100, terminalLossPa: 15, note: "" },
  },
  fire_damper: {
    kind: "fire_damper",
    label: "Fire damper",
    category: "inline",
    role: "inline",
    symbol: "FD",
    color: "#dc2626",
    foot: { w: 0.35, d: 0.2, t: 0.2 },
    props: { lossPa: 15, k: 0, note: "" },
  },
  vcd: {
    kind: "vcd",
    label: "Volume control damper",
    category: "inline",
    role: "inline",
    symbol: "VCD",
    color: "#7c3aed",
    foot: { w: 0.3, d: 0.18, t: 0.18 },
    props: { lossPa: 10, k: 0, note: "" },
  },
  attenuator: {
    kind: "attenuator",
    label: "Attenuator / silencer",
    category: "inline",
    role: "inline",
    symbol: "ATT",
    color: "#0891b2",
    foot: { w: 0.9, d: 0.35, t: 0.35 },
    props: { lossPa: 30, k: 0, note: "" },
  },
  plenum: {
    kind: "plenum",
    label: "Plenum box",
    category: "inline",
    role: "inline",
    symbol: "PL",
    color: "#475569",
    foot: { w: 0.6, d: 0.4, t: 0.3 },
    props: { lossPa: 10, k: 0, note: "" },
  },
  heater: {
    kind: "heater",
    label: "Heater / coil",
    category: "inline",
    role: "inline",
    symbol: "HTR",
    color: "#ea580c",
    foot: { w: 0.5, d: 0.3, t: 0.3 },
    props: { lossPa: 40, k: 0, note: "" },
  },
  filter: {
    kind: "filter",
    label: "Filter section",
    category: "inline",
    role: "inline",
    symbol: "FLT",
    color: "#64748b",
    foot: { w: 0.5, d: 0.3, t: 0.35 },
    props: { lossPa: 60, k: 0, note: "" },
  },
};

export function componentDef(kind) {
  return COMPONENTS[kind] || null;
}

export function defaultProps(kind) {
  const def = COMPONENTS[kind];
  return def ? JSON.parse(JSON.stringify(def.props)) : {};
}

export function componentsByCategory() {
  const groups = {};
  for (const key of Object.keys(CATEGORIES)) groups[key] = [];
  for (const c of Object.values(COMPONENTS)) {
    (groups[c.category] || (groups[c.category] = [])).push(c);
  }
  return groups;
}

// Pressure loss (Pa) added by an in-line component given the local dynamic
// pressure. Uses an explicit lossPa plus an optional K * dynamic pressure.
export function inlineLossPa(props, dynamicPressurePa) {
  const fixed = Number(props?.lossPa) || 0;
  const k = Number(props?.k) || 0;
  return fixed + k * (dynamicPressurePa || 0);
}
