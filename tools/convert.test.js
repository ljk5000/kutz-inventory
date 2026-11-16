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
  assert.equal(k.SCHEMA_VERSION_3, "3.8.0");
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
  assert.equal(obs.v, 1); assert.equal(obs.addon, "1.8.0");
  assert.deepEqual(Object.keys(convert.convertSavedVariables([LUA]).inventory).slice(-2), ["raids", "observations"]);
  assert.deepEqual(obs.events.map((e) => e.id.slice(-2) + e.type + (e.act || "")),
    ["17loot", "18loot", "19loot", "20questaccept", "21questturnin", "22vendor"]);
  assert.deepEqual(obs.events[0], { id: "k1f9c2-000017", t: 1762905600, b: "1.60.1.70888", type: "loot",
    src: { kind: "boss", npc: 11502, guid: "Creature-0-4170-409-1234-11502-000012ABCD", via: "slot" },
    where: { map: 409, uiMap: 232, itype: "raid", difficulty: 9 },
    who: { level: 60, class: 4, faction: "Alliance", name: "Exampleobserver", surname: "Examplefamily" },
    items: [{ id: 17076, n: 1, link: "|cffff8000|Hitem:17076|h[Bonereaver's Edge]|h|r" }, { id: 18264, n: 2 }] }, "a link for another id is dropped");
  assert.deepEqual(obs.events[1].items, [], "a coins-only corpse is an open with no items");
  assert.deepEqual(obs.events[4].rewards, { items: [{ id: 19019, n: 1 }], choices: [19018, 19019], chose: 19019 });
  assert.deepEqual(obs.events[5].items, [{ id: 19326, n: 1, link: "|cffa335ee|Hitem:19326|h[Made-up Cloak]|h|r", price: 0,
    cost: [{ item: 17010, n: 1 }], limited: null },
    { id: 4470, n: 1, price: 38, limited: 5 }]);
  assert.ok(!("observations" in convert.convertSavedVariables([LUA], { format: 2 }).inventory), "2.x must not change");
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
    who: { level: 60, class: 4, faction: "Alliance", name: "Tester" }, rewards: { items: [], choices: [1, 2] } },
    "who keeps the character's own name (3.3.0); a surname with game markup and any GUID go");
  assert.deepEqual(vendor.items, [{ id: 4, n: 1, price: 7, limited: null }]);
  assert.deepEqual(inside.where, { map: 409, itype: "raid", difficulty: 9 }, "no x/y inside an instance");
  assert.deepEqual(inside.src, { kind: "mob", npc: 7, guid: "Creature-0-1-0-1-7-AB" });
  assert.ok(!/money|gold|Player-|Bob|hello/.test(JSON.stringify(obs)));
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
  assert.equal(convert.SCHEMA_VERSION_3, "3.8.0");
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
