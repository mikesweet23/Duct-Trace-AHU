// Turning the drawing, the same way Pipe Trace does it.
//
// A sheet arrives sideways more often than not, and a scan is rarely square.
// The rotation is baked into the image and every traced point is turned with
// it, rather than the sheet being spun on screen: snapping, hit testing,
// labels that stay square to the page, 3D and the report then carry on in
// drawing coordinates knowing nothing about it.
//
// Rotation preserves distance, so the scale (px per metre) is untouched and
// the calibration line turns with the rest, still lying on the dimension it
// was taken from. Every turn is re-rendered from the image as it was loaded
// (held in memory), never from the last rotated copy, so straightening a
// scan a degree at a time does not soften it. Corners that open up at an
// angle off square are filled white.

// Size of the canvas that holds a W × H image turned by `deg`.
export function rotatedSize(w, h, deg) {
  const r = (deg * Math.PI) / 180;
  const c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r));
  return { w: Math.round(w * c + h * s), h: Math.round(w * s + h * c) };
}

export function normDeg(deg) {
  let d = Number(deg) || 0;
  d = ((d % 360) + 360) % 360;
  if (d > 180) d -= 360;
  return Math.round(d * 1000) / 1000;
}

// Turn a point by `deg` (clockwise on screen, as y points down) about `from`,
// landing relative to `to`.
export function turnPoint(p, deg, from, to) {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r), s = Math.sin(r);
  const dx = p.x - from.x, dy = p.y - from.y;
  return { x: to.x + dx * c - dy * s, y: to.y + dx * s + dy * c };
}

// Turns every traced thing in the project by `delta` degrees, from a sheet
// centred on `from` to one centred on `to`. Placed items that hang off a run
// (none yet) would need nothing: only points move.
export function turnTakeoff(project, delta, from, to) {
  const t = (p) => {
    const q = turnPoint(p, delta, from, to);
    p.x = q.x;
    p.y = q.y;
  };
  for (const n of project.nodes || []) t(n);
  for (const c of project.components || []) {
    t(c);
    c.rot = ((((Number(c.rot) || 0) + delta) % 360) + 360) % 360;
  }
  for (const r of project.rooms || []) for (const p of r.points || []) t(p);
  for (const m of project.measures || []) for (const p of m.pts || []) t(p);
  const cal = project.scale?.calib;
  if (cal?.a && cal?.b) { t(cal.a); t(cal.b); }
}
