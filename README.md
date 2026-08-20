# Duct Trace AHU

A static web project scaffold for air handling unit (AHU) duct tracing.

## Project layout

| File | Purpose |
| --- | --- |
| `index.html` | Landing page markup |
| `styles.css` | Page styling |
| `app.js` | Client-side interactivity |

## Local development

The site is plain static HTML/CSS/JS, so no build step or dependencies are
required. Serve the folder with any static file server. Python 3 (bundled with
the dev image) works with no extra install:

```bash
python3 -m http.server 8000 --bind 0.0.0.0
```

Then open http://localhost:8000/.

## Cloud Agent environment

This repository ships a Cloud Agent environment (`.cursor/environment.json`)
that automatically serves the site on port `8000` in a persistent `web`
terminal. No install step is needed because the project has no dependencies.
