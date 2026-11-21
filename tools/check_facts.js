// Offline check for what KutzInventory 1.21.0 added: KutzInventory/Facts.lua (item facts read once per item, kills
// per day, the time-per-frame counter), KutzInventory/Saved.lua (unlearned recipes saved once per account file,
// statistics per day) and the vendor list of KutzInventory/Prices.lua. The cases are in check_facts.lua.
//
// It also proves the recipe migration loses nothing, on a whole saved file: the file is loaded as Lua, migrated by the
// addon's own code, checked there (every list record for record, and undone = the original), written back, and the
// exporter must give the same export for the file before and after, in formats 2 and 3.
//   node check_facts.js                      a made-up saved file from before 1.21.0
//   KUTZ_REAL_SAVES=<folder> node check_facts.js   every *.lua in that folder as well (your own saved files; only
//                                                 sizes and counts are printed, never their contents)
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require("fengari");
const convert = require("./convert");

const addon = path.resolve(process.argv[2] || path.join(__dirname, "..", "KutzInventory"));
const read = (dir, f) => fs.readFileSync(path.join(dir, f), "utf8").replace(/\r\n/g, "\n");

const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
lua.lua_newtable(L);
for (const name of ["Facts", "Saved", "Prices"]) {
  lua.lua_pushstring(L, to_luastring(read(addon, name + ".lua")));
  lua.lua_setfield(L, -2, to_luastring(name));
}
lua.lua_setglobal(L, to_luastring("SOURCE"));
function fail(what) {
  console.error("FAIL " + what + ": " + to_jsstring(lua.lua_tostring(L, -1)));
  process.exit(1);
}
if (lauxlib.luaL_loadbuffer(L, to_luastring(read(__dirname, "check_facts.lua")), null, to_luastring("@check_facts.lua")) !== 0) fail("check_facts.lua");
if (lua.lua_pcall(L, 0, 0, 0) !== 0) fail("check_facts.lua");

// ---------------------------------------------------------------------------
// The recipe migration on whole files
// ---------------------------------------------------------------------------
function prove(text) {
  lua.lua_getglobal(L, to_luastring("PROVE"));
  lua.lua_pushstring(L, to_luastring(text));
  if (lua.lua_pcall(L, 1, 6, 0) !== 0) throw new Error(to_jsstring(lua.lua_tostring(L, -1)));
  const out = {
    before: to_jsstring(lua.lua_tostring(L, -6)), after: to_jsstring(lua.lua_tostring(L, -5)),
    lists: lua.lua_tointeger(L, -4), moved: lua.lua_tointeger(L, -3), records: lua.lua_tointeger(L, -2), shared: lua.lua_tointeger(L, -1),
  };
  lua.lua_pop(L, 6);
  return out;
}
// Everything the exporter makes of a saved file, without the time it was made. Object keys are written in name order
// (the order of a JSON object's keys says nothing, and "unlearned" is put together later in the migrated shape);
// lists keep their order.
function sorted(v) {
  if (Array.isArray(v)) return v.map(sorted);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])]));
  return v;
}
function exported(text, format) {
  const all = convert.convertSavedVariables([text], { format });
  delete all.inventory.exportedAt;
  return JSON.stringify(sorted(JSON.parse(JSON.stringify(all))));
}
const bytes = (s) => Buffer.byteLength(s, "utf8");
function proveFile(text) {
  const p = prove(text);
  const sizes = { file: bytes(text), before: bytes(p.before), after: bytes(p.after) };
  for (const format of [2, 3]) {
    const original = exported(text, format);
    const before = exported(p.before, format);
    const after = exported(p.after, format);
    if (before !== original) throw new Error(`format ${format}: the file written back gives another export than the file itself (the check's own writer is wrong)`);
    if (after !== before) throw new Error(`format ${format}: the export differs after the migration`);
    if (format === 3) {
      const inventory = JSON.stringify(JSON.parse(after).inventory);
      sizes.export = bytes(inventory);
      sizes.gzip = zlib.gzipSync(inventory).length;
    }
  }
  return { ...p, ...sizes };
}

// A made-up account file as 1.20.x saved it, in this client's format: three characters, two of them with the same
// profession (most records the same, one differing, one only the second has), strings with quotes, a backslash and
// a line break, a decimal number, a list the addon did not write (left alone), and the vendor and AH prices that the
// crafting report reads the recipes against.
function oldFile() {
  const reagent = (id, n, name, extra = []) => ["{", `["itemID"] = ${id},`, `["quantity"] = ${n},`, `["name"] = "${name}",`, ...extra, "},"];
  const rec = (id, name, extra = []) => ["{", `["recipeID"] = ${id},`, `["name"] = "${name}",`, `["outputItemID"] = ${id + 1000},`, `["source"] = "trainer",`,
    `["makesMin"] = 1,`, `["makesMax"] = 1,`, `["reagents"] = {`, ...reagent(2589, 2, "Linen Cloth"), ...reagent(2320, 1, "Coarse Thread", [`["required"] = true,`]), "},", ...extra, "},"];
  const learned = (id) => ["{", `["recipeID"] = ${id},`, `["name"] = "Known ${id}",`, `["outputItemID"] = ${id + 1000},`, `["difficulty"] = 2,`,
    `["link"] = "|cffffffff|Henchant:${id}|h[Known ${id}]|h|r",`, `["reagents"] = {`, ...reagent(2589, 1, "Linen Cloth"), "},", "},"];
  const book = (id, skill, known, unlearned) => ["{", `["professionID"] = ${id},`, `["skill"] = ${skill},`, `["maxSkill"] = 150,`, `["updated"] = 1762819200,`,
    `["recipes"] = {`, ...known.flatMap(learned), "},", `["unlearned"] = {`, ...unlearned.flat(), "},", "},"];
  const shared = [rec(3914, "Brown Linen Pants"), rec(3915, "Brown Linen Shirt"), rec(2385, "Brown Linen Vest"),
                  rec(8465, 'Simple \\"Quoted\\" Dress \\\\ with a backslash'), rec(2387, "Two lines\\nof name", [`["cooldown"] = 0.5,`])];
  const char = (name, level, recipes) => [`["${name}-Made Up Realm"] = {`, `["name"] = "${name}",`, `["realm"] = "Made Up Realm",`, `["level"] = ${level},`,
    `["class"] = "Mage",`, `["classFile"] = "MAGE",`, `["faction"] = "Alliance",`, `["money"] = 12345,`, `["lastSeen"] = 1762819200,`,
    `["bags"] = {`, "},", `["recipes"] = {`, ...recipes, "},", "},"];
  const lines = ["", "KutzInventoryDB = {", `["chars"] = {`,
    ...char("Madeupone", 24, [`["Tailoring"] = `, ...book(197, 60, [2963, 2386], shared), `["Cooking"] = `, ...book(185, 10, [2538], [])]),
    ...char("Madeuptwo", 31, [`["Tailoring"] = `, ...book(197, 75, [2963],
      [shared[1], shared[0], rec(2385, "Brown Linen Vest", [`["source"] = "drop",`]), shared[3], shared[4], rec(2389, "Red Linen Robe"), shared[0]])]),
    ...char("Madeupthree", 8, [`["Mining"] = {`, `["professionID"] = 186,`, `["unlearned"] = {`, ...rec(2657, "Smelt Copper"), `"not a record",`, "},", "},"]),
    "},",
    `["prices"] = {`, `["vendor"] = {`, `[2320] = {`, `["price"] = 10,`, `["vendor"] = "Made Up Vendor",`, `["t"] = 1762819200,`, "},", "},",
    `["sell"] = {`, `[2589] = 13,`, `[4914] = 25,`, "},", `["ah"] = {`, "},", "},",
    `["version"] = 1,`, "}", ""];
  // a book written as `["Tailoring"] = ` then `{`: joined into one line the way the client writes it
  return lines.join("\r\n").replace(/ = \r\n\{/g, " = {");
}

try {
  const made = proveFile(oldFile());
  if (made.lists !== 4 || made.moved !== 3 || made.records !== 14 || made.shared !== 6) {
    throw new Error("the made-up file: " + JSON.stringify({ lists: made.lists, moved: made.moved, records: made.records, shared: made.shared }));
  }
  if (!(made.after < made.before)) throw new Error("the made-up file did not get smaller");
  console.log(`OK   recipe migration on a made-up 1.20 saved file: ${made.moved} of ${made.lists} lists moved (one is not the addon's own and is left), ${made.records} records ` +
              `saved as ${made.shared} shared; undone it is the original; exports 2.x and 3.x identical before and after; ${made.before} -> ${made.after} bytes`);
} catch (e) {
  console.error("FAIL recipe migration: " + e.message);
  process.exit(1);
}

const real = process.env.KUTZ_REAL_SAVES;
if (real) {
  const files = fs.readdirSync(real).filter((f) => /\.lua$/i.test(f)).sort();
  if (!files.length) { console.error("FAIL KUTZ_REAL_SAVES has no .lua file"); process.exit(1); }
  files.forEach((f, n) => {
    try {
      const r = proveFile(fs.readFileSync(path.join(real, f), "utf8"));
      console.log(`OK   recipe migration on your saved file ${n + 1} of ${files.length}: ${r.moved} of ${r.lists} lists moved, ${r.records} records saved as ${r.shared} shared; ` +
                  `undone it is the original; exports 2.x and 3.x identical before and after. File ${r.file} bytes; written back by this check ${r.before}; ` +
                  `after the migration ${r.after} (${r.after - r.before}); 3.x export ${r.export} bytes, ${r.gzip} gzip`);
    } catch (e) {
      // the message is this check's own words: nothing from the file
      console.error(`FAIL recipe migration on your saved file ${n + 1} of ${files.length}: ` + e.message);
      process.exit(1);
    }
  });
} else {
  console.log("     (set KUTZ_REAL_SAVES to a folder with your own saved KutzInventory.lua files to prove the migration on them too)");
}
