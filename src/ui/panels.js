// Right-hand panel rendering: Properties, Results and Settings tabs.

import { componentDef, COMPONENTS, CATEGORIES } from "../standards/components.js";
import { FITTINGS } from "../standards/fittings.js";
import { formatFlow, round, flowFromM3s } from "../units.js";
import { dist, polygonArea, pointInPolygon } from "../geom.js";
import { showPrompt } from "./modal.js";

const PROP_LABELS = {
  availableStaticPa: "Available static (Pa)",
  designFlow: "Design flow (m³/s)",
  designFlow_ls: "Design flow (l/s)",
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

export class Panels {
  constructor(store, els) {
    this.store = store;
    this.els = els; // { properties, results, settings }
    this.results = null;
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
    const rooms = p.rooms
      .map((r) => `<div class="field"><label>${r.name}</label><span class="badge">S ${r.supplyFlow_ls || 0} · E ${r.extractFlow_ls || 0} l/s</span></div>`)
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
    const fittings = (s.fittings || [])
      .map((f, i) => this.fittingRow(f, i))
      .join("");
    const fittingOptions = Object.entries(FITTINGS)
      .map(([k, v]) => `<option value="${k}">${v.label} (K=${v.k})</option>`)
      .join("");
    const shape = s.shapeOverride || this.store.project.settings.ductType;
    const sizeInfo = res && res.section
      ? (res.section.shape === "rect"
        ? `${res.section.widthMm} × ${res.section.heightMm} mm`
        : `⌀ ${res.section.diameterMm} mm`)
      : "—";
    return h`
      <div class="section-title">Duct segment <span class="pill ${s.system}">${s.system}</span></div>
      <div class="field"><label>System</label>
        <select data-k="system">
          <option value="supply" ${s.system === "supply" ? "selected" : ""}>Supply</option>
          <option value="extract" ${s.system === "extract" ? "selected" : ""}>Extract</option>
        </select></div>
      <div class="field"><label>Role</label>
        <select data-k="roleOverride">
          <option value="">Auto (${res?.role || "main"})</option>
          <option value="main" ${s.roleOverride === "main" ? "selected" : ""}>Main</option>
          <option value="branch" ${s.roleOverride === "branch" ? "selected" : ""}>Branch</option>
          <option value="runout" ${s.roleOverride === "runout" ? "selected" : ""}>Run-out</option>
        </select></div>
      <div class="field"><label>Shape</label>
        <select data-k="shapeOverride">
          <option value="">Default (${this.store.project.settings.ductType})</option>
          <option value="round" ${s.shapeOverride === "round" ? "selected" : ""}>Round / spiral</option>
          <option value="rect" ${s.shapeOverride === "rect" ? "selected" : ""}>Rectangular</option>
        </select></div>
      <div class="field"><label>Flow override (l/s)</label>
        <input type="number" data-k="flowOverride" value="${s.flowOverride ?? ""}" placeholder="auto" /></div>

      <div class="section-title">Manual size (optional)</div>
      ${shape === "rect"
        ? `<div class="field"><label>Width × Height (mm)</label>
             <span><input type="number" style="width:64px" data-size="widthMm" value="${s.sizeOverride?.widthMm ?? ""}" placeholder="w"/>
             <input type="number" style="width:64px" data-size="heightMm" value="${s.sizeOverride?.heightMm ?? ""}" placeholder="h"/></span></div>`
        : `<div class="field"><label>Diameter (mm)</label>
             <input type="number" data-size="diameterMm" value="${s.sizeOverride?.diameterMm ?? ""}" placeholder="auto"/></div>`}
      <button class="link-btn" data-act="clearSize">Clear manual size (use auto)</button>

      <div class="section-title">Fittings</div>
      ${fittings || `<p class="small-note">No fittings added.</p>`}
      <div class="fitting-row">
        <select id="newFitting">${fittingOptions}</select>
        <button class="btn tiny" data-act="addFitting">Add</button>
      </div>

      <div class="section-title">Calculated</div>
      <div class="metric-grid">
        <div class="metric"><div class="m-val">${sizeInfo}</div><div class="m-label">Size (DW144)</div></div>
        <div class="metric"><div class="m-val">${res ? num(res.velocity, 2) : "—"} <small>m/s</small></div><div class="m-label">Velocity</div></div>
        <div class="metric"><div class="m-val">${res ? num(res.flowM3s * 1000, 0) : 0} <small>l/s</small></div><div class="m-label">Flow</div></div>
        <div class="metric"><div class="m-val">${res ? num(res.lengthM, 2) : 0} <small>m</small></div><div class="m-label">Length</div></div>
        <div class="metric"><div class="m-val">${res ? num(res.gradient, 2) : 0} <small>Pa/m</small></div><div class="m-label">Gradient</div></div>
        <div class="metric"><div class="m-val">${res ? num(res.dpPa, 1) : 0} <small>Pa</small></div><div class="m-label">Segment Δp</div></div>
      </div>
      ${res && !res.withinVelocity ? `<ul class="warn-list"><li>Velocity ${num(res.velocity,1)} m/s exceeds the ${num(res.maxVelocity,1)} m/s cap for ${res.role}.</li></ul>` : ""}
      ${res && res.warnings?.length ? `<ul class="warn-list">${res.warnings.map((w) => `<li>${w}</li>`).join("")}</ul>` : ""}
      <div class="row-actions"><button class="btn ghost tiny" data-act="delete">Delete segment</button></div>
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

  propComponent(c) {
    const def = componentDef(c.kind);
    const props = Object.entries(c.props || {})
      .map(([k, v]) => {
        const label = PROP_LABELS[k] || k;
        if (k === "note") {
          return `<div class="field full"><label>${label}</label><textarea data-prop="${k}" rows="2">${v || ""}</textarea></div>`;
        }
        return `<div class="field"><label>${label}</label><input type="number" step="any" data-prop="${k}" value="${v}"/></div>`;
      })
      .join("");
    return h`
      <div class="section-title">${c.label || def.label} <span class="pill ${c.system}">${c.system}</span></div>
      <div class="field"><label>Custom label</label><input type="text" data-k="label" value="${c.label || ""}" placeholder="${def.label}"/></div>
      <div class="field"><label>System</label>
        <select data-k="system">
          <option value="supply" ${c.system === "supply" ? "selected" : ""}>Supply</option>
          <option value="extract" ${c.system === "extract" ? "selected" : ""}>Extract</option>
        </select></div>
      <div class="field"><label>Type</label>
        <select data-k="kind">
          ${Object.values(COMPONENTS).filter((d) => d.category === def.category).map((d) => `<option value="${d.kind}" ${d.kind === c.kind ? "selected" : ""}>${d.label}</option>`).join("")}
        </select></div>
      <div class="section-title">Parameters</div>
      ${props}
      <button class="link-btn" data-act="addParam">+ Add custom parameter</button>
      <div class="row-actions"><button class="btn ghost tiny" data-act="delete">Delete component</button></div>
    `;
  }

  propRoom(r) {
    const p = this.store.project;
    const pxm = p.scale.pxPerMeter || p.settings.conceptPxPerMeter || 50;
    const areaM2 = polygonArea(r.points) / (pxm * pxm);
    // assigned terminals inside the room
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
      return `<span class="pill ${cls}">${assigned} / ${target || 0} l/s</span>`;
    };
    return h`
      <div class="section-title">Room</div>
      <div class="field"><label>Name</label><input type="text" data-k="name" value="${r.name}"/></div>
      <div class="field"><label>Supply target (l/s)</label><input type="number" data-k="supplyFlow_ls" value="${r.supplyFlow_ls || 0}"/></div>
      <div class="field"><label>Extract target (l/s)</label><input type="number" data-k="extractFlow_ls" value="${r.extractFlow_ls || 0}"/></div>
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
      <div class="section-title">Junction node</div>
      <div class="field"><label>Position</label><span class="badge">${Math.round(n.x)}, ${Math.round(n.y)}</span></div>
      <div class="field"><label>Connected ducts</label><span class="badge">${segs}</span></div>
      <p class="small-note">Drag to move. Connecting more ducts here creates branches / tees.</p>
      <div class="row-actions"><button class="btn ghost tiny" data-act="delete">Delete node &amp; ducts</button></div>
    `;
  }

  bindProperty(el, sel, obj) {
    const store = this.store;
    const commit = () => store.commit();
    // generic key inputs
    el.querySelectorAll("[data-k]").forEach((input) => {
      input.addEventListener("change", () => {
        store.snapshot();
        const key = input.dataset.k;
        let val = input.value;
        if (input.type === "number") val = val === "" ? null : Number(val);
        obj[key] = val;
        commit();
      });
    });
    // component props
    el.querySelectorAll("[data-prop]").forEach((input) => {
      input.addEventListener("change", () => {
        store.snapshot();
        const key = input.dataset.prop;
        obj.props[key] = input.type === "number" || input.step === "any" ? (input.value === "" ? 0 : Number(input.value)) : input.value;
        commit();
      });
    });
    // size overrides
    el.querySelectorAll("[data-size]").forEach((input) => {
      input.addEventListener("change", () => {
        store.snapshot();
        obj.sizeOverride = obj.sizeOverride || {};
        const key = input.dataset.size;
        obj.sizeOverride[key] = input.value === "" ? undefined : Number(input.value);
        if (!obj.sizeOverride.diameterMm && !obj.sizeOverride.widthMm) obj.sizeOverride = null;
        commit();
      });
    });
    // fittings
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
    // actions
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
          store.snapshot(); obj.sizeOverride = null; commit();
        } else if (act === "addParam") {
          const name = await showPrompt({ title: "Add custom parameter", label: "Parameter name", value: "" });
          if (name) { store.snapshot(); obj.props[name] = 0; commit(); }
        }
      });
    });
  }

  bindRooms(el) {
    // no interactions on empty view besides project stats
  }

  // ---------------- Results ----------------
  renderResults() {
    const el = this.els.results;
    if (!this.results) { el.innerHTML = `<p class="empty-hint">No calculation yet.</p>`; return; }
    el.innerHTML = `<div class="result-cards">
      ${this.systemCard(this.results.supply)}
      ${this.systemCard(this.results.extract)}
    </div>`;
    el.querySelectorAll("[data-export]").forEach((btn) => {
      btn.addEventListener("click", () => this.exportCsv(btn.dataset.export));
    });
    el.querySelectorAll("[data-selseg]").forEach((row) => {
      row.addEventListener("click", () => this.store.select("segment", row.dataset.selseg));
    });
  }

  systemCard(sys) {
    const unit = this.store.project.settings.flowUnit || "l/s";
    const hasNet = sys.segments.length > 0;
    const marginPill = sys.plant
      ? (sys.marginPa >= 0
          ? `<span class="pill ok">+${num(sys.marginPa, 0)} Pa spare</span>`
          : `<span class="pill bad">${num(sys.marginPa, 0)} Pa short</span>`)
      : `<span class="pill warn">no plant</span>`;
    const rows = sys.segments.map((s) => {
      const size = s.section.shape === "rect" ? `${s.section.widthMm}×${s.section.heightMm}` : `⌀${s.section.diameterMm}`;
      const idx = sys.indexPath.includes(s.id);
      return `<tr class="${idx ? "index-row" : ""} ${s.withinVelocity ? "" : "over-vel"}" data-selseg="${s.id}" style="cursor:pointer">
        <td>${size}</td>
        <td>${num(s.flowM3s * 1000, 0)}</td>
        <td>${num(s.velocity, 2)}</td>
        <td>${num(s.lengthM, 1)}</td>
        <td>${num(s.gradient, 2)}</td>
        <td>${num(s.dpPa, 1)}</td>
      </tr>`;
    }).join("");

    return h`
      <div class="rcard ${sys.systemType}">
        <h3>${sys.systemType === "supply" ? "Supply" : "Extract"} system
          <span class="pill ${sys.systemType}">${sys.pressureClassInfo ? "Class " + sys.pressureClass : ""}</span>
          ${marginPill}
        </h3>
        <div class="metric-grid">
          <div class="metric"><div class="m-val">${formatFlow(sys.totalFlowM3s, unit)}</div><div class="m-label">Total design flow</div></div>
          <div class="metric"><div class="m-val">${num(sys.indexStaticPa, 0)} <small>Pa</small></div><div class="m-label">Index static (ESP)</div><div class="m-sub">${sys.plant ? "avail " + num(sys.availableStaticPa,0) + " Pa" : "add fan/AHU"}</div></div>
          <div class="metric"><div class="m-val">${num(sys.maxVelocity, 2)} <small>m/s</small></div><div class="m-label">Max velocity</div></div>
          <div class="metric"><div class="m-val">${num(sys.minVelocity, 2)} <small>m/s</small></div><div class="m-label">Min velocity</div></div>
        </div>
        ${sys.warnings.length ? `<ul class="warn-list">${sys.warnings.map((w) => `<li>${w}</li>`).join("")}</ul>` : ""}
        ${hasNet ? `
        <table class="schedule">
          <thead><tr><th>Size (mm)</th><th>l/s</th><th>m/s</th><th>Len m</th><th>Pa/m</th><th>Δp Pa</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <p class="small-note">Highlighted row = index run (governs fan duty). Click a row to select the duct.</p>
        <div class="row-actions"><button class="btn ghost tiny" data-export="${sys.systemType}">Export schedule (CSV)</button></div>
        ` : `<p class="small-note">Trace ${sys.systemType} ducts and add a fan/AHU + terminals to size this system.</p>`}
      </div>`;
  }

  exportCsv(systemType) {
    const sys = this.results[systemType];
    const header = ["Size(mm)", "Shape", "Flow(l/s)", "Velocity(m/s)", "Length(m)", "Gradient(Pa/m)", "Friction(Pa)", "Fittings(Pa)", "Inline(Pa)", "SegmentDp(Pa)", "Role", "IndexRun"].join(",");
    const lines = sys.segments.map((s) => {
      const size = s.section.shape === "rect" ? `${s.section.widthMm}x${s.section.heightMm}` : `${s.section.diameterMm}`;
      return [size, s.section.shape, num(s.flowM3s * 1000, 0), num(s.velocity, 2), num(s.lengthM, 2), num(s.gradient, 3), num(s.frictionPa, 2), num(s.fittingPa, 2), num(s.inlinePa, 2), num(s.dpPa, 2), s.role, sys.indexPath.includes(s.id) ? "yes" : ""].join(",");
    });
    const summary = `\nSystem,${systemType}\nTotal flow (l/s),${num(sys.totalFlowM3s * 1000, 0)}\nIndex static (Pa),${num(sys.indexStaticPa, 0)}\nPressure class,${sys.pressureClass}\nMax velocity (m/s),${num(sys.maxVelocity, 2)}\n`;
    const csv = header + "\n" + lines.join("\n") + "\n" + summary;
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `duct-schedule-${systemType}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  segResult(id) {
    if (!this.results) return null;
    return this.results.supply.segments.find((s) => s.id === id) || this.results.extract.segments.find((s) => s.id === id) || null;
  }

  // ---------------- Settings ----------------
  renderSettings() {
    const el = this.els.settings;
    const s = this.store.project.settings;
    const p = this.store.project;
    const scaleTxt = p.scale.pxPerMeter ? `${round(p.scale.pxPerMeter, 1)} px/m` : "not set (using concept scale)";
    el.innerHTML = h`
      <div class="section-title">Sizing method</div>
      <div class="field"><label>Method</label>
        <select data-s="sizingMethod">
          <option value="friction" ${s.sizingMethod === "friction" ? "selected" : ""}>Equal friction (target Pa/m)</option>
          <option value="velocity" ${s.sizingMethod === "velocity" ? "selected" : ""}>Velocity method</option>
        </select></div>
      <div class="field"><label>Target gradient (Pa/m)</label><input type="number" step="0.1" data-s="targetGradient" value="${s.targetGradient}"/></div>
      <div class="field"><label>Default duct shape</label>
        <select data-s="ductType">
          <option value="round" ${s.ductType === "round" ? "selected" : ""}>Round / spiral</option>
          <option value="rect" ${s.ductType === "rect" ? "selected" : ""}>Rectangular</option>
        </select></div>
      <div class="field"><label>Rect. duct height (mm)</label><input type="number" data-s="rectHeight" value="${s.rectHeight}"/></div>
      <div class="field"><label>Max aspect ratio</label><input type="number" step="0.5" data-s="maxAspect" value="${s.maxAspect}"/></div>
      <div class="field"><label>Roughness (mm)</label><input type="number" step="0.01" data-s="roughnessMm" value="${s.roughnessMm}"/></div>

      <div class="section-title">Velocity limits (m/s)</div>
      <div class="field"><label>Main ducts</label><input type="number" step="0.5" data-cap="main" value="${s.velocityCaps.main}"/></div>
      <div class="field"><label>Branches</label><input type="number" step="0.5" data-cap="branch" value="${s.velocityCaps.branch}"/></div>
      <div class="field"><label>Run-outs / terminals</label><input type="number" step="0.5" data-cap="runout" value="${s.velocityCaps.runout}"/></div>

      <div class="section-title">Air conditions</div>
      <div class="field"><label>Supply temp (°C)</label><input type="number" data-s="supplyTempC" value="${s.supplyTempC}"/></div>
      <div class="field"><label>Extract temp (°C)</label><input type="number" data-s="extractTempC" value="${s.extractTempC}"/></div>
      <div class="field"><label>Flow display unit</label>
        <select data-s="flowUnit">
          <option value="l/s" ${s.flowUnit === "l/s" ? "selected" : ""}>l/s</option>
          <option value="m3/h" ${s.flowUnit === "m3/h" ? "selected" : ""}>m³/h</option>
          <option value="m3/s" ${s.flowUnit === "m3/s" ? "selected" : ""}>m³/s</option>
          <option value="cfm" ${s.flowUnit === "cfm" ? "selected" : ""}>cfm</option>
        </select></div>

      <div class="section-title">Scale</div>
      <div class="field"><label>Drawing scale</label><span class="badge">${scaleTxt}</span></div>
      <div class="field"><label>Concept scale (px/m)</label><input type="number" data-s="conceptPxPerMeter" value="${s.conceptPxPerMeter}"/></div>
      <button class="link-btn" data-act="resetScale">Reset drawing scale</button>
      <p class="small-note">Use the <b>Scale</b> tool to calibrate from an uploaded drawing. In concept mode the concept scale sets duct lengths.</p>
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
        s[key] = input.type === "number" ? Number(input.value) : input.value;
        store.commit();
      });
    });
    el.querySelectorAll("[data-cap]").forEach((input) => {
      input.addEventListener("change", () => {
        store.snapshot();
        s.velocityCaps[input.dataset.cap] = Number(input.value);
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
  }
}
