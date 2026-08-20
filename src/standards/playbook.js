// Ductwork design playbook: application profiles, role hierarchy, hybrid
// limits and DW144 warning thresholds. CIBSE Guide B velocity philosophy
// (higher where air is concentrated / noise-tolerant, then step down toward
// occupied terminals) with DW144 construction checks.

export const DUCT_ROLES = [
  "discharge",
  "main",
  "riser",
  "branch",
  "secondary",
  "runout",
  "terminal",
];

export const ROLE_LABELS = {
  discharge: "AHU / fan discharge",
  main: "Main distribution",
  riser: "Vertical riser",
  branch: "Primary branch",
  secondary: "Secondary branch",
  runout: "Final run to terminal",
  terminal: "Terminal connection",
};

export const FRICTION_PRESETS = [0.6, 0.8, 1.0, 1.2];

// Class B construction review threshold (playbook §11). DW144 Class B
// still allows up to 20 m/s; 9.5 m/s is the design-review flag.
export const DW144_CLASS_B_WARN_MS = 9.5;

function band(target, max, min = 2.0) {
  return { target, max, min };
}

const COMMERCIAL = {
  discharge: band(7.0, 8.0, 4.0),
  main: band(6.5, 7.5, 3.0),
  riser: band(6.5, 8.0, 4.0),
  branch: band(5.0, 6.0, 2.5),
  secondary: band(4.0, 5.0, 2.5),
  runout: band(3.0, 4.0, 2.0),
  terminal: band(2.5, 3.0, 1.5),
};

const INDUSTRIAL = {
  discharge: band(9.0, 10.0, 5.0),
  main: band(8.0, 9.5, 4.0),
  riser: band(8.0, 9.5, 4.5),
  branch: band(6.5, 8.0, 3.0),
  secondary: band(5.0, 6.5, 2.5),
  runout: band(4.0, 5.0, 2.0),
  terminal: band(3.0, 4.0, 1.5),
};

const OFFICE = {
  discharge: band(6.0, 7.0, 3.5),
  main: band(5.5, 6.5, 3.0),
  riser: band(5.5, 7.0, 3.5),
  branch: band(4.5, 5.0, 2.5),
  secondary: band(3.5, 4.5, 2.0),
  runout: band(2.5, 3.5, 1.8),
  terminal: band(2.0, 3.0, 1.5),
};

const CRITICAL = {
  discharge: band(4.5, 5.5, 3.0),
  main: band(4.0, 5.0, 2.5),
  riser: band(4.0, 5.5, 3.0),
  branch: band(3.0, 3.5, 2.0),
  secondary: band(2.5, 3.0, 1.8),
  runout: band(2.0, 2.5, 1.5),
  terminal: band(1.5, 2.0, 1.2),
};

const HEAVY = {
  discharge: band(9.5, 10.0, 5.0),
  main: band(8.5, 9.5, 4.5),
  riser: band(8.5, 9.5, 5.0),
  branch: band(7.0, 8.5, 3.5),
  secondary: band(5.5, 7.0, 3.0),
  runout: band(4.5, 5.5, 2.5),
  terminal: band(3.5, 4.5, 2.0),
};

export const APPLICATIONS = {
  critical_acoustic: {
    id: "critical_acoustic",
    label: "Critical Acoustic",
    group: "acoustic",
    roles: CRITICAL,
    friction: 0.6,
    notes: [
      "Prioritise acoustic performance over minimum duct size.",
      "Consider attenuators, flexible connections, acoustic lining, low-velocity terminals, damper noise, breakout and regenerated noise at fittings.",
    ],
  },
  residential_hotel: {
    id: "residential_hotel",
    label: "Residential / Hotel",
    group: "acoustic",
    roles: OFFICE,
    friction: 0.8,
    notes: ["Bedrooms and guest areas use the office / noise-sensitive velocity profile."],
  },
  office: {
    id: "office",
    label: "Office",
    group: "acoustic",
    roles: OFFICE,
    friction: 0.8,
    notes: ["CIBSE Guide B comfort / NR 35–40. Velocity steps down toward occupied terminals."],
  },
  education: {
    id: "education",
    label: "Education",
    group: "acoustic",
    roles: OFFICE,
    friction: 0.8,
    notes: ["Classrooms and lecture rooms follow the noise-sensitive profile."],
  },
  healthcare: {
    id: "healthcare",
    label: "Healthcare",
    group: "acoustic",
    roles: OFFICE,
    friction: 0.8,
    notes: ["Treatment rooms may need the Critical Acoustic override at zone level."],
  },
  retail: {
    id: "retail",
    label: "Retail",
    group: "commercial",
    roles: COMMERCIAL,
    friction: 1.0,
    notes: [],
  },
  restaurant: {
    id: "restaurant",
    label: "Restaurant / Hospitality",
    group: "commercial",
    roles: COMMERCIAL,
    friction: 1.0,
    notes: ["Kitchen extract may need a local industrial / grease-velocity override."],
  },
  commercial: {
    id: "commercial",
    label: "General Commercial",
    group: "commercial",
    roles: COMMERCIAL,
    friction: 1.0,
    notes: ["Default playbook profile: 7 → 6.5 → 5 → 4 → 3 → 2.5 m/s toward the terminals."],
  },
  warehouse: {
    id: "warehouse",
    label: "Warehouse",
    group: "industrial",
    roles: INDUSTRIAL,
    friction: 1.2,
    notes: ["Higher velocities only where the acoustic environment and DW144 class allow."],
  },
  light_industrial: {
    id: "light_industrial",
    label: "Light Industrial",
    group: "industrial",
    roles: INDUSTRIAL,
    friction: 1.2,
    notes: [],
  },
  heavy_industrial: {
    id: "heavy_industrial",
    label: "Heavy Industrial / Manufacturing",
    group: "industrial",
    roles: HEAVY,
    friction: 1.2,
    notes: ["Confirm fan pressure, reinforcement and breakout before accepting 9–10 m/s."],
  },
  plantroom: {
    id: "plantroom",
    label: "Plantroom / Non Occupied Area",
    group: "industrial",
    roles: INDUSTRIAL,
    friction: 1.2,
    notes: ["Unoccupied plant space. Adjacent occupied rooms should use a quieter zone override."],
  },
  custom: {
    id: "custom",
    label: "Custom",
    group: "custom",
    roles: COMMERCIAL,
    friction: 1.0,
    notes: ["All target and maximum velocities are designer-defined."],
  },
};

export const APPLICATION_IDS = Object.keys(APPLICATIONS);

export function applicationOf(id) {
  return APPLICATIONS[id] || APPLICATIONS.commercial;
}

export function cloneProfile(id) {
  const app = applicationOf(id);
  const roles = {};
  for (const role of DUCT_ROLES) {
    const r = app.roles[role] || COMMERCIAL[role];
    roles[role] = { ...r };
  }
  return { applicationType: app.id, friction: app.friction, roles };
}

export function roleLabel(role) {
  return ROLE_LABELS[role] || role || "Main distribution";
}

export function normalizeRole(role) {
  if (role === "primary") return "branch";
  if (role === "run-out" || role === "final") return "runout";
  if (DUCT_ROLES.includes(role)) return role;
  return "main";
}

// Resolve the active velocity band for a section. Project application is
// the default; room / segment overrides win. Custom uses the stored table.
export function resolveBand(role, settings = {}, overrideApp = null) {
  const key = normalizeRole(role);
  const appId = overrideApp || settings.applicationType || "commercial";
  const app = applicationOf(appId);
  const fromApp = (app.roles[key] || COMMERCIAL[key] || COMMERCIAL.main);
  const stored = (settings.velocityProfile && settings.velocityProfile[key]) || {};
  const caps = settings.velocityCaps || {};
  const mins = settings.velocityMins || {};
  const custom = appId === "custom";
  const base = {
    target: custom && stored.target != null ? stored.target : fromApp.target,
    max: custom && stored.max != null ? stored.max : fromApp.max,
    min: custom && stored.min != null ? stored.min : fromApp.min,
  };
  if (caps[key] != null) base.max = caps[key];
  if (mins[key] != null) base.min = mins[key];
  return {
    ...base,
    role: key,
    applicationType: appId,
    applicationLabel: app.label,
    source: `${app.label} — ${ROLE_LABELS[key]}`,
    notes: app.notes || [],
  };
}

export function warnLevel(velocity, band, opts = {}) {
  const v = Number(velocity) || 0;
  if (v <= 0) return "none";
  const classLimit = opts.classMaxVelocity ?? Infinity;
  const classB = opts.dw144Class === "B" && v > DW144_CLASS_B_WARN_MS + 1e-9;
  const overClass = v > classLimit + 1e-9;
  if (overClass || classB) return "critical";
  if (v > band.max + 1e-9) return "warning";
  if (v > band.target + 1e-9) return "advisory";
  return "normal";
}

export function warnMessage(velocity, band, level, opts = {}) {
  const v = (Number(velocity) || 0).toFixed(1);
  if (level === "critical" && opts.dw144Class === "B" && Number(velocity) > DW144_CLASS_B_WARN_MS) {
    return `High Velocity Warning: Air velocity exceeds 9.5 m/s. Review DW/144 Class B construction requirements, system pressure, acoustic performance, duct reinforcement and suitability before accepting this section.`;
  }
  if (level === "critical") {
    return `Velocity of ${v} m/s exceeds the DW144 Class ${opts.dw144Class || "?"} construction limit of ${opts.classMaxVelocity} m/s.`;
  }
  if (level === "warning") {
    return `Velocity of ${v} m/s exceeds the recommended ${band.max.toFixed(1)} m/s maximum for a ${roleLabel(band.role).toLowerCase()} serving a ${band.applicationLabel} area.`;
  }
  if (level === "advisory") {
    return `Velocity of ${v} m/s is above the ${band.target.toFixed(1)} m/s target for a ${roleLabel(band.role).toLowerCase()} (${band.applicationLabel}) but within the ${band.max.toFixed(1)} m/s maximum.`;
  }
  return "";
}

export function defaultSockSpec() {
  return {
    designFlow_ls: 200,
    specPa: 80,
    heightM: 2.8,
    diameterMm: 400,
    fabric: "",
    model: "",
    supplier: "",
    note: "",
  };
}

function lerpColor(t, a, b) {
  const p = Math.max(0, Math.min(1, t));
  const hex = (c) => {
    const n = parseInt(c.slice(1), 16);
    return [n >> 16, (n >> 8) & 255, n & 255];
  };
  const A = hex(a), B = hex(b);
  const r = Math.round(A[0] + (B[0] - A[0]) * p);
  const g = Math.round(A[1] + (B[1] - A[1]) * p);
  const bl = Math.round(A[2] + (B[2] - A[2]) * p);
  return `#${((1 << 24) + (r << 16) + (g << 8) + bl).toString(16).slice(1)}`;
}

export function overlayColor(kind, res, settings, scale = {}) {
  if (!res) return null;
  if (kind === "velocity" || kind === "acoustic") {
    const map = { none: null, normal: "#22c55e", advisory: "#eab308", warning: "#f97316", critical: "#ef4444" };
    return map[res.warnLevel] || null;
  }
  if (kind === "dw144") {
    if (res.warnLevel === "critical") return "#ef4444";
    if (res.warnLevel === "warning") return "#f97316";
    return "#22c55e";
  }
  if (kind === "gradient" || kind === "pressureDrop") {
    const t = settings?.targetGradient ?? 1;
    const g = res.gradient || 0;
    if (g <= t) return "#22c55e";
    if (g <= t * 1.25) return "#eab308";
    return "#ef4444";
  }
  if (kind === "flow") {
    const max = scale.maxFlow || 0.001;
    return lerpColor((res.flowM3s || 0) / max, "#93c5fd", "#1d4ed8");
  }
  if (kind === "size") {
    const max = scale.maxArea || 0.001;
    return lerpColor((res.section?.areaM2 || 0) / max, "#a7f3d0", "#047857");
  }
  if (kind === "pressure" || kind === "systemPressure") {
    const max = scale.maxDp || 0.001;
    return lerpColor((res.dpPa || 0) / max, "#fde68a", "#b45309");
  }
  return null;
}
