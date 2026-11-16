#!/usr/bin/env node
// What `node inventory_export.js <file> <out>` prints and writes for each committed fixture, kept in fixtures/cli-golden/
// so a refactor of the exporter (tools/convert.js split) can prove its output did not change.
//
//   node cli_golden.js           check: the CLI's output today is byte-identical to the committed files
//   node cli_golden.js --write   rewrite them (only after an intended output change)
//
// Two things differ from run to run and are replaced before comparing: exportedAt (the time of the run) and the
// temporary folder the output goes to.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const FIXTURES = path.join(__dirname, "fixtures");
const GOLDEN = path.join(FIXTURES, "cli-golden");
const CASES = [
  { name: "example-v3", files: { "KutzInventory.lua": "example-KutzInventory.lua" }, args: [] },
  { name: "example-v2", files: { "KutzInventory.lua": "example-KutzInventory.lua" }, args: ["--format", "2"] },
  { name: "export-check-v3", files: { "KutzInventory.lua": "export-check/KutzInventory.lua", "KutzUI.lua": "export-check/KutzUI.lua" }, args: [] },
  { name: "export-check-v2", files: { "KutzInventory.lua": "export-check/KutzInventory.lua", "KutzUI.lua": "export-check/KutzUI.lua" },
    args: ["--format", "2"] },
];
const OUTPUTS = ["stdout.txt", "inventory.json", "auction-scans.json"];

function normalize(text, dir) {
  return text.split(dir).join("<dir>").split("<dir>\\").join("<dir>/").replace(/"exportedAt": "[^"]*"/g, '"exportedAt": "<exportedAt>"');
}

// -> { "stdout.txt": ..., "inventory.json": ..., "auction-scans.json": ... } for one case
function runCase(c) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kutz-golden-"));
  try {
    for (const [to, from] of Object.entries(c.files)) fs.copyFileSync(path.join(FIXTURES, from), path.join(dir, to));
    const out = path.join(dir, "inventory.json");
    const r = spawnSync(process.execPath, [path.join(__dirname, "inventory_export.js"), path.join(dir, "KutzInventory.lua"), out, ...c.args],
      { encoding: "utf8", env: { ...process.env, WOW_IMPORT_TOKEN: "", WOW_IMPORT_URL: "" } });
    if (r.status !== 0) throw new Error(`${c.name}: the exporter failed:\n${r.stdout}${r.stderr}`);
    return {
      "stdout.txt": normalize(r.stdout + r.stderr, dir),
      "inventory.json": normalize(fs.readFileSync(out, "utf8"), dir),
      "auction-scans.json": normalize(fs.readFileSync(path.join(dir, "auction-scans.json"), "utf8"), dir),
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// -> a list of problems (empty when every output matches)
function checkGolden() {
  const problems = [];
  for (const c of CASES) {
    const got = runCase(c);
    for (const name of OUTPUTS) {
      const file = path.join(GOLDEN, c.name, name);
      const want = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
      if (want !== got[name]) problems.push(`${c.name}/${name} differs from the committed output`);
    }
  }
  return problems;
}

if (require.main === module) {
  if (process.argv.includes("--write")) {
    for (const c of CASES) {
      const got = runCase(c);
      fs.mkdirSync(path.join(GOLDEN, c.name), { recursive: true });
      for (const name of OUTPUTS) fs.writeFileSync(path.join(GOLDEN, c.name, name), got[name]);
      console.log(`Wrote ${path.join(GOLDEN, c.name)}`);
    }
  } else {
    const problems = checkGolden();
    for (const p of problems) console.log("FAIL " + p);
    if (!problems.length) console.log(`OK   exporter output for ${CASES.length} fixture runs is byte-identical to fixtures/cli-golden`);
    process.exit(problems.length ? 1 : 0);
  }
}
module.exports = { CASES, runCase, checkGolden };
