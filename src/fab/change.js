// Change management between the engineering network and an existing
// fabrication model. Manual fitting choices are kept until the designer
// accepts an update.

import { engineeringFingerprint, generatePhysicalModel } from "./generator.js";

export function modelIsStale(project, results) {
  const phys = project.physical;
  if (!phys?.generated) return false;
  return engineeringFingerprint(project, results) !== phys.engineeringHash;
}

export function diffPhysicalModels(existing, next) {
  const oldByKey = new Map((existing?.pieces || []).map((p) => [p.sourceKey, p]));
  const newByKey = new Map((next?.pieces || []).map((p) => [p.sourceKey, p]));
  const pending = [];

  for (const [key, np] of newByKey) {
    const op = oldByKey.get(key);
    if (!op) {
      pending.push({ key, action: "add", ref: np.ref, label: np.label, kind: np.kind, segmentId: np.segmentId });
      continue;
    }
    const changed =
      op.kind !== np.kind
      || op.fittingType !== np.fittingType
      || sizeSig(op) !== sizeSig(np)
      || Math.abs((op.lengthM || 0) - (np.lengthM || 0)) > 0.02
      || (op.sectionTo && sizeSig({ section: op.sectionTo }) !== sizeSig({ section: np.sectionTo }));
    if (changed) {
      pending.push({
        key,
        action: "update",
        ref: op.ref,
        label: np.label,
        kind: np.kind,
        segmentId: np.segmentId,
        manual: !!op.manual,
        from: summarize(op),
        to: summarize(np),
      });
    }
  }
  for (const [key, op] of oldByKey) {
    if (!newByKey.has(key) && op.kind !== "support") {
      pending.push({ key, action: "remove", ref: op.ref, label: op.label, kind: op.kind, segmentId: op.segmentId, manual: !!op.manual });
    }
  }
  return pending;
}

function sizeSig(p) {
  const s = p?.section;
  if (!s) return "";
  return `${s.shape}:${s.diameterMm || ""}:${s.widthMm || ""}:${s.heightMm || ""}`;
}

function summarize(p) {
  const size = p.section
    ? (p.section.diameterMm ? `Ø${p.section.diameterMm}` : `${p.section.widthMm}×${p.section.heightMm}`)
    : "";
  return `${p.label} ${size} ${p.lengthM ? `${p.lengthM} m` : ""}`.trim();
}

export function reviewPhysicalChanges(project, results) {
  if (!project.physical?.generated) {
    return { stale: false, pending: [], next: null };
  }
  const next = generatePhysicalModel(project, results, { previous: project.physical });
  const pending = diffPhysicalModels(project.physical, next);
  return { stale: pending.length > 0, pending, next };
}

export function acceptPhysicalChanges(project, results, opts = {}) {
  const keepKeys = new Set(opts.keepKeys || []);
  const previous = project.physical;
  const overrides = { ...(previous?.overrides || {}) };
  if (opts.keepManual) {
    for (const p of previous.pieces || []) {
      if (p.manual) keepKeys.add(p.sourceKey);
    }
  }
  for (const key of keepKeys) {
    const old = (previous.pieces || []).find((p) => p.sourceKey === key);
    if (!old) continue;
    overrides[key] = {
      fittingType: old.fittingType,
      alignment: old.alignment,
      standardLengthM: old.standardLengthM,
      label: old.label,
    };
  }
  const next = generatePhysicalModel(project, results, {
    previous: { ...previous, overrides },
  });
  next.pending = [];
  next.staleCount = 0;
  return next;
}

export function retainManualAndRefresh(project, results) {
  return acceptPhysicalChanges(project, results, { keepManual: true });
}

export function setPieceOverride(physical, sourceKey, patch) {
  const overrides = { ...(physical.overrides || {}) };
  overrides[sourceKey] = { ...(overrides[sourceKey] || {}), ...patch };
  const pieces = (physical.pieces || []).map((p) => {
    if (p.sourceKey !== sourceKey) return p;
    return {
      ...p,
      ...patch,
      manual: true,
      fittingType: patch.fittingType || p.fittingType,
      label: patch.label || p.label,
      alignment: patch.alignment || p.alignment,
    };
  });
  return { ...physical, overrides, pieces };
}
