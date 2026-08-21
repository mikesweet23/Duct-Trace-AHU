// Physical-model summary: engineering centreline vs fabricated material.

import { round } from "../units.js";
import { isCircularConstruction } from "./catalog.js";
import { engineeringLengthM, graphicalLengthM } from "./lengths.js";
import { pxPerMeterOf } from "../layout.js";

export function simulatorSummary(project, results, model) {
  const px = pxPerMeterOf(project);
  let centrelineM = 0;
  let graphicalM = 0;
  for (const s of project.segments || []) {
    const a = project.nodes.find((n) => n.id === s.a);
    const b = project.nodes.find((n) => n.id === s.b);
    centrelineM += engineeringLengthM(s, a, b, px);
    graphicalM += graphicalLengthM(a, b, px);
  }

  const pieces = model?.pieces || [];
  const straight = pieces.filter((p) => p.kind === "straight");
  const fittings = pieces.filter((p) => p.category === "fitting");
  const circularStraight = straight.filter((p) => isCircularConstruction(p.construction));
  const rectStraight = straight.filter((p) => !isCircularConstruction(p.construction));

  return {
    systemsModelled: new Set(pieces.map((p) => p.system).filter(Boolean)).size,
    totalCentrelineM: round(centrelineM, 2),
    totalGraphicalM: round(graphicalM, 2),
    totalFabricatedStraightM: round(straight.reduce((s, p) => s + (p.lengthM || 0), 0), 2),
    circularDuctM: round(circularStraight.reduce((s, p) => s + (p.lengthM || 0), 0), 2),
    rectangularAreaM2: round(rectStraight.reduce((s, p) => s + (p.sheetAreaM2 || 0), 0), 2),
    fittings: fittings.length,
    transitions: pieces.filter((p) => p.kind === "transition" || p.kind === "reducer" || p.kind === "enlarger" || p.kind === "sqr_to_round").length,
    bends: pieces.filter((p) => p.kind === "elbow").length,
    branches: pieces.filter((p) => ["tee", "y_branch", "lateral", "saddle", "shoe"].includes(p.kind)).length,
    boots: pieces.filter((p) => p.kind === "boot").length,
    dampers: pieces.filter((p) => p.kind === "damper").length,
    joints: pieces.filter((p) => p.kind === "coupler").length,
    insulationAreaM2: round(pieces.reduce((s, p) => s + (p.insulationAreaM2 || 0), 0), 2),
    physicalComponents: pieces.filter((p) => p.kind !== "support").length,
    staleCount: model?.staleCount || 0,
    generated: !!model?.generated,
    generatedAt: model?.generatedAt || null,
  };
}
