// index.html is the whole tool in one file, built from dev.html, styles.css
// and src/. It has to be the current build, and it has to open from a hard
// disk: no ES module script, nothing local fetched at run time.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildHtml } from "../tools/build.mjs";

const built = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("index.html is the current build of the source", () => {
  assert.ok(buildHtml() === built, "index.html is out of date — run: node tools/build.mjs");
});

test("index.html opens from file:// — no module scripts, no local files", () => {
  assert.ok(!/type=["']module["']/.test(built));
  assert.ok(!/src=["'](?!https:|data:)[^"']+["']/.test(built), "every src is inline or https");
  assert.ok(!/href=["'](?!https:|data:|#)[^"']+\.css["']/.test(built));
});

test("the shell carries the Pipe Trace furniture", () => {
  for (const id of ["rail", "board", "hint", "tpal", "cpal", "status", "zoomer", "drawer", "three", "inspector", "helpPane", "bOpenDwg", "bConcept", "bCheck", "b3d", "bSched", "bPdf", "bSave", "bLoad"]) {
    assert.ok(built.includes(`id="${id}"`), `missing #${id}`);
  }
  assert.ok(built.includes("pdf.min.js"), "PDF drawings are read with pdf.js");
  assert.ok(built.includes("accept=\"application/pdf"), "Open drawing accepts a PDF");
});
