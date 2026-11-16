#!/usr/bin/env node
// The committed examples in schema/examples/, all from the made-up fixtures/example-KutzInventory.lua:
//   KutzInventory.example.lua          that data written the way the game writes SavedVariables (["key"] = value, tabs,
//                                      "-- [n]" after list entries): the file a player drops on cr0m's upload box
//   inventory-export.v3.example.json   what the exporter makes from KutzInventory.example.lua (the default format)
//   inventory-export.v2.example.json   the same with --format 2
// Browser consumers can use these fixtures to check compatibility with convert.js.
//
//   node examples.js           check that the examples match what the exporter writes today, and are valid
//   node examples.js --write   rewrite them (after an intended format change)
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { buildAll, parseSavedVariables, plain } = require("./convert");
const { validateExport } = require("./validate_export");

const EXPORTED_AT = "2025-11-12T00:01:00.000Z";   // pinned so the files only change when the format does
const FIXTURE = path.join(__dirname, "fixtures", "example-KutzInventory.lua");
const OUT = path.join(__dirname, "..", "schema", "examples");
const LUA = "KutzInventory.example.lua";
const FILES = { 2: "inventory-export.v2.example.json", 3: "inventory-export.v3.example.json" };

// A parsed SavedVariables value (Maps for tables) written back the way WoW writes it.
function luaString(s) {
  return '"' + s.replace(/[\\"\n\r]/g, (c) => ({ "\\": "\\\\", '"': '\\"', "\n": "\\n", "\r": "\\r" })[c]) + '"';
}
function luaValue(v, indent) {
  if (v instanceof Map) {
    const keys = [...v.keys()];
    const isList = keys.every((k, n) => k === n + 1);
    const inner = indent + "\t";
    const lines = keys.map((k, n) => isList
      ? `${inner}${luaValue(v.get(k), inner)}, -- [${n + 1}]`
      : `${inner}[${typeof k === "string" ? luaString(k) : String(k)}] = ${luaValue(v.get(k), inner)},`);
    return ["{", ...lines, indent + "}"].join("\n");
  }
  if (typeof v === "string") return luaString(v);
  if (v === null) return "nil";
  return String(v);
}
function savedVariablesFile() {
  const parsed = parseSavedVariables(fs.readFileSync(FIXTURE, "utf8"));
  return "-- Made-up example (nobody's real characters), written the way WoW writes SavedVariables\\KutzInventory.lua.\n"
    + "-- Generated from tools/fixtures/example-KutzInventory.lua by `node tools/examples.js --write`.\n\n"
    + Object.entries(parsed).map(([name, v]) => `${name} = ${luaValue(v, "")}\n`).join("");
}

function build(luaText, format) {
  const parsed = parseSavedVariables(luaText);
  const observations = parsed.KutzInventoryObsDB ? [plain(parsed.KutzInventoryObsDB)] : [];
  const inventory = buildAll([plain(parsed.KutzInventoryDB)], null, { format, observations }).inventory;
  return JSON.stringify({ ...inventory, exportedAt: EXPORTED_AT }, null, 1) + "\n";
}

const write = process.argv.includes("--write");
const read = (name) => (fs.existsSync(path.join(OUT, name)) ? fs.readFileSync(path.join(OUT, name), "utf8").replace(/\r\n/g, "\n") : null);
let bad = 0;
const sizes = {};
const lua = savedVariablesFile();
// the .lua must say the same as the fixture it comes from
const roundTrip = (text) => { const p = parseSavedVariables(text); return JSON.stringify([plain(p.KutzInventoryDB), plain(p.KutzInventoryObsDB)]); };
if (roundTrip(lua) !== roundTrip(fs.readFileSync(FIXTURE, "utf8"))) { bad++; console.log(`FAIL ${LUA} does not read back as the fixture`); }
if (write) { fs.writeFileSync(path.join(OUT, LUA), lua); console.log(`Wrote ${path.join(OUT, LUA)}`); }
else if (read(LUA) !== lua) { bad++; console.log(`FAIL ${LUA} is out of date: run node examples.js --write and commit it`); }
for (const [format, name] of Object.entries(FILES)) {
  const text = build(lua, Number(format));
  const problems = validateExport(JSON.parse(text));
  if (problems.length) { bad++; console.log(`FAIL ${name} does not match its schema:\n  ${problems.slice(0, 10).join("\n  ")}`); }
  const file = path.join(OUT, name);
  sizes[format] = { bytes: Buffer.byteLength(text), gzip: zlib.gzipSync(text).length };
  if (write) { fs.writeFileSync(file, text); console.log(`Wrote ${file}`); continue; }
  if (read(name) !== text) { bad++; console.log(`FAIL ${name} is out of date: run node examples.js --write and commit it`); }
}
console.log(`Example sizes: 2.x ${sizes[2].bytes} bytes (${sizes[2].gzip} gzip), 3.x ${sizes[3].bytes} bytes (${sizes[3].gzip} gzip).`);
if (!bad) console.log("OK   inventory examples (and the KutzInventory.lua they come from) match the exporter and their schemas");
process.exit(bad ? 1 : 0);
