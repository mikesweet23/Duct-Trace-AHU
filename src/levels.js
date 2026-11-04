// Floors / levels. A job often runs over several floors, each with its own
// drawing. Every node, unit, terminal, room and tape measure belongs to one
// level; the plan shows the level being worked on (the others faintly, to
// line up risers against), and a riser between levels is a duct whose two
// ends sit on different levels at the same point on plan.
//
// Heights stay as typed — metres above that level's finished floor (AFFL).
// The level's own elevation is added only where heights are compared across
// floors: the solve, the fabrication model, 3D and installed lengths, via
// resolveLevels(). A project with one level (or every level at 0 m) is
// passed through untouched, so nothing changes for a single-floor job.
//
// All levels share one plan scale and one origin: a drawing loaded onto a
// second level is scaled to the project's scale when its own scale is set,
// and can be offset so its grid sits over the floor below.

export const FIRST_LEVEL_ID = "L0";

export function defaultLevel() {
  return { id: FIRST_LEVEL_ID, name: "Ground floor", elevationM: 0, background: null };
}

// Make sure a project has at least one level and a valid active level.
export function ensureLevels(p) {
  if (!Array.isArray(p.levels) || !p.levels.length) p.levels = [defaultLevel()];
  for (const l of p.levels) {
    if (!l.id) l.id = `L${Math.random().toString(36).slice(2, 8)}`;
    if (!Number.isFinite(Number(l.elevationM))) l.elevationM = 0;
    if (l.name == null) l.name = "";
    if (l.background === undefined) l.background = null;
  }
  if (!p.levels.some((l) => l.id === p.activeLevel)) p.activeLevel = p.levels[0].id;
  return p;
}

export function levelsOf(p) {
  return Array.isArray(p?.levels) && p.levels.length ? p.levels : [defaultLevel()];
}

export function multiLevel(p) {
  return levelsOf(p).length > 1;
}

export function firstLevelId(p) {
  return levelsOf(p)[0].id;
}

export function activeLevelId(p) {
  const ls = levelsOf(p);
  return ls.some((l) => l.id === p?.activeLevel) ? p.activeLevel : ls[0].id;
}

export function levelById(p, id) {
  return levelsOf(p).find((l) => l.id === id) || null;
}

// The level an item sits on; anything from before levels is on the first.
export function levelIdOf(p, item) {
  const id = item?.levelId;
  return id && levelById(p, id) ? id : firstLevelId(p);
}

export function levelElevation(p, id) {
  return Number(levelById(p, id)?.elevationM) || 0;
}

export function levelName(p, id) {
  const l = levelById(p, id);
  if (!l) return "";
  return l.name || `Level ${levelsOf(p).indexOf(l)}`;
}

export function nodeLevelId(p, nodeId, nodesById = null) {
  const n = nodesById ? nodesById.get(nodeId) : p.nodes.find((x) => x.id === nodeId);
  return levelIdOf(p, n);
}

// A duct whose two ends are on different levels: a riser between floors.
export function isLevelRiser(p, s, nodesById = null) {
  return nodeLevelId(p, s.a, nodesById) !== nodeLevelId(p, s.b, nodesById);
}

export function onLevel(p, item, levelId = activeLevelId(p)) {
  return levelIdOf(p, item) === levelId;
}

// The plan's view of one level: its nodes, units, terminals, rooms and tape
// measures, and the ducts with both ends on it. The arrays are new, the
// items are the project's own, so editing an item edits the project — but
// anything new must be pushed onto the project, never onto this view.
export function levelView(p, levelId = activeLevelId(p)) {
  if (!multiLevel(p)) return p;
  const nodes = p.nodes.filter((n) => levelIdOf(p, n) === levelId);
  const ids = new Set(nodes.map((n) => n.id));
  return {
    ...p,
    nodes,
    segments: p.segments.filter((s) => ids.has(s.a) && ids.has(s.b)),
    components: (p.components || []).filter((c) => levelIdOf(p, c) === levelId),
    rooms: (p.rooms || []).filter((r) => levelIdOf(p, r) === levelId),
    measures: (p.measures || []).filter((m) => levelIdOf(p, m) === levelId),
  };
}

// Anything made without a level (a new node, unit, room…) goes on the level
// being worked on. Returns how many items it stamped.
export function stampLevels(p) {
  if (!Array.isArray(p?.levels) || !p.levels.length) return 0;
  const id = activeLevelId(p);
  let n = 0;
  for (const list of [p.nodes, p.components, p.rooms, p.measures]) {
    for (const it of list || []) {
      if (!it.levelId || !levelById(p, it.levelId)) { it.levelId = id; n++; }
    }
  }
  return n;
}

// The project as the calculations need it: heights absolute (level
// elevation + AFFL) and each duct's floor named after its level when none is
// typed. Copies only what changes; a single-level job comes back as is.
export function resolveLevels(p) {
  if (!multiLevel(p)) return p;
  const elev = new Map(levelsOf(p).map((l) => [l.id, Number(l.elevationM) || 0]));
  const nodes = p.nodes.map((n) => {
    const e = elev.get(levelIdOf(p, n)) || 0;
    return e ? { ...n, z: (Number(n.z) || 0) + e } : n;
  });
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  return {
    ...p,
    nodes,
    components: (p.components || []).map((c) => {
      const e = elev.get(levelIdOf(p, c)) || 0;
      return e ? { ...c, heightM: (Number(c.heightM) || 0) + e } : c;
    }),
    segments: p.segments.map((s) => (s.floor ? s : { ...s, floor: levelName(p, levelIdOf(p, byId.get(s.a))) })),
  };
}
