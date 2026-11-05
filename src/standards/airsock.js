// Air socks — fabric (textile) supply ducts that discharge along their
// length.
//
// A sock is TRACED, like any duct: the Air sock tool starts on the end of a
// galvanised duct (or a dot on a run, or the unit), clicks each corner — 90s
// and 45s lock as they do for a duct — and can branch off itself for a tee.
// Every fabric length carries `fabric: true` and the id of the sock it
// belongs to; the sock record (project.socks) holds what is true of the whole
// sock: its total air, "ventilated throughout", pattern, suspension, and the
// nominal or manufacturer's figures.
//
// At concept and design stage the sock is sized and costed on nominal
// figures:
//   - diameter of each leg from a target inlet velocity (default 6 m/s,
//     warn above 8 m/s), over standard sock sizes,
//   - an inlet static the sock needs to stay taut and throw (default 100 Pa,
//     warn below 50 Pa) — one figure for the whole sock, bends and tees
//     included, which is how manufacturers quote it,
//   - discharge spread evenly over the vented length (l/s per metre).
// The manufacturer's selection replaces them when it is in.
//
// These are concept defaults, not any one manufacturer's data — always
// confirm with the sock supplier before construction.

import { engineeringLengthM } from "../fab/lengths.js";
import { pxPerMeterOf } from "../layout.js";
import { roomAt, roomAreaM2 } from "../rooms.js";
import { levelIdOf, levelName, multiLevel, resolveLevels } from "../levels.js";
import { componentDef } from "./components.js";

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

export function defaultSockProps() {
  return {
    designFlow_ls: 0, // 0 = share the unit's supply duty
    ventilatedThroughout: true,
    ventedLengthM: 0,
    diameterMm: 0, // 0 = auto per leg
    discharge: "perforated",
    suspension: "cable1",
    basis: "nominal",
    nominalStaticPa: 0, // 0 = the project's nominal figure
    manufacturer: "",
    product: "",
    selectionRef: "",
    mfrStaticPa: 0,
    mfrThrow_m: 0,
    mfrNR: 0,
    note: "",
  };
}

// The old one-piece sock terminal — only to convert files that have one.
export function isAirSock(c) {
  return !!componentDef(c?.kind)?.airSock;
}

export function isFabric(s) {
  return !!s?.fabric;
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

export function sockById(project, id) {
  return (project?.socks || []).find((k) => k.id === id) || null;
}

export function sockSegments(project, sockId) {
  return (project?.segments || []).filter((s) => s.fabric && s.sockId === sockId);
}

// Smallest standard sock diameter that keeps a leg at or under the target
// velocity at its start; the largest if none does.
export function sizeSockDiameterMm(flowLs, velocity = SOCK_DEFAULTS.inletVelocity) {
  const q = Math.max(0, Number(flowLs) || 0) / 1000;
  if (q <= 0) return SOCK_DIAMETERS_MM[0];
  for (const d of SOCK_DIAMETERS_MM) {
    const a = Math.PI * (d / 1000) ** 2 / 4;
    if (q / a <= velocity + 1e-9) return d;
  }
  return SOCK_DIAMETERS_MM[SOCK_DIAMETERS_MM.length - 1];
}

// The inlet static the sock adds to the index run: the manufacturer's figure
// once there is one, the nominal figure until then.
export function sockStaticPa(sock, settings = {}) {
  const pr = sock?.props || {};
  if (pr.basis === "manufacturer" && Number(pr.mfrStaticPa) > 0) return Number(pr.mfrStaticPa);
  if (Number(pr.nominalStaticPa) > 0) return Number(pr.nominalStaticPa);
  return sockBasis(settings).nominalStaticPa;
}

export function sockConfirmed(sock) {
  return sock?.props?.basis === "manufacturer" && Number(sock?.props?.mfrStaticPa) > 0;
}

// The shape of a sock on its own: total and vented length, each length's
// share of the vented length, its corners (bends, by angle), tees and closed
// ends — what the solve spreads the air over and the take-off counts.
export function sockGeometry(project, sockId) {
  const p = resolveLevels(project);
  const px = pxPerMeterOf(p);
  const sock = sockById(p, sockId);
  const segs = sockSegments(p, sockId);
  const nodes = new Map(p.nodes.map((n) => [n.id, n]));
  const lengths = new Map();
  let lengthM = 0;
  for (const s of segs) {
    const a = nodes.get(s.a), b = nodes.get(s.b);
    const L = a && b ? engineeringLengthM(s, a, b, px) : 0;
    lengths.set(s.id, L);
    lengthM += L;
  }
  const throughout = sock?.props?.ventilatedThroughout !== false;
  const typedVent = Math.max(0, Number(sock?.props?.ventedLengthM) || 0);
  const ventedLengthM = throughout ? lengthM : Math.min(lengthM, typedVent);
  const ventShare = new Map(segs.map((s) => [s.id, lengthM > 0 ? (lengths.get(s.id) / lengthM) * ventedLengthM : 0]));
  // corners and tees of the fabric itself
  const touch = new Map();
  for (const s of segs) for (const id of [s.a, s.b]) touch.set(id, [...(touch.get(id) || []), s]);
  const galvAt = (id) => p.segments.some((s) => !s.fabric && (s.a === id || s.b === id))
    || (p.components || []).some((c) => [c.nodeId, c.returnNodeId, c.outdoorNodeId, c.exhaustNodeId].includes(id));
  const bends = [];
  const bendAt = []; // { angle, segIds } — for sizing each fitting by its leg
  const teeAt = [];
  let tees = 0, ends = 0, inlets = 0;
  for (const [id, list] of touch) {
    if (galvAt(id)) { inlets++; continue; }
    if (list.length >= 3) { tees += list.length - 2; teeAt.push({ segIds: list.map((x) => x.id), qty: list.length - 2 }); continue; }
    if (list.length === 1) { ends++; continue; }
    const n = nodes.get(id);
    const o1 = nodes.get(list[0].a === id ? list[0].b : list[0].a);
    const o2 = nodes.get(list[1].a === id ? list[1].b : list[1].a);
    if (!n || !o1 || !o2) continue;
    const u = { x: n.x - o1.x, y: n.y - o1.y }, v = { x: o2.x - n.x, y: o2.y - n.y };
    const lu = Math.hypot(u.x, u.y), lv = Math.hypot(v.x, v.y);
    if (lu < 1e-6 || lv < 1e-6) continue;
    const turn = (Math.acos(Math.max(-1, Math.min(1, (u.x * v.x + u.y * v.y) / (lu * lv)))) * 180) / Math.PI;
    if (turn > 10) {
      bends.push(turn > 67.5 ? 90 : 45);
      bendAt.push({ angle: turn > 67.5 ? 90 : 45, segIds: list.map((x) => x.id) });
    }
  }
  return { sock, segs, lengths, lengthM, ventedLengthM, ventShare, bends, tees, ends, inlets, bendAt, teeAt };
}

// The solved figures for a sock: its airflow, inlet node and the diameter of
// each leg — from the network results.
export function sockResult(results, sockId) {
  for (const sys of results?.systems || []) {
    const r = (sys.socks || []).find((x) => x.sockId === sockId);
    if (r) return { ...r, plantId: sys.plant?.id || null };
  }
  return null;
}

export function sockFlowLs(sock, results) {
  const r = sockResult(results, sock?.id);
  if (r) return r.flowLs;
  return Number(sock?.props?.designFlow_ls) || 0;
}

// Everything the inspector, the report and Check show for one sock.
export function sockFigures(project, sock, results) {
  const settings = project?.settings || {};
  const basis = sockBasis(settings);
  const geo = sockGeometry(project, sock.id);
  const res = sockResult(results, sock.id);
  const flowLs = res ? res.flowLs : Number(sock.props?.designFlow_ls) || 0;
  const typedDia = Number(sock.props?.diameterMm) || 0;
  const diameterMm = res?.inletDiameterMm || typedDia || sizeSockDiameterMm(flowLs, basis.inletVelocity);
  const areaM2 = Math.PI * (diameterMm / 1000) ** 2 / 4;
  const inletVelocity = areaM2 > 0 ? flowLs / 1000 / areaM2 : 0;
  const flowPerM_ls = geo.ventedLengthM > 0 ? flowLs / geo.ventedLengthM : 0;
  const staticPa = sockStaticPa(sock, settings);
  const confirmed = sockConfirmed(sock);
  const warnings = [];
  if (flowLs > 0 && inletVelocity > basis.maxInletVelocity + 1e-6) {
    warnings.push(`Inlet velocity ${inletVelocity.toFixed(1)} m/s is above ${basis.maxInletVelocity} m/s — go up a diameter or feed it from two points.`);
  }
  if (geo.lengthM > 0 && geo.ventedLengthM <= 0) warnings.push("No vented length — the sock would not discharge any air.");
  if (staticPa < basis.minStaticPa) warnings.push(`Inlet static ${staticPa} Pa is below the ${basis.minStaticPa} Pa a sock usually needs to stay inflated.`);
  if (geo.segs.length && !res?.connected) warnings.push("Not joined to a unit — start the sock on the end of a supply duct, a dot on a run or the unit.");
  const feed = res?.feedSection;
  const feedText = feed ? (feed.shape === "rect" || feed.shape === "square" ? `${feed.widthMm}×${feed.heightMm}` : `ø${feed.diameterMm}`) : "";
  const feedMatches = !feed || (feed.shape === "round" && Number(feed.diameterMm) === diameterMm);
  if (feed && !feedMatches) warnings.push(`Fed by a ${feedText} duct into a ø${diameterMm} sock — allow a transition at the inlet (it is on the take-off), or set the sock's diameter to ${feed.shape === "round" ? `ø${feed.diameterMm}` : "suit"}.`);
  return {
    flowLs,
    lengthM: geo.lengthM,
    ventedLengthM: geo.ventedLengthM,
    diameterMm,
    autoDia: !typedDia,
    legs: res?.legs || [],
    areaM2,
    inletVelocity,
    flowPerM_ls,
    m3hPerM: flowPerM_ls * 3.6,
    staticPa,
    confirmed,
    basisLabel: confirmed ? "Manufacturer" : "Nominal",
    feedText,
    feedMatches,
    bends: geo.bends,
    tees: geo.tees,
    ends: geo.ends,
    warnings,
  };
}

// The room a sock serves most: the one holding most of its length.
export function sockRoom(project, sockId) {
  const geo = sockGeometry(project, sockId);
  const nodes = new Map(project.nodes.map((n) => [n.id, n]));
  const inRoom = new Map();
  for (const s of geo.segs) {
    const a = nodes.get(s.a), b = nodes.get(s.b);
    if (!a || !b) continue;
    const r = roomAt(project, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, levelIdOf(project, a));
    if (r) inRoom.set(r, (inRoom.get(r) || 0) + geo.lengths.get(s.id));
  }
  let best = null;
  for (const [r, L] of inRoom) if (!best || L > best[1]) best = [r, L];
  return best ? best[0] : null;
}

// The air each room gets from socks: each fabric length's share, into the
// room its middle is in. Map room → l/s.
export function sockAirByRoom(project, results) {
  const out = new Map();
  const nodes = new Map(project.nodes.map((n) => [n.id, n]));
  for (const sock of project.socks || []) {
    const geo = sockGeometry(project, sock.id);
    const q = sockFlowLs(sock, results);
    if (!(q > 0) || !(geo.ventedLengthM > 0)) continue;
    for (const s of geo.segs) {
      const a = nodes.get(s.a), b = nodes.get(s.b);
      if (!a || !b) continue;
      const r = roomAt(project, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, levelIdOf(project, a));
      if (r) out.set(r, (out.get(r) || 0) + (q * geo.ventShare.get(s.id)) / geo.ventedLengthM);
    }
  }
  return out;
}

// One row per sock, for the inspector, the report, the take-off and Check.
export function sockSchedule(project, results) {
  const plants = new Map((project?.components || []).map((c) => [c.id, c]));
  const roomAir = sockAirByRoom(project, results);
  const nodes = new Map((project?.nodes || []).map((n) => [n.id, n]));
  return (project?.socks || []).filter((k) => sockSegments(project, k.id).length).map((sock, i) => {
    const fig = sockFigures(project, sock, results);
    const res = sockResult(results, sock.id);
    const plant = res?.plantId ? plants.get(res.plantId) : null;
    const room = sockRoom(project, sock.id);
    const areaM2 = room ? roomAreaM2(project, room) : 0;
    const first = sockSegments(project, sock.id)[0];
    return {
      id: sock.id,
      segId: first?.id || null,
      plantId: res?.plantId || null,
      level: multiLevel(project) && first ? levelName(project, levelIdOf(project, nodes.get(first.a))) : "",
      room: room?.name || "",
      roomAreaM2: areaM2,
      roomRateLsM2: areaM2 > 0 ? (roomAir.get(room) || 0) / areaM2 : 0,
      suspension: sock.props?.suspension || "cable1",
      ref: sock.label || `Air sock ${i + 1}`,
      system: plant ? [plant.tag, plant.label].filter(Boolean).join(" ") : "",
      shared: !(Number(sock.props?.designFlow_ls) > 0),
      discharge: SOCK_DISCHARGE[sock.props?.discharge] || sock.props?.discharge || "",
      manufacturer: sock.props?.manufacturer || "",
      product: sock.props?.product || "",
      selectionRef: sock.props?.selectionRef || "",
      throwM: Number(sock.props?.mfrThrow_m) || 0,
      nr: Number(sock.props?.mfrNR) || 0,
      ...fig,
    };
  });
}

// Procurement lines for the socks: fabric by diameter and fabric type (one
// line per leg size), fabric bends and tees, end caps, the suspension cable
// or track, the drop rods it hangs from, and a connector at each inlet.
// Drops are an estimate at the spacing in Duct & basis.
export function sockTakeoff(project, results, filters = {}) {
  const b = sockBasis(project?.settings);
  const rows = sockSchedule(project, results).filter((r) =>
    (!filters.ahu || r.plantId === filters.ahu) && (!filters.floor || r.level === filters.floor));
  const bodies = new Map();
  const fittings = new Map();
  const suspension = new Map();
  let drops = 0, inlets = 0;
  const addFit = (label, size, qty) => {
    if (!qty) return;
    const k = `${label}|${size}`;
    if (!fittings.has(k)) fittings.set(k, { label, size, qty: 0 });
    fittings.get(k).qty += qty;
  };
  for (const r of rows) {
    const fabric = [r.manufacturer, r.product].filter(Boolean).join(" ") || "Fabric — to manufacturer";
    const geo = sockGeometry(project, r.id);
    const legs = r.legs.length ? r.legs : [{ segIds: geo.segs.map((s) => s.id), diameterMm: r.diameterMm }];
    for (const leg of legs) {
      const L = leg.segIds.reduce((a, id) => a + (geo.lengths.get(id) || 0), 0);
      const kb = `${leg.diameterMm}|${fabric}|${r.discharge}`;
      if (!bodies.has(kb)) bodies.set(kb, { size: `dia ${leg.diameterMm}`, diameterMm: leg.diameterMm, fabric, discharge: r.discharge, qty: 0, lengthM: 0, refs: [] });
      const g = bodies.get(kb);
      g.qty += 1;
      g.lengthM += L;
      if (!g.refs.includes(r.ref)) g.refs.push(r.ref);
    }
    const size = `dia ${r.diameterMm}`;
    // each bend and tee at the size of the leg it is on (a tee by its run in)
    const legDia = new Map();
    for (const leg of legs) for (const id of leg.segIds) legDia.set(id, leg.diameterMm);
    const diaOf = (ids) => Math.max(...ids.map((id) => legDia.get(id) || r.diameterMm));
    for (const bnd of geo.bendAt) addFit(`Fabric ${bnd.angle}° bend`, `dia ${diaOf(bnd.segIds)}`, 1);
    for (const t of geo.teeAt) addFit("Fabric tee", `dia ${diaOf(t.segIds)}`, t.qty);
    addFit("Fabric end cap", "", r.ends);
    inlets += Math.max(1, geo.inlets);
    addFit(r.feedMatches ? "Inlet spigot / connector" : `Inlet transition ${r.feedText} to`, size, Math.max(1, geo.inlets));
    const sus = SOCK_SUSPENSION[r.suspension] || SOCK_SUSPENSION.cable1;
    if (sus.rows > 0 && r.lengthM > 0) {
      if (!suspension.has(sus.kind)) suspension.set(sus.kind, { label: sus.kind, lengthM: 0 });
      suspension.get(sus.kind).lengthM += sus.rows * r.lengthM;
      // per straight length, so a corner or a tee starts a new run of drops
      for (const s of geo.segs) drops += sus.rows * (Math.ceil((geo.lengths.get(s.id) || 0) / b.dropSpacingM) + 1);
    }
  }
  const r2 = (v) => Math.round(v * 100) / 100;
  return {
    rows,
    bodies: [...bodies.values()].map((g) => ({ ...g, lengthM: r2(g.lengthM) })),
    fittings: [...fittings.values()],
    suspension: [...suspension.values()].map((g) => ({ ...g, lengthM: r2(g.lengthM) })),
    drops,
    inlets,
    dropSpacingM: b.dropSpacingM,
  };
}
