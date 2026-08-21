// Application entry point: builds the palette, wires the toolbar/topbar,
// creates the canvas and panels, and runs the compute-on-change loop.

import { Store, seedDemo } from "./state.js";
import { CanvasView } from "./ui/canvas.js";
import { View3D } from "./ui/view3d.js";
import { Panels } from "./ui/panels.js";
import { componentsByCategory, CATEGORIES, componentDef } from "./standards/components.js";
import { computeAll, allComputedSystems } from "./calc/network.js";
import { showConfirm } from "./ui/modal.js";
import { formatFlow, normalizeFlowUnit, round } from "./units.js";
import { buildProjectPdf, buildTakeoffPdf, downloadBlob } from "./export/pdf.js";
import { generatePhysicalModel } from "./fab/generator.js";
import { buildTakeoff } from "./fab/takeoff.js";

const $ = (sel) => document.querySelector(sel);

const store = new Store();
if (!store.load()) seedDemo(store);

const canvas = new CanvasView($("#canvas"), store, (t) => ($("#hint").textContent = t));
const view3d = new View3D($("#view3d"), store);
const panels = new Panels(store, {
  properties: $("#tab-properties"),
  results: $("#tab-results"),
  fabrication: $("#tab-fabrication"),
  takeoff: $("#tab-takeoff"),
  settings: $("#tab-settings"),
});
panels.onExportPdf = exportPdfReport;
store.onExportTakeoffPdf = exportTakeoffPdf;

// ---- palette ----
function buildPalette() {
  const groups = componentsByCategory();
  const el = $("#palette");
  el.innerHTML = "";
  for (const [catKey, label] of Object.entries(CATEGORIES)) {
    const title = document.createElement("div");
    title.className = "palette-group-title";
    title.textContent = label;
    el.appendChild(title);
    for (const def of groups[catKey] || []) {
      const btn = document.createElement("button");
      btn.className = "palette-btn";
      btn.dataset.kind = def.kind;
      btn.innerHTML = `<span class="palette-sym" style="background:${def.color}">${def.symbol}</span><span>${def.label}</span>`;
      btn.addEventListener("click", () => store.setTool("component", def.kind));
      el.appendChild(btn);
    }
  }
}
buildPalette();

// ---- toolbar tools ----
document.querySelectorAll(".tool").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.dataset.tool === "delete") {
      if (store.selection) store.deleteSelection();
      store.setTool("select");
      return;
    }
    store.setTool(btn.dataset.tool);
    canvas.endDraft();
  });
});

// ---- mode / system toggles ----
document.querySelectorAll("[data-mode]").forEach((b) =>
  b.addEventListener("click", () => { store.snapshot(); store.project.mode = b.dataset.mode; store.commit(); })
);
document.querySelectorAll("[data-system]").forEach((b) =>
  b.addEventListener("click", () => { store.activeSystem = b.dataset.system; store.emit(); })
);
document.querySelectorAll("[data-view]").forEach((b) =>
  b.addEventListener("click", () => {
    store.viewMode = b.dataset.view;
    document.querySelector(".workspace").classList.toggle("view-3d", store.viewMode === "3d");
    $("#view3d-hud").hidden = store.viewMode !== "3d";
    if (store.viewMode === "3d") view3d.resize();
    store.emit();
  })
);
document.querySelectorAll("[data-vismode]").forEach((b) =>
  b.addEventListener("click", () => {
    store.visualMode = b.dataset.vismode;
    if (store.visualMode === "fabrication" && !store.project.physical?.generated) {
      const results = computeAll(store.project);
      store.setPhysicalModel(generatePhysicalModel(store.project, results, { previous: store.project.physical }));
    }
    store.emit();
  })
);
$("#btnExplode")?.addEventListener("click", () => {
  store.exploded = !store.exploded;
  store.emit();
});
$("#btnFab")?.addEventListener("click", () => {
  store.snapshot();
  const results = computeAll(store.project);
  store.setPhysicalModel(generatePhysicalModel(store.project, results, { previous: store.project.physical }));
  store.visualMode = "fabrication";
  store.viewMode = "3d";
  document.querySelector(".workspace").classList.add("view-3d");
  $("#view3d-hud").hidden = false;
  activateTab("fabrication");
  store.commit();
  view3d.resize();
});
$("#btnTakeoff")?.addEventListener("click", () => {
  if (!store.project.physical?.generated) {
    store.snapshot();
    const results = computeAll(store.project);
    store.setPhysicalModel(generatePhysicalModel(store.project, results, { previous: store.project.physical }));
    store.commit();
  }
  activateTab("takeoff");
  store.emit();
});

function activateTab(name) {
  document.querySelectorAll(".panel-tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  document.querySelectorAll(".tab-pane").forEach((p) => p.classList.toggle("active", p.id === `tab-${name}`));
}
document.querySelectorAll("[data-flowunit]").forEach((b) =>
  b.addEventListener("click", () => {
    store.snapshot();
    store.project.settings.flowUnit = normalizeFlowUnit(b.dataset.flowunit);
    store.commit();
  })
);

$("#traceHeight").addEventListener("change", (e) => store.setTraceHeight(e.target.value));
$("#traceHeight").addEventListener("wheel", (e) => { e.target.blur(); }, { passive: true });

// ---- topbar buttons ----
$("#projectName").addEventListener("change", (e) => { store.snapshot(); store.project.meta.name = e.target.value; store.commit(); });
$("#btnUndo").addEventListener("click", () => store.undo());
$("#btnRedo").addEventListener("click", () => store.redo());
$("#btnDemo").addEventListener("click", async () => {
  if (await showConfirm({ title: "Load demo project?", message: "This replaces the current project with a worked example.", okText: "Load demo" })) {
    seedDemo(store); canvas.fit();
  }
});
$("#btnNew").addEventListener("click", async () => {
  if (await showConfirm({ title: "New project?", message: "This clears the current project.", okText: "New project" })) {
    store.reset(); canvas.fit();
  }
});
$("#btnExport").addEventListener("click", () => {
  const blob = new Blob([store.exportJSON()], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${(store.project.meta.name || "duct-project").replace(/\s+/g, "-").toLowerCase()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});
$("#btnPdf").addEventListener("click", () => exportPdfReport());

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

async function captureViews() {
  const workspace = document.querySelector(".workspace");
  const saved = store.viewMode;
  const savedView = { ...store.project.view };

  store.viewMode = "plan";
  workspace.classList.remove("view-3d");
  canvas.fit();
  canvas.resize();
  canvas.draw();
  await nextFrame();
  const planJpeg = canvas.canvas.toDataURL("image/jpeg", 0.92);

  store.viewMode = "3d";
  workspace.classList.add("view-3d");
  view3d.resize();
  view3d.draw();
  await nextFrame();
  const isoJpeg = view3d.canvas.toDataURL("image/jpeg", 0.92);

  store.viewMode = saved;
  workspace.classList.toggle("view-3d", saved === "3d");
  Object.assign(store.project.view, savedView);
  if (saved === "3d") view3d.resize();
  else canvas.resize();
  return { planJpeg, isoJpeg };
}

async function exportPdfReport() {
  const btn = $("#btnPdf");
  const prev = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = "PDF…"; }
  try {
    const results = computeAll(store.project);
    const { planJpeg, isoJpeg } = await captureViews();
    const blob = buildProjectPdf({ project: store.project, results, planJpeg, isoJpeg });
    const name = `${(store.project.meta.name || "duct-project").replace(/\s+/g, "-").toLowerCase()}-report.pdf`;
    downloadBlob(blob, name);
  } catch (err) {
    console.error(err);
    alert("Could not build the PDF report.");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = prev || "PDF"; }
    store.emit();
  }
}

function exportTakeoffPdf(takeoff) {
  const blob = buildTakeoffPdf({ project: store.project, takeoff: takeoff || buildTakeoff(store.project.physical, store.takeoffFilters, store.project) });
  const name = `${(store.project.meta.name || "duct-project").replace(/\s+/g, "-").toLowerCase()}-takeoff.pdf`;
  downloadBlob(blob, name);
}
$("#btnImport").addEventListener("click", () => $("#fileImport").click());
$("#fileImport").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => { try { store.importJSON(reader.result); canvas.fit(); } catch (err) { alert("Invalid project file"); } };
  reader.readAsText(file);
  e.target.value = "";
});

// ---- canvas toolbar ----
$("#fileBackground").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      store.snapshot();
      const maxW = 1200;
      const scale = img.width > maxW ? maxW / img.width : 1;
      store.project.background = { dataUrl: reader.result, width: img.width * scale, height: img.height * scale, x: 0, y: 0, opacity: 0.85 };
      store.project.mode = "drawing";
      store.commit();
      canvas.fit();
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
  e.target.value = "";
});
$("#btnClearBg").addEventListener("click", () => { store.snapshot(); store.project.background = null; store.commit(); });
$("#btnZoomIn").addEventListener("click", () => canvas.setZoom(canvas.view.zoom * 1.2));
$("#btnZoomOut").addEventListener("click", () => canvas.setZoom(canvas.view.zoom / 1.2));
$("#btnZoomFit").addEventListener("click", () => canvas.fit());

// ---- panel tabs ----
document.querySelectorAll(".panel-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".panel-tab").forEach((t) => t.classList.toggle("active", t === tab));
    document.querySelectorAll(".tab-pane").forEach((p) => p.classList.toggle("active", p.id === `tab-${tab.dataset.tab}`));
  });
});

// ---- keyboard ----
window.addEventListener("keydown", (e) => {
  if (e.target.matches("input, textarea, select")) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? store.redo() : store.undo(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); store.redo(); return; }
  if (e.altKey) { store.overrideKey = true; canvas.draw(); }
  const map = { v: "select", h: "pan", s: "scale", r: "room", d: "duct", j: "tee" };
  if (map[e.key.toLowerCase()] && !e.ctrlKey && !e.metaKey) { store.setTool(map[e.key.toLowerCase()]); canvas.endDraft(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
    e.preventDefault();
    const sel = store.getSelected();
    if (store.selection?.type === "component" && sel && componentDef(sel.kind)?.role === "terminal") {
      store.snapshot();
      const copy = store.duplicateComponent(sel);
      if (copy) store.select("component", copy.id);
      store.commit();
    }
    return;
  }
  if (e.key === "[" || e.key === "]") {
    e.preventDefault();
    store.setTraceHeight(round(store.traceHeight + (e.key === "]" ? 0.1 : -0.1), 2));
  }
  if (e.key === "Delete" || e.key === "Backspace") { if (store.selection) store.deleteSelection(); }
  if (e.key === "Escape") { canvas.endDraft(); store.select(null); }
  if (e.key === "Enter") { canvas.endDraft(); }
});
window.addEventListener("keyup", (e) => {
  if (e.key === "Alt") { store.overrideKey = false; canvas.draw(); }
});

window.addEventListener("resize", () => { canvas.resize(); view3d.resize(); });

// ---- render loop on state change ----
function renderChrome() {
  const p = store.project;
  if ($("#projectName").value !== p.meta.name) $("#projectName").value = p.meta.name;
  document.querySelectorAll("[data-mode]").forEach((b) => b.classList.toggle("active", b.dataset.mode === p.mode));
  document.querySelectorAll("[data-system]").forEach((b) => b.classList.toggle("active", b.dataset.system === store.activeSystem));
  document.querySelectorAll("[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === store.viewMode));
  document.querySelectorAll("[data-vismode]").forEach((b) => b.classList.toggle("active", b.dataset.vismode === store.visualMode));
  if ($("#view3d-hud")) $("#view3d-hud").hidden = store.viewMode !== "3d";
  if ($("#btnExplode")) $("#btnExplode").classList.toggle("active", !!store.exploded);
  if ($("#btnExplode")) $("#btnExplode").textContent = store.exploded ? "Exploded on" : "Exploded view";
  const unit = normalizeFlowUnit(p.settings.flowUnit);
  document.querySelectorAll("[data-flowunit]").forEach((b) => b.classList.toggle("active", b.dataset.flowunit === unit));
  document.querySelectorAll(".tool").forEach((b) => b.classList.toggle("active", b.dataset.tool === store.tool));
  if (Number($("#traceHeight").value) !== store.traceHeight) $("#traceHeight").value = round(store.traceHeight, 2);
  document.querySelectorAll(".palette-btn").forEach((b) => b.classList.toggle("active", store.tool === "component" && b.dataset.kind === store.newComponentKind));
  $("#zoomLabel").textContent = `${Math.round(p.view.zoom * 100)}%`;
  $("#scaleLabel").textContent = p.scale.pxPerMeter ? `Scale: ${round(p.scale.pxPerMeter, 1)} px/m` : `Scale: concept (${p.settings.conceptPxPerMeter} px/m)`;
  $("#btnUndo").disabled = store.undoStack.length === 0;
  $("#btnRedo").disabled = store.redoStack.length === 0;
  canvas.updateHint();
}

function renderStatus(results) {
  const unit = normalizeFlowUnit(store.project.settings.flowUnit);
  const systems = allComputedSystems(results);
  const bits = systems.map((sys) => {
    const side = sys.systemType === "supply" ? "Supply" : "Extract";
    return `<span>${sys.name || side}: <b>${formatFlow(sys.totalFlowM3s, unit)}</b> · ESP <b>${round(sys.indexStaticPa, 0)} Pa</b> · vmax ${round(sys.maxVelocity, 1)} m/s</span>`;
  });
  const warns = [
    ...(results.projectWarnings || []),
    ...systems.flatMap((s) => s.warnings || []),
  ];
  const mismatch = warns.find((w) => /does not match|do not match/i.test(w));
  if (mismatch) bits.push(`<span class="status-warn">${mismatch}</span>`);
  bits.push(`<span>${store.project.mode === "drawing" ? "Drawing mode" : "Concept mode"}</span>`);
  $("#statusbar").innerHTML = bits.join("");
}

let scheduled = false;
store.subscribe(() => {
  renderChrome();
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    const results = computeAll(store.project);
    canvas.setResults(results);
    view3d.setResults(results);
    panels.setResults(results);
    panels.renderAll();
    renderStatus(results);
    if (store.viewMode === "3d") view3d.draw();
    else canvas.draw();
  });
});

// initial paint
const initial = computeAll(store.project);
canvas.setResults(initial);
view3d.setResults(initial);
panels.setResults(initial);
panels.renderAll();
renderChrome();
renderStatus(initial);
canvas.fit();
