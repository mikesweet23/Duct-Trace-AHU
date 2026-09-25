// Help is a list, not a manual — the same approach as Pipe Trace. Each tip is
// written as "I want to…" or "The … will not…", with the tools it belongs to
// so the pane can light the ones for the tool that is armed. The start page
// shows the same list. Add a tip when a question comes up twice.

export const HELP_SECTIONS = [
  { id: "start", label: "Getting started" },
  { id: "place", label: "Units and terminals" },
  { id: "trace", label: "Tracing the ducts" },
  { id: "size", label: "Sizes, pressure and output" },
];

export const HELP = [
  { sec: "start", tools: ["select"], t: "I have a drawing to trace",
    b: "<b>Open drawing</b> takes a PDF (its first page) or an image, or drop the file on the board. The scale is asked for straight away — nothing can be placed until it is set." },
  { sec: "start", tools: ["scale"], t: "I need to set or reset the scale",
    b: "<b>Scale</b> <kbd>S</kbd>: click two points a known distance apart and type the real figure in metres. Use the longest dimension on the sheet — a grid line or a bay is ideal." },
  { sec: "start", tools: ["select"], t: "I have no drawing yet — just a concept",
    b: "<b>Concept</b> opens a faint metre grid instead of a sheet. Place the unit and terminals, trace the ducts, then type the <b>installed length</b> on each run in the inspector, because there is nothing to measure." },
  { sec: "start", tools: ["select"], t: "I want to keep my work or send it to someone",
    b: "<b>Save</b> <kbd>Ctrl</kbd>+<kbd>S</kbd> writes a <span class=\"mono\">Duct Trace - … .json</span> file with the drawing in it; <b>Open</b> reads one back. The take-off is also kept in this browser and comes back on the next visit." },
  { sec: "start", tools: ["tape"], t: "I want to measure something without drawing a duct",
    b: "<b>Tape</b> <kbd>M</kbd> is a ruler: click along the route, double-click or <kbd>Enter</kbd> to keep it. Plan metres only — no rise, not on the schedule, not in 3D." },
  { sec: "start", tools: ["room"], t: "I want the room airflows to balance",
    b: "<b>Room</b> <kbd>R</kbd>: click the corners, then set supply and extract targets in the inspector. Terminals inside the outline are added up against those targets." },

  { sec: "place", tools: ["ahu", "hrv"], t: "I want to put the AHU or heat recovery unit down",
    b: "<b>AHU</b> <kbd>A</kbd> or <b>HRV</b> <kbd>E</kbd>, then click. The building side is on the right — supply (SUP) and extract (ETA); the outside is on the left — fresh air in (ODA) and exhaust out (EHA). Turn it with the handle above the box." },
  { sec: "place", tools: ["ahu", "hrv", "duct"], t: "I need fresh air in and stale air out, not just supply and extract",
    b: "An AHU or HRV serving both sides has <b>four connections</b>: <b>SUP</b> supply and <b>ETA</b> extract on the building side, <b>ODA</b> fresh air in and <b>EHA</b> exhaust out on the outside. In <b>Trace</b> pick <b>Fresh air in</b> or <b>Exhaust out</b> and start on that ring. <b>Connections</b> in the inspector moves them round the casing." },
  { sec: "place", tools: ["terminal"], t: "I want an intake louvre or an exhaust louvre / cowl",
    b: "<b>Terminal</b> → <i>Outside</i>: fresh-air intake louvre, roof intake, exhaust louvre, roof cowl. Leave the flow at 0 and it takes the unit's own airflow — supply for fresh air, extract for exhaust — shared if there are several." },
  { sec: "size", tools: ["select"], t: "Does the fan's static include the fresh air and exhaust ducts?",
    b: "Yes. The supply fan pushes fresh air and supply in series and the extract fan pulls extract and exhaust, so each fan's static is the index run on both sides of it. The schedule shows <i>fan … of … Pa, both sides</i>, and Check flags a shortfall." },
  { sec: "place", tools: ["hrv"], t: "I need the heat recovery figures",
    b: "Pick the HRV and set the exchanger type, temperature efficiency, SFP and winter design. The inspector gives the supply temperature after recovery, the heat recovered and the fan power. They go on the PDF." },
  { sec: "place", tools: ["terminal"], t: "I want to add diffusers and grilles",
    b: "<b>Terminal</b> <kbd>G</kbd> opens the list. Pick one and click the plan. Set its design flow in the inspector. <kbd>Ctrl</kbd>+<kbd>D</kbd> duplicates the picked terminal with its size, height and flow." },
  { sec: "place", tools: ["inline"], t: "I want a fire damper, VCD or attenuator on a duct",
    b: "<b>In-line</b> <kbd>I</kbd>, pick the device and click on the duct. The run is cut there and the device sits on it, so its loss is on that path." },
  { sec: "place", tools: ["fan"], t: "The system is a fan, not an AHU",
    b: "<b>Fan</b> <kbd>F</kbd> — centrifugal, axial or EC plug. A fan serves the system that is armed (Supply or Extract) when it is placed; change it in the inspector." },
  { sec: "place", tools: ["select"], t: "The box is not the size of the real unit",
    b: "Every unit has a real width and depth in metres. Pick it and drag a corner, or type the size in the inspector. Deleting a unit deletes only the unit — the ducts stay." },

  { sec: "trace", tools: ["duct"], t: "I want to draw a duct",
    b: "<b>Trace</b> <kbd>T</kbd> asks which airstream: <b>Supply</b>, <b>Extract</b>, <b>Fresh air in</b> or <b>Exhaust out</b>. Start on the ring of a unit, click each corner, and finish on the ring of a terminal — that click joins and drops the pencil. Double-click, <kbd>Enter</kbd> or <b>Finish</b> stops in mid-air." },
  { sec: "trace", tools: ["duct"], t: "I want to branch off a duct I have already drawn",
    b: "There is no T-piece tool. With Trace armed, hover the duct and a dot appears on it — click the dot to start (or finish) there. The tee is cut exactly on the duct. Only ducts of the system you are tracing show a dot, so supply and extract cannot be joined by accident." },
  { sec: "trace", tools: ["duct"], t: "The corner will not go where I want it",
    b: "Corners pull to 90° and 45°. Hold <kbd>Alt</kbd> for one free angle, or press <kbd>O</kbd> (or untick <b>Square up</b>) to turn the lock off. The angle and length of the leg show in the hint." },
  { sec: "trace", tools: ["duct"], t: "I need a riser or a drop",
    b: "Change <b>Height</b> in the hint (or <kbd>[</kbd> <kbd>]</kbd> for 0.1 m) and click the same point again. A riser is a marker on the plan and a vertical in <b>3D check</b>." },
  { sec: "trace", tools: ["duct", "select"], t: "A duct says “not fed”",
    b: "It is not on a path from a unit to a terminal. Usually a run was finished beside a unit instead of on its ring. <b>Check</b> lists every one with a Show button." },
  { sec: "trace", tools: ["select"], t: "The sketch length is not the real length",
    b: "Pick the duct and type the installed length (e.g. <b>12.5 m</b>) in the inspector. Pressure, the index run and the take-off use it; the drawing does not move." },
  { sec: "trace", tools: ["pan", "select", "duct"], t: "I want to move around the drawing",
    b: "Drag empty paper to pan in any tool, or hold <kbd>Space</kbd>. The wheel zooms toward the cursor; double-click empty paper zooms in there (<kbd>Shift</kbd> zooms out). On an iPad, pinch to zoom." },

  { sec: "size", tools: ["select"], t: "I want the sizes and the static pressure",
    b: "Ducts size themselves as you trace, to DW144 / EN 1506 / EN 1505 at the method and velocities in <b>Duct &amp; basis</b>. <b>Schedule</b> lists every duct, the index run and the ESP per system." },
  { sec: "size", tools: ["select"], t: "I want to change sizing method, velocities or construction",
    b: "<b>Duct &amp; basis</b>: equal friction or velocity, target Pa/m, CIBSE velocity bands per role, spiral / square / rectangular, air temperatures, default heights and the fabrication rules." },
  { sec: "size", tools: ["select"], t: "I want a fabrication take-off",
    b: "<b>Schedule → Fabrication</b> generates the physical model — straights, bends, tees, reducers, joints — and <b>Take-off</b> gives the bill of materials, as CSV, Excel or PDF." },
  { sec: "size", tools: ["select"], t: "I want a report",
    b: "<b>PDF</b> builds the report with the plan, a 3D view, each system, the index run, the plant and the fittings." },
  { sec: "size", tools: ["select"], t: "The flow is in the wrong unit",
    b: "Click <b>Flow unit</b> on the status strip, or the switch in <b>Duct &amp; basis</b>. Flow is stored as l/s whatever is shown (1 l/s = 3.6 m³/h)." },
];

export const STEPS = [
  { t: "Load the drawing — or start a concept", b: "A PDF (first page) or an image of the layout. No drawing yet? <b>Concept</b> gives a metre grid to lay out on." },
  { t: "Set the scale — before anything else", b: "Two points a known distance apart, and the real figure. Every length and every size comes off it." },
  { t: "Place the unit", b: "<b>AHU</b> or <b>HRV</b> for a supply and extract unit, or a <b>Fan</b>. Supply leaves the right-hand side, extract the left." },
  { t: "Place the terminals and their flows", b: "Diffusers, grilles and extract valves from <b>Terminal</b>. Type each design flow. Rooms are optional, for a balance check." },
  { t: "Trace supply, extract, fresh air and exhaust", b: "<b>Trace</b>, choose the airstream, start on the unit's ring for it (SUP, ETA, ODA or EHA), click the corners, finish on each terminal's ring. Branch off a duct by clicking the dot that appears on it. Change <b>Height</b> and click the same point for a riser." },
  { t: "Put the dampers and attenuators on", b: "<b>In-line</b>, then click on the duct." },
  { t: "Check, then read the sizes", b: "<b>Check</b> finds anything not joined. <b>Schedule</b> gives the sizes, velocities, the index run and the static pressure; <b>3D check</b> shows the heights." },
  { t: "Report and take-off", b: "<b>PDF</b> for the report; <b>Schedule → Fabrication / Take-off</b> for the physical model and the bill of materials; <b>Save</b> for the file." },
];

export function helpMatches(tip, q) {
  if (!q) return true;
  const hay = (tip.t + " " + tip.b).toLowerCase().replace(/<[^>]+>/g, "");
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}
