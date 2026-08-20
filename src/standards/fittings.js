// Fitting pressure-loss coefficients (zeta / K). Loss = K * dynamic pressure
// at the reference velocity. Values are representative CIBSE Guide C figures
// for common galvanised fittings and are editable per fitting in the UI.

export const FITTINGS = {
  bend90_radius: { label: "90° radius bend (r/d=1.5)", k: 0.22 },
  bend90_mitre_vaned: { label: "90° mitre bend, vaned", k: 0.35 },
  bend90_mitre: { label: "90° mitre bend, unvaned", k: 1.2 },
  bend45: { label: "45° bend", k: 0.15 },
  tee_branch: { label: "Tee — branch (90°)", k: 1.0 },
  tee_straight: { label: "Tee — straight through", k: 0.2 },
  taper_reducer: { label: "Concentric reducer/taper", k: 0.1 },
  taper_expander: { label: "Expander (gradual)", k: 0.25 },
  entry_sharp: { label: "Sharp entry", k: 0.5 },
  exit: { label: "Abrupt exit / discharge", k: 1.0 },
  obstruction: { label: "Obstruction / generic", k: 0.5 },
};

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
