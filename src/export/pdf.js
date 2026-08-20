// Client-side A4 PDF builder for the project report.
// No dependencies: writes PDF 1.4 with Helvetica and embedded JPEGs.

import { FITTINGS } from "../standards/fittings.js";
import { componentDef } from "../standards/components.js";
import { VELOCITY_GUIDANCE } from "../standards/dw144.js";
import { allComputedSystems } from "../calc/network.js";
import { formatFlow, formatFlowLs, flowUnitLabel, plantDutyLs, plantStaticPa, round } from "../units.js";
import { roleLabel, sectionSizeLabel, sectionShapeLabel } from "../format.js";

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 42;
const BOTTOM = 36;

function pdfSafe(str) {
  return String(str ?? "")
    .replace(/m³/g, "m3")
    .replace(/³/g, "3")
    .replace(/⌀/g, "dia ")
    .replace(/×/g, "x")
    .replace(/Δ/g, "d")
    .replace(/–|—/g, "-")
    .replace(/•/g, "*")
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function decodeJpeg(dataUrl) {
  if (!dataUrl || typeof dataUrl !== "string") return null;
  const m = dataUrl.match(/^data:image\/jpeg;base64,(.+)$/i);
  if (!m) return null;
  const bin = atob(m[1]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function jpegSize(bytes) {
  if (!bytes || bytes.length < 4) return { w: 1, h: 1 };
  let i = 2;
  while (i < bytes.length - 8) {
    if (bytes[i] !== 0xff) break;
    const marker = bytes[i + 1];
    const len = (bytes[i + 2] << 8) + bytes[i + 3];
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      return { h: (bytes[i + 5] << 8) + bytes[i + 6], w: (bytes[i + 7] << 8) + bytes[i + 8] };
    }
    i += 2 + len;
  }
  return { w: 1, h: 1 };
}

class PdfDoc {
  constructor() {
    this.objects = [];
    this.pages = [];
    this.fonts = {};
    this.fontF1 = this.addObj("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
    this.fontF2 = this.addObj("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  }

  addObj(body) {
    this.objects.push(body);
    return this.objects.length;
  }

  addStream(dict, bytes) {
    const body = `${dict}\nstream\n`;
    this.objects.push({ stream: true, prefix: body, bytes, suffix: "\nendstream" });
    return this.objects.length;
  }

  addPage(content, xobjects = {}) {
    const contentId = this.addStream(`<< /Length ${content.length} >>`, content);
    let xo = "";
    const keys = Object.keys(xobjects);
    if (keys.length) {
      xo = " /XObject << " + keys.map((k) => `/${k} ${xobjects[k]} 0 R`).join(" ") + " >>";
    }
    const pageId = this.addObj(
      `<< /Type /Page /Parent PAGES /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      `/Contents ${contentId} 0 R /Resources << /Font << /F1 ${this.fontF1} 0 R /F2 ${this.fontF2} 0 R >>${xo} >> >>`
    );
    this.pages.push(pageId);
    return pageId;
  }

  addJpeg(dataUrl) {
    const bytes = decodeJpeg(dataUrl);
    if (!bytes) return null;
    const { w, h } = jpegSize(bytes);
    const dict = `<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>`;
    return { id: this.addStream(dict, bytes), w, h };
  }

  build() {
    const kids = this.pages.map((id) => `${id} 0 R`).join(" ");
    const pagesBody = `<< /Type /Pages /Kids [ ${kids} ] /Count ${this.pages.length} >>`;
    this.objects.push(pagesBody);
    const pagesId = this.objects.length;
    const catalogId = this.addObj(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

    const patched = this.objects.map((obj) => {
      if (typeof obj === "string") return obj.replace(/\/Parent PAGES/, `/Parent ${pagesId} 0 R`);
      return obj;
    });

    const encoder = new TextEncoder();
    const chunks = [];
    let offset = 0;
    const write = (data) => {
      const u8 = typeof data === "string" ? encoder.encode(data) : data;
      chunks.push(u8);
      offset += u8.length;
    };

    write("%PDF-1.4\n%\x80\x80\x80\x80\n");
    const xref = [0];
    for (let i = 0; i < patched.length; i++) {
      xref.push(offset);
      const obj = patched[i];
      write(`${i + 1} 0 obj\n`);
      if (obj && obj.stream) {
        write(obj.prefix);
        write(obj.bytes);
        write(obj.suffix);
      } else {
        write(obj);
      }
      write("\nendobj\n");
    }
    const xrefStart = offset;
    write(`xref\n0 ${patched.length + 1}\n`);
    write("0000000000 65535 f \n");
    for (let i = 1; i < xref.length; i++) {
      write(`${String(xref[i]).padStart(10, "0")} 00000 n \n`);
    }
    write(`trailer << /Size ${patched.length + 1} /Root ${catalogId} 0 R >>\n`);
    write(`startxref\n${xrefStart}\n%%EOF\n`);

    let total = 0;
    for (const c of chunks) total += c.length;
    const out = new Uint8Array(total);
    let p = 0;
    for (const c of chunks) {
      out.set(c, p);
      p += c.length;
    }
    return new Blob([out], { type: "application/pdf" });
  }
}

class PageWriter {
  constructor(doc, title) {
    this.doc = doc;
    this.title = title;
    this.ops = [];
    this.y = PAGE_H - MARGIN;
    this.xobjects = {};
    this.imgN = 0;
    this.pageNo = 0;
  }

  flush() {
    if (!this.ops.length && this.pageNo === 0) return;
    this.footer();
    this.doc.addPage(this.ops.join("\n"), { ...this.xobjects });
    this.ops = [];
    this.xobjects = {};
    this.imgN = 0;
    this.y = PAGE_H - MARGIN;
  }

  ensure(h) {
    if (this.y - h < BOTTOM + 16) this.newPage();
  }

  newPage() {
    this.flush();
    this.pageNo += 1;
    if (this.title) {
      this.text(this.title, MARGIN, this.y, { font: "F2", size: 9, color: [0.35, 0.4, 0.5] });
      this.y -= 16;
      this.rule();
    }
  }

  footer() {
    const n = this.doc.pages.length + 1;
    this.ops.push(`BT /F1 8 Tf 0.45 0.5 0.58 rg ${MARGIN} 22 Td (Page ${n}  -  Duct Trace AHU  -  DW144 / CIBSE) Tj ET`);
  }

  text(str, x, y, opts = {}) {
    const font = opts.font || "F1";
    const size = opts.size || 10;
    const [r, g, b] = opts.color || [0.08, 0.1, 0.16];
    this.ops.push(`BT /${font} ${size} Tf ${r} ${g} ${b} rg ${round(x, 2)} ${round(y, 2)} Td (${pdfSafe(str)}) Tj ET`);
  }

  rule(y = this.y) {
    this.ops.push(`0.75 0.8 0.86 RG 0.6 w ${MARGIN} ${round(y, 2)} m ${PAGE_W - MARGIN} ${round(y, 2)} l S`);
    this.y -= 8;
  }

  heading(str, size = 14) {
    this.ensure(22);
    this.text(str, MARGIN, this.y, { font: "F2", size, color: [0.07, 0.16, 0.32] });
    this.y -= size + 8;
  }

  para(str, size = 9) {
    const max = PAGE_W - MARGIN * 2;
    const words = String(str).split(/\s+/);
    let line = "";
    const width = (s) => s.length * size * 0.5;
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (width(next) > max && line) {
        this.ensure(size + 4);
        this.text(line, MARGIN, this.y, { size, color: [0.15, 0.18, 0.24] });
        this.y -= size + 3;
        line = w;
      } else line = next;
    }
    if (line) {
      this.ensure(size + 4);
      this.text(line, MARGIN, this.y, { size, color: [0.15, 0.18, 0.24] });
      this.y -= size + 3;
    }
  }

  kv(rows) {
    for (const [k, v] of rows) {
      this.ensure(13);
      this.text(k, MARGIN, this.y, { size: 9, color: [0.35, 0.4, 0.5] });
      this.text(String(v), MARGIN + 170, this.y, { font: "F2", size: 9 });
      this.y -= 13;
    }
  }

  table(headers, rows, colW) {
    const x0 = MARGIN;
    const h = 13;
    const drawRow = (cells, bold, fill) => {
      this.ensure(h + 2);
      let x = x0;
      if (fill) {
        this.ops.push(`${fill} rg ${x0} ${round(this.y - 3, 2)} ${PAGE_W - MARGIN * 2} ${h} re f`);
      }
      cells.forEach((c, i) => {
        const w = colW[i];
        this.text(String(c ?? ""), x + 2, this.y, { font: bold ? "F2" : "F1", size: 7.5, color: bold ? [0.25, 0.3, 0.4] : [0.1, 0.12, 0.18] });
        x += w;
      });
      this.y -= h;
    };
    drawRow(headers, true, "0.90 0.93 0.96");
    rows.forEach((r, i) => drawRow(r, false, i % 2 ? "0.96 0.97 0.98" : null));
    this.y -= 6;
  }

  image(jpeg, caption) {
    const img = this.doc.addJpeg(jpeg);
    if (!img) {
      this.para(caption + " (image unavailable)");
      return;
    }
    const maxW = PAGE_W - MARGIN * 2;
    const maxH = 420;
    const scale = Math.min(maxW / img.w, maxH / img.h);
    const w = img.w * scale;
    const h = img.h * scale;
    this.ensure(h + 28);
    const name = `Im${++this.imgN}`;
    this.xobjects[name] = img.id;
    const x = MARGIN + (maxW - w) / 2;
    const y = this.y - h;
    this.ops.push(`q ${round(w, 2)} 0 0 ${round(h, 2)} ${round(x, 2)} ${round(y, 2)} cm /${name} Do Q`);
    this.y = y - 14;
    this.text(caption, MARGIN, this.y, { size: 8, color: [0.35, 0.4, 0.5] });
    this.y -= 16;
  }

  warnList(items) {
    if (!items?.length) return;
    this.heading("Warnings", 11);
    for (const w of items) this.para("* " + w, 8.5);
    this.y -= 4;
  }
}

function fittingLabel(f) {
  return FITTINGS[f.type]?.label || f.type || "fitting";
}

function inlineDevices(project, sys) {
  const nodeIds = new Set();
  for (const s of sys.segments) {
    const seg = project.segments.find((x) => x.id === s.id);
    if (seg) { nodeIds.add(seg.a); nodeIds.add(seg.b); }
  }
  return (project.components || []).filter((c) => {
    const def = componentDef(c.kind);
    return def?.role === "inline" && (nodeIds.has(c.nodeId) || plantOn(sys, c));
  });
}

function plantOn(sys, c) {
  return sys.plant && c.id === sys.plant.id;
}

export function buildProjectPdf({ project, results, planJpeg, isoJpeg }) {
  const unit = project.settings?.flowUnit || "l/s";
  const unitLabel = flowUnitLabel(unit);
  const systems = allComputedSystems(results);
  const doc = new PdfDoc();
  const w = new PageWriter(doc, project.meta?.name || "Duct project");
  w.pageNo = 1;

  w.heading("Duct Trace AHU  -  design report", 18);
  w.para("Commercial / industrial ductwork sizing to DW144 / BESA standard sizes and CIBSE Guide B velocity guidance.");
  w.y -= 4;
  w.kv([
    ["Project", project.meta?.name || "Untitled"],
    ["Date", new Date().toISOString().slice(0, 10)],
    ["Mode", project.mode === "drawing" ? "Drawing" : "Concept"],
    ["Flow unit", unitLabel],
    ["Default duct", sectionShapeLabel(project.settings?.ductType)],
    ["Sizing method", project.settings?.sizingMethod === "velocity" ? "Velocity method" : "Equal friction"],
    ["Target gradient", `${project.settings?.targetGradient ?? 1} Pa/m`],
    ["Systems", String(systems.length)],
  ]);

  w.heading("CIBSE / DW144 velocity basis", 12);
  for (const line of VELOCITY_GUIDANCE) w.para(line, 8.5);
  w.y -= 4;

  const allWarn = [
    ...(results.projectWarnings || []),
    ...systems.flatMap((s) => (s.warnings || []).map((x) => `${s.name}: ${x}`)),
    ...systems.flatMap((s) => s.segments.filter((g) => g.warnings?.length).flatMap((g) => g.warnings.map((x) => `${s.name} ${sectionSizeLabel(g.section)}: ${x}`))),
  ];
  const unique = [...new Set(allWarn)];
  w.warnList(unique);

  w.heading("System summary", 12);
  w.table(
    ["System", `Flow (${unitLabel})`, "ESP Pa", "Avail Pa", "Class", "vmin", "vmax", "Ducts"],
    systems.map((s) => [
      s.name,
      formatFlow(s.totalFlowM3s, unit).replace(` ${unitLabel}`, ""),
      round(s.indexStaticPa, 0),
      s.plant ? round(s.availableStaticPa, 0) : "-",
      s.pressureClass || "-",
      round(s.minVelocity, 2),
      round(s.maxVelocity, 2),
      s.segments.length,
    ]),
    [130, 58, 48, 50, 36, 36, 36, 40]
  );

  for (const sys of systems) writeSystem(w, project, sys, unit, unitLabel);

  w.heading("Rooms", 12);
  if (!project.rooms?.length) w.para("No rooms outlined.");
  else {
    w.table(
      ["Room", `Supply (${unitLabel})`, `Extract (${unitLabel})`],
      project.rooms.map((r) => [
        r.name,
        formatFlowLs(r.supplyFlow_ls, unit).replace(` ${unitLabel}`, ""),
        formatFlowLs(r.extractFlow_ls, unit).replace(` ${unitLabel}`, ""),
      ]),
      [220, 120, 120]
    );
  }

  if (planJpeg) {
    w.heading("Plan layout", 14);
    w.para("Traced ductwork, plant and terminals as shown on the plan. Risers appear as markers only.");
    w.image(planJpeg, "Figure 1  -  Plan");
  }
  if (isoJpeg) {
    w.heading("3D layout", 14);
    w.para("Isometric review of the same network, including vertical risers and component heights (m AFFL).");
    w.image(isoJpeg, "Figure 2  -  3D");
  }

  w.para("Calculations use Darcy-Weisbach with Colebrook-White (Swamee-Jain) and Huebscher equivalent diameter for rectangular / square ducts. Verify against manufacturer data before construction.", 8);
  w.flush();
  return doc.build();
}

function writeSystem(w, project, sys, unit, unitLabel) {
  w.heading(sys.name, 14);
  w.para(`${sys.systemType} air at ${sys.tempC} C, density ${round(sys.density, 3)} kg/m3. Pressure class ${sys.pressureClass} (${sys.pressureClassInfo?.name || ""}).`);

  if (sys.plant) {
    const def = componentDef(sys.plant.kind);
    const side = sys.systemType;
    w.heading("Plant / AHU / fan", 11);
    w.kv([
      ["Item", sys.plant.label || def?.label || sys.plant.kind],
      ["Kind", def?.label || sys.plant.kind],
      ["System", sys.plant.system === "both" ? "Supply + extract" : sys.plant.system],
      [`Duty (${unitLabel})`, formatFlowLs(plantDutyLs(sys.plant.props, side), unit)],
      ["Available static (Pa)", round(plantStaticPa(sys.plant.props, side), 0)],
      ["Index ESP (Pa)", round(sys.indexStaticPa, 0)],
      ["Margin (Pa)", sys.marginPa == null ? "-" : round(sys.marginPa, 0)],
      ["Connected terminals", formatFlow(sys.totalFlowM3s, unit)],
      ["Match", sys.balance?.matched ? "Duty matches terminals" : (sys.balance?.plantDutyLs > 0 ? "MISMATCH - duty vs terminals" : "Duty not set (follows terminals)")],
    ]);
    const extra = Object.entries(sys.plant.props || {}).filter(([k]) =>
      !["designFlow_ls", "extractFlow_ls", "availableStaticPa", "extractStaticPa", "designFlow", "supplyFlow_ls", "supplyStaticPa"].includes(k)
    );
    if (extra.length) {
      w.kv(extra.map(([k, v]) => [k, v]));
    }
  } else {
    w.para("No AHU or fan on this system.");
  }

  w.warnList(sys.warnings);

  w.heading("Terminals / inlets / outlets", 11);
  if (!sys.terminals.length) w.para("No terminals connected.");
  else {
    w.table(
      ["Terminal", `Flow (${unitLabel})`, "Loss Pa", "Path Pa", "Connected"],
      sys.terminals.map((t) => [
        t.name,
        formatFlow(t.flowM3s, unit).replace(` ${unitLabel}`, ""),
        round(t.terminalLossPa, 0),
        round(t.totalPa, 0),
        t.connected ? "yes" : "NO",
      ]),
      [180, 70, 55, 60, 60]
    );
  }

  w.heading("Duct schedule", 11);
  if (!sys.segments.length) w.para("No ducts.");
  else {
    w.table(
      ["Size mm", "Shape", "Role", `Flow`, "m/s", "Len m", "Pa/m", "Fric", "Fit", "dP", "Idx"],
      sys.segments.map((s) => [
        sectionSizeLabel(s.section),
        sectionShapeLabel(s.section.shape),
        roleLabel(s.role),
        formatFlow(s.flowM3s, unit).replace(` ${unitLabel}`, ""),
        round(s.velocity, 2),
        round(s.lengthM, 2),
        round(s.gradient, 2),
        round(s.frictionPa, 1),
        round(s.fittingPa, 1),
        round(s.dpPa, 1),
        sys.indexPath.includes(s.id) ? "Y" : "",
      ]),
      [70, 52, 48, 48, 32, 36, 34, 34, 32, 32, 22]
    );
  }

  w.heading("Elbows and resistive fittings", 11);
  const fitRows = [];
  for (const s of sys.segments) {
    for (const f of s.fittings || []) {
      fitRows.push([
        sectionSizeLabel(s.section),
        roleLabel(s.role),
        fittingLabel(f),
        f.qty || 1,
        round(FITTINGS[f.type]?.k ?? f.k ?? 0, 2),
        round(s.fittingPa, 1),
      ]);
    }
  }
  if (!fitRows.length) w.para("No fittings recorded on this system.");
  else {
    w.table(
      ["Duct", "Role", "Fitting", "Qty", "K", "Loss Pa"],
      fitRows,
      [80, 55, 200, 36, 36, 50]
    );
  }

  const inlines = inlineDevices(project, sys);
  w.heading("In-line devices", 11);
  if (!inlines.length) w.para("None on this system.");
  else {
    w.table(
      ["Device", "Loss Pa", "K", "Note"],
      inlines.map((c) => {
        const def = componentDef(c.kind);
        return [c.label || def?.label, c.props?.lossPa ?? 0, c.props?.k ?? 0, c.props?.note || ""];
      }),
      [140, 60, 40, 220]
    );
  }
  w.y -= 8;
}

export function downloadBlob(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
