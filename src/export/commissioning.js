// The commissioning data a CIBSE Commissioning Code A / BSRIA BG 49 air
// balance needs, worked out from the design so the engineer on site has the
// figures to set to and somewhere to write what they measured.
//
// Per system: the unit's design duty and static, the main duct traverse
// (where the total is proved), every terminal with its design flow, the
// accepted band and the duct velocity feeding it, the regulating dampers,
// and the DW144 / DW143 leakage-test figures for the pressure class. Plus
// room-by-room design totals and the outside louvre sizes.
//
// Tolerances default to the usual figures (each terminal within ±10% of
// design, the system total between 100% and 110%) and are set per project
// in Duct & basis, because the specification governs, not this tool.

import { componentDef } from "../standards/components.js";
import { LEAKAGE_FACTORS, PRESSURE_CLASSES } from "../standards/dw144.js";
import { allComputedSystems } from "../calc/network.js";
import { pointInPolygon } from "../geom.js";
import { SYSTEMS } from "../systems.js";
import { sizeLouvre, louvreBasis } from "../standards/louvres.js";

export const COMMISSIONING_DEFAULTS = { terminalTolPct: 10, systemMinPct: 100, systemMaxPct: 110 };

const REF_PREFIX = { supply: "S", extract: "E", outdoor: "F", exhaust: "X" };

export function commissioningTolerances(settings = {}) {
  const d = COMMISSIONING_DEFAULTS;
  const n = (v, def) => (Number.isFinite(Number(v)) && v !== "" && v != null ? Number(v) : def);
  return {
    terminalTolPct: n(settings.commTerminalTolPct, d.terminalTolPct),
    systemMinPct: n(settings.commSystemMinPct, d.systemMinPct),
    systemMaxPct: n(settings.commSystemMaxPct, d.systemMaxPct),
  };
}

// Guide number of traverse points, log-Tchebycheff (BS EN 12599 / BSRIA BG 49).
export function traversePoints(section) {
  if (!section) return "";
  if (section.shape === "rect" || section.shape === "square") {
    const per = (mm) => (mm < 760 ? 5 : mm <= 915 ? 6 : 7);
    const a = per(section.widthMm || 0), b = per(section.heightMm || 0);
    return `${a} × ${b} = ${a * b} points (log-Tchebycheff grid)`;
  }
  const d = section.diameterMm || 0;
  const per = d <= 600 ? 6 : d <= 1200 ? 8 : 10;
  return `2 diameters × ${per} = ${per * 2} points (log-Tchebycheff, ${per / 2} rings)`;
}

export function sizeText(section) {
  if (!section) return "-";
  if (section.shape === "rect" || section.shape === "square") return `${section.widthMm}x${section.heightMm}`;
  return `dia ${section.diameterMm}`;
}

function roomOf(project, pt) {
  if (!pt) return "";
  const r = (project.rooms || []).find((room) => room.points?.length >= 3 && pointInPolygon(pt, room.points));
  return r ? r.name : "";
}

function leakage(pressureClass) {
  const info = PRESSURE_CLASSES[pressureClass] || PRESSURE_CLASSES.A;
  const factor = LEAKAGE_FACTORS[info.leakage] ?? LEAKAGE_FACTORS.A;
  const testPa = info.maxPressure;
  return { leakageClass: info.leakage, testPa, limitLsPerM2: factor * Math.pow(testPa, 0.65) };
}

export function buildCommissioning(project, results) {
  const tol = commissioningTolerances(project.settings);
  const systems = allComputedSystems(results).filter((s) => s.segments.length || s.terminals.length);
  const pv = (v, rho) => 0.5 * (rho || 1.2) * v * v;
  const out = [];
  for (const sys of systems) {
    const info = SYSTEMS[sys.systemType] || SYSTEMS.supply;
    const prefix = REF_PREFIX[sys.systemType] || "T";
    const terminals = (sys.terminals || []).filter((t) => t.connected !== false).map((t, i) => {
      const c = t.components[0];
      const def = componentDef(c?.kind);
      const designLs = t.flowM3s * 1000;
      return {
        ref: `${prefix}${String(i + 1).padStart(2, "0")}`,
        name: t.name || def?.label || "Terminal",
        kind: def?.label || "",
        bellMouth: !!(def?.openEnd && c?.props?.bellMouth),
        room: roomOf(project, t.point),
        size: sizeText(t.runoutSection),
        velocity: t.runoutVelocity || 0,
        designLs,
        minLs: designLs * (1 - tol.terminalTolPct / 100),
        maxLs: designLs * (1 + tol.terminalTolPct / 100),
        index: t.nodeId === sys.indexTerminal,
        pathPa: t.totalPa,
      };
    });
    // the main duct off the unit is where the system total is proved
    const segById = new Map(project.segments.map((s) => [s.id, s]));
    const main = sys.segments
      .filter((r) => {
        const s = segById.get(r.id);
        return s && (s.a === sys.rootNode || s.b === sys.rootNode);
      })
      .sort((a, b) => b.flowM3s - a.flowM3s)[0] || null;
    const mainIsRiser = main && main.role === "riser";
    const traverseSeg = mainIsRiser ? sys.segments.filter((r) => r.flowM3s >= main.flowM3s - 1e-9 && r.role !== "riser")[0] || main : main;
    const traverse = traverseSeg ? {
      size: sizeText(traverseSeg.section),
      areaM2: traverseSeg.section?.areaM2 || 0,
      velocity: traverseSeg.velocity || 0,
      pvPa: pv(traverseSeg.velocity || 0, sys.density),
      flowLs: traverseSeg.flowM3s * 1000,
      points: traversePoints(traverseSeg.section),
    } : null;
    const nodeIds = new Set();
    for (const r of sys.segments) {
      const s = segById.get(r.id);
      if (s) { nodeIds.add(s.a); nodeIds.add(s.b); }
    }
    const dampers = (project.components || [])
      .filter((c) => c.kind === "vcd" && nodeIds.has(c.nodeId))
      .map((c, i) => {
        const r = sys.segments.find((x) => { const s = segById.get(x.id); return s && s.b === c.nodeId; })
          || sys.segments.find((x) => { const s = segById.get(x.id); return s && s.a === c.nodeId; });
        return { ref: `VCD-${prefix}${String(i + 1).padStart(2, "0")}`, name: c.label || "Volume control damper", size: sizeText(r?.section), flowLs: r ? r.flowM3s * 1000 : 0 };
      });
    const totalLs = sys.totalFlowM3s * 1000;
    out.push({
      name: sys.name,
      systemType: sys.systemType,
      code: info.en,
      side: info.code,
      plantLabel: sys.plant ? (sys.plant.label || componentDef(sys.plant.kind)?.label || "Unit") : "",
      totalLs,
      totalMinLs: totalLs * tol.systemMinPct / 100,
      totalMaxLs: totalLs * tol.systemMaxPct / 100,
      indexPa: sys.indexStaticPa,
      fanStaticPa: sys.fanStaticPa ?? sys.indexStaticPa,
      availablePa: sys.plant ? sys.availableStaticPa : null,
      pressureClass: sys.pressureClass,
      ...leakage(sys.pressureClass),
      traverse,
      terminals,
      dampers,
      indexRef: terminals.find((t) => t.index)?.ref || "",
    });
  }

  const rooms = (project.rooms || []).map((r) => {
    const sum = (system) => (project.components || [])
      .filter((c) => componentDef(c.kind)?.role === "terminal" && c.system === system)
      .filter((c) => {
        const n = project.nodes.find((x) => x.id === c.nodeId) || c;
        return pointInPolygon(n, r.points);
      })
      .reduce((a, c) => a + (Number(c.props?.designFlow_ls) || 0), 0);
    return { name: r.name, supplyTarget: Number(r.supplyFlow_ls) || 0, supplyTerminals: sum("supply"), extractTarget: Number(r.extractFlow_ls) || 0, extractTerminals: sum("extract") };
  });

  const louvres = [];
  for (const c of project.components || []) {
    const def = componentDef(c.kind);
    if (!def?.outside) continue;
    let flowLs = 0;
    for (const sys of systems) {
      const t = (sys.terminals || []).find((x) => x.nodeId === c.nodeId);
      if (t) flowLs = t.flowM3s * 1000;
    }
    const b = louvreBasis(c);
    const s = sizeLouvre(flowLs, { velocity: b.velocity, freeAreaPct: b.freeAreaPct });
    louvres.push({ name: c.label || def.label, kind: def.label, side: b.side, flowLs, velocity: b.velocity, freeAreaPct: b.freeAreaPct, sizing: s });
  }
  return { tolerances: tol, systems: out, rooms, louvres };
}
