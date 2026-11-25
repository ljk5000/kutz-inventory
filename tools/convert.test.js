"use strict";
// tools/convert.js: the pure converter that both the exporter and cr0m's upload page run.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { spawnSync } = require("child_process");
const { checkGolden } = require("./cli_golden");
const convert = require("./convert");

test("Legacy tree values survive both formats, sanitised and separate per character", () => {
  const { validateExport } = require("./validate_export");
  const db = { chars: { First: { name: "First", legacyTree: {
    currency: { available: 12, spent: 4, max: 16, gold: 99 },
    trees: { 1187: { spentInTree: 4, nodes: { 100: 2, 101: 0, 102: -1, 103: "3", 104: Infinity, bad: 2 }, extra: "gone" },
      1188: { spentInTree: 0, nodes: {} }, 1189: { spentInTree: 0, nodes: {} }, bad: { spentInTree: 1, nodes: {} } },
    choices: { 100: 201, 101: "202", bad: 203 }, extra: "gone",
  } }, Second: { name: "Second" } } };
  const expected = { currency: { available: 12, spent: 4, max: 16 }, trees: {
    1187: { spentInTree: 4, nodes: { 100: 2 } }, 1188: { spentInTree: 0, nodes: {} }, 1189: { spentInTree: 0, nodes: {} },
  }, choices: { 100: 201 } };
  for (const format of [2, 3]) {
    const doc = JSON.parse(JSON.stringify(convert.build([db], null, { format })));
    assert.deepEqual(doc.characters[0].legacyTree, expected);
    assert.ok(!("legacyTree" in doc.characters[1]));
    // Use full schema-valid example characters to check the extension's contract.
    const example = JSON.parse(fs.readFileSync(path.join(__dirname, `../schema/examples/inventory-export.v${format}.example.json`)));
    example.characters[0].legacyTree = expected;
    assert.deepEqual(validateExport(example), []);
    for (const bad of ["2", -1, 0, 1.5]) {
      const broken = structuredClone(example);
      broken.characters[0].legacyTree.trees[1187].nodes[100] = bad;
      assert.ok(validateExport(broken).length, "schema refuses invalid rank " + bad);
    }
    const broken = structuredClone(example);
    broken.characters[0].legacyTree.choices.bad = 5;
    assert.ok(validateExport(broken).length, "schema refuses non-digit keys");
  }
  for (const bad of [null, [], {}, { currency: { available: "12", spent: 0, max: 16 }, trees: { 1187: { spentInTree: 0, nodes: {} } } }]) {
    assert.ok(!convert.build([{ chars: { A: { name: "A", legacyTree: bad } } }]).characters[0].legacyTree);
  }
});

const SOURCE = fs.readFileSync(path.join(__dirname, "convert.js"), "utf8");
const EXAMPLES = path.join(__dirname, "..", "schema", "examples");
const LUA = fs.readFileSync(path.join(EXAMPLES, "KutzInventory.example.lua"), "utf8");
const V3 = fs.readFileSync(path.join(EXAMPLES, "inventory-export.v3.example.json"), "utf8").replace(/\r\n/g, "\n");
const pinned = (inventory) => JSON.stringify({ ...inventory, exportedAt: JSON.parse(V3).exportedAt }, null, 1) + "\n";

// A page's view of the file: plain JavaScript, no Node globals at all.
function loadInSandbox() {
  const sandbox = {};
  vm.runInNewContext(SOURCE, sandbox, { filename: "convert.js" });
  return sandbox;
}

test("convert.js loads as a browser script with no Node globals and defines only KutzConvert", () => {
  const sandbox = loadInSandbox();
  assert.deepEqual(Object.keys(sandbox), ["KutzConvert"]);
  for (const name of ["require", "module", "process", "Buffer", "fetch", "__dirname"]) {
    assert.equal(vm.runInNewContext(`typeof ${name}`, sandbox), "undefined", name + " leaked into the sandbox");
  }
  const k = sandbox.KutzConvert;
  for (const fn of ["parseSavedVariables", "buildAll", "toFormat3", "auctionScans", "convertSavedVariables", "plain"]) {
    assert.equal(typeof k[fn], "function", fn);
  }
  assert.equal(k.SCHEMA_VERSION_3, "3.16.0");
  // and it does the whole job in there
  assert.equal(pinned(k.convertSavedVariables([LUA]).inventory), V3);
});

test("the source names no Node API (fs, path, process, require, fetch, Buffer)", () => {
  const code = SOURCE.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  for (const name of ["fs", "path", "process", "require", "fetch", "Buffer"]) {
    assert.doesNotMatch(code, new RegExp(`\\b${name}\\b\\s*[.(]`), name);
  }
});

test("the exporter's CLI output for every fixture is byte-identical to before the split", () => {
  assert.deepEqual(checkGolden(), []);
});

test("schema/examples/KutzInventory.example.lua converts to inventory-export.v3.example.json exactly", () => {
  assert.equal(pinned(convert.convertSavedVariables([LUA]).inventory), V3);
  // ...and the CLI says the same about it
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kutz-convert-"));
  try {
    const out = path.join(dir, "inventory.json");
    const r = spawnSync(process.execPath, [path.join(__dirname, "inventory_export.js"), path.join(EXAMPLES, "KutzInventory.example.lua"), out],
      { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(pinned(JSON.parse(fs.readFileSync(out, "utf8"))), V3);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a file nested past the limit fails with a clear error, not a stack overflow", () => {
  const nest = (d) => "KutzInventoryDB = " + "{".repeat(d) + "}".repeat(d);
  assert.doesNotThrow(() => convert.parseSavedVariables(nest(convert.MAX_TABLE_DEPTH)));
  assert.throws(() => convert.parseSavedVariables(nest(convert.MAX_TABLE_DEPTH + 1)), /^Error: table nested too deep at character \d+$/);
  assert.throws(() => convert.parseSavedVariables(nest(1e6)), /table nested too deep at character \d+/);
  const deepKey = "KutzInventoryDB = {" + "[{".repeat(200) + "1" + "}] = 1".repeat(200) + "}";
  assert.throws(() => convert.parseSavedVariables(deepKey), /table nested too deep/);
  // the CLI reports it the same way
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kutz-convert-"));
  try {
    fs.writeFileSync(path.join(dir, "KutzInventory.lua"), nest(5000));
    const r = spawnSync(process.execPath, [path.join(__dirname, "inventory_export.js"), path.join(dir, "KutzInventory.lua"),
      path.join(dir, "out.json")], { encoding: "utf8" });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /table nested too deep at character \d+/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the reader never runs the file: code is a parse error", () => {
  for (const src of ['os.execute("calc")', "KutzInventoryDB = loadstring('x')()", "KutzInventoryDB = { a = (function() end)() }"]) {
    assert.throws(() => convert.parseSavedVariables(src));
  }
});

// /kinv raid (inventory 3.1.0): KutzInventoryDB.raids -> raids[] = { string, events[] }
const RAID = "KR1.ABC234.409.1767225600.ABCDEFGHJKMN";
const raidFile = (raids) => "KutzInventoryDB = { chars = {}, raids = " + raids + " }";

test("raids: the example's raid is exported; one with no events is not; 2.x has no raids", () => {
  const v3 = convert.convertSavedVariables([LUA]).inventory;
  assert.deepEqual(v3.raids.map((r) => r.string), ["KR1.QX7K2M.409.1762891200.MZXW6YTBOI4A"]);
  assert.deepEqual(v3.raids[0].events.map((e) => e.kind),
    ["start", "roster", "encounter_start", "encounter_end", "roster", "loot", "loot", "end"]);
  assert.deepEqual(v3.raids[0].events[5], { t: "2025-11-11T20:08:00.000Z", kind: "loot", itemId: 16800,
    itemLink: "|cffa335ee|Hitem:16800::::::::60:::::|h[Arcanist Boots]|h|r", count: 1, looter: "Exampleraider-Example Realm" });
  const v2 = convert.convertSavedVariables([LUA], { format: 2 }).inventory;
  assert.ok(!("raids" in v2), "2.x must not change");
  assert.deepEqual(convert.convertSavedVariables(["KutzInventoryDB = { chars = {} }"]).inventory.raids, []);
});

test("raids: bad strings, unknown kinds and events missing what they need are left out; types are checked", () => {
  const raids = convert.convertSavedVariables([raidFile(`{
    A = { string = "KR1.ABC231.409.1767225600.ABCDEFGHJKMN", events = { { t = 1767225600, kind = "start" } } },
    B = { string = "kr1.abc234.409.1767225600.ABCDEFGHJKMN", events = { { t = 1767225600, kind = "start" } } },
    C = { string = "${RAID}", events = {
      { t = 1767225601, kind = "start", instanceId = 409, instanceName = "Molten Core", secret = "dropped", by = 5 },
      { t = 1767225602, kind = "teleport" },
      { kind = "start" },
      { t = 1767225603, kind = "encounter_end", encounterId = 663 },
      { t = 1767225604, kind = "encounter_end", encounterId = 663, success = false, groupSize = -1 },
      { t = 1767225605, kind = "loot", itemId = 16800, count = 2 },
      { t = 1767225606, kind = "loot", itemId = 16800, looter = "Bob-Example Realm", itemLink = "|Hitem:16800|h[X]|h" },
      { t = 1767225607, kind = "roster", members = { "Bob-Example Realm", 7, "" } },
      { t = 1767225608, kind = "roster" },
      { t = 1.5, kind = "end" },
    } },
    D = { string = "${RAID.replace("ABC234", "XYZ987")}", events = { { t = 1767225600, kind = "teleport" } } },
  }`)]).inventory.raids;
  assert.equal(raids.length, 1);
  assert.equal(raids[0].string, RAID);
  assert.deepEqual(raids[0].events, [
    { t: "2026-01-01T00:00:01.000Z", kind: "start", instanceId: 409, instanceName: "Molten Core" },
    { t: "2026-01-01T00:00:04.000Z", kind: "encounter_end", encounterId: 663, success: false },
    { t: "2026-01-01T00:00:06.000Z", kind: "loot", itemId: 16800, itemLink: "|Hitem:16800|h[X]|h", looter: "Bob-Example Realm" },
    { t: "2026-01-01T00:00:07.000Z", kind: "roster", members: ["Bob-Example Realm"] },
  ]);
});

test("raids: two account files tracking the same raid merge in time order, the same event once", () => {
  const a = raidFile(`{ ABC234 = { string = "${RAID}", events = {
    { t = 20, kind = "loot", itemId = 1, looter = "A-R" }, { t = 10, kind = "start", by = "A-R" } } } }`);
  const b = raidFile(`{ ABC234 = { string = "${RAID}", events = {
    { t = 15, kind = "start", by = "B-R" }, { t = 20, kind = "loot", itemId = 1, looter = "A-R" } } },
    OTHER1 = { string = "KR1.OTHER2.0.1700000000.ABCDEFGHJKMN", events = { { t = 5, kind = "end" } } } }`);
  const raids = convert.convertSavedVariables([a, b]).inventory.raids;
  assert.deepEqual(raids.map((r) => r.string), ["KR1.OTHER2.0.1700000000.ABCDEFGHJKMN", RAID], "oldest start first");
  assert.deepEqual(raids[1].events.map((e) => e.t.slice(17, 19) + e.kind + (e.by || "")), ["10startA-R", "15startB-R", "20loot"]);
});

test("a file without KutzInventoryDB is refused; several account files merge", () => {
  assert.throws(() => convert.convertSavedVariables(["OtherAddonDB = { x = 1 }"]), (e) => e.code === "not-kutz-inventory");
  assert.throws(() => convert.convertSavedVariables(["not lua at all"]));
  const other = 'KutzInventoryDB = { chars = { ["Other-Example Realm"] = { name = "Other", realm = "Example Realm", lastSeen = 1762000000 } } }';
  const both = convert.convertSavedVariables([LUA, other]).inventory;
  assert.deepEqual(both.characters.map((c) => c.key), ["Examplemage-Example Realm", "Examplewarrior-Example Realm", "Other-Example Realm"]);
  // the same character in two files: the newer lastSeen wins, as in the exporter
  const older = 'KutzInventoryDB = { chars = { ["Examplewarrior-Example Realm"] = { name = "Examplewarrior", realm = "Example Realm", level = 2, lastSeen = 1 } } }';
  assert.equal(convert.convertSavedVariables([older, LUA]).inventory.characters.find((c) => c.name === "Examplewarrior").level, 8);
});

// /kinv track drops on (inventory 3.2.0): KutzInventoryObsDB -> observations = { v: 1, addon, events[] }
const obsFile = (events, extra = "") =>
  `KutzInventoryDB = { chars = {} }\nKutzInventoryObsDB = { v = 1, on = true, addon = "1.8.0"${extra}, events = ${events} }`;
const WHO = `who = { level = 60, class = 4, faction = "Alliance" }`;

test("observations: the example's events are exported in the documented shape; the broken one is not; 2.x has none", () => {
  const obs = convert.convertSavedVariables([LUA]).inventory.observations;
  assert.equal(obs.v, 1); assert.equal(obs.addon, "1.23.0");
  assert.deepEqual(Object.keys(convert.convertSavedVariables([LUA]).inventory).slice(-2), ["raids", "observations"]);
  assert.deepEqual(obs.events.map((e) => e.id.slice(-2) + e.type + (e.act || "")),
    ["17loot", "18loot", "19loot", "20questaccept", "21questturnin", "22vendor", "23trainer", "24taxi", "25flight", "26gossip", "27read", "28line", "29tame", "30credit", "31loot", "32killrep", "33loot"]);
  assert.deepEqual(obs.events[0], { id: "k1f9c2-000017", t: 1762905600, b: "1.60.1.70888", type: "loot",
    src: { kind: "boss", npc: 11502, guid: "Creature-0-4170-409-1234-11502-000012ABCD", via: "slot" },
    where: { map: 409, uiMap: 232, itype: "raid", difficulty: 9 },
    who: { level: 60, class: 4, faction: "Alliance", name: "Exampleobserver", surname: "Examplefamily" },
    items: [{ id: 17076, n: 1, link: "|cffff8000|Hitem:17076|h[Bonereaver's Edge]|h|r" }, { id: 18264, n: 2 }] }, "a link for another id is dropped");
  assert.deepEqual(obs.events[1].items, [], "a coins-only corpse is an open with no items");
  assert.deepEqual(obs.events[4].rewards, { items: [{ id: 19019, n: 1 }], choose: [{ id: 19018, n: 1 }, { id: 19019, n: 1 }],
    choices: [19018, 19019], chose: 19019, money: 125, xp: 6600 });
  // 3.16.0: the offer window's rewards on the accept, a kill's reputation and a Disenchant's window
  assert.deepEqual(obs.events[3].rewards, { items: [],
    choose: [{ id: 19018, n: 1, link: "|cffa335ee|Hitem:19018|h[Made-up Amulet]|h|r" }, { id: 19019, n: 1, link: "|cffa335ee|Hitem:19019|h[Made-up Charm]|h|r" }],
    money: 125, xp: 6600, spells: [7322], skill: { line: 197, pts: 5 }, cur: [{ id: 4225, n: 1 }] });
  assert.deepEqual(obs.events[15], { id: "k1f9c2-000032", t: 1762906650, b: "1.60.1.70888", type: "killrep", npc: 2958, lv: 14, f: 72, d: 5,
    where: { map: 0, uiMap: 1429, x: 0.4219, y: 0.6784 }, who: { level: 14, class: 4, faction: "Alliance" } });
  assert.deepEqual(obs.events[16].src, { kind: "disenchant", item: 6560 });
  assert.deepEqual(obs.events[16].items, [{ id: 10940, n: 2, link: "|cffffffff|Hitem:10940|h[Strange Dust]|h|r" }]);
  assert.deepEqual(obs.events[5].items, [{ id: 19326, n: 1, link: "|cffa335ee|Hitem:19326|h[Made-up Cloak]|h|r", price: 0,
    cost: [{ item: 17010, n: 1 }], limited: null },
    { id: 4470, n: 1, price: 38, limited: 5 }]);
  assert.equal(obs.events[5].rx, 5);
  assert.deepEqual(obs.events[6], { id: "k1f9c2-000023", t: 1762906000, b: "1.60.1.70888", type: "trainer", npc: 5146, kind: "class", rx: 6,
    where: { map: 0, uiMap: 1453, x: 0.3812, y: 0.7907 }, who: { level: 20, class: 8, faction: "Alliance" },
    rows: [{ s: 7322, name: "Frostbolt", rank: "Rank 4", lv: 20, cost: 1800, st: "a" },
      { s: 8427, name: "Blizzard", rank: "Rank 2", lv: 28, needs: ["Blizzard"], cost: 4000, st: "u" },
      { s: 116, name: "Frostbolt", rank: "Rank 1", lv: 4, cost: 100, st: "k" },
      { name: "Made-up Ward", lv: 30, cost: 10, st: "a" }] });
  assert.deepEqual(obs.events[7], { id: "k1f9c2-000024", t: 1762906100, b: "1.60.1.70888", type: "taxi", npc: 352, node: 2, rx: 5,
    where: { map: 0, uiMap: 1453, x: 0.7081, y: 0.7254 }, who: { level: 20, class: 8, faction: "Alliance" },
    to: [{ node: 4, cost: 1050, hops: 2 }, { node: 5, cost: 270, hops: 1 }, { node: 6, cost: 1800, hops: 3 }] });
  assert.deepEqual(obs.events[8], { id: "k1f9c2-000025", t: 1762906300, b: "1.60.1.70888", type: "flight", from: 2, to: 5, sec: 181,
    who: { level: 20, class: 8, faction: "Alliance" } });
  assert.ok(!("observations" in convert.convertSavedVariables([LUA], { format: 2 }).inventory), "2.x must not change");
});

test("observations 3.9.0: trainer events keep only the documented fields; vendor rx and filtered", () => {
  const G = "Creature-0-4170-0-1234-5146-000012AAAD";
  const obs = convert.convertSavedVariables([obsFile(`{
    { id = "tttt-1", t = 100, type = "trainer", npc = 5146, kind = "class", rx = 6, guid = "${G}", money = 5, ${WHO},
      rows = { { s = 7322, name = "Frostbolt", rank = "Rank 4", lv = 20, cost = 1800, st = "a", icon = "x" },
               { s = 0, name = "Blizzard", rank = "${"r".repeat(41)}", lv = 0, skill = "Pet-1-2", skillReq = -1, cost = 4000, st = "u",
                 needs = { "A", "B", "|cffffffffC|r", "${G}", "D", "E", "F", "G", 7 } },
               { name = "${G}", cost = 1, st = "a" }, { name = "Red|r", cost = 1, st = "a" }, { name = "No Cost", st = "a" },
               { name = "Bad State", cost = 1, st = "used" }, { name = "Negative", cost = -1, st = "k" },
               { name = "${"n".repeat(121)}", cost = 1, st = "a" }, { name = "Line\\nBreak", cost = 1, st = "a" },
               { name = "Smelting", rank = "Apprentice", skill = "Mining", skillReq = 1, cost = 10, st = "k" } } },
    { id = "tttt-2", t = 101, type = "trainer", npc = 5146, kind = "pet", ${WHO}, rows = { { name = "Growl", cost = 0, st = "a" } } },
    { id = "tttt-3", t = 102, type = "trainer", kind = "class", ${WHO}, rows = { { name = "Growl", cost = 0, st = "a" } } },
    { id = "tttt-4", t = 103, type = "trainer", npc = 5146, kind = "profession", rx = 9, ${WHO}, rows = { { name = "No Cost", st = "a" } } },
    { id = "tttt-5", t = 104, type = "trainer", npc = 5146, kind = "profession", rx = 0, ${WHO},
      rows = { { name = "Smelting", cost = 10, st = "a" } } },
    { id = "tttt-6", t = 105, type = "vendor", npc = 12, rx = 4, filtered = true, ${WHO}, items = { { id = 4, price = 7 } } },
    { id = "tttt-7", t = 106, type = "vendor", npc = 12, rx = 8.5, filtered = "yes", ${WHO}, items = { { id = 4, price = 7 } } },
  }`)]).inventory.observations;
  assert.deepEqual(obs.events.map((e) => e.id), ["tttt-1", "tttt-5", "tttt-6", "tttt-7"], "bad kind, no npc, no usable row: left out");
  const [t, p, v, w] = obs.events;
  assert.deepEqual(t, { id: "tttt-1", t: 100, type: "trainer", npc: 5146, kind: "class", rx: 6, where: {},
    who: { level: 60, class: 4, faction: "Alliance" },
    rows: [{ s: 7322, name: "Frostbolt", rank: "Rank 4", lv: 20, cost: 1800, st: "a" },
      { name: "Blizzard", needs: ["A", "B", "D", "E", "F"], cost: 4000, st: "u" },
      { name: "Smelting", rank: "Apprentice", skill: "Mining", skillReq: 1, cost: 10, st: "k" }] });
  assert.ok(!("rx" in p), "rx only 1..8");
  assert.equal(v.rx, 4); assert.equal(v.filtered, true);
  assert.ok(!("rx" in w) && !("filtered" in w), "rx an integer, filtered only true");
  assert.ok(!/Creature-|money|icon/.test(JSON.stringify(obs)), "no GUID, money or unknown key");
  // at most 400 rows
  const many = Array.from({ length: 450 }, (_, i) => `{ name = "Spell ${i + 1}", cost = ${i}, st = "a" }`).join(",");
  const capped = convert.convertSavedVariables([obsFile(`{ { id = "tttt-8", t = 1, type = "trainer", npc = 1, kind = "class", rows = { ${many} } } }`)]);
  assert.equal(capped.inventory.observations.events[0].rows.length, 400);
  assert.equal(capped.inventory.observations.events[0].rows[399].name, "Spell 400");
});

// The size budget of one trainer event: a realistic class trainer's list of 60 services (spell id, name, rank, level,
// cost and state on each; a few with a required ability), as exported.
test("observations 3.9.0: one 60-row trainer event is a few kilobytes of JSON", () => {
  const spells = ["Frostbolt", "Fireball", "Arcane Missiles", "Frost Nova", "Blizzard", "Flamestrike", "Arcane Explosion",
    "Cone of Cold", "Fire Blast", "Arcane Intellect"];
  const rows = Array.from({ length: 60 }, (_, i) => {
    const rank = Math.floor(i / spells.length) + 1, lv = 4 + i;
    const needs = rank > 1 && i % 7 === 0 ? `, needs = { "${spells[i % spells.length]}" }` : "";
    return `{ s = ${10000 + i * 37}, name = "${spells[i % spells.length]}", rank = "Rank ${rank}", lv = ${lv}, cost = ${lv * lv * 9}` +
      `${needs}, st = "${i < 30 ? "k" : i < 40 ? "a" : "u"}" }`;
  }).join(",\n");
  const obs = convert.convertSavedVariables([obsFile(`{ { id = "k1f9c2-000099", t = 1762906000, b = "1.60.1.70888", type = "trainer",
    npc = 5146, kind = "class", rx = 6, where = { map = 0, uiMap = 1453, x = 0.3812, y = 0.7907 },
    who = { level = 60, class = 8, faction = "Alliance", name = "Exampleobserver", surname = "Examplefamily" }, rows = { ${rows} } } }`)])
    .inventory.observations;
  const bytes = Buffer.byteLength(JSON.stringify(obs.events[0]));
  assert.equal(obs.events[0].rows.length, 60);
  assert.ok(bytes > 4000 && bytes < 6500, "one 60-row trainer event: " + bytes + " bytes");
});

test("observations 3.12.0: gossip projects only valid subjects and safe prose", () => {
  const event = { id: "abc123-1", t: 100, type: "gossip", npc: 352, kind: "greeting", text: "Welcome, $N.", guid: "discard",
                  options: ["discard"] };
  const obs = (events) => convert.exportObservations([{ events }]);
  assert.deepEqual(obs([event]).events[0], {
    id: event.id, t: 100, type: "gossip", npc: 352, kind: "greeting", text: "Welcome, $N.", where: {}, who: {},
  });
  assert.equal(obs([{ ...event, npc: undefined, object: 12 }]).events[0].object, 12);
  for (const bad of [{ object: 12 }, { npc: 0 }, { kind: "option" }, { text: " " }, { text: "|unsafe" },
                     { text: "Player-1-25" }, { text: "x".repeat(4001) }]) assert.equal(obs([{ ...event, ...bad }]), null);
});

test("observations 3.12.0: read events omit unknown fields and reject unsafe pages", () => {
  const event = { id: "abc123-1", t: 100, type: "read", title: "Example Journal", page: 1, text: "A page for $N.",
                  last: true, material: "Parchment", guid: "discard" };
  const obs = (patch) => convert.exportObservations([{ events: [{ ...event, ...patch }] }]);
  assert.deepEqual(obs({}).events[0], { id: event.id, t: 100, type: "read", title: event.title, page: 1,
    last: true, material: "Parchment", text: event.text, where: {}, who: {} });
  assert.deepEqual(obs({ item: 2, last: false, material: "|unsafe" }).events[0],
    { id: event.id, t: 100, type: "read", item: 2, title: event.title, page: 1, text: event.text, where: {}, who: {} });
  for (const bad of [{ item: 2, object: 3 }, { page: 0 }, { title: "Item-0-1" }, { title: "x".repeat(201) },
                     { text: "x".repeat(8001) }, { creator: "Examplewriter" }, { creator: "" }, { mail: true }, { material: "Stationery" }]) {
    assert.equal(obs(bad), null);
  }
});

test("observations 3.12.0: line events retain safe fields only and reject malformed lines", () => {
  const event = { id: "abc123-1", t: 100, type: "line", npc: 352, kind: "emote", text: "%s waves to $N.",
                  sender: "Discard", guid: "discard", recipient: "Discard" };
  const obs = (patch) => convert.exportObservations([{ events: [{ ...event, ...patch }] }]);
  assert.deepEqual(obs({}).events[0], { id: event.id, t: 100, type: "line",
    npc: 352, kind: "emote", text: event.text, where: {}, who: {} });
  for (const bad of [{ npc: 0 }, { kind: "party" }, { text: "" }, { text: "é" }, { text: "Player-1-26" },
                     { text: "x".repeat(2001) }]) assert.equal(obs(bad), null);
});

test("observations 3.13.0: tame events keep the beast and the pet's facts; no creature id, no event", () => {
  const { validateExport } = require("./validate_export");
  const doc = convert.convertSavedVariables([LUA]).inventory;
  const where = { map: 0, uiMap: 1429, x: 0.4123, y: 0.6543 };
  const who = { level: 12, class: 3, faction: "Alliance", name: "Exampleobserver", surname: "Examplefamily" };
  const event = { id: "abc123-1", t: 100, b: "1.60.1.70888", type: "tame", npc: 3825, lv: 12, fam: 1, spd: 150, spdAura: true,
    spells: [{ s: 17253, name: "Bite", rank: "Rank 1" }, { s: 2649, name: "Growl" }], diet: ["Meat", "Fish"],
    loc: "enUS", guid: "Pet-0-4170-0-1234-3825-0100AABBCC", petName: "Discard", where, who };
  const obs = (patch) => convert.exportObservations([{ events: [{ ...event, ...patch }] }]);
  const good = obs({}).events[0];
  assert.deepEqual(good, { id: "abc123-1", t: 100, b: "1.60.1.70888", type: "tame", npc: 3825, lv: 12, fam: 1,
    spells: [{ s: 2649, name: "Growl" }, { s: 17253, name: "Bite", rank: "Rank 1" }], spd: 150, spdAura: true, diet: ["Fish", "Meat"],
    loc: "enUS", where, who });
  assert.ok(!/Pet-|Discard/.test(JSON.stringify(good)), "no pet GUID or name");
  const bytes = Buffer.byteLength(JSON.stringify(good));
  assert.ok(bytes < 450, "one tame event: " + bytes + " bytes");
  for (const bad of [{ npc: undefined }, { npc: 0 }, { npc: "3825" }, { npc: 1.5 }, { npc: 2147483648 }]) assert.equal(obs(bad), null);
  // each optional field that fails its check goes alone
  const odd = obs({ lv: 256, fam: "Pet-0-1-2", spd: 9, spdAura: "yes",
    spells: [null, { s: 0, name: "Bite" }, { s: 1, name: "|cffBad" }, { s: 2, name: "Ok", rank: "x".repeat(41) }, { s: 2, name: "Again" }, 7],
    diet: ["Meat", "Meat", "|x", "Creature-0-1-2", 5, "x".repeat(41)], loc: "en-US" }).events[0];
  assert.deepEqual(odd, { id: "abc123-1", t: 100, b: "1.60.1.70888", type: "tame", npc: 3825, spells: [{ s: 2, name: "Ok" }],
    diet: ["Meat"], where, who });
  const bare = obs({ lv: undefined, fam: "Wolf", spells: [], diet: [], spd: 2000, spdAura: false }).events[0];
  assert.deepEqual([bare.fam, bare.spells, bare.diet, bare.spd, bare.spdAura], ["Wolf", undefined, undefined, 2000, undefined]);
  const capped = obs({ spells: Array.from({ length: 30 }, (_, i) => ({ s: 100 - i, name: "S" + i })),
    diet: Array.from({ length: 10 }, (_, i) => "Food " + i) }).events[0];
  assert.deepEqual([capped.spells.length, capped.spells[0].s, capped.diet.length], [24, 71, 8]);
  // the schema: the exported event is valid; anything the exporter never writes is not
  const withEvent = (e) => ({ ...doc, observations: { v: 1, addon: "1.20.0", events: [e] } });
  assert.deepEqual(validateExport(withEvent(good)), []);
  assert.deepEqual(validateExport(withEvent(bare)), []);
  for (const patch of [{ npc: undefined }, { spdAura: false }, { spells: [] }, { spells: [{ s: 1 }] }, { diet: ["a", "a"] },
                       { guid: "Pet-0-4170-0-1234-3825-0100AABBCC" }, { lv: 0 }, { spd: 2001 }, { fam: "Creature-0-1-2" },
                       { loc: "english" }, { loc: "ENus" }]) {
    assert.ok(validateExport(withEvent({ ...good, ...patch })).length, "schema rejected " + JSON.stringify(patch));
  }
});

test("observations 3.13.0: credit events keep quest, objective, type, one id and how it was told; never progress", () => {
  const { validateExport } = require("./validate_export");
  const doc = convert.convertSavedVariables([LUA]).inventory;
  const where = { map: 0, uiMap: 1429, x: 0.4123, y: 0.6543 };
  const who = { level: 12, class: 4, faction: "Alliance", name: "Exampleobserver", surname: "Examplefamily" };
  const event = { id: "abc123-2", t: 100, b: "1.60.1.70888", type: "credit", quest: 33, i: 1, rows: 2, ot: "monster", npc: 6, by: "name",
    numFulfilled: 3, numRequired: 10, text: "Kobold Vermin slain: 3/10", guid: "Creature-0-4170-0-1234-6-0000AB0001", where, who };
  const obs = (patch) => convert.exportObservations([{ events: [{ ...event, ...patch }] }]);
  const good = obs({}).events[0];
  assert.deepEqual(good, { id: "abc123-2", t: 100, b: "1.60.1.70888", type: "credit", quest: 33, i: 1, rows: 2, ot: "monster", npc: 6,
    by: "name", where, who });
  const bytes = Buffer.byteLength(JSON.stringify(good));
  assert.ok(bytes < 300, "one credit event: " + bytes + " bytes");
  const item = obs({ ot: "item", npc: undefined, item: 750 }).events[0];
  const object = obs({ ot: "object", npc: undefined, object: 3719, i: 12, rows: 40 }).events[0];
  const sole = obs({ by: "sole" }).events[0];
  const old = obs({ rows: undefined }).events[0];   // a credit of an earlier development build: no rows
  assert.deepEqual([item.item, item.by, item.npc, object.object, object.i, object.rows, sole.by, old.rows, "rows" in old],
    [750, "name", undefined, 3719, 12, 40, "sole", undefined, false]);
  for (const bad of [{ quest: 0 }, { quest: "33" }, { i: 0 }, { i: 13 }, { i: 1.5 }, { ot: "event" }, { ot: "constructor" }, { ot: undefined },
                     { npc: undefined }, { npc: 0 }, { npc: undefined, item: 6 }, { item: 750 }, { object: 3 }, { by: "guess" },
                     { by: undefined }, { by: "count" }, { ot: "item", npc: undefined, item: 750, by: "sole" },
                     { ot: "object", npc: undefined, object: 3719, by: "sole" }, { rows: 0 }, { rows: 41 }, { rows: 1.5 }, { rows: "2" },
                     { i: 3, rows: 2 }]) {
    assert.equal(obs(bad), null, JSON.stringify(bad));
  }
  const withEvent = (e) => ({ ...doc, observations: { v: 1, addon: "1.20.0", events: [e] } });
  for (const e of [good, item, object, sole, old]) assert.deepEqual(validateExport(withEvent(e)), []);
  for (const patch of [{ npc: undefined }, { item: 750 }, { ot: "item" }, { by: "count" }, { i: 13 }, { numFulfilled: 3 }, { ot: "event" },
                       { by: "guess" }, { quest: 0 }, { rows: 0 }, { rows: 41 }, { rows: 1.5 },
                       { ot: "item", npc: undefined, item: 750, by: "sole" }, { ot: "object", npc: undefined, object: 3719, by: "sole" }]) {
    assert.ok(validateExport(withEvent({ ...good, ...patch })).length, "schema rejected " + JSON.stringify(patch));
  }
});

test("observations 3.12.0: the schema rejects invalid game text events", () => {
  const { validateExport } = require("./validate_export");
  const doc = convert.convertSavedVariables([LUA]).inventory;
  const withEvent = (event) => ({ ...doc, observations: { v: 1, addon: "1.19.0", events: [event] } });
  for (const kind of ["gossip", "read", "line"]) {
    const event = doc.observations.events.find((e) => e.type === kind);
    assert.deepEqual(validateExport(withEvent(event)), []);
    const bad = kind === "gossip" ? [{ npc: undefined }, { object: 1 }, { kind: "option" }]
      : kind === "read" ? [{ item: 1 }, { material: "Mail" }, { creator: "Examplewriter" }, { last: false }]
      : [{ text: "é" }, { kind: "party" }, { guid: "discard" }];
    for (const patch of [...bad, { text: "Player-1-26" }, { text: "|" }]) {
      assert.ok(validateExport(withEvent({ ...event, ...patch })).length, "schema rejected invalid " + kind);
    }
  }
});

test("observations 3.12.0: quest accept data is bounded, progress-free and tied to its map", () => {
  const { validateExport } = require("./validate_export");
  const doc = convert.convertSavedVariables([LUA]).inventory;
  const event = { id: "abc123-1", t: 100, type: "quest", act: "accept", quest: 7787, where: { uiMap: 1449 } };
  const obs = (patch) => convert.exportObservations([{ events: [{ ...event, ...patch }] }]).events[0];
  const valid = { t: "progressbar", n: 0, text: "Fill the jar." };
  const point = { map: 1449, x: 65.43, y: 50.12 };
  const data = obs({
    obj: [null, { ...valid, text: "0/4 Fill the jar." }, { ...valid, text: "Fill 5/9 jars." },
      { ...valid, text: "Fill the jar: 45%" }, { ...valid, n: -1 }, { ...valid, t: "NOT_A_TYPE" },
      { ...valid, text: "x".repeat(401) }, { ...valid, numFulfilled: 8, finished: true },
      ...Array.from({ length: 14 }, (_, i) => ({ ...valid, n: i + 1 }))],
    poi: [null, { ...point, map: 1 }, { ...point, y: -1 }, { ...point, x: 0, y: 0 },
      { ...point, x: 65.431, source: "discard" }, point,
      ...Array.from({ length: 9 }, (_, i) => ({ ...point, x: i + 1 }))],
  });
  assert.deepEqual(data.obj[0], valid);
  assert.equal(data.obj.length, 12);
  assert.deepEqual(data.poi[0], point);
  assert.equal(data.poi.length, 8);
  assert.equal(data.poi[7].x, 7);
  const turnin = obs({ act: "turnin", obj: data.obj, poi: data.poi });
  assert.ok(!("obj" in turnin) && !("poi" in turnin));
  assert.deepEqual(validateExport({ ...doc, observations: { v: 1, addon: "1.19.0", events: [data] } }), []);
  assert.deepEqual(validateExport({ ...doc, observations: { v: 1, addon: "1.19.0",
    events: [{ ...data, poi: [{ ...point, x: 65.431 }] }] } }), [], "schema accepts numeric coordinates in range");
  for (const bad of [{ obj: [] }, { obj: [{ ...valid, numFulfilled: 2 }] }, { obj: [{ ...valid, text: "2/4 Fill the jar" }] },
                     { poi: [{ ...point, x: 100.001 }] }, { poi: [point, point] }, { poi: [{ ...point, x: 0, y: 0 }] },
                     { act: "turnin" }]) {
    assert.ok(validateExport({ ...doc, observations: { v: 1, addon: "1.19.0", events: [{ ...data, ...bad }] } }).length);
  }
  // 3.13.0: rows, how many objectives the client listed, only beside obj and never fewer than obj's rows
  const two = [valid, { ...valid, n: 2 }];
  assert.equal(obs({ obj: two, rows: 2 }).rows, 2);
  assert.equal(obs({ obj: two, rows: 40 }).rows, 40);
  assert.ok(!("rows" in obs({ obj: two })), "an accept of an earlier build has no rows");
  for (const rows of [0, 1, 41, 2.5, "2"]) assert.ok(!("rows" in obs({ obj: two, rows })), "rows dropped: " + rows);
  assert.ok(!("rows" in obs({ rows: 2 })), "no rows without obj");
  assert.ok(!("rows" in obs({ act: "turnin", obj: two, rows: 2 })));
  const withRows = obs({ obj: two, rows: 3 });
  assert.deepEqual(validateExport({ ...doc, observations: { v: 1, addon: "1.20.0", events: [withRows] } }), []);
  for (const bad of [{ rows: 0 }, { rows: 41 }, { rows: 1.5 }, { obj: undefined }, { act: "turnin", obj: undefined }]) {
    assert.ok(validateExport({ ...doc, observations: { v: 1, addon: "1.20.0", events: [{ ...withRows, ...bad }] } }).length,
      "schema rejected " + JSON.stringify(bad));
  }
});

test("observations 3.11.0: taxi and flight events keep only the documented fields; a doubtful list is dropped whole", () => {
  const G = "Creature-0-4170-0-1234-352-000012AB10";
  const WHERE = `where = { map = 0, uiMap = 1429, x = 0.4123, y = 0.6543 }`;
  const obs = convert.convertSavedVariables([obsFile(`{
    { id = "taxi-1", t = 100, type = "taxi", npc = 352, node = 2, rx = 5, guid = "${G}", money = 9, name = "Made-up Keep", ${WHERE}, ${WHO},
      to = { { node = 5, cost = 950, hops = 2, name = "Made-up Port" }, { node = 4, cost = 210, hops = 1 }, { node = 9, cost = 0, hops = 0 },
             { node = 11, cost = 30, hops = 101 }, { node = 12, cost = 40, hops = 1.5 } } },
    { id = "taxi-2", t = 101, type = "taxi", npc = 352, node = 2, rx = 9, ${WHO}, to = {} },
    { id = "taxi-3", t = 102, type = "taxi", npc = 352, node = 2, ${WHO}, to = { { node = 4, cost = 210 }, { node = 4, cost = 210 } } },
    { id = "taxi-4", t = 103, type = "taxi", npc = 352, node = 2, ${WHO}, to = { { node = 2, cost = 0 } } },
    { id = "taxi-5", t = 104, type = "taxi", npc = 352, node = 2, ${WHO}, to = { { node = 4 } } },
    { id = "taxi-6", t = 105, type = "taxi", npc = 352, node = 2, ${WHO}, to = { { node = 4, cost = -1 } } },
    { id = "taxi-7", t = 106, type = "taxi", npc = 352, node = 2, ${WHO}, to = { { name = "Made-up Port", cost = 1 } } },
    { id = "taxi-8", t = 107, type = "taxi", node = 2, ${WHO}, to = {} },
    { id = "taxi-9", t = 108, type = "taxi", npc = 352, ${WHO}, to = {} },
    { id = "taxi-10", t = 109, type = "taxi", npc = 352, node = 2, ${WHO} },
    { id = "flyt-1", t = 200, type = "flight", from = 2, to = 4, sec = 95, money = 210, ${WHERE}, ${WHO} },
    { id = "flyt-2", t = 201, type = "flight", from = 2, to = 2, sec = 95, ${WHO} },
    { id = "flyt-3", t = 202, type = "flight", from = 2, to = 4, sec = 4, ${WHO} },
    { id = "flyt-4", t = 203, type = "flight", from = 2, to = 4, sec = 3601, ${WHO} },
    { id = "flyt-5", t = 204, type = "flight", from = 2, to = 4, sec = 95.5, ${WHO} },
    { id = "flyt-6", t = 205, type = "flight", from = 0, to = 4, sec = 95, ${WHO} },
    { id = "flyt-7", t = 206, type = "flight", from = 2, sec = 95, ${WHO} },
    { id = "flyt-8", t = 207, type = "flight", from = 2, to = 4, sec = 5, ${WHO} },
  }`)]).inventory.observations;
  assert.deepEqual(obs.events.map((e) => e.id), ["taxi-1", "taxi-2", "flyt-1", "flyt-8"], "a doubtful list or flight is dropped whole");
  const [t, empty, f] = obs.events;
  assert.deepEqual(t, { id: "taxi-1", t: 100, type: "taxi", npc: 352, node: 2, rx: 5, where: { map: 0, uiMap: 1429, x: 0.4123, y: 0.6543 },
    who: { level: 60, class: 4, faction: "Alliance" },
    to: [{ node: 4, cost: 210, hops: 1 }, { node: 5, cost: 950, hops: 2 }, { node: 9, cost: 0 }, { node: 11, cost: 30 }, { node: 12, cost: 40 }] },
    "sorted by node; a bad hops only loses hops");
  assert.deepEqual(empty.to, []); assert.ok(!("rx" in empty), "rx only 1..8");
  assert.deepEqual(f, { id: "flyt-1", t: 200, type: "flight", from: 2, to: 4, sec: 95, who: { level: 60, class: 4, faction: "Alliance" } },
    "a flight never has a where");
  assert.ok(!/Creature-|money|Made-up/.test(JSON.stringify(obs)), "no GUID, money or node name");
  // at most 200 nodes: a longer list is dropped, not cut (a cut list would read as nodes unreachable)
  const nodes = (n) => Array.from({ length: n }, (_, i) => `{ node = ${i + 10}, cost = ${i} }`).join(",");
  const capped = (n) => convert.convertSavedVariables([obsFile(`{ { id = "taxi-11", t = 1, type = "taxi", npc = 352, node = 2, ${WHO},
    to = { ${nodes(n)} } } }`)]).inventory.observations;
  assert.equal(capped(200).events[0].to.length, 200);
  assert.equal(capped(201), undefined);
});

// The size of one taxi event with 40 reachable nodes (a well-travelled character's continent) and of one flight event,
// as exported (compact JSON, the same who and where as every event)
test("observations 3.11.0: one 40-node taxi event is about 1.6 KB, a flight event about 200 bytes", () => {
  const to = Array.from({ length: 40 }, (_, i) => `{ node = ${10 + i * 7}, cost = ${[85, 210, 950, 1400, 3200, 5100][i % 6] * (1 + (i % 3))},` +
    ` hops = ${1 + (i % 4)} }`).join(",");
  const who = `who = { level = 60, class = 4, faction = "Alliance", name = "Exampleobserver", surname = "Examplefamily" }`;
  const obs = convert.convertSavedVariables([obsFile(`{
    { id = "k1f9c2-000124", t = 1762906100, b = "1.60.1.70888", type = "taxi", npc = 352, node = 2, rx = 5,
      where = { map = 0, uiMap = 1429, x = 0.4123, y = 0.6543 }, ${who}, to = { ${to} } },
    { id = "k1f9c2-000125", t = 1762906300, b = "1.60.1.70888", type = "flight", from = 2, to = 45, sec = 181, ${who} } }`)])
    .inventory.observations;
  const [taxi, flight] = obs.events.map((e) => Buffer.byteLength(JSON.stringify(e)));
  assert.equal(obs.events[0].to.length, 40);
  assert.ok(taxi > 1200 && taxi < 1700, "one 40-node taxi event: " + taxi + " bytes");
  assert.ok(flight > 120 && flight < 220, "one flight event: " + flight + " bytes");
});

test("observations 3.11.0: quest extras on the right act only; each fact checked alone; rep all or nothing, never money", () => {
  const doc = convert.convertSavedVariables([obsFile(`{
    { id = "qacc-1", t = 100, type = "quest", act = "accept", quest = 5, npc = 9, ${WHO}, lv = 58, group = 5, freq = "daily", timed = true,
      startItem = 19016, xp = 10, rep = { { f = 72, d = 250 } }, money = 300, standing = 9000 },
    { id = "qacc-2", t = 101, type = "quest", act = "accept", quest = 6, ${WHO}, lv = 256, group = 1, freq = "monthly", timed = 1, startItem = 0 },
    { id = "qacc-3", t = 102, type = "quest", act = "accept", quest = 7, ${WHO}, lv = 0, group = 41, freq = "Daily", timed = false, startItem = -4 },
    { id = "qacc-4", t = 103, type = "quest", act = "accept", quest = 8, ${WHO}, lv = 255, group = 40, freq = "weekly", startItem = 2.5 },
    { id = "qtur-1", t = 200, type = "quest", act = "turnin", quest = 5, ${WHO}, lv = 58, group = 5, freq = "daily", timed = true, startItem = 9,
      xp = 6600, money = 123456, rewards = { items = {}, choices = {} },
      rep = { { f = 87, d = -25 }, { f = 72, d = 250, standing = 9250 }, { f = 1834, d = 100000 } } },
    { id = "qtur-2", t = 201, type = "quest", act = "turnin", quest = 5, ${WHO}, xp = 0, rep = {} },
    { id = "qtur-3", t = 202, type = "quest", act = "turnin", quest = 5, ${WHO}, xp = 12.5, rep = { { f = 72, d = 0 } } },
    { id = "qtur-4", t = 203, type = "quest", act = "turnin", quest = 5, ${WHO}, xp = -3, rep = { { f = 72, d = 100001 } } },
    { id = "qtur-5", t = 204, type = "quest", act = "turnin", quest = 5, ${WHO}, rep = { { f = 72, d = 5 }, { f = 72, d = 6 } } },
    { id = "qtur-6", t = 205, type = "quest", act = "turnin", quest = 5, ${WHO}, rep = { { f = 72, d = 5 }, { f = 0, d = 6 } } },
    { id = "qtur-7", t = 206, type = "quest", act = "turnin", quest = 5, ${WHO}, rep = { { f = 72, d = 5 }, "x" } },
    { id = "qtur-8", t = 207, type = "quest", act = "turnin", quest = 5, ${WHO}, rep = { { f = 72, d = 5.5 } } },
    { id = "qtur-9", t = 208, type = "quest", act = "turnin", quest = 5, ${WHO}, rep = { { f = 72 } } },
    { id = "qtur-10", t = 209, type = "quest", act = "turnin", quest = 5, ${WHO}, rep = "72:5" },
    { id = "qtur-11", t = 210, type = "quest", act = "turnin", quest = 5, ${WHO},
      rep = { { f = 1, d = 1 }, { f = 2, d = 1 }, { f = 3, d = 1 }, { f = 4, d = 1 }, { f = 5, d = 1 }, { f = 6, d = 1 } } },
    { id = "qtur-12", t = 211, type = "quest", act = "turnin", quest = 5, ${WHO},
      rep = { { f = 1, d = 1 }, { f = 2, d = 1 }, { f = 3, d = 1 }, { f = 4, d = 1 }, { f = 5, d = 1 }, { f = 6, d = 1 }, { f = 7, d = 1 } } },
  }`)]).inventory;
  const obs = doc.observations;
  const by = Object.fromEntries(obs.events.map((e) => [e.id, e]));
  const WHO_OUT = { level: 60, class: 4, faction: "Alliance" };
  assert.deepEqual(by["qacc-1"], { id: "qacc-1", t: 100, type: "quest", act: "accept", quest: 5, npc: 9, where: {}, who: WHO_OUT,
    lv: 58, group: 5, freq: "daily", timed: true, startItem: 19016 }, "accept: the facts, never xp, rep, money or a standing");
  for (const id of ["qacc-2", "qacc-3"]) {
    for (const k of ["lv", "group", "freq", "timed", "startItem"]) assert.ok(!(k in by[id]), id + " " + k);
  }
  assert.deepEqual([by["qacc-4"].lv, by["qacc-4"].group, by["qacc-4"].freq, "startItem" in by["qacc-4"]], [255, 40, "weekly", false]);
  assert.deepEqual(by["qtur-1"], { id: "qtur-1", t: 200, type: "quest", act: "turnin", quest: 5, where: {}, who: WHO_OUT,
    rewards: { items: [], choices: [] }, xp: 6600, rep: [{ f: 72, d: 250 }, { f: 87, d: -25 }, { f: 1834, d: 100000 }] },
    "turnin: xp and the changes sorted by faction; never the accept facts, money or a standing");
  for (const id of ["qtur-2", "qtur-3", "qtur-4", "qtur-5", "qtur-6", "qtur-7", "qtur-8", "qtur-9", "qtur-10", "qtur-12"]) {
    assert.ok(!("rep" in by[id]), id + " rep: " + JSON.stringify(by[id].rep));
    assert.ok(!("xp" in by[id]), id + " xp");
  }
  assert.equal(by["qtur-11"].rep.length, 6, "six changes are kept");
  assert.ok(!/money|standing|123456|9250|9000/.test(JSON.stringify(obs)), "never money or a standing");
  const { validateExport } = require("./validate_export");
  assert.deepEqual(validateExport(doc), [], "the schema takes them");
});

// What the extras add to one quest event, as exported: an accept with level, group, daily, timed and start item; a turn-in
// with XP and two reputation changes
test("observations 3.11.0: the quest extras add about 65 bytes to an accept and 50 to a turn-in", () => {
  const who = `who = { level = 30, class = 4, faction = "Alliance", name = "Exampleobserver", surname = "Examplefamily" }`;
  const where = `where = { map = 0, uiMap = 1429, x = 0.4123, y = 0.6543 }`;
  const ev = (extra) => `{ id = "k1f9c2-000130", t = 1762906100, b = "1.60.1.70888", type = "quest", act = "accept", quest = 7787,
    npc = 11811, ${where}, ${who}${extra} }`;
  const turn = (extra) => `{ id = "k1f9c2-000131", t = 1762906400, b = "1.60.1.70888", type = "quest", act = "turnin", quest = 7787,
    npc = 11811, ${where}, ${who}, rewards = { items = { { id = 19019, n = 1 } }, choices = {} }${extra} }`;
  const size = (lua) => Buffer.byteLength(JSON.stringify(convert.convertSavedVariables([obsFile(`{ ${lua} }`)]).inventory.observations.events[0]));
  const accept = size(ev(`, lv = 58, group = 5, freq = "daily", timed = true, startItem = 19016`)) - size(ev(""));
  const turnin = size(turn(`, xp = 6600, rep = { { f = 72, d = 250 }, { f = 47, d = 62 } }`)) - size(turn(""));
  assert.ok(accept > 60 && accept < 90, "accept extras: " + accept + " bytes");
  assert.ok(turnin > 45 && turnin < 75, "turn-in extras: " + turnin + " bytes");
});

test("observations: absent when the module is missing, off with nothing recorded, or has only broken events", () => {
  assert.ok(!("observations" in convert.convertSavedVariables(["KutzInventoryDB = { chars = {} }"]).inventory));
  assert.ok(!("observations" in convert.convertSavedVariables([obsFile("{}")]).inventory));
  assert.ok(!("observations" in convert.convertSavedVariables([obsFile(`{ { id = "x", t = 1, type = "loot" } }`)]).inventory));
});

test("observations: only known fields with the right types; never money, players' GUIDs or extra keys", () => {
  const obs = convert.convertSavedVariables([obsFile(`{
    { id = "abcd-1", t = 100, type = "loot", money = 5000, gold = 1, ${WHO},
      src = { kind = "mob", npc = 1, guid = "Player-4170-00ABCDEF", name = "Bob" },
      where = { map = 0, uiMap = 1429, x = 0.123456, y = 2, itype = "", zone = "Elwynn" },
      items = { { id = 2589, n = 1, link = "x" }, { id = 0, n = 1 }, { id = 3, n = -1 } } },
    { id = "abcd-2", t = 101, type = "loot", src = { kind = "pickpocket" }, items = {} },
    { id = "abcd-3", t = 102, type = "loot", src = { kind = "mob", npc = 7, guid = "Creature-0-1-0-1-8-AB" }, items = {} },
    { id = "abcd-4", t = 103, type = "quest", act = "turnin", quest = 5, npc = 9, money = 300, xp = 10,
      who = { level = 60, class = 4, faction = "Alliance", name = "Tester", surname = "Te|st", guid = "Player-1-2" },
      rewards = { items = {}, choices = { 1, 2 }, chose = 3, money = 300 } },
    { id = "abcd-5", t = 104, type = "quest", act = "abandon", quest = 5 },
    { id = "abcd-6", t = 105, type = "vendor", npc = 12, items = { { id = 4, price = 7, money = 7, cost = { { gold = 1 } } } } },
    { id = "abcd-7", t = 106, type = "chat", text = "hello" },
    { id = "abcd-8", t = 107, type = "loot", where = { map = 409, itype = "raid", difficulty = 9, x = 0.5, y = 0.5 },
      src = { kind = "mob", npc = 7, object = 3, guid = "Creature-0-1-0-1-7-AB", level = 0, via = "chat" }, items = {} },
  }`)]).inventory.observations;
  assert.deepEqual(obs.events.map((e) => e.id), ["abcd-1", "abcd-3", "abcd-4", "abcd-6", "abcd-8"]);
  const [loot, mismatched, quest, vendor, inside] = obs.events;
  assert.deepEqual(loot, { id: "abcd-1", t: 100, type: "loot", src: { kind: "mob", npc: 1 },
    where: { map: 0, uiMap: 1429, x: 0.1235 }, who: { level: 60, class: 4, faction: "Alliance" }, items: [{ id: 2589, n: 1 }] });
  assert.deepEqual(mismatched.src, { kind: "mob", npc: 7 }, "a GUID that disagrees with the id is dropped");
  assert.deepEqual(quest, { id: "abcd-4", t: 103, type: "quest", act: "turnin", quest: 5, npc: 9, where: {},
    who: { level: 60, class: 4, faction: "Alliance", name: "Tester" }, rewards: { items: [], choices: [1, 2], money: 300 }, xp: 10 },
    "who keeps the character's own name (3.3.0); a surname with game markup and any GUID go; xp since 3.11.0; the quest's listed money since 3.16.0");
  assert.deepEqual(vendor.items, [{ id: 4, n: 1, price: 7, limited: null }]);
  assert.deepEqual(inside.where, { map: 409, itype: "raid", difficulty: 9 }, "no x/y inside an instance");
  assert.deepEqual(inside.src, { kind: "mob", npc: 7, guid: "Creature-0-1-0-1-7-AB" });
  assert.ok(!/gold|Player-|Bob|hello/.test(JSON.stringify(obs)));
  // the only money anywhere is a quest's listed reward (3.16.0): never a loot, vendor or top-level quest money key
  const withoutRewards = obs.events.map(({ rewards, ...e }) => e);
  assert.ok(!/money/.test(JSON.stringify({ ...obs, events: withoutRewards })), "money only as rewards.money");
});

test("observations 3.16.0: quest rewards as the window listed them, on both acts; each new key checked alone", () => {
  const L = (id) => `"|cffffffff|Hitem:${id}|h[X]|h|r"`;
  const doc = convert.convertSavedVariables([obsFile(`{
    { id = "rwds-1", t = 100, type = "quest", act = "accept", quest = 1032, npc = 9, ${WHO},
      rewards = { items = {}, choose = { { id = 18471, n = 1, link = ${L(18471)} }, { id = 18472, n = 1, link = ${L(18472)} } },
                  money = 125, xp = 160, choices = { 18471 }, chose = 18471 } },
    { id = "rwds-2", t = 101, type = "quest", act = "turnin", quest = 1032, npc = 9, ${WHO}, xp = 160, money = 999,
      rewards = { items = {}, choose = { { id = 18471, n = 1, link = ${L(18471)} }, { id = 18472, n = 1, link = ${L(18472)} } },
                  choices = { 18471, 18472 }, chose = 18472, money = 125, xp = 160 } },
    { id = "rwds-3", t = 102, type = "quest", act = "accept", quest = 7000, ${WHO},
      rewards = { items = { { id = 2589, n = 5 } }, spells = { 300, 100, 300, 0, 2.5, "x" }, title = "Champion of the Example",
                  cap = true, skill = { line = 197, pts = 5 }, cur = { { id = 61, n = 3 }, { id = 42, n = 10 }, { id = 61, n = 9 }, { id = 0, n = 1 }, { id = 8, n = 0 } } } },
    { id = "rwds-4", t = 103, type = "quest", act = "accept", quest = 7001, ${WHO},
      rewards = { items = {}, money = 0, xp = -1, spells = {}, title = "|cffff0000Red|r", cap = "yes", skill = { line = 197, pts = 1001 }, cur = {} } },
    { id = "rwds-5", t = 104, type = "quest", act = "accept", quest = 7002, ${WHO}, rewards = { items = {}, cap = true } },
    { id = "rwds-6", t = 105, type = "quest", act = "accept", quest = 7003, ${WHO},
      rewards = { items = {}, money = 2147483648, skill = { line = 197 }, title = "${"x".repeat(81)}",
                  spells = { 9, 8, 7, 6, 5, 4, 3, 2, 1, 10 }, cur = { { id = 9, n = 1 }, { id = 8, n = 1 }, { id = 7, n = 1 }, { id = 6, n = 1 },
                  { id = 5, n = 1 }, { id = 4, n = 1 }, { id = 3, n = 1 }, { id = 2, n = 1 }, { id = 1, n = 1 } },
                  choose = { ${Array.from({ length: 11 }, (_, i) => `{ id = ${30001 + i}, n = 1 }`).join(", ")} } } },
    { id = "rwds-7", t = 106, type = "quest", act = "turnin", quest = 7004, ${WHO}, rewards = { items = {}, choices = {}, cap = true, money = 2147483647 } },
    { id = "rwds-8", t = 107, type = "quest", act = "accept", quest = 7005, ${WHO}, rewards = "125" },
  }`)]).inventory;
  const by = Object.fromEntries(doc.observations.events.map((e) => [e.id, e]));
  const amulets = [{ id: 18471, n: 1, link: "|cffffffff|Hitem:18471|h[X]|h|r" }, { id: 18472, n: 1, link: "|cffffffff|Hitem:18472|h[X]|h|r" }];
  assert.deepEqual(by["rwds-1"].rewards, { items: [], choose: amulets, money: 125, xp: 160 }, "accept: no choices or chose");
  assert.deepEqual(by["rwds-2"].rewards, { items: [], choose: amulets, choices: [18471, 18472], chose: 18472, money: 125, xp: 160 });
  assert.equal(by["rwds-2"].xp, 160, "the turn-in's top-level xp stays");
  assert.ok(!("money" in by["rwds-2"]), "never a top-level money");
  assert.deepEqual(by["rwds-3"].rewards, { items: [{ id: 2589, n: 5 }], spells: [100, 300], title: "Champion of the Example", cap: true,
    skill: { line: 197, pts: 5 }, cur: [{ id: 42, n: 10 }, { id: 61, n: 3 }] });
  assert.ok(!("rewards" in by["rwds-4"]), "an accept whose keys all fail lists nothing: " + JSON.stringify(by["rwds-4"].rewards));
  assert.ok(!("rewards" in by["rwds-5"]), "cap alone lists nothing on an accept");
  assert.deepEqual(Object.keys(by["rwds-6"].rewards), ["items", "choose", "spells", "cur"]);
  assert.deepEqual(by["rwds-6"].rewards.spells, [1, 2, 3, 4, 5, 6, 7, 8], "the lowest 8 spells");
  assert.deepEqual(by["rwds-6"].rewards.cur.map((c) => c.id), [1, 2, 3, 4, 5, 6, 7, 8], "the lowest 8 currencies");
  assert.equal(by["rwds-6"].rewards.choose.length, 10, "at most 10 to choose from");
  assert.deepEqual(by["rwds-7"].rewards, { items: [], choices: [], money: 2147483647, cap: true }, "a turn-in keeps cap");
  assert.ok(!("rewards" in by["rwds-8"]));
  const { validateExport } = require("./validate_export");
  assert.deepEqual(validateExport(doc), [], "the schema takes them");
  const broken = structuredClone(doc);
  broken.observations.events.find((e) => e.id === "rwds-1").rewards.choices = [18471];
  assert.ok(validateExport(broken).length, "the schema refuses choices on an accept");
  const noChoices = structuredClone(doc);
  delete noChoices.observations.events.find((e) => e.id === "rwds-2").rewards.choices;
  assert.ok(validateExport(noChoices).length, "the schema still wants choices on a turn-in");
});

test("observations 3.16.0: a disenchant loot event keeps only kind and the destroyed item; without the item, no event", () => {
  const { validateExport } = require("./validate_export");
  const doc = convert.convertSavedVariables([LUA]).inventory;
  const where = { map: 0, uiMap: 1429, x: 0.4123, y: 0.6543 };
  const who = { level: 30, class: 8, faction: "Alliance", name: "Exampleobserver" };
  const event = { id: "dsen-1", t: 100, type: "loot", src: { kind: "disenchant", item: 20708 },
    items: [{ id: 10940, n: 2, link: "|cffffffff|Hitem:10940|h[Strange Dust]|h|r" }], where, who };
  const obs = (src) => convert.exportObservations([{ events: [{ ...event, src }] }]);
  const good = obs(event.src).events[0];
  assert.deepEqual(good.src, { kind: "disenchant", item: 20708 });
  assert.deepEqual(obs({ kind: "disenchant", item: 20708, guid: "Creature-0-4170-0-1234-1-000012ABCD", npc: 1, via: "slot", level: 3 }).events[0].src,
    { kind: "disenchant", item: 20708 }, "nothing else rides along");
  for (const item of [undefined, 0, "20708", 1.5]) assert.equal(obs({ kind: "disenchant", item }), null, "item " + item);
  assert.deepEqual(obs({ kind: "container", item: 20708 }).events[0].src, { kind: "container", item: 20708 }, "container unchanged");
  const withEvent = (e) => ({ ...doc, observations: { v: 1, addon: "1.23.0", events: [e] } });
  assert.deepEqual(validateExport(withEvent(good)), []);
  for (const src of [{ kind: "disenchant" }, { kind: "disenchant", item: 1, npc: 2 }, { kind: "disenchant", item: 1, via: "slot" },
                     { kind: "disenchant", item: 1, guid: "Creature-0-4170-0-1234-1-000012ABCD" }, { kind: "enchant", item: 1 }]) {
    assert.ok(validateExport(withEvent({ ...good, src })).length, "schema rejected " + JSON.stringify(src));
  }
  assert.deepEqual(validateExport(withEvent({ ...good, src: { kind: "container" } })), [], "a container may still lack its item");
});

test("observations 3.16.0: killrep keeps npc, lv, faction and the signed change; never a standing or a GUID", () => {
  const { validateExport } = require("./validate_export");
  const doc = convert.convertSavedVariables([LUA]).inventory;
  const where = { map: 0, uiMap: 1429, x: 0.4123, y: 0.6543 };
  const who = { level: 30, class: 4, faction: "Alliance", name: "Exampleobserver" };
  const event = { id: "krep-1", t: 100, b: "1.60.1.70888", type: "killrep", npc: 1234, lv: 12, f: 72, d: 25,
    standing: 9000, guid: "Creature-0-4170-0-1234-1234-000012ABCD", name: "Stormwind", where, who };
  const obs = (patch) => convert.exportObservations([{ events: [{ ...event, ...patch }] }]);
  const good = obs({}).events[0];
  assert.deepEqual(good, { id: "krep-1", t: 100, b: "1.60.1.70888", type: "killrep", npc: 1234, lv: 12, f: 72, d: 25, where, who });
  assert.ok(!/Creature-|9000|Stormwind|standing/.test(JSON.stringify(good)), "no GUID, standing or faction name");
  assert.ok(Buffer.byteLength(JSON.stringify(good)) < 260, "one killrep event: " + Buffer.byteLength(JSON.stringify(good)) + " bytes");
  assert.deepEqual(obs({ d: -100000 }).events[0].d, -100000);
  assert.deepEqual(obs({ d: 100000 }).events[0].d, 100000);
  for (const lv of [0, 256, 1.5, "12", -1]) assert.ok(!("lv" in obs({ lv }).events[0]), "lv " + lv + " goes alone");
  for (const bad of [{ npc: undefined }, { npc: 0 }, { npc: "1234" }, { f: undefined }, { f: 0 }, { f: 2.5 }, { d: 0 },
                     { d: undefined }, { d: 100001 }, { d: -100001 }, { d: 2.5 }, { d: "25" }]) assert.equal(obs(bad), null, JSON.stringify(bad));
  const withEvent = (e) => ({ ...doc, observations: { v: 1, addon: "1.23.0", events: [e] } });
  assert.deepEqual(validateExport(withEvent(good)), []);
  const { lv, ...bare } = good;
  assert.deepEqual(validateExport(withEvent(bare)), []);
  for (const patch of [{ npc: undefined }, { f: undefined }, { d: undefined }, { d: 0 }, { d: 100001 }, { lv: 0 }, { lv: 256 },
                       { standing: 9000 }, { guid: "Creature-0-1-2" }, { where: undefined }]) {
    assert.ok(validateExport(withEvent({ ...good, ...patch })).length, "schema rejected " + JSON.stringify(patch));
  }
  // through the saved file: a Lua killrep event reaches the export as is
  const lua = convert.convertSavedVariables([obsFile(`{
    { id = "krep-2", t = 200, type = "killrep", npc = 1234, lv = 12, f = 87, d = -5, ${WHO} } }`)]).inventory;
  const e = lua.observations.events.find((x) => x.id === "krep-2");
  assert.deepEqual([e.type, e.npc, e.lv, e.f, e.d], ["killrep", 1234, 12, 87, -5]);
});

test("observations 3.6.0: a quest's text rides on its accept and turn-in; only text, only that act's fields", () => {
  const obs = convert.convertSavedVariables([obsFile(`{
    { id = "ffff-1", t = 100, type = "quest", act = "accept", quest = 5, ${WHO},
      text = { title = "  A Title ", details = "Hello, $N.", objectives = "Do it.", completion = "not on accept", author = "x" } },
    { id = "ffff-2", t = 101, type = "quest", act = "turnin", quest = 5, ${WHO},
      text = { title = 7, progress = "", completion = "Done, $N.", details = "not on turnin" } },
    { id = "ffff-3", t = 102, type = "quest", act = "accept", quest = 6, ${WHO}, text = { title = "", details = 3 } },
    { id = "ffff-4", t = 103, type = "quest", act = "accept", quest = 7, ${WHO}, text = "words" },
    { id = "ffff-5", t = 104, type = "loot", src = { kind = "mob", npc = 1 }, items = {}, text = { title = "not on loot" } },
  }`)]).inventory.observations;
  assert.deepEqual(obs.events[0].text, { title: "A Title", details: "Hello, $N.", objectives: "Do it." });
  assert.deepEqual(obs.events[1].text, { completion: "Done, $N." });
  for (const e of obs.events.slice(2)) assert.ok(!("text" in e), e.id);
  assert.equal(convert.SCHEMA_VERSION_3, "3.16.0");
  assert.deepEqual(convert.convertSavedVariables([LUA]).inventory.observations.events[3].text,
    { title: "A Made-up Errand", details: "You look capable, $N.\n\nTake this crate to the far camp.", objectives: "Carry the crate to the far camp." });
});

test("observations 3.7.0: a roll list keeps via roll, its threshold and a boss's encounter; won only on loot items", () => {
  const BOSS = "Creature-0-4170-3065-1234-261319-00001B055A";
  const obs = convert.convertSavedVariables([obsFile(`{
    { id = "gggg-1", t = 100, type = "loot", src = { kind = "boss", npc = 261319, guid = "${BOSS}", via = "roll", threshold = 2, encounter = 3496 },
      items = { { id = 19019, n = 1, won = true }, { id = 19020, n = 1, won = "yes" } } },
    { id = "gggg-2", t = 101, type = "loot", src = { kind = "other", via = "roll", threshold = 9 }, items = { { id = 5, n = 1 } } },
    { id = "gggg-3", t = 102, type = "loot", src = { kind = "mob", npc = 7, via = "slot", threshold = 2, encounter = 0 }, items = {} },
    { id = "gggg-4", t = 103, type = "loot", src = { kind = "mob", npc = 7, via = "rolled" }, items = {} },
    { id = "gggg-5", t = 104, type = "quest", act = "turnin", quest = 5, rewards = { items = { { id = 19018, n = 1, won = true } }, choices = {} } },
  }`)]).inventory.observations;
  assert.deepEqual(obs.events[0].src, { kind: "boss", npc: 261319, guid: BOSS, via: "roll", threshold: 2, encounter: 3496 });
  assert.deepEqual(obs.events[0].items, [{ id: 19019, n: 1, won: true }, { id: 19020, n: 1 }]);
  assert.deepEqual(obs.events[1].src, { kind: "other", via: "roll" }, "a threshold outside 0-7 is dropped");
  assert.deepEqual(obs.events[2].src, { kind: "mob", npc: 7, via: "slot" }, "threshold only on a roll; encounter only an id");
  assert.deepEqual(obs.events[3].src, { kind: "mob", npc: 7 });
  assert.deepEqual(obs.events[4].rewards.items, [{ id: 19018, n: 1 }], "won only on loot items");
});

test("observations 3.3.0: item links are kept only in their short form for the same id; who names only the recorder", () => {
  const obs = convert.convertSavedVariables([obsFile(`{
    { id = "eeee-1", t = 100, type = "loot", src = { kind = "mob", npc = 1 }, who = { level = 5, name = "Exampleobserver", surname = "Examplefamily" },
      items = { { id = 19019, n = 1, link = "|cffa335ee|Hitem:19019|h[Thunderfury]|h|r" },
                { id = 2589, n = 1, link = "|cffffffff|Hitem:2589::::::::60:::::|h[Linen Cloth]|h|r" },
                { id = 4306, n = 1, link = "|cffffffff|Hitem:4306|h[Silk|Cloth]|h|r" } } },
    { id = "eeee-2", t = 101, type = "quest", act = "turnin", quest = 5, who = { surname = "Examplefamily" },
      rewards = { items = { { id = 19018, n = 1, link = "|cff0070dd|Hitem:19018|h[Made-up Ring]|h|r" } }, choices = {} } },
  }`)]).inventory.observations;
  assert.deepEqual(obs.events[0].who, { level: 5, name: "Exampleobserver", surname: "Examplefamily" });
  assert.deepEqual(obs.events[0].items, [{ id: 19019, n: 1, link: "|cffa335ee|Hitem:19019|h[Thunderfury]|h|r" }, { id: 2589, n: 1 },
    { id: 4306, n: 1 }], "only the short form is accepted");
  assert.deepEqual(obs.events[1].who, {}, "a surname without a name is dropped");
  assert.deepEqual(obs.events[1].rewards.items, [{ id: 19018, n: 1, link: "|cff0070dd|Hitem:19018|h[Made-up Ring]|h|r" }]);
});

test("observations: two saved files merge by id, oldest first, the newest addon version; caps at 5000 events and ~2 MB", () => {
  const a = obsFile(`{ { id = "aaaa-2", t = 20, type = "loot", src = { kind = "other" }, items = {} },
    { id = "aaaa-1", t = 10, type = "loot", src = { kind = "other" }, items = {} } }`);
  const b = obsFile(`{ { id = "aaaa-2", t = 20, type = "loot", src = { kind = "other" }, items = {} },
    { id = "bbbb-1", t = 15, type = "loot", src = { kind = "fishing" }, items = { { id = 6303, n = 1 } } } }`).replace('"1.8.0"', '"1.10.0"');
  const obs = convert.convertSavedVariables([a, b]).inventory.observations;
  assert.deepEqual(obs.events.map((e) => e.id), ["aaaa-1", "bbbb-1", "aaaa-2"]);
  assert.equal(obs.addon, "1.10.0");
  const many = Array.from({ length: 5200 }, (_, i) => ({ id: `cccc-${i}`, t: 1000 + i, type: "loot", src: { kind: "other" }, items: [] }));
  const capped = convert.exportObservations([{ addon: "1.8.0", events: many }]);
  assert.equal(capped.events.length, 5000); assert.equal(capped.events[0].id, "cccc-200");
  const items = Array.from({ length: 2000 }, (_, i) => ({ id: 100000 + i, n: 1 }));
  const big = convert.exportObservations([{ events: Array.from({ length: 80 }, (_, i) =>
    ({ id: `dddd-${i}`, t: 1000 + i, type: "loot", src: { kind: "other" }, items })) }]);
  assert.ok(JSON.stringify(big).length <= 2000200 && big.events.length < 80 && big.events.at(-1).id === "dddd-79", "about 2 MB");
  assert.equal(big.addon, "unknown");
});

// The npcs summary (3.10.0): KutzInventoryObsDB.npcs -> observations.npcs + observations.install
const npcFile = (npcs, extra = `prefix = "k1f9c2"`) =>
  `KutzInventoryDB = { chars = {} }\nKutzInventoryObsDB = { v = 1, on = true, addon = "1.17.0", ${extra}, events = {}, npcs = ${npcs} }`;

test("observations 3.10.0: the example's npcs are exported sorted by npc with the install id; broken parts left out", () => {
  const obs = convert.convertSavedVariables([LUA]).inventory.observations;
  assert.equal(obs.install, "k1f9c2");
  assert.deepEqual(Object.keys(obs), ["v", "addon", "install", "events", "npcs", "items", "killsInstall", "kills"]);
  assert.deepEqual(obs.npcs, [
    { npc: 525, name: "Made-up Wolf", lv: [10, 12], cls: "normal", ct: 1, fam: 1, rxA: 2, spd: 200, hp: [{ lv: 10, v: 156 }, { lv: 12, v: 198 }],
      day: 20404, cells: [[1429, 41, 65, 2], [1429, 42, 65, 1]] },
    { npc: 1346, name: "Made-up Tailor", lv: [30, 30], cls: "normal", ct: 7, rxA: 5, sub: "Made-up Tailoring Supplies", svc: ["repair", "vendor"],
      day: 20405, cells: [[1453, 63, 72, 4]] },
    { npc: 6109, name: "Made-up Dragon", boss: true, cls: "worldboss", ct: 2, rxA: 1, day: 20403 },
    { npc: 11671, name: "Made-up Hound", lv: [62, 62], cls: "elite", ct: 1, rxA: 2, hp: [{ lv: 62, diff: 9, v: 42000 }],
      pw: [{ lv: 62, diff: 9, t: 0, v: 9800 }], day: 20404, inst: [[409, 9, 3]] }], "no spds or tally, no entry without a day, no junk cell");
});

test("observations 3.10.0: npcs keep only the documented fields with the right types and ranges", () => {
  const cells = Array.from({ length: 45 }, (_, i) => `["1429:${i}:7"] = ${i + 1}`).join(", ");
  const obs = convert.convertSavedVariables([npcFile(`{
    [1] = { lv = { 12, 10 }, boss = "yes", cls = "boss", ct = 0, fam = "Be|ast", rxA = 9, rxH = 0, sub = "Player-4170-00ABCDEF", spd = 5, day = 20404,
            guid = "Creature-0-4170-0-1234-1-000012AB01", name = "|cffff0000Made-up Wolf|r", t = 1762905600, cells = { ["1429:100:1"] = 1, ["1429:1:1"] = 0, ["x"] = 2 } },
    [2] = { lv = { 0, 5 }, ct = "Beast", fam = "Wolf", rxA = 8, rxH = 1, sub = "${"s".repeat(81)}", spd = 3000, day = 20404, cells = { ${cells} } },
    [3] = { lv = { 7, 9 }, ct = 7, sub = "Stable Master", spd = 150, day = 20404, cells = { ["1429:99:0"] = 3 } },
    [4] = { day = 0 }, [5] = { day = "20404" }, [6] = { day = 2000000 }, [7] = "junk", [8] = { sub = "Someone's Pet", name = "Someone's Pet", day = 20404 }, [9] = { name = "Made-up Wolf", day = 20404 },
  }`)]).inventory.observations;
  assert.deepEqual(obs.npcs.map((n) => n.npc), [1, 2, 3, 8, 9]);
  assert.deepEqual(obs.npcs[4], { npc: 9, name: "Made-up Wolf", day: 20404 }, "the name, right after npc");
  assert.deepEqual(obs.npcs[3], { npc: 8, day: 20404 }, "never a subtitle with 's (an owner's title)");
  assert.deepEqual(obs.npcs[0], { npc: 1, day: 20404 });
  assert.deepEqual(Object.keys(obs.npcs[1]), ["npc", "ct", "fam", "rxA", "rxH", "day", "cells"]);
  assert.equal(obs.npcs[1].cells.length, 40);
  assert.deepEqual(obs.npcs[1].cells[0], [1429, 5, 7, 6], "the 40 most counted squares, sorted by place");
  assert.deepEqual(obs.npcs[2], { npc: 3, lv: [7, 9], ct: 7, sub: "Stable Master", spd: 150, day: 20404, cells: [[1429, 99, 0, 3]] });
  const { validateExport } = require("./validate_export");
  const doc = convert.convertSavedVariables([npcFile(`{ [3] = { day = 20404 } }`)]).inventory;
  assert.deepEqual(doc.observations.events, [], "npcs and no events: a section all the same");
  assert.deepEqual(validateExport(doc), []);
  assert.ok(!("observations" in convert.convertSavedVariables([npcFile(`{ [3] = { day = 20404 } }`, `n = 0`)]).inventory),
    "no install prefix: no summary (the site could not tell whose it replaces)");
  assert.ok(!("observations" in convert.convertSavedVariables([npcFile(`{ [3] = { lv = { 1, 2 } } }`)]).inventory));
});

test("observations 3.10.0: several installs merge into one summary named by all of them; a copied file counts once", () => {
  const a = npcFile(`{ [525] = { lv = { 10, 11 }, cls = "normal", rxA = 2, day = 20404, cells = { ["1429:41:65"] = 2 } },
    [6] = { day = 20400 } }`, `prefix = "zz9900"`);
  const b = npcFile(`{ [525] = { lv = { 12, 12 }, cls = "elite", rxH = 4, sub = "Made-up Title", day = 20405, cells = { ["1429:41:65"] = 1, ["1429:1:1"] = 5 } } }`,
    `prefix = "aa1100"`);
  const obs = convert.convertSavedVariables([a, b]).inventory.observations;
  assert.equal(obs.install, "aa1100+zz9900");
  assert.deepEqual(obs.npcs, [{ npc: 6, day: 20400 },
    { npc: 525, lv: [10, 12], cls: "elite", rxA: 2, rxH: 4, sub: "Made-up Title", day: 20405, cells: [[1429, 1, 1, 5], [1429, 41, 65, 3]] }]);
  const older = npcFile(`{ [525] = { lv = { 10, 10 }, day = 20401, cells = { ["1429:41:65"] = 1 } } }`, `prefix = "zz9900"`);
  const twice = convert.convertSavedVariables([older, a]).inventory.observations;
  assert.equal(twice.install, "zz9900");
  assert.deepEqual(twice.npcs.find((n) => n.npc === 525).cells, [[1429, 41, 65, 2]], "the newest copy, not both added up");
});

test("observations 3.16.0: npcs hp and pw per level and difficulty; the tally stays home; installs join per level", () => {
  const obs = convert.convertSavedVariables([npcFile(`{
    [525] = { day = 20404, hp = { { lv = 13, v = 250, c = { [250] = 2, [198] = 1 } }, { lv = 12, v = 198, c = { [198] = 1 } },
                                  { lv = 12, diff = 1, v = 900, c = { [900] = 1 } } },
              pw = { { lv = 12, t = 0, v = 345, c = { ["0:345"] = 1 } } } },
    [526] = { day = 20404, hp = { "junk", { lv = 0, v = 5 }, { lv = 256, v = 5 }, { lv = 5, v = 0 }, { lv = 5, v = 1.5 }, { lv = 5, v = 7, diff = -1 },
                                  { lv = 5, v = 8, diff = "1" }, { lv = 6, v = 9 } },
              pw = { { lv = 5, v = 7 }, { lv = 5, t = 31, v = 7 }, { lv = 5, t = -1, v = 7 }, { lv = 6, t = 3, v = 100 } } },
    [527] = { day = 20404, hp = { { lv = 1, v = 1 }, { lv = 2, v = 2 }, { lv = 3, v = 3 }, { lv = 4, v = 4 }, { lv = 5, v = 5 },
                                  { lv = 6, v = 6 }, { lv = 7, v = 7 }, { lv = 3, v = 33 } } },
    [528] = { day = 20404, hp = {}, pw = "x" },
  }`)]).inventory.observations;
  const by = Object.fromEntries(obs.npcs.map((n) => [n.npc, n]));
  assert.deepEqual(by[525].hp, [{ lv: 12, v: 198 }, { lv: 12, v: 900, diff: 1 }, { lv: 13, v: 250 }]);
  assert.deepEqual(by[525].pw, [{ lv: 12, t: 0, v: 345 }]);
  assert.deepEqual(Object.keys(by[525]), ["npc", "hp", "pw", "day"]);
  assert.deepEqual(by[526].hp, [{ lv: 6, v: 9 }], "each broken reading goes alone");
  assert.deepEqual(by[526].pw, [{ lv: 6, t: 3, v: 100 }]);
  assert.deepEqual(by[527].hp.map((x) => [x.lv, x.v]), [[3, 33], [4, 4], [5, 5], [6, 6], [7, 7], [2, 2]].sort((a, b) => a[0] - b[0]),
    "6 levels, the latest read kept (3 read again last, 1 the oldest)");
  assert.deepEqual(by[528], { npc: 528, day: 20404 });
  assert.ok(!JSON.stringify(obs.npcs).includes('"c"'), "the tally is not exported");
  // two installs: the levels join, the one seen last wins a level both have
  const a = npcFile(`{ [525] = { day = 20404, hp = { { lv = 12, v = 198 }, { lv = 10, v = 150 } }, pw = { { lv = 12, t = 0, v = 300 } } } }`, `prefix = "zz9900"`);
  const b = npcFile(`{ [525] = { day = 20405, hp = { { lv = 12, v = 205 }, { lv = 14, v = 260 } } } }`, `prefix = "aa1100"`);
  const merged = convert.convertSavedVariables([a, b]).inventory.observations.npcs[0];
  assert.deepEqual(merged.hp, [{ lv: 10, v: 150 }, { lv: 12, v: 205 }, { lv: 14, v: 260 }]);
  assert.deepEqual(merged.pw, [{ lv: 12, t: 0, v: 300 }]);
  // the schema: valid as exported; out-of-range values are not
  const { validateExport } = require("./validate_export");
  const doc = convert.convertSavedVariables([npcFile(`{ [525] = { day = 20404, hp = { { lv = 12, v = 198 }, { lv = 12, diff = 1, v = 900 } }, pw = { { lv = 12, t = 0, v = 345 } } } }`)]).inventory;
  assert.deepEqual(validateExport(doc), []);
  const npc = doc.observations.npcs[0];
  for (const patch of [{ hp: [] }, { hp: [{ lv: 12 }] }, { hp: [{ lv: 0, v: 1 }] }, { hp: [{ lv: 1, v: 0 }] }, { hp: [{ lv: 1, v: 1, c: {} }] },
                       { pw: [{ lv: 1, v: 1 }] }, { pw: [{ lv: 1, t: 31, v: 1 }] }, { hp: Array.from({ length: 7 }, (_, i) => ({ lv: i + 1, v: 1 })) }]) {
    const bad = { ...doc, observations: { ...doc.observations, npcs: [{ ...npc, ...patch }] } };
    assert.ok(validateExport(bad).length, "schema rejected " + JSON.stringify(patch));
  }
});

test("observations 3.11.0: svc is a sorted set of the known services; merged installs add theirs up", () => {
  const obs = convert.convertSavedVariables([npcFile(`{
    [1] = { svc = { vendor = true, repair = true, inn = true, flight = 1, gossip = true, Vendor = true }, day = 20404 },
    [2] = { svc = { "trainer", "bank", "trainer", "quest", 7 }, day = 20404 },
    [3] = { svc = { gossip = true }, day = 20404 }, [4] = { svc = "vendor", day = 20404 }, [5] = { svc = {}, day = 20404 },
    [6] = { svc = { vendor = true, repair = true, flight = true, trainer = true, bank = true, guildbank = true, inn = true, auction = true,
                    stable = true, battlemaster = true, spirit = true, guild = true, tabard = true }, day = 20404 },
  }`)]).inventory.observations;
  assert.deepEqual(obs.npcs.map((n) => n.svc), [["inn", "repair", "vendor"], undefined, undefined, undefined, undefined,
    ["auction", "bank", "battlemaster", "flight", "guild", "guildbank", "inn", "repair", "spirit", "stable", "tabard", "trainer", "vendor"]],
    "only true values of known names in the addon's set (a Lua list is not one), each once, sorted");
  assert.deepEqual(Object.keys(obs.npcs[0]), ["npc", "svc", "day"], "svc after sub, before spd");
  const { validateExport } = require("./validate_export");
  assert.deepEqual(validateExport(convert.convertSavedVariables([npcFile(`{ [6] = { svc = { tabard = true, bank = true }, day = 20404 } }`)]).inventory), []);
  const a = npcFile(`{ [525] = { svc = { vendor = true }, day = 20404 } }`, `prefix = "zz9900"`);
  const b = npcFile(`{ [525] = { svc = { inn = true, vendor = true }, day = 20405 } }`, `prefix = "aa1100"`);
  const c = npcFile(`{ [525] = { day = 20406 } }`, `prefix = "bb2200"`);
  assert.deepEqual(convert.convertSavedVariables([a, b, c]).inventory.observations.npcs[0].svc, ["inn", "vendor"], "the union, kept when the newest has none");
});

test("observations 3.10.0: at most 3000 npcs, the most recently seen kept; realistic sizes", () => {
  const npcs = {};
  for (let i = 1; i <= 3100; i++) npcs[i] = { lv: { 1: 20, 2: 21 }, cls: "normal", ct: 7, rxA: 2, day: i <= 100 ? 20300 : 20400 + (i % 50),
    cells: { "1429:41:65": 2 } };
  const obs = convert.exportObservations([{ addon: "1.17.0", prefix: "k1f9c2", events: [], npcs }]);
  assert.equal(obs.npcs.length, 3000);
  assert.ok(obs.npcs.every((n) => n.npc > 100) && obs.npcs.every((n, i) => i === 0 || obs.npcs[i - 1].npc < n.npc), "newest kept, sorted by npc");
  assert.ok(JSON.stringify(obs.npcs).length < 400000, "3000 plain entries stay well under the 1 MB cap: " + JSON.stringify(obs.npcs).length);
  const huge = {};
  for (let i = 1; i <= 3000; i++) huge[i] = { day: 20400, cells: Object.fromEntries(Array.from({ length: 40 }, (_, j) => [`1429:${j}:${i % 100}`, 99])) };
  const capped = convert.exportObservations([{ prefix: "k1f9c2", npcs: huge }]);
  assert.ok(JSON.stringify(capped.npcs).length <= 1000000 && capped.npcs.length < 3000, "about 1 MB at most");
});

// ---------------------------------------------------------------------------
// 3.15.0 (KutzInventory 1.21.0): item facts, kills per day, suffixes on links, creatures inside instances, every
// vendor of an item, statistics per day, unlearned recipes saved once per account file
// ---------------------------------------------------------------------------
const factsFile = (body, extra = `prefix = "k1f9c2"`) =>
  `KutzInventoryDB = { chars = {} }\nKutzInventoryObsDB = { v = 1, on = true, addon = "1.21.0", ${extra}, events = {}, ${body} }`;
const SHIELD_ITEM = `[6560] = { d = 20404, b = 1, f = "2:2:4:6:25:20::INVTYPE_SHIELD", s = "ITEM_MOD_STAMINA_SHORT=3,RESISTANCE0_NAME=478",
  t = "-Soldier's Shield\\n-Binds when equipped\\n-Off Hand\\n>Shield\\n-478 Armor\\n-+3 Stamina\\n-Durability 65 / 65\\n!Requires Level 20",
  v = { ["0;12729"] = "Soldier's Shield of Intellect\\nITEM_MOD_INTELLECT_SHORT=5,RESISTANCE0_NAME=478", ["0;12741"] = "Soldier's Shield of the Bear\\n" } }`;

test("observations 3.15.0: an item's facts are exported once, a random suffix as a variant of that one item", () => {
  const { validateExport } = require("./validate_export");
  const doc = convert.convertSavedVariables([factsFile(`itemBuilds = { "1.60.1.71037" }, items = { ${SHIELD_ITEM},
    [2589] = { d = 20403, b = 1, f = "1:0:7:5:5:0::", n = "Linen Cloth" },
    [1] = { d = 20403, b = 9, f = "bad", n = "Named Only" },
    [2] = { b = 1, n = "No day" }, [3] = { d = 20403, b = 1, f = "1:0:7:5:5:0::" }, [4] = "junk", ["x"] = { d = 20403, n = "Bad id" },
    [5] = { d = 20403, n = "A|cffname" } }`)]).inventory;
  assert.deepEqual(validateExport(doc), []);
  const items = doc.observations.items;
  assert.deepEqual(items.map((i) => i.id), [1, 2589, 6560], "by id; an entry without a day or a name, a bad id, markup in a name: left out");
  assert.deepEqual(items[0], { id: 1, day: 20403, name: "Named Only" }, "facts that do not read as numbers, and a build the file does not list, are left out");
  assert.deepEqual(items[1], { id: 2589, day: 20403, build: "1.60.1.71037", name: "Linen Cloth", q: 1, bind: 0, cls: 7, sub: 5, ilvl: 5, req: 0 });
  assert.deepEqual(items[2], {
    id: 6560, day: 20404, build: "1.60.1.71037", name: "Soldier's Shield", q: 2, bind: 2, cls: 4, sub: 6, ilvl: 25, req: 20, slot: "INVTYPE_SHIELD",
    durability: 65, stats: { ITEM_MOD_STAMINA_SHORT: 3, RESISTANCE0_NAME: 478 },
    tip: ["Soldier's Shield", "Binds when equipped", ["Off Hand", "Shield"], "478 Armor", "+3 Stamina", "Requires Level 20"],
    variants: [{ bonus: [12729], name: "Soldier's Shield of Intellect", stats: { ITEM_MOD_INTELLECT_SHORT: 5, RESISTANCE0_NAME: 478 } },
               { bonus: [12741], name: "Soldier's Shield of the Bear" }],
  });
  assert.equal(items.filter((i) => /Shield/.test(i.name)).length, 1, "a random-suffix item is one item, never several");
  assert.equal(convert.convertSavedVariables([factsFile(`items = { ${SHIELD_ITEM} }`)], { format: 2 }).inventory.observations, undefined, "2.x has none");
  // items alone are an observations section (no events, no npcs), and name the addon that read them
  assert.deepEqual(Object.keys(doc.observations), ["v", "addon", "events", "items"]);
  assert.equal(doc.observations.addon, "1.21.0");
});

test("/kinv dumpitem's debugItemDumps (raw client answers) never reach the export, in any format", () => {
  const MARK = "DUMP-MARKER-7f3a";
  const dump = `debugItemDumps = { { at = 1, date = "2026-11-25 10:00:00", build = "1.60.1.71037", source = "mouse", given = "|Hitem:6560|h[${MARK}]|h",
    hyperlink = "item:6560", tooltip = { lines = { { leftText = "${MARK}", rightText = "Shield" } } }, stats = { ITEM_MOD_STAMINA_SHORT = 3 } } }`;
  const body = `items = { ${SHIELD_ITEM} }`;
  for (const format of [2, 3, undefined]) {
    const plainFile = convert.convertSavedVariables([factsFile(body)], { format });
    const withDumps = convert.convertSavedVariables([factsFile(body + ", " + dump)], { format });
    delete plainFile.inventory.exportedAt; delete withDumps.inventory.exportedAt;
    assert.deepEqual(withDumps, plainFile, "the same export with or without the dumps (format " + format + ")");
    const json = JSON.stringify(withDumps);
    assert.ok(!json.includes(MARK) && !json.includes("debugItemDumps") && !json.includes("dumpitem"), "no trace of a dump in the export");
  }
  // a file with nothing but dumps in its observations table exports no observations at all
  const only = convert.convertSavedVariables([factsFile(dump)]).inventory;
  assert.equal(only.observations, undefined);
  assert.ok(!JSON.stringify(only).includes(MARK));
});

test("observations 3.15.0: item variants keep only a sound key, name and numbers; 24 at most", () => {
  const many = Array.from({ length: 30 }, (_, i) => `["0;${13000 + i}"] = "Shield ${i}\\n"`).join(", ");
  const items = convert.exportItems([{ items: { 6560: { d: 20404, n: "Soldier's Shield", v: {
    "0;12729": "Of Intellect\nITEM_MOD_INTELLECT_SHORT=5,bad key=1,OTHER=x,TOO=1.234", "1203;": "Old Suffix\n", "-12;": "Negative\n", "7;9:3": "Both\n",
    "0;": "No suffix at all\n", "junk": "Junk\n", "0;1:2:3:4:5:6:7:8:9:10:11:12:13:14:15:16:17": "Too many\n", "0;5": 7, "0;6": "Player-1-0000002A\n", "0;7": "A|cffname\n",
  } } } }]);
  assert.deepEqual(items[0].variants, [{ suffix: -12, name: "Negative" }, { bonus: [12729], name: "Of Intellect", stats: { ITEM_MOD_INTELLECT_SHORT: 5 } },
    { suffix: 7, bonus: [3, 9], name: "Both" }, { suffix: 1203, name: "Old Suffix" }]);
  const capped = convert.convertSavedVariables([factsFile(`items = { [6560] = { d = 20404, n = "Soldier's Shield", v = { ${many} } } }`)]).inventory.observations.items;
  assert.equal(capped.length, 1);
  assert.equal(capped[0].variants.length, 24);
});

test("observations 3.15.0: the tooltip is cleaned on the way out: no prices, durability as a number, nothing of a character", () => {
  const tip = ["-Made-up Blade", "-Binds when picked up", "-Unique", "-Main Hand", ">Sword", "-10 - 20 Damage", ">Speed 2.50", "-(6.0 damage per second)",
    "-Durability 30 / 90", "-Classes: Warrior", "]Paladin", "!Requires Level 40", "-Equip: +10 Attack Power.", "-\"A made-up line of flavour.\"",
    "-<Made by Exampleplayer>", "-Equipment Sets: Tank", "-You have not collected this appearance", "-|cff00ff00Use:|r Does|nsomething."].join("\n");
  const item = convert.exportItems([{ items: { 100: { d: 20404, t: tip } } }])[0];
  assert.equal(item.name, "Made-up Blade", "the name is the tooltip's first line when none was saved");
  assert.equal(item.durability, 90);
  const flat = JSON.stringify(item.tip);
  for (const gone of ["Made by", "Exampleplayer", "Equipment Sets", "collected", "Durability", "|c", "|r", "|n"]) {
    assert.ok(!flat.includes(gone), "not in the exported tooltip: " + gone + " " + flat);
  }
  assert.deepEqual(item.tip.slice(0, 5), ["Made-up Blade", "Binds when picked up", "Unique", ["Main Hand", "Sword"], ["10 - 20 Damage", "Speed 2.50"]]);
  assert.ok(item.tip.some((l) => Array.isArray(l) && l[0] === "Classes: Warrior" && l[1] === "Paladin") && item.tip.includes("Requires Level 40"));
});

test("observations 3.15.0: two saved files' items merge: the newest reading, every variant; 4000 items at most", () => {
  const a = factsFile(`itemBuilds = { "1.60.1.71037" }, items = { [6560] = { d = 20404, b = 1, n = "Soldier's Shield", f = "2:2:4:6:25:20::", v = { ["0;12729"] = "Of Intellect\\n" } },
    [1] = { d = 20404, n = "Only in A" } }`, `prefix = "aa1100"`);
  const b = factsFile(`itemBuilds = { "1.60.0.70000", "1.60.2.72000" }, items = { [6560] = { d = 20405, b = 2, n = "Soldier's Shield", f = "2:2:4:6:26:20::",
    v = { ["0;12741"] = "Of the Bear\\n", ["0;12729"] = "Of Intellect\\nITEM_MOD_INTELLECT_SHORT=6" } } }`, `prefix = "bb2200"`);
  for (const files of [[a, b], [b, a]]) {
    const items = convert.convertSavedVariables(files).inventory.observations.items;
    assert.deepEqual(items, [{ id: 1, day: 20404, name: "Only in A" },
      { id: 6560, day: 20405, build: "1.60.2.72000", name: "Soldier's Shield", q: 2, bind: 2, cls: 4, sub: 6, ilvl: 26, req: 20,
        variants: [{ bonus: [12729], name: "Of Intellect", stats: { ITEM_MOD_INTELLECT_SHORT: 6 } }, { bonus: [12741], name: "Of the Bear" }] }]);
  }
  const many = {};
  for (let i = 1; i <= 4100; i++) many[i] = { d: i <= 100 ? 20300 : 20400, b: 1, f: "1:0:7:5:5:0::", n: "Item " + i, t: "-Item " + i + "\n-A line of text" };
  const capped = convert.exportItems([{ itemBuilds: { 1: "1.60.1.71037" }, items: many }]);
  assert.equal(capped.length, 4000);
  assert.ok(capped.every((x) => x.id > 100) && capped.every((x, i) => i === 0 || capped[i - 1].id < x.id), "the most recently met are kept, sorted by id");
  assert.equal(convert.exportItems([{ items: {} }, null, { items: "junk" }]), null);
});

test("observations 3.15.0: kills are counts per day, creature and level, named by install; never a corpse id or a name", () => {
  const { validateExport } = require("./validate_export");
  const doc = convert.convertSavedVariables([factsFile(`kills = { [20404] = { ["2958:14"] = 3, ["2958:15"] = 1, ["525:0"] = 2, ["6:256"] = 1, ["0:5"] = 1, ["7:1"] = 0,
    ["8:1"] = 1.5, ["Creature-0-1-2-3-9-000001"] = 4, junk = 1 }, [20403] = { ["2958:14"] = 5 }, ["x"] = { ["1:1"] = 1 }, [0] = { ["1:1"] = 1 } }`)]).inventory;
  assert.deepEqual(validateExport(doc), []);
  const obs = doc.observations;
  assert.deepEqual(Object.keys(obs), ["v", "addon", "events", "killsInstall", "kills"], "kills alone are an observations section; install stays the npc summary's");
  assert.equal(obs.killsInstall, "k1f9c2");
  assert.deepEqual(obs.kills, [{ day: 20403, npc: 2958, lv: 14, n: 5 }, { day: 20404, npc: 525, n: 2 }, { day: 20404, npc: 2958, lv: 14, n: 3 },
    { day: 20404, npc: 2958, lv: 15, n: 1 }], "by day, npc and level; no level when the client gave none; anything else is left out");
  assert.ok(!JSON.stringify(obs).includes("Creature-"), "no GUID");
  assert.equal(convert.exportKills([{ kills: { 20404: { "1:1": 1 } } }]), null, "counts without an install id cannot be told apart later: left out");
  assert.equal(convert.exportKills([{ prefix: "not an id!", kills: { 20404: { "1:1": 1 } } }]), null);
});

test("observations 3.15.0: the same install twice counts once (the larger number); two installs add up; the newest 30 days", () => {
  const older = factsFile(`kills = { [20404] = { ["2958:14"] = 3, ["6:1"] = 1 } }`, `prefix = "zz9900"`);
  const newer = factsFile(`kills = { [20404] = { ["2958:14"] = 5 }, [20405] = { ["2958:14"] = 1 } }`, `prefix = "zz9900"`);
  const other = factsFile(`kills = { [20404] = { ["2958:14"] = 2 } }`, `prefix = "aa1100"`);
  for (const files of [[older, newer], [newer, older]]) {
    const obs = convert.convertSavedVariables(files).inventory.observations;
    assert.equal(obs.killsInstall, "zz9900");
    assert.deepEqual(obs.kills, [{ day: 20404, npc: 6, lv: 1, n: 1 }, { day: 20404, npc: 2958, lv: 14, n: 5 }, { day: 20405, npc: 2958, lv: 14, n: 1 }]);
  }
  const both = convert.convertSavedVariables([newer, other]).inventory.observations;
  assert.equal(both.killsInstall, "aa1100+zz9900");
  assert.deepEqual(both.kills, [{ day: 20404, npc: 2958, lv: 14, n: 7 }, { day: 20405, npc: 2958, lv: 14, n: 1 }]);
  const kills = {};
  for (let d = 0; d < 40; d++) kills[20300 + d] = { "1:1": 1 };
  const capped = convert.exportKills([{ prefix: "k1f9c2", kills }]).kills;
  assert.deepEqual([capped.length, capped[0].day, capped[29].day], [30, 20310, 20339]);
  const big = {};
  for (let i = 1; i <= 3100; i++) big[i + ":1"] = 1;
  const most = convert.exportKills([{ prefix: "k1f9c2", kills: { 20403: big, 20404: { "1:1": 1 } } }]).kills;
  assert.equal(most.length, 3000);
  assert.ok(most.some((k) => k.day === 20404), "the newest day is kept whole");
  // an install that only counted kills does not rename the npc summary's install
  const mixed = convert.convertSavedVariables([npcFile(`{ [6] = { day = 20400 } }`, `prefix = "aa1100"`), newer]).inventory.observations;
  assert.deepEqual([mixed.install, mixed.killsInstall], ["aa1100", "zz9900"]);
});

test("observations 3.15.0: a random suffix rides beside the link on loot, quest reward and vendor items; the link stays the item's", () => {
  const { validateExport } = require("./validate_export");
  const plain = "|cff1eff00|Hitem:6560|h[Soldier's Shield of Intellect]|h|r";
  const item = (tail, id = 6560) => `{ id = ${id}, n = 1, link = "|cff1eff00|Hitem:6560${tail}|h[Soldier's Shield of Intellect]|h|r" }`;
  const doc = convert.convertSavedVariables([obsFile(`{
    { id = "eeee-1", t = 100, type = "loot", src = { kind = "mob", npc = 1 }, ${WHO},
      items = { ${item("::::::::::::1:12729")}, ${item("::::::1203::::::")}, ${item("::::::-7::::::2:300:100")}, ${item("")},
                ${item("::::::::::::2:12729")}, ${item("::::::::60:::::")}, ${item("::::::::::::1:12729", 6561)}, ${item("::::::0::::::")} } },
    { id = "eeee-2", t = 101, type = "quest", act = "turnin", quest = 5, ${WHO},
      rewards = { items = { ${item("::::::::::::1:12729")}, ${item("::::::1203::::::")} }, choices = { 6560 } } },
    { id = "eeee-3", t = 102, type = "vendor", npc = 3, ${WHO}, items = { { id = 6560, price = 100, stack = 1, link = "|cff1eff00|Hitem:6560::::::::::::1:12729|h[Soldier's Shield of Intellect]|h|r" } } },
  }`)]).inventory;
  assert.deepEqual(validateExport(doc), []);
  const [loot, quest, vendor] = doc.observations.events;
  assert.deepEqual(loot.items, [
    { id: 6560, n: 1, link: plain, bonus: [12729] }, { id: 6560, n: 1, link: plain, suffix: 1203 }, { id: 6560, n: 1, link: plain, suffix: -7, bonus: [100, 300] },
    { id: 6560, n: 1, link: plain }, { id: 6560, n: 1, link: plain }, { id: 6560, n: 1 }, { id: 6561, n: 1 }, { id: 6560, n: 1, link: plain },
  ], "a count that does not match its ids says nothing of a suffix; a full link and another item's link are not kept at all");
  assert.deepEqual(quest.rewards.items, [{ id: 6560, n: 1, link: plain, bonus: [12729] }, { id: 6560, n: 1, link: plain, suffix: 1203 }]);
  assert.deepEqual(quest.rewards.choices, [6560]);
  assert.deepEqual([vendor.items[0].link, vendor.items[0].bonus, vendor.items[0].suffix], [plain, [12729], undefined]);
  assert.equal(new Set(doc.observations.events.flatMap((e) => (e.items || []).concat(e.rewards ? e.rewards.items : [])).filter((i) => i.link).map((i) => i.link)).size, 1,
    "every suffix of the item carries the one link");
});

test("observations 3.15.0: a creature seen inside instances says where; installs add up; 8 places at most", () => {
  const { validateExport } = require("./validate_export");
  const a = npcFile(`{ [11671] = { lv = { 62, 62 }, cls = "elite", day = 20404, inst = { ["409:9"] = 3, ["409:0"] = 1, ["0:1"] = 5, ["409:x"] = 5, ["409:1"] = 0, junk = 2 } } }`, `prefix = "aa1100"`);
  const b = npcFile(`{ [11671] = { day = 20405, inst = { ["409:9"] = 2, ["249:2"] = 4 } } }`, `prefix = "bb2200"`);
  const one = convert.convertSavedVariables([a]).inventory;
  assert.deepEqual(validateExport(one), []);
  assert.deepEqual(one.observations.npcs, [{ npc: 11671, lv: [62, 62], cls: "elite", day: 20404, inst: [[409, 0, 1], [409, 9, 3]] }], "no cells: an instance has no world map place");
  assert.deepEqual(convert.convertSavedVariables([a, b]).inventory.observations.npcs[0].inst, [[249, 2, 4], [409, 0, 1], [409, 9, 5]]);
  const many = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`${100 + i}:1`, i + 1]));
  const capped = convert.exportObservations([{ prefix: "k1f9c2", npcs: { 5: { day: 20404, inst: many } } }]).npcs[0].inst;
  assert.deepEqual(capped.map((c) => c[0]), [104, 105, 106, 107, 108, 109, 110, 111], "the 8 most counted, by place");
});

test("inventory 3.15.0: every vendor of an item, the cheapest's day and limited stock; the three old fields unchanged; 2.x unmoved", () => {
  const { validateExport } = require("./validate_export");
  const file = `KutzInventoryDB = { chars = {}, prices = { sell = { [2320] = 2 }, ah = {}, vendor = {
    [2320] = { price = 10, vendor = "Made-up Trader", npc = 1250, t = 1762819200, limited = true,
               also = { ["Another Trader"] = { price = 12, npc = 1251, t = 1762732800 }, ["Third Trader"] = { price = 10, limited = true },
                        ["Bad|cffTrader"] = { price = 1 }, ["No Price"] = { npc = 5 }, ["Free"] = { price = 0, npc = 0, t = -5 } } },
    [2321] = { price = 100, vendor = "Old Entry", t = 1762819200 },
    [2322] = { price = 7 } } } }`;
  const doc = convert.convertSavedVariables([file]).inventory;
  assert.deepEqual(validateExport(doc), []);
  assert.deepEqual(doc.prices["2320"], { vendorBuy: 10, vendor: "Made-up Trader", vendorSell: 2, vendorDay: "2025-11-11", vendorLimited: true, vendors: [
    { name: "Free", price: 0 }, { name: "Made-up Trader", npc: 1250, price: 10, limited: true, day: "2025-11-11" }, { name: "Third Trader", price: 10, limited: true },
    { name: "Another Trader", npc: 1251, price: 12, day: "2025-11-10" }] });
  assert.deepEqual(doc.prices["2321"], { vendorBuy: 100, vendor: "Old Entry", vendorSell: null, vendorDay: "2025-11-11", vendors: [{ name: "Old Entry", price: 100, day: "2025-11-11" }] });
  assert.deepEqual(doc.prices["2322"], { vendorBuy: 7, vendor: null, vendorSell: null }, "a price with no vendor name has no list");
  assert.deepEqual(convert.convertSavedVariables([file], { format: 2 }).inventory.prices["2320"], { vendorBuy: 10, vendor: "Made-up Trader", vendorSell: 2 });
  // two account files: the same vendor's newest reading; the cheapest entry as before
  const other = `KutzInventoryDB = { chars = {}, prices = { sell = {}, ah = {}, vendor = { [2320] = { price = 9, vendor = "Another Trader", npc = 1251, t = 1762905600 } } } }`;
  const both = convert.convertSavedVariables([file, other]).inventory.prices["2320"];
  assert.deepEqual(both.vendors.find((v) => v.name === "Another Trader"), { name: "Another Trader", npc: 1251, price: 9, day: "2025-11-12" });
  assert.equal(both.vendors.filter((v) => v.name === "Another Trader").length, 1);
});

test("inventory 3.15.0: statistics per day ride beside the newest full list: changed values, the newest 30 days; 2.x has none", () => {
  const { validateExport } = require("./validate_export");
  const days = Array.from({ length: 35 }, (_, i) => `[${20370 + i}] = { [60] = ${i} }`).join(", ");
  const file = (statDays) => `KutzInventoryDB = { chars = { ["Examplemage-Example Realm"] = { name = "Examplemage", realm = "Example Realm", level = 24, lastSeen = 1762819200,
    statistics = { { id = 60, name = "Total deaths", category = "Deaths", value = 7 } }, statDays = ${statDays} } } }`;
  const doc = convert.convertSavedVariables([file(`{ [20403] = { [60] = 6, [61] = "1g 2s", [62] = "bad|cff", [63] = true, x = 1, [0] = 1 }, [20404] = { [60] = 7 },
    [20405] = {}, junk = { [60] = 1 }, [0] = { [60] = 1 } }`)]).inventory;
  assert.deepEqual(validateExport(doc), []);
  assert.deepEqual(doc.characters[0].statisticsDays, [{ day: 20403, values: [{ id: 60, value: 6 }, { id: 61, value: "1g 2s" }] }, { day: 20404, values: [{ id: 60, value: 7 }] }]);
  assert.ok(Array.isArray(doc.characters[0].statistics) && doc.characters[0].statistics.length === 1, "the full list is exported as before");
  const capped = convert.convertSavedVariables([file(`{ ${days} }`)]).inventory.characters[0].statisticsDays;
  assert.deepEqual([capped.length, capped[0].day, capped[29].day], [30, 20375, 20404]);
  assert.ok(!("statisticsDays" in convert.convertSavedVariables([file("{}")]).inventory.characters[0]) || convert.convertSavedVariables([file("{}")]).inventory.characters[0].statisticsDays == null);
  assert.equal(convert.convertSavedVariables([file(`{ ${days} }`)], { format: 2 }).inventory.characters[0].statisticsDays, undefined);
  assert.equal(convert.exportStatDays(null), null);
  assert.equal(convert.exportStatDays("junk"), null);
});

test("recipes not learned yet: the export is the same whether the saved file keeps them per character (1.20) or once per account file (1.21.0)", () => {
  const rec = (id, more = "") => `{ recipeID = ${id}, name = "Recipe ${id}", outputItemID = ${id + 1000}, source = "trainer", reagents = { { itemID = 2589, quantity = 2, name = "Linen Cloth" } }${more} }`;
  const char = (name, unlearned) => `["${name}-Example Realm"] = { name = "${name}", realm = "Example Realm", level = 24, lastSeen = 1762819200,
    recipes = { Tailoring = { professionID = 197, skill = 60, recipes = { ${rec(1)} }, ${unlearned} } } }`;
  const old = `KutzInventoryDB = { chars = { ${char("Exampleone", `unlearned = { ${rec(10)}, ${rec(11)}, ${rec(12)} }`)},
    ${char("Exampletwo", `unlearned = { ${rec(11)}, ${rec(12, `, makesMax = 2`)}, ${rec(10)}, ${rec(10)} }`)} } }`;
  const shared = `KutzInventoryDB = { recipeBook = { [10] = ${rec(10)}, [11] = ${rec(11)}, [12] = ${rec(12)} }, chars = {
    ${char("Exampleone", `unlearnedIds = { 10, 11, 12 }`)},
    ${char("Exampletwo", `unlearnedIds = { 11, ${rec(12, `, makesMax = 2`)}, 10, ${rec(10)}, 99, "junk" }`)} } }`;
  const sorted = (v) => (Array.isArray(v) ? v.map(sorted) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v);
  for (const format of [2, 3]) {
    const [a, b] = [old, shared].map((text) => {
      const all = convert.convertSavedVariables([text], { format });
      delete all.inventory.exportedAt;
      return sorted(JSON.parse(JSON.stringify(all)));
    });
    assert.deepEqual(b, a, "format " + format);
    const two = a.inventory.characters.find((c) => c.name === "Exampletwo").recipes[0].unlearned;
    assert.deepEqual(two.map((u) => [u.recipeID, u.makesMax]), [[11, undefined], [12, 2], [10, undefined], [10, undefined]], "each list in its own order; an id the file does not hold is skipped");
  }
  // each account file's ids are read against its own shared records
  const otherAccount = `KutzInventoryDB = { recipeBook = { [10] = ${rec(10, `, makesMax = 5`)} }, chars = { ${char("Examplethree", `unlearnedIds = { 10 }`)} } }`;
  const merged = convert.convertSavedVariables([shared, otherAccount]).inventory.characters;
  assert.equal(merged.find((c) => c.name === "Examplethree").recipes[0].unlearned[0].makesMax, 5);
  assert.equal(merged.find((c) => c.name === "Exampleone").recipes[0].unlearned[0].makesMax, undefined);
});

test("observations 3.15.0: saved-only last-met stamp m is never exported, day comes from d, and old entries without m still load", () => {
  const { validateExport } = require("./validate_export");
  const doc = convert.convertSavedVariables([factsFile(`itemBuilds = { "1.60.1.71037" }, items = {
    [2589] = { d = 20403, m = 20410, b = 1, f = "1:0:7:5:5:0::", n = "Linen Cloth" },
    [4306] = { d = 20404, b = 1, f = "1:0:7:5:25:0::", n = "Silk Cloth" } }`)]).inventory;
  assert.deepEqual(validateExport(doc), []);
  const items = doc.observations.items;
  assert.deepEqual(items, [
    { id: 2589, day: 20403, build: "1.60.1.71037", name: "Linen Cloth", q: 1, bind: 0, cls: 7, sub: 5, ilvl: 5, req: 0 },
    { id: 4306, day: 20404, build: "1.60.1.71037", name: "Silk Cloth", q: 1, bind: 0, cls: 7, sub: 5, ilvl: 25, req: 0 },
  ]);
  for (const it of items) assert.equal("m" in it, false, "m must never be exported");
  // Merging two files compares changed day (d), not last-met day (m)
  const fileA = factsFile(`itemBuilds = { "1.60.1.71037" }, items = { [2589] = { d = 20403, m = 20420, b = 1, f = "1:0:7:5:5:0::", n = "Old Text" } }`, `prefix = "aa1100"`);
  const fileB = factsFile(`itemBuilds = { "1.60.1.71100" }, items = { [2589] = { d = 20405, m = 20405, b = 1, f = "1:0:7:5:5:0::", n = "New Text" } }`, `prefix = "bb2200"`);
  const merged = convert.convertSavedVariables([fileA, fileB]).inventory;
  assert.deepEqual(validateExport(merged), []);
  assert.deepEqual(merged.observations.items, [
    { id: 2589, day: 20405, build: "1.60.1.71100", name: "New Text", q: 1, bind: 0, cls: 7, sub: 5, ilvl: 5, req: 0 },
  ]);
});

test("observations 3.15.0: realistic sizes: a full item table of the addon (200 kB saved) and 30 days of kills", () => {
  const items = {};
  for (let i = 1; i <= 700; i++) {
    items[i] = { d: 20404, b: 1, f: "2:2:4:6:25:20::INVTYPE_SHIELD", s: "ITEM_MOD_STAMINA_SHORT=3,RESISTANCE0_NAME=478",
      t: ["-Made-up Shield " + i, "-Binds when equipped", "-Off Hand", ">Shield", "-478 Armor", "-+3 Stamina", "-Durability 65 / 65", "!Requires Level 20",
          "-Equip: Increases the block value of your shield by 10."].join("\n"),
      v: i % 10 === 0 ? { "0;12729": "Made-up Shield " + i + " of Intellect\nITEM_MOD_INTELLECT_SHORT=5,RESISTANCE0_NAME=478" } : undefined };
  }
  const kills = {};
  for (let d = 0; d < 30; d++) { kills[20375 + d] = {}; for (let i = 1; i <= 26; i++) kills[20375 + d][(1000 + i) + ":" + (10 + (i % 5))] = 3; }
  const obs = convert.exportObservations([{ addon: "1.21.0", prefix: "k1f9c2", itemBuilds: { 1: "1.60.1.71037" }, items, kills }]);
  const itemBytes = JSON.stringify(obs.items).length, killBytes = JSON.stringify(obs.kills).length;
  assert.equal(obs.items.length, 700);
  assert.equal(obs.kills.length, 780);
  assert.ok(itemBytes < 320000, "700 items: " + itemBytes);
  assert.ok(killBytes < 40000, "780 kill counts: " + killBytes);
});

test("questLog 3.15.0: current quest log exports in order, sanitized and bounded; empty vs absent; 2.x omits it", () => {
  const { validateExport } = require("./validate_export");
  const lua = `KutzInventoryDB = { chars = {
    ["First-Realm"] = { name = "First", realm = "Realm", questLog = {
      at = 1762905600, extra = "dropped",
      quests = {
        { id = 33, title = "  Wolves for $N  ", lv = 5, header = "Elwynn Forest", extra = 1,
          obj = { { text = "Tough Wolf Meat: 3/8", have = 3, need = 8, done = false, type = "item", bonus = 1 },
                  { text = "Speak with Marshal", done = true, type = "event" },
                  { text = "Bad|markup", done = false },
                  { text = "Missing done", have = 1, need = 2 },
                  { text = "Bad optional", have = -1, need = 1.5, done = false, type = "UPPER" } } },
        { id = 33, title = "Duplicate ID dropped", obj = {} },
        { id = 0, title = "Zero ID dropped", obj = {} },
        { id = 463, title = "The Greenwarden", lv = 256, header = "|cffBad|r", done = true, obj = {} },
        { id = 500, title = "Timed Escort", lv = 18, header = "Wetlands", done = true, failed = true, obj = {} },
      },
    } },
    ["Empty-Realm"] = { name = "Empty", realm = "Realm", questLog = { at = 1762905601, quests = {} } },
    ["Old-Realm"] = { name = "Old", realm = "Realm" },
    ["Broken-Realm"] = { name = "Broken", realm = "Realm", questLog = { at = 0, quests = {} } },
  } }`;
  const v3 = convert.convertSavedVariables([lua]).inventory;
  const v2 = convert.convertSavedVariables([lua], { format: 2 }).inventory;
  const by = (doc, k) => doc.characters.find((c) => c.key === k);
  assert.deepEqual(by(v3, "First-Realm").questLog, {
    at: 1762905600,
    quests: [
      { id: 33, title: "Wolves for $N", lv: 5, header: "Elwynn Forest",
        obj: [{ text: "Tough Wolf Meat: 3/8", have: 3, need: 8, done: false, type: "item" },
              { text: "Speak with Marshal", done: true, type: "event" },
              { text: "Bad optional", done: false }] },
      { id: 463, title: "The Greenwarden", done: true, obj: [] },
      { id: 500, title: "Timed Escort", lv: 18, header: "Wetlands", failed: true, obj: [] },
    ],
  });
  assert.deepEqual(by(v3, "Empty-Realm").questLog, { at: 1762905601, quests: [] }, "recorded empty log keeps quests: []");
  assert.ok(!("questLog" in by(v3, "Old-Realm")), "absent when not recorded");
  assert.ok(!("questLog" in by(v3, "Broken-Realm")), "invalid snapshot dropped");
  for (const c of v2.characters) assert.ok(!("questLog" in c), "2.x never carries questLog: " + c.key);
  // caps: 35 quests and 12 objectives
  const manyQ = Array.from({ length: 40 }, (_, i) => ({
    id: i + 1, title: "Quest " + (i + 1),
    obj: Array.from({ length: 15 }, (_, j) => ({ text: "Obj " + (j + 1), have: j, need: 15, done: false, type: "monster" })),
  }));
  const capped = convert.exportQuestLog({ at: 1762905600, quests: manyQ });
  assert.equal(capped.quests.length, 35);
  assert.equal(capped.quests[34].id, 35);
  assert.equal(capped.quests[0].obj.length, 12);
  assert.equal(capped.quests[0].obj[11].text, "Obj 12");
  // schema accepts exported examples and capped questLog; 2.x schema rejects questLog
  const ex3 = convert.convertSavedVariables([LUA]).inventory;
  assert.deepEqual(validateExport(ex3), []);
  ex3.characters[0].questLog = capped;
  assert.deepEqual(validateExport(ex3), []);
  const ex2 = convert.convertSavedVariables([LUA], { format: 2 }).inventory;
  ex2.characters[0].questLog = capped;
  assert.ok(validateExport(ex2).length > 0, "2.x schema refuses questLog");
});

test("legacyChallenges 3.16.0: per-character Legacy challenges, sanitized, sorted and bounded; absent when not recorded; 2.x omits it", () => {
  const { validateExport } = require("./validate_export");
  const lua = `KutzInventoryDB = { chars = {
    ["First-Realm"] = { name = "First", realm = "Realm", updated = { legacyChallenges = 1762905600 }, legacyChallenges = {
      at = 1762905600, extra = "dropped",
      list = {
        { id = 62054, set = 60, completed = false, wasEarnedByMe = false, date = "2026-11-23",
          criteria = { { id = 3001, completed = false, quantity = 7, reqQuantity = 25, extra = 1 }, { id = 3002, completed = false, quantity = -1, reqQuantity = 1.5 },
                       { completed = true }, { id = 3003, completed = "yes" }, { id = 3001, completed = true } } },
        { id = 684, set = 60, completed = true, wasEarnedByMe = true, earnedBy = "First", date = "2026-03-14",
          criteria = { { id = 1001, completed = true, quantity = 1, reqQuantity = 1 } } },
        { id = 61502, set = 60, completed = true, wasEarnedByMe = "no", earnedBy = "Bad|name", date = "2026-02-29", criteria = {} },
        { id = 63969, set = 61, completed = true, earnedBy = "", date = "2024-02-29", criteria = {} },
        { id = 684, set = 60, completed = false, criteria = {} },
        { id = 62000, set = 61, completed = true, criteria = {} },
        { id = 63970, set = 60, completed = true, criteria = {} },
        { id = 63971, set = 62, completed = true, criteria = {} },
        { id = 63972, set = 61, criteria = {} },
        { id = 0, set = 60, completed = true, criteria = {} },
      },
    } },
    ["Old-Realm"] = { name = "Old", realm = "Realm" },
    ["Broken-Realm"] = { name = "Broken", realm = "Realm", legacyChallenges = { at = 0, list = { { id = 684, set = 60, completed = true, criteria = {} } } } },
    ["Empty-Realm"] = { name = "Empty", realm = "Realm", legacyChallenges = { at = 1762905600, list = { { id = 0, set = 60, completed = true } } } },
  } }`;
  const v3 = convert.convertSavedVariables([lua]).inventory;
  const v2 = convert.convertSavedVariables([lua], { format: 2 }).inventory;
  const by = (doc, k) => doc.characters.find((c) => c.key === k);
  assert.deepEqual(by(v3, "First-Realm").legacyChallenges, {
    at: 1762905600,
    list: [
      { id: 684, set: 60, completed: true, wasEarnedByMe: true, earnedBy: "First", date: "2026-03-14",
        criteria: [{ id: 1001, completed: true, quantity: 1, reqQuantity: 1 }] },
      { id: 61502, set: 60, completed: true, criteria: [] },
      { id: 62054, set: 60, completed: false, wasEarnedByMe: false,
        criteria: [{ id: 3001, completed: false, quantity: 7, reqQuantity: 25 }, { id: 3002, completed: false }] },
      { id: 63969, set: 61, completed: true, date: "2024-02-29", criteria: [] },
    ],
  });
  assert.equal(by(v3, "First-Realm").updated.legacyChallenges, "2025-11-12T00:00:00.000Z");
  for (const k of ["Old-Realm", "Broken-Realm", "Empty-Realm"]) assert.ok(!("legacyChallenges" in by(v3, k)), "absent: " + k);
  for (const c of v2.characters) assert.ok(!("legacyChallenges" in c), "2.x never carries legacyChallenges: " + c.key);
  // caps: 130 entries, 40 criteria each
  const many = Array.from({ length: 140 }, (_, i) => ({ id: 140 - i, set: 60, completed: false,
    criteria: Array.from({ length: 45 }, (_, j) => ({ id: j + 1, completed: false, quantity: j, reqQuantity: 45 })) }));
  const capped = convert.exportLegacyChallenges({ at: 1762905600, list: many });
  assert.equal(capped.list.length, 130);
  assert.deepEqual([capped.list[0].id, capped.list[129].id], [1, 130]);
  assert.equal(capped.list[0].criteria.length, 40);
  // the schema: valid as exported and capped; broken shapes refused; 2.x refuses the field
  const ex3 = convert.convertSavedVariables([LUA]).inventory;
  ex3.characters[0].legacyChallenges = by(v3, "First-Realm").legacyChallenges;
  assert.deepEqual(validateExport(ex3), []);
  ex3.characters[0].legacyChallenges = capped;
  assert.deepEqual(validateExport(ex3), []);
  const good = { id: 684, set: 60, completed: true, criteria: [] };
  for (const bad of [{ at: 1, list: [] }, { at: 1, list: [{ ...good, set: 62 }] }, { at: 1, list: [{ ...good, date: "2026-13-01" }] },
                     { at: 1, list: [{ ...good, completed: false, date: "2026-01-01" }] }, { at: 1, list: [{ ...good, earnedBy: "" }] },
                     { at: 1, list: [{ ...good, criteria: [{ id: 1 }] }] }, { at: 1, list: [{ ...good, criteria: [{ id: 1, completed: true, quantity: -1 }] }] },
                     { at: 1, list: [{ ...good, extra: 1 }] }, { list: [good] }]) {
    ex3.characters[0].legacyChallenges = bad;
    assert.ok(validateExport(ex3).length, "schema rejected " + JSON.stringify(bad));
  }
  const ex2 = convert.convertSavedVariables([LUA], { format: 2 }).inventory;
  ex2.characters[0].legacyChallenges = capped;
  assert.ok(validateExport(ex2).length > 0, "2.x schema refuses legacyChallenges");
});
