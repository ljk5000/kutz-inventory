// Run real login/scan events across fresh addon instances sharing SavedVariables, then export the result.
"use strict";
const fs = require("fs"), path = require("path"), assert = require("node:assert/strict");
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require("fengari");
const { convertSavedVariables } = require("./convert");
const { validateExport } = require("./validate_export");
const source = name => fs.readFileSync(path.join(__dirname, "../KutzInventory", name + ".lua"), "utf8");
const driver = `
local REALM = "Example Realm"
local BASE, FIRST_GUID, SECOND_GUID = "Examplehero-" .. REALM, "Player-1-00000001", "Player-1-00000002"
local function dump(v)
  if type(v) == "string" then return string.format("%q", v) end
  if type(v) ~= "table" then return tostring(v) end
  local out = {}
  for k, x in pairs(v) do out[#out + 1] = "[" .. dump(k) .. "]=" .. dump(x) end
  table.sort(out)
  return "{" .. table.concat(out, ",") .. "}"
end
local function login(db, surname, guid, item, name)
  local frames, timers, now = {}, {}, 0
  local G = setmetatable({}, { __index = _G })
  G._G, G.KutzInventoryDB = G, db
  G.time = function() return 1767225600 + now end
  G.date = function() return "2026-01-01" end
  G.GetTime = function() return now end
  G.wipe = function(t) for k in pairs(t) do t[k] = nil end end
  G.print = function() end
  G.CreateFrame = function()
    local f = { events = {} }
    function f:RegisterEvent(e) self.events[e] = true end
    function f:SetScript(_, fn) self.event = fn end
    frames[#frames + 1] = f
    return f
  end
  G.C_Timer = { After = function(_, fn) timers[#timers + 1] = fn end }
  G.SlashCmdList = {}
  G.UnitName = function() return name or "Examplehero" end
  G.GetUnitName = function() return (name or "Examplehero") .. (surname and " " .. surname or "") end
  G.GetRealmName = function() return REALM end
  G.UnitGUID = function() return guid end
  G.UnitClass = function() return "Warrior", "WARRIOR" end
  G.UnitRace = function() return "Human" end
  G.UnitFactionGroup = function() return guid == SECOND_GUID and "Horde" or "Alliance" end
  G.UnitLevel = function() return 30 end
  G.UnitSex = function() return 2 end
  G.UnitExists = function() return true end
  G.InCombatLockdown = function() return false end
  G.GetMoney = function() return item * 100 end
  G.UnitXPMax = function() return 1000 end
  G.UnitXP = function() return item end
  G.C_Container = {
    GetContainerNumSlots = function(bag) return (bag == 0 or bag == 6 or bag == 15) and 1 or 0 end,
    GetContainerItemInfo = function() return { hyperlink = "item:" .. item .. ":[Own item]", stackCount = 1 } end,
  }
  G.GetInventorySlotInfo = function(slot) if slot == "HEADSLOT" then return 1 end end
  G.GetInventoryItemLink = function() return "item:" .. item .. ":[Own gear]" end
  G.GetGuildInfo = function() return "Shared Guild" end
  G.GetCurrentGuildBankTab = function() return 1 end
  G.GetGuildBankTabInfo = function() return "Shared tab", nil, true end
  G.GetGuildBankItemLink = function(_, slot) if slot == 1 then return "item:25:[Shared guild item]" end end
  G.GetGuildBankItemInfo = function() return nil, 1 end
  G.IsInRaid = function() return true end
  G.GetNumGroupMembers = function() return 1 end
  G.IsInInstance = function() return true, "raid" end
  G.GetInstanceInfo = function() return "Molten Core", "raid", 9, "40 Player", 40, 0, false, 409 end
  local ns = {}
  assert(load([====[${source("KutzInventory")}]====], "@KutzInventory.lua", "t", G))("KutzInventory", ns)
  assert(load([====[${source("Raids")}]====], "@Raids.lua", "t", G))("KutzInventory", ns)
  local h = { ns = ns, G = G }
  function h.event(e, ...)
    for _, f in ipairs(frames) do if f.events[e] then f.event(f, e, ...) end end
  end
  function h.scan()
    now = now + 20
    local batch = timers; timers = {}
    for _, fn in ipairs(batch) do fn() end
    assert(not db.lastError, tostring(db.lastError))
  end
  h.event("ADDON_LOADED", "KutzInventory")
  h.event("PLAYER_LOGIN")
  return h
end

local db = {}
local firstLogin = login(db, "First", FIRST_GUID, 25)
firstLogin.scan()
local w = db.chars[BASE]
assert(firstLogin.ns.CharacterKey() == BASE and w.guid == FIRST_GUID and w.surname == "First", "first owner keeps legacy key")
firstLogin.event("BANKFRAME_OPENED"); firstLogin.scan()
firstLogin.event("GUILDBANKBAGSLOTS_CHANGED"); firstLogin.scan()
w.crafted = { total = 10, items = { [25] = { count = 10 } } }
local before = dump(w)

local secondLogin = login(db, "Second", SECOND_GUID, 35)
local key = "Examplehero-Second-" .. REALM
local k = db.chars[key]
assert(k and secondLogin.ns.CharacterKey() == key and k ~= w, "second GUID gets surname key and a fresh table")
assert(k.bags == nil and k.equipped == nil and k.bank == nil and k.crafted == nil, "no data copied at login")
secondLogin.scan()
assert(dump(w) == before, "Second login and scans changed First")
assert(k.guid == SECOND_GUID and k.faction == "Horde" and k.bags[0].items[1].id == 35 and k.equipped[1].id == 35,
       "Second scans own data: " .. dump(k))
assert(k.bank == nil and k.crafted == nil, "unvisited bank and crafts must not be inherited")
secondLogin.event("BANKFRAME_OPENED"); secondLogin.scan()
assert(db.warband.updatedBy == key, "warband attribution must use selected character key")
assert(w.bank[6].items[1].id == 25 and k.bank[6].items[1].id == 35, "bank snapshots are separate")
secondLogin.event("GUILDBANKBAGSLOTS_CHANGED"); secondLogin.scan()
local guilds = 0; for _ in pairs(db.guilds) do guilds = guilds + 1 end
assert(guilds == 1 and db.guilds["Shared Guild-" .. REALM], "guild bank stays keyed by guild")
assert(secondLogin.ns.RaidCommand("raid KR1.ABC234.409.1767225600.ABCDEFGHJKMN"))
secondLogin.event("CHAT_MSG_LOOT", "You receive loot: |cffffffff|Hitem:35|h[Own loot]|h|r.")
local events = db.raids.ABC234.events
assert(events[1].by == key and events[2].members[1] == key and events[3].looter == key,
       "raid start, own raid unit in roster and own loot use selected key")
local secondLoginBefore = dump(k)
firstLogin = login(db, "First", FIRST_GUID, 25); firstLogin.scan()
assert(firstLogin.ns.Me() == w and firstLogin.ns.CharacterKey() == BASE, "First returns to original table and URL key")
assert(dump(k) == secondLoginBefore and w.bags[0].items[1].id == 25, "First relog changed Second")
local firstLoginBefore = dump(w)
secondLogin = login(db, "Second", SECOND_GUID, 35); secondLogin.scan()
assert(secondLogin.ns.Me() == k and secondLogin.ns.CharacterKey() == key, "Second returns to its own surname key")
assert(dump(w) == firstLoginBefore, "Second relog changed First")
local saved = "KutzInventoryDB = " .. dump(db)
print("OK   First -> Second -> First: isolated login, bags, gear, bank, crafts and shared-bank/raid attribution")

-- A synthetic corrupted legacy entry belongs to the second GUID, with bank data left by the first.
local broken = { chars = { [BASE] = { name = "Examplehero", surname = "Second", guid = SECOND_GUID,
  faction = "Horde", bank = { [6] = { items = { [1] = { id = 25 } } } }, money = 999 } } }
local original = broken.chars[BASE]
local untouched = dump(original)
firstLogin = login(broken, "First", FIRST_GUID, 25); firstLogin.scan()
assert(firstLogin.ns.CharacterKey() == "Examplehero-First-" .. REALM and firstLogin.ns.Me().bank == nil, "First starts fresh after corruption")
assert(broken.chars[BASE] == original and dump(original) == untouched, "must not touch already-broken entry")
secondLogin = login(broken, "Second", SECOND_GUID, 35); secondLogin.scan()
assert(secondLogin.ns.Me() == original and secondLogin.ns.CharacterKey() == BASE, "Second retains its legacy key")
print("OK   already-corrupted base key is neither reassigned nor copied to the returning character")

local legacy = { chars = { [BASE] = { bank = { marker = "legacy" } } } }
firstLogin = login(legacy, "First", FIRST_GUID, 25); firstLogin.scan()
assert(firstLogin.ns.CharacterKey() == BASE and firstLogin.ns.Me().bank.marker == "legacy" and firstLogin.ns.Me().guid == FIRST_GUID)

-- GUID lookup wins over a changed surname and an available / pre-GUID base key.
for _, base in ipairs({ false, {} }) do
  local own = { guid = FIRST_GUID, bank = { marker = "owned" } }
  local d = { chars = { ["Examplehero-OldSurname-" .. REALM] = own } }
  if base then d.chars[BASE] = base end
  firstLogin = login(d, "New Surname", FIRST_GUID, 25); firstLogin.scan()
  assert(firstLogin.ns.Me() == own and firstLogin.ns.CharacterKey() == "Examplehero-OldSurname-" .. REALM, "preserve alternate key by GUID")
end

-- No surname, identical surname, and a taken GUID tail must never share a table.
local collisions = { chars = { [BASE] = { guid = SECOND_GUID },
  ["Examplehero-First-" .. REALM] = { guid = "someone-else" },
  ["Examplehero-00000001-" .. REALM] = { guid = "another-server-00000001" } } }
firstLogin = login(collisions, nil, FIRST_GUID, 25); firstLogin.scan()
local fallback, first = firstLogin.ns.CharacterKey(), firstLogin.ns.Me()
assert(fallback ~= BASE and fallback ~= "Examplehero-00000001-" .. REALM)
firstLogin = login(collisions, nil, FIRST_GUID, 25)
assert(firstLogin.ns.Me() == first and firstLogin.ns.CharacterKey() == fallback, "GUID fallback relog")
firstLogin = login(collisions, "First", "Player-1-00000003", 25); firstLogin.scan()
assert(firstLogin.ns.CharacterKey() ~= "Examplehero-First-" .. REALM and firstLogin.ns.Me() ~= first, "surname collision")
for key, c in pairs(collisions.chars) do
  if key == BASE or key == "Examplehero-First-" .. REALM or key == "Examplehero-00000001-" .. REALM then
    assert(c.guid ~= FIRST_GUID and c.guid ~= "Player-1-00000003", "existing collision owner overwritten")
  end
end
local noSurname = { chars = { [BASE] = { guid = SECOND_GUID } } }
firstLogin = login(noSurname, nil, FIRST_GUID, 25)
assert(firstLogin.ns.CharacterKey() == "Examplehero-00000001-" .. REALM, "surname-free key uses GUID tail")
local punctuation = login({}, "  Van First  ", FIRST_GUID, 25, "Ex.ample")
assert(punctuation.ns.Me().surname == "Van First", "identity and key share escaped and trimmed surname parsing")
local missing = { chars = { [BASE] = { guid = SECOND_GUID, money = 999 } } }
local missingBefore = dump(missing.chars)
local h = login(missing, "First", nil, 25)
assert(h.ns.Me() == nil and dump(missing.chars) == missingBefore and missing.lastError, "missing GUID fails before changing any character")
print("OK   legacy ownership, surname changes, absent surname, collisions and unavailable GUID")
return saved
`;
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
// Preserve the expanded fake-game script's line numbers when an assertion fails.
const driverLines = driver.split("\n");
if (lauxlib.luaL_dostring(L, to_luastring(driver)) !== 0) {
  const error = to_jsstring(lua.lua_tostring(L, -1));
  console.error(error);
  const line = Number(error.match(/\]:(\d+):/)?.[1]);
  if (line) console.error(driverLines.slice(line - 3, line + 2).join("\n"));
  process.exit(1);
}
const saved = to_jsstring(lua.lua_tostring(L, -1));
lua.lua_close(L);
for (const format of [2, 3]) {
  const inventory = convertSavedVariables([saved], { format }).inventory;
  assert.deepEqual(validateExport(inventory), []);
  assert.equal(inventory.characters.length, 2);
  const firstLogin = inventory.characters.find(c => c.guid === "Player-1-00000001");
  const secondLogin = inventory.characters.find(c => c.guid === "Player-1-00000002");
  assert.equal(firstLogin.key, "Examplehero-Example Realm");
  assert.equal(secondLogin.key, "Examplehero-Second-Example Realm");
  for (const [c, id] of [[firstLogin, 25], [secondLogin, 35]]) {
    assert.equal(c.equipped[0].id, id);
    assert.equal(c.containers.find(b => b.location === "bags").items[0].id, id);
    assert.equal(c.containers.find(b => b.location === "bank").items[0].id, id);
  }
  assert.equal(inventory.warband.updatedBy, secondLogin.key);
  if (format === 3) assert.equal(inventory.raids[0].events[0].by, secondLogin.key);
}
console.log("OK   exporter/Companion converter keeps both characters, keys and data in valid 2.x and 3.x exports");
