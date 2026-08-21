// Takeoff tab: filters, grouped schedule, and export.

import { buildTakeoff, emptyTakeoffFilters, uniqueFilterValues } from "../fab/takeoff.js";
import { takeoffCsv, procurementCsv, fabricationCsv, takeoffExcelXml, downloadText, takeoffNarrative } from "../fab/export.js";
import { generatePhysicalModel } from "../fab/generator.js";
import { reviewPhysicalChanges } from "../fab/change.js";

function h(strings, ...vals) {
  return strings.reduce((a, s, i) => a + s + (vals[i] ?? ""), "");
}

function slug(name) {
  return (name || "duct-takeoff").replace(/\s+/g, "-").toLowerCase();
}

export function renderTakeoff(store, results, el) {
  const p = store.project;
  if (!p.physical?.generated) {
    el.innerHTML = h`
      <div class="section-title">Automatic takeoff</div>
      <p class="empty-hint">Generate the physical model first. Quantities come from fabricated pieces, not from a centreline estimate.</p>
      <div class="row-actions"><button class="btn primary tiny" data-to="generate">Generate physical model</button></div>
    `;
    bind(el, store, results, null);
    return;
  }

  const review = reviewPhysicalChanges(p, results);
  const filters = { ...emptyTakeoffFilters(), ...(store.takeoffFilters || {}) };
  const takeoff = buildTakeoff(p.physical, filters, p);
  const vals = uniqueFilterValues(p.physical.pieces || []);
  const opt = (arr, cur) => [`<option value="">All</option>`, ...arr.map((v) => `<option value="${v}" ${v === cur ? "selected" : ""}>${v}</option>`)].join("");

  const circ = takeoff.circular.map((g) => `
    <div class="rcard">
      <h3>${g.size} ${g.construction === "spiral" ? "Spiral" : "Circular"}</h3>
      <div class="field"><label>Straight duct</label><span class="badge">${g.lengthM} m</span></div>
      <div class="field"><label>Standard ${g.standardM} m lengths</label><span class="badge">${g.standardCount}</span></div>
      <div class="field"><label>Cut section</label><span class="badge">${g.cutLengthM} m (${g.cutCount})</span></div>
    </div>`).join("");

  const rect = takeoff.rectangular.map((g) => `
    <div class="rcard">
      <h3>${g.size} rectangular</h3>
      <div class="field"><label>Straight length</label><span class="badge">${g.lengthM} m</span></div>
      <div class="field"><label>Sections</label><span class="badge">${g.sections}</span></div>
      <div class="field"><label>Sheet metal</label><span class="badge">${g.sheetAreaM2} m²</span></div>
    </div>`).join("");

  const fitRows = takeoff.fittings.map((g) => `<tr><td>${g.label}</td><td>${g.size}</td><td>${g.qty}</td></tr>`).join("");
  const jointRows = takeoff.joints.map((g) => `<tr><td>${g.label}</td><td>${g.size}</td><td>${g.qty}</td></tr>`).join("");
  const bootRows = takeoff.boots.map((g) => `<tr><td>${g.label}</td><td>${g.size}</td><td>${g.qty}</td></tr>`).join("");
  const ancRows = takeoff.ancillaries.map((g) => `<tr><td>${g.label}</td><td>${g.size}</td><td>${g.qty}</td></tr>`).join("");
  const supRows = takeoff.supports.map((g) => `<tr><td>${g.label}</td><td></td><td>${g.qty}</td></tr>`).join("");
  const ins = takeoff.insulation.map((g) => `
    <div class="field"><label>${g.thicknessMm} mm ${g.type || "insulation"}</label><span class="badge">${g.areaM2} m²${g.cladding ? ` · ${g.cladding} ${g.claddingAreaM2} m²` : ""}</span></div>
  `).join("");

  el.innerHTML = h`
    <div class="section-title">Generate takeoff</div>
    ${review.stale ? `<div class="change-banner">Engineering has changed since the model was last accepted. Review changes on the Fabrication tab before procuring.</div>` : ""}
    <div class="section-title">Filters</div>
    <div class="field"><label>System</label><select data-tf="system">${opt(vals.system, filters.system)}</select></div>
    <div class="field"><label>AHU / plant</label><select data-tf="ahu">${opt(vals.ahu, filters.ahu)}</select></div>
    <div class="field"><label>Floor</label><select data-tf="floor">${opt(vals.floor, filters.floor)}</select></div>
    <div class="field"><label>Zone</label><select data-tf="zone">${opt(vals.zone, filters.zone)}</select></div>
    <div class="field"><label>Area</label><select data-tf="area">${opt(vals.area, filters.area)}</select></div>
    <div class="field"><label>Role</label><select data-tf="branch">${opt(vals.branch, filters.branch)}</select></div>
    <div class="field"><label>Size</label><select data-tf="size">${opt(vals.size, filters.size)}</select></div>
    <div class="field"><label>Duct type</label><select data-tf="type">${opt(vals.type, filters.type)}</select></div>

    <div class="section-title">Circular</div>
    ${circ || `<p class="small-note">No circular straight duct in this filter.</p>`}
    <div class="section-title">Rectangular</div>
    ${rect || `<p class="small-note">No rectangular straight duct in this filter.</p>`}

    <div class="section-title">Fittings</div>
    <table class="schedule"><thead><tr><th>Item</th><th>Size</th><th>Qty</th></tr></thead><tbody>${fitRows || `<tr><td colspan="3">None</td></tr>`}</tbody></table>
    <div class="section-title">Joints</div>
    <table class="schedule"><thead><tr><th>Item</th><th>Size</th><th>Qty</th></tr></thead><tbody>${jointRows || `<tr><td colspan="3">None</td></tr>`}</tbody></table>
    <div class="section-title">Boots</div>
    <table class="schedule"><thead><tr><th>Item</th><th>Size</th><th>Qty</th></tr></thead><tbody>${bootRows || `<tr><td colspan="3">None</td></tr>`}</tbody></table>
    <div class="section-title">Ancillaries</div>
    <table class="schedule"><thead><tr><th>Item</th><th>Size</th><th>Qty</th></tr></thead><tbody>${ancRows || `<tr><td colspan="3">None</td></tr>`}</tbody></table>
    <div class="section-title">Supports (estimate)</div>
    <table class="schedule"><thead><tr><th>Item</th><th></th><th>Qty</th></tr></thead><tbody>${supRows || `<tr><td colspan="3">None</td></tr>`}</tbody></table>
    <div class="section-title">Insulation &amp; cladding</div>
    ${ins || `<p class="small-note">No insulation assigned. Set it on Settings, a system, or a section.</p>`}

    <div class="section-title">Export</div>
    <div class="row-actions" style="flex-wrap:wrap">
      <button class="btn tiny" data-to="csv">CSV</button>
      <button class="btn tiny" data-to="excel">Excel</button>
      <button class="btn tiny" data-to="proc">Procurement</button>
      <button class="btn tiny" data-to="fab">Fabrication</button>
      <button class="btn tiny" data-to="pdf">PDF schedule</button>
    </div>
    <pre class="takeoff-note">${takeoffNarrative(takeoff)}</pre>
  `;
  bind(el, store, results, takeoff);
}

function bind(el, store, results, takeoff) {
  el.querySelectorAll("[data-tf]").forEach((sel) => {
    sel.addEventListener("change", () => {
      store.takeoffFilters = { ...store.takeoffFilters, [sel.dataset.tf]: sel.value };
      store.emit();
    });
  });
  el.querySelectorAll("[data-to]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const act = btn.dataset.to;
      const name = slug(store.project.meta.name);
      if (act === "generate") {
        store.snapshot();
        store.setPhysicalModel(generatePhysicalModel(store.project, results, { previous: store.project.physical }));
        store.commit();
        return;
      }
      if (!takeoff) return;
      if (act === "csv") downloadText(`${name}-takeoff.csv`, takeoffCsv(takeoff), "text/csv");
      if (act === "excel") downloadText(`${name}-takeoff.xls`, takeoffExcelXml(takeoff, store.project.meta.name), "application/vnd.ms-excel");
      if (act === "proc") downloadText(`${name}-procurement.csv`, procurementCsv(takeoff), "text/csv");
      if (act === "fab") downloadText(`${name}-fabrication.csv`, fabricationCsv(takeoff), "text/csv");
      if (act === "pdf" && store.onExportTakeoffPdf) store.onExportTakeoffPdf(takeoff);
    });
  });
}
