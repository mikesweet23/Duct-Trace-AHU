// Network solver. Builds a graph from nodes + segments for one system
// (supply or extract), accumulates design flows from the terminals back to
// the plant, sizes every segment, and finds the index run (the path of
// greatest total pressure loss), which sets the required system static.

import { isVerticalRiser } from "../geom.js";
import { engineeringLengthM, graphicalLengthM, hasLengthOverride } from "../fab/lengths.js";
import { flowToM3s, plantDutyLs, plantStaticPa, round } from "../units.js";
import { airDensity, airViscosity } from "../units.js";
import { sizeDuct, frictionForSection, dynamicPressure } from "../standards/sizing.js";
import { totalFittingK } from "../standards/fittings.js";
import { componentDef, inlineLossPa, isDualPort, terminalK } from "../standards/components.js";
import { RECOMMENDED_VELOCITY, pressureClassFor, PRESSURE_CLASSES } from "../standards/dw144.js";
import { SYSTEM_KEYS, systemLabel, fanSide, isOutsideSystem } from "../systems.js";
import { PORT_NODE_KEY } from "../layout.js";

const FLOW_MATCH_ABS_LS = 2;
const FLOW_MATCH_REL = 0.02;

function velocityLimits(role, settings) {
  const caps = settings.velocityCaps || {};
  const mins = settings.velocityMins || {};
  const rec = RECOMMENDED_VELOCITY[role] || RECOMMENDED_VELOCITY.main;
  return {
    min: mins[role] ?? rec.min ?? 0,
    max: caps[role] ?? rec.max ?? 7,
  };
}

function plantServes(c, systemType) {
  if (c.system === systemType) return true;
  if (c.system !== "both") return false;
  // fresh air and exhaust only exist on a unit that serves both sides
  return !isOutsideSystem(systemType) || isDualPort(c.kind);
}

function plantsFor(project, systemType) {
  return (project.components || []).filter((c) => {
    const def = componentDef(c.kind);
    return def?.role === "plant" && plantServes(c, systemType);
  });
}

function plantRoot(plant, systemType) {
  if (!plant) return null;
  if (plant.system !== "both") return plant.nodeId;
  const key = PORT_NODE_KEY[systemType] || "nodeId";
  return plant[key] || (isOutsideSystem(systemType) ? null : plant.nodeId);
}

function flowMatchTolLs(a, b) {
  return Math.max(FLOW_MATCH_ABS_LS, FLOW_MATCH_REL * Math.max(Math.abs(a), Math.abs(b), 1));
}

function flowsMatch(a, b) {
  return Math.abs(a - b) <= flowMatchTolLs(a, b);
}

function inferRole(s, a, b, px, parentNode, terminalNodes, adj, segFlow) {
  if (s.roleOverride) return s.roleOverride;
  if (a && b && isVerticalRiser(a, b, px)) return "riser";

  const childNode = parentNode.get(s.b) === s.a ? s.b : parentNode.get(s.a) === s.b ? s.a : null;
  if (childNode != null && terminalNodes.has(childNode)) return "runout";

  if (childNode != null) {
    const parent = parentNode.get(childNode);
    const outgoing = (adj.get(parent) || []).filter(({ other }) => parentNode.get(other) === parent);
    if (outgoing.length >= 2) {
      const thisF = segFlow.get(s.id) || 0;
      const maxF = Math.max(...outgoing.map(({ seg }) => segFlow.get(seg.id) || 0));
      if (thisF < maxF - 1e-9) return "branch";
    }
  }
  return "main";
}

function emptySystem(systemType, extra = {}) {
  return {
    id: extra.id || systemType,
    name: extra.name || systemLabel(systemType),
    systemType,
    tempC: extra.tempC ?? (systemType === "extract" ? 22 : 18),
    density: extra.density ?? airDensity(extra.tempC),
    plant: extra.plant || null,
    rootNode: extra.rootNode ?? null,
    totalFlowM3s: 0,
    indexStaticPa: 0,
    indexTerminal: null,
    indexPath: [],
    availableStaticPa: 0,
    marginPa: extra.plant ? 0 : null,
    pressureClass: "A",
    pressureClassInfo: PRESSURE_CLASSES.A,
    minVelocity: 0,
    maxVelocity: 0,
    segments: [],
    terminals: [],
    warnings: extra.warnings || [],
    balance: extra.balance || null,
  };
}

function systemTempC(settings, systemType) {
  if (systemType === "extract") return settings.extractTempC ?? 22;
  if (systemType === "outdoor") return settings.outdoorTempC ?? 5;
  if (systemType === "exhaust") return settings.exhaustTempC ?? 12;
  return settings.supplyTempC ?? 18;
}

// opts.autoFlowLs — for fresh air and exhaust: the unit's airflow on that
// side, shared between the outside terminals that have no flow typed.
export function computeSystem(project, systemType, plantFilter = undefined, opts = {}) {
  const settings = project.settings || {};
  const pxPerMeter = (project.scale && project.scale.pxPerMeter) || settings.conceptPxPerMeter || 50;
  const tempC = systemTempC(settings, systemType);
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
    return plantServes(c, systemType);
  });

  const demand = new Map(); // node id -> m3/s
  const inlineNodes = new Map(); // node id -> [components]
  const terminalNodes = new Map(); // node id -> [components]
  const plants = [];
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
      plants.push(c);
    }
  }

  let plant = null;
  if (plantFilter) {
    plant = plants.find((c) => c.id === plantFilter.id) || plantFilter;
  } else if (plants.length) {
    plant = plants[0];
  }
  const rootNode = plantRoot(plant, systemType);

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
  const order = [];
  const reachableSegs = new Set();

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
          reachableSegs.add(seg.id);
          queue.push(other);
        }
      }
    }
    // Outside terminals left at 0 share the unit's own airflow: the fresh
    // air in is what the supply fan delivers, the exhaust is what the
    // extract fan takes out.
    if (isOutsideSystem(systemType) && opts.autoFlowLs > 0) {
      let typed = 0;
      const auto = [];
      for (const [nodeId, list] of terminalNodes) {
        if (!visited.has(nodeId)) continue;
        const t = list.reduce((a, c) => a + (Number(c.props?.designFlow_ls) || 0), 0);
        if (t > 0) typed += t;
        else auto.push(nodeId);
      }
      const share = auto.length ? Math.max(0, opts.autoFlowLs - typed) / auto.length : 0;
      for (const nodeId of auto) demand.set(nodeId, flowToM3s(share, "l/s"));
      if (!auto.length && typed > 0 && !flowsMatch(typed, opts.autoFlowLs)) {
        warnings.push(`${systemLabel(systemType)} terminals are set to ${round(typed, 0)} l/s but the unit moves ${round(opts.autoFlowLs, 0)} l/s on that side.`);
      }
    }
    const subtree = new Map();
    for (let i = order.length - 1; i >= 0; i--) {
      const n = order[i];
      let sum = demand.get(n) || 0;
      for (const { other } of adj.get(n) || []) {
        if (parentNode.get(other) === n) sum += subtree.get(other) || 0;
      }
      subtree.set(n, sum);
      const ps = parentSeg.get(n);
      if (ps) segFlow.set(ps.id, subtree.get(n));
    }
    if (!plantFilter && order.length < new Set([...adj.keys()]).size) {
      warnings.push("Some ducts are not connected to the plant and were ignored in flow accumulation.");
    }
  } else if (segs.length) {
    warnings.push(isOutsideSystem(systemType)
      ? `${systemLabel(systemType)} ducts are not joined to an AHU or HRV serving supply and extract — start them on the unit's ${systemType === "outdoor" ? "fresh-air (ODA)" : "exhaust (EHA)"} connection.`
      : `No plant (fan/AHU) placed on the ${systemType} system — flows use per-segment overrides only.`);
  }

  const segsToSize = plantFilter ? segs.filter((s) => reachableSegs.has(s.id) || s.flowOverride != null) : segs;

  const segResults = [];
  let minV = Infinity;
  let maxV = 0;
  for (const s of segsToSize) {
    let flow = segFlow.get(s.id) ?? 0;
    if (s.flowOverride != null && s.flowOverride !== "") {
      flow = flowToM3s(Number(s.flowOverride), "l/s");
    }
    const a = nodesById.get(s.a);
    const b = nodesById.get(s.b);
    const graphicalM = a && b ? graphicalLengthM(a, b, pxPerMeter) : 0;
    const lengthM = a && b ? engineeringLengthM(s, a, b, pxPerMeter) : 0;

    const role = inferRole(s, a, b, pxPerMeter, parentNode, terminalNodes, adj, segFlow);
    const limits = velocityLimits(role, settings);
    const maxVelocity = limits.max;
    const minVelocity = limits.min;

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
    let inlinePa = 0;
    if (parentSeg.get(s.b)?.id === s.id) {
      for (const c of inlineList) inlinePa += inlineLossPa(c.props, dp);
    }
    const segDp = frictionPa + fittingPa + inlinePa;

    if (flow > 0) {
      minV = Math.min(minV, velocity);
      maxV = Math.max(maxV, velocity);
    }

    const withinMax = velocity <= maxVelocity + 1e-6;
    const withinMin = flow <= 0 || velocity + 1e-6 >= minVelocity;
    const rec = RECOMMENDED_VELOCITY[role] || RECOMMENDED_VELOCITY.main;
    const segWarnings = [...(section.warnings || [])];
    if (flow > 0 && !withinMax) {
      segWarnings.push(`Velocity ${round(velocity, 1)} m/s exceeds the ${round(maxVelocity, 1)} m/s ${role} cap (${rec.source}).`);
    }
    if (flow > 0 && !withinMin) {
      segWarnings.push(`Velocity ${round(velocity, 1)} m/s is below the ${round(minVelocity, 1)} m/s ${role} minimum (${rec.source}).`);
    }

    segResults.push({
      id: s.id,
      system: systemType,
      connectedToPlant: reachableSegs.has(s.id),
      role,
      flowM3s: flow,
      lengthM,
      graphicalLengthM: graphicalM,
      lengthOverride: hasLengthOverride(s),
      section,
      velocity,
      gradient: section.gradient || 0,
      frictionPa,
      fittingPa,
      inlinePa,
      dpPa: segDp,
      kTotal,
      fittings: (s.fittings || []).map((f) => ({ ...f })),
      withinVelocity: withinMax && withinMin,
      withinMax,
      withinMin,
      maxVelocity,
      minVelocity,
      warnings: segWarnings,
    });
  }

  const segResById = new Map(segResults.map((r) => [r.id, r]));

  let indexStaticPa = 0;
  let indexTerminal = null;
  let indexPath = [];
  const terminals = [];
  const reached = new Set(order);
  if (rootNode != null) {
    for (const [nodeId, list] of terminalNodes) {
      if (plantFilter && !reached.has(nodeId) && nodeId !== rootNode) continue;
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
      // the duct that feeds the terminal: its velocity sets an open end's loss
      // and is what the commissioning sheet reads at the terminal
      const runout = parentSeg.has(nodeId) ? segResById.get(parentSeg.get(nodeId).id) : null;
      const pvRunout = runout ? dynamicPressure(runout.velocity || 0, density) : 0;
      const termLoss = list.reduce((s, c) => s + (Number(c.props?.terminalLossPa) || 0) + terminalK(c) * pvRunout, 0);
      cum += termLoss;
      const node = nodesById.get(nodeId);
      terminals.push({
        nodeId,
        runoutSegId: runout ? runout.id : null,
        runoutVelocity: runout ? runout.velocity : 0,
        runoutSection: runout ? runout.section : null,
        components: list,
        name: list.map((c) => c.label || componentDef(c.kind)?.label).join(", "),
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

  const totalFlowM3s = terminals.reduce((a, t) => a + t.flowM3s, 0);
  const availableStaticPa = plant ? plantStaticPa(plant.props, fanSide(systemType)) : 0;
  const dutyLs = plant && !isOutsideSystem(systemType) ? plantDutyLs(plant.props, systemType) : 0;
  const terminalLs = totalFlowM3s * 1000;
  const balance = {
    plantDutyLs: dutyLs,
    terminalLs,
    matched: dutyLs <= 0 || flowsMatch(dutyLs, terminalLs),
    deltaLs: dutyLs > 0 ? terminalLs - dutyLs : 0,
  };
  if (plant && dutyLs > 0 && !balance.matched) {
    const def = componentDef(plant.kind);
    const label = plant.label || def?.label || "Plant";
    warnings.push(
      `${label} duty (${round(dutyLs, 0)} l/s) does not match connected ${systemType} terminals (${round(terminalLs, 0)} l/s).`
    );
  }

  const plantClass = pressureClassFor(indexStaticPa);
  for (const r of segResults) {
    const classMax = PRESSURE_CLASSES[plantClass]?.maxVelocity;
    if (r.flowM3s > 0 && classMax && r.velocity > classMax + 1e-6) {
      r.warnings.push(`Velocity ${round(r.velocity, 1)} m/s exceeds DW144 Class ${plantClass} limit of ${classMax} m/s.`);
      r.withinVelocity = false;
    }
  }

  const plantLabel = plant ? (plant.label || componentDef(plant.kind)?.label || "Plant") : null;

  return {
    id: plant ? `${systemType}-${plant.id}` : systemType,
    name: systemLabel(systemType),
    systemType,
    tempC,
    density,
    plant,
    plantLabel,
    rootNode,
    totalFlowM3s,
    indexStaticPa,
    indexTerminal,
    indexPath,
    availableStaticPa,
    marginPa: plant ? availableStaticPa - indexStaticPa : null,
    pressureClass: plantClass,
    pressureClassInfo: PRESSURE_CLASSES[plantClass],
    minVelocity: isFinite(minV) ? minV : 0,
    maxVelocity: maxV,
    segments: segResults,
    terminals,
    warnings,
    balance,
  };
}

function nameSystems(systems) {
  const counts = new Map();
  for (const sys of systems) counts.set(sys.systemType, (counts.get(sys.systemType) || 0) + 1);
  const seen = new Map();
  for (const sys of systems) {
    const n = counts.get(sys.systemType) || 1;
    const i = (seen.get(sys.systemType) || 0) + 1;
    seen.set(sys.systemType, i);
    const side = systemLabel(sys.systemType);
    if (n === 1) sys.name = sys.plantLabel ? `${side} — ${sys.plantLabel}` : side;
    else sys.name = `${side} ${i}${sys.plantLabel ? ` — ${sys.plantLabel}` : ""}`;
  }
}

function dualAhuWarnings(project, systems) {
  const warnings = [];
  for (const c of project.components || []) {
    if (!isDualPort(c.kind) || c.system !== "both") continue;
    const supply = systems.find((s) => s.systemType === "supply" && s.plant?.id === c.id);
    const extract = systems.find((s) => s.systemType === "extract" && s.plant?.id === c.id);
    if (!supply || !extract) continue;
    const sLs = supply.totalFlowM3s * 1000;
    const eLs = extract.totalFlowM3s * 1000;
    if ((sLs > 0 || eLs > 0) && !flowsMatch(sLs, eLs)) {
      const label = c.label || componentDef(c.kind)?.label || "AHU";
      warnings.push(
        `${label}: supply outlets (${round(sLs, 0)} l/s) do not match extract inlets (${round(eLs, 0)} l/s).`
      );
      supply.warnings.push(warnings[warnings.length - 1]);
      extract.warnings.push(warnings[warnings.length - 1]);
    }
  }
  return warnings;
}

export function computeAll(project) {
  const systems = [];
  // supply and extract first: fresh air and exhaust take their flow from them
  for (const systemType of SYSTEM_KEYS) {
    const plants = plantsFor(project, systemType);
    const outside = isOutsideSystem(systemType);
    if (!plants.length) {
      const sys = computeSystem(project, systemType);
      if (sys.segments.length || sys.terminals.length) systems.push(sys);
      continue;
    }
    for (const plant of plants) {
      let autoFlowLs = 0;
      if (outside) {
        const side = fanSide(systemType);
        const inside = systems.find((x) => x.systemType === side && x.plant?.id === plant.id);
        autoFlowLs = plantDutyLs(plant.props, side) || (inside ? inside.totalFlowM3s * 1000 : 0);
        const hasDucts = project.segments.some((sg) => sg.system === systemType);
        if (!hasDucts) continue;
      }
      systems.push(computeSystem(project, systemType, plant, { autoFlowLs }));
    }
  }
  pairFanSides(systems);
  nameSystems(systems);
  const projectWarnings = dualAhuWarnings(project, systems);
  const pick = (t) => systems.find((s) => s.systemType === t) || emptySystem(t);
  return { supply: pick("supply"), extract: pick("extract"), outdoor: pick("outdoor"), exhaust: pick("exhaust"), systems, projectWarnings };
}

// One fan pushes fresh air and supply in series, the other pulls extract and
// exhaust, so the static a fan needs is the index run on both sides of it.
function pairFanSides(systems) {
  for (const sys of systems) {
    sys.fanStaticPa = sys.indexStaticPa;
  }
  for (const [inside, outside] of [["supply", "outdoor"], ["extract", "exhaust"]]) {
    for (const o of systems.filter((x) => x.systemType === outside && x.plant)) {
      const i = systems.find((x) => x.systemType === inside && x.plant?.id === o.plant.id);
      const total = o.indexStaticPa + (i ? i.indexStaticPa : 0);
      for (const sys of [o, i].filter(Boolean)) {
        sys.fanStaticPa = total;
        sys.marginPa = sys.availableStaticPa - total;
      }
      if (o.availableStaticPa > 0 && total > o.availableStaticPa) {
        const msg = `${inside === "supply" ? "Supply" : "Extract"} fan: ${systemLabel(outside).toLowerCase()} ${round(o.indexStaticPa, 0)} Pa + ${inside} ${round(i ? i.indexStaticPa : 0, 0)} Pa = ${round(total, 0)} Pa, more than the ${round(o.availableStaticPa, 0)} Pa the unit has.`;
        o.warnings.push(msg);
        if (i) i.warnings.push(msg);
      }
    }
  }
}

export function allComputedSystems(results) {
  if (results?.systems?.length) return results.systems;
  return [results?.supply, results?.extract, results?.outdoor, results?.exhaust].filter(Boolean);
}

export function findSegResult(results, id) {
  for (const sys of allComputedSystems(results)) {
    const s = sys.segments.find((x) => x.id === id);
    if (s) return s;
  }
  return null;
}

export function isIndexSegment(results, id) {
  return allComputedSystems(results).some((sys) => sys.indexPath?.includes(id));
}

export { flowsMatch, flowMatchTolLs, plantsFor };
