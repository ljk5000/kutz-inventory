// Offline check for KutzInventory/Observations.lua (default-on drop / quest / vendor / trainer recording) in a
// small fake game: on from a new install's first load (an opt-in era install keeps its choice), nothing recorded while off,
// /kinv track (status, off, on again), the one-time note, each event type (loot per source incl. coin-only opens, skinning / herbs / fishing / containers,
// quests with rewards, vendors with costs, rx and the item filter, trainers' whole lists), item links cut to colour, id and name, the character's own name and surname
// (never anyone else's), that gold and other players are never recorded, the caps and pruning,
// and that a client without the APIs records nothing and raises no error.
"use strict";
const fs = require("fs");
const path = require("path");
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require("fengari");

const addonDir = path.join(__dirname, "..", "KutzInventory");
const source = fs.readFileSync(path.join(addonDir, "Observations.lua"), "utf8");

const code = `
local function dump(v)
  if type(v) ~= "table" then return tostring(v) end
  local keys = {}
  for k in pairs(v) do keys[#keys + 1] = k end
  table.sort(keys, function(a, b) return tostring(a) < tostring(b) end)
  local out = {}
  for _, k in ipairs(keys) do out[#out + 1] = tostring(k) .. "=" .. dump(v[k]) end
  return "{" .. table.concat(out, ",") .. "}"
end

local MOB = "Creature-0-4170-409-1234-11502-000012ABCD"
local MOB2 = "Creature-0-4170-0-1234-2958-000012ABCE"
local NODE = "GameObject-0-4170-0-1234-1617-0000AAAA01"
local PLAYER = "Player-4170-00ABCDEF"
local BAG = "Item-4170-0-400000033D4DBA92"

local function fresh(opts)
  opts = opts or {}
  local frames, timers, printed, registered, hooks, popups = {}, {}, {}, {}, {}, {}
  local s = { now = 1767225600, clock = 100, slots = {}, units = {}, fishing = false, itype = "none", iid = 0, difficulty = 0,
              uiMap = 1429, x = 0.412345, y = 0.65432, quest = nil, rewards = {}, choices = {}, merchant = {}, rolls = {},
              mfilter = 1, filterSets = 0,
              trainer = { type = 0, rows = {}, reads = 0, sets = 0, filters = { available = true, unavailable = true, used = true } } }
  local G = setmetatable({}, { __index = _G })
  G._G = G
  G.CreateFrame = function()
    local f = { scripts = {} }
    function f:SetScript(n, fn) self.scripts[n] = fn end
    function f:RegisterEvent(e) registered[e] = true; return true end
    function f:UnregisterEvent(e) registered[e] = nil end
    frames[#frames + 1] = f
    return f
  end
  G.C_Timer = { After = function(_, fn) timers[#timers + 1] = fn end }
  G.time = function() return s.now end
  G.date = function(fmt, t) return "D" .. tostring(t) end
  G.print = function(m) printed[#printed + 1] = m end
  if not opts.noApi then
    G.GetTime = function() return s.clock end
    G.GetBuildInfo = function() return "1.60.1", "70888", "Nov 1 2026", 16001 end
    G.C_AddOns = { GetAddOnMetadata = function(a, k) if a == "KutzInventory" and k == "Version" then return "1.8.0" end end }
    G.GetInstanceInfo = function() return "Somewhere", s.itype, s.difficulty, "", 0, 0, false, s.iid end
    G.C_Map = { GetBestMapForUnit = function() return s.uiMap end,
                GetPlayerMapPosition = function() return { GetXY = function() return s.x, s.y end } end }
    G.UnitLevel = function(u) if u == "player" then return 60 end; local x = s.units[u]; return x and x.level end
    G.UnitClass = function() return "Rogue", "ROGUE", 4 end
    G.UnitFactionGroup = function() return "Alliance", "Alliance" end
    G.UnitName = function(u) if u == "player" then return "Tester", "Example Realm" end; return "Someone Else" end
    G.GetUnitName = function(u) if u == "player" then return opts.noSurname and "Tester" or "Tester Testwood" end; return "Someone Else" end
    G.UnitGUID = function(u) if u == "player" then return PLAYER end; local x = s.units[u]; return x and x.guid end
    G.UnitIsDead = function(u) local x = s.units[u]; return x and x.dead or false end
    G.UnitClassification = function(u) local x = s.units[u]; return x and x.class or "normal" end
    G.GetNumLootItems = function() return #s.slots end
    G.GetLootSlotLink = function(i) return s.slots[i].link end
    G.GetLootSlotInfo = function(i) local x = s.slots[i]; return 1, "name", x.n, nil, 1 end
    if not opts.noSourceInfo then
      G.GetLootSourceInfo = function(i) return table.unpack(s.slots[i].from or {}) end
    end
    G.IsFishingLoot = function() return s.fishing end
    G.GetLootRollItemLink = function(id) local x = s.rolls[id]; return x and x.link end
    G.GetLootRollItemInfo = function(id) local x = s.rolls[id]; return 1, "name", x and x.n, 2 end
    G.GetLootThreshold = function() return 2 end
    G.IsInRaid = function() return false end
    G.GetSpellInfo = function(id) return ({ [2366] = "Herb Gathering", [2575] = "Mining", [8613] = "Skinning", [999] = "Mining" })[id] end
    G.GetQuestID = function() return s.quest end
    G.GetNumQuestRewards = function() return #s.rewards end
    G.GetNumQuestChoices = function() return #s.choices end
    G.GetQuestItemLink = function(kind, i) local x = (kind == "reward" and s.rewards or s.choices)[i]; return x and x.link end
    G.GetQuestItemInfo = function(kind, i) local x = (kind == "reward" and s.rewards or s.choices)[i]; return "n", 1, x and x.n end
    G.GetQuestReward = function() end
    G.GetTitleText = function() return s.text and s.text.title end
    G.GetQuestText = function() return s.text and s.text.details end
    G.GetObjectiveText = function() return s.text and s.text.objectives end
    G.GetProgressText = function() return s.text and s.text.progress end
    G.GetRewardText = function() return s.text and s.text.completion end
    G.hooksecurefunc = function(a, b, c)
      if type(a) == "string" then hooks[a] = b else hooks[b] = c end
    end
    -- the merchant window's item filter: 1 = all, 2 = this class (hides the items marked other)
    local function wares() local out = {}; for _, x in ipairs(s.merchant) do if s.mfilter == 1 or not x.other then out[#out + 1] = x end end; return out end
    G.GetMerchantNumItems = function() return #wares() end
    G.GetMerchantItemID = function(i) return wares()[i].id end
    G.GetMerchantItemLink = function(i) local x = wares()[i]; return x.link end
    G.GetMerchantItemInfo = function(i) local x = wares()[i]; return "n", 1, x.price, x.n, x.avail, true, true, x.cost ~= nil end
    G.GetMerchantItemCostInfo = function(i) return #(wares()[i].cost or {}) end
    G.GetMerchantItemCostItem = function(i, j) local c = wares()[i].cost[j]; return 1, c[2], c[1], "name" end
    G.LE_LOOT_FILTER_ALL = 1
    G.GetMerchantFilter = function() return s.mfilter end
    if not opts.noSetMerchantFilter then
      G.SetMerchantFilter = function(f) s.filterSets = s.filterSets + 1; if not s.stuckFilter then s.mfilter = f end end
    end
    G.UnitReaction = function(u, other) if u == "npc" and other == "player" then return s.reaction end end
    -- trainers: rows { name, st = available|unavailable|used|header, rank, lv, skill, skillReq, needs, cost, s, tipType };
    -- the window's type filters hide rows from addons, and switching one fires TRAINER_UPDATE at once
    local function services()
      local out = {}
      for _, r in ipairs(s.trainer.rows) do if r.st == "header" or s.trainer.filters[r.st] then out[#out + 1] = r end end
      return out
    end
    G.GetNumTrainerServices = function() s.trainer.reads = s.trainer.reads + 1; return #services() end
    G.GetTrainerServiceInfo = function(i) local r = services()[i]; if r then return r.name, r.st, "tex", r.lv or 0, r.rank, "cat" end end
    G.GetTrainerServiceSkillReq = function(i) local r = services()[i]; if r and r.skill then return r.skill, r.skillReq, true end end
    G.GetTrainerServiceNumAbilityReq = function(i) local r = services()[i]; return r and r.needs and #r.needs or 0 end
    G.GetTrainerServiceAbilityReq = function(i, j) return services()[i].needs[j], true end
    G.GetTrainerServiceCost = function(i) local r = services()[i]; return r and r.cost, false end
    G.GetTrainerServiceTypeFilter = function(f) return s.trainer.filters[f] end
    G.SetTrainerServiceTypeFilter = function(f, on)
      s.trainer.filters[f], s.trainer.sets = on and true or false, s.trainer.sets + 1
      frames[1].scripts.OnEvent(frames[1], "TRAINER_UPDATE")
    end
    G.C_Trainer = { GetTrainerType = function() return s.trainer.type end }
    G.Enum = { TrainerType = { General = 0, Tradeskills = 2, Pet = 3 }, TooltipDataType = { Item = 0, Spell = 1 } }
    if not opts.noTooltip then
      G.C_TooltipInfo = { GetTrainerService = function(i)
        local r = services()[i]
        if r and r.s then return { type = r.tipType or 1, id = r.s, lines = {} } end
      end }
    end
    G.StaticPopupDialogs = {}
    G.StaticPopup_Show = function(name) popups[#popups + 1] = name end
  end
  for k, v in pairs(opts.globals or {}) do G[k] = v end
  G.KutzInventoryObsDB = opts.db
  local chunk = assert(load([=====[${source}]=====], "@Observations.lua", "t", G))
  local ns = {}
  chunk("KutzInventory", ns)
  local h = { ns = ns, G = G, s = s, printed = printed, registered = registered, hooks = hooks, popups = popups }
  function h.event(name, ...) frames[1].scripts.OnEvent(frames[1], name, ...) end
  function h.drain() local b = timers; timers = {}; for _, fn in ipairs(b) do fn() end end
  function h.cmd(m) return ns.ObsCommand(m) end
  function h.db() return G.KutzInventoryObsDB end
  function h.events() return (G.KutzInventoryObsDB or {}).events or {} end
  function h.last() return printed[#printed] or "" end
  function h.on() h.cmd("track drops yes") end
  function h.loot(slots) s.slots = slots; h.event("LOOT_OPENED"); h.event("LOOT_CLOSED") end
  h.event("ADDON_LOADED", "KutzInventory")
  return h
end

local COIN = { n = 0, from = { MOB, 0 } }                         -- a money slot: no item link
local function item(id, n, from) return { link = "|cffffffff|Hitem:" .. id .. "::::::::60:::::|h[X]|h|r", n = n, from = from } end

-- 1) on by default for a new install only: a first load makes the table and records without any command; a table
--    from the opt-in days keeps its choice (off stays off, on stays on), only a missing setting becomes on; an off
--    survives reloads
do
  local h = fresh()
  local d = h.db()
  assert(d and d.on and d.agreed and #d.events == 0 and not d.noted, "a first load turns it on")
  assert(h.registered.LOOT_OPENED and h.registered.MERCHANT_SHOW and h.registered.QUEST_TURNED_IN, "events registered at load")
  h.s.units.target = { guid = MOB, dead = true, level = 60 }
  h.loot({ item(17076, 1, { MOB, 1 }), COIN })
  assert(#h.events() == 1 and h.events()[1].items[1].id == 17076, "recorded without /kinv track")
  for _, old in ipairs({ { v = 1, on = false, noted = true }, { v = 1, on = false, agreed = true, noted = true, n = 3, prefix = "abc123" } }) do
    local g = fresh({ db = old })
    assert(g.db().on == false and g.db().noted and not g.registered.LOOT_OPENED, "an opt-in era table that is off stays off")
    g.s.units.target = { guid = MOB, dead = true, level = 60 }
    g.loot({ item(17076, 1, { MOB2, 1 }) })
    assert(#g.events() == 0, "nothing recorded from an install that kept it off")
  end
  local kept = fresh({ db = { v = 1, on = true, agreed = true, noted = true } })
  assert(kept.db().on and kept.registered.LOOT_OPENED, "an opt-in era table that is on stays on")
  local unset = fresh({ db = { v = 1, noted = true } })
  assert(unset.db().on and unset.db().agreed and unset.registered.LOOT_OPENED, "a table with no setting starts on")
  local g = fresh()
  g.cmd("track drops off")
  local saved = g.db()
  local r = fresh({ db = saved })
  assert(not r.db().on and not r.registered.LOOT_OPENED, "an off stays off across a reload")
  r.loot({ item(17076, 1, { MOB2, 1 }) })
  assert(#r.events() == 0, "nothing recorded while off")
  print("OK   on by default for a new install: a first load records without a command, an opt-in era off stays off, an off stays off")
end

-- 2) the one-time note
do
  local h = fresh()
  h.ns.ObsNote()
  assert(#h.printed == 2 and h.printed[1]:find("enabled by default") and h.printed[1]:find("/kinv track")
         and h.printed[2]:find("never records gold") and h.printed[2]:find("/kinv track drops off"), "two lines: " .. table.concat(h.printed, " | "))
  h.ns.ObsNote(); h.ns.ObsNote()
  assert(#h.printed == 2 and h.db().noted == true and h.db().on, "only once, and it changes nothing")
  local off = fresh({ db = { v = 1, on = false } })
  off.ns.ObsNote()
  assert(#off.printed == 2 and off.printed[1]:find("off here") and off.printed[1]:find("/kinv track drops on")
         and not off.db().on, "an install that kept it off is told how to start it: " .. table.concat(off.printed, " | "))
  print("OK   the first /kinv after updating prints a two-line note, once")
end

-- 3) /kinv track: status, off stops and unregisters, on starts again at once (no prompt), yes is the same as on
do
  local h = fresh()
  assert(h.cmd("scan") == false and h.cmd("trackx") == false and h.cmd(" track") == true, "only 'track ...' is ours")
  h.cmd("TRACK"); assert(h.last():find("on") and h.last():find("0 events"), "status on: " .. h.last())
  h.cmd("track drops on"); assert(h.last():find("already on"), "already on")
  h.cmd("track drops off")
  assert(not h.db().on and not h.registered.LOOT_OPENED and h.last():find("off"), "off unregisters")
  h.s.units.target = { guid = MOB, dead = true, level = 60 }
  h.loot({ item(17076, 1, { MOB2, 1 }) })
  assert(#h.events() == 0, "nothing while off")
  h.cmd("track"); assert(h.last():find("off") and h.last():find("/kinv track drops on"), "status off: " .. h.last())
  h.cmd("track drops on")
  assert(h.db().on and h.db().agreed and h.registered.LOOT_OPENED and #h.popups == 0, "on starts it at once, no prompt")
  h.cmd("track drops off"); h.cmd("track drops yes")
  assert(h.db().on, "/kinv track drops yes")
  h.cmd("track drops sideways"); assert(h.last():find("/kinv track drops off"), "usage")
  print("OK   /kinv track: status, off stops and unregisters, on and yes start it again at once")
end

-- 4) loot: one event per source, coin-only opens, area loot, the target fallback, reopen once, skin / herb / mine / fishing / container
do
  local h = fresh(); h.on()
  h.s.itype, h.s.iid, h.s.difficulty = "raid", 409, 9
  h.s.units.target = { guid = MOB, dead = true, level = 62 }
  h.loot({ item(17076, 1, { MOB, 1 }), item(18264, 2, { MOB, 2 }), COIN, { link = "|cffffffff|Hcurrency:1220|h[C]|h|r", n = 5, from = { MOB, 5 } } })
  local e = h.events()[1]
  assert(#h.events() == 1 and e.type == "loot" and e.id:match("^[0-9a-z]+%-000001$") and e.t == h.s.now and e.b == "1.60.1.70888", dump(e))
  assert(dump(e.src) == "{guid=" .. MOB .. ",kind=mob,level=62,npc=11502,via=slot}", dump(e.src))
  assert(dump(e.items) == "{1={id=17076,link=|cffffffff|Hitem:17076|h[X]|h|r,n=1},2={id=18264,link=|cffffffff|Hitem:18264|h[X]|h|r,n=2}}",
         "items with short links, no coins, no currency: " .. dump(e.items))
  assert(dump(e.where) == "{difficulty=9,itype=raid,map=409,uiMap=1429}", "inside: no x/y " .. dump(e.where))
  assert(dump(e.who) == "{class=4,faction=Alliance,level=60,name=Tester,surname=Testwood}", dump(e.who))
  h.loot({ item(17076, 1, { MOB, 1 }) })
  assert(#h.events() == 1, "the same corpse opened twice counts once")
  -- area loot: two corpses in one window, one with coins only
  h.s.itype = "none"
  h.loot({ item(2589, 3, { MOB2, 2, "Creature-0-4170-0-1234-2958-000012ABCF", 1 }), { n = 0, from = { "Creature-0-4170-0-1234-2958-000012ABD0", 0 } } })
  local ev = h.events()
  assert(#ev == 4, "three sources, three events: " .. #ev)
  assert(ev[2].src.guid == MOB2 and ev[2].items[1].n == 2 and ev[3].items[1].n == 1, "counts per source")
  assert(#ev[4].items == 0 and ev[4].src.kind == "mob" and ev[4].src.npc == 2958, "a coin-only corpse is an open with no items")
  assert(ev[2].where.x == 0.4123 and ev[2].where.y == 0.6543 and not ev[2].where.itype, "outside: x/y to 4 places " .. dump(ev[2].where))
  -- skinning the first corpse: a separate open of kind skin
  h.s.clock = 200; h.event("UNIT_SPELLCAST_SUCCEEDED", "player", "cast-1", 8613)
  h.loot({ item(4304, 2, { MOB, 2 }) })
  ev = h.events(); assert(#ev == 5 and ev[5].src.kind == "skin" and ev[5].src.npc == 11502, "skinning: " .. dump(ev[5].src))
  -- a herb node (by spell id) and a mining node (by the spell's name), then a chest after the cast window
  h.s.clock = 300; h.event("UNIT_SPELLCAST_START", "player", "c", 2366)
  h.loot({ item(765, 1, { NODE, 1 }) })
  h.s.clock = 400; h.event("UNIT_SPELLCAST_SUCCEEDED", "player", "c", 999)
  h.loot({ item(2770, 2, { "GameObject-0-4170-0-1234-1731-0000AAAA02", 2 }) })
  h.s.clock = 500; h.event("UNIT_SPELLCAST_SUCCEEDED", "party1", "c", 2575)
  h.loot({ item(4306, 1, { "GameObject-0-4170-0-1234-2843-0000AAAA03", 1 }) })
  ev = h.events()
  assert(ev[6].src.kind == "herb" and ev[6].src.object == 1617 and ev[7].src.kind == "mine" and ev[8].src.kind == "chest", dump(ev[8].src))
  -- fishing, an opened bag item, a player's corpse (battleground): no player GUID is ever kept
  h.s.fishing = true; h.loot({ item(6303, 1, { "GameObject-0-4170-0-1234-35591-0000AAAA04", 1 }) }); h.s.fishing = false
  h.G.C_Item = { GetItemIDByGUID = function(g) if g == BAG then return 20708 end end }
  h.loot({ item(2589, 4, { BAG, 4 }) })
  h.loot({ item(20558, 1, { PLAYER, 1 }) })
  ev = h.events()
  assert(ev[9].src.kind == "fishing" and ev[10].src.kind == "container" and ev[10].src.item == 20708 and not ev[10].src.guid, dump(ev[10].src))
  assert(ev[11].src.kind == "other" and not ev[11].src.guid and not ev[11].src.npc, dump(ev[11].src))
  -- a boss seen as boss1 this session
  h.s.units.boss1 = { guid = "Creature-0-4170-409-1234-12118-000012AAAA" }
  h.event("INSTANCE_ENCOUNTER_ENGAGE_UNIT"); h.s.units.boss1 = nil
  h.loot({ item(16800, 1, { "Creature-0-4170-409-1234-12118-000012AAAA", 1 }), COIN })
  ev = h.events(); assert(ev[12].src.kind == "boss" and ev[12].src.npc == 12118, dump(ev[12].src))
  -- coins the client names no source for (no dead target either) are not an empty "other" open of their own
  h.s.units.target = nil
  h.loot({ item(1497, 1, { "Creature-0-4170-3065-1234-263389-000012AAAB", 1 }), { n = 0 } })
  ev = h.events(); assert(#ev == 13 and ev[13].src.npc == 263389, "one open, the mob's: " .. #ev .. " " .. dump(ev[#ev].src))
  print("OK   loot: one event per source, coin-only opens, no coins or currencies, reopen once, skin / herb / mine / chest / fishing / container / boss")
end

-- 5) no GetLootSourceInfo: the dead target when the window opened (via = target), else no source
do
  local h = fresh({ noSourceInfo = true }); h.on()
  h.s.units.target = { guid = MOB2, dead = true, level = 14 }
  h.loot({ item(2589, 1), COIN })
  local e = h.events()[1]
  assert(dump(e.src) == "{guid=" .. MOB2 .. ",kind=mob,level=14,npc=2958,via=target}" and #e.items == 1, dump(e.src))
  h.loot({ COIN }); assert(#h.events() == 1, "same corpse again")
  h.s.units.target = { guid = MOB, dead = false }
  h.loot({ item(2589, 1) })
  e = h.events()[2]
  assert(e.src.kind == "other" and not e.src.guid, "a live target is not the source: " .. dump(e.src))
  h.s.units.target = nil
  h.loot({})
  assert(#h.events() == 3 and #h.events()[3].items == 0, "an empty window is still an open")
  print("OK   without GetLootSourceInfo: the dead target (via = target, with its level); a live target is not used")
end

-- 6) quests: accept with the giver, turn-in with ender, rewards, choices and the chosen one; never the money
do
  local h = fresh(); h.on()
  h.s.units.questnpc = { guid = "Creature-0-4170-0-1234-11811-000012AAAB" }
  h.s.quest = 7787
  h.event("QUEST_DETAIL"); h.event("QUEST_ACCEPTED", 7787)
  h.s.units.questnpc = { guid = PLAYER }                        -- a quest shared by a player: no giver
  h.event("QUEST_DETAIL"); h.event("QUEST_ACCEPTED", 3, 7788)   -- the older (index, questId) form
  h.s.units.questnpc = { guid = "GameObject-0-4170-0-1234-2059-0000AAAA05" }
  h.s.rewards = { item(19019, 1) }; h.s.choices = { item(19018, 1), item(19019, 1) }
  h.event("QUEST_COMPLETE")
  h.hooks.GetQuestReward(2)
  h.event("QUEST_TURNED_IN", 7787, 6600, 123456)
  local ev = h.events()
  assert(dump(ev[1]):find("act=accept") and ev[1].quest == 7787 and ev[1].npc == 11811 and not ev[1].rewards, dump(ev[1]))
  assert(ev[2].quest == 7788 and not ev[2].npc and not ev[2].object, "no player giver: " .. dump(ev[2]))
  assert(ev[3].act == "turnin" and ev[3].object == 2059 and
         dump(ev[3].rewards) == "{choices={1=19018,2=19019},chose=19019,items={1={id=19019,link=|cffffffff|Hitem:19019|h[X]|h|r,n=1}}}",
         dump(ev[3]))
  assert(not dump(h.db()):find("123456") and not dump(h.db()):find("6600"), "quest money and xp are never kept")
  print("OK   quests: accept with the giver, turn-in with the ender, item rewards, choices and the chosen item; no money")
end

-- 6b) quest text: the words of the quest windows, the character's own name back to "$N", once per quest and act
do
  local h = fresh(); h.on()
  h.s.units.questnpc = { guid = "Creature-0-4170-0-1234-11811-000012AAAB" }
  h.s.quest = 7787
  h.s.text = { title = "  Rise, Thunderfury!  ", details = "Tester, the blade is whole.\\n\\nTesterly folk and Tester's kin wait.",
               objectives = "Bring the Bindings to Demitrian.", progress = "Do you have them, Tester?",
               completion = "It is done, Tester.\\rTake it." }
  h.event("QUEST_DETAIL"); h.event("QUEST_ACCEPTED", 7787)
  h.event("QUEST_PROGRESS"); h.event("QUEST_COMPLETE"); h.event("QUEST_TURNED_IN", 7787, 6600, 123456)
  local ev = h.events()
  assert(dump(ev[1].text) == "{details=$N, the blade is whole.\\n\\nTesterly folk and $N's kin wait.,objectives=Bring the Bindings to Demitrian.,"
         .. "title=Rise, Thunderfury!}", dump(ev[1].text))
  assert(dump(ev[2].text) == "{completion=It is done, $N.Take it.,progress=Do you have them, $N?,title=Rise, Thunderfury!}", dump(ev[2].text))
  assert(h.registered.QUEST_PROGRESS, "QUEST_PROGRESS is registered while on")
  -- the same quest again (a repeatable one): the events are kept, the text is not repeated
  h.event("QUEST_DETAIL"); h.event("QUEST_ACCEPTED", 7787); h.event("QUEST_COMPLETE"); h.event("QUEST_TURNED_IN", 7787)
  assert(#ev == 4 and ev[3].act == "accept" and not ev[3].text and ev[4].act == "turnin" and not ev[4].text, "text once per quest and act")
  -- a quest accepted with another quest's window still open: the giver's 60 s guess never carries the text
  h.s.quest = 7788; h.event("QUEST_DETAIL"); h.event("QUEST_ACCEPTED", 7789)
  assert(ev[5].quest == 7789 and not ev[5].text, "text only for the quest the window showed")
  -- a progress line of another quest is not this quest's
  h.s.quest = 9; h.event("QUEST_PROGRESS"); h.s.quest = 10; h.s.text.progress = nil; h.event("QUEST_COMPLETE"); h.event("QUEST_TURNED_IN", 10)
  assert(ev[6].quest == 10 and ev[6].text.completion and not ev[6].text.progress, dump(ev[6]))
  -- limits: each field is cut on a whole UTF-8 character; empty text leaves no field and no table
  h.s.quest = 11; h.s.text = { title = string.rep("é", 150), details = string.rep("x", 9000), objectives = "   " }
  h.event("QUEST_DETAIL"); h.event("QUEST_ACCEPTED", 11)
  assert(#ev[7].text.title == 200 and #ev[7].text.details == 8000 and ev[7].text.objectives == nil, dump(ev[7].text):sub(1, 80))
  h.s.text = { title = string.rep("é", 99) .. "a" .. "é" }
  h.s.quest = 12; h.event("QUEST_DETAIL"); h.event("QUEST_ACCEPTED", 12)
  assert(#ev[8].text.title == 199 and ev[8].text.title:sub(-1) == "a", "cut before a split character: " .. #ev[8].text.title)
  h.s.quest = 13; h.s.text = {}; h.event("QUEST_DETAIL"); h.event("QUEST_ACCEPTED", 13)
  assert(ev[9].quest == 13 and ev[9].text == nil, "no text, no table")
  -- past half the size cap, quests are still recorded but their text is not
  local b = fresh(); b.on()
  local big = {}
  for i = 1, 2000 do big[i] = { link = "|Hitem:" .. (100000 + i) .. "|h[X]|h", n = 1, from = { MOB, 1 } } end
  for i = 1, 45 do b.s.units.target = nil; for _, s in ipairs(big) do s.from[1] = "Creature-0-1-0-1-7-" .. string.format("%X", i) end; b.loot(big) end
  b.s.quest = 7787; b.s.text = { title = "T", details = "D" }
  b.event("QUEST_DETAIL"); b.event("QUEST_ACCEPTED", 7787)
  local last = b.events()[#b.events()]
  assert(last.type == "quest" and last.quest == 7787 and last.text == nil, "no text past half the cap")
  -- a saved table from before: a quest whose text is already kept is not recorded again after a reload
  local old = { v = 1, on = true, agreed = true, n = 1, prefix = "abc123", events = {
    { id = "abc123-000001", t = 1767225600 - 86400, type = "quest", act = "accept", quest = 7787, text = { title = "T" } } } }
  local g = fresh({ db = old })
  g.s.quest = 7787; g.s.text = { title = "T", details = "D" }
  g.event("QUEST_DETAIL"); g.event("QUEST_ACCEPTED", 7787); g.event("QUEST_COMPLETE"); g.event("QUEST_TURNED_IN", 7787)
  assert(not g.events()[2].text and g.events()[3].text.title == "T", "kept accept text is not repeated; the turn-in text is new")
  print("OK   quest text: title, details, objectives, progress and completion as shown, own name as $N, once per quest and act, capped")
end

-- 7) vendors: items, stack, price, extended costs, limited stock; the same stock once an hour
do
  local h = fresh(); h.on()
  h.s.units.npc = { guid = "Creature-0-4170-0-1234-12944-000012AAAC" }
  h.s.merchant = { { id = 19326, n = 1, price = 0, avail = -1, cost = { { "|Hitem:17010|h[Fiery Core]|h", 1 } },
                     link = "|cffa335ee|Hitem:19326::::::::60:::::|h[Made-up Cloak]|h|r" },
                   { id = 4470, n = 1, price = 38, avail = 5 },
                   { id = 159, n = 5, price = 25, avail = -1, cost = { { "|Hcurrency:1792|h[Honor]|h", 300 } } } }
  h.event("MERCHANT_SHOW"); h.drain()
  local e = h.events()[1]
  assert(e.type == "vendor" and e.npc == 12944, dump(e))
  assert(dump(e.items) == "{1={cost={1={item=17010,n=1}},id=19326,link=|cffa335ee|Hitem:19326|h[Made-up Cloak]|h|r,n=1,price=0},"
         .. "2={id=4470,limited=5,n=1,price=38},"
         .. "3={cost={1={currency=1792,n=300}},id=159,n=5,price=25}}", dump(e.items))
  h.event("MERCHANT_CLOSED"); h.event("MERCHANT_SHOW"); h.drain()
  assert(#h.events() == 1, "same stock within the hour")
  h.event("MERCHANT_CLOSED"); h.s.merchant[2].avail = 4; h.event("MERCHANT_SHOW"); h.drain()
  assert(#h.events() == 2, "changed stock is recorded")
  h.event("MERCHANT_SHOW"); h.event("MERCHANT_CLOSED"); h.drain()
  assert(#h.events() == 2, "closed before it was read")
  h.s.units.npc = { guid = PLAYER }; h.event("MERCHANT_SHOW"); h.drain()
  assert(#h.events() == 2, "not a creature")
  for k in pairs(e) do assert(not k:lower():find("money") and not k:lower():find("gold"), k) end
  print("OK   vendors: id, n, price per n, item and currency costs, limited stock; the same stock once an hour")
end

-- 7a) vendors: rx (the npc's reaction) is recorded and part of the same-stock check; the class item filter is switched
--     to "all" for the read and put back; filtered = true when it cannot be switched
do
  local VENDOR = "Creature-0-4170-0-1234-2843-000012AAAE"
  local function shop(opts)
    local h = fresh(opts); h.on()
    h.s.units.npc = { guid = VENDOR }
    h.s.reaction, h.s.mfilter = 5, 2
    h.s.merchant = { { id = 4470, n = 1, price = 38, avail = -1 }, { id = 2488, n = 1, price = 500, avail = -1, other = true } }
    return h
  end
  local h = shop()
  h.event("MERCHANT_SHOW"); h.drain()
  local e = h.events()[1]
  assert(e.rx == 5 and e.filtered == nil and #e.items == 2 and e.items[2].id == 2488, "the read sees every item: " .. dump(e))
  assert(h.s.mfilter == 2 and h.s.filterSets == 2, "the class filter is put back: " .. h.s.mfilter .. " " .. h.s.filterSets)
  h.event("MERCHANT_CLOSED"); h.event("MERCHANT_SHOW"); h.drain()
  assert(#h.events() == 1, "same stock, same rx: once an hour")
  h.event("MERCHANT_CLOSED"); h.s.reaction = 6; h.event("MERCHANT_SHOW"); h.drain()
  assert(#h.events() == 2 and h.events()[2].rx == 6, "a new reaction is a new reading")
  h.s.mfilter, h.s.filterSets, h.s.reaction = 1, 0, 7
  h.event("MERCHANT_CLOSED"); h.event("MERCHANT_SHOW"); h.drain()
  assert(h.s.filterSets == 0 and #h.events() == 3 and #h.events()[3].items == 2, "already 'all': the filter is not touched")
  local g = shop({ noSetMerchantFilter = true })
  g.event("MERCHANT_SHOW"); g.drain()
  e = g.events()[1]
  assert(e.filtered == true and #e.items == 1 and g.s.mfilter == 2, "no SetMerchantFilter: filtered " .. dump(e))
  local k = shop(); k.s.stuckFilter = true
  k.event("MERCHANT_SHOW"); k.drain()
  e = k.events()[1]
  assert(e.filtered == true and #e.items == 1 and k.s.filterSets == 2, "a switch that does not take: filtered " .. dump(e))
  local n = shop(); n.G.UnitReaction = function() return 9 end
  n.event("MERCHANT_SHOW"); n.drain()
  assert(n.events()[1].rx == nil, "rx only 1..8")
  print("OK   vendors: rx recorded and in the same-stock check; read under the 'all' item filter and put back; else filtered = true")
end

-- 7b) trainers: the whole list (every type filter on for the read, put back after), spell ids from the tooltip, rx;
--     once a week per trainer and list (learning a spell changes nothing); never the Beast Training window; no GUID
do
  local TRAINER = "Creature-0-4170-0-1234-5146-000012AAAD"
  local function rows()
    return {
      { name = "Frost Magic", st = "header" },
      { name = "Frostbolt", rank = "Rank 4", st = "available", lv = 20, cost = 1800, s = 7322 },
      { name = "Blizzard", rank = "Rank 2", st = "unavailable", lv = 28, cost = 4000, s = 8427, needs = { "Blizzard" } },
      { name = "Frostbolt", rank = "Rank 1", st = "used", lv = 4, cost = 100, s = 116 },
      { name = "  Arcane Intellect ", st = "available", lv = 0, cost = 0 },
      { name = "Made-up Ward", st = "available", lv = 30, cost = 10, s = 4711, tipType = 0 },   -- the tooltip names an item
    }
  end
  local function school(opts)
    local h = fresh(opts); h.on()
    h.s.units.npc = { guid = TRAINER }
    h.s.reaction = 6
    h.s.trainer.filters = { available = true, unavailable = false, used = false }
    h.s.trainer.rows = rows()
    return h
  end
  local function visit(h) h.event("TRAINER_SHOW"); h.drain(); h.drain(); h.event("TRAINER_CLOSED") end
  local h = school()
  assert(h.registered.TRAINER_SHOW and h.registered.TRAINER_UPDATE and h.registered.TRAINER_CLOSED, "trainer events registered")
  visit(h)
  local ev = h.events()
  assert(#ev == 1, "one event, the filter switches' TRAINER_UPDATEs read nothing again: " .. #ev)
  local e = ev[1]
  assert(e.type == "trainer" and e.npc == 5146 and e.kind == "class" and e.rx == 6 and e.who.name == "Tester" and e.where.uiMap == 1429, dump(e))
  assert(dump(e.rows) == "{1={cost=1800,lv=20,name=Frostbolt,rank=Rank 4,s=7322,st=a},"
         .. "2={cost=4000,lv=28,name=Blizzard,needs={1=Blizzard},rank=Rank 2,s=8427,st=u},"
         .. "3={cost=100,lv=4,name=Frostbolt,rank=Rank 1,s=116,st=k},"
         .. "4={cost=0,name=Arcane Intellect,st=a},"
         .. "5={cost=10,lv=30,name=Made-up Ward,st=a}}", dump(e.rows))
  assert(dump(h.s.trainer.filters) == "{available=true,unavailable=false,used=false}" and h.s.trainer.sets == 4,
         "the filters are put back: " .. dump(h.s.trainer.filters))
  assert(not dump(h.db()):find("Creature%-") and not h.db().lastError, "no GUID is stored")
  -- the same list again, also after learning a spell and after a reload: not recorded again within 7 days
  visit(h)
  h.s.trainer.rows[2].st = "used"; visit(h)
  local r = school({ db = h.db() }); r.s.trainer.rows[2].st = "used"
  visit(r)
  assert(#h.events() == 1 and #r.events() == 1, "the same trainer and list once a week, across a reload while the event is kept")
  -- what is recorded again: a week later, another reaction (another price), another cost
  r.s.now = r.s.now + 7 * 86400; visit(r)
  assert(#r.events() == 2, "a week later")
  r.s.reaction = 7; visit(r)
  assert(#r.events() == 3 and r.events()[3].rx == 7, "a new reaction")
  r.s.trainer.rows[3].cost = 3800; visit(r)
  assert(#r.events() == 4 and r.events()[4].rows[2].cost == 3800, "a new cost")
  -- never: the hunter's Beast Training window, a trainer that is no creature, while off
  local p = school(); p.s.trainer.type = 3; visit(p)
  assert(#p.events() == 0 and p.s.trainer.sets == 0, "Beast Training is never read")
  local q = school(); q.s.units.npc = { guid = PLAYER }; visit(q)
  q.s.units.npc = nil; visit(q)
  assert(#q.events() == 0, "no creature id, no event")
  local o = school(); o.cmd("track drops off"); visit(o)
  assert(#o.events() == 0 and not o.registered.TRAINER_SHOW, "nothing while off")
  -- a list that arrives after the window opened: read again on TRAINER_UPDATE, at most 5 times while it is empty
  local l = school(); l.s.trainer.rows = {}
  l.event("TRAINER_SHOW"); l.drain(); l.drain()
  assert(l.s.trainer.reads == 1, "our own filter switches do not start another read: " .. l.s.trainer.reads)
  for _ = 1, 9 do l.event("TRAINER_UPDATE"); l.drain() end
  assert(#l.events() == 0 and l.s.trainer.reads == 5, "five reads of an empty list: " .. l.s.trainer.reads)
  l.event("TRAINER_CLOSED"); l.event("TRAINER_SHOW"); l.drain()
  l.s.trainer.rows = rows(); l.event("TRAINER_UPDATE"); l.drain(); l.event("TRAINER_UPDATE"); l.drain()
  assert(#l.events() == 1, "the late list is recorded once")
  -- the npc unit not there yet on the first read: not given up, read again on the next TRAINER_UPDATE (same 5 tries)
  local u = school(); u.s.units.npc = nil
  u.event("TRAINER_SHOW"); u.drain()
  assert(#u.events() == 0 and u.s.trainer.reads == 0 and u.s.trainer.sets == 0, "no npc yet: nothing read, no filter touched")
  u.s.units.npc = { guid = TRAINER }; u.event("TRAINER_UPDATE"); u.drain(); u.drain()
  assert(#u.events() == 1 and u.events()[1].npc == 5146 and dump(u.s.trainer.filters) == "{available=true,unavailable=false,used=false}",
         "the npc that arrives late is recorded: " .. #u.events())
  local w = school(); w.s.units.npc = nil
  w.event("TRAINER_SHOW"); w.drain()
  for _ = 1, 9 do w.event("TRAINER_UPDATE"); w.drain() end
  w.s.units.npc = { guid = TRAINER }; w.event("TRAINER_UPDATE"); w.drain()
  assert(#w.events() == 0 and w.s.trainer.reads == 0, "five tries without an npc, then the window is left alone")
  -- closed before the read: nothing
  local c = school(); c.event("TRAINER_SHOW"); c.event("TRAINER_CLOSED"); c.drain()
  assert(#c.events() == 0, "closed before it was read")
  -- a profession trainer: kind, skill and skill rank
  local f = school(); f.s.trainer.type = 2
  f.s.trainer.rows = { { name = "Blacksmithing", rank = "Journeyman", st = "available", lv = 10, cost = 500, s = 3100, skill = "Blacksmithing", skillReq = 50 } }
  visit(f)
  assert(f.events()[1].kind == "profession" and dump(f.events()[1].rows) ==
         "{1={cost=500,lv=10,name=Blacksmithing,rank=Journeyman,s=3100,skill=Blacksmithing,skillReq=50,st=a}}", dump(f.events()[1]))
  -- a client that spells the enum Tradeskill (no s)
  local f2 = school(); f2.G.Enum = { TrainerType = { General = 0, Tradeskill = 5, Pet = 3 }, TooltipDataType = { Item = 0, Spell = 1 } }
  f2.s.trainer.type = 5; visit(f2)
  assert(f2.events()[1].kind == "profession", "Enum.TrainerType.Tradeskill: " .. tostring(f2.events()[1].kind))
  -- limits: 400 rows, names cut to 120 bytes on a whole character, 5 needs; rows with markup or no cost are left out
  local big = school(); big.s.trainer.rows = {
    { name = string.rep("é", 70), st = "available", cost = 1, needs = { "a", "b", "c", "d", "e", "f", "g" } },
    { name = "|cffff0000Red|r", st = "available", cost = 1 }, { name = "No Cost", st = "available" } }
  for i = 1, 450 do big.s.trainer.rows[#big.s.trainer.rows + 1] = { name = "Spell " .. i, st = "available", cost = i } end
  visit(big)
  e = big.events()[1]
  assert(#e.rows == 400 and #e.rows[1].name == 120 and #e.rows[1].needs == 5 and e.rows[2].name == "Spell 1"
         and e.rows[400].name == "Spell 399", #e.rows .. " " .. #e.rows[1].name .. " " .. e.rows[2].name)
  -- a client without the tooltip API: no spell ids, the rest as before
  local t = school({ noTooltip = true }); visit(t)
  for _, row in ipairs(t.events()[1].rows) do assert(row.s == nil, dump(row)) end
  assert(#t.events()[1].rows == 5, "rows without spell ids")
  print("OK   trainers: whole list with filters put back, spell ids, rx, kind; once a week per list; no Beast Training, no GUID, caps")
end

-- 8) never money or other players, anywhere in the saved table; the only name is this character's own, in who
do
  local h = fresh(); h.on()
  h.s.units.target = { guid = MOB, dead = true, level = 60 }
  h.loot({ COIN, item(1, 1, { MOB, 1, PLAYER, 1 }) })
  h.event("QUEST_TURNED_IN", 1, 1, 98765)
  local all = dump(h.db())
  assert(not all:find("Player%-") and not all:find("Someone") and not all:find("98765") and not all:find("Example Realm"), all)
  for _, e in ipairs(h.events()) do
    for k in pairs(e.who) do assert(k == "level" or k == "class" or k == "faction" or k == "name" or k == "surname", k) end
    assert(e.who.name == "Tester" and e.who.surname == "Testwood", dump(e.who))
  end
  local n = fresh({ noSurname = true }); n.on(); n.s.units.target = { guid = MOB, dead = true }; n.loot({ COIN })
  assert(dump(n.events()[1].who) == "{class=4,faction=Alliance,level=60,name=Tester}", "no surname: " .. dump(n.events()[1].who))
  print("OK   no coin amounts, quest money, player GUIDs, realms or other players' names; only this character's own name")
end

-- 8b) item links are cut to the item's own colour, id and name (no level, spec or enchant parts); odd links are dropped
do
  local h = fresh(); h.on()
  h.s.units.target = { guid = MOB, dead = true, level = 60 }
  h.loot({ { link = "|cffA335EE|Hitem:19019:2564:0:0:0:0:0:0:60:263:0:0:0|h[Thunderfury, Blessed Blade]|h|r", n = 1, from = { MOB, 1 } },
           { link = "|Hitem:2589::|h[No Colour]|h", n = 2, from = { MOB, 2 } } })
  local items = h.events()[1].items
  assert(items[1].link == "|cffa335ee|Hitem:19019|h[Thunderfury, Blessed Blade]|h|r", items[1].link)
  assert(items[2].id == 2589 and items[2].link == nil, "a link without its colour is left out: " .. dump(items[2]))
  print("OK   item links keep only the quality colour, id and name")
end

-- 9) caps: 5000 events, 30 days, ~2 MB; the oldest go first
do
  local h = fresh(); h.on()
  for i = 1, 5100 do h.s.units.target = nil; h.loot({ item(i, 1, { "Creature-0-1-0-1-" .. i .. "-" .. string.format("%X", i), 1 }) }) end
  local ev = h.events()
  assert(#ev <= 5000 and ev[#ev].items[1].id == 5100 and ev[1].items[1].id > 100, "5000 cap, newest kept: " .. #ev)
  local old = { v = 1, on = true, agreed = true, n = 3, prefix = "abc123", events = {
    { id = "abc123-000001", t = 1767225600 - 31 * 86400, type = "loot" },
    { id = "abc123-000002", t = 1767225600 - 29 * 86400, type = "loot" }, "junk" } }
  local g = fresh({ db = old })
  assert(#g.events() == 1 and g.events()[1].id == "abc123-000002" and g.db().addon == "1.8.0", "30 days, on load")
  assert(g.registered.LOOT_OPENED, "a saved 'on' re-registers after a reload")
  g.loot({ item(5, 1, { MOB, 1 }) })
  assert(g.events()[2].id == "abc123-000004", "ids continue the counter")
  local big = {}
  for i = 1, 2000 do big[i] = { link = "|Hitem:" .. (100000 + i) .. "|h[X]|h", n = 1, from = { MOB, 1 } } end  -- no colour: no link kept
  local b = fresh(); b.on()
  for i = 1, 80 do b.s.units.target = nil; for _, s in ipairs(big) do s.from[1] = "Creature-0-1-0-1-7-" .. string.format("%X", i) end; b.loot(big) end
  local n = #b.events()
  assert(n < 80 and n > 40 and b.events()[n].src.guid:find("%-50$"), "about 2 MB: " .. n)
  print("OK   at most 5000 events, 30 days and ~2 MB; the oldest go first; a saved 'on' survives a reload")
end

-- 11) rolls: a corpse's Need / Greed list, also when another player opened it; the boss from ENCOUNTER_END; no double
--     counting with a loot window of ours; "You won" only as a flag on the item
do
  local BOSS = "Creature-0-4170-3065-1234-261319-00001B055A"
  local MOB3 = "Creature-0-4170-3065-1234-261400-00001B0600"
  local function rolls(h, list, guid)          -- START_LOOT_ROLL for each { id, n }, then the burst settles
    for _, r in ipairs(list) do
      h.s.nextRoll = (h.s.nextRoll or 0) + 1
      h.s.rolls[h.s.nextRoll] = { link = item(r[1], 1).link, n = r[2] or 1 }
      h.event("START_LOOT_ROLL", h.s.nextRoll, 60000, guid)
    end
    h.drain()
  end
  local function rollEvents(h)
    local out = {}
    for _, e in ipairs(h.events()) do if e.type == "loot" and e.src.via == "roll" then out[#out + 1] = e end end
    return out
  end
  local h = fresh(); h.s.itype, h.s.iid, h.s.difficulty = "party", 3065, 1
  assert(h.registered.START_LOOT_ROLL and h.registered.ENCOUNTER_END and h.registered.CHAT_MSG_LOOT, "roll events registered")
  -- the group pulls the boss; it dies, but isn't "dead" in the same frame, and the dead trash this player still targets
  -- is not it: one retry a second later finds the boss among the creatures the group was on at the pull
  h.s.units.party1target = { guid = BOSS }; h.s.units.party2target = { guid = BOSS }
  h.event("ENCOUNTER_START", 3496, "Durgen Dirgehammer", 1, 5)
  h.s.units.target = { guid = MOB3, dead = true }
  h.event("ENCOUNTER_END", 3496, "Durgen Dirgehammer", 1, 5, 0)
  assert(#h.events() == 0, "a wipe is no kill")
  h.event("ENCOUNTER_END", 3496, "Durgen Dirgehammer", 1, 5, 1)
  h.s.units.party1target.dead, h.s.units.party2target.dead = true, true
  h.drain()
  rolls(h, { { 19019 }, { 19020, 2 }, { 19019 } })        -- another player opened it: no GUID with the rolls
  local r = rollEvents(h)
  assert(#r == 1 and r[1].src.kind == "boss" and r[1].src.npc == 261319 and r[1].src.guid == BOSS and r[1].src.encounter == 3496
         and r[1].src.threshold == 2 and r[1].where.map == 3065 and r[1].where.difficulty == 1, dump(r))
  assert(#r[1].items == 2 and r[1].items[1].id == 19019 and r[1].items[1].n == 2 and r[1].items[2].n == 2
         and r[1].items[1].link == "|cffffffff|Hitem:19019|h[X]|h|r", "one list, merged by id: " .. dump(r[1].items))
  -- this player opens the boss corpse too: a window event as before, now a boss with its encounter (the site merges the
  -- two by the corpse GUID); the boss is claimed, so a later sourceless burst is not given to it
  h.s.units.target = { guid = BOSS, dead = true }
  h.loot({ item(19019, 1, { BOSS, 1 }), item(4500, 1, { BOSS, 1 }) })
  local w = h.events()[#h.events()]
  assert(w.src.kind == "boss" and w.src.via == "slot" and w.src.encounter == 3496, dump(w.src))
  h.event("CHAT_MSG_LOOT", "Someone Else won: " .. item(19020, 1).link)
  h.event("CHAT_MSG_LOOT", "You won: " .. item(19020, 1).link)
  assert(r[1].items[2].won == true and not r[1].items[1].won, "my own 'You won' marks the item: " .. dump(r[1].items))
  -- the same corpse's list again (a reload, a second burst): counted once
  rolls(h, { { 19021 } }, BOSS)
  assert(#rollEvents(h) == 1, "a corpse's roll list counts once")
  -- a window of ours showed the items first: the rolls on them add nothing but "won"
  local MOB4 = "Creature-0-4170-3065-1234-261401-00001B0601"
  h.s.units.target = { guid = MOB4, dead = true }
  h.loot({ item(7000, 1, { MOB4, 1 }), item(7001, 1, { MOB4, 1 }) })
  local mobWindow = h.events()[#h.events()]
  rolls(h, { { 7000 } })
  assert(#rollEvents(h) == 1, "items the window recorded are not recorded again")
  h.event("CHAT_MSG_LOOT", "You won: " .. item(7000, 1).link)
  assert(mobWindow.items[1].won == true, "won is set on the window's item: " .. dump(mobWindow.items))
  -- the client names the corpse with the roll (lootHandle): that corpse, kind from the GUID
  h.s.units.target = nil
  rolls(h, { { 8000 } }, MOB3)
  r = rollEvents(h)
  assert(#r == 2 and r[2].src.kind == "mob" and r[2].src.npc == 261400 and r[2].src.guid == MOB3 and not r[2].src.encounter, dump(r[2]))
  -- no GUID and no boss left to give it to: the instance only, until a window of ours shows one of its items
  rolls(h, { { 9000 }, { 9001 } })
  r = rollEvents(h)
  assert(#r == 3 and r[3].src.kind == "other" and not r[3].src.guid and r[3].src.via == "roll", dump(r[3]))
  local MOB5 = "Creature-0-4170-3065-1234-261402-00001B0602"
  h.s.units.target = { guid = MOB5, dead = true }
  h.loot({ item(9001, 1, { MOB5, 1 }) })
  assert(r[3].src.kind == "mob" and r[3].src.guid == MOB5 and r[3].src.npc == 261402 and r[3].src.via == "roll", dump(r[3].src))
  assert(#rollEvents(h) == 3 and not h.db().lastError, tostring(h.db().lastError))
  -- off: nothing, also from a burst that was still settling when it was switched off
  h.s.rolls[99] = { link = item(9500, 1).link, n = 1 }
  h.event("START_LOOT_ROLL", 99, 60000)
  local n = #h.events()
  h.cmd("track drops off"); h.drain()
  rolls(h, { { 9501 } })
  assert(#h.events() == n, "nothing recorded while off")
  -- a translated "You won" (%1$s) and a saved roll event counting as opened after a reload
  local g = fresh({ db = h.db(), globals = { LOOT_ROLL_YOU_WON = "Gewonnen: %1$s" } }); g.cmd("track drops on")
  g.s.itype, g.s.iid = "party", 3065
  rolls(g, { { 19022 } }, BOSS)
  assert(#rollEvents(g) == 3, "the boss's saved roll list still counts as opened")
  rolls(g, { { 9600 } }, MOB4)
  local last = rollEvents(g)[4]
  g.event("CHAT_MSG_LOOT", "Gewonnen: " .. item(9600, 1).link)
  assert(last and last.items[1].won and not g.db().lastError, dump(last))
  print("OK   rolls: a corpse's roll list with boss, encounter and threshold; once per corpse; no double count with our window; won as a flag")
end

-- 10) a client without the APIs: nothing breaks, nothing bogus is stored
do
  local h = fresh({ noApi = true })
  h.cmd("track drops on"); h.cmd("track drops yes")
  for _, e in ipairs({ "LOOT_OPENED", "LOOT_CLOSED", "UNIT_SPELLCAST_SUCCEEDED", "QUEST_DETAIL", "QUEST_ACCEPTED", "QUEST_PROGRESS", "QUEST_COMPLETE",
                       "QUEST_TURNED_IN", "MERCHANT_SHOW", "MERCHANT_CLOSED", "INSTANCE_ENCOUNTER_ENGAGE_UNIT", "ENCOUNTER_START",
                       "ENCOUNTER_END", "START_LOOT_ROLL", "CHAT_MSG_LOOT", "TRAINER_SHOW", "TRAINER_UPDATE", "TRAINER_CLOSED" }) do
    h.event(e, 1, 2, 3)
  end
  h.drain()
  assert(not h.db().lastError, tostring(h.db().lastError))
  local loot = {}
  for _, e in ipairs(h.events()) do if e.type == "loot" then loot[#loot + 1] = e end; assert(not e.b and not next(e.who), dump(e)) end
  assert(#loot == 1 and #loot[1].items == 0 and loot[1].src.kind == "other", dump(loot))
  print("OK   a client without the loot / quest / merchant / trainer / map APIs raises no error")
end
`;

// The real /kinv: every file the .toc loads, in a fake game where unknown globals are harmless stubs.
const toc = fs.readFileSync(path.join(addonDir, "KutzInventory.toc"), "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l.endsWith(".lua"));
const slash = (files) => `
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
for _, file in ipairs({ ${files.map((f) => `{ ${JSON.stringify(f)}, [=====[${fs.readFileSync(path.join(addonDir, f), "utf8")}]=====] }`).join(",\n")} }) do
  chunk = assert(load(file[2], "@" .. file[1], "t", env))
  chunk("KutzInventory", ns)
end
for _, f in ipairs(frames) do
  local on = f.scripts.OnEvent
  if on then on(f, "ADDON_LOADED", "KutzInventory"); on(f, "PLAYER_LOGIN") end
end
if not ns.ObsCommand then                       -- built without Observations.lua: /kinv and /kinv track still work
  assert(KutzInventoryObsDB == nil, "loading the addon without the module made KutzInventoryObsDB")
  SlashCmdList.KUTZINVENTORY(""); SlashCmdList.KUTZINVENTORY("track drops on")
  assert(not table.concat(printed, " "):find("/kinv track") and KutzInventoryObsDB == nil and not KutzInventoryDB.lastError, "without the module")
  say("OK   the addon runs without Observations.lua (no note, no /kinv track, no KutzInventoryObsDB)")
  return
end
assert(KutzInventoryObsDB and KutzInventoryObsDB.on and KutzInventoryObsDB.agreed, "loading the addon turns drop tracking on")
SlashCmdList.KUTZINVENTORY("")
local all = table.concat(printed, "\\n")
assert(all:find("enabled by default") and all:find("/kinv track|r says whether"), "the note and the help line")
assert(KutzInventoryObsDB.noted and KutzInventoryObsDB.on, "noted, still on")
local n = #printed
SlashCmdList.KUTZINVENTORY("track drops off")
assert(#printed == n + 1 and not KutzInventoryObsDB.on, "no second note; off stops it")
SlashCmdList.KUTZINVENTORY("track drops on")
assert(KutzInventoryObsDB.on and KutzInventoryObsDB.agreed, "/kinv track drops on")
SlashCmdList.KUTZINVENTORY("track")
assert(printed[#printed]:find("on"), "status")
assert(not KutzInventoryDB.lastError and not KutzInventoryObsDB.lastError, tostring(KutzInventoryDB.lastError))
say("OK   /kinv track goes through the addon's slash command with every .toc file loaded")
`;
for (const chunk of [code, slash(toc), slash(toc.filter((f) => f !== "Observations.lua"))]) {
    const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
    if (lauxlib.luaL_dostring(L, to_luastring(chunk)) !== 0) {
        console.error("FAIL " + to_jsstring(lua.lua_tostring(L, -1))); process.exit(1);
    }
}
