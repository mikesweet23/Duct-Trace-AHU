// Takeoff export: CSV, SpreadsheetML Excel, PDF schedule, and
// procurement / fabrication views. Component refs stay on every row.

import { round } from "../units.js";

function csvCell(v) {
  const s = v == null ? "" : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvLines(headers, rows) {
  return [headers.join(","), ...rows.map((r) => headers.map((h) => csvCell(r[h])).join(","))].join("\n");
}

export function takeoffCsv(takeoff) {
  const headers = [
    "ref", "kind", "description", "system", "construction", "size",
    "qty", "lengthM", "standard", "angleDeg", "sheetAreaM2", "weightKg",
    "insulationType", "insulationThicknessMm", "insulationAreaM2",
    "cladding", "claddingAreaM2", "floor", "zone", "area", "segmentId",
    "materialRate", "fabricationRate", "installationRate", "labourHours",
    "insulationRate", "purchaseCost", "sellRate",
  ];
  const rows = (takeoff.rows || []).map((r) => ({
    ...r,
    standard: r.standard ? "yes" : "",
    materialRate: r.costing?.materialRate ?? "",
    fabricationRate: r.costing?.fabricationRate ?? "",
    installationRate: r.costing?.installationRate ?? "",
    labourHours: r.costing?.labourHours ?? "",
    insulationRate: r.costing?.insulationRate ?? "",
    purchaseCost: r.costing?.purchaseCost ?? "",
    sellRate: r.costing?.sellRate ?? "",
  }));
  return csvLines(headers, rows);
}

export function procurementCsv(takeoff) {
  const lines = [];
  lines.push("Category,Item,Size,Qty,Length_m,Area_m2,Notes");
  for (const g of takeoff.circular || []) {
    lines.push(["Circular duct", g.construction, g.size, g.sections, g.lengthM, "", `${g.standardCount} × ${g.standardM} m + ${g.cutCount} cut`].join(","));
  }
  for (const g of takeoff.rectangular || []) {
    lines.push(["Rectangular duct", g.construction, g.size, g.sections, g.lengthM, g.sheetAreaM2, ""].join(","));
  }
  for (const g of takeoff.fittings || []) {
    lines.push(["Fitting", g.label, g.size, g.qty, "", "", (g.refs || []).join(" ")].join(","));
  }
  for (const g of takeoff.joints || []) {
    lines.push(["Joint", g.label, g.size, g.qty, "", "", ""].join(","));
  }
  for (const g of takeoff.boots || []) {
    lines.push(["Boot", g.label, g.size, g.qty, "", "", ""].join(","));
  }
  for (const g of takeoff.ancillaries || []) {
    lines.push(["Ancillary", g.label, g.size, g.qty, "", "", ""].join(","));
  }
  for (const g of takeoff.supports || []) {
    lines.push(["Support (estimate)", g.label, "", g.qty, "", "", "Approximate"].join(","));
  }
  for (const g of takeoff.insulation || []) {
    lines.push(["Insulation", `${g.thicknessMm} mm ${g.type}`, "", 1, "", g.areaM2, g.cladding ? `${g.cladding} ${g.claddingAreaM2} m2` : ""].join(","));
  }
  return lines.join("\n");
}

export function fabricationCsv(takeoff) {
  const headers = ["ref", "kind", "description", "size", "qty", "lengthM", "standard", "system", "segmentId"];
  const rows = (takeoff.rows || []).filter((r) => r.kind !== "support");
  return csvLines(headers, rows);
}

function xmlSafe(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function takeoffExcelXml(takeoff, title = "Duct takeoff") {
  const headers = ["Ref", "Kind", "Description", "System", "Construction", "Size", "Qty", "Length m", "Area m2", "Weight kg", "Insulation m2", "Floor", "Zone"];
  const rows = (takeoff.rows || []).map((r) => [
    r.ref, r.kind, r.description, r.system, r.construction, r.size,
    r.qty, r.lengthM, r.sheetAreaM2, r.weightKg, r.insulationAreaM2, r.floor, r.zone,
  ]);
  const cell = (v, t = "String") => `<Cell><Data ss:Type="${t}">${xmlSafe(v)}</Data></Cell>`;
  const rowXml = (vals, types) => `<Row>${vals.map((v, i) => cell(v, types?.[i] || (typeof v === "number" ? "Number" : "String"))).join("")}</Row>`;
  const types = ["String", "String", "String", "String", "String", "String", "Number", "Number", "Number", "Number", "Number", "String", "String"];
  const body = [
    rowXml(headers, headers.map(() => "String")),
    ...rows.map((r) => rowXml(r, types)),
  ].join("");
  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Worksheet ss:Name="${xmlSafe(title)}">
<Table>${body}</Table>
</Worksheet>
</Workbook>`;
}

export function downloadText(filename, text, mime) {
  const blob = new Blob([text], { type: mime || "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function takeoffNarrative(takeoff) {
  const bits = [];
  for (const g of takeoff.circular || []) {
    bits.push(
      `${g.size} ${g.construction === "spiral" ? "Spiral" : "Circular"}\n` +
      `Straight duct: ${g.lengthM} m\n` +
      `Standard ${g.standardM} m lengths: ${g.standardCount}\n` +
      `Cut section: ${round(g.cutLengthM, 2)} m`
    );
  }
  for (const g of takeoff.rectangular || []) {
    bits.push(`${g.size} rectangular\nStraight: ${g.lengthM} m\nSheet area: ${g.sheetAreaM2} m²\nSections: ${g.sections}`);
  }
  return bits.join("\n\n");
}
