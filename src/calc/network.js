// Network solver. Builds a graph from nodes + segments for one system
// (supply or extract), accumulates design flows from the terminals back to
// the plant, sizes every segment, and finds the index run (the path of
// greatest total pressure loss), which sets the required system static.

import { routeLengthM } from "../geom.js";
import { flowToM3s } from "../units.js";
import { airDensity, airViscosity } from "../units.js";
import { sizeDuct, frictionForSection, dynamicPressure } from "../standards/sizing.js";
import { totalFittingK } from "../standards/fittings.js";
import { componentDef, inlineLossPa } from "../standards/components.js";
import { RECOMMENDED_VELOCITY, pressureClassFor, PRESSURE_CLASSES } from "../standards/dw144.js";

function velocityCap(role, settings) {
  const caps = settings.velocityCaps || {};
  if (role === "runout") return caps.runout ?? RECOMMENDED_VELOCITY.runout.max;
  if (role === "branch") return caps.branch ?? RECOMMENDED_VELOCITY.branch.max;
  return caps.main ?? RECOMMENDED_VELOCITY.main.max;
}

export function computeSystem(project, systemType) {
  const settings = project.settings || {};
  const pxPerMeter = (project.scale && project.scale.pxPerMeter) || settings.conceptPxPerMeter || 50;
  const tempC = systemType === "extract" ? settings.extractTempC ?? 22 : settings.supplyTempC ?? 18;
  const density = airDensity(tempC);
  const viscosity = airViscosity(tempC);
  const commonOpts = {
    method: settings.sizingMethod || "friction",
    targetGradient: settings.targetGradient ?? 1.0,
    roughnessMm: settings.roughnessMm ?? 0.15,
    rectHeight: settings.rectHeight ?? 250,
    maxAspect: settings.maxAspect ?? 4,
    density,
    viscosity,
    tempC,
  };

  const nodesById = new Map(project.nodes.map((n) => [n.id, n]));
  const segs = project.segments.filter((s) => s.system === systemType);
  const comps = (project.components || []).filter((c) => {
    if (!c.nodeId) return false;
    return c.system === systemType || c.system === "both";
  });

  // Terminal demand and inline loss and plant per node.
  const demand = new Map(); // node id -> m3/s
  const inlineNodes = new Map(); // node id -> [components]
  const terminalNodes = new Map(); // node id -> [components]
  let plant = null;
  let rootNode = null;
  for (const c of comps) {
    const def = componentDef(c.kind);
    if (!def) continue;
    if (def.role === "terminal") {
      const q = flowToM3s(Number(c.props?.designFlow_ls) || 0, "l/s");
      demand.set(c.nodeId, (demand.get(c.nodeId) || 0) + q);
      if (!terminalNodes.has(c.nodeId)) terminalNodes.set(c.nodeId, []);
      terminalNodes.get(c.nodeId).push(c);
    } else if (def.role === "inline") {
      if (!inlineNodes.has(c.nodeId)) inlineNodes.set(c.nodeId, []);
      inlineNodes.get(c.nodeId).push(c);
    } else if (def.role === "plant") {
      if (c.system !== systemType && c.system !== "both") continue;
      if (!plant) {
        plant = c;
        rootNode = (c.system === "both" && systemType === "extract" && c.returnNodeId)
          ? c.returnNodeId
          : c.nodeId;
      }
    }
  }

  // Adjacency for this system.
  const adj = new Map();
  for (const s of segs) {
    if (!adj.has(s.a)) adj.set(s.a, []);
    if (!adj.has(s.b)) adj.set(s.b, []);
    adj.get(s.a).push({ seg: s, other: s.b });
    adj.get(s.b).push({ seg: s, other: s.a });
  }

  const warnings = [];
  const segFlow = new Map(); // seg id -> m3/s
  const parentSeg = new Map(); // node -> seg used to reach it
  const parentNode = new Map();
  const order = []; // BFS order from root

  if (rootNode != null && adj.has(rootNode)) {
    const visited = new Set([rootNode]);
    const queue = [rootNode];
    while (queue.length) {
      const n = queue.shift();
      order.push(n);
      for (const { seg, other } of adj.get(n) || []) {
        if (!visited.has(other)) {
          visited.add(other);
          parentSeg.set(other, seg);
          parentNode.set(other, n);
          queue.push(other);
        }
      }
    }
    // Post-order accumulation of subtree demand.
    const subtree = new Map();
    for (let i = order.length - 1; i >= 0; i--) {
      const n = order[i];
      let sum = demand.get(n) || 0;
      for (const { seg, other } of adj.get(n) || []) {
        if (parentNode.get(other) === n) sum += subtree.get(other) || 0;
      }
      subtree.set(n, sum);
      const ps = parentSeg.get(n);
      if (ps) segFlow.set(ps.id, subtree.get(n));
    }
    if (order.length < new Set([...adj.keys()]).size) {
      warnings.push("Some ducts are not connected to the plant and were ignored in flow accumulation.");
    }
  } else if (segs.length) {
    warnings.push(`No plant (fan/AHU) placed on the ${systemType} system — flows use per-segment overrides only.`);
  }

  // Size each segment and compute pressure losses.
  const segResults = [];
  let minV = Infinity;
  let maxV = 0;
  for (const s of segs) {
    let flow = segFlow.get(s.id) ?? 0;
    if (s.flowOverride != null && s.flowOverride !== "") {
      flow = flowToM3s(Number(s.flowOverride), "l/s");
    }
    const a = nodesById.get(s.a);
    const b = nodesById.get(s.b);
    const lengthM = a && b ? routeLengthM(a, b, pxPerMeter) : 0;

    // Role: leaf segment feeding a terminal node = runout.
    let role = s.roleOverride || "main";
    if (!s.roleOverride) {
      const childNode = parentNode.get(s.b) === s.a ? s.b : parentNode.get(s.a) === s.b ? s.a : null;
      if (childNode != null && terminalNodes.has(childNode)) role = "runout";
    }
    const maxVelocity = velocityCap(role, settings);

    const shape = s.shapeOverride || settings.ductType || "round";
    let section;
    let fr;
    if (s.sizeOverride && (s.sizeOverride.diameterMm || s.sizeOverride.widthMm)) {
      section = { shape, ...s.sizeOverride };
      fr = frictionForSection(flow, section, commonOpts);
      section.areaM2 = fr.area;
      section.velocity = fr.velocity;
      section.gradient = fr.gradient;
      section.warnings = [];
    } else {
      section = sizeDuct(flow, { ...commonOpts, shape, maxVelocity });
    }

    const velocity = section.velocity || 0;
    const dp = dynamicPressure(velocity, density);
    const frictionPa = (section.gradient || 0) * lengthM;
    const kTotal = totalFittingK(s.fittings || []);
    const fittingPa = kTotal * dp;
    const inlineList = inlineNodes.get(s.b) || [];
    // Attribute in-line device losses to the segment on the plant side of the node.
    let inlinePa = 0;
    if (parentSeg.get(s.b)?.id === s.id) {
      for (const c of inlineList) inlinePa += inlineLossPa(c.props, dp);
    }
    const segDp = frictionPa + fittingPa + inlinePa;

    if (flow > 0) {
      minV = Math.min(minV, velocity);
      maxV = Math.max(maxV, velocity);
    }

    segResults.push({
      id: s.id,
      system: systemType,
      role,
      flowM3s: flow,
      lengthM,
      section,
      velocity,
      gradient: section.gradient || 0,
      frictionPa,
      fittingPa,
      inlinePa,
      dpPa: segDp,
      kTotal,
      withinVelocity: velocity <= maxVelocity + 1e-6,
      maxVelocity,
      warnings: section.warnings || [],
    });
  }

  const segResById = new Map(segResults.map((r) => [r.id, r]));

  // Index run: for each terminal node, cumulative loss from root along parents.
  let indexStaticPa = 0;
  let indexTerminal = null;
  let indexPath = [];
  const terminals = [];
  if (rootNode != null) {
    for (const [nodeId, list] of terminalNodes) {
      // Walk up to root.
      let cur = nodeId;
      let cum = 0;
      const path = [];
      let guard = 0;
      while (cur !== rootNode && parentSeg.has(cur) && guard++ < 10000) {
        const ps = parentSeg.get(cur);
        const r = segResById.get(ps.id);
        if (r) {
          cum += r.dpPa;
          path.push(ps.id);
        }
        cur = parentNode.get(cur);
      }
      const termLoss = list.reduce((s, c) => s + (Number(c.props?.terminalLossPa) || 0), 0);
      cum += termLoss;
      const node = nodesById.get(nodeId);
      terminals.push({
        nodeId,
        name: list.map((c) => componentDef(c.kind)?.label).join(", "),
        totalPa: cum,
        terminalLossPa: termLoss,
        flowM3s: demand.get(nodeId) || 0,
        connected: cur === rootNode,
        point: node ? { x: node.x, y: node.y } : null,
      });
      if (cur === rootNode && cum > indexStaticPa) {
        indexStaticPa = cum;
        indexTerminal = nodeId;
        indexPath = path;
      }
    }
  }

  const totalFlowM3s = [...demand.values()].reduce((a, b) => a + b, 0);
  const availableStaticPa = plant ? Number(plant.props?.availableStaticPa) || 0 : 0;

  return {
    systemType,
    tempC,
    density,
    plant,
    rootNode,
    totalFlowM3s,
    indexStaticPa,
    indexTerminal,
    indexPath,
    availableStaticPa,
    marginPa: plant ? availableStaticPa - indexStaticPa : null,
    pressureClass: pressureClassFor(indexStaticPa),
    pressureClassInfo: PRESSURE_CLASSES[pressureClassFor(indexStaticPa)],
    minVelocity: isFinite(minV) ? minV : 0,
    maxVelocity: maxV,
    segments: segResults,
    terminals,
    warnings,
  };
}

export function computeAll(project) {
  return {
    supply: computeSystem(project, "supply"),
    extract: computeSystem(project, "extract"),
  };
}
