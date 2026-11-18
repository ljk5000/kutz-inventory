// Offline check for KutzInventory/Crafts.lua (items crafted, counted as they are made) in a small fake game, and for
// what the exporter makes of it: one "You create" line, a stack (x5), lines that are not yours or not a creation,
// two crafts on one day, the 120-day window, translated format strings, a character that is not logged in yet,
// /kinv's line with every .toc file loaded, then characters[].crafted in inventory 3.x (shape, order, caps, broken
// entries dropped, the schema) and that a file with nothing crafted exports exactly as before.
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("node:assert/strict");
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require("fengari");
const convert = require("./convert");
const { validateExport } = require("./validate_export");

const addonDir = path.join(__dirname, "..", "KutzInventory");
const source = fs.readFileSync(path.join(addonDir, "Crafts.lua"), "utf8");

const code = `
local BOLT = "|cffffffff|Hitem:2996::::::::24:::::|h[Bolt of Linen Cloth]|h|r"
local BREAD = "|cffffffff|Hitem:1113::::::::24:::::|h[Conjured Bread]|h|r"
local KEY = "Tester-Example Realm"

local function fresh(opts)
  opts = opts or {}
  local frames, registered = {}, {}
  local s = { now = 1767225600, day = "2026-01-01" }
  local G = setmetatable({}, { __index = _G })
  G._G = G                                     -- the addon reads LOOT_ITEM_CREATED_SELF etc. through _G, as in the game
  G.CreateFrame = function()
    local f = { scripts = {} }
    function f:SetScript(n, fn) self.scripts[n] = fn end
    function f:RegisterEvent(e) registered[e] = true; return true end
    frames[#frames + 1] = f
    return f
  end
  G.time = function() return s.now end
  G.date = function(fmt, t) if t then return "D" .. tostring(t) end; assert(fmt == "%Y-%m-%d", fmt); return s.day end
  for k, v in pairs(opts.globals or {}) do G[k] = v end
  G.KutzInventoryDB = { chars = {} }
  if not opts.loggedOut then G.KutzInventoryDB.chars[KEY] = opts.me or { name = "Tester" } end
  local chunk = assert(load([=====[${source}]=====], "@Crafts.lua", "t", G))
  local ns = { Me = function() return G.KutzInventoryDB.chars[KEY] end }   -- KutzInventory.lua's accessor
  chunk("KutzInventory", ns)
  local h = { ns = ns, G = G, s = s, registered = registered }
  function h.event(name, ...) frames[1].scripts.OnEvent(frames[1], name, ...) end
  function h.loot(text) h.event("CHAT_MSG_LOOT", text, "", "", "", "Tester") end
  function h.me() return G.KutzInventoryDB.chars[KEY] end
  function h.crafted() return h.me() and h.me().crafted end
  return h
end

local function count(t) local n = 0; for _ in pairs(t) do n = n + 1 end; return n end

-- 1) one item
do
  local h = fresh()
  assert(h.registered.CHAT_MSG_LOOT and count(h.registered) == 1, "listens to CHAT_MSG_LOOT and nothing else")
  assert(h.crafted() == nil, "nothing before the first craft")
  h.loot("You create: " .. BOLT .. ".")
  local c = h.crafted()
  assert(c and c.total == 1 and c.since == 1767225600, "total and since")
  local it = c.items[2996]
  assert(it and it.count == 1 and it.crafts == 1 and it.name == "Bolt of Linen Cloth" and it.lastAt == 1767225600, "the item's entry")
  assert(count(c.items) == 1 and count(c.days) == 1 and c.days["2026-01-01"][2996] == 1 and count(c.days["2026-01-01"]) == 1, "the day")
  assert(h.G.KutzInventoryObsDB == nil, "drop tracking's table is not touched")
  assert(not h.G.KutzInventoryDB.lastError, tostring(h.G.KutzInventoryDB.lastError))
  print("OK   one 'You create' line: total, the item (count, crafts, name, lastAt), the day, since")
end

-- 2) a stack, then the same item again later: counts add up, since stays
do
  local h = fresh()
  h.loot("You create: " .. BOLT .. "x5.")
  local c = h.crafted()
  assert(c.total == 5 and c.items[2996].count == 5 and c.items[2996].crafts == 1 and c.days["2026-01-01"][2996] == 5, "x5 is 5 items, 1 craft")
  assert(c.items[2996].name == "Bolt of Linen Cloth", "the name has no x5")
  h.s.now = h.s.now + 60
  h.loot("You create: " .. BOLT .. ".")
  assert(c.total == 6 and c.items[2996].count == 6 and c.items[2996].crafts == 2 and c.items[2996].lastAt == 1767225660, "second craft")
  assert(c.since == 1767225600, "since is set once")
  assert(h.crafted() == c, "the same saved table")
  print("OK   a stack (x5) counts 5 items and 1 craft; later crafts add up and since stays")
end

-- 3) not yours, or not a creation: ignored
do
  local h = fresh({ globals = { issecretvalue = function(v) return v == "secret" end } })
  h.loot("You receive loot: " .. BOLT .. ".")
  h.loot("You receive loot: " .. BOLT .. "x5.")
  h.loot("You receive item: " .. BOLT .. ".")
  h.loot("Bob creates: " .. BOLT .. ".")
  h.loot("Bob creates: " .. BOLT .. "x5.")
  h.loot("Bob receives loot: " .. BOLT .. ".")
  h.loot("You create: nothing with a link.")
  h.loot("You create: " .. BOLT)                -- no full stop: not the game's line
  h.loot("secret")
  h.loot(nil)
  h.event("PLAYER_LOGIN")
  assert(h.crafted() == nil, "nothing recorded")
  assert(not h.G.KutzInventoryDB.lastError, tostring(h.G.KutzInventoryDB.lastError))
  assert(h.ns.ParseCreate("Bob creates: " .. BOLT .. ".") == nil and h.ns.ParseCreate("You receive loot: " .. BOLT .. ".") == nil, "ParseCreate")
  local link, n = h.ns.ParseCreate("You create: " .. BOLT .. "x20.")
  assert(link == BOLT and n == 20, "ParseCreate reads the stack form first")
  print("OK   loot you receive, other players' creations, lines without an item and hidden text are ignored")
end

-- 4) two crafts on one day add up; other items and other days are kept apart; conjured food counts too
do
  local h = fresh()
  h.loot("You create: " .. BOLT .. ".")
  h.loot("You create: " .. BOLT .. "x2.")
  h.loot("You create: " .. BREAD .. "x4.")
  h.s.day, h.s.now = "2026-01-02", h.s.now + 86400
  h.loot("You create: " .. BOLT .. ".")
  local c = h.crafted()
  assert(c.total == 8 and c.items[2996].count == 4 and c.items[2996].crafts == 3 and c.items[1113].count == 4, "items")
  assert(c.days["2026-01-01"][2996] == 3 and c.days["2026-01-01"][1113] == 4 and c.days["2026-01-02"][2996] == 1, "days")
  assert(count(c.days) == 2 and count(c.days["2026-01-02"]) == 1, "one table per day")
  print("OK   crafts on the same day add up, per item; a new day starts a new entry")
end

-- 5) only the newest 120 days are kept; totals and items are not pruned
do
  local h = fresh()
  local days = {}
  for i = 1, 125 do
    days[i] = string.format("2026-%02d-%02d", 1 + math.floor((i - 1) / 28), 1 + (i - 1) % 28)
    h.s.day, h.s.now = days[i], h.s.now + 86400
    h.loot("You create: " .. BOLT .. "x2.")
    assert(count(h.crafted().days) == math.min(i, 120), "day " .. i .. ": " .. count(h.crafted().days))
  end
  local c = h.crafted()
  for i = 1, 5 do assert(c.days[days[i]] == nil, "old day kept: " .. days[i]) end
  for i = 6, 125 do assert(c.days[days[i]][2996] == 2, "new day lost: " .. days[i]) end
  assert(c.total == 250 and c.items[2996].count == 250 and c.items[2996].crafts == 125, "the totals are for all time")
  h.loot("You create: " .. BOLT .. ".")          -- the same day again: nothing more is dropped
  assert(count(c.days) == 120 and c.days[days[125]][2996] == 3, "same day")
  print("OK   the newest 120 days are kept; older days go when a new day starts; totals are never pruned")
end

-- 6) the client's own (translated, reordered) format strings
do
  local h = fresh({ globals = { LOOT_ITEM_CREATED_SELF = "Ihr stellt her: %s.", LOOT_ITEM_CREATED_SELF_MULTIPLE = "%2$d Stück hergestellt: %1$s." } })
  h.loot("You create: " .. BOLT .. ".")
  assert(h.crafted() == nil, "the English line is not this client's")
  h.loot("Ihr stellt her: " .. BOLT .. ".")
  h.loot("3 Stück hergestellt: " .. BOLT .. ".")
  local c = h.crafted()
  assert(c.total == 4 and c.items[2996].count == 4 and c.items[2996].crafts == 2, "German lines: " .. tostring(c.total))
  local g = fresh({ globals = { LOOT_ITEM_CREATED_SELF = "", LOOT_ITEM_CREATED_SELF_MULTIPLE = 7 } })
  g.loot("You create: " .. BOLT .. "x3.")
  assert(g.crafted().total == 3, "an unusable global falls back to English")
  print("OK   lines are read with the client's own format strings; English when the client has none")
end

-- 7) before login nothing is stored and nothing breaks; a damaged table is repaired, not replaced
do
  local h = fresh({ loggedOut = true })
  h.loot("You create: " .. BOLT .. ".")
  assert(count(h.G.KutzInventoryDB.chars) == 0 and not h.G.KutzInventoryDB.lastError, "no character entry is invented")
  local g = fresh({ me = { name = "Tester", crafted = { since = 5, total = 7, items = "broken" } } })
  g.loot("You create: " .. BOLT .. "x2.")
  local c = g.crafted()
  assert(c.since == 5 and c.total == 9 and c.items[2996].count == 2 and c.days["2026-01-01"][2996] == 2, "repaired")
  assert(g.me().name == "Tester", "the rest of the character is untouched")
  local line = g.ns.CraftedLine(g.me())
  assert(line:find("items crafted: 9 %(1 different%), counted since D5"), line)
  assert(g.ns.CraftedLine({}):find("none counted yet"), "no crafts yet")
  print("OK   nothing is stored before login; a damaged table is repaired; /kinv's line")
end

-- what the game would save for one character, for the exporter half of this check
do
  local h = fresh()
  h.loot("You create: " .. BREAD .. "x4.")
  h.s.day, h.s.now = "2026-01-02", h.s.now + 86400
  h.loot("You create: " .. BOLT .. ".")
  h.loot("You create: " .. BOLT .. "x5.")
  local function ser(v)
    if type(v) == "table" then
      local out = {}
      for k, x in pairs(v) do out[#out + 1] = "[" .. (type(k) == "number" and tostring(k) or string.format("%q", k)) .. "] = " .. ser(x) end
      return "{ " .. table.concat(out, ", ") .. " }"
    end
    return type(v) == "string" and string.format("%q", v) or tostring(v)
  end
  SAVED = ser(h.crafted())
end
`;

// The real addon: every file the .toc loads, in a fake game where unknown globals are harmless stubs.
const toc = fs.readFileSync(path.join(addonDir, "KutzInventory.toc"), "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l.endsWith(".lua"));
assert.equal(toc[toc.length - 1], "Crafts.lua", "the .toc loads Crafts.lua last");
const whole = `
local stub
stub = setmetatable({}, { __index = function() return stub end, __call = function() return nil end })
local frames, printed = {}, {}
function CreateFrame()
  local f = setmetatable({ scripts = {} }, { __index = function() return function() end end })
  f.SetScript = function(self, name, fn) self.scripts[name] = fn end
  f.RegisterEvent = function() return true end
  frames[#frames + 1] = f
  return f
end
C_Timer = { After = function() end }
GetTime = function() return 1000 end
time = function() return 1767225600 end
date = function(fmt, t) if t then return "D" .. tostring(t) end; return "2026-01-01" end
local say = print
print = function(m) printed[#printed + 1] = m end
UnitName = function(u) if u == "player" then return "Tester" end end
GetRealmName = function() return "Realm" end
UnitGUID = function() return "Player-1-00000001" end
GetMoney = function() return 0 end
SlashCmdList = {}
local SAVED = { KutzInventoryDB = true, KutzInventoryObsDB = true, KutzUIDB = true, LOOT_ITEM = true, issecretvalue = true }
local env = setmetatable({}, { __index = function(_, k) local v = rawget(_G, k); if v == nil and not SAVED[k] then return stub end; return v end,
                               __newindex = function(_, k, v) rawset(_G, k, v) end })
local ns = {}
for _, file in ipairs({ ${toc.map((f) => `{ ${JSON.stringify(f)}, [=====[${fs.readFileSync(path.join(addonDir, f), "utf8")}]=====] }`).join(",\n")} }) do
  chunk = assert(load(file[2], "@" .. file[1], "t", env))
  chunk("KutzInventory", ns)
end
local function fire(...)
  for _, f in ipairs(frames) do
    local on = f.scripts.OnEvent
    if on then on(f, ...) end
  end
end
fire("ADDON_LOADED", "KutzInventory")
fire("CHAT_MSG_LOOT", "You create: |cffffffff|Hitem:2996::::::::24:::::|h[Bolt of Linen Cloth]|h|r.")
assert(next(KutzInventoryDB.chars) == nil, "a craft line before login stored something")
fire("PLAYER_LOGIN")
local me = KutzInventoryDB.chars["Tester-Realm"]
assert(me and ns.Me() == me, "ns.Me is this character's entry")
SlashCmdList.KUTZINVENTORY("")
assert(table.concat(printed, "\\n"):find("items crafted: none counted yet"), "/kinv has no crafted line")
fire("CHAT_MSG_LOOT", "You create: |cffffffff|Hitem:2996::::::::24:::::|h[Bolt of Linen Cloth]|h|rx5.")
fire("CHAT_MSG_LOOT", "You receive loot: |cffffffff|Hitem:2589::::::::24:::::|h[Linen Cloth]|h|r.")
fire("CHAT_MSG_LOOT", "Bob creates: |cffffffff|Hitem:2996::::::::24:::::|h[Bolt of Linen Cloth]|h|r.")
local c = me.crafted
assert(c and c.total == 5 and c.items[2996].count == 5 and c.items[2996].crafts == 1 and c.days["2026-01-01"][2996] == 5 and c.since == 1767225600,
       "the craft did not reach this character's entry")
assert(c.items[2589] == nil, "received loot was counted")
assert(KutzInventoryObsDB == nil or KutzInventoryObsDB.events == nil or #KutzInventoryObsDB.events == 0, "crafts went into drop tracking")
printed = {}
SlashCmdList.KUTZINVENTORY("")
assert(table.concat(printed, "\\n"):find("items crafted: 5 %(1 different%), counted since D1767225600"), "/kinv does not show the count")
assert(not KutzInventoryDB.lastError, tostring(KutzInventoryDB.lastError))
say("OK   with every .toc file loaded: crafts land on this character's entry, always on, and /kinv lists them")
`;

let saved = null;
for (const chunk of [code, whole]) {
  const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
  if (lauxlib.luaL_dostring(L, to_luastring(chunk)) !== 0) {
    console.error("FAIL " + to_jsstring(lua.lua_tostring(L, -1))); process.exit(1);
  }
  if (chunk === code) {
    lua.lua_getglobal(L, to_luastring("SAVED"));
    saved = to_jsstring(lua.lua_tostring(L, -1));
  }
}

// ---------------------------------------------------------------------------
// The exporter: characters[].crafted in inventory 3.x
// ---------------------------------------------------------------------------
const FIXTURE = fs.readFileSync(path.join(__dirname, "fixtures", "example-KutzInventory.lua"), "utf8");
const CHAR = '["Examplemage-Example Realm"] = {';
assert.ok(FIXTURE.includes(CHAR), "the example fixture has no Examplemage-Example Realm");
const withCrafted = (lua) => FIXTURE.replace(CHAR, `${CHAR}\n      crafted = ${lua},`);
const exported = (text, options) => {
  const inventory = convert.convertSavedVariables([text], options).inventory;
  return { ...inventory, exportedAt: "2026-01-03T00:00:00.000Z" };
};
const exampleMage = (doc) => doc.characters.find((c) => c.key === "Examplemage-Example Realm");
const schemaProblems = (doc) => validateExport(JSON.parse(JSON.stringify(doc)));
try {
  // what the fake game saved above, through the real exporter
  const doc = exported(withCrafted(saved));
  assert.equal(doc.schemaVersion, "3.12.0");
  assert.deepEqual(exampleMage(doc).crafted, {
    since: "2026-01-01T00:00:00.000Z", total: 10,
    items: [{ itemId: 1113, name: "Conjured Bread", count: 4, crafts: 1, lastAt: "2026-01-01T00:00:00.000Z" },
            { itemId: 2996, name: "Bolt of Linen Cloth", count: 6, crafts: 2, lastAt: "2026-01-02T00:00:00.000Z" }],
    days: [{ date: "2026-01-01", items: [{ itemId: 1113, count: 4 }] }, { date: "2026-01-02", items: [{ itemId: 2996, count: 6 }] }],
  });
  assert.deepEqual(Object.keys(exampleMage(doc).crafted), ["since", "total", "items", "days"]);
  assert.deepEqual(schemaProblems(doc), [], "an export with crafted does not match the 3.x schema");
  console.log("OK   what the addon saves exports as crafted { since, total, items[], days[] } and matches the 3.x schema");

  // ordering: items by itemId (as numbers), days by date, each day's items by itemId
  const ordered = exampleMage(exported(withCrafted(`{ since = 100, total = 9,
    items = { [10000] = { count = 1, crafts = 1, name = "C", lastAt = 300 }, [999] = { count = 5, crafts = 2, name = "B", lastAt = 200 },
              [25] = { count = 3, crafts = 3, name = "A", lastAt = 100 } },
    days = { ["2026-02-01"] = { [10000] = 1, [25] = 1 }, ["2025-12-31"] = { [999] = 5, [25] = 2 } } }`))).crafted;
  assert.deepEqual(ordered.items.map((it) => it.itemId), [25, 999, 10000]);
  assert.deepEqual(ordered.days, [{ date: "2025-12-31", items: [{ itemId: 25, count: 2 }, { itemId: 999, count: 5 }] },
                                  { date: "2026-02-01", items: [{ itemId: 25, count: 1 }, { itemId: 10000, count: 1 }] }]);
  console.log("OK   items are sorted by itemId, days by date, a day's items by itemId");

  // nothing recorded: no crafted key, and the rest of the document is what it was
  const before = exported(FIXTURE);
  assert.ok(before.characters.every((c) => !("crafted" in c)), "a character with nothing crafted has a crafted key");
  for (const empty of ["{}", "{ since = 100, total = 0, items = {}, days = {} }", '"nonsense"', "{ items = { [1] = 5 }, days = { x = 1 } }"]) {
    assert.deepEqual(exported(withCrafted(empty)), before, "an empty crafted table changed the export: " + empty);
  }
  const stripped = JSON.parse(JSON.stringify(doc));
  delete exampleMage(stripped).crafted;
  assert.deepEqual(stripped, JSON.parse(JSON.stringify(before)), "crafted changed something else in the document");
  assert.deepEqual(exported(withCrafted(saved), { format: 2 }), exported(FIXTURE, { format: 2 }), "2.x must not change");
  assert.deepEqual(schemaProblems({ ...before, schemaVersion: "3.3.0" }), [], "a 3.3.0 document without crafted is no longer valid");
  console.log("OK   nothing crafted: no crafted key and the same document as before; 2.x never carries it");

  // broken entries are dropped, the rest is kept
  const messy = exampleMage(exported(withCrafted(`{ since = "soon", total = -4,
    items = { [2996] = { count = 6, crafts = 2, name = "Bolt|cffffffff", lastAt = "x" }, [0] = { count = 1, crafts = 1 },
              [7] = { count = 0, crafts = 1 }, [8] = { count = 2 }, [9] = "nine", [10] = { count = 1.5, crafts = 1 },
              abc = { count = 1, crafts = 1 }, [11] = { count = 2, crafts = 1, name = "Ok", lastAt = 50, extra = true } },
    days = { ["2026-01-02"] = { [2996] = 6, [5] = 0, [6] = "x", abc = 2 }, ["2026-13-01"] = { [2996] = 1 }, today = { [2996] = 1 },
             ["2026-01-03"] = 5, ["2026-01-04"] = {} }, surprise = 1 }`))).crafted;
  assert.deepEqual(messy, { since: null, total: 8,
    items: [{ itemId: 11, name: "Ok", count: 2, crafts: 1, lastAt: "1970-01-01T00:00:50.000Z" },
            { itemId: 2996, name: null, count: 6, crafts: 2, lastAt: null }],
    days: [{ date: "2026-01-02", items: [{ itemId: 2996, count: 6 }] }] });
  console.log("OK   broken items, days and counts are dropped without failing the export; a bad total is the items' sum");

  // caps: 5000 items (the most recently made), the newest 120 days
  const many = [], days = [];
  for (let id = 1; id <= 5003; id++) many.push(`[${id}] = { count = 1, crafts = 1, name = "I${id}", lastAt = ${id <= 3 ? 10 : 1000 + id} }`);
  for (let n = 0; n < 130; n++) days.push(`["${new Date(Date.UTC(2026, 0, 1 + n)).toISOString().slice(0, 10)}"] = { [1] = 1 }`);
  const capped = exported(withCrafted(`{ since = 5, total = 9000, items = { ${many.join(", ")} }, days = { ${days.join(", ")} } }`));
  const cc = exampleMage(capped).crafted;
  assert.equal(cc.items.length, 5000); assert.equal(cc.items[0].itemId, 4); assert.equal(cc.items[4999].itemId, 5003);
  assert.equal(cc.total, 9000, "the total is not cut to the items kept");
  assert.equal(cc.days.length, 120); assert.equal(cc.days[0].date, "2026-01-11"); assert.equal(cc.days[119].date, "2026-05-10");
  assert.deepEqual(schemaProblems(capped), [], "a capped export does not match the 3.x schema");
  console.log("OK   at most 5000 items (the most recently made) and the newest 120 days; the total is kept whole");

  // the schema refuses what the exporter would never write
  const bad = (patch) => {
    const d = JSON.parse(JSON.stringify(doc));
    patch(exampleMage(d).crafted);
    return schemaProblems(d).length > 0;
  };
  const refused = [
    (c) => { c.extra = 1; }, (c) => { delete c.days; }, (c) => { c.total = -1; }, (c) => { c.total = 1.5; }, (c) => { c.since = 1767225600; },
    (c) => { c.items[0].itemId = 0; }, (c) => { c.items[0].count = 0; }, (c) => { delete c.items[0].crafts; }, (c) => { c.items[0].link = "x"; },
    (c) => { c.items[0].name = "|cffffffffBread|r"; }, (c) => { c.days[0].date = "yesterday"; }, (c) => { c.days[0].items = []; },
    (c) => { c.days[0].items[0].count = "4"; }, (c) => { c.days[0].items[0].name = "Bread"; },
  ];
  refused.forEach((patch, n) => assert.ok(bad(patch), "the 3.x schema accepted bad crafted #" + n));
  const v2 = exported(FIXTURE, { format: 2 });
  v2.characters[0].crafted = exampleMage(doc).crafted;
  assert.ok(schemaProblems(v2).length > 0, "the 2.x schema accepted crafted");
  console.log("OK   the 3.x schema refuses extra keys, bad counts, dates and names; 2.x has no crafted");
} catch (e) {
  console.error("FAIL " + (e && e.message ? e.message : e));
  process.exit(1);
}
