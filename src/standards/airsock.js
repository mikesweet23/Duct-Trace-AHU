// Air socks — fabric (textile) supply ducts that discharge along their
// length. At concept and design stage all that is usually known is the total
// air the sock has to deliver and that the space is "ventilated throughout",
// so the sock is sized and costed here on nominal figures:
//
//   - diameter from a target inlet velocity (default 6 m/s, cap 8 m/s),
//   - an inlet static pressure the sock needs to stay taut and throw
//     (default 100 Pa nominal, manufacturers usually ask for at least ~50 Pa),
//   - discharge spread evenly over the vented length (l/s per metre).
//
// Once the manufacturer has made a selection their figures replace these:
// set the basis to "manufacturer" and type their inlet static, throw, NR and
// selection reference. The nominal figures stay visible for comparison.
//
// These are concept defaults, not any one manufacturer's data — always
// confirm with the sock supplier before construction.

import { componentDef } from "./components.js";
import { roomOfComponent, roomAreaM2 } from "../rooms.js";
import { levelIdOf, levelName, multiLevel } from "../levels.js";

export const SOCK_DIAMETERS_MM = [160, 200, 250, 315, 355, 400, 450, 500, 560, 630, 710, 800, 900, 1000, 1120, 1250, 1400, 1600];

export const SOCK_DISCHARGE = {
  perforated: "Perforated — directional jets",
  micro: "Micro-perforated — low velocity, mixing",
  permeable: "Permeable fabric — diffuse, draught-free",
  nozzle: "Nozzles — long throw",
  orifice: "Orifices / slots",
};

// How the sock hangs: one or two runs of cable or track along its length.
export const SOCK_SUSPENSION = {
  cable1: { label: "Single cable", rows: 1, kind: "Suspension cable" },
  cable2: { label: "Twin cable", rows: 2, kind: "Suspension cable" },
  track1: { label: "Single track / rail", rows: 1, kind: "Suspension track" },
  track2: { label: "Twin track / rail", rows: 2, kind: "Suspension track" },
  none: { label: "None / by others", rows: 0, kind: "" },
};

export const SOCK_BASIS = {
  nominal: "Nominal (concept / design)",
  manufacturer: "Manufacturer selection",
};

export const SOCK_DEFAULTS = {
  inletVelocity: 6, // m/s, target for the auto diameter
  maxInletVelocity: 8, // m/s, warn above
  nominalStaticPa: 100, // Pa at the sock inlet
  minStaticPa: 50, // Pa, below this a sock may not stay inflated
  dropSpacingM: 1.5, // m between drop rods / hangers on each suspension run
};

export function isAirSock(c) {
  return !!componentDef(c?.kind)?.airSock;
}

function settingOr(settings, key, fallback) {
  const v = Number(settings?.[key]);
  return v > 0 ? v : fallback;
}

export function sockBasis(settings = {}) {
  return {
    inletVelocity: settingOr(settings, "sockInletVelocity", SOCK_DEFAULTS.inletVelocity),
    maxInletVelocity: settingOr(settings, "sockMaxInletVelocity", SOCK_DEFAULTS.maxInletVelocity),
    nominalStaticPa: settingOr(settings, "sockNominalStaticPa", SOCK_DEFAULTS.nominalStaticPa),
    minStaticPa: settingOr(settings, "sockMinStaticPa", SOCK_DEFAULTS.minStaticPa),
    dropSpacingM: settingOr(settings, "sockDropSpacingM", SOCK_DEFAULTS.dropSpacingM),
  };
}

export function sockLengthM(c) {
  return Math.max(0, Number(c?.widthM) || 0);
}

// "Ventilated throughout": the whole length discharges. Otherwise only the
// vented length typed on the sock does (the rest is a plain fabric carrier).
export function sockVentedLengthM(c) {
  const L = sockLengthM(c);
  if (c?.props?.ventilatedThroughout !== false) return L;
  const v = Number(c?.props?.ventedLengthM) || 0;
  return Math.max(0, Math.min(L, v));
}

// Smallest standard sock diameter that keeps the inlet at or under the
// target velocity; the largest if none does.
export function sizeSockDiameterMm(flowLs, velocity = SOCK_DEFAULTS.inletVelocity) {
  const q = Math.max(0, Number(flowLs) || 0) / 1000;
  if (q <= 0) return SOCK_DIAMETERS_MM[0];
  for (const d of SOCK_DIAMETERS_MM) {
    const a = Math.PI * (d / 1000) ** 2 / 4;
    if (q / a <= velocity + 1e-9) return d;
  }
  return SOCK_DIAMETERS_MM[SOCK_DIAMETERS_MM.length - 1];
}

export function sockDiameterMm(c, flowLs, settings = {}) {
  const typed = Number(c?.props?.diameterMm) || 0;
  if (typed > 0) return typed;
  return sizeSockDiameterMm(flowLs, sockBasis(settings).inletVelocity);
}

// The inlet static the sock adds to the index run: the manufacturer's figure
// once there is one, the nominal figure until then.
export function sockStaticPa(c, settings = {}) {
  const pr = c?.props || {};
  if (pr.basis === "manufacturer" && Number(pr.mfrStaticPa) > 0) return Number(pr.mfrStaticPa);
  if (Number(pr.nominalStaticPa) > 0) return Number(pr.nominalStaticPa);
  return sockBasis(settings).nominalStaticPa;
}

export function sockConfirmed(c) {
  return c?.props?.basis === "manufacturer" && Number(c?.props?.mfrStaticPa) > 0;
}

// Everything a schedule or the inspector shows for one sock, at the airflow
// it actually carries (its own figure, or its share of the unit's duty).
export function sockFigures(c, flowLs, settings = {}) {
  const basis = sockBasis(settings);
  const q = Math.max(0, Number(flowLs) || 0);
  const lengthM = sockLengthM(c);
  const ventedLengthM = sockVentedLengthM(c);
  const autoDia = !(Number(c?.props?.diameterMm) > 0);
  const diameterMm = sockDiameterMm(c, q, settings);
  const areaM2 = Math.PI * (diameterMm / 1000) ** 2 / 4;
  const inletVelocity = areaM2 > 0 ? q / 1000 / areaM2 : 0;
  const flowPerM_ls = ventedLengthM > 0 ? q / ventedLengthM : 0;
  const staticPa = sockStaticPa(c, settings);
  const confirmed = sockConfirmed(c);
  const warnings = [];
  if (q > 0 && inletVelocity > basis.maxInletVelocity + 1e-6) {
    warnings.push(`Inlet velocity ${inletVelocity.toFixed(1)} m/s is above ${basis.maxInletVelocity} m/s — go up a diameter or split the sock.`);
  }
  if (lengthM > 0 && ventedLengthM <= 0) warnings.push("No vented length — the sock would not discharge any air.");
  if (staticPa < basis.minStaticPa) warnings.push(`Inlet static ${staticPa} Pa is below the ${basis.minStaticPa} Pa a sock usually needs to stay inflated.`);
  return {
    flowLs: q,
    lengthM,
    ventedLengthM,
    diameterMm,
    autoDia,
    areaM2,
    inletVelocity,
    flowPerM_ls,
    m3hPerM: flowPerM_ls * 3.6,
    staticPa,
    confirmed,
    basisLabel: confirmed ? "Manufacturer" : "Nominal",
    warnings,
  };
}

// The airflow a sock actually carries: its share from the solve if it is
// joined to a unit, otherwise the figure typed on it.
export function sockFlowLs(c, results) {
  const systems = results?.systems || [];
  for (const sys of systems) {
    const t = (sys.terminals || []).find((x) => x.nodeId === c.nodeId && x.components?.some((k) => k.id === c.id));
    if (t) {
      // a node with more than one terminal on it: this sock's own share
      if (t.components.length === 1) return t.flowM3s * 1000;
    }
  }
  return Number(c?.props?.designFlow_ls) || 0;
}

// One row per sock, for the inspector, the report, the take-off and Check.
// With each, the room it sits in and the supply rate (l/s per m²) that the
// socks in that room give it.
export function sockSchedule(project, results) {
  const settings = project?.settings || {};
  const plants = new Map((project?.components || []).map((c) => [c.id, c]));
  const socks = (project?.components || []).filter(isAirSock);
  const flows = new Map(socks.map((c) => [c.id, sockFlowLs(c, results)]));
  const rooms = new Map(socks.map((c) => [c.id, roomOfComponent(project, c)]));
  const roomFlow = new Map();
  for (const c of socks) {
    const r = rooms.get(c.id);
    if (r) roomFlow.set(r, (roomFlow.get(r) || 0) + flows.get(c.id));
  }
  return socks.map((c, i) => {
    const flowLs = flows.get(c.id);
    const fig = sockFigures(c, flowLs, settings);
    const plantId = results?.plantOf?.comp?.get(c.id) || null;
    const plant = plantId ? plants.get(plantId) : null;
    const room = rooms.get(c.id);
    const areaM2 = room ? roomAreaM2(project, room) : 0;
    return {
      id: c.id,
      plantId,
      level: multiLevel(project) ? levelName(project, levelIdOf(project, c)) : "",
      room: room?.name || "",
      roomAreaM2: areaM2,
      roomRateLsM2: areaM2 > 0 ? (roomFlow.get(room) || 0) / areaM2 : 0,
      suspension: c.props?.suspension || "cable1",
      ref: c.label || `Air sock ${i + 1}`,
      system: plant ? [plant.tag, plant.label].filter(Boolean).join(" ") : "",
      shared: !(Number(c.props?.designFlow_ls) > 0),
      discharge: SOCK_DISCHARGE[c.props?.discharge] || c.props?.discharge || "",
      manufacturer: c.props?.manufacturer || "",
      product: c.props?.product || "",
      selectionRef: c.props?.selectionRef || "",
      throwM: Number(c.props?.mfrThrow_m) || 0,
      nr: Number(c.props?.mfrNR) || 0,
      ...fig,
    };
  });
}

// Procurement lines for the socks: the sock bodies grouped by size and
// fabric, the suspension cable or track, and the drop rods it hangs from.
// Drops are an estimate at the spacing in Duct & basis.
export function sockTakeoff(project, results, filters = {}) {
  const b = sockBasis(project?.settings);
  const rows = sockSchedule(project, results).filter((r) =>
    (!filters.ahu || r.plantId === filters.ahu) && (!filters.floor || r.level === filters.floor));
  const bodies = new Map();
  const suspension = new Map();
  let drops = 0;
  let inlets = 0;
  for (const r of rows) {
    const fabric = [r.manufacturer, r.product].filter(Boolean).join(" ") || "Fabric — to manufacturer";
    const kb = `${r.diameterMm}|${fabric}|${r.discharge}`;
    if (!bodies.has(kb)) bodies.set(kb, { size: `dia ${r.diameterMm}`, diameterMm: r.diameterMm, fabric, discharge: r.discharge, qty: 0, lengthM: 0, refs: [] });
    const g = bodies.get(kb);
    g.qty += 1;
    g.lengthM += r.lengthM;
    g.refs.push(r.ref);
    inlets += 1;
    const sus = SOCK_SUSPENSION[r.suspension] || SOCK_SUSPENSION.cable1;
    if (sus.rows > 0 && r.lengthM > 0) {
      if (!suspension.has(sus.kind)) suspension.set(sus.kind, { label: sus.kind, lengthM: 0 });
      suspension.get(sus.kind).lengthM += sus.rows * r.lengthM;
      drops += sus.rows * (Math.ceil(r.lengthM / b.dropSpacingM) + 1);
    }
  }
  const r2 = (v) => Math.round(v * 100) / 100;
  return {
    rows,
    bodies: [...bodies.values()].map((g) => ({ ...g, lengthM: r2(g.lengthM) })),
    suspension: [...suspension.values()].map((g) => ({ ...g, lengthM: r2(g.lengthM) })),
    drops,
    inlets,
    dropSpacingM: b.dropSpacingM,
  };
}
