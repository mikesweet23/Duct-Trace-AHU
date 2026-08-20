// Shared display helpers for flow, section size and role labels.

import { flowUnitLabel, formatFlow, formatFlowLs, lsToDisplay, normalizeFlowUnit } from "./units.js";
import { ROLE_LABELS } from "./standards/playbook.js";

export function sectionSizeLabel(section) {
  if (!section) return "—";
  if (section.shape === "rect" || section.shape === "square") {
    const w = section.widthMm ?? "—";
    const h = section.heightMm ?? "—";
    return `${w} × ${h}`;
  }
  return section.diameterMm ? `dia ${section.diameterMm}` : "—";
}

export function sectionShapeLabel(shape) {
  if (shape === "square") return "square";
  if (shape === "rect") return "rectangular";
  return "spiral";
}

export function roleLabel(role) {
  return ROLE_LABELS[role] || (role === "runout" ? "Final run to terminal" : role || "Main distribution");
}

export function flowHeading(unit) {
  return flowUnitLabel(unit);
}

export { formatFlow, formatFlowLs, lsToDisplay, normalizeFlowUnit, flowUnitLabel };
