// Convert the Stage 1 centreline network into a fabrication model.
// Stage 1 remains the calculation source; this file only interprets it.

import { angleBetween, dist, isVerticalRiser } from "../geom.js";
import { componentDef } from "../standards/components.js";
import { FITTINGS, alternativesFor } from "../standards/fittings.js";
import { findSegResult } from "../calc/network.js";
import { pxPerMeterOf } from "../layout.js";
import { round } from "../units.js";
import {
  DEFAULT_STANDARD_LENGTH_M,
  DEFAULT_TRANSITION_ANGLE_DEG,
  elbowCentrelineM,
  emptyCosting,
  engineeringLengthM,
  graphicalLengthM,
  sectionMajorMm,
  splitStandardLengths,
  transitionLengthM,
} from "./lengths.js";
import {
  CONSTRUCTION_TYPES,
  PIECE_KINDS,
  constructionFor,
  inheritInsulation,
  isCircularConstruction,
  outerAreaM2,
  sheetAreaM2,
  sizeLabel,
  steelWeightKg,
} from "./catalog.js";

const COLINEAR_DEG = 12;
const OFFSET_PARALLEL_DEG = 12;

function vec(from, to) {
  return { x: to.x - from.x, y: to.y - from.y };
}

function unit(v) {
  const L = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / L, y: v.y / L };
}

function sectionOf(seg, results, settings) {
  const res = findSegResult(results, seg.id);
  if (res?.section) return { ...res.section, shape: res.section.shape || seg.shapeOverride || settings.ductType || "round" };
  const shape = seg.shapeOverride || settings.ductType || "round";
  if (shape === "rect" || shape === "square") {
    return { shape, widthMm: seg.sizeOverride?.widthMm || settings.rectHeight || 300, heightMm: seg.sizeOverride?.heightMm || settings.rectHeight || 300 };
  }
  return { shape, diameterMm: seg.sizeOverride?.diameterMm || 200 };
}

function sameSize(a, b) {
  if (!a || !b) return true;
  if ((a.shape === "rect" || a.shape === "square") !== (b.shape === "rect" || b.shape === "square")) return false;
  if (a.shape === "rect" || a.shape === "square") {
    return a.widthMm === b.widthMm && a.heightMm === b.heightMm;
  }
  return a.diameterMm === b.diameterMm;
}

function mixedFamily(a, b) {
  const ar = a?.shape === "rect" || a?.shape === "square";
  const br = b?.shape === "rect" || b?.shape === "square";
  return ar !== br;
}

function planAngleAt(node, otherA, otherB) {
  return angleBetween(vec(node, otherA), vec(node, otherB));
}

function isOffsetNode(node, na, nb, px) {
  const ua = unit(vec(node, na));
  const ub = unit(vec(node, nb));
  const parallel = Math.abs(ua.x * ub.x + ua.y * ub.y) > Math.cos((OFFSET_PARALLEL_DEG * Math.PI) / 180);
  if (!parallel) return false;
  const ab = vec(na, nb);
  const cross = Math.abs(ua.x * ab.y - ua.y * ab.x);
  const offsetM = cross / (px || 1);
  return offsetM > 0.08;
}

function defaultElbowType(angle, existing) {
  const listed = (existing || []).find((f) => FITTINGS[f.type]?.group === "elbow");
  if (listed) return listed.type;
  if (angle < 38) return "bend30";
  if (angle < 60) return "bend45";
  return "bend90_radius";
}

function defaultBranchType(shape, existing) {
  const listed = (existing || []).find((f) => FITTINGS[f.type]?.group === "branch" && f.type !== "tee_straight");
  if (listed) return listed.type;
  return shape === "rect" || shape === "square" ? "tee_rect" : "tee_branch";
}

function defaultBootType(shape) {
  if (shape === "square") return "boot_square";
  if (shape === "rect") return "boot_rect";
  return "boot_circular";
}

function nodeComps(project, nodeId) {
  return (project.components || []).filter((c) => c.nodeId === nodeId || c.returnNodeId === nodeId);
}

function nextRef(counters, kind) {
  const prefix = PIECE_KINDS[kind]?.prefix || "F";
  counters[prefix] = (counters[prefix] || 0) + 1;
  return `${prefix}${String(counters[prefix]).padStart(3, "0")}`;
}

function reuseRef(prevByKey, key, counters, kind) {
  const prev = prevByKey.get(key);
  if (prev?.ref) return prev.ref;
  return nextRef(counters, kind);
}

function pieceBase(partial) {
  const section = partial.section;
  const lengthM = Number(partial.lengthM) || 0;
  const area = sheetAreaM2(section, lengthM);
  const ins = partial.insulation || { type: "", thicknessMm: 0, cladding: "" };
  const insArea = outerAreaM2(section, lengthM, ins.thicknessMm || 0);
  return {
    category: PIECE_KINDS[partial.kind]?.category || "fitting",
    label: partial.label || PIECE_KINDS[partial.kind]?.label || partial.kind,
    manual: false,
    stale: false,
    costing: emptyCosting(),
    sheetAreaM2: round(area, 3),
    weightKg: round(steelWeightKg(area), 2),
    insulationAreaM2: ins.thicknessMm > 0 ? round(insArea, 3) : 0,
    insulationVolumeM3: ins.thicknessMm > 0 ? round(insArea * (ins.thicknessMm / 1000), 4) : 0,
    claddingAreaM2: ins.cladding ? round(insArea, 3) : 0,
    sizeText: sizeLabel(section),
    ...partial,
  };
}

function overrideOf(physical, key) {
  return physical?.overrides?.[key] || null;
}

function applyOverride(piece, over) {
  if (!over) return piece;
  const next = { ...piece, ...over, manual: true, sourceKey: piece.sourceKey };
  if (over.fittingType) {
    next.fittingType = over.fittingType;
    next.label = FITTINGS[over.fittingType]?.label || next.label;
    next.k = FITTINGS[over.fittingType]?.k ?? next.k;
  }
  if (over.alignment) next.alignment = over.alignment;
  if (over.standardLengthM) next.standardLengthM = over.standardLengthM;
  return next;
}

function engineeringFingerprint(project, results) {
  const parts = [];
  for (const s of project.segments || []) {
    const res = findSegResult(results, s.id);
    const sec = res?.section || s.sizeOverride || {};
    parts.push([
      s.id, s.a, s.b, s.system,
      s.shapeOverride || "",
      s.engineeringLengthM ?? "",
      s.constructionType || "",
      sec.diameterMm || "",
      sec.widthMm || "",
      sec.heightMm || "",
      s.floor || "",
      s.zone || "",
      s.area || "",
    ].join(":"));
  }
  for (const n of project.nodes || []) {
    parts.push([n.id, Math.round(n.x), Math.round(n.y), round(n.z || 0, 2), n.elbowType || "", n.branchType || "", n.transitionAlignment || "", n.offsetStyle || ""].join(":"));
  }
  return parts.join("|");
}

function adjacent(project, nodeId) {
  return (project.segments || []).filter((s) => s.a === nodeId || s.b === nodeId);
}

function otherNode(project, seg, nodeId) {
  const id = seg.a === nodeId ? seg.b : seg.a;
  return project.nodes.find((n) => n.id === id);
}

function pathForSegment(a, b, px, elevationMode) {
  if (isVerticalRiser(a, b, px)) {
    return [{ kind: "run", a: { ...a }, b: { ...b }, vertical: true }];
  }
  const dz = (b.z || 0) - (a.z || 0);
  if (Math.abs(dz) < 0.05 || elevationMode === "diagonal") {
    return [{ kind: "run", a: { ...a }, b: { ...b }, vertical: false }];
  }
  const mid = { x: b.x, y: b.y, z: a.z || 0, id: `${a.id || "a"}~${b.id || "b"}` };
  return [
    { kind: "run", a: { ...a }, b: mid, vertical: false },
    { kind: "drop-elbow", at: mid, from: a, to: b, angle: 90 },
    { kind: "run", a: mid, b: { ...b }, vertical: true },
  ];
}

function fittingAllowanceM(kind, section, angleDeg, settings) {
  const major = sectionMajorMm(section);
  if (kind === "elbow") return elbowCentrelineM(major, angleDeg || 90, 1.5);
  if (kind === "reducer" || kind === "enlarger" || kind === "transition" || kind === "sqr_to_round") {
    return transitionLengthM(Math.max(40, major * 0.15), settings.maxTransitionAngleDeg);
  }
  if (kind === "boot" || kind === "flex") return 0.25;
  if (kind === "offset") return 0.4;
  return 0;
}

function classifyNode(project, node, results, settings) {
  const segs = adjacent(project, node.id);
  const comps = nodeComps(project, node.id);
  const terminals = comps.filter((c) => componentDef(c.kind)?.role === "terminal");
  const plants = comps.filter((c) => componentDef(c.kind)?.role === "plant");
  const inlines = comps.filter((c) => componentDef(c.kind)?.role === "inline");
  if (segs.length >= 3) return { type: "branch", segs, terminals, plants, inlines };
  if (segs.length === 1) {
    if (terminals.length) return { type: "boot", segs, terminals, plants, inlines };
    if (plants.length) return { type: "flex", segs, terminals, plants, inlines };
    return { type: "cap", segs, terminals, plants, inlines };
  }
  if (segs.length === 2) {
    const na = otherNode(project, segs[0], node.id);
    const nb = otherNode(project, segs[1], node.id);
    const px = pxPerMeterOf(project);
    if (na && nb && isOffsetNode(node, na, nb, px)) return { type: "offset", segs, na, nb, terminals, plants, inlines };
    const sa = sectionOf(segs[0], results, settings);
    const sb = sectionOf(segs[1], results, settings);
    if (mixedFamily(sa, sb)) return { type: "sqr_to_round", segs, sa, sb, terminals, plants, inlines };
    if (!sameSize(sa, sb)) return { type: "reducer", segs, sa, sb, terminals, plants, inlines };
    if (na && nb) {
      const ang = planAngleAt(node, na, nb);
      // Vectors from the node; 180° = straight through.
      const turn = Math.abs(180 - ang);
      if (turn > COLINEAR_DEG) return { type: "elbow", segs, angle: turn, terminals, plants, inlines };
    }
    return { type: "through", segs, terminals, plants, inlines };
  }
  return { type: "idle", segs, terminals, plants, inlines };
}

function damperPieces(project, node, seg, section, insulation, counters, prevByKey) {
  const comps = nodeComps(project, node.id).filter((c) => {
    const k = c.kind || "";
    return /damper/.test(k);
  });
  return comps.map((c) => {
    const key = `damper:${c.id}`;
    return pieceBase({
      ref: reuseRef(prevByKey, key, counters, "damper"),
      sourceKey: key,
      kind: "damper",
      fittingType: c.kind,
      label: componentDef(c.kind)?.label || "Damper",
      segmentId: seg.id,
      nodeId: node.id,
      system: seg.system,
      section,
      construction: constructionFor(seg, project.settings, section.shape),
      lengthM: 0.15,
      insulation,
      floor: seg.floor || "",
      zone: seg.zone || "",
      area: seg.area || "",
      plantId: null,
      a: { x: node.x, y: node.y, z: node.z || 0 },
      b: { x: node.x, y: node.y, z: node.z || 0 },
    });
  });
}

function makeFitting(opts) {
  const { counters, prevByKey, key, kind, fittingType, seg, node, section, sectionTo, construction, insulation, lengthM, extra } = opts;
  const def = FITTINGS[fittingType] || {};
  return pieceBase({
    ref: reuseRef(prevByKey, key, counters, kind),
    sourceKey: key,
    kind,
    fittingType,
    label: def.label || PIECE_KINDS[kind]?.label || kind,
    k: def.k,
    segmentId: seg.id,
    nodeId: node?.id || null,
    system: seg.system,
    section,
    sectionTo: sectionTo || null,
    construction,
    lengthM: lengthM || 0,
    insulation,
    floor: seg.floor || "",
    zone: seg.zone || "",
    area: seg.area || "",
    alternatives: alternativesFor(fittingType, section?.shape),
    a: extra?.a || (node ? { x: node.x, y: node.y, z: node.z || 0 } : null),
    b: extra?.b || (node ? { x: node.x, y: node.y, z: node.z || 0 } : null),
    c: extra?.c || null,
    angleDeg: extra?.angleDeg,
    alignment: extra?.alignment || "symmetric",
    offsetMm: extra?.offsetMm,
    branchSection: extra?.branchSection || null,
    vertical: extra?.vertical || false,
    plantId: extra?.plantId || null,
    ...extra?.more,
  });
}

export function generatePhysicalModel(project, results, opts = {}) {
  const settings = project.settings || {};
  const px = pxPerMeterOf(project);
  const elevationMode = settings.elevationMode || "orthogonal";
  const standardDefault = Number(settings.standardStraightLengthM) > 0
    ? Number(settings.standardStraightLengthM)
    : DEFAULT_STANDARD_LENGTH_M;
  const maxAngle = Number(settings.maxTransitionAngleDeg) || DEFAULT_TRANSITION_ANGLE_DEG;
  const takeoffMode = settings.takeoffMode || "cut_lengths";
  const prev = opts.previous || project.physical || null;
  const prevByKey = new Map((prev?.pieces || []).map((p) => [p.sourceKey, p]));
  const counters = { ...(prev?.counters || {}) };
  if (opts.resetIds) {
    counters.D = 0; counters.F = 0; counters.B = 0; counters.J = 0; counters.A = 0; counters.S = 0;
  }

  const pieces = [];
  const nodeInfo = new Map();
  for (const n of project.nodes || []) {
    nodeInfo.set(n.id, classifyNode(project, n, results, settings));
  }

  const allowanceBySeg = new Map();
  const addAllow = (segId, m) => allowanceBySeg.set(segId, (allowanceBySeg.get(segId) || 0) + (m || 0));

  for (const n of project.nodes || []) {
    const info = nodeInfo.get(n.id);
    const overMap = prev;
    if (!info || !info.segs?.length) continue;

    if (info.type === "elbow") {
      const seg = info.segs[0];
      const section = sectionOf(seg, results, settings);
      const construction = constructionFor(seg, settings, section.shape);
      const insulation = inheritInsulation(project, seg, seg.system);
      const type = n.elbowType || defaultElbowType(info.angle, seg.fittings);
      const key = `elbow:${n.id}`;
      const lengthM = elbowCentrelineM(sectionMajorMm(section), info.angle);
      let piece = makeFitting({
        counters, prevByKey, key, kind: "elbow", fittingType: type,
        seg, node: n, section, construction, insulation, lengthM,
        extra: { angleDeg: round(info.angle, 1) },
      });
      piece = applyOverride(piece, overrideOf(overMap, key));
      pieces.push(piece);
      for (const s of info.segs) addAllow(s.id, lengthM / 2);
    }

    if (info.type === "reducer" || info.type === "sqr_to_round") {
      const [s0, s1] = info.segs;
      const sa = sectionOf(s0, results, settings);
      const sb = sectionOf(s1, results, settings);
      const from = sa;
      const to = sb;
      const delta = mixedFamily(sa, sb)
        ? Math.max(sectionMajorMm(sa), sectionMajorMm(sb)) * 0.4
        : (sa.shape === "rect" || sa.shape === "square"
          ? Math.max(Math.abs((sa.widthMm || 0) - (sb.widthMm || 0)), Math.abs((sa.heightMm || 0) - (sb.heightMm || 0)))
          : Math.abs((sa.diameterMm || 0) - (sb.diameterMm || 0)));
      const lengthM = transitionLengthM(delta || 50, maxAngle);
      const growing = sectionMajorMm(to) > sectionMajorMm(from);
      const kind = info.type === "sqr_to_round" ? "sqr_to_round" : growing ? "enlarger" : "reducer";
      const fittingType = n.reducerType
        || (kind === "sqr_to_round" ? "sqr_to_round" : growing ? "taper_expander" : "taper_reducer");
      const key = `reducer:${n.id}`;
      const host = s0;
      const construction = constructionFor(host, settings, from.shape);
      const insulation = inheritInsulation(project, host, host.system);
      let piece = makeFitting({
        counters, prevByKey, key, kind, fittingType,
        seg: host, node: n, section: from, sectionTo: to, construction, insulation, lengthM,
        extra: { alignment: n.transitionAlignment || "symmetric" },
      });
      piece = applyOverride(piece, overrideOf(overMap, key));
      pieces.push(piece);
      addAllow(s0.id, lengthM / 2);
      addAllow(s1.id, lengthM / 2);
    }

    if (info.type === "branch") {
      const sized = info.segs.map((s) => ({ s, flow: findSegResult(results, s.id)?.flowM3s || 0, section: sectionOf(s, results, settings) }));
      sized.sort((a, b) => b.flow - a.flow);
      const main = sized[0];
      const through = sized[1];
      if (through && (mixedFamily(main.section, through.section) || !sameSize(main.section, through.section))) {
        const sa = main.section;
        const sb = through.section;
        const delta = mixedFamily(sa, sb)
          ? Math.max(sectionMajorMm(sa), sectionMajorMm(sb)) * 0.4
          : (sa.shape === "rect" || sa.shape === "square"
            ? Math.max(Math.abs((sa.widthMm || 0) - (sb.widthMm || 0)), Math.abs((sa.heightMm || 0) - (sb.heightMm || 0)))
            : Math.abs((sa.diameterMm || 0) - (sb.diameterMm || 0)));
        const lengthM = transitionLengthM(delta || 50, maxAngle);
        const growing = sectionMajorMm(sb) > sectionMajorMm(sa);
        const kind = mixedFamily(sa, sb) ? "sqr_to_round" : growing ? "enlarger" : "reducer";
        const fittingType = n.reducerType || (kind === "sqr_to_round" ? "sqr_to_round" : growing ? "taper_expander" : "taper_reducer");
        const key = `reducer:${n.id}`;
        const host = main.s;
        const construction = constructionFor(host, settings, sa.shape);
        const insulation = inheritInsulation(project, host, host.system);
        let piece = makeFitting({
          counters, prevByKey, key, kind, fittingType,
          seg: host, node: n, section: sa, sectionTo: sb, construction, insulation, lengthM,
          extra: { alignment: n.transitionAlignment || "symmetric" },
        });
        piece = applyOverride(piece, overrideOf(overMap, key));
        pieces.push(piece);
        addAllow(host.id, lengthM / 2);
        addAllow(through.s.id, lengthM / 2);
      }
      const branches = sized.slice(1);
      for (const br of branches) {
        const shape = br.section.shape;
        const type = n.branchType || defaultBranchType(shape, br.s.fittings);
        const kind = type === "y_branch" ? "y_branch"
          : type === "lateral45" ? "lateral"
          : type === "saddle" ? "saddle"
          : type === "shoe" || type === "shoe_branch" ? "shoe"
          : "tee";
        const key = `branch:${n.id}:${br.s.id}`;
        const construction = constructionFor(br.s, settings, shape);
        const insulation = inheritInsulation(project, br.s, br.s.system);
        const lengthM = 0.35;
        let piece = makeFitting({
          counters, prevByKey, key, kind, fittingType: type,
          seg: br.s, node: n, section: main.section, construction, insulation, lengthM,
          extra: {
            branchSection: br.section,
            more: { mainSegmentId: main.s.id },
          },
        });
        piece = applyOverride(piece, overrideOf(overMap, key));
        pieces.push(piece);
        addAllow(br.s.id, lengthM / 2);
      }
    }

    if (info.type === "offset") {
      const seg = info.segs[0];
      const section = sectionOf(seg, results, settings);
      const type = n.offsetStyle || settings.defaultOffsetStyle || "offset_2x45";
      const key = `offset:${n.id}`;
      const insulation = inheritInsulation(project, seg, seg.system);
      const construction = constructionFor(seg, settings, section.shape);
      const pxOff = Math.abs((info.na.x - info.nb.x) * unit(vec(n, info.na)).y - (info.na.y - info.nb.y) * unit(vec(n, info.na)).x);
      const offsetMm = round((pxOff / px) * 1000, 0);
      let piece = makeFitting({
        counters, prevByKey, key, kind: "offset", fittingType: type,
        seg, node: n, section, construction, insulation, lengthM: 0.5,
        extra: { offsetMm },
      });
      piece = applyOverride(piece, overrideOf(overMap, key));
      pieces.push(piece);
      for (const s of info.segs) addAllow(s.id, 0.25);
    }

    if (info.type === "boot") {
      const seg = info.segs[0];
      const section = sectionOf(seg, results, settings);
      const type = n.bootType || defaultBootType(section.shape);
      const key = `boot:${n.id}`;
      const insulation = inheritInsulation(project, seg, seg.system);
      const construction = constructionFor(seg, settings, section.shape);
      let piece = makeFitting({
        counters, prevByKey, key, kind: "boot", fittingType: type,
        seg, node: n, section, construction, insulation, lengthM: 0.35,
      });
      piece = applyOverride(piece, overrideOf(overMap, key));
      pieces.push(piece);
      addAllow(seg.id, 0.2);
    }

    if (info.type === "flex") {
      const seg = info.segs[0];
      const section = sectionOf(seg, results, settings);
      const key = `flex:${n.id}`;
      const insulation = inheritInsulation(project, seg, seg.system);
      const construction = constructionFor(seg, settings, section.shape);
      let piece = makeFitting({
        counters, prevByKey, key, kind: "flex", fittingType: "flex_connector",
        seg, node: n, section, construction, insulation, lengthM: 0.15,
        extra: { plantId: info.plants[0]?.id || null },
      });
      piece = applyOverride(piece, overrideOf(overMap, key));
      pieces.push(piece);
    }

    if (info.type === "cap") {
      const seg = info.segs[0];
      const section = sectionOf(seg, results, settings);
      const key = `cap:${n.id}`;
      const insulation = inheritInsulation(project, seg, seg.system);
      const construction = constructionFor(seg, settings, section.shape);
      pieces.push(makeFitting({
        counters, prevByKey, key, kind: "end_cap", fittingType: "end_cap",
        seg, node: n, section, construction, insulation, lengthM: 0.05,
      }));
    }

    for (const s of info.segs) {
      const section = sectionOf(s, results, settings);
      const insulation = inheritInsulation(project, s, s.system);
      pieces.push(...damperPieces(project, n, s, section, insulation, counters, prevByKey));
    }
  }

  // Straight runs + couplers, after fittings have claimed allowance.
  for (const seg of project.segments || []) {
    const a = project.nodes.find((n) => n.id === seg.a);
    const b = project.nodes.find((n) => n.id === seg.b);
    if (!a || !b) continue;
    const res = findSegResult(results, seg.id);
    const section = sectionOf(seg, results, settings);
    const construction = constructionFor(seg, settings, section.shape);
    const insulation = inheritInsulation(project, seg, seg.system);
    const graphM = graphicalLengthM(a, b, px);
    const engM = engineeringLengthM(seg, a, b, px);
    const std = Number(seg.standardLengthM) > 0 ? Number(seg.standardLengthM) : standardDefault;
    const path = pathForSegment(a, b, px, elevationMode);
    const dropElbows = path.filter((p) => p.kind === "drop-elbow");
    for (const de of dropElbows) {
      const key = `elbow-drop:${seg.id}`;
      const type = defaultElbowType(90, seg.fittings);
      let piece = makeFitting({
        counters, prevByKey, key, kind: "elbow", fittingType: type,
        seg, node: a, section, construction, insulation,
        lengthM: elbowCentrelineM(sectionMajorMm(section), 90),
        extra: { angleDeg: 90, a: de.at, b: de.to, vertical: true },
      });
      piece = applyOverride(piece, overrideOf(prev, key));
      pieces.push(piece);
      addAllow(seg.id, piece.lengthM);
    }

    const allowance = allowanceBySeg.get(seg.id) || 0;
    const straightM = Math.max(0, round(engM - allowance, 3));
    const cut = splitStandardLengths(straightM, std);
    const runs = path.filter((p) => p.kind === "run");
    const runWeights = runs.map((r) => Math.max(graphicalLengthM(r.a, r.b, px), 0.05));
    const runSum = runWeights.reduce((s, w) => s + w, 0) || 1;

    let partIndex = 0;
    const placed = [];
    for (let ri = 0; ri < runs.length; ri++) {
      const run = runs[ri];
      const share = straightM * (runWeights[ri] / runSum);
      const local = splitStandardLengths(share, std);
      const parts = local.parts.length ? local.parts : (share > 0.001 ? [{ lengthM: share, standard: false }] : []);
      const runLenPx = dist(run.a, run.b);
      let consumed = 0;
      const shareOr1 = share || 1;
      for (const part of parts) {
        const t0 = consumed / shareOr1;
        const t1 = (consumed + part.lengthM) / shareOr1;
        const pa = {
          x: run.a.x + (run.b.x - run.a.x) * t0,
          y: run.a.y + (run.b.y - run.a.y) * t0,
          z: (run.a.z || 0) + ((run.b.z || 0) - (run.a.z || 0)) * t0,
        };
        const pb = {
          x: run.a.x + (run.b.x - run.a.x) * t1,
          y: run.a.y + (run.b.y - run.a.y) * t1,
          z: (run.a.z || 0) + ((run.b.z || 0) - (run.a.z || 0)) * t1,
        };
        // If the sketch is much shorter than engineering length, keep
        // graphical endpoints but tag the true fabricated length.
        if (runLenPx < 1) {
          pa.x = run.a.x; pa.y = run.a.y; pa.z = run.a.z || 0;
          pb.x = run.b.x; pb.y = run.b.y; pb.z = run.b.z || 0;
        }
        const key = `straight:${seg.id}:${partIndex}`;
        let piece = pieceBase({
          ref: reuseRef(prevByKey, key, counters, "straight"),
          sourceKey: key,
          kind: "straight",
          fittingType: construction,
          label: `${sizeLabel(section)} ${CONSTRUCTION_TYPES[construction]?.label || "duct"}`,
          segmentId: seg.id,
          nodeId: null,
          system: seg.system,
          section,
          construction,
          lengthM: part.lengthM,
          standard: part.standard,
          standardLengthM: std,
          insulation,
          floor: seg.floor || "",
          zone: seg.zone || "",
          area: seg.area || "",
          role: res?.role || "",
          flowM3s: res?.flowM3s || 0,
          velocity: res?.velocity || 0,
          gradient: res?.gradient || 0,
          dpPa: res?.dpPa || 0,
          graphicalLengthM: graphM,
          engineeringLengthM: engM,
          lengthOverride: Number.isFinite(Number(seg.engineeringLengthM)) && Number(seg.engineeringLengthM) > 0,
          a: pa,
          b: pb,
          vertical: run.vertical,
        });
        piece = applyOverride(piece, overrideOf(prev, key));
        pieces.push(piece);
        placed.push(piece);
        partIndex += 1;
        consumed += part.lengthM;
      }
    }

    for (let i = 0; i < placed.length - 1; i++) {
      const key = `joint:${seg.id}:${i}`;
      const host = placed[i];
      let joint = pieceBase({
        ref: reuseRef(prevByKey, key, counters, "coupler"),
        sourceKey: key,
        kind: "coupler",
        fittingType: "coupler",
        label: isCircularConstruction(construction) ? `${sizeLabel(section)} spiral coupling` : `${sizeLabel(section)} duct joint`,
        segmentId: seg.id,
        nodeId: null,
        system: seg.system,
        section,
        construction,
        lengthM: 0.08,
        insulation,
        floor: seg.floor || "",
        zone: seg.zone || "",
        area: seg.area || "",
        a: host.b,
        b: placed[i + 1].a,
      });
      joint = applyOverride(joint, overrideOf(prev, key));
      pieces.push(joint);
    }

    const plant = (results?.systems || []).find((sys) => sys.segments.some((s) => s.id === seg.id))?.plant;
    for (const p of pieces) {
      if (p.segmentId === seg.id && !p.plantId) p.plantId = plant?.id || null;
    }

    // Support estimate — spacing rules, not a fabrication drawing.
    if (settings.estimateSupports !== false && straightM > 0) {
      const spacing = isCircularConstruction(construction)
        ? (settings.supportSpacingCircularM || 3)
        : (settings.supportSpacingRectM || 2.4);
      const count = Math.max(1, Math.ceil(straightM / spacing));
      const key = `supports:${seg.id}`;
      const support = pieceBase({
        ref: reuseRef(prevByKey, key, counters, "support"),
        sourceKey: key,
        kind: "support",
        fittingType: isCircularConstruction(construction) ? "circular_ring" : "trapeze",
        label: isCircularConstruction(construction) ? "Circular duct rings" : "Trapeze supports",
        segmentId: seg.id,
        system: seg.system,
        section,
        construction,
        lengthM: 0,
        qty: count,
        insulation: { type: "", thicknessMm: 0, cladding: "", source: "none" },
        floor: seg.floor || "",
        zone: seg.zone || "",
        area: seg.area || "",
        a: { x: a.x, y: a.y, z: a.z || 0 },
        b: { x: b.x, y: b.y, z: b.z || 0 },
        estimate: true,
      });
      pieces.push(support);
    }
  }

  // Deduplicate dampers that were added from both ends of a node.
  const seenDamper = new Set();
  const unique = [];
  for (const p of pieces) {
    if (p.kind === "damper") {
      if (seenDamper.has(p.sourceKey)) continue;
      seenDamper.add(p.sourceKey);
    }
    unique.push(p);
  }

  const fingerprint = engineeringFingerprint(project, results);
  return {
    generated: true,
    generatedAt: Date.now(),
    engineeringHash: fingerprint,
    staleCount: 0,
    pending: [],
    takeoffMode,
    standardStraightLengthM: standardDefault,
    counters,
    pieces: unique,
    overrides: { ...(prev?.overrides || {}) },
  };
}

export { engineeringFingerprint, classifyNode, pathForSegment, sectionOf };
