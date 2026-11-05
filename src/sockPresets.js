// Air sock presets: the typical figures for a manufacturer's fabric and
// discharge pattern, built up from the selections (EPCs) that come back on
// jobs. Applying one to a sock fills its manufacturer, product, pattern and
// suspension, and puts the preset's static in as the sock's nominal figure —
// it stays "nominal" (and Check keeps asking) until the job's own selection
// is typed in.
//
// Kept in two places: this browser (so every job sees them) and the job file
// (so a job opened on another machine still has the ones it used).

const KEY = "duct-trace-ahu:sock-presets";

function readLocal() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch (e) {
    return [];
  }
}

function writeLocal(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) { /* storage may be unavailable */ }
}

// The job's presets, then this browser's, by name.
export function listPresets(project) {
  const out = new Map();
  for (const p of [...(project?.sockPresets || []), ...readLocal()]) {
    if (p?.name && !out.has(p.name)) out.set(p.name, p);
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function presetFromSock(c, name) {
  const pr = c?.props || {};
  const confirmed = pr.basis === "manufacturer" && Number(pr.mfrStaticPa) > 0;
  return {
    name: String(name || "").trim(),
    manufacturer: pr.manufacturer || "",
    product: pr.product || "",
    discharge: pr.discharge || "perforated",
    suspension: pr.suspension || "cable1",
    staticPa: confirmed ? Number(pr.mfrStaticPa) : Number(pr.nominalStaticPa) || 0,
    throwM: Number(pr.mfrThrow_m) || Number(pr.typThrow_m) || 0,
    nr: Number(pr.mfrNR) || Number(pr.typNR) || 0,
    source: pr.selectionRef || "",
  };
}

export function savePreset(project, preset) {
  if (!preset?.name) return false;
  const put = (list) => [...list.filter((p) => p.name !== preset.name), preset];
  project.sockPresets = put(project.sockPresets || []);
  writeLocal(put(readLocal()));
  return true;
}

export function deletePreset(project, name) {
  project.sockPresets = (project.sockPresets || []).filter((p) => p.name !== name);
  writeLocal(readLocal().filter((p) => p.name !== name));
}

export function applyPreset(c, preset) {
  if (!c || !preset) return;
  const pr = (c.props = c.props || {});
  pr.preset = preset.name;
  if (preset.manufacturer) pr.manufacturer = preset.manufacturer;
  if (preset.product) pr.product = preset.product;
  if (preset.discharge) pr.discharge = preset.discharge;
  if (preset.suspension) pr.suspension = preset.suspension;
  if (Number(preset.staticPa) > 0) pr.nominalStaticPa = Number(preset.staticPa);
  pr.typThrow_m = Number(preset.throwM) || 0;
  pr.typNR = Number(preset.nr) || 0;
}
