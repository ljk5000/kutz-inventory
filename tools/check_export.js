// Offline checks for the inventory exporter: uiHealth merge, and --upload failing clearly
// without sending anything (and without printing a token).
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const script = path.join(__dirname, "inventory_export.js");
const TOKEN = "super-secret-token-xyz";

function write(dir, name, body) {
    const p = path.join(dir, name);
    fs.writeFileSync(p, body);
    return p;
}

function run(args, env) {
    return spawnSync(process.execPath, [script, ...args], {
        encoding: "utf8",
        env: { ...process.env, ...env },
    });
}

function fail(msg) {
    console.error("FAIL  " + msg);
    process.exit(1);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kutz-export-"));
const inv = write(dir, "KutzInventory.lua", `
KutzInventoryDB = {
  chars = {
    ["Tester-Realm"] = {
      name = "Tester", realm = "Realm", level = 12, class = "Warrior", classFile = "WARRIOR", race = "Human",
      faction = "Alliance", sex = 2, guid = "Player-1-00ABCDEF", money = 12345, xp = 10, xpMax = 100, lastSeen = 1700000000,
      location = { zone = "Elwynn Forest", subzone = "Goldshire", mapID = 1429, x = 42.1, y = 65.3 },
      hearth = "Stormwind City",
      updated = { bags = 1700000000 },
      bags = { [0] = { name = "Backpack", size = 16, items = { [1] = { id = 2589, count = 5, name = "Linen Cloth", quality = 1 } } } },
      equipped = { [16] = { id = 25, name = "Worn Shortsword", slot = "MainHandSlot", stats = { ITEM_MOD_STRENGTH_SHORT = 1 } } },
      recipes = { Tailoring = { professionID = 197, skill = 10, max = 75, updated = 1700000000,
        recipes = { { recipeID = 2385, name = "Brown Linen Vest", difficulty = 0, outputItemID = 2568, makesMin = 1,
                      reagents = { { itemID = 2996, name = "Bolt of Linen Cloth", quantity = 1 } } } } } },
    },
  },
  prices = { vendor = { ["2996"] = { price = 40, vendor = "Someone" } }, sell = { ["2568"] = 20 },
             ah = { ["Realm|horde"] = {
               [2568] = { p = { 30, 35, 40 }, q = { 1, 2, 1 }, n = 4, t = 1700000100 },
               [2996] = { p = {}, q = {}, n = 0, t = 1700000100 },
               [4306] = { p = { 99 }, q = { 1 }, n = 1, t = 1600000000 },      -- an older scan's reading: not sent
             } },
             scans = { ["Realm|horde"] = { startedAt = 1700000000, finishedAt = 1700000200, method = "search", complete = false,
                                           queued = 3, answered = 2, houseSource = "npc", addonVersion = "1.3.0", region = 1 } } },
  uiHealth = {
    updated = 100, game = "old",
    session = { errors = 1, blocked = 9 },
    findings = { { rank = 1, tag = "ERRORS", score = 10, addon = "Old", text = "old one" } },
    errors = {}, blocked = {}, memoryGrowth = {}, history = {},
  },
}
`);
write(dir, "KutzUI.lua", `
KutzUIDB = {
  monitor = { findings = {
    updated = 1700000000, game = "1.60.1",
    session = {
      started = 1700000000, ended = 1700000600, minutes = 10, fps = 60,
      errors = 2, errorsOmitted = 0, blocked = 1, hitches = 0, hitchesInCombat = 0,
      worstMs = 0, addonsLoaded = 3, cpuProfiling = false,
    },
    findings = { { rank = 1, tag = "BLOCKED", score = 801, addon = "Foo", text = "Foo: 1 blocked" } },
    errors = { { addon = "Foo", count = 2, message = "boom", throughBlizzard = false, first = 1700000000, last = 1700000500, inCombat = true, stack = "Foo.lua:1" } },
    blocked = { { addon = "Foo", kind = "blocked", fn = "TargetUnit", count = 1 } },
    memoryGrowth = { { addon = "Foo", kbPerHour = 800, kb = 12000 } },
    history = { { started = 1690000000, minutes = 30, fps = 80, errors = 0, errorAddons = "", blocked = 0, hitches = 1, worstMs = 110, cpuTop = "" } },
  } },
}
`);
const out = path.join(dir, "out.json");
const ok = run([inv, out, "--format", "2"], { WOW_IMPORT_TOKEN: "", WOW_IMPORT_URL: "" }); // the 2.x checks below
if (ok.status !== 0) fail("export of a fixture failed:\n" + ok.stdout + ok.stderr);
const data = JSON.parse(fs.readFileSync(out, "utf8"));
const uh = data.uiHealth;
if (!uh || uh.game !== "1.60.1") fail("sibling KutzUI.lua findings did not win: " + JSON.stringify(uh && uh.game));
if (uh.updatedAt !== "2023-11-14T22:13:20.000Z") fail("updatedAt was not the ISO time of the newer stamp: " + uh.updatedAt);
if (!uh.findings[0] || uh.findings[0].tag !== "BLOCKED" || uh.findings[0].addon !== "Foo") fail("findings shape");
if (!uh.errors[0] || uh.errors[0].inCombat !== true || uh.errors[0].message !== "boom") fail("errors shape");
if (!uh.blocked[0] || uh.blocked[0].fn !== "TargetUnit" || uh.blocked[0].kind !== "blocked") fail("blocked shape");
if (!uh.memoryGrowth[0] || uh.memoryGrowth[0].kbPerHour !== 800) fail("memoryGrowth shape");
if (!uh.history[0] || uh.history[0].worstMs !== 110) fail("history shape");
if (uh.session.errors !== 2 || uh.session.cpuProfiling !== false) fail("session shape");

// The export format contract (schema/inventory-export.schema.json).
const { validateExport, validateAuctionScan } = require("./validate_export");
const { SCHEMA_VERSION } = require("./inventory_export");
if (data.schemaVersion !== SCHEMA_VERSION) fail("schemaVersion missing or wrong: " + data.schemaVersion);
if (data.characters.length !== 1 || "crafting" in data.characters[0]) fail("inventory 2.x must not carry characters[].crafting");
for (const [id, p] of Object.entries(data.prices)) if (Object.keys(p).sort().join() !== "vendor,vendorBuy,vendorSell") fail("prices[" + id + "] is not vendor-only: " + Object.keys(p));
// the local profit report still works (material 2996 costs 40 at the vendor)
const all = require("./inventory_export").buildAll([require("./inventory_export").plain(require("./inventory_export").parseSavedVariables(fs.readFileSync(inv, "utf8")).KutzInventoryDB)], null);
if (all.report[0].crafting[0].recipes[0].materialCost !== 40) fail("local crafting report");
// auction-scans.json: one document for Realm|horde with the scan's items only
const scans = JSON.parse(fs.readFileSync(path.join(dir, "auction-scans.json"), "utf8"));
if (scans.length !== 1) fail("expected one auction-scan document, got " + scans.length);
const a = scans[0];
if (a.realm !== "Realm" || a.house !== "horde" || a.region !== "us" || a.houseSource !== "npc" || a.complete !== false || a.method !== "search") fail("auction-scan header: " + JSON.stringify(a).slice(0, 200));
if (a.scannedAt !== "2023-11-14T22:16:40.000Z" || a.startedAt !== "2023-11-14T22:13:20.000Z") fail("auction-scan times");
if (!a.items["2568"] || a.items["2568"].p[0] !== 30 || !a.items["2996"] || a.items["2996"].p.length !== 0 || a.items["4306"]) fail("auction-scan items");
if (JSON.stringify(a).includes("Tester") || JSON.stringify(a).includes("Player-")) fail("auction-scan names a character");
const ap = validateAuctionScan(a);
if (ap.length) fail("auction scan does not match the schema:\n  " + ap.slice(0, 20).join("\n  "));
if (validateAuctionScan({ ...a, house: "goblin" }).length === 0) fail("the auction-scan schema accepted a bad house");
// The committed synthetic example must stay valid.
for (const ex of fs.readdirSync(path.join(__dirname, "..", "schema", "examples")).filter((f) => f.endsWith(".json"))) {
    const exProblems = require("./validate_export").validateAny(JSON.parse(fs.readFileSync(path.join(__dirname, "..", "schema", "examples", ex), "utf8")));
    if (exProblems.length) fail("schema/examples/" + ex + " does not match the schema:\n  " + exProblems.slice(0, 10).join("\n  "));
}
// a whole-AH scan: scope "all" and the item class / subclass reach the document, and it is valid
{
    const whole = require("./inventory_export").buildAll([{ chars: {}, prices: { vendor: {}, sell: {}, ah: { "R|horde": { 2589: { p: { 1: 18 }, q: { 1: 40 }, n: 3, t: 20, c: 7, s: 5, name: "Peacebloom", supply: {complete: true, lots: {1: {1: 720, 2: 40, 3: 1, 4: ""}}} }, 7913: { p: { 1: 500 }, q: { 1: 1 }, n: 1, t: 20, c: 4, s: 4, e: "INVTYPE_HEAD" }, 2590: { p: { 1: 9 }, q: { 1: 1 }, n: 1, t: 20, name: "|cffff0000Bad|r" } } },
        scans: { "R|horde": { startedAt: 19, finishedAt: 21, method: "full", complete: true, queued: 3, answered: 3, houseSource: "npc", scope: "all", rows: 3, addonVersion: "1.4.0", region: 1 } } } }], null).auctions[0];
    if (!whole || whole.scope !== "all" || whole.schemaVersion !== "1.2.0" || whole.items["2589"].c !== 7 || whole.items["2589"].s !== 5 || whole.items["2589"].name !== "Peacebloom" || "name" in whole.items["2590"] || whole.items["7913"].e !== "INVTYPE_HEAD" || "e" in whole.items["2589"]) fail("whole-AH scan document: " + JSON.stringify(whole));
    if (JSON.stringify(whole.items["2589"].supply) !== JSON.stringify({complete: true, lots: [[720,40,1,""]]})) fail("supply was lost or changed");
    const wp = validateAuctionScan(whole);
    if (wp.length) fail("whole-AH scan does not match the schema: " + wp.join("; "));
}
// the legacy rule: no method, empty readings left out
{
    const legacyAll = require("./inventory_export").buildAll([{ chars: {}, prices: { vendor: {}, sell: {}, ah: { "R|alliance": { 1: { p: { 1: 5 }, q: { 1: 2 }, n: 1, t: 10 }, 2: { p: {}, q: {}, n: 0, t: 11 } } },
        scans: { "R|alliance": { startedAt: 10, finishedAt: 11, method: "legacy", complete: false, queued: 2, answered: 2, houseSource: "player" } } } }], null);
    const l = legacyAll.auctions[0];
    if (!l || "method" in l || !l.items["1"] || l.items["2"]) fail("legacy scan: method must be left out and empty readings dropped: " + JSON.stringify(l));
}
const problems = validateExport(data);
if (problems.length) fail("export does not match the schema:\n  " + problems.slice(0, 20).join("\n  "));
// ...and the schema really rejects a broken export, so a pass above means something.
const broken = JSON.parse(JSON.stringify(data));
delete broken.characters[0].key;
broken.characters[0].money = "lots";
broken.surprise = true;
if (validateExport(broken).length < 3) fail("the schema accepted a broken export");

// Inventory 3.x: only what the Battle.net API cannot see. The default since cr0m reads 3.x; --format 2 keeps 2.x.
{
    const { SCHEMA_VERSION_3, DROPPED_IN_3 } = require("./inventory_export");
    const out3 = path.join(dir, "out3.json");
    const r3 = run([inv, out3, "--format", "3"], { WOW_IMPORT_TOKEN: "", WOW_IMPORT_URL: "" });
    if (r3.status !== 0) fail("--format 3 export failed:\n" + r3.stdout + r3.stderr);
    const data3 = JSON.parse(fs.readFileSync(out3, "utf8"));
    if (data3.schemaVersion !== SCHEMA_VERSION_3 || !/^3\./.test(SCHEMA_VERSION_3)) fail("--format 3 wrote schemaVersion " + data3.schemaVersion);
    if (data.schemaVersion !== SCHEMA_VERSION || !/^2\./.test(SCHEMA_VERSION)) fail("--format 2 did not write 2.x: " + data.schemaVersion);
    // No flag (the CLI and the Companion's exportAll call) writes 3.x now that cr0m reads it.
    const outDefault = path.join(dir, "out-default.json");
    const rd = run([inv, outDefault], { WOW_IMPORT_TOKEN: "", WOW_IMPORT_URL: "" });
    if (rd.status !== 0 || JSON.parse(fs.readFileSync(outDefault, "utf8")).schemaVersion !== SCHEMA_VERSION_3) fail("the default format is not 3.x");
    const viaApi = require("./inventory_export").exportAll([inv], path.join(dir, "out-api.json"));
    if (!viaApi || JSON.parse(fs.readFileSync(path.join(dir, "out-api.json"), "utf8")).schemaVersion !== SCHEMA_VERSION_3) {
        fail("exportAll without options (the Companion's call) did not write 3.x");
    }
    const c3 = data3.characters[0], c2 = data.characters[0];
    for (const k of DROPPED_IN_3) if (k in c3) fail("inventory 3.x still carries characters[]." + k);
    for (const k of ["key", "name", "realm", "level", "class", "race", "faction", "money", "xp", "xpMax", "location", "containers", "recipes", "lastSeen"]) {
        if (JSON.stringify(c3[k]) !== JSON.stringify(c2[k])) fail("inventory 3.x changed characters[]." + k);
    }
    if (c3.hearth !== "Stormwind City") fail("inventory 3.x does not carry characters[].hearth: " + JSON.stringify(c3.hearth));
    if ("hearth" in c2) fail("inventory 2.x carries characters[].hearth");
    if (JSON.stringify(c3.equipped) !== JSON.stringify([{ slotId: 16, id: 25 }])) fail("3.x equipped is not the minimal list: " + JSON.stringify(c3.equipped));
    if (JSON.stringify(data3.prices) !== JSON.stringify(data.prices) || JSON.stringify(data3.guildBanks) !== JSON.stringify(data.guildBanks)) fail("3.x changed prices or guild banks");
    const p3 = validateExport(data3);
    if (p3.length) fail("inventory 3.x does not match its schema:\n  " + p3.slice(0, 20).join("\n  "));
    // Every dropped field is rejected by the 3.x schema, so an exporter can't send them by mistake.
    const sample = { spec: "Fire", role: "DAMAGER", stats: { strength: 1 }, sheet: {}, talents: { system: "tabs" }, reputation: [],
        statistics: [], achievementPoints: 10, pvp: { honorableKills: 1 } };
    for (const k of DROPPED_IN_3) {
        if (!(k in sample)) fail("no sample value for dropped field " + k);
        const withIt = JSON.parse(JSON.stringify(data3));
        withIt.characters[0][k] = sample[k];
        if (!validateExport(withIt).some((p) => p.includes(k))) fail("the 3.x schema accepted characters[]." + k);
    }
    const richGear = JSON.parse(JSON.stringify(data3));
    richGear.characters[0].equipped[0].name = "Worn Shortsword";
    if (!validateExport(richGear).length) fail("the 3.x schema accepted an equipped item with details beyond slotId, id and link");
    const oldStamp = JSON.parse(JSON.stringify(data3));
    oldStamp.characters[0].updated.stats = "2023-11-14T22:13:20.000Z";
    if (!validateExport(oldStamp).length) fail("the 3.x schema accepted updated.stats");
    if (!validateExport({ ...data3, schemaVersion: "2.0.0" }).length) fail("the 2.x schema accepted a 3.x document");
    // 3.1.0 raids: an empty list here; a good raid is valid, a bad string / unknown kind / extra field is not, and 3.0.0
    // documents (no raids) stay valid
    if (JSON.stringify(data3.raids) !== "[]" || "raids" in data) fail("raids: 3.x must carry [] here and 2.x none");
    const { raids: _r, ...noRaids } = data3;
    if (validateExport({ ...noRaids, schemaVersion: "3.0.0" }).length) fail("a 3.0.0 document without raids is no longer valid");
    const raid = { string: "KR1.ABC234.409.1767225600.ABCDEFGHJKMN", events: [
        { t: "2026-01-01T00:00:00.000Z", kind: "start", instanceId: 409, instanceName: "Molten Core", by: "Tester-Realm" },
        { t: "2026-01-01T00:10:00.000Z", kind: "encounter_end", encounterId: 663, success: true },
        { t: "2026-01-01T00:11:00.000Z", kind: "loot", itemId: 16800, count: 1, looter: "Tester-Realm" },
        { t: "2026-01-01T00:11:00.000Z", kind: "roster", members: ["Tester-Realm"] }] };
    const withRaid = (r) => ({ ...data3, raids: [r] });
    const rp = validateExport(withRaid(raid));
    if (rp.length) fail("a good raid does not match the 3.x schema:\n  " + rp.join("\n  "));
    const badRaids = [
        { ...raid, string: "KR1.ABC231.409.1767225600.ABCDEFGHJKMN" },
        { ...raid, events: [] },
        { ...raid, events: [{ t: "2026-01-01T00:00:00.000Z", kind: "teleport" }] },
        { ...raid, events: [{ ...raid.events[1], success: undefined }] },
        { ...raid, events: [{ ...raid.events[2], guid: "Player-1" }] },
        { ...raid, extra: 1 },
    ];
    badRaids.forEach((r, n) => { if (!validateExport(JSON.parse(JSON.stringify(withRaid(r)))).length) fail("the 3.x schema accepted bad raid #" + n); });
    // 3.2.0 observations: absent without drop tracking; a good section is valid; money, player GUIDs, extra keys are not
    if ("observations" in data3 || "observations" in data) fail("observations: absent when nothing was recorded");
    const who = { level: 60, class: 4, faction: "Alliance" };
    const obsEvents = [
        { id: "k1f9c2-000017", t: 1762905600, b: "1.60.1.70888", type: "loot", src: { kind: "mob", npc: 2958,
          guid: "Creature-0-4170-0-1234-2958-000012ABCE", level: 14, via: "slot" }, where: { map: 0, uiMap: 1429, x: 0.4123, y: 0.6543 }, who, items: [] },
        { id: "k1f9c2-000018", t: 1762905700, type: "quest", act: "turnin", quest: 7787, npc: 11811, where: {}, who,
          rewards: { items: [{ id: 19019, n: 1 }], choices: [19018, 19019], chose: 19019 } },
        { id: "k1f9c2-000019", t: 1762905800, type: "vendor", npc: 12944, where: { map: 0 }, who,
          items: [{ id: 19326, n: 1, price: 0, cost: [{ item: 17010, n: 1 }, { currency: 1792, n: 300 }], limited: null },
                 { id: 4470, n: 1, price: 38, limited: 5 }] },
    ];
    const withObs = (o) => ({ ...data3, observations: o });
    const goodObs = { v: 1, addon: "1.8.0", events: obsEvents };
    const op = validateExport(withObs(goodObs));
    if (op.length) fail("good observations do not match the 3.x schema:\n  " + op.join("\n  "));
    if (validateExport({ ...data3, schemaVersion: "3.1.0" }).length) fail("a 3.1.0 document without observations is no longer valid");
    if (validateExport({ ...data3, schemaVersion: "3.2.0", observations: goodObs }).length) fail("a 3.2.0 document (no links, no names) is no longer valid");
    // 3.3.0: the recorder's own name and surname in who, short item links on loot, quest reward and vendor items
    const named = { ...who, name: "Exampleobserver", surname: "Examplefamily" }, link = "|cffa335ee|Hitem:19019|h[Thunderfury, Blessed Blade]|h|r";
    const linked = { ...goodObs, events: [
      { ...obsEvents[0], who: named, items: [{ id: 19019, n: 1, link }] },
      { ...obsEvents[1], who: named, rewards: { items: [{ id: 19019, n: 1, link }], choices: [19018], chose: 19018 } },
      { ...obsEvents[2], items: [{ id: 19019, n: 1, link, price: 0, limited: null }] }] };
    const lp = validateExport(withObs(linked));
    if (lp.length) fail("3.3.0 names and links do not match the 3.x schema:\n  " + lp.join("\n  "));
    const ev = (i, patch) => ({ ...goodObs, events: [{ ...obsEvents[i], ...patch }] });
    // 3.6.0: a quest's text on its accept and turn-in events
    const tp = validateExport(withObs(ev(1, { text: { title: "A Made-up Errand", progress: "Is it here, $N?", completion: "Thanks, $N." } })));
    if (tp.length) fail("3.6.0 quest text does not match the 3.x schema:\n  " + tp.join("\n  "));
    const badObs = [
        { ...goodObs, v: 2 }, { ...goodObs, events: [] }, { ...goodObs, extra: 1 },
        ev(0, { money: 5000 }), ev(0, { src: { kind: "mob", guid: "Player-4170-00ABCDEF" } }), ev(0, { src: { kind: "pickpocket" } }),
        ev(0, { who: { ...who, guild: "Tester" } }), ev(0, { where: { zone: "Elwynn" } }), ev(0, { id: "Not An Id" }), ev(0, { type: "chat" }),
        ev(0, { who: { ...who, name: "Te|cffffffffster" } }), ev(0, { items: [{ id: 1, n: 1, link: "|cffffffff|Hitem:1::::60|h[X]|h|r" }] }),
        ev(0, { items: [{ id: 1, n: 1, link: "|Hitem:1|h[X]|h" }] }),
        ev(1, { act: "abandon" }), ev(1, { text: {} }), ev(1, { text: { title: "" } }), ev(1, { text: { title: "T", author: "x" } }),
        ev(1, { text: { title: 7 } }), ev(1, { text: { details: "x".repeat(8001) } }), ev(0, { text: { title: "T" } }), ev(1, { rewards: { items: [], choices: [], money: 300 } }),
        ev(2, { items: [{ id: 4470, n: 1, price: 38 }] }), ev(2, { items: [{ id: 4470, n: 1, gold: 1, price: 38, limited: null }] }),
        ev(2, { items: [{ id: 4470, n: 1, price: 38, limited: null, cost: [{ gold: 1, n: 1 }] }] }),
    ];
    badObs.forEach((o, n) => { if (!validateExport(JSON.parse(JSON.stringify(withObs(o)))).length) fail("the 3.x schema accepted bad observations #" + n); });
    // 3.9.0: trainer events, and rx / filtered on vendor events
    const trainerEvent = { id: "k1f9c2-000020", t: 1762906000, type: "trainer", npc: 5146, kind: "class", rx: 6, where: { map: 0 }, who,
        rows: [{ s: 7322, name: "Frostbolt", rank: "Rank 4", lv: 20, cost: 1800, st: "a" },
               { name: "Smelting", rank: "Apprentice", skill: "Mining", skillReq: 1, needs: ["Mining"], cost: 10, st: "k" }] };
    const tr = (patch) => ({ ...goodObs, events: [{ ...trainerEvent, ...patch }] });
    const row = (patch) => tr({ rows: [{ ...trainerEvent.rows[0], ...patch }] });
    const trp = validateExport(withObs({ ...goodObs, events: [...obsEvents, trainerEvent, { ...obsEvents[2], rx: 8, filtered: true }] }));
    if (trp.length) fail("3.9.0 trainer and vendor rx / filtered do not match the 3.x schema:\n  " + trp.join("\n  "));
    if (validateExport(withObs(tr({ rx: undefined }))).length) fail("a trainer event without rx is no longer valid");
    const badTrainer = [
        tr({ kind: "pet" }), tr({ npc: undefined }), tr({ rows: [] }), tr({ rx: 9 }), tr({ rx: 0 }), tr({ guid: "Creature-0-1-0-1-5146-AB" }),
        tr({ rows: Array.from({ length: 401 }, () => trainerEvent.rows[0]) }), tr({ money: 1 }),
        row({ name: "Creature-0-4170-0-1234-5146-000012AAAD" }), row({ name: "Player-4170-00ABCDEF" }), row({ name: "|cffffffffX|r" }),
        row({ name: "x".repeat(121) }), row({ name: "" }), row({ name: "Line\nBreak" }), row({ rank: "r".repeat(41) }), row({ skill: "s".repeat(65) }),
        row({ st: "available" }), row({ st: undefined }), row({ cost: undefined }), row({ cost: -1 }), row({ cost: 1.5 }), row({ s: 0 }), row({ lv: 0 }),
        row({ needs: [] }), row({ needs: ["a", "b", "c", "d", "e", "f"] }), row({ needs: ["Pet-0-1-2-3"] }), row({ skillReq: 0 }), row({ icon: 1 }),
        ev(2, { rx: 9 }), ev(2, { filtered: false }), ev(0, { rx: 5 }),
    ];
    badTrainer.forEach((o, n) => { if (!validateExport(JSON.parse(JSON.stringify(withObs(o)))).length) fail("the 3.x schema accepted bad trainer/vendor #" + n); });
    // 3.10.0: the npcs summary with its install id; a section may carry npcs and no events
    const npc = { npc: 525, name: "Made-up Wolf", lv: [10, 12], cls: "normal", ct: 1, fam: "Wolf", rxA: 2, rxH: 4, sub: "Made-up Supplies", spd: 200, day: 20404,
        cells: [[1429, 41, 65, 2], [1429, 42, 65, 1]] };
    const withNpcs = (patch, extra) => withObs({ ...goodObs, install: "k1f9c2", npcs: [{ ...npc, ...patch }], ...extra });
    const np = [withNpcs({}), withNpcs({ boss: true, lv: undefined, ct: "Beast" }), withNpcs({}, { events: [] }),
        withNpcs({}, { install: "k1f9c2+zz9900" }), withNpcs({ lv: undefined, cls: undefined, ct: undefined, fam: undefined, rxA: undefined,
        rxH: undefined, sub: undefined, spd: undefined, cells: undefined, name: undefined })].flatMap((o) => validateExport(JSON.parse(JSON.stringify(o))));
    if (np.length) fail("3.10.0 npcs do not match the 3.x schema:\n  " + np.join("\n  "));
    const badNpcs = [
        withNpcs({ npc: 0 }), withNpcs({ day: undefined }), withNpcs({ day: 0 }), withNpcs({ day: 2e6 }), withNpcs({ lv: [12] }), withNpcs({ lv: [0, 5] }),
        withNpcs({ lv: [5, 6, 7] }), withNpcs({ boss: false }), withNpcs({ cls: "boss" }), withNpcs({ ct: 0 }), withNpcs({ ct: "Be|ast" }),
        withNpcs({ fam: "Creature-0-1-2" }), withNpcs({ fam: "f".repeat(41) }), withNpcs({ rxA: 9 }), withNpcs({ rxH: 0 }),
        withNpcs({ sub: "Player-4170-00ABCDEF" }), withNpcs({ sub: "s".repeat(81) }), withNpcs({ sub: "|cffffffffX|r" }), withNpcs({ sub: "Someone's Pet" }), withNpcs({ spd: 5 }),
        withNpcs({ spd: 1.5 }), withNpcs({ cells: [] }), withNpcs({ cells: [[1429, 100, 1, 1]] }), withNpcs({ cells: [[1429, 1, 1, 0]] }),
        withNpcs({ cells: [[1429, 1, 1]] }), withNpcs({ cells: Array.from({ length: 41 }, (_, i) => [1429, i, 1, 1]) }),
        withNpcs({ guid: "Creature-0-4170-0-1234-525-000012AB01" }), withNpcs({ name: "Someone's Pet" }), withNpcs({ name: "Player-4170-00ABCDEF" }), withNpcs({ name: "n".repeat(81) }),
        withNpcs({ name: "|cffff0000Made-up Wolf|r" }), withNpcs({ name: "" }), withNpcs({ unitName: "Made-up Wolf" }), withNpcs({ t: 1762905600 }),
        withNpcs({}, { install: undefined }), withNpcs({}, { install: "K1F9C2" }), withNpcs({}, { install: "k1f9c2+" }),
        withNpcs({}, { npcs: [] }), withObs({ ...goodObs, install: "k1f9c2" }), withNpcs({}, { events: [], npcs: undefined }),
    ];
    badNpcs.forEach((o, n) => { if (!validateExport(JSON.parse(JSON.stringify(o))).length) fail("the 3.x schema accepted bad npcs #" + n); });
    // 3.11.0: taxi (a flight master's reachable nodes and prices) and flight (how long a flight took; never a where)
    const taxiEvent = { id: "k1f9c2-000024", t: 1762906100, type: "taxi", npc: 352, node: 2, rx: 5, where: { map: 0 }, who,
        to: [{ node: 4, cost: 1050, hops: 2 }, { node: 5, cost: 270 }] };
    const flightEvent = { id: "k1f9c2-000025", t: 1762906300, type: "flight", from: 2, to: 5, sec: 181, who };
    const tx = (patch) => ({ ...goodObs, events: [{ ...taxiEvent, ...patch }] });
    const hop = (patch) => tx({ to: [{ ...taxiEvent.to[0], ...patch }] });
    const fl = (patch) => ({ ...goodObs, events: [{ ...flightEvent, ...patch }] });
    const txp = [withObs({ ...goodObs, events: [...obsEvents, taxiEvent, flightEvent] }), withObs(tx({ rx: undefined, to: [] })),
        withObs(fl({ sec: 5, b: "1.60.1.70888" })), withObs(fl({ sec: 3600 }))].flatMap((o) => validateExport(JSON.parse(JSON.stringify(o))));
    if (txp.length) fail("3.11.0 taxi and flight do not match the 3.x schema:\n  " + txp.join("\n  "));
    const badTaxi = [
        tx({ npc: undefined }), tx({ node: undefined }), tx({ node: 0 }), tx({ to: undefined }), tx({ rx: 9 }), tx({ where: undefined }),
        tx({ guid: "Creature-0-4170-0-1234-352-000012AB10" }), tx({ name: "Made-up Keep" }), tx({ money: 1 }),
        tx({ to: Array.from({ length: 201 }, (_, i) => ({ node: i + 10, cost: 1 })) }),
        hop({ node: 0 }), hop({ node: undefined }), hop({ cost: undefined }), hop({ cost: -1 }), hop({ cost: 1.5 }), hop({ hops: 0 }),
        hop({ hops: 101 }), hop({ name: "Made-up Port" }),
        fl({ where: { map: 0 } }), fl({ from: 0 }), fl({ to: undefined }), fl({ sec: 4 }), fl({ sec: 3601 }), fl({ sec: 95.5 }),
        fl({ sec: undefined }), fl({ money: 210 }), fl({ path: [[1429, 41, 65]] }), fl({ who: undefined }),
    ];
    badTaxi.forEach((o, n) => { if (!validateExport(JSON.parse(JSON.stringify(withObs(o)))).length) fail("the 3.x schema accepted bad taxi/flight #" + n); });
    if (!validateExport({ ...data, schemaVersion: SCHEMA_VERSION_3 }).length) fail("the 3.x schema accepted a 2.x document");
    const eq = run([inv, out3, "--format=3"], { WOW_IMPORT_TOKEN: "", WOW_IMPORT_URL: "" });
    if (eq.status !== 0 || JSON.parse(fs.readFileSync(out3, "utf8")).schemaVersion !== SCHEMA_VERSION_3) fail("--format=3 did not write 3.x");
    const bad = run([inv, out3, "--format", "4"], { WOW_IMPORT_TOKEN: "", WOW_IMPORT_URL: "" });
    if (bad.status !== 2 || !/--format must be one of 2, 3/.test(bad.stderr)) fail("--format 4 was not refused:\n" + bad.stdout + bad.stderr);
}

const noToken = run([inv, out, "--upload"], { WOW_IMPORT_TOKEN: "", WOW_IMPORT_URL: "http://127.0.0.1:9/api/wow/import" });
const noTokenText = (noToken.stdout || "") + (noToken.stderr || "");
if (noToken.status === 0 || !/WOW_IMPORT_TOKEN/.test(noTokenText)) fail("missing token was not reported:\n" + noTokenText);

const noUrl = run([inv, out, "--upload"], { WOW_IMPORT_TOKEN: TOKEN, WOW_IMPORT_URL: "" });
const noUrlText = (noUrl.stdout || "") + (noUrl.stderr || "");
if (noUrl.status === 0 || !/WOW_IMPORT_URL/.test(noUrlText)) fail("missing URL was not reported:\n" + noUrlText);
if (noUrlText.includes(TOKEN)) fail("the token was printed");

const plain = run([inv, out, "--upload"], { WOW_IMPORT_TOKEN: TOKEN, WOW_IMPORT_URL: "http://example.invalid/api/wow/import" });
const plainText = (plain.stdout || "") + (plain.stderr || "");
if (plain.status === 0 || !/must be an https:\/\/ URL/.test(plainText)) fail("a plain-http upload URL was not refused:\n" + plainText);
if (plainText.includes(TOKEN)) fail("the token was printed on a refused URL");

const down = run([inv, out, "--upload"], { WOW_IMPORT_TOKEN: TOKEN, WOW_IMPORT_URL: "http://127.0.0.1:9/api/wow/import" });
const downText = (down.stdout || "") + (down.stderr || "");
if (down.status === 0 || !/Upload was not acknowledged/.test(downText)) fail("a dead endpoint was not reported:\n" + downText);
if (downText.includes(TOKEN)) fail("the token was printed on a network error");

// A real upload to a local server: gzip header and bytes, the exact JSON, the bearer token.
(async () => {
    const http = require("http");
    const zlib = require("zlib");
    const { uploadExport } = require("./inventory_export");
    let got = null;
    const server = http.createServer((req, res) => {
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
            got = { url: req.url, headers: req.headers, raw: Buffer.concat(chunks) };
            res.setHeader("Content-Type", "application/json");
            res.end('{"ok":true,"id":1}');
        });
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    process.env.WOW_IMPORT_TOKEN = TOKEN;
    process.env.WOW_IMPORT_URL = `http://127.0.0.1:${server.address().port}/api/wow/import`;
    const log = console.log; console.log = () => {};
    try { await uploadExport(data); } finally { console.log = log; }
    const { uploadAuctionScan, auctionsUrl } = require("./inventory_export");
    if (!/\/api\/wow\/auctions$/.test(auctionsUrl())) fail("auctions URL not derived from the import URL: " + auctionsUrl());
    const first = got; got = null;
    const ack = await uploadAuctionScan(a);
    server.close();
    if (!got || got.url !== "/api/wow/auctions" || got.headers["content-encoding"] !== "gzip") fail("auction scan not posted gzipped to /api/wow/auctions");
    if (zlib.gunzipSync(got.raw).toString("utf8") !== JSON.stringify(a)) fail("the unpacked auction upload is not the document");
    if (!ack || ack.ok !== true) fail("auction acknowledgement not returned");
    got = first;
    if (!got) fail("the upload never reached the server");
    if (got.headers["content-encoding"] !== "gzip") fail("upload is not marked Content-Encoding: gzip");
    if (got.raw[0] !== 0x1f || got.raw[1] !== 0x8b) fail("upload body does not start with the gzip bytes cr0m checks for");
    if (got.headers.authorization !== "Bearer " + TOKEN) fail("upload did not send the bearer token");
    const unpacked = zlib.gunzipSync(got.raw).toString("utf8");
    if (unpacked !== JSON.stringify(data)) fail("the unpacked upload is not the export JSON");
    console.log("OK   inventory export (2.x and --format 3 schemas, dropped 3.x fields rejected, auction scans, uiHealth merge, gzip uploads, upload failures stay quiet about the token)");
})().catch((e) => fail("upload test crashed: " + (e && e.message)));
