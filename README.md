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
- **Duct tracing** — draw connected supply and extract runs with branches / tees.
- **Components** — AHUs, centrifugal / axial / EC plug fans, supply & extract
  diffusers/grilles/valves/louvres, fire dampers, VCDs, attenuators, plenums,
  heaters and filters. Every parameter is editable and you can add custom
  parameters or custom outlets.
- **Automatic sizing** — round/spiral and rectangular ducts sized to the nearest
  DW144 standard size, by equal-friction (target Pa/m) or velocity method, with
  per-role velocity caps (main / branch / run-out).
- **Pressure & velocity** — per-segment velocity, friction gradient and pressure
  drop; min/max velocity; **index run** and total **system static pressure (ESP)**
  for supply and extract, DW144 pressure class, and fan-duty margin.
- **Schedules** — full duct schedule per system, CSV export, and JSON project
  save / load (auto-saved to the browser).

## Engineering basis

- Duct friction: Darcy–Weisbach with the Colebrook–White friction factor
  (Swamee–Jain explicit form); rectangular ducts use the Huebscher circular
  equivalent diameter. See `src/standards/sizing.js`.
- Standard sizes, pressure/velocity classes and leakage: `src/standards/dw144.js`.
- Network solve (flow accumulation, index run, ESP): `src/calc/network.js`.

> These calculations follow standard published methods and sensible defaults;
> always verify against project-specific manufacturer data before construction.

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
| `src/ui/` | Canvas editor, side panels, modals |
| `src/standards/` | DW144 data, sizing engine, fittings, component library |
| `src/calc/network.js` | System solver (flows, index run, static pressure) |
| `test/` | Node unit tests for the calculation core |

## Cloud Agent environment

`.cursor/environment.json` serves the app on port `8000` and runs no build step.
