// Right-hand panel rendering: Properties, Results and Settings tabs.

import { componentDef, COMPONENTS } from "../standards/components.js";
import { FITTINGS } from "../standards/fittings.js";
import { CIRCULAR_DIAMETERS, RECTANGULAR_SIDES, VELOCITY_GUIDANCE } from "../standards/dw144.js";
import { formatFlow, formatFlowLs, lsToDisplay, displayToLs, flowUnitLabel, normalizeFlowUnit, plantDutyLs, plantStaticPa, round } from "../units.js";
import { sectionSizeLabel, sectionShapeLabel, roleLabel } from "../format.js";
import { allComputedSystems, findSegResult } from "../calc/network.js";
import { polygonArea, pointInPolygon, routeLengthM, isVerticalRiser, dist } from "../geom.js";
import { showApplicationPicker, showPrompt } from "./modal.js";
import { pxPerMeterOf } from "../layout.js";
import { applyApplication } from "../state.js";
import {
  APPLICATIONS,
  APPLICATION_IDS,
  DUCT_ROLES,
  FRICTION_PRESETS,
  applicationOf,
} from "../standards/playbook.js";

const FLOW_PROP_KEYS = new Set(["designFlow_ls", "extractFlow_ls", "supplyFlow_ls"]);
const SKIP_GENERIC = new Set(["designFlow", "designFlow_ls", "extractFlow_ls", "supplyFlow_ls", "availableStaticPa", "extractStaticPa", "supplyStaticPa"]);

const PROP_LABELS = {
  availableStaticPa: "Available static (Pa)",
  extractStaticPa: "Extract available static (Pa)",
  supplyStaticPa: "Supply available static (Pa)",
  designFlow_ls: "Design flow",
  extractFlow_ls: "Extract design flow",
  supplyFlow_ls: "Supply design flow",
  terminalLossPa: "Terminal loss (Pa)",
  lossPa: "Pressure loss (Pa)",
  k: "Loss coefficient K",
  supplyTempC: "Supply temp (°C)",
  returnTempC: "Return temp (°C)",
  throw_m: "Throw (m)",
  note: "Note",
};

function h(strings, ...vals) {
  return strings.reduce((a, s, i) => a + s + (vals[i] ?? ""), "");
}

function num(v, dp = 2) {
  return round(Number(v) || 0, dp);
}

function unitOf(store) {
  return normalizeFlowUnit(store.project.settings.flowUnit);
}

export class Panels {
  constructor(store, els) {
    this.store = store;
    this.els = els;
    this.results = null;
    this.onExportPdf = null;
  }

  setResults(r) { this.results = r; }

  renderAll() {
    this.renderProperties();
    this.renderResults();
    this.renderSettings();
  }

  // ---------------- Properties ----------------
  renderProperties() {
    const el = this.els.properties;
    const sel = this.store.selection;
    const selected = this.store.getSelected();
    if (!sel || !selected) {
      el.innerHTML = this.propertiesEmpty();
      this.bindRooms(el);
      return;
    }
    if (sel.type === "segment") el.innerHTML = this.propSegment(selected);
    else if (sel.type === "component") el.innerHTML = this.propComponent(selected);
    else if (sel.type === "room") el.innerHTML = this.propRoom(selected);
    else if (sel.type === "node") el.innerHTML = this.propNode(selected);
    this.bindProperty(el, sel, selected);
  }

  propertiesEmpty() {
    const p = this.store.project;
    const unit = unitOf(this.store);
    const ul = flowUnitLabel(unit);
    const rooms = p.rooms
      .map((r) => `<div class="field"><label>${r.name}</label><span class="badge">S ${lsToDisplay(r.supplyFlow_ls, unit)} · E ${lsToDisplay(r.extractFlow_ls, unit)} ${ul}</span></div>`)
      .join("");
    return h`
      <p class="empty-hint">
        Nothing selected. Use the <b>Duct</b> tool to trace runs, place <b>components</b> from the palette,
        and mark <b>rooms</b>. Select an element to edit it here.
      </p>
      <div class="section-title">Project</div>
      <div class="field"><label>Nodes / ducts</label><span class="badge">${p.nodes.length} / ${p.segments.length}</span></div>
      <div class="field"><label>Components / rooms</label><span class="badge">${p.components.length} / ${p.rooms.length}</span></div>
      ${rooms ? `<div class="section-title">Rooms</div>${rooms}` : ""}
    `;
  }

  propSegment(s) {
    const res = this.segResult(s.id);
    const unit = unitOf(this.store);
    const ul = flowUnitLabel(unit);
    const fittings = (s.fittings || []).map((f, i) => this.fittingRow(f, i)).join("");
    const fittingOptions = Object.entries(FITTINGS)
      .map(([k, v]) => `<option value="${k}">${v.label} (K=${v.k})</option>`)
      .join("");
    const shape = s.shapeOverride || this.store.project.settings.ductType;
    const sizeInfo = sectionSizeLabel(res?.section);
    const flowDisp = s.flowOverride == null || s.flowOverride === "" ? "" : lsToDisplay(s.flowOverride, unit);
    const circOpts = CIRCULAR_DIAMETERS.map((d) => `<option value="${d}" ${Number(s.sizeOverride?.diameterMm) === d ? "selected" : ""}>${d}</option>`).join("");
    const rectOpts = (v) => RECTANGULAR_SIDES.map((d) => `<option value="${d}" ${Number(v) === d ? "selected" : ""}>${d}</option>`).join("");
    return h`
      <div class="section-title">Duct segment <span class="pill ${s.system}">${s.system}</span></div>
      <div class="field"><label>System</label>
        <select data-k="system">
          <option value="supply" ${s.system === "supply" ? "selected" : ""}>Supply</option>
          <option value="extract" ${s.system === "extract" ? "selected" : ""}>Extract / return</option>
        </select></div>
      <div class="field"><label>Kind</label>
        <select data-k="ductKind">
          <option value="sheet" ${(s.ductKind || "sheet") === "sheet" ? "selected" : ""}>Sheet metal</option>
          <option value="sock" ${s.ductKind === "sock" ? "selected" : ""}>Air sock</option>
        </select></div>
      <div class="field"><label>Role</label>
        <select data-k="roleOverride">
          <option value="">Auto (${roleLabel(res?.role || "main")})</option>
          ${DUCT_ROLES.map((r) => `<option value="${r}" ${s.roleOverride === r ? "selected" : ""}>${roleLabel(r)}</option>`).join("")}
        </select></div>
      <div class="field"><label>Application override</label>
        <select data-k="applicationType">
          <option value="">Project default (${applicationOf(this.store.project.settings.applicationType).label})</option>
          ${APPLICATION_IDS.map((id) => `<option value="${id}" ${s.applicationType === id ? "selected" : ""}>${APPLICATIONS[id].label}</option>`).join("")}
        </select></div>
      <div class="field"><label>Shape</label>
        <select data-k="shapeOverride">
          <option value="">Default (${sectionShapeLabel(this.store.project.settings.ductType)})</option>
          <option value="round" ${s.shapeOverride === "round" ? "selected" : ""}>Spiral / circular</option>
          <option value="square" ${s.shapeOverride === "square" ? "selected" : ""}>Square</option>
          <option value="rect" ${s.shapeOverride === "rect" ? "selected" : ""}>Rectangular</option>
        </select></div>
      <div class="field"><label>Flow override (${ul})</label>
        <input type="number" step="any" data-flow-k="flowOverride" value="${flowDisp}" placeholder="auto" /></div>

      <div class="section-title">Size lock</div>
      <div class="field"><label>Auto / lock</label>
        <select data-k="sizeLocked">
          <option value="false" ${!s.sizeLocked ? "selected" : ""}>Auto size</option>
          <option value="true" ${s.sizeLocked ? "selected" : ""}>Lock size</option>
        </select></div>
      ${s.sizeLocked ? `<p class="small-note">This section is locked. Network recalculation will not change the size. Velocity ${res ? num(res.velocity, 2) : "—"} m/s · ${res ? num(res.gradient, 2) : "—"} Pa/m · ${res?.warnLevel || "normal"}.</p>` : ""}
      <div class="section-title">Manual size (DW144 / EN 1506)</div>
      ${shape === "rect" || shape === "square"
        ? `<div class="field"><label>${shape === "square" ? "Side (mm)" : "Width × Height (mm)"}</label>
             <span>
             <select data-size="widthMm"><option value="">auto</option>${rectOpts(s.sizeOverride?.widthMm)}</select>
             ${shape === "square" ? "" : `<select data-size="heightMm"><option value="">auto</option>${rectOpts(s.sizeOverride?.heightMm)}</select>`}
             </span></div>`
        : `<div class="field"><label>Diameter (mm)</label>
             <select data-size="diameterMm"><option value="">auto</option>${circOpts}</select></div>`}
      <button class="link-btn" data-act="clearSize">Clear manual size (use auto)</button>
      ${res?.suggestedSection ? `<button class="btn tiny" data-act="applySuggested">Resize to ${sectionSizeLabel(res.suggestedSection)} mm</button>` : ""}

      ${s.ductKind === "sock" ? this.sockFields(s, res) : ""}

      <div class="section-title">Fittings</div>
      ${fittings || `<p class="small-note">No fittings added.</p>`}
      <div class="fitting-row">
        <select id="newFitting">${fittingOptions}</select>
        <button class="btn tiny" data-act="addFitting">Add</button>
      </div>

      ${this.segHeights(s)}
      <div class="section-title">Calculated</div>
      <div class="metric-grid">
        <div class="metric"><div class="m-val">${sizeInfo} <small>mm</small></div><div class="m-label">Size (${sectionShapeLabel(res?.section?.shape || shape)})</div></div>
        <div class="metric"><div class="m-val">${res ? num(res.velocity, 2) : "—"} <small>m/s</small></div><div class="m-label">Velocity</div></div>
        <div class="metric"><div class="m-val">${res ? formatFlow(res.flowM3s, unit) : formatFlow(0, unit)}</div><div class="m-label">Flow</div></div>
        <div class="metric"><div class="m-val">${res ? num(res.lengthM, 2) : 0} <small>m</small></div><div class="m-label">Route (plan + rise)</div></div>
        <div class="metric"><div class="m-val">${res ? num(res.gradient, 2) : 0} <small>Pa/m</small></div><div class="m-label">Gradient</div></div>
        <div class="metric"><div class="m-val">${res ? num(res.dpPa, 1) : 0} <small>Pa</small></div><div class="m-label">Segment Δp</div></div>
      </div>
      ${res ? `<div class="field"><label>Warning</label><span class="pill ${res.warnLevel === "critical" || res.warnLevel === "warning" ? "bad" : res.warnLevel === "advisory" ? "warn" : "ok"}">${res.warnLevel || "normal"}</span></div>` : ""}
      ${res && res.warnings?.length ? `<ul class="warn-list">${res.warnings.map((w) => `<li>${w}</li>`).join("")}</ul>` : ""}
      ${res && (res.warnLevel === "warning" || res.warnLevel === "critical") ? `
        <div class="field"><label>Accept warning</label>
          <select data-k="warningAck">
            <option value="false" ${!s.warningAck ? "selected" : ""}>Open</option>
            <option value="true" ${s.warningAck ? "selected" : ""}>Accepted</option>
          </select></div>
        <div class="field full"><label>Engineering justification</label>
          <textarea data-k="warningNote" rows="2">${s.warningNote || ""}</textarea></div>` : ""}
      <div class="row-actions"><button class="btn ghost tiny" data-act="delete">Delete segment</button></div>
    `;
  }

  sockFields(s, res) {
    const unit = unitOf(this.store);
    const ul = flowUnitLabel(unit);
    const sock = s.sock || {};
    return h`
      <div class="section-title">Air sock spec</div>
      <p class="small-note">Enter the manufacturer / air-sock team specification. The run can ventilate along its length. Diameter and Pa are taken from the spec rather than sheet-metal sizing.</p>
      <div class="field"><label>Design flow (${ul})</label>
        <input type="number" step="any" data-sock="designFlow_ls" data-sock-flow="1" value="${sock.designFlow_ls ? lsToDisplay(sock.designFlow_ls, unit) : ""}"/></div>
      <div class="field"><label>Specified pressure (Pa)</label>
        <input type="number" step="any" data-sock="specPa" value="${sock.specPa ?? ""}"/></div>
      <div class="field"><label>Diameter (mm)</label>
        <input type="number" step="1" data-sock="diameterMm" value="${sock.diameterMm ?? ""}"/></div>
      <div class="field"><label>Height (m AFFL)</label>
        <input type="number" step="0.05" data-sock="heightM" value="${sock.heightM ?? this.store.project.settings.defaultSockHeight}"/></div>
      <div class="field"><label>Fabric / model</label>
        <input type="text" data-sock="model" value="${sock.model || ""}" placeholder="model"/></div>
      <div class="field"><label>Supplier</label>
        <input type="text" data-sock="supplier" value="${sock.supplier || ""}"/></div>
      <div class="field full"><label>Spec note</label>
        <textarea data-sock="note" rows="2">${sock.note || ""}</textarea></div>
      ${res ? `<p class="small-note">Calculated: ${formatFlow(res.flowM3s, unit)} · ${num(res.velocity, 2)} m/s · spec ${num(res.frictionPa, 0)} Pa on the inlet length.</p>` : ""}
    `;
  }

  segHeights(s) {
    const p = this.store.project;
    const a = p.nodes.find((n) => n.id === s.a);
    const b = p.nodes.find((n) => n.id === s.b);
    if (!a || !b) return "";
    const px = pxPerMeterOf(p);
    const plan = dist(a, b) / px;
    const rise = Math.abs((a.z || 0) - (b.z || 0));
    const route = routeLengthM(a, b, px);
    const riser = isVerticalRiser(a, b, px);
    return h`
      <div class="section-title">Heights</div>
      <div class="field"><label>Start (m AFFL)</label><input type="number" step="0.05" data-nodez="${a.id}" value="${num(a.z, 2)}"/></div>
      <div class="field"><label>End (m AFFL)</label><input type="number" step="0.05" data-nodez="${b.id}" value="${num(b.z, 2)}"/></div>
      <div class="field"><label>Plan / rise / route</label><span class="badge">${num(plan, 2)} · ${num(rise, 2)} · ${num(route, 2)} m</span></div>
      ${riser ? `<p class="small-note">This is a <b>riser</b> — it does not draw as a run on the plan. Open the 3D view to see it. CIBSE Guide B Table 2.18 allows a higher velocity band than a branch in an occupied space.</p>` : `<p class="small-note">A height change along a run is a sloping duct. To make a vertical riser, change the trace height and click the same point again.</p>`}
    `;
  }

  fittingRow(f, i) {
    const options = Object.entries(FITTINGS)
      .map(([k, v]) => `<option value="${k}" ${f.type === k ? "selected" : ""}>${v.label}</option>`)
      .join("");
    return `<div class="fitting-row">
      <select data-fitting="${i}" data-fk="type">${options}</select>
      <input type="number" min="1" data-fitting="${i}" data-fk="qty" value="${f.qty || 1}" title="Quantity"/>
      <button class="link-btn" data-fitting-del="${i}">✕</button>
    </div>`;
  }

  plantFields(c, def) {
    const unit = unitOf(this.store);
    const ul = flowUnitLabel(unit);
    const dual = c.kind === "ahu" && c.system === "both";
    const supplyFlow = lsToDisplay(plantDutyLs(c.props, "supply"), unit);
    const extractFlow = lsToDisplay(plantDutyLs(c.props, "extract") || (c.props?.extractFlow_ls || 0), unit);
    const supplyPa = plantStaticPa(c.props, "supply");
    const extractPa = Number(c.props?.extractStaticPa) || plantStaticPa(c.props, "extract");
    const res = this.results;
    const warnings = [];
    if (res) {
      for (const sys of allComputedSystems(res)) {
        if (sys.plant?.id !== c.id) continue;
        warnings.push(...(sys.warnings || []));
      }
      warnings.push(...(res.projectWarnings || []).filter((w) => w.includes(c.label || def.label) || w.includes("AHU")));
    }
    const uniq = [...new Set(warnings)];
    return h`
      <div class="section-title">${dual ? "Supply & extract duty" : "Fan / plant duty"}</div>
      <div class="field"><label>${dual ? "Supply flow" : "Design flow"} (${ul})</label>
        <input type="number" step="any" data-flow-prop="designFlow_ls" value="${c.props?.designFlow_ls ? supplyFlow : ""}" placeholder="auto from outlets"/></div>
      <div class="field"><label>${dual ? "Supply available static" : "Available static"} (Pa)</label>
        <input type="number" step="any" data-prop="availableStaticPa" value="${supplyPa}"/></div>
      ${dual ? `
      <div class="field"><label>Extract flow (${ul})</label>
        <input type="number" step="any" data-flow-prop="extractFlow_ls" value="${c.props?.extractFlow_ls ? extractFlow : ""}" placeholder="auto from inlets"/></div>
      <div class="field"><label>Extract available static (Pa)</label>
        <input type="number" step="any" data-prop="extractStaticPa" value="${extractPa}"/></div>
      <p class="small-note">Set different supply and extract flow and Pa on a combined AHU. Leave a flow blank to follow the connected terminals. A warning appears if duty does not match inlets / outlets.</p>
      ` : `<p class="small-note">Leave flow blank to follow the connected terminals. A warning appears if the set duty does not match those terminals.</p>`}
      ${uniq.length ? `<ul class="warn-list">${uniq.map((w) => `<li>${w}</li>`).join("")}</ul>` : ""}
    `;
  }

  propComponent(c) {
    const def = componentDef(c.kind);
    const unit = unitOf(this.store);
    const ul = flowUnitLabel(unit);
    const isPlant = def.role === "plant";
    const props = Object.entries(c.props || {})
      .filter(([k]) => !(isPlant && SKIP_GENERIC.has(k)))
      .map(([k, v]) => {
        const label = PROP_LABELS[k] || k;
        if (k === "note") {
          return `<div class="field full"><label>${label}</label><textarea data-prop="${k}" rows="2">${v || ""}</textarea></div>`;
        }
        if (FLOW_PROP_KEYS.has(k)) {
          return `<div class="field"><label>${label} (${ul})</label><input type="number" step="any" data-flow-prop="${k}" value="${lsToDisplay(v, unit)}"/></div>`;
        }
        return `<div class="field"><label>${label}</label><input type="number" step="any" data-prop="${k}" value="${v}"/></div>`;
      })
      .join("");
    const dual = c.kind === "ahu";
    return h`
      <div class="section-title">${c.label || def.label} <span class="pill ${c.system}">${c.system === "both" ? "supply + return" : c.system}</span></div>
      <div class="field"><label>Custom label</label><input type="text" data-k="label" value="${c.label || ""}" placeholder="${def.label}"/></div>
      <div class="field"><label>System</label>
        <select data-k="system">
          <option value="supply" ${c.system === "supply" ? "selected" : ""}>Supply</option>
          <option value="extract" ${c.system === "extract" ? "selected" : ""}>Extract / return</option>
          ${dual ? `<option value="both" ${c.system === "both" ? "selected" : ""}>Both (supply + return)</option>` : ""}
        </select></div>
      <div class="field"><label>Type</label>
        <select data-k="kind">
          ${Object.values(COMPONENTS).filter((d) => d.category === def.category).map((d) => `<option value="${d.kind}" ${d.kind === c.kind ? "selected" : ""}>${d.label}</option>`).join("")}
        </select></div>
      <div class="section-title">Size &amp; height</div>
      <div class="field"><label>Width × depth (m)</label>
        <span><input type="number" step="0.05" style="width:64px" data-k="widthM" value="${c.widthM ?? ""}"/>
        <input type="number" step="0.05" style="width:64px" data-k="depthM" value="${c.depthM ?? ""}"/></span></div>
      <div class="field"><label>Rotation (°)</label><input type="number" step="1" data-k="rot" value="${c.rot || 0}"/></div>
      <div class="field"><label>Height (m AFFL)</label><input type="number" step="0.05" data-k="heightM" value="${c.heightM ?? 0}"/></div>
      <p class="small-note">Drag the corner handles on the plan to resize. The rotate handle sits above the box. Width and depth are real metres.</p>
      ${isPlant ? this.plantFields(c, def) : ""}
      <div class="section-title">Parameters</div>
      ${props}
      <button class="link-btn" data-act="addParam">+ Add custom parameter</button>
      <div class="row-actions">
        ${def.role === "terminal" ? `<button class="btn tiny" data-act="duplicate">Duplicate outlet</button>` : ""}
        <button class="btn ghost tiny" data-act="delete">Delete component</button>
      </div>
    `;
  }

  propRoom(r) {
    const p = this.store.project;
    const unit = unitOf(this.store);
    const ul = flowUnitLabel(unit);
    const pxm = p.scale.pxPerMeter || p.settings.conceptPxPerMeter || 50;
    const areaM2 = polygonArea(r.points) / (pxm * pxm);
    let assignedS = 0, assignedE = 0;
    for (const c of p.components) {
      const def = componentDef(c.kind);
      if (!def || def.role !== "terminal") continue;
      const n = p.nodes.find((x) => x.id === c.nodeId) || c;
      if (pointInPolygon(n, r.points)) {
        if (c.system === "supply") assignedS += Number(c.props?.designFlow_ls) || 0;
        else assignedE += Number(c.props?.designFlow_ls) || 0;
      }
    }
    const bal = (target, assigned) => {
      const diff = assigned - target;
      const cls = target === 0 ? "" : Math.abs(diff) < 1e-6 ? "ok" : "warn";
      return `<span class="pill ${cls}">${lsToDisplay(assigned, unit)} / ${lsToDisplay(target || 0, unit)} ${ul}</span>`;
    };
    return h`
      <div class="section-title">Room</div>
      <div class="field"><label>Name</label><input type="text" data-k="name" value="${r.name}"/></div>
      <div class="field"><label>Supply target (${ul})</label><input type="number" step="any" data-flow-k="supplyFlow_ls" value="${lsToDisplay(r.supplyFlow_ls, unit)}"/></div>
      <div class="field"><label>Extract target (${ul})</label><input type="number" step="any" data-flow-k="extractFlow_ls" value="${lsToDisplay(r.extractFlow_ls, unit)}"/></div>
      <div class="field"><label>Application</label>
        <select data-k="applicationType">
          <option value="">Project default (${applicationOf(this.store.project.settings.applicationType).label})</option>
          ${APPLICATION_IDS.map((id) => `<option value="${id}" ${r.applicationType === id ? "selected" : ""}>${APPLICATIONS[id].label}</option>`).join("")}
        </select></div>
      <div class="section-title">Balance</div>
      <div class="field"><label>Floor area</label><span class="badge">${num(areaM2, 1)} m²</span></div>
      <div class="field"><label>Supply assigned</label>${bal(r.supplyFlow_ls, assignedS)}</div>
      <div class="field"><label>Extract assigned</label>${bal(r.extractFlow_ls, assignedE)}</div>
      <p class="small-note">Assigned = design flow of terminals located inside this room outline.</p>
      <div class="row-actions"><button class="btn ghost tiny" data-act="delete">Delete room</button></div>
    `;
  }

  propNode(n) {
    const p = this.store.project;
    const segs = p.segments.filter((s) => s.a === n.id || s.b === n.id).length;
    return h`
      <div class="section-title">${n.tee || segs >= 3 ? "T-piece" : "Junction node"}</div>
      <div class="field"><label>Position</label><span class="badge">${Math.round(n.x)}, ${Math.round(n.y)}</span></div>
      <div class="field"><label>Height (m AFFL)</label><input type="number" step="0.05" data-k="z" value="${num(n.z, 2)}"/></div>
      <div class="field"><label>Connected ducts</label><span class="badge">${segs}</span></div>
      <p class="small-note">Drag to move. Use the <b>T-piece</b> tool to cut a branch into a run already traced. Changing height here is a riser if the other end stays put on plan.</p>
      <div class="row-actions">
        <button class="btn tiny" data-act="levelRun">Level connected run to this height</button>
        <button class="btn ghost tiny" data-act="delete">Delete node &amp; ducts</button>
      </div>
    `;
  }

  bindProperty(el, sel, obj) {
    const store = this.store;
    const commit = () => store.commit();
    const unit = unitOf(store);
    el.querySelectorAll("[data-k]").forEach((input) => {
      input.addEventListener("change", () => {
        store.snapshot();
        const key = input.dataset.k;
        let val = input.value;
        if (input.type === "number") val = val === "" ? null : Number(val);
        if (key === "sizeLocked" || key === "warningAck") val = val === true || val === "true";
        if (key === "roleOverride" && val === "") val = null;
        if (key === "applicationType" && val === "") val = null;
        if (sel.type === "segment" && key === "ductKind" && val === "sock" && !obj.sock) {
          obj.sock = { designFlow_ls: 200, specPa: 80, heightM: store.project.settings.defaultSockHeight ?? 2.8, diameterMm: 400, fabric: "", model: "", supplier: "", note: "" };
          obj.sizeLocked = true;
          obj.sizeOverride = { diameterMm: obj.sock.diameterMm };
        }
        if (sel.type === "component" && key === "system") {
          store.setComponentSystem(obj, val);
        } else if (sel.type === "component" && (key === "widthM" || key === "depthM" || key === "rot")) {
          store.resizeComponent(obj, key === "widthM" ? val : null, key === "depthM" ? val : null, key === "rot" ? val : null);
        } else if (sel.type === "component" && key === "heightM") {
          obj.heightM = val;
          store.syncComponentPorts(obj);
        } else if (sel.type === "node" && key === "z") {
          store.setNodeHeight(obj, val);
        } else {
          obj[key] = val;
        }
        commit();
      });
    });
    el.querySelectorAll("[data-flow-k]").forEach((input) => {
      input.addEventListener("change", () => {
        store.snapshot();
        const key = input.dataset.flowK;
        obj[key] = input.value === "" ? null : displayToLs(input.value, unit);
        commit();
      });
    });
    el.querySelectorAll("[data-flow-prop]").forEach((input) => {
      input.addEventListener("change", () => {
        store.snapshot();
        obj.props = obj.props || {};
        obj.props[input.dataset.flowProp] = input.value === "" ? 0 : displayToLs(input.value, unit);
        commit();
      });
    });
    el.querySelectorAll("[data-nodez]").forEach((input) => {
      input.addEventListener("change", () => {
        store.snapshot();
        const n = store.project.nodes.find((x) => x.id === input.dataset.nodez);
        if (n) store.setNodeHeight(n, Number(input.value));
        commit();
      });
    });
    el.querySelectorAll("[data-prop]").forEach((input) => {
      input.addEventListener("change", () => {
        store.snapshot();
        const key = input.dataset.prop;
        obj.props[key] = input.type === "number" || input.step === "any" ? (input.value === "" ? 0 : Number(input.value)) : input.value;
        commit();
      });
    });
    el.querySelectorAll("[data-size]").forEach((input) => {
      input.addEventListener("change", () => {
        store.snapshot();
        obj.sizeOverride = obj.sizeOverride || {};
        const key = input.dataset.size;
        obj.sizeOverride[key] = input.value === "" ? undefined : Number(input.value);
        if (obj.shapeOverride === "square" && key === "widthMm") obj.sizeOverride.heightMm = obj.sizeOverride.widthMm;
        if (!obj.sizeOverride.diameterMm && !obj.sizeOverride.widthMm) obj.sizeOverride = null;
        else obj.sizeLocked = true;
        commit();
      });
    });
    el.querySelectorAll("[data-sock]").forEach((input) => {
      input.addEventListener("change", () => {
        store.snapshot();
        obj.sock = obj.sock || {};
        const key = input.dataset.sock;
        if (input.dataset.sockFlow) obj.sock[key] = input.value === "" ? 0 : displayToLs(input.value, unit);
        else if (input.type === "number") obj.sock[key] = input.value === "" ? 0 : Number(input.value);
        else obj.sock[key] = input.value;
        if (key === "diameterMm") {
          obj.sizeOverride = { diameterMm: Number(obj.sock.diameterMm) || 400 };
          obj.sizeLocked = true;
        }
        if (key === "heightM") {
          const a = store.project.nodes.find((n) => n.id === obj.a);
          const b = store.project.nodes.find((n) => n.id === obj.b);
          if (a) store.setNodeHeight(a, obj.sock.heightM);
          if (b) store.setNodeHeight(b, obj.sock.heightM);
        }
        commit();
      });
    });
    el.querySelectorAll("[data-fitting]").forEach((input) => {
      input.addEventListener("change", () => {
        store.snapshot();
        const i = Number(input.dataset.fitting);
        const fk = input.dataset.fk;
        obj.fittings[i][fk] = fk === "qty" ? Number(input.value) : input.value;
        commit();
      });
    });
    el.querySelectorAll("[data-fitting-del]").forEach((btn) => {
      btn.addEventListener("click", () => {
        store.snapshot();
        obj.fittings.splice(Number(btn.dataset.fittingDel), 1);
        commit();
      });
    });
    el.querySelectorAll("[data-act]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const act = btn.dataset.act;
        if (act === "delete") store.deleteSelection();
        else if (act === "addFitting") {
          store.snapshot();
          const type = el.querySelector("#newFitting").value;
          obj.fittings.push({ type, qty: 1 });
          commit();
        } else if (act === "clearSize") {
          store.snapshot(); obj.sizeOverride = null; obj.sizeLocked = false; commit();
        } else if (act === "applySuggested") {
          const res = this.segResult(obj.id);
          if (res?.suggestedSection) {
            store.snapshot();
            const sec = res.suggestedSection;
            obj.sizeOverride = sec.shape === "round"
              ? { diameterMm: sec.diameterMm }
              : { widthMm: sec.widthMm, heightMm: sec.heightMm };
            obj.sizeLocked = true;
            commit();
          }
        } else if (act === "addParam") {
          const name = await showPrompt({ title: "Add custom parameter", label: "Parameter name", value: "" });
          if (name) { store.snapshot(); obj.props[name] = 0; commit(); }
        } else if (act === "duplicate") {
          store.snapshot();
          const copy = store.duplicateComponent(obj);
          if (copy) store.select("component", copy.id);
          commit();
        } else if (act === "levelRun") {
          store.snapshot();
          store.levelRunFrom(obj.id, obj.z);
          commit();
        }
      });
    });
  }

  bindRooms() {}

  // ---------------- Results ----------------
  renderResults() {
    const el = this.els.results;
    if (!this.results) { el.innerHTML = `<p class="empty-hint">No calculation yet.</p>`; return; }
    const systems = allComputedSystems(this.results);
    const projectWarn = (this.results.projectWarnings || []).map((w) => `<li>${w}</li>`).join("");
    const sum = this.results.summary;
    const summaryBlock = sum ? `
      <div class="rcard">
        <h3>Design summary</h3>
        <div class="metric-grid">
          <div class="metric"><div class="m-val">${sum.applicationLabel}</div><div class="m-label">Application</div></div>
          <div class="metric"><div class="m-val">${sum.sizingMethod}</div><div class="m-label">Sizing method</div></div>
          <div class="metric"><div class="m-val">${num(sum.mainTarget, 1)} / ${num(sum.mainMax, 1)} <small>m/s</small></div><div class="m-label">Main target / max</div></div>
          <div class="metric"><div class="m-val">${num(sum.riserTarget, 1)} <small>m/s</small></div><div class="m-label">Riser target</div></div>
          <div class="metric"><div class="m-val">${num(sum.branchTarget, 1)} <small>m/s</small></div><div class="m-label">Primary branch target</div></div>
          <div class="metric"><div class="m-val">${num(sum.finalRunVelocity, 1)} <small>m/s</small></div><div class="m-label">Final run target</div></div>
          <div class="metric"><div class="m-val">${num(sum.pressureDropTarget, 2)} <small>Pa/m</small></div><div class="m-label">Pressure drop target</div></div>
          <div class="metric"><div class="m-val">${num(sum.highestVelocity, 2)} <small>m/s</small></div><div class="m-label">Highest velocity</div></div>
          <div class="metric"><div class="m-val">${num(sum.highestFriction, 2)} <small>Pa/m</small></div><div class="m-label">Highest friction</div></div>
          <div class="metric"><div class="m-val">${num(sum.totalResistance, 0)} <small>Pa</small></div><div class="m-label">Total system resistance</div></div>
          <div class="metric"><div class="m-val">Class ${sum.dw144Class}</div><div class="m-label">DW/144 class</div></div>
          <div class="metric"><div class="m-val">${sum.velocityWarnings}</div><div class="m-label">Velocity warnings</div></div>
          <div class="metric"><div class="m-val">${sum.pressureDropWarnings}</div><div class="m-label">Pressure drop warnings</div></div>
          <div class="metric"><div class="m-val">${sum.constructionWarnings}</div><div class="m-label">Construction warnings</div></div>
        </div>
      </div>` : "";
    el.innerHTML = `<div class="result-cards">
      ${summaryBlock}
      ${projectWarn ? `<ul class="warn-list">${projectWarn}</ul>` : ""}
      ${systems.length ? systems.map((s) => this.systemCard(s)).join("") : `<p class="empty-hint">Trace ducts and add a fan/AHU + terminals to size a system.</p>`}
      <div class="row-actions">
        <button class="btn primary tiny" data-pdf>Export PDF report</button>
      </div>
    </div>`;
    el.querySelectorAll("[data-export]").forEach((btn) => {
      btn.addEventListener("click", () => this.exportCsv(btn.dataset.export));
    });
    el.querySelectorAll("[data-selseg]").forEach((row) => {
      row.addEventListener("click", () => this.store.select("segment", row.dataset.selseg));
    });
    el.querySelectorAll("[data-pdf]").forEach((btn) => {
      btn.addEventListener("click", () => this.onExportPdf && this.onExportPdf());
    });
  }

  systemCard(sys) {
    const unit = unitOf(this.store);
    const ul = flowUnitLabel(unit);
    const hasNet = sys.segments.length > 0;
    const marginPill = sys.plant
      ? (sys.marginPa >= 0
          ? `<span class="pill ok">+${num(sys.marginPa, 0)} Pa spare</span>`
          : `<span class="pill bad">${num(sys.marginPa, 0)} Pa short</span>`)
      : `<span class="pill warn">no plant</span>`;
    const matchPill = sys.balance && sys.balance.plantDutyLs > 0
      ? (sys.balance.matched
          ? `<span class="pill ok">duty matches terminals</span>`
          : `<span class="pill bad">duty ≠ terminals</span>`)
      : "";
    const rows = sys.segments.map((s) => {
      const size = sectionSizeLabel(s.section);
      const idx = sys.indexPath.includes(s.id);
      return `<tr class="${idx ? "index-row" : ""} ${s.withinVelocity ? "" : "over-vel"} warn-${s.warnLevel || "none"}" data-selseg="${s.id}" style="cursor:pointer">
        <td>${size}</td>
        <td>${formatFlow(s.flowM3s, unit).replace(` ${ul}`, "")}</td>
        <td>${num(s.velocity, 2)}</td>
        <td>${num(s.lengthM, 1)}</td>
        <td>${num(s.gradient, 2)}</td>
        <td>${num(s.dpPa, 1)}</td>
        <td>${s.role}</td>
      </tr>`;
    }).join("");

    return h`
      <div class="rcard ${sys.systemType}">
        <h3>${sys.name}
          <span class="pill ${sys.systemType}">${sys.pressureClassInfo ? "Class " + sys.pressureClass : ""}</span>
          ${marginPill}
          ${matchPill}
        </h3>
        <div class="metric-grid">
          <div class="metric"><div class="m-val">${formatFlow(sys.totalFlowM3s, unit)}</div><div class="m-label">Terminal total</div></div>
          <div class="metric"><div class="m-val">${num(sys.indexStaticPa, 0)} <small>Pa</small></div><div class="m-label">Index static (ESP)</div><div class="m-sub">${sys.plant ? "avail " + num(sys.availableStaticPa, 0) + " Pa" : "add fan/AHU"}</div></div>
          <div class="metric"><div class="m-val">${num(sys.maxVelocity, 2)} <small>m/s</small></div><div class="m-label">Max velocity</div></div>
          <div class="metric"><div class="m-val">${num(sys.minVelocity, 2)} <small>m/s</small></div><div class="m-label">Min velocity</div></div>
        </div>
        ${sys.warnings.length ? `<ul class="warn-list">${sys.warnings.map((w) => `<li>${w}</li>`).join("")}</ul>` : ""}
        ${hasNet ? `
        <table class="schedule">
          <thead><tr><th>Size (mm)</th><th>${ul}</th><th>m/s</th><th>Len m</th><th>Pa/m</th><th>Δp Pa</th><th>Role</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <p class="small-note">Highlighted row = index run (governs fan duty). Click a row to select the duct.</p>
        <div class="row-actions"><button class="btn ghost tiny" data-export="${sys.id}">Export schedule (CSV)</button></div>
        ` : `<p class="small-note">Trace ${sys.systemType} ducts and add a fan/AHU + terminals to size this system.</p>`}
      </div>`;
  }

  exportCsv(systemId) {
    const sys = allComputedSystems(this.results).find((s) => s.id === systemId) || this.results[systemId];
    if (!sys) return;
    const unit = unitOf(this.store);
    const ul = flowUnitLabel(unit);
    const header = ["Size(mm)", "Shape", `Flow(${ul})`, "Velocity(m/s)", "Length(m)", "Gradient(Pa/m)", "Friction(Pa)", "Fittings(Pa)", "Inline(Pa)", "SegmentDp(Pa)", "Role", "IndexRun"].join(",");
    const lines = sys.segments.map((s) => {
      const size = sectionSizeLabel(s.section).replace(/×/g, "x");
      return [size, s.section.shape, formatFlow(s.flowM3s, unit).replace(` ${ul}`, ""), num(s.velocity, 2), num(s.lengthM, 2), num(s.gradient, 3), num(s.frictionPa, 2), num(s.fittingPa, 2), num(s.inlinePa, 2), num(s.dpPa, 2), s.role, sys.indexPath.includes(s.id) ? "yes" : ""].join(",");
    });
    const summary = `\nSystem,${sys.name}\nTotal flow (${ul}),${formatFlow(sys.totalFlowM3s, unit).replace(` ${ul}`, "")}\nIndex static (Pa),${num(sys.indexStaticPa, 0)}\nPressure class,${sys.pressureClass}\nMax velocity (m/s),${num(sys.maxVelocity, 2)}\n`;
    const csv = header + "\n" + lines.join("\n") + "\n" + summary;
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `duct-schedule-${(sys.name || sys.systemType).replace(/\s+/g, "-").toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  segResult(id) {
    return findSegResult(this.results, id);
  }

  // ---------------- Settings ----------------
  renderSettings() {
    const el = this.els.settings;
    const s = this.store.project.settings;
    const p = this.store.project;
    const scaleTxt = p.scale.pxPerMeter ? `${round(p.scale.pxPerMeter, 1)} px/m` : "not set (using concept scale)";
    const velRows = DUCT_ROLES.map((role) => {
      const band = s.velocityProfile?.[role] || {};
      const cap = s.velocityCaps[role] ?? band.max;
      const min = s.velocityMins[role] ?? band.min;
      const target = band.target ?? cap;
      return `<tr>
        <td>${roleLabel(role)}</td>
        <td><input type="number" step="0.5" data-vtarget="${role}" value="${target}"/></td>
        <td><input type="number" step="0.5" data-vmax="${role}" value="${cap}"/></td>
        <td><input type="number" step="0.5" data-vmin="${role}" value="${min}"/></td>
      </tr>`;
    }).join("");
    const app = applicationOf(s.applicationType);
    el.innerHTML = h`
      <div class="section-title">Application</div>
      <div class="field"><label>Building / area type</label>
        <select data-s="applicationType">
          ${APPLICATION_IDS.map((id) => `<option value="${id}" ${s.applicationType === id ? "selected" : ""}>${APPLICATIONS[id].label}</option>`).join("")}
        </select></div>
      <button class="link-btn" data-act="pickApp">Change application…</button>
      ${app.notes.map((n) => `<p class="small-note">${n}</p>`).join("")}

      <div class="section-title">Sizing method</div>
      <div class="field"><label>Method</label>
        <select data-s="sizingMethod">
          <option value="hybrid" ${s.sizingMethod === "hybrid" ? "selected" : ""}>Hybrid (preferred)</option>
          <option value="velocity" ${s.sizingMethod === "velocity" ? "selected" : ""}>Velocity based</option>
          <option value="friction" ${s.sizingMethod === "friction" ? "selected" : ""}>Equal friction</option>
        </select></div>
      <div class="field"><label>Pressure drop target</label>
        <select data-friction>
          ${FRICTION_PRESETS.map((f) => `<option value="${f}" ${Number(s.targetGradient) === f ? "selected" : ""}>${f} Pa/m</option>`).join("")}
          <option value="custom" ${!FRICTION_PRESETS.includes(Number(s.targetGradient)) ? "selected" : ""}>Custom</option>
        </select></div>
      <div class="field"><label>Target gradient (Pa/m)</label><input type="number" step="0.1" data-s="targetGradient" value="${s.targetGradient}"/></div>
      <p class="small-note">Hybrid picks the smallest standard size that meets target velocity, maximum velocity, Pa/m, aspect ratio and minimum practical size. Every section still shows both m/s and Pa/m.</p>
      <div class="field"><label>Default duct shape</label>
        <select data-s="ductType">
          <option value="round" ${s.ductType === "round" ? "selected" : ""}>Spiral / circular</option>
          <option value="square" ${s.ductType === "square" ? "selected" : ""}>Square</option>
          <option value="rect" ${s.ductType === "rect" ? "selected" : ""}>Rectangular</option>
        </select></div>
      <div class="field"><label>Rect. / square start (mm)</label><input type="number" data-s="rectHeight" value="${s.rectHeight}"/></div>
      <div class="field"><label>Max aspect ratio</label><input type="number" step="0.5" data-s="maxAspect" value="${s.maxAspect}"/></div>
      <div class="field"><label>Roughness (mm)</label><input type="number" step="0.01" data-s="roughnessMm" value="${s.roughnessMm}"/></div>
      <p class="small-note">Spiral sizes follow EN 1506 / DW144 (63–2000 mm). Square and rectangular sides follow EN 1505 / DW144 (100–3000 mm).</p>

      <div class="section-title">Velocity profile (m/s)</div>
      <table class="schedule vel-table">
        <thead><tr><th>Location</th><th>Target</th><th>Max</th><th>Min</th></tr></thead>
        <tbody>${velRows}</tbody>
      </table>
      <p class="small-note">Risers keep a similar target to the preceding main — they are not slowed just because they go vertical. ${VELOCITY_GUIDANCE[0]}</p>

      <div class="section-title">DW/144 &amp; display</div>
      <div class="field"><label>Construction class</label>
        <select data-s="dw144Class">
          <option value="A" ${s.dw144Class === "A" ? "selected" : ""}>Class A</option>
          <option value="B" ${s.dw144Class === "B" ? "selected" : ""}>Class B</option>
          <option value="C" ${s.dw144Class === "C" ? "selected" : ""}>Class C</option>
          <option value="D" ${s.dw144Class === "D" ? "selected" : ""}>Class D</option>
        </select></div>
      <div class="field"><label>Colour overlay</label>
        <select data-s="overlay">
          <option value="none" ${s.overlay === "none" ? "selected" : ""}>None</option>
          <option value="velocity" ${s.overlay === "velocity" ? "selected" : ""}>Velocity</option>
          <option value="gradient" ${s.overlay === "gradient" ? "selected" : ""}>Pressure drop</option>
          <option value="pressure" ${s.overlay === "pressure" ? "selected" : ""}>Section pressure</option>
          <option value="flow" ${s.overlay === "flow" ? "selected" : ""}>Airflow</option>
          <option value="size" ${s.overlay === "size" ? "selected" : ""}>Duct size</option>
          <option value="acoustic" ${s.overlay === "acoustic" ? "selected" : ""}>Acoustic risk</option>
          <option value="dw144" ${s.overlay === "dw144" ? "selected" : ""}>DW/144 warning</option>
        </select></div>

      <div class="section-title">Air conditions</div>
      <div class="field"><label>Supply temp (°C)</label><input type="number" data-s="supplyTempC" value="${s.supplyTempC}"/></div>
      <div class="field"><label>Extract temp (°C)</label><input type="number" data-s="extractTempC" value="${s.extractTempC}"/></div>
      <div class="field"><label>Flow display unit</label>
        <select data-s="flowUnit">
          <option value="l/s" ${s.flowUnit === "l/s" ? "selected" : ""}>l/s</option>
          <option value="m3/h" ${s.flowUnit === "m3/h" ? "selected" : ""}>m³/h</option>
        </select></div>

      <div class="section-title">Tracing</div>
      <div class="field"><label>Snap to equipment / joints</label>
        <select data-s="snapPoints">
          <option value="true" ${s.snapPoints !== false ? "selected" : ""}>On — only nearby points</option>
          <option value="false" ${s.snapPoints === false ? "selected" : ""}>Off — Alt still cuts a T-piece</option>
        </select></div>
      <div class="field"><label>Square corners</label>
        <select data-s="ortho">
          <option value="true" ${s.ortho !== false ? "selected" : ""}>On (hold Alt for a free angle)</option>
          <option value="false" ${s.ortho === false ? "selected" : ""}>Off (hold Alt to square)</option>
        </select></div>
      <div class="field"><label>Draw actual duct size</label>
        <select data-s="showActualDucts">
          <option value="true" ${s.showActualDucts !== false ? "selected" : ""}>Circular / rectangular body</option>
          <option value="false" ${s.showActualDucts === false ? "selected" : ""}>Centreline only</option>
        </select></div>
      <p class="small-note">Snap only pulls to an outlet, AHU or existing corner when you are already nearby. Parallel supply and return can sit close without being yanked together. Use <b>T-piece</b> (J) to branch off a run.</p>

      <div class="section-title">Default heights (m AFFL)</div>
      <div class="field"><label>Duct run</label><input type="number" step="0.05" data-s="defaultDuctHeight" value="${s.defaultDuctHeight}"/></div>
      <div class="field"><label>AHU / plant</label><input type="number" step="0.05" data-s="defaultAhuHeight" value="${s.defaultAhuHeight}"/></div>
      <div class="field"><label>Outlets / terminals</label><input type="number" step="0.05" data-s="defaultTerminalHeight" value="${s.defaultTerminalHeight}"/></div>
      <div class="field"><label>Air socks</label><input type="number" step="0.05" data-s="defaultSockHeight" value="${s.defaultSockHeight}"/></div>

      <div class="section-title">Scale</div>
      <div class="field"><label>Drawing scale</label><span class="badge">${scaleTxt}</span></div>
      <div class="field"><label>Concept scale (px/m)</label><input type="number" data-s="conceptPxPerMeter" value="${s.conceptPxPerMeter}"/></div>
      <button class="link-btn" data-act="resetScale">Reset drawing scale</button>
      <p class="small-note">Use the <b>Scale</b> tool to calibrate from an uploaded drawing. In concept mode the concept scale sets duct lengths. Risers are recovered from the heights, not from the plan.</p>
    `;
    this.bindSettings(el);
  }

  bindSettings(el) {
    const store = this.store;
    const s = store.project.settings;
    el.querySelectorAll("[data-s]").forEach((input) => {
      input.addEventListener("change", () => {
        store.snapshot();
        const key = input.dataset.s;
        if (input.type === "number") s[key] = Number(input.value);
        else if (input.value === "true") s[key] = true;
        else if (input.value === "false") s[key] = false;
        else if (key === "applicationType") applyApplication(s, input.value);
        else s[key] = key === "flowUnit" ? normalizeFlowUnit(input.value) : input.value;
        store.commit();
      });
    });
    el.querySelectorAll("[data-friction]").forEach((input) => {
      input.addEventListener("change", () => {
        store.snapshot();
        if (input.value !== "custom") s.targetGradient = Number(input.value);
        store.commit();
      });
    });
    el.querySelectorAll("[data-vtarget]").forEach((input) => {
      input.addEventListener("change", () => {
        store.snapshot();
        s.velocityProfile = s.velocityProfile || {};
        s.velocityProfile[input.dataset.vtarget] = {
          ...(s.velocityProfile[input.dataset.vtarget] || {}),
          target: Number(input.value),
        };
        if (s.applicationType !== "custom") s.applicationType = "custom";
        store.commit();
      });
    });
    el.querySelectorAll("[data-vmax]").forEach((input) => {
      input.addEventListener("change", () => {
        store.snapshot();
        s.velocityCaps[input.dataset.vmax] = Number(input.value);
        store.commit();
      });
    });
    el.querySelectorAll("[data-vmin]").forEach((input) => {
      input.addEventListener("change", () => {
        store.snapshot();
        s.velocityMins[input.dataset.vmin] = Number(input.value);
        store.commit();
      });
    });
    el.querySelectorAll("[data-act='resetScale']").forEach((btn) => {
      btn.addEventListener("click", () => {
        store.snapshot();
        store.project.scale = { pxPerMeter: null, calib: null };
        store.commit();
      });
    });
    el.querySelectorAll("[data-act='pickApp']").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const picked = await showApplicationPicker({
          current: s.applicationType,
          apps: APPLICATION_IDS.map((id) => APPLICATIONS[id]),
        });
        if (picked) {
          store.snapshot();
          applyApplication(s, picked);
          store.commit();
        }
      });
    });
  }
}
