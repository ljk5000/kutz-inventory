// Offline check for KutzInventory/Raids.lua in a small fake game: the raid string's shape, /kinv raid (track, list,
// clear), the active window, which raid records when ids differ, start / end / encounter / loot / roster events,
// loot lines in other languages, the caps and pruning, and that a client without the group APIs records nothing
// and raises no error.
"use strict";
const fs = require("fs");
const path = require("path");
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require("fengari");

const source = fs.readFileSync(path.join(__dirname, "..", "KutzInventory", "Raids.lua"), "utf8");

const code = `
local function fresh(opts)
  opts = opts or {}
  local frames, timers, printed = {}, {}, {}
  local s = { now = 1767225600, group = 5, raid = true, inside = true, itype = "raid", iname = "Molten Core", iid = 409,
              names = { player = "Tester", raid1 = "Tester", raid2 = "Bob", raid3 = "Cy", raid4 = "Dee", raid5 = "Eve" },
              realms = { raid3 = "OtherRealm" } }
  local G = setmetatable({}, { __index = _G })
  G._G = G                                     -- the addon reads LOOT_ITEM etc. through _G, as in the game
  G.CreateFrame = function()
    local f = { scripts = {} }
    function f:SetScript(n, fn) self.scripts[n] = fn end
    function f:RegisterEvent() return true end
    frames[#frames + 1] = f
    return f
  end
  G.C_Timer = { After = function(_, fn) timers[#timers + 1] = fn end }
  G.time = function() return s.now end
  G.date = function(fmt, t) return "D" .. tostring(t) end
  G.print = function(m) printed[#printed + 1] = m end
  G.GetRealmName = function() return "Example Realm" end
  G.UnitName = function(u) return s.names[u], s.realms[u] end
  G.UNKNOWNOBJECT = "Unknown"
  if not opts.noGroupApi then
    G.IsInRaid = function() return s.group > 0 and s.raid end
    G.IsInGroup = function() return s.group > 0 end
    G.GetNumGroupMembers = function() return s.group end
    G.IsInInstance = function() return s.inside, s.inside and s.itype or "none" end
    G.GetInstanceInfo = function()
      if not s.inside then return "Elwynn Forest", "none", 0, "", 0, 0, false, 0 end
      return s.iname, s.itype, 9, "40 Player", 40, 0, false, s.iid
    end
  end
  for k, v in pairs(opts.globals or {}) do G[k] = v end
  G.KutzInventoryDB = opts.db or {}
  local chunk = assert(load([=====[${source}]=====], "@Raids.lua", "t", G))
  local ns = {}
  chunk("KutzInventory", ns)
  local h = { ns = ns, G = G, s = s, printed = printed }
  function h.event(name, ...) frames[1].scripts.OnEvent(frames[1], name, ...) end
  function h.drain() local b = timers; timers = {}; for _, fn in ipairs(b) do fn() end end
  function h.cmd(m) return ns.RaidCommand(m) end
  function h.db() return G.KutzInventoryDB end
  function h.last() return printed[#printed] or "" end
  function h.kinds(code)
    local out = {}
    for _, e in ipairs(G.KutzInventoryDB.raids[code].events) do out[#out + 1] = e.kind end
    return table.concat(out, ",")
  end
  function h.enter() h.event("PLAYER_ENTERING_WORLD"); h.drain() end
  return h
end

local START = 1767225600
local STR = "KR1.ABC234.409.1767225600.ABCDEFGHJKMN"
local function str(code, inst, start) return "KR1." .. code .. "." .. inst .. "." .. start .. ".ABCDEFGHJKMN" end

-- 1) the shape
do
  local h = fresh()
  local P = h.ns.ParseRaidString
  local c, i, t = P(STR)
  assert(c == "ABC234" and i == 409 and t == START, "a good string parses")
  assert(P("KR1.ABC234.0.1767225600.ABCDEFGHJKMN"), "instance 0 is fine")
  for _, bad in ipairs({ "KR2.ABC234.409.1767225600.ABCDEFGHJKMN", "KR1.abc234.409.1767225600.ABCDEFGHJKMN",
                         "KR1.ABC231.409.1767225600.ABCDEFGHJKMN", "KR1.ABC23.409.1767225600.ABCDEFGHJKMN",
                         "KR1.ABC2345.409.1767225600.ABCDEFGHJKMN", "KR1.ABC234.409.1767225600.ABCDEFGHJKM",
                         "KR1.ABC234.409.1767225600.ABCDEFGHJKMNP", "KR1.ABC234.x.1767225600.ABCDEFGHJKMN",
                         "KR1.ABC234.409.ABCDEFGHJKMN", "KR1.ABC234.409.1767225600.abcdefghjkmn", " ", "" }) do
    assert(not P(bad), "refused: " .. bad)
  end
  print("OK   raid string shape (KR1.<CODE>.<instanceId>.<startUnix>.<sig>)")
end

-- 2) /kinv raid: track, list, clear
do
  local h = fresh()
  h.s.now = START - 86400                      -- the day before: nothing is active
  assert(h.cmd("scan") == false and h.cmd("raidx") == false and h.cmd(" raid") == true, "only 'raid ...' is ours")
  h.cmd("raid nonsense")
  assert(h.last():find("isn't a raid string"), "bad string message")
  assert(h.db().raids == nil, "a bad string stores nothing")
  h.cmd("raid   " .. STR .. "  ")
  local r = h.db().raids.ABC234
  assert(r and r.string == STR and r.instanceId == 409 and r.start == START and #r.events == 0, "stored as pasted")
  assert(h.last():find("tracking raid ABC234") and h.last():find("D" .. START), "confirmation with the date")
  h.cmd("raid " .. STR); assert(h.last():find("already tracked"), "same string twice")
  h.cmd("raid"); assert(h.printed[#h.printed]:find("ABC234") and h.printed[#h.printed]:find("0 events"), "list")
  r.events[1] = { t = 1, kind = "start" }
  local moved = "KR1.ABC234.409." .. (START + 3600) .. ".ZYXWVUTSRQPN"
  h.cmd("RAID " .. moved)
  assert(r.string == moved and r.start == START + 3600 and #r.events == 1 and h.db().raids.ABC234 == r, "a new string keeps the events")
  h.cmd("raid clear xyz999"); assert(h.last():find("no tracked raid XYZ999"), "clear unknown")
  h.cmd("raid clear abc234"); assert(h.db().raids.ABC234 == nil and h.last():find("stopped tracking"), "clear")
  h.cmd("raid"); assert(h.last():find("no raids tracked"), "empty list")
  h.s.now = START + 15 * 86400
  h.cmd("raid " .. STR); assert(h.db().raids.ABC234 == nil and h.last():find("more than 14 days"), "too old to track")
  print("OK   /kinv raid tracks, lists and clears, keeps the string verbatim, refuses bad and stale strings")
end

-- 3) the active window: 2 h before to 8 h after, grouped, inside an instance
do
  local function recording(at, setup)
    local h = fresh()
    h.s.now = START - 86400; h.cmd("raid " .. STR)
    h.s.now = at
    if setup then setup(h.s) end
    h.enter()
    return #h.db().raids.ABC234.events > 0
  end
  assert(not recording(START - 2 * 3600 - 1), "before the window")
  assert(recording(START - 2 * 3600), "window opens 2 h early")
  assert(recording(START + 8 * 3600), "window closes 8 h after")
  assert(not recording(START + 8 * 3600 + 1), "after the window")
  assert(not recording(START, function(s) s.group = 0 end), "solo")
  assert(recording(START, function(s) s.group, s.raid = 3, false end), "a party counts")
  assert(not recording(START, function(s) s.inside = false end), "outside an instance")
  assert(not recording(START, function(s) s.itype = "pvp" end), "a battleground is not a raid")
  print("OK   active window (2 h before to 8 h after the start, in a group, inside an instance)")
end

-- 4) events: start, roster, encounters, loot (yours, others', counts, bonus rolls, unknown looter), end
do
  local h = fresh()
  h.s.now = START - 86400; h.cmd("raid " .. STR)
  h.s.now, h.s.inside = START, false
  h.event("CHAT_MSG_LOOT", "You receive loot: |cffa335ee|Hitem:16800::::::::60:::::|h[Arcanist Boots]|h|r.")
  assert(#h.db().raids.ABC234.events == 0, "nothing before entering")
  h.s.inside = true
  h.enter()
  local r = h.db().raids.ABC234
  assert(h.kinds("ABC234") == "start,roster", "start + roster on entering: " .. h.kinds("ABC234"))
  local st = r.events[1]
  assert(st.t == START and st.instanceId == 409 and st.instanceName == "Molten Core" and st.instanceType == "raid"
         and st.difficultyId == 9 and st.by == "Tester-Example Realm", "start event fields")
  assert(table.concat(r.events[2].members, " ") == "Bob-Example Realm Cy-OtherRealm Dee-Example Realm Eve-Example Realm Tester-Example Realm", "roster")
  h.enter()                                    -- a /reload inside: no second start
  assert(h.kinds("ABC234") == "start,roster", "a reload inside keeps the raid open")
  h.s.now = START + 600
  h.event("ENCOUNTER_START", 663, "Lucifron", 9, 40)
  h.s.names.raid5 = nil; h.s.group = 4         -- Eve left before the kill
  h.event("ENCOUNTER_END", 663, "Lucifron", 9, 40, 1)
  h.event("ENCOUNTER_END", 664, "Magmadar", 9, 40, 0)
  h.event("CHAT_MSG_LOOT", "You receive loot: |cffa335ee|Hitem:16800::::::::60:::::|h[Arcanist Boots]|h|r.")
  h.event("CHAT_MSG_LOOT", "Bob receives loot: |cff1eff00|Hitem:17011::::::::60:::::|h[Lava Core]|h|rx3.")
  h.event("CHAT_MSG_LOOT", "Cy-OtherRealm receives bonus loot: |cffa335ee|Hitem:16811::::::::60:::::|h[Boots of Prophecy]|h|r.")
  h.event("CHAT_MSG_LOOT", "Stranger receives loot: |cffffffff|Hitem:2589::::::::60:::::|h[Linen Cloth]|h|r.")
  h.event("CHAT_MSG_LOOT", "Bob has selected Need for: |cffa335ee|Hitem:16811::::::::60:::::|h[Boots of Prophecy]|h|r")
  h.event("CHAT_MSG_LOOT", "You receive loot: no link here.")
  assert(h.kinds("ABC234") == "start,roster,encounter_start,encounter_end,roster,encounter_end,roster,loot,loot,loot,loot",
         h.kinds("ABC234"))
  local e = r.events
  assert(e[3].encounterId == 663 and e[3].encounterName == "Lucifron" and e[3].difficultyId == 9 and e[3].groupSize == 40, "encounter_start")
  assert(e[4].success == true and e[6].success == false and e[6].encounterId == 664, "encounter_end success")
  assert(#e[5].members == 4, "roster after the kill")
  assert(e[8].itemId == 16800 and e[8].looter == "Tester-Example Realm" and e[8].count == 1 and e[8].itemLink:find("Arcanist Boots"), "own loot")
  assert(e[9].itemId == 17011 and e[9].looter == "Bob-Example Realm" and e[9].count == 3, "someone else's stack")
  assert(e[10].itemId == 16811 and e[10].looter == "Cy-OtherRealm", "bonus loot, cross-realm name")
  assert(e[11].looter == "Stranger", "a looter not in the group keeps the name as written")
  h.s.now = START + 7200
  h.event("PLAYER_LEAVING_WORLD")
  h.event("CHAT_MSG_LOOT", "You receive loot: |cffa335ee|Hitem:16800::::::::60:::::|h[Arcanist Boots]|h|r.")
  h.s.now = START + 7230; h.s.inside = false
  h.enter()
  assert(h.kinds("ABC234"):sub(-4) == ",end", "end on leaving")
  assert(e[#e].t == START + 7200 and e[#e].instanceId == 409 and e[#e].instanceName == "Molten Core", "end at the loading screen")
  assert(r.open == nil and r.leftAt == nil, "closed")
  h.event("ENCOUNTER_START", 1, "Outside", 0, 5)
  assert(e[#e].kind == "end", "nothing recorded outside")
  print("OK   start / roster / encounter / loot / end events, reload inside, nothing outside the instance")
end

-- 5) translated loot lines, with the arguments reordered
do
  local h = fresh({ globals = { LOOT_ITEM = "Beute für %1$s: %2$s.", LOOT_ITEM_MULTIPLE = "Beute für %1$s: %2$sx%3$d.",
                                LOOT_ITEM_SELF = "Ihr erhaltet Beute: %s.", LOOT_ITEM_SELF_MULTIPLE = "Ihr erhaltet Beute: %sx%d.",
                                LOOT_ITEM_BONUS_ROLL = "%2$s ist Bonusbeute von %1$s." } })
  local P = h.ns.ParseLoot
  local who, link, n = P("Beute für Bob: |Hitem:5:::|h[X]|hx2.")
  assert(who == "Bob" and link == "|Hitem:5:::|h[X]|h" and n == 2, "German stack: " .. tostring(who) .. " " .. tostring(link))
  who, link, n = P("Ihr erhaltet Beute: |Hitem:6:::|h[Y]|h.")
  assert(who == "" and link == "|Hitem:6:::|h[Y]|h" and n == 1, "German self")
  who, link = P("|Hitem:7:::|h[Z]|h ist Bonusbeute von Cy.")
  assert(who == "Cy" and link == "|Hitem:7:::|h[Z]|h", "reordered arguments")
  assert(P("Bob receives loot: |Hitem:5:::|h[X]|h.") == nil, "the English line is not this client's")
  print("OK   loot lines read with the client's own (translated, reordered) format strings")
end

-- 6) two raids in the window: the one whose instance id matches records; ids that don't match still record
do
  local h = fresh()
  h.s.now = START - 86400
  h.cmd("raid " .. str("AAAAAA", 409, START)); h.cmd("raid " .. str("BBBBBB", 249, START)); h.cmd("raid " .. str("CCCCCC", 0, START))
  h.s.now = START; h.enter()
  local raids = h.db().raids
  assert(#raids.AAAAAA.events == 2 and #raids.BBBBBB.events == 0 and #raids.CCCCCC.events == 0, "matching id wins")
  local g = fresh()
  g.s.now = START - 86400; g.cmd("raid " .. str("BBBBBB", 249, START)); g.cmd("raid " .. str("CCCCCC", 0, START))
  g.s.now = START; g.enter()
  raids = g.db().raids
  assert(#raids.BBBBBB.events == 2 and #raids.CCCCCC.events == 2, "lenient when no id matches")
  -- moving to another instance in the window ends one stay and starts the next
  g.s.now = START + 60; g.s.iid, g.s.iname = 249, "Onyxia's Lair"; g.enter()
  assert(g.kinds("CCCCCC") == "start,roster,end" and g.kinds("BBBBBB") == "start,roster,end,start,roster"
         and raids.BBBBBB.events[4].instanceId == 249 and raids.BBBBBB.events[3].instanceId == 409, g.kinds("BBBBBB"))
  print("OK   instance ids: a matching raid is preferred, others still record when none matches")
end

-- 7) caps and pruning
do
  local h = fresh()
  h.s.now = START - 86400; h.cmd("raid " .. STR)
  h.s.now = START; h.enter()
  for i = 1, 2100 do h.event("ENCOUNTER_START", i, "Boss", 9, 40) end
  assert(#h.db().raids.ABC234.events == 2000, "events capped at 2000: " .. #h.db().raids.ABC234.events)
  local db = { raids = {} }
  local letters = "ABCDEFGHJKLMNPQRSTUVWXYZ"
  for i = 1, 24 do
    local c = letters:sub(i, i):rep(6)
    db.raids[c] = { string = str(c, 0, START + i), instanceId = 0, start = START + i, events = {} }
  end
  db.raids.OLDOLD = { string = str("OLDOLD", 0, START - 15 * 86400), instanceId = 0, start = START - 15 * 86400, events = {} }
  db.raids.BROKEN = "not a table"
  local g = fresh({ db = db })
  g.s.now = START
  g.event("ADDON_LOADED", "OtherAddon"); assert(db.raids.OLDOLD, "only our ADDON_LOADED prunes")
  g.event("ADDON_LOADED", "KutzInventory")
  local n = 0
  for _ in pairs(db.raids) do n = n + 1 end
  assert(n == 20 and not db.raids.OLDOLD and not db.raids.BROKEN and not db.raids.AAAAAA and db.raids.ZZZZZZ, "kept the 20 newest: " .. n)
  g.cmd("raid " .. str("222222", 0, START - 3600))
  assert(not db.raids["222222"] and g.last():find("older than the 20"), "an older 21st is not kept")
  g.cmd("raid " .. str("333333", 0, START + 99))
  n = 0
  for _ in pairs(db.raids) do n = n + 1 end
  assert(n == 20 and db.raids["333333"] and not db.raids.EEEEEE, "a newer one replaces the oldest")
  print("OK   at most 2000 events per raid and 20 raids; raids 14 days past their start are dropped")
end

-- 8) a client without the group / instance APIs: nothing recorded, no error
do
  local h = fresh({ noGroupApi = true })
  h.s.now = START - 86400; h.cmd("raid " .. STR)
  h.s.now = START; h.enter()
  h.event("ENCOUNTER_START", 1, "Boss", 9, 40); h.event("ENCOUNTER_END", 1, "Boss", 9, 40, 1)
  h.event("CHAT_MSG_LOOT", "You receive loot: |Hitem:6:::|h[Y]|h.")
  h.event("GROUP_ROSTER_UPDATE"); h.event("PLAYER_LEAVING_WORLD")
  assert(#h.db().raids.ABC234.events == 0 and not h.db().lastError, "no APIs, no events, no error: " .. tostring(h.db().lastError))
  -- and no raids at all: the events do nothing and create nothing
  local g = fresh()
  g.s.now = START; g.enter(); g.event("ENCOUNTER_END", 1, "Boss", 9, 40, 1)
  g.event("CHAT_MSG_LOOT", "You receive loot: |Hitem:6:::|h[Y]|h.")
  assert(g.db().raids == nil and not g.db().lastError, "untracked: nothing stored")
  print("OK   untracked raids record nothing; a client without the group APIs records nothing and raises no error")
end
`;
// The real /kinv: every file the .toc loads, in a fake game where unknown globals are harmless stubs.
const addonDir = path.join(__dirname, "..", "KutzInventory");
const toc = fs.readFileSync(path.join(addonDir, "KutzInventory.toc"), "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l.endsWith(".lua"));
const slash = `
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
time = function() return 1767225600 - 86400 end
date = function(_, t) return "D" .. tostring(t) end
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
for _, f in ipairs(frames) do
  local on = f.scripts.OnEvent
  if on then on(f, "ADDON_LOADED", "KutzInventory"); on(f, "PLAYER_LOGIN") end
end
SlashCmdList.KUTZINVENTORY("raid KR1.ABC234.409.1767225600.ABCDEFGHJKMN")
local r = KutzInventoryDB.raids and KutzInventoryDB.raids.ABC234
assert(r and r.string == "KR1.ABC234.409.1767225600.ABCDEFGHJKMN", "/kinv raid <string> did not reach Raids.lua")
SlashCmdList.KUTZINVENTORY("raid")
assert(printed[#printed]:find("ABC234"), "/kinv raid did not list")
SlashCmdList.KUTZINVENTORY("raid clear ABC234")
assert(KutzInventoryDB.raids.ABC234 == nil, "/kinv raid clear")
assert(not KutzInventoryDB.lastError, tostring(KutzInventoryDB.lastError))
say("OK   /kinv raid goes through the addon's slash command with every .toc file loaded")
`;
for (const chunk of [code, slash]) {
    const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
    if (lauxlib.luaL_dostring(L, to_luastring(chunk)) !== 0) {
        console.error("FAIL " + to_jsstring(lua.lua_tostring(L, -1))); process.exit(1);
    }
}
