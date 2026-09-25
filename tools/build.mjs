// Builds index.html: the whole tool in one file, the same way Pipe Trace is
// shipped. The source stays as ES modules under src/ (so the tests can import
// them), and dev.html runs them directly from a local server. index.html is
// what GitHub Pages serves and what opens straight off a hard disk — a page
// loading <script type="module"> does nothing at all from file://, which is
// how the tracing looked broken when the tool was opened on site.
//
//   node tools/build.mjs          write index.html
//   node tools/build.mjs --check  exit 1 if index.html is out of date
//
// No dependencies: imports are resolved by hand. Every module becomes a
// function returning its exports, evaluated in dependency order.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IMPORT_RE = /^import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["'];?[ \t]*$/gm;

function readModule(abs) {
  return readFileSync(abs, "utf8").replace(/\r\n/g, "\n");
}

function transform(abs) {
  const src = readModule(abs);
  const deps = [];
  let code = src.replace(IMPORT_RE, (_, names, spec) => {
    const dep = resolve(dirname(abs), spec);
    deps.push(dep);
    const parts = names.split(",").map((n) => n.trim()).filter(Boolean).map((n) => {
      const m = n.split(/\s+as\s+/);
      return m.length === 2 ? `${m[0].trim()}: ${m[1].trim()}` : m[0];
    });
    return `const { ${parts.join(", ")} } = __m[${JSON.stringify(key(dep))}];`;
  });
  if (/^\s*import\s/m.test(code)) throw new Error(`${key(abs)}: an import the bundler does not understand`);
  const exported = [];
  code = code.replace(/^export\s+(async\s+function|function|class|const|let)\s+([A-Za-z_$][\w$]*)/gm, (_, kw, name) => {
    exported.push(name);
    return `${kw} ${name}`;
  });
  code = code.replace(/^export\s*\{([^}]*)\};?[ \t]*$/gm, (_, names) => {
    for (const n of names.split(",").map((x) => x.trim()).filter(Boolean)) {
      const m = n.split(/\s+as\s+/);
      exported.push(m.length === 2 ? `${m[1].trim()}: ${m[0].trim()}` : m[0]);
    }
    return "";
  });
  if (/^\s*export\s/m.test(code)) throw new Error(`${key(abs)}: an export the bundler does not understand`);
  return { deps, code, exported };
}

function key(abs) {
  return relative(ROOT, abs).split("\\").join("/");
}

export function bundle(entry = join(ROOT, "src/main.js")) {
  const mods = new Map();
  const order = [];
  const visiting = new Set();
  const visit = (abs) => {
    if (mods.has(abs)) return;
    if (visiting.has(abs)) throw new Error(`circular import through ${key(abs)}`);
    visiting.add(abs);
    const m = transform(abs);
    for (const d of m.deps) visit(d);
    visiting.delete(abs);
    mods.set(abs, m);
    order.push(abs);
  };
  visit(entry);
  const body = order.map((abs) => {
    const m = mods.get(abs);
    return `// ---- ${key(abs)} ----\n__m[${JSON.stringify(key(abs))}] = (() => {\n${m.code.trimEnd()}\nreturn { ${m.exported.join(", ")} };\n})();`;
  }).join("\n\n");
  return `(() => {\n"use strict";\nconst __m = {};\n${body}\n})();`;
}

export function buildHtml() {
  let html = readModule(join(ROOT, "dev.html"));
  const css = readModule(join(ROOT, "styles.css"));
  const logo = "data:image/png;base64," + readFileSync(join(ROOT, "assets/adi-logo.png")).toString("base64");
  const js = bundle().replace(/<\/script/gi, "<\\/script");
  const swap = (from, to) => {
    if (!html.includes(from)) throw new Error(`dev.html no longer contains ${from}`);
    html = html.split(from).join(to);
  };
  swap('<link rel="stylesheet" href="styles.css">', `<style>\n${css}</style>`);
  swap('"assets/adi-logo.png"', JSON.stringify(logo));
  // a function replacement, so "$&" and friends in the code are left alone
  swap('<script type="module" src="src/main.js"></script>', "<!--app-->");
  html = html.replace("<!--app-->", () => `<script>\n${js}\n</script>`);
  html = html.replace("<head>", () => "<head>\n<!-- Built by tools/build.mjs from dev.html, styles.css and src/. Do not edit by hand: change the source and run `node tools/build.mjs`. -->");
  return html;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const out = join(ROOT, "index.html");
  const html = buildHtml();
  if (process.argv.includes("--check")) {
    const cur = readModule(out);
    if (cur !== html) {
      console.error("index.html is out of date — run: node tools/build.mjs");
      process.exit(1);
    }
    console.log("index.html is up to date");
  } else {
    writeFileSync(out, html);
    console.log(`wrote index.html (${Math.round(html.length / 1024)} KB)`);
  }
}
