// Fitting pressure-loss coefficients (zeta / K). Loss = K * dynamic pressure
// at the reference velocity. Values are representative CIBSE Guide C figures
// for common galvanised fittings and are editable per fitting in the UI.

export const FITTINGS = {
  bend90_radius: { label: "90° radius bend (r/d=1.5)", k: 0.22, group: "elbow", angle: 90 },
  bend90_square: { label: "90° square-throat bend", k: 1.1, group: "elbow", angle: 90 },
  bend90_swept: { label: "90° swept bend", k: 0.18, group: "elbow", angle: 90 },
  bend90_mitre_vaned: { label: "90° mitre bend, vaned", k: 0.35, group: "elbow", angle: 90 },
  bend90_mitre: { label: "90° mitre bend, unvaned", k: 1.2, group: "elbow", angle: 90 },
  bend45: { label: "45° bend", k: 0.15, group: "elbow", angle: 45 },
  bend30: { label: "30° bend", k: 0.08, group: "elbow", angle: 30 },
  tee_branch: { label: "Tee — branch (90°)", k: 1.0, group: "branch", angle: 90 },
  tee_straight: { label: "Tee — straight through", k: 0.2, group: "branch", angle: 0 },
  tee_rect: { label: "Rectangular tee", k: 1.05, group: "branch", angle: 90 },
  y_branch: { label: "Y branch", k: 0.55, group: "branch", angle: 45 },
  lateral45: { label: "45° lateral", k: 0.45, group: "branch", angle: 45 },
  saddle: { label: "Saddle branch", k: 0.9, group: "branch", angle: 90 },
  shoe: { label: "Shoe branch", k: 0.7, group: "branch", angle: 90 },
  shoe_branch: { label: "Rectangular shoe branch", k: 0.75, group: "branch", angle: 90 },
  swept_branch: { label: "Swept branch", k: 0.4, group: "branch", angle: 45 },
  radius_branch: { label: "Radius branch", k: 0.35, group: "branch", angle: 90 },
  taper_reducer: { label: "Concentric reducer/taper", k: 0.1, group: "reducer" },
  taper_expander: { label: "Expander (gradual)", k: 0.25, group: "reducer" },
  transition_sym: { label: "Symmetrical transition", k: 0.12, group: "transition" },
  transition_flat_top: { label: "Flat-top transition", k: 0.16, group: "transition" },
  transition_flat_bottom: { label: "Flat-bottom transition", k: 0.16, group: "transition" },
  transition_flat_left: { label: "Flat-left transition", k: 0.16, group: "transition" },
  transition_flat_right: { label: "Flat-right transition", k: 0.16, group: "transition" },
  transition_offset: { label: "Offset transition", k: 0.22, group: "transition" },
  sqr_to_round: { label: "Square-to-round transformation", k: 0.2, group: "transition" },
  offset_2x45: { label: "Offset — 2 × 45° bends", k: 0.3, group: "offset" },
  offset_2x30: { label: "Offset — 2 × 30° bends", k: 0.2, group: "offset" },
  offset_custom: { label: "Custom fabricated offset", k: 0.35, group: "offset" },
  offset_rect: { label: "Rectangular offset transition", k: 0.28, group: "offset" },
  boot_square: { label: "Square boot", k: 0.6, group: "boot" },
  boot_rect: { label: "Rectangular boot", k: 0.6, group: "boot" },
  boot_circular: { label: "Circular boot", k: 0.5, group: "boot" },
  plenum: { label: "Plenum box", k: 0.8, group: "boot" },
  end_cap: { label: "End cap", k: 0, group: "cap" },
  coupler: { label: "Coupler / joint", k: 0.02, group: "joint" },
  flex_connector: { label: "Flexible connector", k: 0.15, group: "flex" },
  entry_sharp: { label: "Sharp entry", k: 0.5, group: "entry" },
  exit: { label: "Abrupt exit / discharge", k: 1.0, group: "entry" },
  obstruction: { label: "Obstruction / generic", k: 0.5, group: "other" },
};

export const FITTING_ALTERNATIVES = {
  elbow: ["bend90_radius", "bend90_square", "bend90_swept", "bend90_mitre", "bend90_mitre_vaned"],
  elbow45: ["bend45", "bend30"],
  branch_round: ["tee_branch", "y_branch", "lateral45", "saddle", "shoe"],
  branch_rect: ["tee_rect", "shoe_branch", "swept_branch", "radius_branch"],
  reducer: ["taper_reducer", "taper_expander"],
  transition: [
    "transition_sym",
    "transition_flat_top",
    "transition_flat_bottom",
    "transition_flat_left",
    "transition_flat_right",
    "transition_offset",
  ],
  offset: ["offset_2x45", "offset_2x30", "offset_custom", "offset_rect"],
  boot: ["boot_square", "boot_rect", "boot_circular", "plenum"],
};

export function fittingDef(type) {
  return FITTINGS[type] || null;
}

export function fittingLoss(kOrType, dynamicPressurePa) {
  const k = typeof kOrType === "number" ? kOrType : (FITTINGS[kOrType]?.k ?? 0);
  return k * dynamicPressurePa;
}

export function totalFittingK(fittings = []) {
  return fittings.reduce((sum, f) => {
    const k = typeof f.k === "number" ? f.k : (FITTINGS[f.type]?.k ?? 0);
    const qty = f.qty ?? 1;
    return sum + k * qty;
  }, 0);
}

export function alternativesFor(type, shape) {
  const def = FITTINGS[type];
  if (!def) return [];
  if (def.group === "elbow") return FITTING_ALTERNATIVES.elbow;
  if (def.group === "branch") {
    return shape === "rect" || shape === "square"
      ? FITTING_ALTERNATIVES.branch_rect
      : FITTING_ALTERNATIVES.branch_round;
  }
  if (def.group === "reducer") return FITTING_ALTERNATIVES.reducer;
  if (def.group === "transition") return FITTING_ALTERNATIVES.transition;
  if (def.group === "offset") return FITTING_ALTERNATIVES.offset;
  if (def.group === "boot") return FITTING_ALTERNATIVES.boot;
  return [type];
}
