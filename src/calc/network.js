// Network solver. Builds a graph from nodes + segments for one system
// (supply or extract), accumulates design flows from the terminals back to
// the plant, sizes every segment, and finds the index run (the path of
// greatest total pressure loss), which sets the required system static.

import { routeLengthM, isVerticalRiser, pointInPolygon } from "../geom.js";
import { flowToM3s, plantDutyLs, plantStaticPa, round } from "../units.js";
import { airDensity, airViscosity } from "../units.js";
import { sizeDuct, frictionForSection, dynamicPressure } from "../standards/sizing.js";
import { totalFittingK } from "../standards/fittings.js";
import { componentDef, inlineLossPa } from "../standards/components.js";
import { pressureClassFor, PRESSURE_CLASSES } from "../standards/dw144.js";
import {
  applicationOf,
  normalizeRole,
  resolveBand,
  warnLevel,
  warnMessage,
} from "../standards/playbook.js";

const FLOW_MATCH_ABS_LS = 2;
const FLOW_MATCH_REL = 0.02;

function velocityLimits(role, settings, overrideApp) {
  return resolveBand(role, settings, overrideApp);
}

function applicationForSegment(project, s, a, b) {
  if (s.applicationType) return s.applicationType;
  if (!a || !b) return null;
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  for (const room of project.rooms || []) {
    if (room.applicationType && room.points && pointInPolygon(mid, room.points)) {
      return room.applicationType;
    }
  }
  return null;
}

function hasFixedSize(s) {
  const o = s.sizeOverride;
  return !!(s.sizeLocked && o && (o.diameterMm || o.widthMm));
}

function sockSpecOf(s) {
  return s.sock && typeof s.sock === "object" ? s.sock : null;
}

function applySockDemand(segs, adj, parentNode, rootNode, demand, warnings, nodesById, pxPerMeter) {
  const sockSegs = segs.filter((s) => s.ductKind === "sock");
  if (!sockSegs.length) return;
  const seen = new Set();
  for (const start of sockSegs) {
    if (seen.has(start.id)) continue;
    const chain = [];
    const walk = (seg) => {
      if (seen.has(seg.id)) return;
      seen.add(seg.id);
      chain.push(seg);
      for (const end of [seg.a, seg.b]) {
        for (const { seg: next } of adj.get(end) || []) {
          if (next.ductKind === "sock" && !seen.has(next.id)) walk(next);
        }
      }
    };
    walk(start);
    const spec = sockSpecOf(chain.find((s) => s.sock) || chain[0]) || {};
    const designLs = Number(spec.designFlow_ls) || 0;
    if (designLs <= 0) continue;

    let inletNode = chain[0].a;
    if (rootNode != null) {
      let best = inletNode;
      let bestDepth = Infinity;
      for (const seg of chain) {
        for (const n of [seg.a, seg.b]) {
          let d = 0;
          let cur = n;
          let guard = 0;
          while (cur !== rootNode && parentNode.has(cur) && guard++ < 10000) {
            cur = parentNode.get(cur);
            d++;
          }
          if (cur === rootNode && d < bestDepth) {
            bestDepth = d;
            best = n;
          }
        }
      }
      inletNode = best;
    }

    const outletNodes = new Set();
    for (const seg of chain) {
      const child = parentNode.get(seg.b) === seg.a ? seg.b : parentNode.get(seg.a) === seg.b ? seg.a : null;
      if (child) outletNodes.add(child);
      else if (seg.a !== inletNode) outletNodes.add(seg.a);
      else outletNodes.add(seg.b);
    }
    const existing = [...outletNodes].reduce((sum, n) => sum + (demand.get(n) || 0), 0);
    const sockM3s = flowToM3s(designLs, "l/s");
    if (existing > 1e-9 && Math.abs(existing - sockM3s) > Math.max(0.002, 0.02 * Math.max(existing, sockM3s))) {
      warnings.push(
        `Air sock spec (${round(designLs, 0)} l/s) does not match terminals on that run (${round(existing * 1000, 0)} l/s).`
      );
    }
    if (existing > 1e-9) continue;

    const lengths = new Map();
    let totalLen = 0;
    for (const seg of chain) {
      const child = parentNode.get(seg.b) === seg.a ? seg.b
        : parentNode.get(seg.a) === seg.b ? seg.a
        : (seg.a === inletNode ? seg.b : seg.a);
      const na = nodesById.get(seg.a);
      const nb = nodesById.get(seg.b);
      const len = na && nb ? Math.max(0.2, routeLengthM(na, nb, pxPerMeter)) : 1;
      lengths.set(child, (lengths.get(child) || 0) + len);
      totalLen += len;
    }
    if (totalLen <= 0) totalLen = chain.length;
    for (const [nodeId, len] of lengths) {
      demand.set(nodeId, (demand.get(nodeId) || 0) + sockM3s * (len / totalLen));
    }
  }
}

function plantServes(c, systemType) {
  return c.system === systemType || c.system === "both";
}

function plantsFor(project, systemType) {
  return (project.components || []).filter((c) => {
    const def = componentDef(c.kind);
    return def?.role === "plant" && plantServes(c, systemType);
  });
}

function plantRoot(plant, systemType) {
  if (!plant) return null;
  return plant.system === "both" && systemType === "extract" && plant.returnNodeId
    ? plant.returnNodeId
    : plant.nodeId;
}

function flowMatchTolLs(a, b) {
  return Math.max(FLOW_MATCH_ABS_LS, FLOW_MATCH_REL * Math.max(Math.abs(a), Math.abs(b), 1));
}

function flowsMatch(a, b) {
  return Math.abs(a - b) <= flowMatchTolLs(a, b);
}

function inferRole(s, a, b, px, parentNode, terminalNodes, adj, segFlow, roleBySeg, rootNode) {
  if (s.roleOverride) return normalizeRole(s.roleOverride);
  if (s.ductKind === "sock") return "runout";
  if (a && b && isVerticalRiser(a, b, px)) return "riser";

  const childNode = parentNode.get(s.b) === s.a ? s.b : parentNode.get(s.a) === s.b ? s.a : null;
  const parent = childNode != null ? parentNode.get(childNode) : null;
  if (parent != null && parent === rootNode) return "discharge";
  if (childNode != null && terminalNodes.has(childNode)) return "runout";

  if (childNode != null && parent != null) {
    const outgoing = (adj.get(parent) || []).filter(({ other }) => parentNode.get(other) === parent);
    if (outgoing.length >= 2) {
      const thisF = segFlow.get(s.id) || 0;
      const maxF = Math.max(...outgoing.map(({ seg }) => segFlow.get(seg.id) || 0));
      if (thisF < maxF - 1e-9) {
        const incoming = parentNode.has(parent) ? (adj.get(parent) || []).find(({ other }) => other === parentNode.get(parent)) : null;
        const parentRole = incoming ? roleBySeg.get(incoming.seg.id) : null;
        if (parentRole === "branch" || parentRole === "secondary" || parentRole === "runout") return "secondary";
        return "branch";
      }
    }
  }
  return "main";
}

function emptySystem(systemType, extra = {}) {
  return {
    id: extra.id || systemType,
    name: extra.name || (systemType === "supply" ? "Supply" : "Extract"),
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

export function computeSystem(project, systemType, plantFilter = undefined) {
  const settings = project.settings || {};
  const pxPerMeter = (project.scale && project.scale.pxPerMeter) || settings.conceptPxPerMeter || 50;
  const tempC = systemType === "extract" ? settings.extractTempC ?? 22 : settings.supplyTempC ?? 18;
  const density = airDensity(tempC);
  const viscosity = airViscosity(tempC);
  const commonOpts = {
    method: settings.sizingMethod || "hybrid",
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
    applySockDemand(segs, adj, parentNode, rootNode, demand, warnings, nodesById, pxPerMeter);
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
    warnings.push(`No plant (fan/AHU) placed on the ${systemType} system — flows use per-segment overrides only.`);
  }

  const segsToSize = plantFilter ? segs.filter((s) => reachableSegs.has(s.id) || s.flowOverride != null) : segs;

  const roleBySeg = new Map();
  if (order.length) {
    for (const n of order) {
      for (const { seg, other } of adj.get(n) || []) {
        if (parentNode.get(other) !== n) continue;
        const a = nodesById.get(seg.a);
        const b = nodesById.get(seg.b);
        roleBySeg.set(seg.id, inferRole(seg, a, b, pxPerMeter, parentNode, terminalNodes, adj, segFlow, roleBySeg, rootNode));
      }
    }
  }

  const designClass = settings.dw144Class || "B";
  const classMax = PRESSURE_CLASSES[designClass]?.maxVelocity;
  const segResults = [];
  let minV = Infinity;
  let maxV = 0;
  let maxGradient = 0;
  let velWarnCount = 0;
  let frictionWarnCount = 0;
  let constructionWarnCount = 0;
  let acoustic = false;

  for (const s of segsToSize) {
    let flow = segFlow.get(s.id) ?? 0;
    if (s.flowOverride != null && s.flowOverride !== "") {
      flow = flowToM3s(Number(s.flowOverride), "l/s");
    }
    const a = nodesById.get(s.a);
    const b = nodesById.get(s.b);
    const lengthM = a && b ? routeLengthM(a, b, pxPerMeter) : 0;
    const overrideApp = applicationForSegment(project, s, a, b);
    const role = roleBySeg.get(s.id) || inferRole(s, a, b, pxPerMeter, parentNode, terminalNodes, adj, segFlow, roleBySeg, rootNode);
    const band = velocityLimits(role, settings, overrideApp);
    const maxVelocity = band.max;
    const minVelocity = band.min;
    const targetVelocity = band.target;
    if (band.applicationType === "critical_acoustic") acoustic = true;

    const shape = s.shapeOverride || settings.ductType || "round";
    const spec = sockSpecOf(s);
    const sock = s.ductKind === "sock";
    let section;
    let suggestedSection = null;
    const sizeOpts = { ...commonOpts, shape, maxVelocity, targetVelocity };
    if (sock) {
      const diameterMm = spec?.diameterMm || s.sizeOverride?.diameterMm || 400;
      section = { shape: "round", diameterMm };
      const fr = frictionForSection(flow, section, commonOpts);
      section.areaM2 = fr.area;
      section.velocity = fr.velocity;
      section.gradient = fr.gradient;
      section.warnings = [];
    } else if (hasFixedSize(s) || (s.sizeOverride && (s.sizeOverride.diameterMm || s.sizeOverride.widthMm))) {
      section = { shape, ...s.sizeOverride };
      if (shape === "square" && section.widthMm && !section.heightMm) section.heightMm = section.widthMm;
      const fr = frictionForSection(flow, section, commonOpts);
      section.areaM2 = fr.area;
      section.velocity = fr.velocity;
      section.gradient = fr.gradient;
      section.warnings = [];
      suggestedSection = sizeDuct(flow, sizeOpts);
    } else {
      section = sizeDuct(flow, sizeOpts);
    }

    const velocity = section.velocity || 0;
    const dp = dynamicPressure(velocity, density);
    const child = parentNode.get(s.b) === s.a ? s.b : parentNode.get(s.a) === s.b ? s.a : s.b;
    const parent = parentNode.get(child);
    const incoming = parent != null ? (adj.get(parent) || []).find(({ other }) => other === parentNode.get(parent)) : null;
    const sockInlet = sock && (!incoming || incoming.seg.ductKind !== "sock");
    let frictionPa = (section.gradient || 0) * lengthM;
    let gradient = section.gradient || 0;
    if (sock) {
      const specPa = Number(spec?.specPa) || 0;
      frictionPa = sockInlet ? specPa : 0;
      gradient = sockInlet && lengthM > 0 ? specPa / lengthM : 0;
      section.gradient = gradient;
    }
    const kTotal = sock ? 0 : totalFittingK(s.fittings || []);
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
      maxGradient = Math.max(maxGradient, gradient);
    }

    const withinMax = velocity <= maxVelocity + 1e-6;
    const withinMin = flow <= 0 || velocity + 1e-6 >= minVelocity;
    const level = flow > 0 ? warnLevel(velocity, band, { dw144Class: designClass, classMaxVelocity: classMax }) : "none";
    const segWarnings = [...(section.warnings || [])];
    const msg = warnMessage(velocity, band, level, { dw144Class: designClass, classMaxVelocity: classMax });
    if (msg) segWarnings.push(msg);
    if (flow > 0 && !withinMin) {
      segWarnings.push(`Velocity ${round(velocity, 1)} m/s is below the ${round(minVelocity, 1)} m/s ${band.source} minimum.`);
    }
    if ((role === "runout" || role === "terminal") && flow > 0 && velocity > 0 && velocity < targetVelocity * 0.55) {
      segWarnings.push("Unusually large final branch — check whether this size is required for noise or diffuser performance, or is an overly restrictive auto-size rule.");
    }
    if (level === "advisory" || level === "warning") velWarnCount++;
    if (level === "critical") constructionWarnCount++;
    if (gradient > (settings.targetGradient ?? 1) + 1e-6) frictionWarnCount++;
    if (!suggestedSection && !withinMax && flow > 0 && !sock) suggestedSection = sizeDuct(flow, sizeOpts);

    segResults.push({
      id: s.id,
      system: systemType,
      role,
      ductKind: s.ductKind || "sheet",
      applicationType: band.applicationType,
      applicationLabel: band.applicationLabel,
      flowM3s: flow,
      lengthM,
      section,
      suggestedSection,
      velocity,
      targetVelocity,
      gradient,
      frictionPa,
      fittingPa,
      inlinePa,
      dpPa: segDp,
      kTotal,
      fittings: (s.fittings || []).map((f) => ({ ...f })),
      withinVelocity: withinMax && withinMin && level !== "critical",
      withinMax,
      withinMin,
      maxVelocity,
      minVelocity,
      warnLevel: level,
      warningAck: !!s.warningAck,
      warningNote: s.warningNote || "",
      sizeLocked: !!s.sizeLocked,
      sock: spec,
      warnings: segWarnings,
    });
  }

  const segResById = new Map(segResults.map((r) => [r.id, r]));

  let indexStaticPa = 0;
  let indexTerminal = null;
  let indexPath = [];
  const terminals = [];
  const reached = new Set(order);
  const terminalEntries = [];
  for (const [nodeId, list] of terminalNodes) terminalEntries.push({ nodeId, list, sock: false });
  for (const [nodeId, q] of demand) {
    if (!terminalNodes.has(nodeId) && q > 0) terminalEntries.push({ nodeId, list: [], sock: true });
  }
  if (rootNode != null) {
    for (const { nodeId, list, sock } of terminalEntries) {
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
      const termLoss = list.reduce((s, c) => s + (Number(c.props?.terminalLossPa) || 0), 0);
      cum += termLoss;
      const node = nodesById.get(nodeId);
      terminals.push({
        nodeId,
        components: list,
        name: list.length
          ? list.map((c) => c.label || componentDef(c.kind)?.label).join(", ")
          : sock ? "Air sock" : "Demand",
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
  const availableStaticPa = plant ? plantStaticPa(plant.props, systemType) : 0;
  const dutyLs = plant ? plantDutyLs(plant.props, systemType) : 0;
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
    const pClassMax = PRESSURE_CLASSES[plantClass]?.maxVelocity;
    if (r.flowM3s > 0 && pClassMax && r.velocity > pClassMax + 1e-6) {
      r.warnings.push(`Velocity ${round(r.velocity, 1)} m/s exceeds DW144 Class ${plantClass} limit of ${pClassMax} m/s.`);
      r.withinVelocity = false;
      if (r.warnLevel !== "critical") {
        r.warnLevel = "critical";
        constructionWarnCount++;
      }
    }
  }
  if (acoustic) {
    warnings.push("Critical acoustic areas: consider attenuators, flexible connections, acoustic lining, low-velocity terminals, damper noise, breakout and regenerated noise at fittings.");
  }

  const plantLabel = plant ? (plant.label || componentDef(plant.kind)?.label || "Plant") : null;

  return {
    id: plant ? `${systemType}-${plant.id}` : systemType,
    name: systemType === "supply" ? "Supply" : "Extract",
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
    maxGradient,
    dw144Class: designClass,
    velWarnCount,
    frictionWarnCount,
    constructionWarnCount,
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
    const side = sys.systemType === "supply" ? "Supply" : "Extract";
    if (n === 1) sys.name = sys.plantLabel ? `${side} — ${sys.plantLabel}` : side;
    else sys.name = `${side} ${i}${sys.plantLabel ? ` — ${sys.plantLabel}` : ""}`;
  }
}

function dualAhuWarnings(project, systems) {
  const warnings = [];
  for (const c of project.components || []) {
    if (c.kind !== "ahu" || c.system !== "both") continue;
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

function buildDesignSummary(project, systems) {
  const settings = project.settings || {};
  const app = applicationOf(settings.applicationType);
  const main = resolveBand("main", settings);
  const riser = resolveBand("riser", settings);
  const branch = resolveBand("branch", settings);
  const runout = resolveBand("runout", settings);
  let highestVelocity = 0;
  let highestFriction = 0;
  let totalResistance = 0;
  let velocityWarnings = 0;
  let pressureDropWarnings = 0;
  let constructionWarnings = 0;
  for (const sys of systems) {
    totalResistance = Math.max(totalResistance, sys.indexStaticPa || 0);
    highestVelocity = Math.max(highestVelocity, sys.maxVelocity || 0);
    highestFriction = Math.max(highestFriction, sys.maxGradient || 0);
    velocityWarnings += sys.velWarnCount || 0;
    pressureDropWarnings += sys.frictionWarnCount || 0;
    constructionWarnings += sys.constructionWarnCount || 0;
  }
  return {
    applicationType: app.id,
    applicationLabel: app.label,
    sizingMethod: settings.sizingMethod || "hybrid",
    mainTarget: main.target,
    mainMax: main.max,
    riserTarget: riser.target,
    branchTarget: branch.target,
    finalRunVelocity: runout.target,
    pressureDropTarget: settings.targetGradient ?? app.friction,
    highestVelocity,
    highestFriction,
    totalResistance,
    dw144Class: settings.dw144Class || "B",
    velocityWarnings,
    pressureDropWarnings,
    constructionWarnings,
  };
}

export function computeAll(project) {
  const systems = [];
  for (const systemType of ["supply", "extract"]) {
    const plants = plantsFor(project, systemType);
    if (!plants.length) {
      const sys = computeSystem(project, systemType);
      if (sys.segments.length || sys.terminals.length) systems.push(sys);
    } else {
      for (const plant of plants) systems.push(computeSystem(project, systemType, plant));
    }
  }
  nameSystems(systems);
  const projectWarnings = dualAhuWarnings(project, systems);
  const supply = systems.find((s) => s.systemType === "supply") || emptySystem("supply");
  const extract = systems.find((s) => s.systemType === "extract") || emptySystem("extract");
  return { supply, extract, systems, projectWarnings, summary: buildDesignSummary(project, systems) };
}

export function allComputedSystems(results) {
  if (results?.systems?.length) return results.systems;
  return [results?.supply, results?.extract].filter(Boolean);
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
