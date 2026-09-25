// Application entry point. Laid out and driven the way Pipe Trace is: a top
// bar of document actions, a tool rail down the left, the drawing in the
// middle with a docked hint, a status strip and the zoom, and an inspector on
// the right that opens when something is picked.

import { Store, seedDemo } from "./state.js";
import { CanvasView } from "./ui/canvas.js";
import { View3D, VISUAL_MODES } from "./ui/view3d.js";
import { Panels } from "./ui/panels.js";
import { componentDef, COMPONENTS, isDualPort } from "./standards/components.js";
import { computeAll, allComputedSystems } from "./calc/network.js";
import { showConfirm, showModal, closeModal, modalOpen, toast } from "./ui/modal.js";
import { formatFlow, normalizeFlowUnit, round } from "./units.js";
import { buildProjectPdf, buildTakeoffPdf, downloadBlob } from "./export/pdf.js";
import { generatePhysicalModel } from "./fab/generator.js";
import { buildTakeoff } from "./fab/takeoff.js";
import { dist, routeLengthM, isVerticalRiser } from "./geom.js";
import { pxPerMeterOf } from "./layout.js";
import { HELP, HELP_SECTIONS, STEPS, helpMatches } from "./ui/help.js";
import { SYSTEMS, isOutsideSystem } from "./systems.js";

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const store = new Store();
const restored = store.load();
let started = restored && hasContent();

function hasContent() {
  const p = store.project;
  return !!(p.background || p.nodes.length || p.components.length || p.rooms.length || (p.measures || []).length);
}

const canvas = new CanvasView($("#canvas"), store, {
  onHint: () => renderHint(),
  onView: () => renderZoom(),
  onScaleSet: () => { renderRail(); },
});
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

/* ==========================================================================
   TOOLS
   ========================================================================== */
const TOOLS = [
  { id: "select", label: "Select", key: "V", icon: "M4 2l14 8-6 1.6L9.4 18z" },
  { id: "pan", label: "Pan", key: "H", icon: "M10 2v8M6 5v6M14 5v6M3 9c0 5 3 9 7 9s7-4 7-9" },
  { hr: true },
  { id: "scale", label: "Scale", key: "S", icon: "M2 7h16v6H2zM6 7v4M10 7v6M14 7v4" },
  { id: "tape", label: "Tape", key: "M", icon: "M3 10h14M5 7v6M10 7v6M15 7v6", scale: true },
  { id: "room", label: "Room", key: "R", icon: "M3 4h14v12H3zM3 4l4 3M17 4l-4 3", scale: true },
  { hr: true },
  { id: "ahu", label: "AHU", key: "A", icon: "M2 5h16v10H2zM7 5v10M13 5v10M9 8.5h2M9 11.5h2", place: "ahu", scale: true },
  { id: "hrv", label: "HRV", key: "E", icon: "M2 5h16v10H2zM6 5l8 10M14 5l-8 10", place: "hrv", scale: true },
  { id: "fan", label: "Fan", key: "F", icon: "M10 3a7 7 0 110 14 7 7 0 010-14zM10 10l-3-5M10 10l5.5 1M10 10l-2.5 5.5", palette: "fan", scale: true },
  { id: "terminal", label: "Terminal", key: "G", icon: "M4 6h12v8H4zM4 6l12 8M16 6L4 14", palette: "terminal", scale: true },
  { id: "inline", label: "In-line", key: "I", icon: "M2 10h4M14 10h4M6 6h8v8H6zM6 6l8 8", palette: "inline", scale: true },
  { hr: true },
  { id: "duct", label: "Trace", key: "T", icon: "M2 15l5-9 5 5 6-8", scale: true },
];
const PALETTES = {
  fan: { title: "Fans", kinds: ["fan_centrifugal", "fan_axial", "fan_plug"], note: "A fan is the plant for the system you are tracing." },
  terminal: { title: "Terminals", groups: [["In the building", ["diffuser", "grille_supply", "louvre", "grille_extract", "valve_extract"]], ["Outside", ["intake_louvre", "roof_intake", "exhaust_louvre", "roof_cowl"]]], note: "Extract grilles are always extract, intake louvres fresh air and exhaust louvres exhaust. An outside terminal takes the unit's own airflow unless you type one." },
  inline: { title: "In-line devices", kinds: ["fire_damper", "vcd", "attenuator", "plenum", "heater", "filter"], note: "Click on a duct to put the device on it." },
};
let paletteOpen = null; // "fan" | "terminal" | "inline"
let railTool = "select"; // the rail button that is lit

function scaleNeeded() {
  const p = store.project;
  return !!p.background && p.mode !== "concept" && !(p.scale.pxPerMeter > 0);
}

function renderRail() {
  const rail = $("#rail");
  rail.innerHTML = "";
  for (const t of TOOLS) {
    if (t.hr) { rail.appendChild(document.createElement("hr")); continue; }
    const b = document.createElement("button");
    const locked = t.scale && scaleNeeded();
    b.className = "tool" + (railTool === t.id ? " on" : "");
    b.id = `tool-${t.id}`;
    b.title = locked ? `${t.label} — set the scale first` : `${t.label}  (${t.key})`;
    b.innerHTML = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${t.icon}"/></svg><i>${t.label}</i>`;
    b.disabled = (!started && t.id !== "select") || locked;
    b.addEventListener("click", () => armTool(t.id));
    rail.appendChild(b);
  }
}

function armTool(id) {
  const t = TOOLS.find((x) => x.id === id);
  if (!t) return;
  if (t.scale && scaleNeeded()) { scaleGate(); return; }
  if (!started && id !== "select") return;
  canvas.endDraft();
  railTool = id;
  hintHidden = false;
  if (t.palette) {
    paletteOpen = t.palette;
    const pal = PALETTES[t.palette];
    const kinds = pal.kinds || pal.groups.flatMap((g) => g[1]);
    const keep = kinds.includes(store.newComponentKind) ? store.newComponentKind : kinds[0];
    store.setTool("component", keep);
  } else {
    paletteOpen = null;
    if (t.place) store.setTool("component", t.place);
    else store.setTool(id);
  }
  renderRail();
  renderPalette();
  renderHint();
}

function renderPalette() {
  const el = $("#cpal");
  if (!paletteOpen) { el.classList.remove("on"); return; }
  const pal = PALETTES[paletteOpen];
  $("#cpalTitle").textContent = pal.title;
  $("#cpalNote").textContent = pal.note;
  const body = $("#cpalBody");
  body.innerHTML = "";
  const groups = pal.groups || [[null, pal.kinds]];
  for (const [gname, kinds] of groups) {
  if (gname) { const g = document.createElement("div"); g.className = "vgrp"; g.textContent = gname; body.appendChild(g); }
  for (const kind of kinds) {
    const def = COMPONENTS[kind];
    const b = document.createElement("button");
    b.className = "vitem" + (store.newComponentKind === kind ? " on" : "");
    const extra = def.role === "terminal" ? (def.outside ? "auto" : `${def.props.designFlow_ls} l/s`) : def.role === "inline" ? `${def.props.lossPa} Pa` : `${def.props.availableStaticPa} Pa`;
    b.innerHTML = `<span class="vsym" style="background:${def.color}">${esc(def.symbol)}</span><span class="vlbl">${esc(def.label)}</span><span class="vn">${extra}</span>`;
    b.addEventListener("click", () => { store.setTool("component", kind); renderPalette(); renderHint(); });
    body.appendChild(b);
  }
  }
  el.classList.add("on");
}
$("#cpalDone").addEventListener("click", () => armTool("select"));

// Trace as supply or extract — asked the moment Trace is armed
document.querySelectorAll("[data-tsys]").forEach((b) => b.addEventListener("click", () => {
  if (canvas.draft) canvas.endDraft();
  store.activeSystem = b.dataset.tsys;
  store.emit();
}));

/* ==========================================================================
   THE HINT
   ========================================================================== */
let hintHidden = false;
const HINTS = {
  select: "Click to pick · drag a unit or a corner to move it · drag empty paper to pan · <kbd>Del</kbd> removes only what is picked.",
  pan: "Drag to move around the drawing. <kbd>Space</kbd>-drag pans in any tool.",
  scale: "Click two points a known distance apart, then type the real dimension.",
  tape: "Click along the route; click again to turn. Double-click, <kbd>Enter</kbd> or Finish keeps it. Plan metres only — never a duct.",
  room: "Click the corners of the room. Click the first corner, double-click or <kbd>Enter</kbd> to close it.",
  duct: "Pick the airstream on the left. Start on a unit's ring or a dot on a run. Click each corner; click a unit or a run to join and drop the pencil. Double-click, <kbd>Enter</kbd> or Finish stops in mid-air. Set <b>Height</b> and click the same point for a riser.",
};
function hintText() {
  const tool = store.tool;
  if (tool === "component") {
    const def = componentDef(store.newComponentKind);
    if (!def) return "";
    if (def.role === "inline") return `Click on a duct to put the <b>${esc(def.label.toLowerCase())}</b> on it. Drag empty paper to pan.`;
    if (isDualPort(store.newComponentKind)) return `Click where the <b>${esc(def.label)}</b> sits. Internal (IN, supply and extract) on the right, external (EX, fresh air and exhaust) on the left — turn the unit to suit. Drag empty paper to pan.`;
    if (def.outside) return `Click where the <b>${esc(def.label.toLowerCase())}</b> sits, on the outside wall or roof. Its flow follows the unit. Drag empty paper to pan.`;
    return `Click where the <b>${esc(def.label.toLowerCase())}</b> sits (${def.system || (isOutsideSystem(store.activeSystem) ? "supply" : store.activeSystem)}). Drag empty paper to pan.`;
  }
  return HINTS[tool] || "";
}
function renderHint() {
  const el = $("#hint");
  const tool = store.tool;
  const txt = hintText();
  el.classList.toggle("on", !!txt && started && store.viewMode !== "3d");
  el.classList.toggle("min", hintHidden);
  el.classList.toggle("trace", tool === "duct");
  el.classList.toggle("tape", tool === "tape" || tool === "room");
  el.classList.toggle("drawing", (tool === "duct" && !!canvas.draft) || (tool === "tape" && canvas.tapePts.length > 1) || (tool === "room" && canvas.roomPts.length > 2));
  el.classList.toggle("alt", !!store.overrideKey && (tool === "duct" || tool === "tape" || tool === "room"));
  $("#hintTxt").innerHTML = txt;
  $("#orthoChk").checked = store.project.settings.ortho !== false;
  const hgt = $("#hgtIn");
  if (document.activeElement !== hgt) hgt.value = round(store.traceHeight, 2).toFixed(2);
  const ang = canvas.angleNow();
  const a = $("#hintAngle");
  if (ang) {
    a.textContent = `${round(ang.deg, 1)}° · ${round(ang.lenM, 2)} m`;
    a.classList.toggle("free", ang.free);
  } else {
    a.textContent = "—";
    a.classList.remove("free");
  }
  $("#tpal").classList.toggle("on", tool === "duct" && started && store.viewMode !== "3d");
  document.querySelectorAll("[data-tsys]").forEach((b) => b.classList.toggle("on", b.dataset.tsys === store.activeSystem));
}
$("#hintX").addEventListener("click", () => { hintHidden = true; renderHint(); });
$("#hintShow").addEventListener("click", () => { hintHidden = false; renderHint(); });
$("#hintFin").addEventListener("click", () => canvas.endDraft());
$("#orthoChk").addEventListener("change", (e) => { store.project.settings.ortho = e.target.checked; store.persist(); renderHint(); renderStatus(lastResults); });
$("#hgtIn").addEventListener("change", (e) => { store.setTraceHeight(e.target.value); });
$("#hgtIn").addEventListener("wheel", (e) => e.target.blur(), { passive: true });

/* ==========================================================================
   THE START BOARD AND HELP
   ========================================================================== */
function renderBoard() {
  $("#board").classList.toggle("off", started);
  const host = $("#boardHelp");
  if (host.dataset.built) return;
  host.dataset.built = "1";
  const secs = HELP_SECTIONS.map((sec) => {
    const tips = HELP.filter((t) => t.sec === sec.id).map((t) => `<div class="tip"><h4>${t.t}</h4><p>${t.b}</p></div>`).join("");
    return `<div class="help-sec"><h3>${sec.label}</h3>${tips}</div>`;
  }).join("");
  host.innerHTML = `<h2>What do I do when… — every tip, also under ? Help at any time</h2><div class="help-grid">${secs}</div>`;
}

function renderHelp() {
  const q = $("#helpQ").value.trim();
  const now = new Set([store.tool === "component" ? railTool : store.tool, railTool]);
  const out = HELP_SECTIONS.map((sec) => {
    const tips = HELP.filter((t) => t.sec === sec.id && helpMatches(t, q));
    if (!tips.length) return "";
    return `<h3>${sec.label}</h3>` + tips.map((t) => `<div class="tip${(t.tools || []).some((x) => now.has(x)) ? " now" : ""}"><h4>${t.t}</h4><p>${t.b}</p></div>`).join("");
  }).join("");
  $("#helpBody").innerHTML = out || `<div class="empty">Nothing matches “${esc(q)}”.</div>`;
}
function toggleHelp(on) {
  const pane = $("#helpPane");
  const want = on ?? !pane.classList.contains("on");
  pane.classList.toggle("on", want);
  if (want) { renderHelp(); $("#helpQ").focus(); }
}
$("#helpQ").addEventListener("input", renderHelp);
$("#helpClose").addEventListener("click", () => toggleHelp(false));
$("#bHelp").addEventListener("click", () => toggleHelp());

function stepsDialog() {
  const body = showModal("How Duct Trace works", `<ol class="steps">${STEPS.map((s) => `<li><b>${s.t}</b>${s.b}</li>`).join("")}</ol>
    <div class="modal-actions"><button class="btn ghost" id="stHelp">All the tips</button><button class="btn go" data-close>Got it</button></div>`, { wide: true });
  body.querySelector("#stHelp").addEventListener("click", () => { closeModal(true); toggleHelp(true); });
}
$("#bSteps").addEventListener("click", stepsDialog);

/* ==========================================================================
   DRAWINGS, CONCEPT AND THE SCALE GATE
   ========================================================================== */
function startWorking() {
  started = true;
  renderBoard();
  renderRail();
  renderHint();
  canvas.resize();
  store.emit();
}

function startConcept() {
  store.snapshot();
  store.project.mode = "concept";
  if (!(store.project.scale.pxPerMeter > 0) && !store.project.background) store.project.scale.pxPerMeter = null;
  store.commit();
  startWorking();
  if (!store.project.nodes.length && !store.project.components.length) {
    const v = store.project.view;
    v.zoom = 1; v.offsetX = 80; v.offsetY = 80;
  }
  toast("Concept — place the unit and terminals, trace the ducts, type the lengths");
}
$("#bConcept").addEventListener("click", () => {
  if (!started) { startConcept(); return; }
  const p = store.project;
  if (p.mode === "concept") {
    if (!p.background) { $("#fDwg").click(); return; }
    store.snapshot(); p.mode = "drawing"; store.commit();
    toast("Drawing on");
  } else {
    store.snapshot(); p.mode = "concept"; store.commit();
    toast(p.background ? "Concept — the drawing is hidden, the trace stays" : "Concept");
  }
});
$("#bPickConcept").addEventListener("click", startConcept);
$("#bPick").addEventListener("click", () => $("#fDwg").click());
$("#bOpenDwg").addEventListener("click", () => $("#fDwg").click());
$("#bPickDemo").addEventListener("click", () => { seedDemo(store); startWorking(); canvas.fit(); toast("Worked example — an office floor with a combined AHU"); });
$("#fDwg").addEventListener("change", (e) => { loadDrawingFile(e.target.files[0]); e.target.value = ""; });

async function loadDrawingFile(file) {
  if (!file) return;
  if (/\.json$/i.test(file.name) || file.type === "application/json") { openProjectFile(file); return; }
  const isPdf = /pdf$/i.test(file.type) || /\.pdf$/i.test(file.name);
  let img;
  if (isPdf) {
    if (typeof pdfjsLib === "undefined") {
      showModal("PDF support did not load", `<p>The PDF reader could not be fetched, which usually means no internet connection.
        Export the drawing as a PNG or JPEG and load that instead — everything else works the same.</p>
        <div class="modal-actions"><button class="btn go" data-close>Close</button></div>`);
      return;
    }
    try {
      toast("Reading the PDF…", 6000);
      pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      const buf = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
      const page = await pdf.getPage(1);
      // rendered generously so tracing stays accurate when zoomed in
      const base = page.getViewport({ scale: 1 });
      const scale = Math.max(1, Math.min(4, 2400 / base.width));
      const vp = page.getViewport({ scale });
      const cv = document.createElement("canvas");
      cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
      const cx = cv.getContext("2d");
      cx.fillStyle = "#fff"; cx.fillRect(0, 0, cv.width, cv.height);
      await page.render({ canvasContext: cx, viewport: vp }).promise;
      img = { dataUrl: cv.toDataURL("image/jpeg", 0.9), w: cv.width, h: cv.height, label: file.name + (pdf.numPages > 1 ? ` (page 1 of ${pdf.numPages})` : "") };
      if (pdf.numPages > 1) toast(`Loaded page 1 of ${pdf.numPages}`);
    } catch (err) {
      showModal("That PDF could not be opened", `<p>${esc(err?.message || "Unknown error")}</p><p>Exporting it as a PNG or JPEG usually works.</p>
        <div class="modal-actions"><button class="btn go" data-close>Close</button></div>`);
      return;
    }
  } else {
    img = await new Promise((resolve) => {
      const rd = new FileReader();
      rd.onload = () => {
        const im = new Image();
        im.onload = () => resolve({ dataUrl: rd.result, w: im.naturalWidth, h: im.naturalHeight, label: file.name });
        im.onerror = () => resolve(null);
        im.src = rd.result;
      };
      rd.readAsDataURL(file);
    });
    if (!img) { toast("That image could not be read"); return; }
  }
  const p = store.project;
  const replacing = !!p.background || p.nodes.length > 0;
  let keepScale = false;
  if (replacing && p.scale.pxPerMeter > 0) {
    keepScale = await showConfirm({
      title: "Does the scale still hold?",
      message: "There is already a take-off on this project. If the new sheet is a revision at the same scale and position, keep the scale and the trace stays where it is. Otherwise set the scale again.",
      okText: "Keep the scale", cancelText: "Set it again",
    });
  }
  store.snapshot();
  p.background = { dataUrl: img.dataUrl, width: img.w, height: img.h, x: 0, y: 0, opacity: 0.9, label: img.label };
  p.mode = "drawing";
  if (!keepScale) p.scale = { pxPerMeter: null, calib: null };
  store.commit();
  startWorking();
  canvas.fit();
  if (store.drawingNotStored) toast("The drawing is too big to keep in the browser — Save keeps it in the file");
  scaleGate();
}

// Nothing traced before the scale is set means anything, so a drawing that
// arrives without one stops here. Placing and tracing stay locked until it is.
function scaleGate() {
  if (!scaleNeeded()) return;
  const body = showModal("Set the scale — before anything else", `
    <p>Every length and every duct size comes off the drawing, so the scale has to be right first.</p>
    <p>Pick two points a known distance apart — a grid line, a bay, a dimension already on the drawing — and type the real figure. Use the longest one you can find.</p>
    <div class="modal-actions"><button class="btn ghost" id="sgConcept">Work as a concept instead</button><button class="btn go" id="sgGo">Set the scale</button></div>`, { locked: true });
  body.querySelector("#sgGo").addEventListener("click", () => { closeModal(true); railTool = "scale"; paletteOpen = null; store.setTool("scale"); renderRail(); renderPalette(); renderHint(); });
  body.querySelector("#sgConcept").addEventListener("click", () => { closeModal(true); store.snapshot(); store.project.mode = "concept"; store.commit(); renderRail(); });
}

// drop a PDF, an image or a saved project anywhere on the board or the sheet
["dragover", "drop"].forEach((ev) => {
  $("#stage").addEventListener(ev, (e) => {
    e.preventDefault();
    $("#drop").classList.toggle("hot", ev === "dragover");
    if (ev === "drop") {
      const f = e.dataTransfer?.files?.[0];
      if (f) loadDrawingFile(f);
    }
  });
});
$("#stage").addEventListener("dragleave", () => $("#drop").classList.remove("hot"));

/* ==========================================================================
   FILES
   ========================================================================== */
function fileStem() {
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `${(store.project.meta.name || "Untitled").replace(/[\\/:*?"<>|—–]+/g, "-")} - ${date}`;
}
function saveProject() {
  const p = store.project;
  p.meta.rev = (Number(p.meta.rev) || 0) + 1;
  p.meta.savedAt = new Date().toISOString();
  const blob = new Blob([store.exportJSON()], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `Duct Trace - ${fileStem()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  store.persist();
  toast(`Saved — rev ${p.meta.rev}`);
  renderStatus(lastResults);
}
function openProjectFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data.nodes) || !Array.isArray(data.segments)) throw new Error("not a Duct Trace file");
      store.importJSON(reader.result);
      canvas.endDraft();
      startWorking();
      canvas.fit();
      toast(`Opened ${data.meta?.name || file.name}`);
      scaleGate();
    } catch (err) {
      showModal("That file is not a Duct Trace take-off", `<p>${esc(file.name)} could not be read as a Duct Trace project (${esc(err.message)}).</p>
        <p>Drawings go in with <b>Open drawing</b>; saved take-offs are the <span class="mono">Duct Trace - … .json</span> files.</p>
        <div class="modal-actions"><button class="btn go" data-close>Close</button></div>`);
    }
  };
  reader.readAsText(file);
}
$("#bSave").addEventListener("click", saveProject);
$("#bLoad").addEventListener("click", () => $("#fProj").click());
$("#fProj").addEventListener("change", (e) => { const f = e.target.files[0]; if (f) openProjectFile(f); e.target.value = ""; });
$("#bNew").addEventListener("click", async () => {
  if (hasContent() && !(await showConfirm({ title: "Start a new project?", message: "This clears the take-off on screen. Save first if you want to keep it — Undo can bring it back until you close the page.", okText: "Clear and start again", danger: true }))) return;
  canvas.endDraft();
  store.reset();
  started = false;
  railTool = "select"; paletteOpen = null; store.setTool("select");
  renderBoard(); renderRail(); renderPalette(); renderHint();
});

/* ==========================================================================
   UNDO, UNITS, BASIS
   ========================================================================== */
$("#bUndo").addEventListener("click", () => { canvas.endDraft(); store.undo(); });
$("#bRedo").addEventListener("click", () => store.redo());
function setFlowUnit(u) {
  store.snapshot();
  store.project.settings.flowUnit = normalizeFlowUnit(u);
  store.commit();
}
document.querySelectorAll("[data-flowunit]").forEach((b) => b.addEventListener("click", () => setFlowUnit(b.dataset.flowunit)));
$("#bBasis").addEventListener("click", () => $("#basis").classList.add("on"));
$("#basisClose").addEventListener("click", () => $("#basis").classList.remove("on"));
$("#basis").addEventListener("click", (e) => { if (e.target.id === "basis") $("#basis").classList.remove("on"); });

/* ==========================================================================
   ZOOM
   ========================================================================== */
function renderZoom() {
  $("#zLvl").textContent = `${Math.round(store.project.view.zoom * 100)}%`;
}
$("#zIn").addEventListener("click", () => canvas.setZoom(canvas.zoom * 1.25));
$("#zOut").addEventListener("click", () => canvas.setZoom(canvas.zoom / 1.25));
$("#zFit").addEventListener("click", () => canvas.fit());
$("#zSize").addEventListener("click", () => { store.showDuctSize = store.showDuctSize === false; $("#zSize").classList.toggle("on", store.showDuctSize !== false); canvas.draw(); });
$("#zFade").addEventListener("click", () => { store.dimDrawing = !store.dimDrawing; $("#zFade").classList.toggle("on", store.dimDrawing); canvas.draw(); });

/* ==========================================================================
   SCHEDULE DRAWER, 3D, PDF
   ========================================================================== */
function openDrawer(tab) {
  $("#drawer").classList.add("on");
  document.querySelectorAll("#schedTabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  document.querySelectorAll("#drawer .tab-pane").forEach((p) => p.classList.toggle("on", p.id === `tab-${tab}`));
  $("#schedTitle").textContent = tab === "results" ? "Duct schedule" : tab === "fabrication" ? "Fabrication model" : "Take-off";
  if ((tab === "fabrication" || tab === "takeoff") && !store.project.physical?.generated) generateModel(false);
  store.emit();
}
$("#bSched").addEventListener("click", () => {
  if ($("#drawer").classList.contains("on")) $("#drawer").classList.remove("on");
  else openDrawer(document.querySelector("#schedTabs button.on")?.dataset.tab || "results");
});
document.querySelectorAll("#schedTabs button").forEach((b) => b.addEventListener("click", () => openDrawer(b.dataset.tab)));
$("#bSchedClose").addEventListener("click", () => $("#drawer").classList.remove("on"));

function generateModel(snapshot = true) {
  if (snapshot) store.snapshot();
  const results = computeAll(store.project);
  store.setPhysicalModel(generatePhysicalModel(store.project, results, { previous: store.project.physical }));
  store.commit();
}

const modeSel = $("#threeMode");
modeSel.innerHTML = VISUAL_MODES.map((m) => `<option value="${m.key}">${m.label}</option>`).join("");
modeSel.addEventListener("change", () => {
  store.visualMode = modeSel.value;
  if (store.visualMode !== "centreline" && store.visualMode !== "simple3d" && !store.project.physical?.generated) generateModel(false);
  store.emit();
});
$("#threeEx").addEventListener("change", (e) => { view3d.ex = Number(e.target.value) || 1; view3d.draw(); });
$("#threeExplode").addEventListener("click", () => { store.exploded = !store.exploded; $("#threeExplode").classList.toggle("on", store.exploded); store.emit(); });
document.querySelectorAll("#threeViews button").forEach((b) => b.addEventListener("click", () => view3d.setView(b.dataset.v)));
function open3d(on) {
  store.viewMode = on ? "3d" : "plan";
  $("#three").classList.toggle("on", on);
  if (on) { canvas.endDraft(); view3d.resize(); view3d.setView("fit"); }
  renderHint();
  store.emit();
}
$("#b3d").addEventListener("click", () => open3d(store.viewMode !== "3d"));
$("#three2d").addEventListener("click", () => open3d(false));

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}
async function captureViews() {
  const savedView = { ...store.project.view };
  const was3d = store.viewMode === "3d";
  const selWas = store.selection;
  store.selection = null;
  canvas.fit();
  canvas.draw();
  await nextFrame();
  const planJpeg = canvas.canvas.toDataURL("image/jpeg", 0.92);
  $("#three").classList.add("on");
  view3d.resize();
  view3d.setView("fit");
  view3d.draw();
  await nextFrame();
  const isoJpeg = view3d.canvas.toDataURL("image/jpeg", 0.92);
  if (!was3d) $("#three").classList.remove("on");
  Object.assign(store.project.view, savedView);
  store.selection = selWas;
  canvas.resize();
  return { planJpeg, isoJpeg };
}
async function exportPdfReport() {
  const btn = $("#bPdf");
  btn.disabled = true;
  const prev = btn.textContent;
  btn.textContent = "PDF…";
  try {
    const results = computeAll(store.project);
    const { planJpeg, isoJpeg } = await captureViews();
    const blob = buildProjectPdf({ project: store.project, results, planJpeg, isoJpeg });
    downloadBlob(blob, `Duct Trace report - ${fileStem()}.pdf`);
    toast("PDF report downloaded");
  } catch (err) {
    console.error(err);
    showModal("The PDF could not be built", `<p>${esc(err?.message || err)}</p><div class="modal-actions"><button class="btn go" data-close>Close</button></div>`);
  } finally {
    btn.disabled = false;
    btn.textContent = prev;
    store.emit();
  }
}
function exportTakeoffPdf(takeoff) {
  const blob = buildTakeoffPdf({ project: store.project, takeoff: takeoff || buildTakeoff(store.project.physical, store.takeoffFilters, store.project) });
  downloadBlob(blob, `Duct Trace take-off - ${fileStem()}.pdf`);
}
$("#bPdf").addEventListener("click", exportPdfReport);

/* ==========================================================================
   CHECK
   ========================================================================== */
function checkIssues(results) {
  const p = store.project;
  const out = [];
  const touching = (id) => p.segments.filter((s) => s.a === id || s.b === id);
  const px = pxPerMeterOf(p);
  if (scaleNeeded()) out.push({ lvl: "bad", msg: "The drawing has no scale — every length is meaningless until it is set." });
  const plants = p.components.filter((c) => componentDef(c.kind)?.role === "plant");
  if (!plants.length && p.segments.length) out.push({ lvl: "bad", msg: "There is no AHU, HRV or fan — nothing feeds the ductwork." });
  for (const c of p.components) {
    const def = componentDef(c.kind);
    if (!def) continue;
    const name = c.label || def.label;
    if (isDualPort(c.kind) && c.system === "both") {
      if (c.outdoorNodeId && !touching(c.outdoorNodeId).length && touching(c.nodeId).length) out.push({ lvl: "warn", msg: `${name} has no fresh-air duct — trace one from an intake louvre to its EX fresh-air connection.`, sel: ["component", c.id] });
      if (c.exhaustNodeId && !touching(c.exhaustNodeId).length && c.returnNodeId && touching(c.returnNodeId).length) out.push({ lvl: "warn", msg: `${name} has no exhaust duct — trace one from its EX exhaust connection to an exhaust louvre or cowl.`, sel: ["component", c.id] });
    }
    const joined = [c.nodeId, c.returnNodeId, c.outdoorNodeId, c.exhaustNodeId].filter(Boolean).reduce((a, id) => a + touching(id).length, 0);
    if (!joined) out.push({ lvl: def.role === "plant" ? "warn" : "bad", msg: `${name} is not connected to any duct.`, sel: ["component", c.id] });
    if (def.role === "terminal" && !(Number(c.props?.designFlow_ls) > 0)) out.push({ lvl: "warn", msg: `${name} has no design flow.`, sel: ["component", c.id] });
  }
  for (const n of p.nodes) {
    if (p.components.some((c) => [c.nodeId, c.returnNodeId, c.outdoorNodeId, c.exhaustNodeId].includes(n.id))) continue;
    const t = touching(n.id);
    if (t.length === 1) {
      const other = p.nodes.find((x) => x.id === (t[0].a === n.id ? t[0].b : t[0].a));
      if (other && isVerticalRiser(n, other, px)) continue;
      out.push({ lvl: "warn", msg: "A run stops short in mid-air — it does not reach a terminal or a unit.", sel: ["node", n.id] });
    }
    if (t.length === 0) out.push({ lvl: "warn", msg: "A loose point with no duct on it.", sel: ["node", n.id] });
  }
  const systems = results ? allComputedSystems(results) : [];
  const fed = new Set(systems.flatMap((sys) => sys.segments.filter((x) => x.flowM3s > 0).map((x) => x.id)));
  for (const s of p.segments) {
    if (!fed.has(s.id)) out.push({ lvl: "warn", msg: `A ${s.system} duct carries no air — it is not on a path from a unit to a terminal.`, sel: ["segment", s.id] });
  }
  const projectWarn = new Set(results?.projectWarnings || []);
  for (const sys of systems) {
    for (const w of sys.warnings || []) if (!projectWarn.has(w)) out.push({ lvl: /exceed|short|mismatch|do not match|does not match/i.test(w) ? "bad" : "warn", msg: `${sys.name}: ${w}` });
    if (sys.plant && sys.marginPa < 0 && !["outdoor", "exhaust"].includes(sys.systemType)) out.push({ lvl: "bad", msg: `${sys.name}: the fan needs ${round(sys.fanStaticPa ?? sys.indexStaticPa, 0)} Pa and the unit has ${round(sys.availableStaticPa, 0)} Pa.` });
  }
  for (const w of results?.projectWarnings || []) out.push({ lvl: "bad", msg: w });
  const seen = new Set();
  return out.filter((i) => { const k = i.msg + (i.sel ? i.sel.join() : ""); if (seen.has(k)) return false; seen.add(k); return true; });
}
function runCheck() {
  const issues = checkIssues(lastResults);
  const items = issues.length
    ? issues.slice(0, 60).map((i, k) => `<li class="${i.lvl}">${esc(i.msg)}${i.sel ? ` <button class="link-btn" data-show="${k}">Show</button>` : ""}</li>`).join("")
    : `<li class="ok">Nothing found. Every terminal is joined, every duct carries air and each unit has the static it needs.</li>`;
  const body = showModal(issues.length ? `Check — ${issues.length} to look at` : "Check — clean", `<ul class="check-list">${items}</ul>
    <div class="modal-actions"><button class="btn go" data-close>Close</button></div>`, { wide: true });
  body.querySelectorAll("[data-show]").forEach((b) => b.addEventListener("click", () => {
    const i = issues[Number(b.dataset.show)];
    closeModal(true);
    railTool = "select"; paletteOpen = null; store.setTool("select"); renderRail(); renderPalette();
    store.select(i.sel[0], i.sel[1]);
    centreOn(i.sel);
  }));
}
function centreOn([type, id]) {
  const p = store.project;
  let at = null;
  if (type === "component") at = p.components.find((c) => c.id === id);
  if (type === "node") at = p.nodes.find((n) => n.id === id);
  if (type === "segment") {
    const s = p.segments.find((x) => x.id === id);
    const a = s && p.nodes.find((n) => n.id === s.a), b = s && p.nodes.find((n) => n.id === s.b);
    if (a && b) at = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
  if (!at) return;
  const v = p.view;
  v.offsetX = canvas.canvas.clientWidth / 2 - at.x * v.zoom;
  v.offsetY = canvas.canvas.clientHeight / 2 - at.y * v.zoom;
  canvas.changed();
}
$("#bCheck").addEventListener("click", runCheck);

/* ==========================================================================
   INSPECTOR
   ========================================================================== */
$("#insClose").addEventListener("click", () => store.select(null));
function renderInspector() {
  const sel = store.selection;
  const obj = store.getSelected();
  const on = !!(sel && obj) && store.viewMode !== "3d";
  const body = $("#body");
  const was = body.classList.contains("insp");
  body.classList.toggle("insp", on);
  if (was !== on) requestAnimationFrame(() => canvas.resize());
  if (!on) return;
  let kind = "", name = "";
  if (sel.type === "component") { const def = componentDef(obj.kind); kind = def?.label || obj.kind; name = obj.label || def?.label; }
  else if (sel.type === "segment") {
    kind = `${obj.system} duct`;
    const p = store.project;
    const a = p.nodes.find((n) => n.id === obj.a), b = p.nodes.find((n) => n.id === obj.b);
    const px = pxPerMeterOf(p);
    name = a && b ? (isVerticalRiser(a, b, px) ? `Riser ${round(Math.abs((b.z || 0) - (a.z || 0)), 2)} m` : `Run ${round(routeLengthM(a, b, px), 2)} m`) : "Run";
  } else if (sel.type === "room") { kind = "Room"; name = obj.name; }
  else if (sel.type === "node") { kind = obj.tee ? "T-piece" : "Point"; name = `${round(obj.z || 0, 2)} m AFFL`; }
  else if (sel.type === "measure") { kind = "Tape"; name = `${round(canvas.polyLengthM(obj.pts), 2)} m on plan`; }
  else if (sel.type === "piece") { kind = "Fabricated piece"; name = obj.ref || ""; }
  $("#insKind").textContent = kind;
  $("#insName").textContent = name || " ";
  if (sel.type === "measure") {
    $("#tab-properties").innerHTML = `<p class="small-note">A tape is a ruler, not a duct: plan metres only, no rise, not on the schedule, not in 3D.</p>
      <div class="field"><label>Length on plan</label><span class="badge">${round(canvas.polyLengthM(obj.pts), 2)} m</span></div>
      <div class="row-actions"><button class="btn ghost tiny" id="mDel">Delete tape</button></div>`;
    $("#mDel").addEventListener("click", () => store.deleteSelection());
  }
}

/* ==========================================================================
   STATUS STRIP
   ========================================================================== */
let lastResults = null;
function renderStatus(results) {
  const st = $("#status");
  st.style.display = started ? "flex" : "none";
  if (!started) return;
  const p = store.project;
  const unit = normalizeFlowUnit(p.settings.flowUnit);
  const px = pxPerMeterOf(p);
  const cell = (k, v, cls = "", attrs = "") => `<div class="st ${cls}" ${attrs}><b>${k}</b><span>${v}</span></div>`;
  const terms = p.components.filter((c) => componentDef(c.kind)?.role === "terminal");
  let plan = 0, installed = 0;
  for (const s of p.segments) {
    const a = p.nodes.find((n) => n.id === s.a), b = p.nodes.find((n) => n.id === s.b);
    if (!a || !b) continue;
    plan += dist(a, b) / px;
    installed += Number(s.engineeringLengthM) > 0 ? Number(s.engineeringLengthM) : routeLengthM(a, b, px);
  }
  const systems = results ? allComputedSystems(results) : [];
  const issues = results ? checkIssues(results) : [];
  const bad = issues.filter((i) => i.lvl === "bad").length;
  let html = cell(p.mode === "concept" ? "Concept" : "Scale", p.mode === "concept" && !p.background ? "schematic" : (p.scale.pxPerMeter > 0 ? `${round(p.scale.pxPerMeter, 1)} px/m` : "not set"), scaleNeeded() ? "bad" : "")
    + cell("Terminals", String(terms.length))
    + cell("Flow unit", unit === "m3/h" ? "m³/h" : "l/s", "click", 'id="stUnit" title="Click to switch l/s and m³/h"');
  for (const sys of systems) {
    const cls = { supply: "sup", extract: "ext", outdoor: "oda", exhaust: "eha" }[sys.systemType] || "sup";
    const oneUnit = systems.filter((x) => x.systemType === sys.systemType).length === 1;
    html += cell(oneUnit ? `${SYSTEMS[sys.systemType]?.label || sys.systemType} ${SYSTEMS[sys.systemType]?.code || ""}` : (sys.name || sys.systemType), `${formatFlow(sys.totalFlowM3s, unit)} · ${round(sys.indexStaticPa, 0)} Pa`, sys.plant && sys.marginPa < 0 ? "bad" : cls);
  }
  html += cell("Duct on plan", `${round(plan, 1)} m`)
    + cell("Installed", `${round(installed, 1)} m`)
    + cell("Check", issues.length ? `${issues.length} to look at` : "clean", bad ? "bad click" : issues.length ? "warn click" : "click", 'id="stCheck"')
    + (p.meta.rev ? cell("File", `rev ${p.meta.rev}`) : "");
  st.innerHTML = html;
  $("#stUnit")?.addEventListener("click", () => setFlowUnit(unit === "m3/h" ? "l/s" : "m3/h"));
  $("#stCheck")?.addEventListener("click", runCheck);
}

/* ==========================================================================
   KEYBOARD
   ========================================================================== */
window.addEventListener("keydown", (e) => {
  if (e.key === "Alt") { e.preventDefault(); }
  if (e.altKey !== !!store.overrideKey) { store.overrideKey = e.altKey; canvas.scheduleDraw(); renderHint(); }
  const typing = e.target.matches?.("input, textarea, select");
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key.toLowerCase() === "s") { e.preventDefault(); saveProject(); return; }
  if (ctrl && e.key.toLowerCase() === "o") { e.preventDefault(); $("#fProj").click(); return; }
  if (typing) {
    if (e.key === "Escape") e.target.blur();
    return;
  }
  if (e.key === "Escape") {
    if (modalOpen()) { closeModal(); return; }
    if ($("#helpPane").classList.contains("on")) { toggleHelp(false); return; }
    if ($("#basis").classList.contains("on")) { $("#basis").classList.remove("on"); return; }
    if (canvas.draft || canvas.tapePts.length || canvas.roomPts.length || canvas.scalePts.length) { canvas.endDraft(); return; }
    if (store.viewMode === "3d") { open3d(false); return; }
    store.select(null);
    return;
  }
  if (modalOpen()) return;
  if (ctrl && e.key.toLowerCase() === "z") { e.preventDefault(); canvas.endDraft(); e.shiftKey ? store.redo() : store.undo(); return; }
  if (ctrl && e.key.toLowerCase() === "y") { e.preventDefault(); store.redo(); return; }
  if (ctrl && e.key.toLowerCase() === "d") {
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
  if (e.key === "?" || e.key === "F1") { e.preventDefault(); toggleHelp(); return; }
  if (e.key === " ") { e.preventDefault(); if (!canvas.spaceDown) { canvas.spaceDown = true; canvas.canvas.classList.add("pan"); } return; }
  if (e.key === "Enter") { canvas.endDraft(); return; }
  if (e.key === "Delete" || e.key === "Backspace") { if (store.selection) { e.preventDefault(); store.deleteSelection(); } return; }
  if ((e.key === "[" || e.key === "]") && !ctrl) {
    e.preventDefault();
    store.setTraceHeight(round(store.traceHeight + (e.key === "]" ? 0.1 : -0.1), 2));
    renderHint();
    return;
  }
  if (ctrl || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === "o") { store.project.settings.ortho = store.project.settings.ortho === false; store.persist(); renderHint(); renderStatus(lastResults); toast(store.project.settings.ortho !== false ? "Corners square up to 90° and 45°" : "Corners free — Alt squares one up"); return; }
  if (k === "d") { armTool("duct"); return; }
  const t = TOOLS.find((x) => x.key && x.key.toLowerCase() === k);
  if (t) armTool(t.id);
});
window.addEventListener("keyup", (e) => {
  if (e.key === "Alt" || (!e.altKey && store.overrideKey)) { store.overrideKey = false; canvas.scheduleDraw(); renderHint(); }
  if (e.key === " ") { canvas.spaceDown = false; canvas.canvas.classList.remove("pan"); }
});
window.addEventListener("blur", () => { store.overrideKey = false; canvas.spaceDown = false; });
window.addEventListener("resize", () => { canvas.resize(); if (store.viewMode === "3d") view3d.resize(); });

/* ==========================================================================
   RENDER ON CHANGE
   ========================================================================== */
function renderChrome() {
  const p = store.project;
  $("#bUndo").disabled = store.undoStack.length === 0;
  $("#bRedo").disabled = store.redoStack.length === 0;
  $("#bConcept").classList.toggle("on", started && p.mode === "concept");
  const unit = normalizeFlowUnit(p.settings.flowUnit);
  document.querySelectorAll("[data-flowunit]").forEach((b) => b.classList.toggle("on", b.dataset.flowunit === unit));
  const needs = !started;
  for (const id of ["#bCheck", "#b3d", "#bSched", "#bPdf", "#bSave"]) $(id).disabled = needs;
  $("#b3d").classList.toggle("on", store.viewMode === "3d");
  $("#bSched").classList.toggle("on", $("#drawer").classList.contains("on"));
  modeSel.value = store.visualMode;
  // a tool set from somewhere else (the scale finishing, Esc) lights its rail button
  if (store.tool === "select" && railTool !== "select" && !paletteOpen) { railTool = "select"; renderRail(); }
  renderZoom();
  renderHint();
  renderInspector();
}

let scheduled = false;
store.subscribe(() => {
  renderChrome();
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    const results = computeAll(store.project);
    lastResults = results;
    canvas.setResults(results);
    view3d.setResults(results);
    panels.setResults(results);
    panels.renderAll();
    renderInspector();
    renderStatus(results);
    renderLegend();
    if (store.viewMode === "3d") view3d.draw();
  });
});

function renderLegend() {
  $("#threeLegend").innerHTML = Object.values(SYSTEMS).map((x) => `<div class="ln"><span class="sw" style="background:${x.color}"></span>${x.label} <span style="color:var(--muted)">${x.code}</span></div>`).join("")
    + `<div class="ln" style="color:var(--muted);font-size:11px">Heights above finished floor</div>`;
}

// initial paint
const initial = computeAll(store.project);
lastResults = initial;
canvas.setResults(initial);
view3d.setResults(initial);
panels.setResults(initial);
panels.renderAll();
renderBoard();
renderRail();
renderChrome();
renderStatus(initial);
renderLegend();
canvas.resize();
if (started) {
  canvas.fit();
  toast("Your last take-off is back — New starts again");
  scaleGate();
}
