# Duct Trace AHU

A browser-based **commercial / industrial ductwork tracing and HVAC duct-sizing
tool** for supply and extract systems, working to **DW144 / BESA** standard duct
sizes and **CIBSE** sizing guidance. It runs entirely client-side from one self-contained
`index.html` — on GitHub Pages or straight off a hard disk.

## How it looks and works

Duct Trace is laid out and driven the same way as adi's **Pipe Trace**
(`mikesweet23/Alternative-pipe-sizer`, `trace.html`), with a dark blue
identity of its own so it is obvious which one you are in:

- **Top bar** — Open drawing, Concept, Duct & basis, How to use, ? Help,
  Undo / Redo, then Check, 3D check, Schedule, PDF, New, Save, Open.
- **Tool rail** down the left — Select `V`, Pan `H`, Scale `S`, Tape `M`,
  Room `R`, AHU `A`, HRV `E`, Fan `F`, Terminal `G`, In-line `I`, Trace `T`.
- **Start board** when nothing is loaded — choose a drawing, start a concept
  or open the worked example, with every tip listed underneath.
- **Hint card** docked top-right while a tool is armed, with *Square up*, the
  live angle and length, the **Height** box and *Finish*. × hides the tip and
  leaves the tool armed.
- **Status strip** bottom-left (scale, terminals, flow unit, each system's
  flow and ESP, corners, lengths, Check) and **zoom** bottom-right.
- **Inspector** on the right opens when something is picked.
- **Schedule drawer** from the bottom: systems & ducts, fabrication model,
  take-off. **3D check** lays over the plan with Iso / Front / Side / Plan.
- **Duct & basis** slides in from the right: project name, sizing method,
  velocities, construction, air, tracing, heights, fabrication, insulation.

## Drawings

**Open drawing** takes a **PDF** (its first page, rendered with pdf.js) or an
image, or drop the file on the board. A drawing without a scale stops at a
locked *Set the scale* dialog — nothing can be placed or traced until two
points and a real dimension are given. Replacing the sheet under an existing
take-off asks whether the scale still holds. **Concept** works on a metre grid
with no drawing; type the installed length on each run.

## Tracing

- **Trace** `T` asks **Supply** or **Extract**. Start on a unit's ring, click
  each corner, and finish on a terminal's ring — that click joins and drops
  the pencil. Double-click, `Enter` or *Finish* stops in mid-air; `Esc` ends.
- **Branch off a run** by hovering it: a dot appears on the duct; click it.
  The tee is cut exactly on the duct. Only runs of the system being traced
  show a dot, so supply and extract cannot be joined by accident. There is no
  T-piece tool.
- Corners lock to 90° and 45°. `Alt` frees one corner; `O` turns the lock off.
- Change **Height** (or `[` `]`) and click the same point again for a riser.
- Drag empty paper to pan in any tool, `Space`-drag, or the middle button.
  Wheel zooms to the cursor; double-click empty paper zooms in there. On an
  iPad, tap to trace and pinch to zoom.
- **In-line** devices (fire damper, VCD, attenuator, plenum, heater, filter)
  clicked onto a duct sit on that duct.

### What was wrong with tracing before

1. The tool was ES modules loaded by `index.html`. Opened from a hard disk
   (`file://`) the browser refuses module scripts, so nothing ran at all.
   `index.html` is now a single self-contained file (see *Build*).
2. Clicking onto an existing duct to branch did not join it: the click either
   pulled to a far end or dropped a loose node on top of the duct that looked
   joined and was not, so the branch read *no flow*. It now cuts a tee on the
   duct.
3. The canvas had no `touch-action`, so on a tablet a drag scrolled the page
   instead of tracing.

## Four airstreams: supply, extract, fresh air, exhaust

An AHU or HRV serving both sides has **four connections**, named to
BS EN 16798-3 and drawn on the casing:

| Code | Airstream | Colour | Runs |
| --- | --- | --- | --- |
| **SUP** | Supply air | blue | unit → rooms |
| **ETA** | Extract air | orange | rooms → unit |
| **ODA** | Outdoor (fresh) air | green | outside → unit |
| **EHA** | Exhaust air | brown | unit → outside |

The building side is on the right (SUP, ETA), the outside on the left (ODA,
EHA), each airstream straight through the box; **Connections** in the
inspector can put supply right, extract left, fresh air top and exhaust
bottom instead. A unit drawn before this keeps its supply and extract where
they were and gains fresh air and exhaust top and bottom.

**Trace** asks which of the four to draw. Outside terminals — fresh-air
intake louvre, roof intake, exhaust louvre, roof cowl — left at 0 l/s take
the unit's own airflow (supply for fresh air, extract for exhaust), shared if
there are several. The supply fan pushes ODA + SUP in series and the extract
fan pulls ETA + EHA, so each fan's static is the index run on **both sides**
of it; the schedule shows it and Check flags a shortfall. Fresh-air and
exhaust temperatures are in Duct & basis. Code: `src/systems.js`,
`PORT_LAYOUTS` in `src/layout.js`, `pairFanSides()` in
`src/calc/network.js`.

## Units

- **AHU** — supply and extract in one box, or supply-only / extract-only.
- **HRV — heat recovery unit (MVHR)** — a balanced supply + extract unit with
  the same four connections as an AHU. Carries the exchanger type, temperature efficiency, SFP, summer
  bypass, frost protection and filters; the inspector gives the supply
  temperature after recovery, the heat recovered and the fan power, and they
  go on the PDF. The duct sizes come from the flows and available static,
  exactly as for an AHU.
- **Fans** — centrifugal, axial, EC plug, serving the system that is armed.
- **Terminals** — diffusers, supply and extract grilles, extract valves,
  louvres.

## What it calculates

- **Automatic sizing** — spiral, square and rectangular to DW144 / EN 1506 /
  EN 1505, by equal friction or velocity, with per-role min and max
  velocities (main / riser / branch / run-out) from CIBSE Guide B.
- **Pressure & velocity** — per-duct velocity, Pa/m and pressure drop; the
  **index run** and **system static (ESP)** per supply / extract system;
  DW144 pressure class; fan-duty margin; supply vs extract mismatch on a
  two-port unit.
- **Engineering length override** — type `12.5 m` on a duct.
- **Physical model and take-off** — straights, bends, tees, reducers,
  joints, supports; CSV, Excel and PDF schedules.
- **Rooms** — supply / extract targets balanced against the terminals inside.
- **Check** — unconnected terminals and units, runs that stop in mid-air,
  ducts that carry no air, missing flows, static shortfalls, duty mismatches.
- **PDF report** — plan, 3D, systems, index run, plant (HRV figures
  included) and fittings.

## Engineering basis

- Duct friction: Darcy–Weisbach with the Colebrook–White friction factor
  (Swamee–Jain explicit form); rectangular ducts use the Huebscher circular
  equivalent diameter. See `src/standards/sizing.js`.
- Standard sizes, pressure/velocity classes, leakage and CIBSE velocity bands:
  `src/standards/dw144.js`.
- Network solve (flow accumulation, index run, ESP): `src/calc/network.js`.

> These calculations follow standard published methods and sensible defaults;
> always verify against project-specific manufacturer data before construction.

## Two-stage workflow

1. **Engineering design** — sketch centre lines, assign airflows, auto-size,
   review velocity and pressure. Do not model every coupler while designing.
2. Enter **actual lengths** where the sketch is not to scale.
3. **Lock** the engineering design when it is ready.
4. **Generate physical model** — spiral or rectangular pieces, joints,
   fittings and riser drops, with persistent refs (`D001`, `F001`, `B001`).
5. Adjust unusual fittings; the visual model updates resistance and takeoff.
6. **Generate takeoff** and export fabrication or procurement schedules.

Changes flow Stage 1 → physical generator → fabrication model → takeoff.
Engineering centreline length (pressure) is kept distinct from fabricated
material length (cut pieces + fittings).

## Files and build

`index.html` is **the whole tool in one file** — HTML, CSS, JavaScript and the
logo inline — so it runs from GitHub Pages *and* straight off a hard disk,
the same as Pipe Trace. The only thing it fetches is pdf.js, to read PDF
drawings; without a connection images still load and a PDF asks for a PNG.

It is **built**, not edited:

```bash
node tools/build.mjs          # writes index.html from dev.html + styles.css + src/
node tools/build.mjs --check  # fails if index.html is out of date
```

The source is ES modules under `src/` (the tests import them) and
`dev.html` runs them directly from a local server while developing:

```bash
python3 -m http.server 8000 --bind 0.0.0.0
# http://localhost:8000/dev.html  — the source, live
# http://localhost:8000/          — the built file
```

`test/build.test.mjs` fails if `index.html` is not the current build, so a
change to `src/` without a rebuild does not get past `npm test`.

## Tests

```bash
npm test        # == node --test
```

`test/trace.test.mjs` covers branching off a run onto the pipe, joining a
terminal dropping the pencil, supply and extract not joining, the corner lock,
risers, in-line devices landing on a duct, and the HRV as a two-port plant.

## Project layout

| Path | Purpose |
| --- | --- |
| `index.html` | **Built** single-file tool — what Pages serves and what opens from disk |
| `dev.html`, `styles.css` | App shell and styling (source for the build) |
| `tools/build.mjs` | Dependency-free bundler that writes `index.html` |
| `assets/adi-logo.png` | Logo, inlined by the build |
| `src/main.js` | Wiring: rail, palettes, hint, status, drawings, Check, files |
| `src/state.js` | Project model, persistence, undo, demo seed |
| `src/ui/canvas.js` | Plan editor: tracing, snapping, placing, drawing |
| `src/ui/help.js` | The "What do I do when…" tips and How to use steps |
| `src/ui/` | Inspector panels, 3D check, modals, fabrication / take-off panels |
| `src/snap.js`, `src/layout.js` | Nearby-only snap, branch dots and equipment footprints |
| `src/standards/` | DW144 data, sizing engine, fittings, component library (AHU, HRV…) |
| `src/calc/network.js` | System solver (flows, index run, static pressure) |
| `src/fab/` | Physical model generator, takeoff, change review, export |
| `test/` | Node unit tests |

## Cloud Agent environment

`.cursor/environment.json` serves the folder on port `8000` and runs no build
step; run `node tools/build.mjs` after changing anything under `src/`.
