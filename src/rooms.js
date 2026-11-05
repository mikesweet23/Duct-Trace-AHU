// Rooms: their floor area, which room a terminal sits in, and the system
// that serves them. A room belongs to a level like everything else.

import { polygonArea, pointInPolygon } from "./geom.js";
import { pxPerMeterOf } from "./layout.js";
import { levelIdOf } from "./levels.js";
import { componentDef } from "./standards/components.js";

export function roomAreaM2(p, r) {
  const px = pxPerMeterOf(p);
  return Math.abs(polygonArea(r.points || [])) / (px * px);
}

export function roomAt(p, pt, levelId) {
  if (!pt) return null;
  return (p.rooms || []).find((r) => levelIdOf(p, r) === levelId && (r.points || []).length >= 3 && pointInPolygon(pt, r.points)) || null;
}

// Where a terminal is for room purposes: its connection point.
export function terminalPoint(p, c) {
  return p.nodes.find((n) => n.id === c.nodeId) || { x: c.x, y: c.y };
}

export function roomOfComponent(p, c) {
  return roomAt(p, terminalPoint(p, c), levelIdOf(p, c));
}

// The terminals inside a room, on its level.
export function roomTerminals(p, r) {
  const lv = levelIdOf(p, r);
  return (p.components || []).filter((c) => componentDef(c.kind)?.role === "terminal"
    && levelIdOf(p, c) === lv && pointInPolygon(terminalPoint(p, c), r.points || []));
}

// Which systems actually feed a room: the units its terminals are joined to,
// with how many terminals each.
export function roomSystems(p, r, results) {
  const out = new Map();
  for (const c of roomTerminals(p, r)) {
    const pid = results?.plantOf?.comp?.get(c.id);
    if (pid) out.set(pid, (out.get(pid) || 0) + 1);
  }
  // an air sock counts once for each room its lengths run through
  const lv = levelIdOf(p, r);
  const nodes = new Map(p.nodes.map((n) => [n.id, n]));
  const seen = new Set();
  for (const s of p.segments || []) {
    if (!s.fabric || seen.has(s.sockId)) continue;
    const a = nodes.get(s.a), b = nodes.get(s.b);
    if (!a || !b || levelIdOf(p, a) !== lv) continue;
    if (!pointInPolygon({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, r.points || [])) continue;
    const pid = results?.plantOf?.seg?.get(s.id);
    if (!pid) continue;
    seen.add(s.sockId);
    out.set(pid, (out.get(pid) || 0) + 1);
  }
  return out;
}

// The system a room is on: the one it is assigned to, else the only one
// its terminals are joined to. Null when unassigned and fed by none or
// several.
export function roomPlantId(p, r, results) {
  if (r.plantId && (p.components || []).some((c) => c.id === r.plantId)) return r.plantId;
  const fed = roomSystems(p, r, results);
  return fed.size === 1 ? [...fed.keys()][0] : null;
}

// A room assigned to one system with terminals joined to another.
export function roomMismatch(p, r, results) {
  if (!r.plantId) return [];
  return [...roomSystems(p, r, results).keys()].filter((id) => id !== r.plantId);
}

// The airflow a terminal gets from the solve — an air sock sharing its
// unit's duty included — or its typed figure without one.
export function terminalFlowLs(c, results) {
  for (const sys of results?.systems || []) {
    for (const t of sys.terminals || []) {
      if (t.components?.length === 1 && t.components[0].id === c.id) return t.flowM3s * 1000;
    }
  }
  return Number(c.props?.designFlow_ls) || 0;
}

// Supply and extract airflow of the terminals in a room, and per m².
export function roomAirflow(p, r, results = null) {
  let supplyLs = 0, extractLs = 0;
  for (const c of roomTerminals(p, r)) {
    const q = terminalFlowLs(c, results);
    if (c.system === "extract") extractLs += q;
    else if (c.system === "supply") supplyLs += q;
  }
  const areaM2 = roomAreaM2(p, r);
  return { supplyLs, extractLs, areaM2, supplyLsM2: areaM2 > 0 ? supplyLs / areaM2 : 0, extractLsM2: areaM2 > 0 ? extractLs / areaM2 : 0 };
}
