-- The test body of tools/check_facts.js (run there, in fengari): KutzInventory/Facts.lua, Saved.lua and the vendor
-- list of Prices.lua in a small fake game. check_facts.js sets SOURCE = { Facts = ..., Saved = ..., Prices = ... }.
-- Nothing here runs in the game.

local LF = "\n"

local function dump(v)
  if type(v) ~= "table" then return tostring(v) end
  local keys = {}
  for k in pairs(v) do keys[#keys + 1] = k end
  table.sort(keys, function(a, b) return tostring(a) < tostring(b) end)
  local out = {}
  for _, k in ipairs(keys) do out[#out + 1] = tostring(k) .. "=" .. dump(v[k]) end
  return "{" .. table.concat(out, ",") .. "}"
end
local function deep(v)
  if type(v) ~= "table" then return v end
  local out = {}
  for k, x in pairs(v) do out[k] = deep(x) end
  return out
end
local function count(t) local n = 0; for _ in pairs(t or {}) do n = n + 1 end; return n end
local function equal(a, b)                      -- the same value all the way down, whatever the depth
  if a == b then return true end
  if type(a) ~= "table" or type(b) ~= "table" then return false end
  for k, v in pairs(a) do if not equal(v, b[k]) then return false end end
  for k in pairs(b) do if a[k] == nil then return false end end
  return true
end

-- A value as this client writes it into a saved-variables file: no indentation, one value per line, CR LF
-- (measured on a real 6.17 MB file: this format gives its size to within 0.01%). Facts.Disk must agree with it.
local function written(v)
  if type(v) == "string" then
    return '"' .. v:gsub('[\\"]', "\\%0"):gsub("\n", "\\n"):gsub("\r", "\\r") .. '"'
  end
  if type(v) ~= "table" then return tostring(v) end
  local out = { "{" }
  for k, x in pairs(v) do
    out[#out + 1] = "[" .. (type(k) == "string" and ('"' .. k .. '"') or tostring(k)) .. "] = " .. written(x) .. ","
  end
  out[#out + 1] = "}"
  return table.concat(out, "\r\n")
end

local DAY0 = 20454
local function fresh(opts)
  opts = opts or {}
  local s = { now = DAY0 * 86400 + 3600, clock = 100, prof = 0, cost = 0.5, combat = false, fps = 60, info = {}, stats = {}, tips = {},
              timers = {}, frames = {}, requested = {}, reads = {}, printed = {}, units = {}, statReads = {} }
  local G = setmetatable({}, { __index = _G })
  G._G = G
  G.time = function() return s.now end
  G.GetTime = function() return s.clock end
  G.print = function(m) s.printed[#s.printed + 1] = m end
  G.CreateFrame = function()
    local f = { scripts = {}, events = {} }
    function f:SetScript(n, fn) self.scripts[n] = fn end
    function f:RegisterEvent(e) self.events[e] = true; return true end
    function f:Show() self.shown = true end
    function f:Hide() self.shown = false end
    s.frames[#s.frames + 1] = f
    return f
  end
  G.C_Timer = { After = function(delay, fn) s.timers[#s.timers + 1] = { delay = delay, fn = fn } end }
  G.GetBuildInfo = function() return s.version or "1.60.1", s.build or "71037", "Nov 1 2026", 16001 end
  G.InCombatLockdown = function() return s.combat end
  G.UnitAffectingCombat = function() return s.combat end
  G.GetFramerate = function() return s.fps end
  G.debugprofilestop = opts.realClock and function() return os.clock() * 1000 end or function() return s.prof end
  G.C_Item = {
    GetItemInfo = function(link)
      s.reads[#s.reads + 1] = link
      s.prof = s.prof + s.cost
      local x = s.info[tonumber(link:match("^item:(%d+)"))]
      if not x then return nil end
      return x.name, nil, x.q, x.ilvl, x.req, "Type", "Sub", 1, x.slot or "", 1, 100, x.cls, x.sub, x.bind, 0, x.set
    end,
    GetItemStats = function(link) s.statReads[#s.statReads + 1] = link; return s.stats[link] end,
    RequestLoadItemDataByID = function(id) s.requested[#s.requested + 1] = id end,
  }
  G.C_TooltipInfo = { GetHyperlink = function(link, _, _, hide)
    s.hide = hide
    local t = s.tips[link]
    if t == "error" then error("tooltip failed") end
    if t then return { lines = t } end
  end }
  G.UnitIsDead = function(u) local x = s.units[u]; return x and x.dead or false end
  G.UnitGUID = function(u) local x = s.units[u]; return x and x.guid end
  G.UnitIsPlayer = function(u) local x = s.units[u]; return x and x.player or false end
  G.UnitPlayerControlled = function(u) local x = s.units[u]; return x and x.controlled or false end
  G.UnitIsTapDenied = function(u) local x = s.units[u]; return x and x.tapped or false end
  G.UnitLevel = function(u) local x = s.units[u]; return x and x.level end
  G.KutzInventoryObsDB = opts.db or { on = true, agreed = true }
  for k, v in pairs(opts.globals or {}) do G[k] = v end
  for _, k in ipairs(opts.without or {}) do G[k] = nil; rawset(G, k, nil) end
  local ns = {}
  assert(load(SOURCE.Saved, "@Saved.lua", "t", G))("KutzInventory", ns)
  assert(load(SOURCE.Facts, "@Facts.lua", "t", G))("KutzInventory", ns)
  local h = { ns = ns, F = ns.Facts, S = ns.Saved, G = G, s = s }
  function h.db() return G.KutzInventoryObsDB end
  function h.items() return G.KutzInventoryObsDB.items or {} end
  -- runs the one pending timer (there is never more than one) and returns the delay of the next, or nil
  function h.step()
    assert(#s.timers == 1, "exactly one timer waits, not " .. #s.timers)
    local t = table.remove(s.timers, 1)
    s.clock = s.clock + t.delay                 -- the next frame it runs in
    t.fn()
    assert(#s.timers <= 1, "at most one timer after a step")
    return s.timers[1] and s.timers[1].delay or nil
  end
  function h.run(max)                           -- until nothing waits; returns the steps taken
    local n = 0
    while #s.timers > 0 and n < (max or 200) do h.step(); n = n + 1 end
    return n
  end
  function h.event(name) for _, f in ipairs(s.frames) do if f.events[name] and f.scripts.OnEvent then f.scripts.OnEvent(f, name) end end end
  return h
end

local function link(id, name, tail)
  return "|cffffffff|Hitem:" .. id .. (tail or "::::::::60:::::") .. "|h[" .. (name or ("Item " .. id)) .. "]|h|r"
end
local function known(h, id, x)
  x = x or {}
  h.s.info[id] = { name = x.name or ("Item " .. id), q = x.q or 1, ilvl = x.ilvl or 10, req = x.req or 0, cls = x.cls or 7, sub = x.sub or 5,
                   bind = x.bind or 0, slot = x.slot, set = x.set }
  h.s.tips["item:" .. id] = x.tip or { { leftText = x.name or ("Item " .. id) }, { leftText = "A line of the tooltip." } }
end
local SHIELD = "|cff1eff00|Hitem:6560::::::::19:1489:::1:12729::::::|h[Soldier's Shield of Intellect]|h|r"
local SHIELD_VAR = "item:6560::::::::::::1:12729"
local function shield(h)
  known(h, 6560, { name = "Soldier's Shield", q = 2, ilvl = 25, req = 20, cls = 4, sub = 6, bind = 2, slot = "INVTYPE_SHIELD",
                   tip = { { leftText = "Soldier's Shield", leftColor = { r = 0.12, g = 1, b = 0 } },
                           { leftText = "Off Hand", rightText = "Shield" },
                           { leftText = "Requires Level 20", leftColor = { r = 1, g = 0.125, b = 0.125 } } } })
  h.s.stats["item:6560"] = { ITEM_MOD_STAMINA_SHORT = 3, RESISTANCE0_NAME = 478 }
  h.s.stats[SHIELD_VAR] = { ITEM_MOD_INTELLECT_SHORT = 5, RESISTANCE0_NAME = 478 }
end

---------------------------------------------------------------------------
-- 1) links: the item id and what names a random suffix; the clean link built from them
---------------------------------------------------------------------------
do
  local h = fresh()
  local function parse(l) local id, var = h.F.Parse(l); return tostring(id) .. "/" .. tostring(var) end
  local clean = h.F.CleanLink
  assert(parse(SHIELD) == "6560/0;12729", parse(SHIELD))
  assert(clean(6560, "0;12729") == SHIELD_VAR, clean(6560, "0;12729"))
  assert(parse("|cff1eff00|H" .. SHIELD_VAR .. "|h[x]|h|r") == "6560/0;12729", "a clean link reads back as the same variant")
  assert(parse("item:6560::::::1203:1846231:60") == "6560/1203;" and clean(6560, "1203;") == "item:6560::::::1203::::::", "the older suffix field")
  assert(parse(clean(6560, "1203;")) == "6560/1203;")
  assert(parse("item:6560::::::-12:5:60") == "6560/-12;" and clean(6560, "-12;") == "item:6560::::::-12::::::", "a negative suffix id")
  assert(parse("|Hitem:100::::::::60::::2:300:100|h[x]|h") == "100/0;100:300", "bonus ids sorted: " .. parse("|Hitem:100::::::::60::::2:300:100|h[x]|h"))
  assert(clean(100, "0;100:300") == "item:100::::::::::::2:100:300" and parse(clean(100, "0;100:300")) == "100/0;100:300")
  assert(parse(link(2589, "Linen Cloth")) == "2589/nil" and clean(2589) == "item:2589", "no suffix: the id alone")
  assert(parse("|Hitem:19019::::::::60::::::1:28:5247|h[x]|h") == "19019/nil", "modifiers are not a suffix")
  assert(parse("|Hitem:5::::::::60::::3:7:8|h[x]|h") == "5/nil", "a bonus count the link does not keep: no variant")
  assert(parse("|Hitem:6242:41:3:4:5:6::77:24:::::|h[Blue Linen Robe]|h|r") == "6242/nil", "enchant, gems and unique id are the copy's")
  for _, junk in ipairs({ "", "item:abc", "|Hspell:6560|h[x]|h", "item:0", "item:99999999999", "item:1.5" }) do
    assert(parse(junk) == "nil/nil", "not an item link: " .. junk .. " " .. parse(junk))
  end
  assert(parse(nil) == "nil/nil" and parse(5) == "nil/nil" and parse({}) == "nil/nil")
  assert(h.F.Met(SHIELD) == "::::::::::::1:12729" and h.F.Met(link(2589)) == "" and h.F.Met("junk") == "" and h.F.Met(nil) == "", "what a short link keeps")
  print("OK   links: item id, suffix id and bonus ids (sorted) make the variant; enchant, gems, unique id, level and modifiers are dropped")
end

---------------------------------------------------------------------------
-- 2) one item's facts as stored
---------------------------------------------------------------------------
do
  local h = fresh(); shield(h)
  h.s.tips["item:6560"] = {
    { leftText = "Soldier's Shield", leftColor = { r = 0.12, g = 1, b = 0 } },
    { leftText = "Off Hand", rightText = "Shield" },
    { leftText = "Requires Level 20", leftColor = { r = 1, g = 0.125, b = 0.125 } },
    { leftText = "Classes: Warrior", rightText = "Paladin", rightColor = { r = 1, g = 0.125, b = 0.125 } },
    { leftText = "Use: one" .. LF .. "two\r" },
    { leftText = "" }, { leftText = "   " }, { rightText = "Only right" }, "junk", { leftText = 5 },
  }
  h.s.stats["item:6560"] = { ITEM_MOD_STAMINA_SHORT = 3, RESISTANCE0_NAME = 478, ITEM_MOD_CRIT_RATING_SHORT = 1.5, ["bad key"] = 1, EMPTY_SOCKET = "x" }
  h.F.Meet(link(6560, "Soldier's Shield"))
  assert(h.step() == nil and #h.s.reads == 1 and h.s.reads[1] == "item:6560", "one read, from the id alone: " .. dump(h.s.reads))
  local e = h.items()[6560]
  assert(e and e.d == DAY0 and e.m == DAY0 and e.b == 1 and h.db().itemBuilds[1] == "1.60.1.71037", dump(e) .. dump(h.db().itemBuilds))
  assert(e.f == "2:2:4:6:25:20::INVTYPE_SHIELD", e.f)
  assert(e.s == "ITEM_MOD_CRIT_RATING_SHORT=1.50,ITEM_MOD_STAMINA_SHORT=3,RESISTANCE0_NAME=478", e.s)
  assert(e.t == table.concat({ "-Soldier's Shield", "-Off Hand", ">Shield", "!Requires Level 20", "-Classes: Warrior", "]Paladin", "-Use: one|ntwo", "-", ">Only right" }, LF), e.t)
  assert(e.n == nil and e.v == nil, "the name is the tooltip's first line: not stored twice")
  assert(h.s.hide == true, "the tooltip is asked for without the vendor price line")
  -- the name is kept when the tooltip does not start with it, or when there is no tooltip
  known(h, 11, { name = "Linen Cloth", tip = { { leftText = "|cffffffffLinen Cloth|r" } } }); h.F.Meet(link(11)); h.run()
  assert(h.items()[11].n == "Linen Cloth" and h.items()[11].t == "-|cffffffffLinen Cloth|r", dump(h.items()[11]))
  known(h, 12, { name = "Linen", tip = { { leftText = "Linen Cloth" } } }); h.F.Meet(link(12)); h.run()
  assert(h.items()[12].n == "Linen", "a longer first line is not the name")
  known(h, 13, { name = "Gone" }); h.s.tips["item:13"] = "error"; h.F.Meet(link(13)); h.run()
  assert(h.items()[13].n == "Gone" and h.items()[13].t == nil and not h.db().lastError, "a tooltip that fails: the rest is kept")
  known(h, 14, { name = "Set Piece", set = 123, slot = "bad slot!" }); h.F.Meet(link(14)); h.run()
  assert(h.items()[14].f == "1:0:7:5:10:0:123:", "set id; a slot that is not a token is left out: " .. h.items()[14].f)
  local bare = fresh({ without = { "C_TooltipInfo" } }); known(bare, 6560, { name = "Soldier's Shield" })
  bare.F.Meet(link(6560)); bare.run()
  assert(bare.items()[6560].n == "Soldier's Shield" and bare.items()[6560].t == nil and bare.items()[6560].s == nil and not bare.db().lastError, "no tooltip API")
  -- long tooltips are cut: 60 lines, 600 bytes a text
  local long = {}
  for i = 1, 80 do long[i] = { leftText = "line " .. i .. string.rep("x", i == 2 and 900 or 0) } end
  known(h, 15, { name = "line 1", tip = long }); h.F.Meet(link(15)); h.run()
  local lines = 0
  for part in (h.items()[15].t .. LF):gmatch("(.-)" .. LF) do lines = lines + 1; assert(#part <= 601, "a text over 600 bytes") end
  assert(lines == 60, "60 lines, not " .. lines)
  print("OK   one item: quality, bind, class, subclass, item level, required level, set, slot, stats, every tooltip line with its side and red flag")
end

---------------------------------------------------------------------------
-- 3) the queue: one read per step, 0.25 s apart, never in combat, not under 20 fps, paused and stopped by slow reads
---------------------------------------------------------------------------
do
  local h = fresh()
  for id = 1, 5 do known(h, id); h.F.Meet(link(id)) end
  assert(#h.s.timers == 1 and h.s.timers[1].delay == 0.25 and #h.s.reads == 0, "meeting reads nothing: it waits for a timer")
  for i = 1, 5 do
    local delay = h.step()
    assert(#h.s.reads == i, "one read per step: " .. #h.s.reads .. " after step " .. i)
    assert(delay == (i < 5 and 0.25 or nil), "0.25 s to the next read, then nothing: " .. tostring(delay))
  end
  assert(count(h.items()) == 5)
  for id = 1, 5 do h.F.Meet(link(id)); h.F.Meet(link(id, "Other text")) end
  assert(#h.s.timers == 0 and #h.s.reads == 5, "an item held on this build is not read again")

  -- in combat (or when the client cannot say): the queue waits and reads nothing
  local c = fresh(); known(c, 1); c.s.combat = true; c.F.Meet(link(1))
  for _ = 1, 5 do assert(c.step() == 2 and #c.s.reads == 0, "no read in combat") end
  c.s.combat = false
  assert(c.step() == nil and #c.s.reads == 1, "read once out of combat")
  for _, how in ipairs({ { InCombatLockdown = function() return nil end }, { UnitAffectingCombat = function() return true end },
                         { InCombatLockdown = function() error("no") end } }) do
    local x = fresh({ globals = how }); known(x, 1); x.F.Meet(link(1))
    assert(x.step() == 2 and #x.s.reads == 0, "combat state unknown or fighting: no read")
  end
  local SECRET = {}
  local sec = fresh({ globals = { issecretvalue = function(v) return v == SECRET end, InCombatLockdown = function() return SECRET end } })
  known(sec, 1); sec.F.Meet(link(1))
  assert(sec.step() == 2 and #sec.s.reads == 0, "a secret combat state: no read")
  local none = fresh({ without = { "InCombatLockdown", "UnitAffectingCombat" } }); known(none, 1); none.F.Meet(link(1))
  assert(none.step() == 2 and #none.s.reads == 0, "no combat API at all: no read")

  -- a low frame rate: wait
  local f = fresh(); known(f, 1); f.s.fps = 12; f.F.Meet(link(1))
  assert(f.step() == 2 and #f.s.reads == 0, "under 20 fps: no read")
  f.s.fps = 0; assert(f.step() == nil and #f.s.reads == 1, "a frame rate the client does not give does not block")

  -- an item the client has not loaded: asked for, tried again a second later, three times, then left
  local u = fresh(); u.F.Meet(link(77))
  assert(u.step() == 1 and u.step() == 1 and u.step() == 1 and u.step() == nil, "three more tries, 1 s apart")
  assert(#u.s.reads == 4 and #u.s.requested == 4 and u.s.requested[1] == 77 and count(u.items()) == 0)
  u.F.Meet(link(77)); assert(#u.s.timers == 0, "not asked for again this session")
  local late = fresh(); late.F.Meet(link(78)); late.step(); known(late, 78)
  assert(late.step() == nil and late.items()[78] ~= nil, "loaded by the second try")
  local sn = fresh({ globals = { issecretvalue = function(v) return v == SECRET end } }); known(sn, 1); sn.s.info[1].name = SECRET
  sn.F.Meet(link(1)); sn.run()
  assert(count(sn.items()) == 0 and not sn.db().lastError, "a secret name: nothing stored")

  -- slow reads: 10 s pause after one over 8 ms; three in a row stop the queue for the session
  local sl = fresh(); for id = 1, 9 do known(sl, id); sl.F.Meet(link(id)) end
  sl.s.cost = 9
  assert(sl.step() == 10, "a read over 8 ms: a 10 s pause")
  sl.s.cost = 0.5
  assert(sl.step() == 0.25, "a fast read: back to the pace")
  sl.s.cost = 9
  assert(sl.step() == 10 and sl.step() == 10 and sl.step() == nil, "three slow reads in a row: stopped")
  assert(#sl.s.reads == 5 and select(1, sl.F.Status()):find("stopped for this session"), (sl.F.Status()))
  known(sl, 50); sl.F.Meet(link(50)); assert(#sl.s.timers == 0, "stopped: nothing is scheduled any more")
  assert(sl.F.Perf().slow == 4 and sl.F.Perf().reads == 5, dump(sl.F.Perf()))

  -- off: nothing is met, and what waited is dropped
  local off = fresh({ db = { on = false, agreed = true } }); known(off, 1); off.F.Meet(link(1))
  assert(#off.s.timers == 0 and off.db().items == nil, "off: nothing")
  local turned = fresh(); known(turned, 1); known(turned, 2); turned.F.Meet(link(1)); turned.F.Meet(link(2))
  turned.db().on = false
  assert(turned.step() == nil and #turned.s.reads == 0, "turned off while waiting: dropped")
  turned.db().on = true; turned.F.Meet(link(1)); assert(#turned.s.timers == 0, "(met this session: not queued again)")

  -- missing APIs: no error, nothing read, today's behaviour
  for _, gone in ipairs({ "C_Timer", "C_Item", "GetBuildInfo", "debugprofilestop", "GetFramerate", "GetTime" }) do
    local x = fresh({ without = { gone } }); known(x, 1)
    x.F.Meet(link(1)); x.F.Met(SHIELD); x.run()
    assert(not x.db().lastError, gone .. " missing: " .. tostring(x.db().lastError))
    if gone == "C_Timer" or gone == "C_Item" then assert(count(x.items()) == 0, gone .. " missing: nothing stored") end
    if gone == "GetBuildInfo" then assert(x.items()[1] and x.items()[1].b == 0, "no build: index 0") end
    if gone == "debugprofilestop" then assert(x.items()[1] and select(2, x.F.Status()):find("cannot be measured")) end
  end

  -- a full queue: the rest is met again later
  local q = fresh(); q.F.ITEMS.QUEUE = 3
  for id = 1, 5 do known(q, id); q.F.Meet(link(id)) end
  q.run(); assert(count(q.items()) == 3, "three waited")
  for id = 1, 5 do q.F.Meet(link(id)) end
  q.run(); assert(count(q.items()) == 5 and #q.s.reads == 5, "the two that did not fit are read when met again")
  print("OK   queue: one read per 0.25 s step, none in combat or under 20 fps, retries, slow-read pause and stop, off, missing APIs, full queue")
end

---------------------------------------------------------------------------
-- 4) sessions, builds, and day-on-change: met again moves m only (d stays); a changed field, new build or variant moves d
---------------------------------------------------------------------------
do
  local h = fresh(); shield(h); h.F.Meet(link(6560)); h.run()
  local db = h.db()
  assert(db.items[6560].d == DAY0 and db.items[6560].m == DAY0, dump(db.items[6560]))
  local again = fresh({ db = db }); shield(again); again.s.now = again.s.now + 3 * 86400
  again.F.Meet(link(6560)); again.F.Meet(link(6560, "Soldier's Shield", ":55:::::::60:::::"))
  assert(#again.s.timers == 0 and #again.s.reads == 0 and db.items[6560].d == DAY0 and db.items[6560].m == DAY0 + 3,
         "a later session: m moves, exported d stays unchanged, nothing is read: " .. dump(db.items[6560]))
  -- a new build moves d (and m), even if only the build changed
  local patch = fresh({ db = db }); shield(patch); patch.s.now = patch.s.now + 4 * 86400; patch.s.build = "71100"
  patch.s.stats["item:6560"] = { ITEM_MOD_STAMINA_SHORT = 4, RESISTANCE0_NAME = 478 }
  patch.F.Meet(link(6560)); patch.run()
  assert(#patch.s.reads == 1 and db.items[6560].b == 2 and db.items[6560].d == DAY0 + 4 and db.items[6560].m == DAY0 + 4
         and dump(db.itemBuilds) == "{1=1.60.1.71037,2=1.60.1.71100}"
         and db.items[6560].s == "ITEM_MOD_STAMINA_SHORT=4,RESISTANCE0_NAME=478", "a new build: read again and d moves: " .. dump(db.items[6560]))
  -- build-only change also moves d
  local buildOnly = fresh({ db = db }); shield(buildOnly); buildOnly.s.now = buildOnly.s.now + 5 * 86400; buildOnly.s.build = "71200"
  buildOnly.s.stats["item:6560"] = { ITEM_MOD_STAMINA_SHORT = 4, RESISTANCE0_NAME = 478 }
  buildOnly.F.Meet(link(6560)); buildOnly.run()
  assert(#buildOnly.s.reads == 1 and db.items[6560].b == 3 and db.items[6560].d == DAY0 + 5 and db.items[6560].m == DAY0 + 5,
         "build-only change moves d: " .. dump(db.items[6560]))
  -- re-read on same build (no GetBuildInfo, forced via missing b): identical content leaves d alone and keeps variants;
  -- changing any exported field (name, quality, bind, class, subclass, ilvl, req, set, slot, durability, stats, tip) moves d
  local function reread(mutate)
    local x = fresh({ without = { "GetBuildInfo" } }); shield(x)
    x.s.tips["item:6560"][#x.s.tips["item:6560"] + 1] = { leftText = "Durability 65 / 65" }
    x.F.Meet(SHIELD); x.run()
    local saved = x.db()
    assert(saved.items[6560].d == DAY0 and saved.items[6560].m == DAY0 and saved.items[6560].v["0;12729"])
    saved.items[6560].b = nil                   -- force a re-read while BuildName stays nil on both sides
    local y = fresh({ db = saved, without = { "GetBuildInfo" } }); shield(y)
    y.s.tips["item:6560"][#y.s.tips["item:6560"] + 1] = { leftText = "Durability 65 / 65" }
    y.s.now = y.s.now + 6 * 86400
    if mutate then mutate(y) end
    y.F.Meet(link(6560)); y.run()
    return saved.items[6560]
  end
  local same = reread(nil)
  assert(same.d == DAY0 and same.m == DAY0 + 6 and same.v and same.v["0;12729"], "identical re-read leaves d alone and keeps variants: " .. dump(same))
  for label, fn in pairs({
    name = function(y) y.s.info[6560].name = "Renamed Shield" end,
    quality = function(y) y.s.info[6560].q = 3 end,
    bind = function(y) y.s.info[6560].bind = 1 end,
    class = function(y) y.s.info[6560].cls = 2 end,
    subclass = function(y) y.s.info[6560].sub = 7 end,
    ilvl = function(y) y.s.info[6560].ilvl = 30 end,
    req = function(y) y.s.info[6560].req = 25 end,
    set = function(y) y.s.info[6560].set = 99 end,
    slot = function(y) y.s.info[6560].slot = "INVTYPE_WEAPONOFFHAND" end,
    durability = function(y) y.s.tips["item:6560"][4] = { leftText = "Durability 80 / 80" } end,
    stats = function(y) y.s.stats["item:6560"] = { ITEM_MOD_STAMINA_SHORT = 9, RESISTANCE0_NAME = 478 } end,
    tip = function(y) y.s.tips["item:6560"][2] = { leftText = "Off Hand", rightText = "Buckler" } end,
  }) do
    local changed = reread(fn)
    assert(changed.d == DAY0 + 6 and changed.m == DAY0 + 6 and changed.v and changed.v["0;12729"],
           "changed " .. label .. " moves d: " .. dump(changed))
  end
  -- old saved file (pre-m): loads without error, leaves d alone when met again, adds m, keeps Disk exact
  local oldDb = { on = true, agreed = true, itemBuilds = { "1.60.1.71037" },
                  items = { [6560] = { d = DAY0, b = 1, f = "2:2:4:6:25:20::INVTYPE_SHIELD", s = "ITEM_MOD_STAMINA_SHORT=3,RESISTANCE0_NAME=478",
                                       t = "-Soldier's Shield" .. LF .. "-Off Hand" .. LF .. ">Shield" } } }
  local loaded = fresh({ db = oldDb }); shield(loaded); loaded.s.now = (DAY0 + 7) * 86400
  loaded.F.Meet(link(6560))
  assert(#loaded.s.reads == 0 and not oldDb.lastError and oldDb.items[6560].d == DAY0 and oldDb.items[6560].m == DAY0 + 7,
         "old saved file loads and adds m without moving d: " .. dump(oldDb.items[6560]))
  assert(#written(oldDb.items) == loaded.F.Disk(oldDb.items), "Disk matches after adding m to old entry")
  -- pruned item is read again when met
  db.items[6560] = nil
  local back = fresh({ db = db }); shield(back); back.s.build = "71200"; back.F.Meet(link(6560)); back.run()
  assert(#back.s.reads == 1 and db.items[6560] and db.items[6560].b == 3, "an item that was pruned is read when met again")
  print("OK   item day moves only on content change (first read, changed field/build/tip, variant); meeting again moves m only; old saved files load")
end

---------------------------------------------------------------------------
-- 5) random suffixes: one item with variants, never several items
---------------------------------------------------------------------------
do
  local h = fresh(); shield(h)
  h.F.Meet(SHIELD)
  assert(h.step() == 0.25 and h.step() == nil, "the item, then its suffix")
  assert(count(h.items()) == 1 and #h.s.reads == 1 and h.s.reads[1] == "item:6560", "one item; the item's facts come from the plain id: " .. dump(h.s.reads))
  local e = h.items()[6560]
  assert(e.f == "2:2:4:6:25:20::INVTYPE_SHIELD" and e.s == "ITEM_MOD_STAMINA_SHORT=3,RESISTANCE0_NAME=478" and e.n == nil, dump(e))
  assert(dump(e.v) == "{0;12729=Soldier's Shield of Intellect" .. LF .. "ITEM_MOD_INTELLECT_SHORT=5,RESISTANCE0_NAME=478}", dump(e.v))
  assert(h.s.statReads[#h.s.statReads] == SHIELD_VAR, "the suffix's stats are asked for with a link of id and suffix alone: " .. dump(h.s.statReads))
  -- a second suffix of the same item on a later day moves d; meeting a known variant again leaves d alone;
  -- changing a variant's content moves d
  local BEAR = "|cff1eff00|Hitem:6560:929:::::::44:1489:::1:12741::::::|h[Soldier's Shield of the Bear]|h|r"
  h.s.stats["item:6560::::::::::::1:12741"] = { ITEM_MOD_STAMINA_SHORT = 3, RESISTANCE0_NAME = 478 }   -- the client ignored the suffix
  h.s.now = (DAY0 + 2) * 86400
  h.F.Meet(BEAR); h.run()
  assert(count(h.items()) == 1 and count(e.v) == 2 and e.v["0;12741"] == "Soldier's Shield of the Bear" .. LF
         and e.d == DAY0 + 2 and e.m == DAY0 + 2,
         "new variant moves d and stats equal to plain item are omitted: " .. dump(e))
  h.s.now = (DAY0 + 3) * 86400
  h.F.Meet(SHIELD); h.F.Meet(BEAR); h.F.Meet(BEAR:gsub(":929:", ":1:"))
  assert(#h.s.timers == 0 and #h.s.reads == 1 and e.d == DAY0 + 2 and e.m == DAY0 + 3,
         "known variants are not read again and leave d alone (only m moves): " .. dump(e))
  -- a variant whose content changes (e.g. a fuller name arrives later) moves d
  local BEAR_RENAMED = "|cff1eff00|Hitem:6560::::::::44:1489:::1:12741::::::|h[Soldier's Shield of the Grizzly]|h|r"
  h.s.now = (DAY0 + 4) * 86400
  h.F.Meet(BEAR_RENAMED); h.run()
  assert(e.v["0;12741"] == "Soldier's Shield of the Grizzly" .. LF and e.d == DAY0 + 4 and e.m == DAY0 + 4,
         "changed variant content moves d: " .. dump(e))
  assert(not dump(h.db()):find("929") and not dump(h.db()):find("1489"), "nothing of a copy's enchant or the looter's spec is stored")
  -- the older suffix field, and a variant whose link has no name: the client is asked
  local o = fresh(); shield(o)
  o.s.info[6560] = o.s.info[6560]
  o.F.Meet("item:6560::::::1203:55:20"); o.run()
  assert(count(o.items()) == 1 and o.items()[6560].v["1203;"] == "Soldier's Shield" .. LF, dump(o.items()[6560].v))
  -- at most 24 variants an item; meeting a 25th on a later day does not move d
  local m = fresh(); shield(m)
  for b = 1, 24 do m.F.Meet("|cff1eff00|Hitem:6560::::::::19:1489:::1:" .. (13000 + b) .. "::::::|h[Soldier's Shield " .. b .. "]|h|r") end
  m.run()
  m.s.now = (DAY0 + 5) * 86400
  for b = 25, 30 do m.F.Meet("|cff1eff00|Hitem:6560::::::::19:1489:::1:" .. (13000 + b) .. "::::::|h[Soldier's Shield " .. b .. "]|h|r") end
  m.run()
  assert(count(m.items()) == 1 and count(m.items()[6560].v) == 24 and m.items()[6560].d == DAY0 and m.items()[6560].m == DAY0 + 5,
         "24 variants, 25th does not move d: " .. dump(m.items()[6560]))
  -- an item the client never loads: its suffix is not kept alone
  local lone = fresh(); lone.F.Meet(SHIELD); lone.run()
  assert(count(lone.items()) == 0 and not lone.db().lastError, "no variant without its item")
  print("OK   random suffix: one item with variants (name from the met link, stats only when they differ), never an entry of its own; 24 at most")
end

---------------------------------------------------------------------------
-- 6) the cap: the table's size in the saved file, the least recently met go first; Disk is the written size
---------------------------------------------------------------------------
do
  local h = fresh(); h.F.ITEMS.BYTES = 6000
  for id = 1, 60 do
    known(h, id, { name = "Item \"" .. id .. "\" \\ quoted", tip = { { leftText = "Item \"" .. id .. "\" \\ quoted" }, { leftText = "Binds when equipped", rightText = "Shield" }, { leftText = string.rep("y", 60) } } })
    h.s.stats["item:" .. id] = { ITEM_MOD_STAMINA_SHORT = id }
    h.s.now = (DAY0 + id) * 86400            -- item n was met on day n
    h.F.Meet(link(id)); h.run()
  end
  local items = h.items()
  assert(#written(items) == h.F.Disk(items), "Disk is the size written: " .. #written(items) .. " / " .. h.F.Disk(items))
  assert(h.F.Disk(items) <= 6000 and h.F.Disk(items) > 6000 * 0.8, "kept under the cap, and not emptied: " .. h.F.Disk(items))
  local kept, oldest = count(items), 61
  for id in pairs(items) do oldest = math.min(oldest, id) end
  assert(kept >= 10 and oldest == 61 - kept, "the " .. kept .. " most recently met are kept: oldest " .. oldest)
  assert(select(1, h.F.Status()):find(kept .. " held"), (h.F.Status()))
  -- the count cap: drops least recently MET (m), not oldest d (an item read on day 1 and met again on day 30 survives)
  local n = fresh(); n.F.ITEMS.MAX = 10
  for id = 1, 10 do known(n, id); n.s.now = (DAY0 + id) * 86400; n.F.Meet(link(id)); n.run() end
  n.s.now = (DAY0 + 30) * 86400; n.F.Meet(link(1, "Item 1 again"))   -- d stays DAY0+1, m becomes DAY0+30
  assert(n.items()[1].d == DAY0 + 1 and n.items()[1].m == DAY0 + 30, dump(n.items()[1]))
  for id = 11, 20 do known(n, id); n.s.now = (DAY0 + id) * 86400; n.F.Meet(link(id)); n.run() end
  assert(count(n.items()) <= 10 and n.items()[1] and n.items()[1].d == DAY0 + 1 and n.items()[20] and not n.items()[2],
         "pruning keeps recently met item 1 despite oldest d: " .. dump(n.items()))
  -- pre-m saved entries (no m) are pruned by their old d alongside new entries with m
  local legacyDb = { on = true, agreed = true, itemBuilds = { "1.60.1.71037" }, items = {
    [101] = { d = DAY0 + 1, b = 1, f = "1:0:7:5:10:0::", n = "Legacy Old" },
    [102] = { d = DAY0 + 5, b = 1, f = "1:0:7:5:10:0::", n = "Legacy Mid" },
    [103] = { d = DAY0 + 2, m = DAY0 + 9, b = 1, f = "1:0:7:5:10:0::", n = "Re-met Old" },
  } }
  local lp = fresh({ db = legacyDb }); lp.F.ITEMS.MAX = 3
  known(lp, 104); lp.s.now = (DAY0 + 8) * 86400; lp.F.Meet(link(104)); lp.run()
  assert(not lp.items()[101] and not lp.items()[102] and lp.items()[103] and lp.items()[104],
         "pruning drops legacy oldest (101, 102) before re-met 103 (m=DAY0+9): " .. dump(lp.items()))
  -- a variant counts too
  local v = fresh(); v.F.ITEMS.BYTES = 100000; shield(v); v.F.Meet(SHIELD); v.run()
  assert(#written(v.items()) == v.F.Disk(v.items()), "with a variant")
  -- the running total the cap is checked against is that same size (less the table's own braces): a cap of exactly
  -- what five items and a variant take keeps them all, one byte less does not
  local function five(cap)
    local x = fresh(); x.F.ITEMS.BYTES = cap; shield(x)
    for id = 1, 4 do known(x, id, { name = "Item \"" .. id .. "\"" }); x.s.now = (DAY0 + id) * 86400; x.F.Meet(link(id)); x.run() end
    x.s.now = (DAY0 + 5) * 86400; x.F.Meet(SHIELD); x.run()
    x.s.now = (DAY0 + 6) * 86400; x.F.Meet(link(1, "Item 1 again"))      -- met again: only m moves, d stays
    return x
  end
  local exact = five(1000000).F.Disk(five(1000000).items()) - 4
  assert(count(five(exact).items()) == 5 and count(five(exact - 1).items()) < 5, "the cap is counted in the bytes written: " .. exact)
  print("OK   cap: by bytes in the saved file (Disk = the size written), least recently met (m) first, to 90%; a count cap as well")
end

---------------------------------------------------------------------------
-- 7) kills per day: caps and pruning (what counts: tools/check_observations.js)
---------------------------------------------------------------------------
do
  local function guid(n, npc) return "Creature-0-4170-0-1234-" .. npc .. "-00001F" .. string.format("%04X", n) end
  local function kill(h, n, npc, level, patch)
    local u = { guid = guid(n, npc), dead = true, level = level }
    for k, x in pairs(patch or {}) do u[k] = x end
    h.s.units.target = u
    h.F.Died("target")
  end
  local h = fresh(); h.s.combat = true
  h.ns.ObsPrefix = function(d) d.prefix = d.prefix or "abcd12" end
  h.db().kills = { [DAY0 - 31] = { ["1:1"] = 5 }, [DAY0 - 30] = { ["1:1"] = 5 }, [DAY0 - 29] = { ["1:1"] = 2 }, [DAY0 + 1] = { ["1:1"] = 9 }, junk = 1 }
  kill(h, 1, 2958, 14); kill(h, 1, 2958, 14); kill(h, 2, 2958, 14); kill(h, 3, 2958, 15); kill(h, 4, 6, -1); kill(h, 5, 7, nil)
  assert(dump(h.db().kills) == "{" .. (DAY0 - 29) .. "={1:1=2}," .. DAY0 .. "={2958:14=2,2958:15=1,6:0=1,7:0=1}}",
         "30 days, a corpse once, level 0 when the client gives none: " .. dump(h.db().kills))
  assert(h.db().prefix == "abcd12", "the install id the export names the counts by")
  kill(h, 6, 8, 10, { tapped = true }); kill(h, 7, 8, 10, { player = true }); kill(h, 8, 8, 10, { controlled = true }); kill(h, 9, 8, 10, { dead = false })
  h.s.units.target = { guid = "GameObject-0-4170-0-1234-8-00001F0001", dead = true }; h.F.Died("target")
  h.s.units.target = { guid = "Pet-0-4170-0-1234-8-00001F0002", dead = true }; h.F.Died("target")
  h.s.combat = false; kill(h, 10, 8, 10)
  assert(h.db().kills[DAY0]["8:10"] == nil, "another player's tap, a player, a pet, an object, a live unit, not fighting: not counted")
  -- just after the fight ended (PLAYER_REGEN_ENABLED within 2 s) still counts: the last creature dies as combat drops
  h.event("PLAYER_REGEN_DISABLED"); h.event("PLAYER_REGEN_ENABLED"); h.s.clock = h.s.clock + 1; kill(h, 11, 8, 10)
  assert(h.db().kills[DAY0]["8:10"] == 1, "within 2 s of the fight's end")
  h.s.clock = h.s.clock + 5; kill(h, 12, 8, 10); assert(h.db().kills[DAY0]["8:10"] == 1, "later: not counted")
  local noTap = fresh({ without = { "UnitIsTapDenied" } }); noTap.s.combat = true; kill(noTap, 1, 2958, 14)
  assert(noTap.db().kills == nil, "a client that cannot say who tapped it: nothing")
  -- the cap: 800 numbers (5 here); the oldest days go first, today stays, and a full today takes no new creature
  local c = fresh(); c.s.combat = true; c.F.KILLS.MAX = 5
  c.db().kills = { [DAY0 - 2] = { ["1:1"] = 1, ["2:1"] = 1 }, [DAY0 - 1] = { ["1:1"] = 1, ["2:1"] = 1 } }
  kill(c, 1, 10, 1); assert(count(c.db().kills) == 3, "room for one more")
  kill(c, 2, 11, 1); assert(c.db().kills[DAY0 - 2] == nil and c.db().kills[DAY0 - 1] and c.db().kills[DAY0]["11:1"] == 1, "the oldest day goes: " .. dump(c.db().kills))
  for n = 3, 12 do kill(c, n, 20 + n, 1) end
  assert(count(c.db().kills) == 1 and count(c.db().kills[DAY0]) == 5, "today stays, capped: " .. dump(c.db().kills))
  kill(c, 13, 10, 1); assert(c.db().kills[DAY0]["10:1"] == 2, "a creature already counted today still counts")
  local off = fresh({ db = { on = false, agreed = true } }); off.s.combat = true; kill(off, 1, 2958, 14)
  assert(off.db().kills == nil, "off: nothing")
  print("OK   kills: one number per day, npc and level; 30 days; capped, oldest days first; no corpse id stored")
end

---------------------------------------------------------------------------
-- 8) time used per frame: the in-game counter (/kinv perf), checked against a scripted clock
---------------------------------------------------------------------------
do
  local h = fresh()
  for id = 1, 4 do known(h, id); h.F.Meet(link(id)) end
  h.s.cost = 0.5; h.step()                      -- frame 1: 0.5 ms
  h.s.cost = 3; h.step()                        -- frame 2: 3 ms
  h.s.cost = 1
  local t = table.remove(h.s.timers, 1); t.fn() -- frame 2 again (the clock did not move): 1 ms more
  h.s.cost = 0.5; h.step()                      -- frame 3: 0.5 ms
  local p = h.F.Perf()
  assert(p.frames == 3 and p.worst == 4 and p.avg == 1.67 and p.reads == 4 and p.slow == 0, "worst and average per frame used: " .. dump(p))
  assert(h.F.Command("perf") == true and #h.s.printed == 2 and h.s.printed[1]:find("4 held") and h.s.printed[2]:find("worst 4.00 ms, average 1.67 ms, over 3 frames"),
         dump(h.s.printed))
  assert(h.F.Command("  PERF ") == true and h.F.Command("track") == false and h.F.Command(nil) == false and h.F.Command("perf x") == false)
  h.event("PLAYER_LOGOUT")
  local saved = h.db().perf
  assert(count(saved) == 6 and saved.avg == 1.67 and saved.day == DAY0 and saved.frames == 3 and saved.reads == 4 and saved.slow == 0 and saved.worst == 4,
         "the session's numbers are saved on the way out: " .. dump(saved))
  local idle = fresh(); idle.event("PLAYER_LOGOUT"); assert(idle.db().perf == nil, "a session that did nothing saves nothing")
  print("OK   /kinv perf: worst and average ms per frame used (debugprofilestop), reads and slow reads; saved at logout")
end

---------------------------------------------------------------------------
-- 9) measured here (fengari, far slower than the game's Lua): what the work costs outside the client's own API calls
---------------------------------------------------------------------------
do
  local h = fresh({ realClock = true })
  local now = function() return os.clock() * 1000 end
  local links = {}
  for id = 1, 900 do known(h, id); links[id] = link(id, "Item " .. id, ":55:::::::60:1489::::") end
  local t0 = now(); for id = 1, 300 do h.F.Meet(links[id]) end; local first = now() - t0
  t0 = now(); for _ = 1, 10 do for id = 1, 300 do h.F.Meet(links[id]) end end; local metAgain = (now() - t0) / 10
  local steps, worst, total = 0, 0, 0
  while #h.s.timers > 0 do t0 = now(); h.step(); local ms = now() - t0; steps, total = steps + 1, total + ms; worst = math.max(worst, ms) end
  assert(steps == 300 and #h.s.reads == 300, "300 reads in 300 steps")
  for id = 301, 900 do h.F.Meet(links[id]) end; h.run(1000)
  h.s.units.nameplate1 = { guid = "Creature-0-4170-0-1234-6-00001F0001", dead = false }
  t0 = now(); for _ = 1, 1000 do h.F.Died("nameplate1") end; local alive = (now() - t0) / 1000
  -- a full table (900 items) pruned once
  h.F.ITEMS.MAX = 899
  known(h, 2000); h.F.Meet(link(2000)); t0 = now(); h.run(); local prune = now() - t0
  assert(count(h.items()) <= 810, "pruned to 90%: " .. count(h.items()))
  -- the fast path must stay a lookup: 300 met links cost well under a frame even here
  assert(metAgain < 25, "300 links met before took " .. metAgain .. " ms")
  MEASURED = string.format("a 300-slot bag scan: first sight %.2f ms in all, seen before %.3f ms in all; one read step: average %.3f ms, worst %.3f ms; "
                           .. "UNIT_HEALTH for a live unit %.4f ms; one prune of a full 900-item table %.2f ms", first, metAgain, total / steps, worst, alive, prune)
  print("OK   frame time measured in this harness (not the game): " .. MEASURED)
end

---------------------------------------------------------------------------
-- 10) Saved.lua: unlearned recipes once per account file; the migration is exact and can be undone
---------------------------------------------------------------------------
do
  local S = fresh().S
  local function rec(id, extra)
    local r = { recipeID = id, name = "Recipe " .. id, outputItemID = id + 1000, makesMin = 1, makesMax = 1,
                reagents = { { itemID = 2589, quantity = 2, name = "Linen Cloth", required = true }, { itemID = 2320, quantity = 1, name = "Coarse Thread" } } }
    for k, v in pairs(extra or {}) do r[k] = v end
    return r
  end
  local function make()
    return { chars = {
      ["A-R"] = { name = "A", recipes = { Tailoring = { professionID = 197, skill = 100, recipes = { rec(1, { link = "x", difficulty = 2 }) },
                                                         unlearned = { rec(10), rec(11), rec(12) } },
                                          Cooking = { unlearned = {} } } },
      ["B-R"] = { name = "B", recipes = { Tailoring = { unlearned = { rec(11), rec(10), rec(12, { name = "Another name" }), rec(13) } } } },
      ["C-R"] = { name = "C", recipes = { Tailoring = { unlearned = { rec(10), rec(10, { makesMax = 2 }), { name = "no id" }, rec(12) } },
                                          Mining = { unlearned = { [1] = rec(20), [3] = rec(21) } },             -- a hole: not a list the addon wrote
                                          Herbalism = { unlearned = { rec(30), "junk" } },                       -- nor this
                                          Alchemy = { recipes = { rec(2) } } } },                                -- no unlearned list at all
      ["D-R"] = "junk",
    }, other = { kept = true } }
  end
  local db, before = make(), make()
  assert(equal(db, before), "(the two copies start equal)")
  assert(S.MigrateRecipes(db) == 4, "four lists moved")
  for key, c in pairs(before.chars) do
    for name, book in pairs(type(c) == "table" and c.recipes or {}) do
      local now = db.chars[key].recipes[name]
      if name == "Mining" or name == "Herbalism" or name == "Alchemy" then
        assert(S.Same(now, book) and now.unlearnedIds == nil, name .. " is left as it was")
      else
        assert(now.unlearned == nil and type(now.unlearnedIds) == "table", key .. " " .. name .. " moved")
        local list = S.Unlearned(db, now)
        assert(#list == #book.unlearned, key .. " " .. name .. ": " .. #list .. " of " .. #book.unlearned)
        for i = 1, #list do assert(S.Same(list[i], book.unlearned[i]), key .. " " .. name .. " #" .. i .. ": " .. dump(list[i])) end
      end
    end
  end
  assert(count(db.recipeBook) == 4 and db.recipeBook[10] and db.recipeBook[13], "each recipe once: " .. count(db.recipeBook))
  local a, b, c = db.chars["A-R"].recipes.Tailoring.unlearnedIds, db.chars["B-R"].recipes.Tailoring.unlearnedIds, db.chars["C-R"].recipes.Tailoring.unlearnedIds
  assert(a[1] == 10 and a[2] == 11 and type(a[3]) == "table" and a[3].name == "Recipe 12", "A's record of 12 differs from the shared one: spelled out")
  assert(b[1] == 11 and b[2] == 10 and type(b[3]) == "table" and b[3].name == "Another name" and b[4] == 13,
         "B's record of 12 was the shared one until C's differed from it: spelled out in B's list")
  assert(c[1] == 10 and type(c[2]) == "table" and c[2].makesMax == 2 and type(c[3]) == "table" and c[3].name == "no id" and c[4] == 12
         and db.recipeBook[12].name == "Recipe 12", "the same id twice in one list and a record without an id are spelled out; the last reading is the shared one")
  assert(#db.chars["A-R"].recipes.Cooking.unlearnedIds == 0, "an empty list stays a list")
  assert(S.MigrateRecipes(db) == 0, "nothing to move twice")
  -- undone: every list written out again gives back the file exactly
  local undone = deep(db)
  for _, ch in pairs(undone.chars) do
    for _, book in pairs(type(ch) == "table" and ch.recipes or {}) do
      if book.unlearnedIds then book.unlearned = deep(S.Unlearned(undone, book)); book.unlearnedIds = nil end
    end
  end
  undone.recipeBook = nil
  assert(equal(undone, before), "the migration loses nothing: undone it is the original")
  -- a later scan of one character: its new list is shared; the others still say what they said
  local wasA = deep(S.Unlearned(db, db.chars["A-R"].recipes.Tailoring))
  local wasC = deep(S.Unlearned(db, db.chars["C-R"].recipes.Tailoring))
  local bBook = db.chars["B-R"].recipes.Tailoring
  bBook.unlearnedIds = nil
  bBook.unlearnedIds = S.Share(db, { rec(10, { makesMin = 5 }), rec(14) })
  S.Sweep(db)
  assert(S.Same(S.Unlearned(db, db.chars["A-R"].recipes.Tailoring), wasA) and S.Same(S.Unlearned(db, db.chars["C-R"].recipes.Tailoring), wasC),
         "another character's rescan changes no other list")
  assert(db.recipeBook[10].makesMin == 5 and db.recipeBook[14] and db.recipeBook[13] == nil and db.recipeBook[11], "shared: the newer 10 and 14; 13 is no longer named and is swept")
  assert(S.Same(S.Unlearned(db, bBook), { rec(10, { makesMin = 5 }), rec(14) }))
  -- readers: the old shape, a missing shared record, junk
  assert(#S.Unlearned({}, { unlearned = { rec(1) } }) == 1 and #S.Unlearned(nil, { unlearnedIds = { 5, rec(6) } }) == 1 and #S.Unlearned({}, nil) == 0 and #S.Unlearned({}, {}) == 0)
  local gone = { chars = { ["A-R"] = { recipes = { T = { unlearnedIds = {} } } } }, recipeBook = { [1] = rec(1) } }
  S.Sweep(gone); assert(gone.recipeBook == nil, "nothing names a shared record: the table goes")
  assert(S.MigrateRecipes(nil) == 0 and S.MigrateRecipes({}) == 0 and S.MigrateRecipes({ chars = { x = 1 } }) == 0)
  print("OK   recipes not learned yet: saved once per account file, each list still exact (differing records spelled out), undone = the original")
end

---------------------------------------------------------------------------
-- 11) Saved.lua: statistics per day
---------------------------------------------------------------------------
do
  local S = fresh().S
  local c = {}
  local first = { { id = 60, value = 7 }, { id = 61, value = "1g 2s" } }
  S.StatDays(c, first, 20400)
  assert(c.statDays == nil, "a first reading has nothing to differ from")
  c.statistics = first
  local second = { { id = 60, value = 8 }, { id = 61, value = "1g 2s" }, { id = 62, value = 1 }, { id = "x", value = 1 }, { id = 63 }, "junk" }
  S.StatDays(c, second, 20400)
  assert(dump(c.statDays) == "{20400={60=8,62=1}}", "only what changed: " .. dump(c.statDays))
  c.statistics = second
  S.StatDays(c, { { id = 60, value = 9 }, { id = 61, value = "1g 3s" }, { id = 62, value = 1 } }, 20400)
  assert(dump(c.statDays) == "{20400={60=9,61=1g 3s,62=1}}", "the day's last value: " .. dump(c.statDays))
  c.statistics = { { id = 60, value = 9 }, { id = 61, value = "1g 3s" }, { id = 62, value = 1 } }
  S.StatDays(c, { { id = 60, value = 12 }, { id = 61, value = "1g 3s" }, { id = 62, value = 1 } }, 20401)
  assert(dump(c.statDays) == "{20400={60=9,61=1g 3s,62=1},20401={60=12}}", dump(c.statDays))
  c.statistics = { { id = 60, value = 12 }, { id = 61, value = "1g 3s" }, { id = 62, value = 1 } }
  S.StatDays(c, c.statistics, 20402)
  assert(c.statDays[20402] == nil, "a day on which nothing changed is not written")
  S.StatDays(c, { { id = 60, value = 9 }, { id = 61, value = "1g 3s" }, { id = 62, value = 1 } }, 20430)
  assert(dump(c.statDays) == "{20401={60=12},20430={60=9}}", "30 days: " .. dump(c.statDays))
  c.statDays.junk, c.statDays[20999] = {}, {}
  S.PruneStatDays(c, 20431)
  assert(dump(c.statDays) == "{20430={60=9}}", "old, future and junk days go: " .. dump(c.statDays))
  S.PruneStatDays(c, 20500); assert(c.statDays == nil, "nothing left: no table")
  S.STAT_DAY_MAX = 2
  local d = { statistics = { { id = 1, value = 0 } } }
  S.StatDays(d, { { id = 1, value = 1 }, { id = 2, value = 1 }, { id = 3, value = 1 } }, 20400)
  assert(count(d.statDays[20400]) == 2, "at most STAT_DAY_MAX values a day")
  S.StatDays(nil, {}, 1); S.StatDays({}, nil, 1); S.StatDays({}, {}, "x"); S.PruneStatDays(nil, 1)
  print("OK   statistics per day: the values that changed, the day's last value, 30 days, capped")
end

---------------------------------------------------------------------------
-- 12) Prices.lua: every vendor of an item (the entry stays the cheapest)
---------------------------------------------------------------------------
do
  local frames, timers, s = {}, {}, { now = 1767225600, npc = { name = "Vendor A", guid = "Creature-0-4170-0-1234-1250-00001F0001" }, wares = {} }
  local G = setmetatable({}, { __index = _G })
  G.CreateFrame = function()
    local f = { scripts = {} }
    function f:SetScript(n, fn) self.scripts[n] = fn end
    function f:RegisterEvent() return true end
    function f:Show() end
    function f:Hide() end
    frames[#frames + 1] = f
    return f
  end
  G.C_Timer = { After = function(_, fn) timers[#timers + 1] = fn end }
  G.GetTime = function() return 0 end
  G.time = function() return s.now end
  G.print = function() end
  G.UnitName = function() return s.npc.name end
  G.UnitGUID = function() return s.npc.guid end
  G.GetMerchantNumItems = function() return #s.wares end
  G.GetMerchantItemID = function(i) return s.wares[i].id end
  G.GetMerchantItemInfo = function(i) local w = s.wares[i]; return "name", 1, w.price, w.stack or 1, w.avail or -1, true, true, false end
  G.C_Item = { GetItemInfo = function() return nil end }
  G.KutzInventoryDB = { chars = {} }
  local ns = {}
  assert(load(SOURCE.Prices, "@Prices.lua", "t", G))("KutzInventory", ns)
  local ev = frames[#frames]
  local function visit(name, npcId, price, avail, stack)
    s.now = s.now + 100
    s.npc = { name = name, guid = npcId and ("Creature-0-4170-0-1234-" .. npcId .. "-00001F0001") or nil }
    s.wares = { { id = 2320, price = price, avail = avail, stack = stack } }
    ev.scripts.OnEvent(ev, "MERCHANT_SHOW")
    return G.KutzInventoryDB.prices.vendor[2320]
  end
  local function names(e) local out = {}; for name, x in pairs(e.also or {}) do out[#out + 1] = name .. "=" .. string.format("%g", x.price) end; table.sort(out); return table.concat(out, ",") end
  local e = visit("Vendor A", 1250, 10)
  assert(e.vendor == "Vendor A" and e.price == 10 and e.npc == 1250 and e.limited == nil and e.t == s.now and e.also == nil, dump(e))
  e = visit("Vendor B", 1251, 12, 3)
  assert(e.vendor == "Vendor A" and names(e) == "Vendor B=12" and e.also["Vendor B"].limited == true and e.also["Vendor B"].npc == 1251 and e.also["Vendor B"].t == s.now,
         "a dearer vendor is listed beside the cheapest: " .. dump(e))
  e = visit("Vendor C", 1252, 40, -1, 5)
  assert(e.vendor == "Vendor C" and e.price == 8 and names(e) == "Vendor A=10,Vendor B=12", "a cheaper vendor becomes the entry; the others stay: " .. dump(e))
  local t = s.now
  e = visit("Vendor A", 1250, 10)
  assert(e.vendor == "Vendor C" and e.also["Vendor A"].t == s.now and e.t == t, "seen again: its time moves")
  e = visit("Vendor C", 1252, 15)
  assert(e.vendor == "Vendor A" and e.price == 10 and names(e) == "Vendor B=12,Vendor C=15", "the cheapest raised its price: the entry is the cheapest again: " .. dump(e))
  e = visit("Vendor B", nil, 12)
  assert(e.also["Vendor B"].npc == nil and e.also["Vendor B"].limited == nil, "no GUID: no id")
  assert(not dump(G.KutzInventoryDB):find("Creature%-"), "a vendor's GUID is never stored")
  for n = 1, 12 do e = visit("Vendor " .. n, 2000 + n, 100 + n) end
  assert(count(e.also) == 8 and e.vendor == "Vendor A" and e.also["Vendor 12"] and not e.also["Vendor 1"], "8 others at most, the longest unseen goes: " .. names(e))
  -- an old saved entry (before 1.21.0) gains the list as vendors are seen
  G.KutzInventoryDB.prices.vendor[2320] = { price = 10, vendor = "Old Vendor", t = 5 }
  e = visit("Vendor B", 1251, 12)
  assert(e.vendor == "Old Vendor" and names(e) == "Vendor B=12")
  print("OK   vendors: the entry is the cheapest vendor (with its id, limited stock and time); every other vendor seen is listed beside it, 8 at most")
end

---------------------------------------------------------------------------
-- The proof tools/check_facts.js runs on whole saved files. PROVE(text) loads a saved file (it is Lua), migrates it
-- with the addon's own Saved.MigrateRecipes, checks in here that every list still says what it said and that undoing
-- the migration gives back the file's tables exactly, and returns the file written before and after in this client's
-- format (no indentation, one value per line, CR LF), for check_facts.js to convert and compare.
-- Its messages never quote the file: a real saved file is private.
---------------------------------------------------------------------------
local function quoted(s) return '"' .. s:gsub('[\\"]', "\\%0"):gsub("\n", "\\n"):gsub("\r", "\\r") .. '"' end
local function number(v)
  if math.type(v) == "integer" then return string.format("%d", v) end
  local s = string.format("%.14g", v)
  if tonumber(s) ~= v then s = string.format("%.17g", v) end
  return s
end
local function write(prefix, v, out)
  if type(v) ~= "table" then
    out[#out + 1] = prefix .. (type(v) == "string" and quoted(v) or type(v) == "number" and number(v) or tostring(v)) .. ","
    return
  end
  out[#out + 1] = prefix .. "{"
  local n = 0
  while v[n + 1] ~= nil do n = n + 1; write("", v[n], out) end
  for k, x in pairs(v) do
    if not (math.type(k) == "integer" and k >= 1 and k <= n) then
      write("[" .. (type(k) == "string" and quoted(k) or number(k)) .. "] = ", x, out)
    end
  end
  out[#out + 1] = "},"
end

function PROVE(text)
  local order, vals = {}, {}
  local env = setmetatable({}, { __newindex = function(_, k, v) if vals[k] == nil then order[#order + 1] = k end; vals[k] = v end })
  local chunk = load(text, "=saved file", "t", env)
  assert(chunk, "the saved file does not load as Lua")
  chunk()
  local function file()
    local out = {}
    for _, name in ipairs(order) do
      out[#out + 1] = ""
      write(name .. " = ", vals[name], out)
      out[#out] = "}"
    end
    out[#out + 1] = ""
    return table.concat(out, "\r\n")
  end
  local db = vals.KutzInventoryDB
  assert(type(db) == "table", "no KutzInventoryDB in the saved file")
  local before, orig = file(), deep(db)
  local S = fresh().S
  local lists, records = 0, 0
  local function books(d, fn)
    for key, c in pairs(type(d.chars) == "table" and d.chars or {}) do
      for name, book in pairs(type(c) == "table" and type(c.recipes) == "table" and c.recipes or {}) do
        if type(book) == "table" then fn(key, name, book) end
      end
    end
  end
  books(orig, function(_, _, book) if type(book.unlearned) == "table" then lists = lists + 1; records = records + #book.unlearned end end)
  local moved = S.MigrateRecipes(db)
  local left = 0
  books(orig, function(key, name, book)
    local now = db.chars[key].recipes[name]
    if type(book.unlearned) ~= "table" then
      assert(equal(now, book), "a book without a list changed")
    elseif now.unlearnedIds == nil then
      left = left + 1
      assert(equal(now, book), "a list that was not moved changed")
    else
      assert(now.unlearned == nil, "a moved list is still there")
      local list = S.Unlearned(db, now)
      assert(#list == #book.unlearned, "a list changed its length")
      for i = 1, #list do assert(equal(list[i], book.unlearned[i]), "a record changed") end
      local rest, was = deep(now), deep(book)
      rest.unlearnedIds, was.unlearned = nil, nil
      assert(equal(rest, was), "something beside the list changed in a book")
    end
  end)
  assert(moved + left == lists, "every list is either moved or left as it was")
  local undone = deep(db)
  books(undone, function(_, _, book)
    if book.unlearnedIds then book.unlearned = deep(S.Unlearned(undone, book)); book.unlearnedIds = nil end
  end)
  undone.recipeBook = nil
  assert(equal(undone, orig), "undoing the migration does not give back the original")
  local after = file()
  assert(S.MigrateRecipes(db) == 0 and file() == after, "migrating twice changes the file")
  return before, after, lists, moved, records, count(db.recipeBook or {})
end
