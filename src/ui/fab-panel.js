// Fabrication tab: generate / review the physical model, edit fittings,
// and show the Stage 1 ↔ Stage 2 summary.

import { FITTINGS, alternativesFor } from "../standards/fittings.js";
import { generatePhysicalModel } from "../fab/generator.js";
import { acceptPhysicalChanges, reviewPhysicalChanges, setPieceOverride } from "../fab/change.js";
import { simulatorSummary } from "../fab/summary.js";
import { formatLengthM } from "../fab/lengths.js";
import { sizeLabel } from "../fab/catalog.js";
import { round } from "../units.js";

function h(strings, ...vals) {
  return strings.reduce((a, s, i) => a + s + (vals[i] ?? ""), "");
}

export function renderFabrication(store, results, el) {
  const p = store.project;
  const model = p.physical;
  const review = model?.generated ? reviewPhysicalChanges(p, results) : { stale: false, pending: [], next: null };
  const summary = simulatorSummary(p, results, model);
  const selected = store.selection?.type === "piece" ? store.getSelected() : null;
  const pendingN = review.pending.length;

  el.innerHTML = h`
    <div class="section-title">Physical ductwork simulator</div>
    <p class="small-note">Stage 1 stays the engineering network. Generate a fabrication model when the design is ready — then adjust unusual fittings without redrawing the centreline.</p>
    <div class="row-actions">
      <button class="btn primary tiny" data-fab="generate">${model?.generated ? "Update physical model" : "Generate physical model"}</button>
      ${p.engineeringLocked
        ? `<button class="btn ghost tiny" data-fab="unlock">Unlock engineering</button>`
        : `<button class="btn ghost tiny" data-fab="lock">Lock engineering design</button>`}
    </div>
    ${p.engineeringLocked ? `<p class="small-note">Engineering design is locked. Size and length still edit, but the intent is that Stage 2 is now the working view.</p>` : ""}
    ${pendingN ? `<div class="change-banner">Engineering design has changed. ${pendingN} physical component${pendingN === 1 ? "" : "s"} require updating.
      <div class="row-actions">
        <button class="btn tiny" data-fab="accept">Accept all changes</button>
        <button class="btn ghost tiny" data-fab="keep">Retain manual fittings</button>
      </div>
    </div>` : ""}
    ${model?.generated ? renderSummary(summary) : `<p class="empty-hint">No fabrication model yet. Size the network first, then generate.</p>`}
    ${selected ? renderPiece(selected) : model?.generated ? renderPieceList(model, store) : ""}
    <div class="section-title">Offset options</div>
    <p class="small-note">Where a run steps aside, the generator can build 2 × 45° bends, 2 × 30° bends, a custom offset, or a rectangular offset transition. Change the default below or override a selected offset piece.</p>
  `;

  bindFab(el, store, results, review);
}

function renderSummary(s) {
  return h`
    <div class="section-title">Simulator summary</div>
    <div class="metric-grid">
      <div class="metric"><div class="m-val">${s.totalCentrelineM} <small>m</small></div><div class="m-label">Engineering centreline</div></div>
      <div class="metric"><div class="m-val">${s.totalFabricatedStraightM} <small>m</small></div><div class="m-label">Fabricated straight</div></div>
      <div class="metric"><div class="m-val">${s.circularDuctM} <small>m</small></div><div class="m-label">Circular duct</div></div>
      <div class="metric"><div class="m-val">${s.rectangularAreaM2} <small>m²</small></div><div class="m-label">Rectangular area</div></div>
      <div class="metric"><div class="m-val">${s.fittings}</div><div class="m-label">Fittings</div></div>
      <div class="metric"><div class="m-val">${s.bends}</div><div class="m-label">Bends</div></div>
      <div class="metric"><div class="m-val">${s.branches}</div><div class="m-label">Branch fittings</div></div>
      <div class="metric"><div class="m-val">${s.transitions}</div><div class="m-label">Transitions</div></div>
      <div class="metric"><div class="m-val">${s.boots}</div><div class="m-label">Terminal boots</div></div>
      <div class="metric"><div class="m-val">${s.dampers}</div><div class="m-label">Dampers</div></div>
      <div class="metric"><div class="m-val">${s.insulationAreaM2} <small>m²</small></div><div class="m-label">Insulation area</div></div>
      <div class="metric"><div class="m-val">${s.physicalComponents}</div><div class="m-label">Physical components</div></div>
    </div>
    <p class="small-note">Engineering centreline is used for pressure. Fabricated straight is the cut-and-jointed material after fittings have been taken out of the run.</p>
  `;
}

function renderPiece(p) {
  const alts = p.alternatives?.length
    ? p.alternatives
    : alternativesFor(p.fittingType, p.section?.shape);
  const opts = (alts || []).map((k) => `<option value="${k}" ${p.fittingType === k ? "selected" : ""}>${FITTINGS[k]?.label || k}</option>`).join("");
  const alignOpts = ["symmetric", "flat_top", "flat_bottom", "flat_left", "flat_right", "offset", "custom"]
    .map((a) => `<option value="${a}" ${p.alignment === a ? "selected" : ""}>${a.replace(/_/g, " ")}</option>`).join("");
  return h`
    <div class="section-title">${p.ref} · ${p.label} ${p.manual ? `<span class="pill warn">manual</span>` : ""}</div>
    <div class="field"><label>Kind</label><span class="badge">${p.kind}</span></div>
    <div class="field"><label>Size</label><span class="badge">${p.sizeText || sizeLabel(p.section)}</span></div>
    <div class="field"><label>Length</label><span class="badge">${formatLengthM(p.lengthM)}</span></div>
    ${p.engineeringLengthM != null ? `<div class="field"><label>Engineering / graphical</label><span class="badge">${formatLengthM(p.engineeringLengthM)} / ${formatLengthM(p.graphicalLengthM)}</span></div>` : ""}
    ${opts ? `<div class="field"><label>Fitting</label><select data-piece-fit="${p.sourceKey}">${opts}</select></div>` : ""}
    ${p.kind === "reducer" || p.kind === "transition" || p.kind === "enlarger" || p.kind === "sqr_to_round"
      ? `<div class="field"><label>Alignment</label><select data-piece-align="${p.sourceKey}">${alignOpts}</select></div>` : ""}
    ${p.kind === "straight" ? `<div class="field"><label>Standard length (m)</label><input type="number" step="0.1" data-piece-std="${p.sourceKey}" value="${p.standardLengthM || 3}"/></div>` : ""}
    <p class="small-note">Changing a fitting updates appearance, resistance (K=${p.k ?? "—"}), takeoff and the fabrication list. The piece stays linked to the engineering section.</p>
    <div class="row-actions"><button class="btn ghost tiny" data-selseg="${p.segmentId}">Select engineering section</button></div>
  `;
}

function renderPieceList(model, store) {
  const hide = store.hiddenSystems;
  const rows = (model.pieces || []).filter((p) => p.kind !== "support").slice(0, 80).map((p) => {
    const sel = store.selection?.type === "piece" && (store.selection.id === p.ref || store.selection.id === p.sourceKey);
    return `<tr data-selpiece="${p.ref}" class="${sel ? "index-row" : ""}" style="cursor:pointer">
      <td>${p.ref}</td><td>${p.label}</td><td>${p.sizeText || ""}</td><td>${p.lengthM ? round(p.lengthM, 2) : ""}</td>
    </tr>`;
  }).join("");
  return h`
    <div class="section-title">Components</div>
    ${[["supply", "supply"], ["extract", "extract"], ["outdoor", "fresh air"], ["exhaust", "exhaust"]].map(([k, l]) => `<div class="field"><label>Hide ${l}</label>
      <select data-hide="${k}"><option value="no" ${hide.has(k) ? "" : "selected"}>Show</option><option value="yes" ${hide.has(k) ? "selected" : ""}>Hide</option></select></div>`).join("")}
    <table class="schedule">
      <thead><tr><th>Ref</th><th>Item</th><th>Size</th><th>m</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${(model.pieces || []).length > 80 ? `<p class="small-note">Showing first 80 pieces.</p>` : ""}
  `;
}

function bindFab(el, store, results, review) {
  el.querySelectorAll("[data-fab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const act = btn.dataset.fab;
      if (act === "generate") {
        store.snapshot();
        store.setPhysicalModel(generatePhysicalModel(store.project, results, { previous: store.project.physical }));
        store.visualMode = "fabrication";
        store.viewMode = "3d";
        document.querySelector(".workspace")?.classList.add("view-3d");
        store.commit();
      } else if (act === "lock") {
        store.snapshot(); store.project.engineeringLocked = true; store.commit();
      } else if (act === "unlock") {
        store.snapshot(); store.project.engineeringLocked = false; store.commit();
      } else if (act === "accept") {
        store.snapshot();
        store.setPhysicalModel(acceptPhysicalChanges(store.project, results));
        store.commit();
      } else if (act === "keep") {
        store.snapshot();
        store.setPhysicalModel(acceptPhysicalChanges(store.project, results, { keepManual: true }));
        store.commit();
      }
    });
  });
  el.querySelectorAll("[data-selpiece]").forEach((row) => {
    row.addEventListener("click", () => store.select("piece", row.dataset.selpiece));
  });
  el.querySelectorAll("[data-selseg]").forEach((btn) => {
    btn.addEventListener("click", () => { if (btn.dataset.selseg) store.select("segment", btn.dataset.selseg); });
  });
  el.querySelectorAll("[data-piece-fit]").forEach((sel) => {
    sel.addEventListener("change", () => {
      store.snapshot();
      const def = FITTINGS[sel.value];
      store.setPhysicalModel(setPieceOverride(store.project.physical, sel.dataset.pieceFit, {
        fittingType: sel.value,
        label: def?.label,
        k: def?.k,
      }));
      const nodeId = store.getSelected()?.nodeId;
      const n = store.project.nodes.find((x) => x.id === nodeId);
      if (n) {
        if (def?.group === "elbow") n.elbowType = sel.value;
        if (def?.group === "branch") n.branchType = sel.value;
        if (def?.group === "offset") n.offsetStyle = sel.value;
        if (def?.group === "boot") n.bootType = sel.value;
        if (def?.group === "reducer" || def?.group === "transition") n.reducerType = sel.value;
      }
      store.commit();
    });
  });
  el.querySelectorAll("[data-piece-align]").forEach((sel) => {
    sel.addEventListener("change", () => {
      store.snapshot();
      store.setPhysicalModel(setPieceOverride(store.project.physical, sel.dataset.pieceAlign, { alignment: sel.value }));
      const n = store.project.nodes.find((x) => x.id === store.getSelected()?.nodeId);
      if (n) n.transitionAlignment = sel.value;
      store.commit();
    });
  });
  el.querySelectorAll("[data-piece-std]").forEach((input) => {
    input.addEventListener("change", () => {
      store.snapshot();
      const std = Number(input.value);
      store.setPhysicalModel(setPieceOverride(store.project.physical, input.dataset.pieceStd, { standardLengthM: std }));
      const seg = store.project.segments.find((s) => s.id === store.getSelected()?.segmentId);
      if (seg) seg.standardLengthM = std;
      store.setPhysicalModel(generatePhysicalModel(store.project, results, { previous: store.project.physical }));
      store.commit();
    });
  });
  el.querySelectorAll("[data-hide]").forEach((sel) => {
    sel.addEventListener("change", () => {
      if (sel.value === "yes") store.hiddenSystems.add(sel.dataset.hide);
      else store.hiddenSystems.delete(sel.dataset.hide);
      store.emit();
    });
  });
}
