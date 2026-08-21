# Duct Trace AHU

A browser-based **commercial / industrial ductwork tracing and HVAC duct-sizing
tool** for supply and extract systems, working to **DW144 / BESA** standard duct
sizes and **CIBSE** sizing guidance. It runs entirely client-side (no backend,
no build step) as ES modules on a static server.

## What it does

- **Concept mode** — sketch indicative layouts and airflows with no drawing.
- **Drawing mode** — upload a floor-plan image, **calibrate the scale** from a
  known dimension, and trace ductwork over it.
- **Rooms & airflows** — outline rooms and set supply / extract targets, with a
  live balance against the terminals placed inside them.
- **Duct tracing** — draw connected supply and extract runs. Ducts snap to
  nearby outlets and AHUs only (they will not yank a close parallel run).
  Cut a **T-piece** (J) to branch off a run already traced. Outlets can be
  **duplicated** (Ctrl+D) and both outlets and AHUs can be **resized** on the
  plan. An AHU can be **supply, extract, or both**.
- **Heights & risers** — every point has a height (m AFFL). Changing height
  and clicking the same point drops a **riser** that does not draw as a run
  on the plan. Open **3D** to review the whole layout, including risers.
- **Actual ducts** — once a run is sized it is drawn as a circular or
  rectangular body at the real DW144 size, not just a centreline.
- **Engineering length override** — each section between two nodes is its
  own object. Type `12.5 m` on a duct to set the real installed length
  while leaving the sketch short. Pressure loss, index run, insulation and
  takeoff all use the engineering length, not the graphical length.
- **Physical simulator (Stage 2)** — **Generate model** turns the centreline
  into fabricated straight lengths, joints, elbows, tees, reducers,
  square-to-round pieces, boots and riser drops. Stage 1 stays the
  calculation source; Stage 2 is the physical interpretation of the same
  network. Engineering edits can update the model, with a review step so
  manual fitting choices are not destroyed.
- **Takeoff** — bill of materials from the physical pieces (standard + cut
  lengths, fittings, joints, insulation, estimated supports), filterable by
  system / AHU / floor / zone / size, exportable as CSV, Excel, PDF,
  procurement and fabrication schedules. Each item carries costing fields
  for a later estimating module.
- **Components** — AHUs, centrifugal / axial / EC plug fans, supply & extract
  diffusers/grilles/valves/louvres, fire dampers, VCDs, attenuators, plenums,
  heaters and filters. Every parameter is editable and you can add custom
  parameters or custom outlets.
- **Construction per project, branch or length** — set a project default
  (spiral / square / rectangular). Then override one length, or apply the
  change to a whole downstream branch, without rewriting the rest of the
  system. Typical use: rectangular trunk, spiral legs.
- **Delete one item** — removing a damper, outlet or AHU deletes only that
  item. The duct run it sits on stays.
- **Automatic sizing** — spiral/circular, **square** and rectangular ducts sized
  to the full DW144 / EN 1506 / EN 1505 range, by equal-friction (target Pa/m)
  or velocity method, with per-role **min and max** velocities (main / **riser** /
  branch / run-out) from CIBSE Guide B Tables 2.16–2.18, capped by DW144 class.
- **AHU duty** — a combined AHU can take **different supply and extract flow**
  and **different available static (Pa)**. A warning is raised if plant duty
  does not match the connected inlets and outlets.
- **Flow units** — toggle **l/s ↔ m³/h** everywhere (AHUs, inlets, outlets,
  rooms, schedules, status). Internal calc stays SI (m³/s).
- **Pressure & velocity** — per-segment velocity, friction gradient and pressure
  drop; min/max velocity; **index run** and total **system static pressure (ESP)**
  for each supply / extract system, DW144 pressure class, and fan-duty margin.
- **Schedules & PDF** — duct schedule per system, CSV, JSON save / load, and a
  **PDF report** with AHU/fan details, fittings, each system listed separately,
  plus plan and 3D layout figures.

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

## Local development

No dependencies or build step. Serve the folder with any static server:

```bash
python3 -m http.server 8000 --bind 0.0.0.0
# open http://localhost:8000/
```

## Tests

Calculation-core unit tests (no dependencies, Node's built-in runner):

```bash
npm test        # == node --test
```

## Project layout

| Path | Purpose |
| --- | --- |
| `index.html`, `styles.css` | App shell and styling |
| `src/main.js` | Wiring: palette, toolbar, compute-on-change loop |
| `src/state.js` | Project model, persistence, undo, demo seed |
| `src/ui/` | Canvas editor, 3D review, side panels, modals |
| `src/snap.js`, `src/layout.js` | Nearby-only snap (ac-trace discipline) and equipment footprints |
| `src/standards/` | DW144 data, sizing engine, fittings, component library |
| `src/calc/network.js` | System solver (flows, index run, static pressure) |
| `src/fab/` | Physical model generator, takeoff, change review, export |
| `test/` | Node unit tests for the calculation core |

## Cloud Agent environment

`.cursor/environment.json` serves the app on port `8000` and runs no build step.
