#!/usr/bin/env node
// Checks exports against the schemas in ../schema (JSON Schema 2020-12, via ajv).
//
//   node tools/validate_export.js [file ...]      (default: export/inventory.json and export/auction-scans.json)
//
// Picks the schema from the document: an inventory (1.x -> inventory-export.v1.schema.json,
// 2.x -> inventory-export.schema.json, 3.x -> inventory-export.v3.schema.json), an auction scan (auction-scan.schema.json), or an array of auction scans
// (auction-scans.json). Exit code 0 = every file is valid. Prints at most 20 problems per file.
"use strict";
const fs = require("fs");
const path = require("path");
const Ajv2020 = require("ajv/dist/2020");
const addFormats = require("ajv-formats");

const SCHEMA_DIR = path.join(__dirname, "..", "schema");
const FILES = {
  inventory1: "inventory-export.v1.schema.json",
  inventory2: "inventory-export.schema.json",
  inventory3: "inventory-export.v3.schema.json",
  auction1: "auction-scan.schema.json",
};

const compiled = {};
function validator(kind) {
  if (!compiled[kind]) {
    const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true, multipleOfPrecision: 8 });
    addFormats(ajv);
    compiled[kind] = ajv.compile(JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, FILES[kind]), "utf8")));
  }
  return compiled[kind];
}
const major = (v) => (typeof v === "string" && /^\d+\./.test(v) ? Number(v.split(".")[0]) : null);

function check(kind, data, prefix = "") {
  const v = validator(kind);
  if (v(data)) return [];
  return v.errors.map((e) => `${prefix}${e.instancePath || "/"}: ${e.message}${e.params && e.params.additionalProperty ? " (" + e.params.additionalProperty + ")" : ""}`);
}

// an inventory export, 1.x, 2.x or 3.x (a missing schemaVersion is an exporter older than the schema: 1.0.0)
function validateExport(data) {
  const m = data && data.schemaVersion === undefined ? 1 : major(data && data.schemaVersion);
  if (m === 1) return check("inventory1", data);
  if (m === 2) return check("inventory2", data);
  if (m === 3) return check("inventory3", data);
  return [`/schemaVersion: no schema for inventory version ${JSON.stringify(data && data.schemaVersion)}`];
}
function validateAuctionScan(doc) {
  if (major(doc && doc.schemaVersion) !== 1) return [`/schemaVersion: no schema for auction-scan version ${JSON.stringify(doc && doc.schemaVersion)}`];
  return check("auction1", doc);
}
function validateAny(data) {
  if (Array.isArray(data)) return data.flatMap((d, i) => validateAuctionScan(d).map((p) => `[${i}]${p}`));
  if (data && typeof data === "object" && "house" in data && "items" in data) return validateAuctionScan(data);
  return validateExport(data);
}

if (require.main === module) {
  const files = process.argv.slice(2);
  if (!files.length) {
    for (const f of ["inventory.json", "auction-scans.json"]) {
      const p = path.join(__dirname, "..", "export", f);
      if (fs.existsSync(p)) files.push(p);
    }
  }
  let bad = 0;
  for (const f of files) {
    const problems = validateAny(JSON.parse(fs.readFileSync(f, "utf8")));
    if (!problems.length) { console.log(`OK   ${f} matches its schema`); continue; }
    bad++;
    console.error(`FAIL ${f}: ${problems.length} problem(s)`);
    for (const p of problems.slice(0, 20)) console.error("  " + p);
  }
  process.exit(bad ? 1 : 0);
}
module.exports = { validateExport, validateAuctionScan, validateAny, SCHEMA_DIR };
