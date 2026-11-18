// Offline check for KutzInventory/Observations.lua (default-on drop / quest / vendor / trainer recording) in a
// small fake game: on from a new install's first load (an opt-in era install keeps its choice), nothing recorded while off,
// /kinv track (status, off, on again), the one-time note, each event type (loot per source incl. coin-only opens, skinning / herbs / fishing / containers,
// quests with rewards and their extras (level, group, daily, timed, start item, XP, reputation changes), vendors with costs, rx and the item filter, trainers' whole lists, flight masters and flight times), item links cut to colour, id and name, the character's own name and surname
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
    -- s.mapPos[uiMap] = { x, y } puts the player there on that map (the taxi map); false: the client gives no position
    G.C_Map = { GetBestMapForUnit = function() return s.uiMap end,
                GetPlayerMapPosition = function(map)
                  local p = s.mapPos and s.mapPos[map]
                  if p == false then return nil end
                  return { GetXY = function() if p then return p[1], p[2] end; return s.x, s.y end }
                end }
    G.UnitLevel = function(u) if u == "player" then return 60 end; local x = s.units[u]; return x and x.level end
    G.UnitClass = function() return "Rogue", "ROGUE", 4 end
    G.UnitFactionGroup = function() return "Alliance", "Alliance" end
    G.UnitName = function(u) if u == "player" then return "Tester", "Example Realm" end; local x = s.units[u]; return x and x.name or "Someone Else" end
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
    G.UnitReaction = function(u, other)
      local x = s.units[u]
      if other == "player" and x and x.rx then return x.rx end
      if u == "npc" and other == "player" then return s.reaction end
    end
    -- the creatures the player looks at (npcs summary): s.units[u] = { guid, level, class, ct, ctName, fam, famName, rx,
    -- near, combat, dead, speed, tip = { lines }, player, controlled, name }; s.calls counts the API calls made
    s.calls = setmetatable({}, { __index = function() return 0 end })
    local function counted(name, fn) return function(...) s.calls[name] = s.calls[name] + 1; return fn(...) end end
    G.UnitIsPlayer = counted("UnitIsPlayer", function(u) if u == "player" then return true end; local x = s.units[u]; return x and x.player or false end)
    if not opts.noControlled then
      G.UnitPlayerControlled = counted("UnitPlayerControlled", function(u) local x = s.units[u]; return x and x.controlled or false end)
    end
    G.UnitCreatureType = function(u) local x = s.units[u]; if x then return x.ctName, x.ct end end
    G.UnitCreatureFamily = function(u) local x = s.units[u]; if x then return x.famName, x.fam end end
    G.UnitAffectingCombat = function(u) local x = s.units[u]; return x and x.combat or false end
    G.UnitAttackSpeed = function(u) local x = s.units[u]; return x and x.speed, nil end
    G.CheckInteractDistance = counted("CheckInteractDistance", function(u, i) local x = s.units[u]; return i == 3 and x and x.near or false end)
    G.GetMaxPlayerLevel = function() return s.maxLevel or 60 end
    G.UnitFactionGroup = function(u) if u == "player" then return s.faction or "Alliance", s.faction or "Alliance" end end
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
    G.Enum = { TrainerType = { General = 0, Tradeskills = 2, Pet = 3 }, TooltipDataType = { Item = 0, Spell = 1 },
               FlightPathState = { Current = 0, Reachable = 1, Unreachable = 2 },
               PlayerInteractionType = { Merchant = 5, TaxiNode = 6, Trainer = 7, Banker = 8, GuildBanker = 10, Registrar = 11,
                                         PetitionVendor = 13, GuildTabardVendor = 14, MailInfo = 17, SpiritHealer = 18, Binder = 20,
                                         Auctioneer = 21, StableMaster = 22, BattleMaster = 23, Transmogrifier = 24 } }
    G.CanMerchantRepair = function() return s.canRepair end
    -- flight masters: s.taxi.nodes = { { nodeID, name, slotIndex, type (CURRENT|REACHABLE|DISTANT|NONE), state, cost, hops,
    -- x, y, slotName, slot } }: GetAllTaxiNodes gives nodeID, name, state, slotIndex and the position; the slot functions
    -- answer for slot (default slotIndex) with slotName (default name); s.onTaxi is UnitOnTaxi("player")
    s.taxi = { map = 1415, nodes = {} }
    local function slotNode(i) for _, n in ipairs(s.taxi.nodes) do if (n.slot or n.slotIndex) == i then return n end end end
    G.GetTaxiMapID = function() return s.taxi.map end
    G.NumTaxiNodes = function() return #s.taxi.nodes end
    G.TaxiNodeName = function(i) local n = slotNode(i); return n and (n.slotName or n.name) end
    G.TaxiNodeGetType = function(i) local n = slotNode(i); return n and n.type or "NONE" end
    G.TaxiNodeCost = function(i) local n = slotNode(i); return n and n.cost end
    G.GetNumRoutes = function(i) local n = slotNode(i); return n and n.hops or 0 end
    G.UnitOnTaxi = function(u) if u == "player" then return s.onTaxi end end
    G.TakeTaxiNode = function() end
    if not opts.noTaxiMap then
      G.C_TaxiMap = { GetAllTaxiNodes = function(map)
        if map ~= s.taxi.map then return {} end
        local out = {}
        for _, n in ipairs(s.taxi.nodes) do
          out[#out + 1] = { nodeID = n.nodeID, name = n.name, state = n.state, slotIndex = n.slotIndex,
                            position = n.x and { x = n.x, y = n.y } or nil }
        end
        return out
      end }
    end
    if not opts.noTooltip then
      G.C_TooltipInfo = { GetTrainerService = function(i)
        local r = services()[i]
        if r and r.s then return { type = r.tipType or 1, id = r.s, lines = {} } end
      end, GetUnit = counted("GetUnit", function(u)
        local x = s.units[u]
        if not (x and x.tip) then return nil end
        local lines = {}
        for i, t in ipairs(x.tip) do lines[i] = { leftText = t } end
        return { type = 2, lines = lines }
      end) }
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

-- Game gossip and greetings share a persistent, bounded subject/text index.
do
  local secret = {}
  local function gossip(opts)
    local h = fresh(opts)
    h.s.units.npc = { guid = MOB }
    h.G.C_GossipInfo = { GetText = function() return h.s.words end }
    h.G.GetGreetingText = function() return h.s.greeting end
    h.G.GetGossipText = function() return h.s.legacy end
    return h
  end
  local h = gossip({ globals = { issecretvalue = function(v) return v == secret end } })
  h.s.words = "  Welcome Tester Testwood, Rogue.  "
  h.event("GOSSIP_SHOW")
  local e = h.events()[1]
  assert(e and e.npc == 11502 and e.type == "gossip" and e.kind == "gossip"
         and e.text == "Welcome $N, Rogue." and e.guid == nil and e.where and e.who, h.db().lastError)
  h.s.greeting = "Welcome Tester, Rogue."
  h.event("QUEST_GREETING")
  assert(#h.events() == 1 and h.db().n == 1, "same normalized text across both windows")
  h.s.units.npc.guid = NODE
  h.event("QUEST_GREETING")
  e = h.events()[2]
  assert(e and e.object == 1617 and not e.npc and e.kind == "greeting", "distinct object subject")
  h.s.units.npc.guid = PLAYER
  h.event("GOSSIP_SHOW")
  h.s.units.npc.guid = secret
  h.event("GOSSIP_SHOW")
  h.s.units.npc.guid, h.s.words, h.s.legacy = MOB, secret, "Do not fall back from a secret"
  h.event("GOSSIP_SHOW")
  h.s.words = "Do not record me in mail"
  h.event("MAIL_SHOW"); h.event("GOSSIP_SHOW"); h.event("MAIL_CLOSED")
  h.G.InboxFrame = { IsVisible = function() return secret end }
  h.event("GOSSIP_SHOW")
  assert(#h.events() == 2 and not h.db().lastError, "player, secret values and mail leave no event")
  h.G.InboxFrame, h.G.C_GossipInfo, h.s.legacy = nil, nil, string.rep("a", 3999) .. "é"
  h.event("GOSSIP_SHOW")
  assert(#h.events()[3].text == 3999, "legacy fallback and correct UTF-8 cut")
  h.G.GetGossipText = nil
  h.event("GOSSIP_SHOW")
  assert(#h.events() == 3, "missing APIs")
  h.db().events = {}
  local r = gossip({ db = h.db() })
  r.s.words = "Welcome Tester, Rogue."
  r.event("GOSSIP_SHOW")
  assert(#r.events() == 0, "saved dedup survives reload and absence of the original event")
  for i = 1, 2000 do r.s.words = "Message number " .. i; r.event("GOSSIP_SHOW") end
  assert(#r.db().textSeen.gossip.keys == 2000 and #r.events() == 2000, r.db().lastError)
  r.s.words = "Welcome Tester, Rogue."
  r.event("GOSSIP_SHOW")
  assert(#r.events() == 2001, "oldest key is evicted")
  local full = gossip({ db = { events = { { t = 1767225600, padding = string.rep("x", 1000000) } } } })
  full.G.C_GossipInfo.GetText = function() error("should not read gossip above half cap") end
  full.event("GOSSIP_SHOW")
  assert(#full.events() == 1 and not full.db().textSeen and not full.db().n, "half cap skips gossip")
  print("OK   gossip and greetings, normalized subjects, privacy guards, saved FIFO and size gate")
end

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

-- 6c) quest extras: lv, group, freq, timed and startItem on accept; xp and rep (changes only) on turn-in; never money or a
--     standing. questy() adds the quest log, XP, combat and reputation APIs:
--     s.log[questID] = info (with index); s.timeAllowed[questID]; s.level / s.maxLevel; s.xp; s.xpOff; s.combat;
--     s.factions = { { id, st, header, rep (a header with its own standing), collapsed, parent, major } } in list order, a
--     collapsed header hiding its children; s.expands counts ExpandFactionHeader; bomb = true: reading that row errors
do
  local QFREQ = { Default = 0, Daily = 1, Weekly = 2, ResetByScheduler = 3 }
  local function questy(opts)
    local h = fresh(opts); h.on()
    local s, G = h.s, h.G
    s.log, s.timeAllowed, s.level, s.maxLevel, s.factions, s.expands = {}, {}, 30, 60, {}, 0
    G.UnitLevel = function(u) if u == "player" then return s.level end; local x = s.units[u]; return x and x.level end
    G.C_QuestLog = { GetLogIndexForQuestID = function(q) return s.log[q] and s.log[q].index end,
                     GetInfo = function(i) for _, x in pairs(s.log) do if x.index == i then return x end end end,
                     GetTimeAllowed = function(q) local t = s.timeAllowed[q]; if t then return t, 0 end end }
    G.Enum.QuestFrequency = QFREQ
    G.GetRewardXP = function() return s.xp end
    G.IsXPUserDisabled = function() return s.xpOff or false end
    G.InCombatLockdown = function() return s.combat or false end
    G.GetRewardMoney = function() s.moneyRead = true; return 123456 end
    local function shown()
      local out, hidden = {}, {}
      for _, f in ipairs(s.factions) do
        local under = f.parent and hidden[f.parent]
        if not under then out[#out + 1] = f end
        if f.header and (f.collapsed or under) then hidden[f.id] = true end
      end
      return out
    end
    local BOMB = setmetatable({}, { __index = function() error("unreadable faction row") end })
    local function data(f)
      if f and f.bomb then return BOMB end
      if f then return { factionID = f.id, name = "Faction " .. f.id, currentStanding = f.st, isHeader = f.header or false,
                         isHeaderWithRep = f.rep or false, isCollapsed = f.collapsed or false } end
    end
    G.C_Reputation = { GetNumFactions = function() return #shown() end,
                       GetFactionDataByIndex = function(i) return data(shown()[i]) end,
                       GetFactionDataByID = function(id) for _, f in ipairs(s.factions) do if f.id == id then return data(f) end end end,
                       ExpandFactionHeader = function(i) local f = shown()[i]; if f then s.expands = s.expands + 1; f.collapsed = false end end,
                       CollapseFactionHeader = function(i) local f = shown()[i]; if f then f.collapsed = true end end,
                       IsMajorFaction = function(id) for _, f in ipairs(s.factions) do if f.id == id then return f.major or false end end; return false end }
    return h
  end
  local function standings(h, changes) for _, f in ipairs(h.s.factions) do if changes[f.id] then f.st = f.st + changes[f.id] end end end
  local function guild(h)                       -- a reputation list: two collapsed headers, a header with its own standing
    h.s.factions = { { id = 1118, st = 0, header = true, collapsed = true }, { id = 72, st = 9000, parent = 1118 },
                     { id = 47, st = 3000, parent = 1118 }, { id = 69, st = 3100, parent = 1118 },
                     { id = 1834, st = 500, header = true, rep = true }, { id = 1835, st = 42, parent = 1834 },
                     { id = 1, st = 0, header = true, collapsed = true }, { id = 87, st = -6500, parent = 1 } }
  end
  local function quest(h, id)
    local e = h.events()
    for i = #e, 1, -1 do if e[i].quest == id then return e[i] end end
  end
  local function lastOf(h, act) local e = h.events(); for i = #e, 1, -1 do if e[i].act == act then return e[i] end end end

  -- accept: the log's facts and the item that started it
  local h = questy()
  h.s.quest = 7787
  h.s.log[7787] = { index = 3, questID = 7787, title = "Rise", level = 58, suggestedGroup = 5, frequency = 1, isHeader = false }
  h.s.timeAllowed[7787] = 900
  h.event("QUEST_DETAIL", 19016); h.event("QUEST_ACCEPTED", 7787)
  local a = lastOf(h, "accept")
  assert(a.lv == 58 and a.group == 5 and a.freq == "daily" and a.timed == true and a.startItem == 19016 and not a.xp and not a.rep, dump(a))
  h.s.quest = 7788; h.s.log[7788] = { index = 4, questID = 7788, level = 60, suggestedGroup = 1, frequency = 2, isHeader = false }
  h.event("QUEST_DETAIL", 0); h.event("QUEST_ACCEPTED", 7788)
  a = lastOf(h, "accept")
  assert(a.lv == 60 and a.freq == "weekly" and not a.group and not a.timed and not a.startItem, "group 1, no timer, item 0: " .. dump(a))
  -- the facts belong to the quest the log holds: a header, another quest at that index, junk, ResetByScheduler, limits
  local function facts(info, extra)
    local x = questy(extra and extra.opts)
    x.s.quest = 500; x.s.log[500] = info
    if extra and extra.setup then extra.setup(x) end
    x.event("QUEST_DETAIL", extra and extra.item); x.event("QUEST_ACCEPTED", extra and extra.accept or 500)
    x.drain()
    assert(not x.db().lastError, tostring(x.db().lastError))
    return lastOf(x, "accept"), x
  end
  local function bare(e) return not (e.lv or e.group or e.freq or e.timed or e.startItem) end
  assert(bare((facts({ index = 1, questID = 500, level = 10, isHeader = true }))), "a header is no quest")
  assert(bare((facts({ index = 1, questID = 501, level = 10, suggestedGroup = 5 }))), "another quest's log entry")
  assert(bare((facts({ index = 1, level = 10, suggestedGroup = 5 }))), "a log entry that does not say its quest")
  local j = facts({ index = 1, questID = 500, level = 0, suggestedGroup = 41, frequency = 3 })
  assert(bare(j), "level 0, group 41, ResetByScheduler: " .. dump(j))
  j = facts({ index = 1, questID = 500, level = 256, suggestedGroup = 2.5, frequency = "1" })
  assert(bare(j), "level 256, group 2.5, frequency a string: " .. dump(j))
  j = facts({ index = 1, questID = 500, level = 12, suggestedGroup = 40, frequency = 0 }, { item = -3 })
  assert(j.lv == 12 and j.group == 40 and not j.freq and not j.startItem, "group 40 kept, frequency 0, item -3: " .. dump(j))
  j = facts({ index = 1, questID = 500, level = 12, frequency = 1 }, { setup = function(x) x.G.Enum.QuestFrequency = nil end })
  assert(j.lv == 12 and not j.freq, "no Enum.QuestFrequency: no freq " .. dump(j))
  j = facts({ index = 1, questID = 500, level = 12 }, { setup = function(x) x.s.timeAllowed[500] = 0 end })
  assert(not j.timed, "a time allowed of 0 is no timer")
  -- the item and the facts only for the quest the window showed, the facts still from the log
  j = facts({ index = 1, questID = 600, level = 20 }, { item = 19016, accept = 600,
                                                        setup = function(x) x.s.log[600] = x.s.log[500]; x.s.log[500] = nil end })
  assert(j.quest == 600 and j.lv == 20 and not j.startItem, "another quest's window: no startItem " .. dump(j))
  -- a secret value is left out; an API that errors or answers junk records nothing and raises nothing
  local SECRET = {}
  j = facts({ index = 1, questID = 500, level = SECRET, suggestedGroup = 3, frequency = SECRET },
            { item = SECRET, opts = { globals = { issecretvalue = function(v) return v == SECRET end } } })
  assert(not j.lv and j.group == 3 and not j.freq and not j.startItem, "secrets left out: " .. dump(j))
  j = facts({ index = 1, questID = 500, level = 9 }, { setup = function(x) x.G.C_QuestLog.GetInfo = function() error("boom") end end })
  assert(bare(j), "GetInfo errors")
  j = facts({ index = 1, questID = 500, level = 9 }, { setup = function(x) x.G.C_QuestLog.GetInfo = function() return "x" end end })
  assert(bare(j), "GetInfo answers junk")
  j = facts({ index = 1, questID = 500, level = 9 }, { setup = function(x) x.G.C_QuestLog = nil end })
  assert(bare(j), "no C_QuestLog")
  -- not in the log yet when accepted: read once more a second later and added to the saved event; nothing more after that
  local late = questy(); late.s.quest = 700
  late.event("QUEST_DETAIL"); late.event("QUEST_ACCEPTED", 700)
  local le = lastOf(late, "accept")
  assert(bare(le), dump(le))
  late.s.log[700] = { index = 1, questID = 700, level = 33, suggestedGroup = 3 }
  late.drain()
  assert(le.lv == 33 and le.group == 3 and late.db().events[#late.db().events] == le, "added a second later: " .. dump(le))
  local never = questy(); never.s.quest = 701
  never.event("QUEST_DETAIL"); never.event("QUEST_ACCEPTED", 701); never.drain(); never.drain()
  assert(bare(lastOf(never, "accept")) and not never.db().lastError, "still not in the log: nothing")
  local gone = questy(); gone.s.quest = 702
  gone.event("QUEST_DETAIL"); gone.event("QUEST_ACCEPTED", 702)
  gone.s.log[702] = { index = 1, questID = 702, level = 33 }; gone.cmd("track drops off"); gone.drain()
  assert(bare(gone.db().events[#gone.db().events]), "turned off within the second: not added")

  -- turn-in: the reward window's XP and the reputation the turn-in changed, as differences only
  local t = questy(); guild(t)
  t.s.quest, t.s.xp = 7787, 6600
  t.s.units.questnpc = { guid = "Creature-0-4170-0-1234-11811-000012AAAB" }
  t.event("QUEST_COMPLETE")
  assert(t.s.expands == 2 and t.s.factions[1].collapsed and t.s.factions[7].collapsed, "headers opened for the read and closed again")
  t.event("QUEST_TURNED_IN", 7787, 6600, 123456)
  local e = lastOf(t, "turnin")
  assert(e.xp == 6600 and e.npc == 11811 and not e.rep, "xp now, rep a second later: " .. dump(e))
  standings(t, { [72] = 250, [47] = 62, [87] = -25, [1834] = 10 })
  t.s.factions[#t.s.factions + 1] = { id = 999, st = 100 }          -- a faction met only now: no change to measure
  t.drain()
  assert(dump(e.rep) == "{1={d=62,f=47},2={d=250,f=72},3={d=-25,f=87},4={d=10,f=1834}}", dump(e.rep))
  local all = dump(t.db())
  assert(not all:find("9250") and not all:find("3062") and not all:find("6525") and not all:find("123456") and not t.s.moneyRead,
         "never a standing, never the money")
  assert(not e.lv and not e.startItem and not t.db().lastError, dump(e))

  -- rep: nothing when anything else could have moved it, or the numbers are odd
  local function turn(change, between, after, opts)
    local x = questy(opts); guild(x)
    x.s.quest, x.s.xp = 7787, 500
    x.event("QUEST_COMPLETE")
    if between then between(x) end
    x.event("QUEST_TURNED_IN", 7787)
    standings(x, change or { [72] = 250 })
    if after then after(x) end
    x.drain()
    assert(not x.db().lastError, tostring(x.db().lastError))
    return quest(x, 7787), x
  end
  local ok = turn()
  assert(dump(ok.rep) == "{1={d=250,f=72}}", "the plain case: " .. dump(ok.rep))
  local function norep(what, ...) local q = turn(...); assert(q and not q.rep, what .. ": " .. dump(q)); return q end
  norep("loot before the turn-in", nil, function(x) x.event("LOOT_OPENED") end)
  norep("loot within the second", nil, nil, function(x) x.event("LOOT_OPENED") end)
  norep("combat before", nil, function(x) x.event("PLAYER_REGEN_DISABLED") end)
  norep("combat within the second", nil, nil, function(x) x.event("PLAYER_REGEN_DISABLED") end)
  local cw = questy(); guild(cw); cw.s.quest = 7787; cw.s.combat = true; cw.event("QUEST_COMPLETE"); cw.s.combat = false
  cw.event("QUEST_TURNED_IN", 7787); standings(cw, { [72] = 250 }); cw.drain()
  assert(not quest(cw, 7787).rep and cw.s.expands == 0, "the window opened in combat: not even read")
  norep("in combat a second later", nil, nil, function(x) x.s.combat = true end)
  norep("combat state unknown", nil, nil, function(x) x.G.InCombatLockdown = function() return SECRET end end,
        { globals = { issecretvalue = function(v) return v == SECRET end } })
  norep("over 5 minutes from the window", nil, function(x) x.s.clock = x.s.clock + 301 end)
  norep("no change", {})
  local seven = questy(); guild(seven); seven.s.factions[#seven.s.factions + 1] = { id = 930, st = 0 }
  seven.s.quest = 7787; seven.event("QUEST_COMPLETE"); seven.event("QUEST_TURNED_IN", 7787)
  standings(seven, { [72] = 1, [47] = 1, [69] = 1, [1834] = 1, [1835] = 1, [87] = 1, [930] = 1 }); seven.drain()
  assert(not quest(seven, 7787).rep, "more than 6 changed: none kept")
  local six = questy(); guild(six); six.s.quest = 7787; six.event("QUEST_COMPLETE"); six.event("QUEST_TURNED_IN", 7787)
  standings(six, { [72] = 1, [47] = 1, [69] = 1, [1834] = 1, [1835] = 1, [87] = 1 }); six.drain()
  assert(#quest(six, 7787).rep == 6, "six are kept")
  norep("a change over 100000", { [72] = 100001 })
  assert(dump(turn({ [72] = -100000 }).rep) == "{1={d=-100000,f=72}}", "100000 is still a change")
  norep("recording turned off within the second", nil, nil, function(x) x.cmd("track drops off") end)
  local nr = questy(); nr.G.C_Reputation = nil; guild(nr); nr.s.quest = 7787
  nr.event("QUEST_COMPLETE"); nr.event("QUEST_TURNED_IN", 7787); nr.drain()
  assert(not quest(nr, 7787).rep and not nr.db().lastError, "no C_Reputation: no rep, no error")
  local nt = questy(); guild(nt); nt.s.quest = 7787; nt.G.C_Timer = nil
  nt.event("QUEST_COMPLETE"); nt.event("QUEST_TURNED_IN", 7787); standings(nt, { [72] = 250 })
  assert(not quest(nt, 7787).rep and nt.s.expands == 0 and not nt.db().lastError, "no timer: nothing is read")
  -- a collapsed header inside a collapsed one is opened in turn and closed again; nothing is opened when none is closed
  local nest = questy(); guild(nest)
  table.insert(nest.s.factions, 5, { id = 1119, st = 0, header = true, collapsed = true, parent = 1118 })
  table.insert(nest.s.factions, 6, { id = 930, st = 100, parent = 1119 })
  nest.s.quest = 7787; nest.event("QUEST_COMPLETE")
  assert(nest.s.expands == 3 and nest.s.factions[1].collapsed and nest.s.factions[5].collapsed and nest.s.factions[9].collapsed,
         "nested headers all closed again: " .. dump(nest.s.factions))
  nest.event("QUEST_TURNED_IN", 7787); standings(nest, { [930] = 25 }); nest.drain()
  assert(dump(quest(nest, 7787).rep) == "{1={d=25,f=930}}", "a faction under a nested header: " .. dump(quest(nest, 7787)))
  local open = questy(); guild(open); open.s.factions[1].collapsed, open.s.factions[7].collapsed = false, false
  open.s.quest = 7787; open.event("QUEST_COMPLETE"); open.event("QUEST_TURNED_IN", 7787); standings(open, { [87] = -5 }); open.drain()
  assert(open.s.expands == 0 and not open.s.factions[1].collapsed and dump(quest(open, 7787).rep) == "{1={d=-5,f=87}}", "none closed")
  -- the read fails part-way (after headers were opened): they are still closed again, no rep, no error
  local bomb = questy(); guild(bomb); bomb.s.factions[8].bomb = true
  bomb.s.quest = 7787; bomb.event("QUEST_COMPLETE")
  assert(bomb.s.expands == 2 and bomb.s.factions[1].collapsed and bomb.s.factions[7].collapsed and not bomb.db().lastError,
         "headers closed again after a failed read: " .. dump(bomb.s.factions) .. tostring(bomb.db().lastError))
  bomb.event("QUEST_TURNED_IN", 7787); standings(bomb, { [72] = 250 }); bomb.drain()
  assert(not quest(bomb, 7787).rep and not bomb.db().lastError, "no rep from a failed read")
  -- a header that will not open: its factions would be missing, so no rep
  local sh = questy(); guild(sh); sh.G.C_Reputation.ExpandFactionHeader = function() end
  sh.s.quest = 7787; sh.event("QUEST_COMPLETE"); sh.event("QUEST_TURNED_IN", 7787); standings(sh, { [72] = 250, [1834] = 10 }); sh.drain()
  assert(not quest(sh, 7787).rep and sh.s.factions[1].collapsed and not sh.db().lastError, "a header that stays closed: no rep, not even for the factions in view")
  -- the Guild faction is not the quest's
  local gd = questy(); guild(gd); gd.s.factions[#gd.s.factions + 1] = { id = 1168, st = 1000 }
  gd.s.quest = 7787; gd.event("QUEST_COMPLETE"); gd.event("QUEST_TURNED_IN", 7787); standings(gd, { [1168] = 50, [72] = 250 }); gd.drain()
  assert(dump(quest(gd, 7787).rep) == "{1={d=250,f=72}}", "no Guild faction: " .. dump(quest(gd, 7787).rep))
  -- a renown faction (its standing restarts each level) and a secret standing are left out; the rest still counts
  local mj = turn({ [72] = 250, [47] = 9 }, function(x) x.s.factions[3].major = true end)
  assert(dump(mj.rep) == "{1={d=250,f=72}}", "renown left out: " .. dump(mj.rep))
  local sc = turn({ [72] = 250 }, nil, function(x) x.s.factions[3].st = SECRET end,
                  { globals = { issecretvalue = function(v) return v == SECRET end } })
  assert(dump(sc.rep) == "{1={d=250,f=72}}", "a secret standing is left out: " .. dump(sc.rep))
  -- another quest's window or turn-in in between: neither turn-in keeps rep
  local two = questy(); guild(two); two.s.quest = 7787
  two.event("QUEST_COMPLETE"); two.event("QUEST_TURNED_IN", 7787)
  two.s.quest = 7788; two.event("QUEST_COMPLETE"); two.event("QUEST_TURNED_IN", 7788)
  standings(two, { [72] = 250 }); two.drain()
  assert(not quest(two, 7787).rep and not quest(two, 7788).rep, "two turn-ins within the second")
  local tw = questy(); guild(tw); tw.s.quest = 7787
  tw.event("QUEST_COMPLETE"); tw.event("QUEST_TURNED_IN", 7787); tw.event("QUEST_TURNED_IN", 7790)
  standings(tw, { [72] = 250 }); tw.drain()
  assert(not quest(tw, 7787).rep and not quest(tw, 7790).rep, "another turn-in within the second")
  local other = questy(); guild(other); other.s.quest = 7787
  other.event("QUEST_COMPLETE"); other.event("QUEST_TURNED_IN", 7790); standings(other, { [72] = 250 }); other.drain()
  assert(not quest(other, 7790).rep, "a turn-in of a quest whose window was not read")
  -- a quest accepted within the second (the next one in a chain) cannot move a reputation: rep is kept
  local chain = turn(nil, nil, function(x) x.s.quest = 7788; x.event("QUEST_DETAIL"); x.event("QUEST_ACCEPTED", 7788) end)
  assert(dump(chain.rep) == "{1={d=250,f=72}}", "a chained accept: " .. dump(chain.rep))
  -- a window read again before the turn-in starts over from the new read
  local again = turn({ [72] = 250 }, function(x) standings(x, { [72] = 40 }); x.event("QUEST_COMPLETE") end)
  assert(dump(again.rep) == "{1={d=250,f=72}}" and again.xp == 500, dump(again))

  -- xp: only while this character can gain XP
  local function xp(setup, opts)
    local x = questy(opts); x.s.quest, x.s.xp = 7787, 6600
    if setup then setup(x) end
    x.event("QUEST_COMPLETE"); x.event("QUEST_TURNED_IN", 7787, 6600, 123456); x.drain()
    assert(not x.db().lastError and not x.s.moneyRead, tostring(x.db().lastError))
    return quest(x, 7787).xp
  end
  assert(xp() == 6600, "under the cap")
  assert(xp(function(x) x.G.IsXPUserDisabled = nil end) == 6600, "a client without the XP lock")
  assert(not xp(function(x) x.s.level = 60 end), "at the level cap")
  assert(not xp(function(x) x.s.level = 70 end), "over the cap")
  assert(not xp(function(x) x.s.xpOff = true end), "XP turned off")
  assert(not xp(function(x) x.G.IsXPUserDisabled = function() error("no") end end), "the XP lock unreadable")
  assert(not xp(function(x) x.G.IsXPUserDisabled = function() return SECRET end end,
                { globals = { issecretvalue = function(v) return v == SECRET end } }), "the XP lock a secret")
  assert(not xp(function(x) x.G.GetMaxPlayerLevel = nil end), "the cap unknown")
  assert(not xp(function(x) x.s.xp = 0 end), "0 XP")
  assert(not xp(function(x) x.s.xp = 12.5 end), "not a whole number")
  assert(not xp(function(x) x.s.xp = SECRET end, { globals = { issecretvalue = function(v) return v == SECRET end } }), "XP a secret")
  local wx = questy(); wx.s.quest, wx.s.xp = 7787, 6600
  wx.event("QUEST_COMPLETE"); wx.event("QUEST_TURNED_IN", 7790)
  assert(not quest(wx, 7790).xp, "a turn-in of another quest than the window's")
  print("OK   quest extras: lv, group, freq, timed, startItem on accept; xp under the cap; rep changes only, dropped when unsure; no money")
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

-- 7c) flight masters: every reachable node with its node id, price and legs; nothing without node ids or when the
--     window's two views disagree; once a week per list; never a GUID or a node name
local function taxiNodes()
  return {
    { nodeID = 2, name = "Made-up Keep, Made-up Shire", slotIndex = 1, type = "CURRENT", state = 0, cost = 0, hops = 0, x = 0.40, y = 0.60 },
    { nodeID = 5, name = "Made-up Port, Made-up Coast", slotIndex = 3, type = "REACHABLE", state = 1, cost = 950, hops = 2, x = 0.45, y = 0.80 },
    { nodeID = 4, name = "Made-up Ford, Made-up Hills", slotIndex = 2, type = "REACHABLE", state = 1, cost = 210, hops = 1, x = 0.42, y = 0.40 },
    { nodeID = 9, name = "Made-up Peak, Made-up Range", slotIndex = 4, type = "DISTANT", state = 2, cost = 0, hops = 0, x = 0.60, y = 0.20 },
  }
end
local FLIGHTMASTER = "Creature-0-4170-0-1234-352-000012AB10"
local function airfield(opts)
  local h = fresh(opts); h.on()
  h.s.units.npc = { guid = FLIGHTMASTER, level = 55 }
  h.s.reaction, h.s.taxi.nodes = 5, taxiNodes()
  return h
end
local function ofType(h, kind)
  local out = {}
  for _, e in ipairs(h.events()) do if e.type == kind then out[#out + 1] = e end end
  return out
end
do
  local h = airfield()
  assert(h.registered.TAXIMAP_OPENED and h.registered.TAXIMAP_CLOSED and h.registered.PLAYER_CONTROL_LOST
         and h.registered.PLAYER_CONTROL_GAINED, "taxi events registered")
  h.event("TAXIMAP_OPENED", 1); h.event("TAXIMAP_CLOSED")
  local ev = ofType(h, "taxi")
  assert(#ev == 1, "one taxi event: " .. dump(h.events()) .. tostring(h.db().lastError))
  local e = ev[1]
  assert(e.npc == 352 and e.node == 2 and e.rx == 5 and e.who.name == "Tester" and e.where.uiMap == 1429 and e.where.x == 0.4123, dump(e))
  assert(dump(e.to) == "{1={cost=210,hops=1,node=4},2={cost=950,hops=2,node=5}}", "reachable nodes, sorted by node: " .. dump(e.to))
  assert(not dump(h.db()):find("Creature%-") and not dump(e):find("Made%-up") and not h.db().lastError, "no GUID, no names: " .. dump(e))
  assert(h.db().npcs[352] and h.db().npcs[352].cells, "the flight master is a near sighting")
  -- the same list again, also after a reload: not within 7 days; another price, another reaction, a week later: again
  h.event("TAXIMAP_OPENED"); h.event("TAXIMAP_CLOSED")
  local r = airfield({ db = h.db() }); r.event("TAXIMAP_OPENED")
  assert(#ofType(h, "taxi") == 1 and #ofType(r, "taxi") == 1, "once a week per list, across a reload")
  r.s.taxi.nodes[2].cost = 900; r.event("TAXIMAP_OPENED")
  r.s.reaction = 6; r.event("TAXIMAP_OPENED")
  r.s.now = r.s.now + 7 * 86400; r.event("TAXIMAP_OPENED")
  local re = ofType(r, "taxi")
  assert(#re == 4 and re[2].to[2].cost == 900 and re[3].rx == 6, "a new price, a new reaction, a week later: " .. #re)
  -- hops are left out when the client gives none; without TaxiNodeGetType the node's state decides
  local g = airfield(); g.G.TaxiNodeGetType = nil; g.s.taxi.nodes[2].hops = nil
  g.event("TAXIMAP_OPENED")
  assert(#ofType(g, "taxi") == 1 and dump(ofType(g, "taxi")[1].to) == "{1={cost=210,hops=1,node=4},2={cost=950,node=5}}",
         dump(g.events()))
  -- an empty list (no other node known yet) is still the flight master's own node
  local lone = airfield(); lone.s.taxi.nodes = { taxiNodes()[1] }; lone.event("TAXIMAP_OPENED")
  assert(#ofType(lone, "taxi") == 1 and dump(ofType(lone, "taxi")[1].to) == "{}", "no destinations yet")
  -- nothing: no node ids, the two names disagree, a reachable slot no node maps to, a node without an id, two current
  -- nodes, no current node, a reachable node without a price, a node id twice, not a creature, no npc unit, no taxi map,
  -- while off
  local function none(setup, opts)
    local x = airfield(opts)
    setup(x)
    x.event("TAXIMAP_OPENED")
    assert(#ofType(x, "taxi") == 0 and not x.db().lastError, "nothing: " .. dump(x.events()) .. tostring(x.db().lastError))
  end
  none(function() end, { noTaxiMap = true })
  none(function(x) x.s.taxi.nodes[2].slotName = "Somewhere Else" end)
  none(function(x) x.s.taxi.nodes[2].slot = 3; x.s.taxi.nodes[2].slotIndex = 9 end)
  none(function(x) x.s.taxi.nodes[2].nodeID = nil end)
  none(function(x) x.s.taxi.nodes[3].type = "CURRENT" end)
  none(function(x) x.s.taxi.nodes[1].type = "DISTANT" end)
  none(function(x) x.s.taxi.nodes[3].cost = nil end)
  none(function(x) x.s.taxi.nodes[3].nodeID = 5 end)
  none(function(x) x.s.units.npc = { guid = PLAYER } end)
  none(function(x) x.s.units.npc = nil end)
  none(function(x) x.G.GetTaxiMapID = nil end)
  none(function(x) x.cmd("track drops off") end)
  local many = airfield(); many.s.taxi.nodes = { taxiNodes()[1] }
  for i = 1, 201 do many.s.taxi.nodes[i + 1] = { nodeID = 100 + i, name = "N" .. i, slotIndex = i + 1, type = "REACHABLE", cost = i } end
  many.event("TAXIMAP_OPENED")
  assert(#ofType(many, "taxi") == 0, "more than 200 reachable nodes: nothing (a cut list would read as unreachable)")
  many.s.taxi.nodes[202] = nil; many.event("TAXIMAP_OPENED")
  assert(#ofType(many, "taxi") == 1 and #ofType(many, "taxi")[1].to == 200, "200 reachable nodes are kept")
  print("OK   taxi: every reachable node with id, price and legs; nothing without ids or when the views disagree; once a week per list")
end

-- 7d) flight times: from boarding (control lost on a taxi, right after TakeTaxiNode picked a node in a window we read) to
--     landing (control back, off the taxi) by the chosen node; never without both ends; one per from/to in 30 days
do
  local function fly(h, slot, sec, landAt)
    h.event("TAXIMAP_OPENED"); h.hooks.TakeTaxiNode(slot); h.event("TAXIMAP_CLOSED")
    h.s.onTaxi = true; h.event("PLAYER_CONTROL_LOST")
    h.s.clock = h.s.clock + sec
    h.s.onTaxi = false; h.s.mapPos = { [1415] = landAt }; h.event("PLAYER_CONTROL_GAINED")
  end
  local h = airfield()
  assert(type(h.hooks.TakeTaxiNode) == "function", "TakeTaxiNode is hooked")
  fly(h, 2, 95.4, { 0.4201, 0.4003 })
  local f = ofType(h, "flight")
  assert(#f == 1 and f[1].from == 2 and f[1].to == 4 and f[1].sec == 95 and f[1].where == nil and f[1].who.name == "Tester", dump(f))
  assert(f[1].id:match("^[0-9a-z]+%-%d+$") and f[1].t == h.s.now and not h.db().lastError, dump(f[1]))
  -- the same flight again (and after a reload): once in 30 days; another destination is its own
  fly(h, 2, 90, { 0.42, 0.40 })
  local r = airfield({ db = h.db() }); fly(r, 2, 90, { 0.42, 0.40 })
  assert(#ofType(h, "flight") == 1 and #ofType(r, "flight") == 1, "once per from/to")
  fly(r, 3, 181, { 0.45, 0.80 })
  assert(#ofType(r, "flight") == 2 and ofType(r, "flight")[2].to == 5 and ofType(r, "flight")[2].sec == 181, "another destination")
  r.s.now = r.s.now + 30 * 86400; fly(r, 2, 92, { 0.42, 0.40 })
  assert(#ofType(r, "flight") == 3, "30 days later")
  -- UnitOnTaxi may only say so a moment after control is lost: asked again every 0.5 s, timed from losing control
  local late = airfield()
  late.event("TAXIMAP_OPENED"); late.hooks.TakeTaxiNode(2); late.event("TAXIMAP_CLOSED")
  late.s.onTaxi = false; late.event("PLAYER_CONTROL_LOST"); late.s.clock = late.s.clock + 0.5
  late.s.onTaxi = true; late.drain()
  late.s.clock = late.s.clock + 60; late.s.onTaxi = false; late.s.mapPos = { [1415] = { 0.42, 0.40 } }; late.event("PLAYER_CONTROL_GAINED")
  assert(#ofType(late, "flight") == 1 and ofType(late, "flight")[1].sec == 61, "timed from losing control: " .. dump(ofType(late, "flight")))
  -- control back mid-flight (still on the taxi): the flight is kept, the real landing counts
  local mid = airfield()
  mid.event("TAXIMAP_OPENED"); mid.hooks.TakeTaxiNode(2); mid.event("TAXIMAP_CLOSED")
  mid.s.onTaxi = true; mid.event("PLAYER_CONTROL_LOST"); mid.s.clock = mid.s.clock + 30; mid.event("PLAYER_CONTROL_GAINED")
  for _ = 1, 8 do mid.drain() end
  mid.s.clock = mid.s.clock + 30; mid.s.onTaxi = false; mid.s.mapPos = { [1415] = { 0.42, 0.40 } }; mid.event("PLAYER_CONTROL_GAINED")
  assert(#ofType(mid, "flight") == 1 and ofType(mid, "flight")[1].sec == 60, dump(ofType(mid, "flight")))
  -- the position could not be read at landing: the next taxi window within 2 minutes decides
  local function unread(nextNode, after)
    local u = airfield(); fly(u, 2, 100, false)
    assert(#ofType(u, "flight") == 0, "not yet")
    u.s.clock = u.s.clock + after
    for _, n in ipairs(u.s.taxi.nodes) do
      if n.nodeID == nextNode then n.type = "CURRENT" elseif n.type == "CURRENT" then n.type = "REACHABLE" end
    end
    u.event("TAXIMAP_OPENED")
    return ofType(u, "flight")
  end
  assert(#unread(4, 30) == 1 and unread(4, 30)[1].to == 4 and unread(4, 30)[1].sec == 100, "the next window is at the destination")
  assert(#unread(5, 30) == 0, "the next window is somewhere else")
  local lt = airfield(); fly(lt, 2, 100, false)
  local landedAt = lt.s.now
  lt.s.clock, lt.s.now = lt.s.clock + 90, lt.s.now + 90
  for _, n in ipairs(lt.s.taxi.nodes) do if n.nodeID == 4 then n.type = "CURRENT" elseif n.type == "CURRENT" then n.type = "REACHABLE" end end
  lt.event("TAXIMAP_OPENED")
  assert(#ofType(lt, "flight") == 1 and ofType(lt, "flight")[1].t == landedAt, "t is when it landed: " .. dump(ofType(lt, "flight")))
  -- a node picked in a window we could not read never flies on an older window's pick
  local stale = airfield()
  stale.event("TAXIMAP_OPENED"); stale.hooks.TakeTaxiNode(2); stale.event("TAXIMAP_CLOSED")
  stale.s.taxi.nodes[3].slotName = "Somewhere Else"; stale.event("TAXIMAP_OPENED"); stale.hooks.TakeTaxiNode(3); stale.event("TAXIMAP_CLOSED")
  stale.s.onTaxi = true; stale.event("PLAYER_CONTROL_LOST"); stale.s.clock = stale.s.clock + 95
  stale.s.onTaxi = false; stale.s.mapPos = { [1415] = { 0.42, 0.40 } }; stale.event("PLAYER_CONTROL_GAINED"); stale.drain()
  assert(#ofType(stale, "flight") == 0, "an older pick: " .. dump(ofType(stale, "flight")))
  assert(#unread(4, 121) == 0, "the next window came too late")
  -- never: landing by another node or far from any, the flight master's own node, no destination picked, a pick too long
  -- before, UnitOnTaxi never true, a secret or no answer at landing, under 5 s, over an hour, switched off on the way, a
  -- window not read (names disagree), not a creature
  local SECRET = {}
  local function never(setup, slot, sec, landAt, opts)
    local x = airfield(opts)
    if setup then setup(x) end
    fly(x, slot or 2, sec or 95, landAt or { 0.42, 0.40 })
    for _ = 1, 12 do x.drain() end
    assert(#ofType(x, "flight") == 0 and not x.db().lastError, "no flight: " .. dump(ofType(x, "flight")) .. tostring(x.db().lastError))
  end
  never(nil, 2, 95, { 0.45, 0.79 })
  never(nil, 2, 95, { 0.30, 0.40 })
  never(nil, 1)
  never(function(x) x.hooks.TakeTaxiNode = function() end end)
  never(function(x) local take = x.hooks.TakeTaxiNode; x.hooks.TakeTaxiNode = function(s) take(s); x.s.clock = x.s.clock + 11 end end)
  never(function(x) x.G.UnitOnTaxi = function() return false end end)
  never(function(x) x.G.UnitOnTaxi = function() if x.s.onTaxi then return true end; return SECRET end end, nil, nil, nil,
        { globals = { issecretvalue = function(v) return v == SECRET end } })
  never(function(x) x.G.UnitOnTaxi = function() if x.s.onTaxi then return true end end end)
  never(nil, 2, 4)
  never(nil, 2, 3601)
  never(function(x) local take = x.hooks.TakeTaxiNode; x.hooks.TakeTaxiNode = function(s) take(s); x.cmd("track drops off") end end)
  never(function(x) x.s.taxi.nodes[2].slotName = "Somewhere Else" end)
  never(function(x) x.s.units.npc = { guid = PLAYER } end)
  -- a window not recorded again (the same list this week) still times the flight
  local w = airfield(); w.event("TAXIMAP_OPENED"); w.event("TAXIMAP_CLOSED"); fly(w, 2, 95, { 0.42, 0.40 })
  assert(#ofType(w, "taxi") == 1 and #ofType(w, "flight") == 1, "the flight from a window seen this week")
  local all = dump(h.db().events)
  assert(not all:find("Creature%-") and not all:find("0%.42") and not all:find("0%.40"), "no GUID and no landing position")
  print("OK   flights: boarding to landing by the chosen node in whole seconds; both ends known or nothing; once per from/to in 30 days")
end

-- 8) never money or other players, anywhere in the saved table; the only names are this character's own, in who, and
-- creatures' own names in the npcs summary
do
  local h = fresh(); h.on()
  h.s.units.target = { guid = MOB, dead = true, level = 60, name = "Example Mob" }
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
                       "ENCOUNTER_END", "START_LOOT_ROLL", "CHAT_MSG_LOOT", "TRAINER_SHOW", "TRAINER_UPDATE", "TRAINER_CLOSED",
                       "TAXIMAP_OPENED", "TAXIMAP_CLOSED", "PLAYER_CONTROL_LOST", "PLAYER_CONTROL_GAINED",
                       "PLAYER_TARGET_CHANGED", "UPDATE_MOUSEOVER_UNIT", "PLAYER_INTERACTION_MANAGER_FRAME_SHOW", "CONFIRM_BINDER",
                       "HEARTHSTONE_BOUND", "PLAYER_REGEN_DISABLED" }) do
    h.event(e, 1, 2, 3)
  end
  h.drain()
  assert(not h.db().lastError, tostring(h.db().lastError))
  local loot = {}
  for _, e in ipairs(h.events()) do if e.type == "loot" then loot[#loot + 1] = e end; assert(not e.b and not next(e.who), dump(e)) end
  assert(#loot == 1 and #loot[1].items == 0 and loot[1].src.kind == "other", dump(loot))
  assert(next(h.db().npcs) == nil, "no npc without the unit APIs: " .. dump(h.db().npcs))
  print("OK   a client without the loot / quest / merchant / trainer / map / unit APIs raises no error")
end

-- 12) npcs: a per-install summary of the creatures the player looks at; no GUID, no player name, no time finer than a day
do
  local WOLF = "Creature-0-4170-0-1234-525-000012AB01"
  local TAILOR = "Creature-0-4170-0-1234-1346-000012AB02"
  local DAY = math.floor(1767225600 / 86400)
  local function wolf(patch)
    local u = { guid = WOLF, level = 12, class = "normal", ct = 1, ctName = "Beast", fam = 1, famName = "Wolf", rx = 2, speed = 2.0,
                name = "Mangy Wolf", tip = { "Mangy Wolf", "Level 12 Beast" } }
    for k, v in pairs(patch or {}) do u[k] = v end
    return u
  end
  local function npcs(h) return h.db().npcs end
  local tipGlobals = { TOOLTIP_UNIT_LEVEL_TYPE = "Level %s %s", UNITNAME_TITLE_PET = "%s's Pet", LEVEL = "Level" }

  -- target: level range, classification, type, family, reaction per side, day; no cells from afar; no subtitle line
  local h = fresh({ globals = tipGlobals }); h.on()
  assert(h.registered.PLAYER_TARGET_CHANGED and h.registered.UPDATE_MOUSEOVER_UNIT, "npc events registered")
  h.s.units.target = wolf()
  h.event("PLAYER_TARGET_CHANGED")
  local n = npcs(h)[525]
  assert(dump(n) == "{cls=normal,ct=1,day=" .. DAY .. ",fam=1,lv={1=12,2=12},name=Mangy Wolf,rxA=2,spd=200,spds={200=1}}", dump(n))
  assert(h.db().prefix and h.db().prefix:match("^[0-9a-z]+$"), "the install prefix exists for the export")
  -- the same npc within 30 s: nothing is read (not even whether a player controls it); after 30 s the level range grows
  h.s.units.mouseover = wolf({ level = 13 })
  local pc = h.s.calls.UnitPlayerControlled
  h.s.clock = h.s.clock + 10; h.event("UPDATE_MOUSEOVER_UNIT")
  assert(dump(n.lv) == "{1=12,2=12}" and h.s.calls.UnitPlayerControlled == pc, "throttled: " .. dump(n.lv))
  h.s.clock = h.s.clock + 21; h.event("UPDATE_MOUSEOVER_UNIT")
  assert(dump(n.lv) == "{1=12,2=13}" and h.s.calls.GetUnit == 1, "after 30 s, the tooltip asked once a session: " .. dump(n.lv))
  -- near within the 30 s: a first time near gets through and counts its 1% map square; again within 10 minutes it does not
  h.s.units.target = wolf({ near = true }); h.s.clock = h.s.clock + 1; h.event("PLAYER_TARGET_CHANGED")
  assert(dump(n.cells) == "{1429:41:65=1}", "near: " .. dump(n.cells))
  h.s.clock = h.s.clock + 31; h.event("PLAYER_TARGET_CHANGED")
  assert(dump(n.cells) == "{1429:41:65=1}", "the same square within 10 minutes: " .. dump(n.cells))
  h.s.clock = h.s.clock + 600; h.event("PLAYER_TARGET_CHANGED")
  h.s.x = 0.999; h.s.clock = h.s.clock + 31; h.event("PLAYER_TARGET_CHANGED")
  assert(dump(n.cells) == "{1429:41:65=2,1429:99:65=1}", "counts per square, clamped to 99: " .. dump(n.cells))
  -- at most 40 squares: the least counted goes
  for i = 1, 45 do h.s.x = i / 100; h.s.y = 0.1; h.s.clock = h.s.clock + 31; h.event("PLAYER_TARGET_CHANGED") end
  local k = 0; for _ in pairs(n.cells) do k = k + 1 end
  assert(k == 40 and n.cells["1429:41:65"] == 2, "40 squares, the most counted kept: " .. k)
  -- attack speed: only a live beast out of combat; the value seen most often (a tie keeps the first); 4 values counted
  local sp = fresh(); sp.on()
  local function aim(patch) sp.s.units.target = wolf(patch); sp.s.clock = sp.s.clock + 31; sp.event("PLAYER_TARGET_CHANGED") end
  aim({})
  local m = sp.db().npcs[525]
  for _ = 1, 3 do aim({ speed = 1.5, combat = true }); aim({ speed = 1.5, dead = true }) end
  assert(m.spd == 200 and dump(m.spds) == "{200=1}", "not in combat, not dead: " .. dump(m.spds))
  aim({ speed = 1.5 })
  assert(m.spd == 200, "a tie keeps the first")
  aim({ speed = 1.5 })
  assert(m.spd == 150 and dump(m.spds) == "{150=2,200=1}", "seen most often: " .. dump(m.spds))
  for _, x in ipairs({ 1.1, 1.2, 1.3, 1.4, 1.6, 1.7 }) do aim({ speed = x }) end
  k = 0; for _ in pairs(m.spds) do k = k + 1 end
  assert(k <= 4 and m.spds[150] == 2 and m.spd == 150, "at most 4 values counted, the chosen one kept: " .. dump(m.spds))
  -- a new day; Horde sees its own reaction
  h.s.now = h.s.now + 86400; h.s.faction = "Horde"; h.s.units.target = wolf({ rx = 4 }); h.s.clock = h.s.clock + 31; h.event("PLAYER_TARGET_CHANGED")
  assert(n.day == DAY + 1 and n.rxA == 2 and n.rxH == 4, dump(n))
  print("OK   npcs: level range, classification, type, family, reaction per side, day; 30 s throttle; cells only when near, 10 min, 40 max; beast speed")

  -- the reaction only from a live creature out of combat: a neutral mob reads hostile once fought, and so does its corpse
  do
    local rr = fresh(); rr.on()
    local function seen(patch) rr.s.units.target = wolf(patch); rr.s.clock = rr.s.clock + 31; rr.event("PLAYER_TARGET_CHANGED") end
    seen({ rx = 1, combat = true })
    assert(rr.db().npcs[525] and rr.db().npcs[525].rxA == nil, "in combat: no reaction " .. dump(rr.db().npcs[525]))
    seen({ rx = 1, dead = true })
    assert(rr.db().npcs[525].rxA == nil, "dead: no reaction " .. dump(rr.db().npcs[525]))
    seen({ rx = 4 }); seen({ rx = 1, combat = true }); seen({ rx = 1, dead = true })
    assert(rr.db().npcs[525].rxA == 4, "dead or in combat never overwrites it: " .. dump(rr.db().npcs[525]))
    local lc = fresh(); lc.on(); lc.s.units.target = wolf({ dead = true, rx = 1 })
    lc.loot({ item(2589, 1, { WOLF, 1 }) })
    assert(lc.db().npcs[525] and lc.db().npcs[525].rxA == nil, "a loot corpse gives no reaction: " .. dump(lc.db().npcs[525]))
  end
  print("OK   npcs: the reaction only from a live creature out of combat (never from a fight or a corpse)")

  -- the subtitle: only when line 1 is the name, line 3 the level line and line 2 not; once a session per npc
  local function sub(tip, patch, globals)
    local g = fresh({ globals = globals or tipGlobals }); g.on()
    local u = { guid = TAILOR, level = 30, ct = 7, ctName = "Humanoid", rx = 5, name = "Example Tailor", tip = tip }
    for key, v in pairs(patch or {}) do u[key] = v end
    g.s.units.target = u; g.event("PLAYER_TARGET_CHANGED")
    return g.db().npcs[1346], g
  end
  assert(sub({ "Example Tailor", "Journeyman Tailor", "Level 30 Humanoid" }).sub == "Journeyman Tailor", "a subtitle")
  assert(sub({ "Example Tailor", "<Banker>", "Level 30 Humanoid", "Stormwind" }).sub == "Banker", "brackets come off")
  assert(sub({ "Example Tailor", "Journeyman Tailor", "Level 30 Humanoid" }, nil, { LEVEL = "Level" }).sub == "Journeyman Tailor",
         "no level formats: the LEVEL word")
  for _, tip in ipairs({ { "Example Tailor", "Level 30 Humanoid", "Stormwind" }, { "Someone", "Journeyman Tailor", "Level 30 Humanoid" },
                         { "Example Tailor", "Journeyman Tailor", "Stormwind" }, { "Example Tailor", "Journeyman Tailor" },
                         { "Example Tailor", "Tester's Pet", "Level 30 Humanoid" }, { "Example Tailor", "Friend of Tester", "Level 30 Humanoid" },
                         { "Example Tailor", "|cffff0000Red|r", "Level 30 Humanoid" }, { "Example Tailor", string.rep("x", 81), "Level 30 Humanoid" },
                         { "Example Tailor", "Creature-0-1-2", "Level 30 Humanoid" } }) do
    local e = sub(tip)
    assert(e and e.sub == nil, "no subtitle from " .. table.concat(tip, " / ") .. ": " .. dump(e))
  end
  local e, g = sub({ "Example Tailor", "Level 30 Humanoid" })
  g.s.units.target.tip = { "Example Tailor", "Journeyman Tailor", "Level 30 Humanoid" }
  g.s.clock = g.s.clock + 31; g.event("PLAYER_TARGET_CHANGED")
  assert(e.sub == nil and g.s.calls.GetUnit == 1, "none is remembered for the session: the tooltip is read once")
  local r = fresh({ db = g.db(), globals = tipGlobals }); r.s.units.target = g.s.units.target; r.event("PLAYER_TARGET_CHANGED")
  assert(r.db().npcs[1346].sub == "Journeyman Tailor", "asked again in the next session")
  r.s.clock = r.s.clock + 31; r.event("PLAYER_TARGET_CHANGED")
  assert(r.s.calls.GetUnit == 1, "a kept subtitle is never asked again")
  local nt = fresh({ noTooltip = true }); nt.on(); nt.s.units.target = { guid = TAILOR, level = 30, name = "Example Tailor" }
  nt.event("PLAYER_TARGET_CHANGED")
  assert(nt.db().npcs[1346] and nt.db().npcs[1346].sub == nil and not nt.db().lastError, "no tooltip API: no subtitle")
  -- not while the player fights; a secret line is not remembered as none, so it is asked again later
  do
    local SECRET = {}
    local tg = { issecretvalue = function(v) return v == SECRET end }
    for key, v in pairs(tipGlobals) do tg[key] = v end
    local g2 = fresh({ globals = tg }); g2.on()
    g2.s.units.player = { combat = true }
    g2.s.units.target = { guid = TAILOR, level = 30, ct = 7, rx = 5, name = "Example Tailor", tip = { "Example Tailor", SECRET, "Level 30 Humanoid" } }
    g2.event("PLAYER_TARGET_CHANGED")
    assert(g2.s.calls.GetUnit == 0 and g2.db().npcs[1346] and g2.db().npcs[1346].sub == nil, "no tooltip while the player fights")
    g2.s.units.player = nil; g2.s.clock = g2.s.clock + 31; g2.event("PLAYER_TARGET_CHANGED")
    assert(g2.s.calls.GetUnit == 1 and g2.db().npcs[1346].sub == nil, "a secret line: no subtitle")
    g2.s.units.target.tip = { "Example Tailor", "Journeyman Tailor", "Level 30 Humanoid" }
    g2.s.clock = g2.s.clock + 31; g2.event("PLAYER_TARGET_CHANGED")
    assert(g2.s.calls.GetUnit == 2 and g2.db().npcs[1346].sub == "Journeyman Tailor", "asked again after a secret: " .. dump(g2.db().npcs[1346]))
  end
  print("OK   npcs: no tooltip read while the player fights; a secret tooltip is asked again later")

  -- the name: as last seen, under the subtitle's rules; never the client's "Unknown" for a unit not loaded yet
  do
    local function named(name, globals)
      local g3 = fresh({ globals = globals or tipGlobals }); g3.on()
      g3.s.units.target = { guid = TAILOR, level = 30, ct = 7, name = name, tip = false }
      g3.event("PLAYER_TARGET_CHANGED")
      return g3.db().npcs[1346], g3
    end
    local e3, g3 = named("Example Tailor")
    assert(e3.name == "Example Tailor", "the name: " .. dump(e3))
    g3.s.units.target.name = "Example Tailor the Second"; g3.s.clock = g3.s.clock + 31; g3.event("PLAYER_TARGET_CHANGED")
    assert(e3.name == "Example Tailor the Second", "kept as last seen: " .. dump(e3))
    g3.s.units.target.name = "|cffff0000Red|r"; g3.s.clock = g3.s.clock + 31; g3.event("PLAYER_TARGET_CHANGED")
    assert(e3.name == "Example Tailor the Second", "a refused name keeps the last good one: " .. dump(e3))
    for _, bad in ipairs({ "Unknown", "Tester Junior", "Someone's Minion", "|cffff0000Red|r", "Creature-0-1-2", string.rep("x", 81), "" }) do
      local e4 = named(bad)
      assert(e4 and e4.name == nil, "no name from " .. bad .. ": " .. dump(e4))
    end
    local g5 = { UNKNOWNOBJECT = "Inconnu" }; for key, v in pairs(tipGlobals) do g5[key] = v end
    assert(named("Inconnu", g5).name == nil and named("Unknown", g5).name == "Unknown", "the client's own UNKNOWNOBJECT")
    local g6 = { UNITNAME_TITLE_MINION = "Minion of %s" }
    assert(named("Minion of Someone", g6).name == nil, "never an owner title from the client's formats")
  end
  print("OK   npcs: the name as last seen, never a player's, an owner title, markup, a GUID or the client's Unknown")
  print("OK   npcs: a subtitle only when the tooltip's lines prove it (never owner titles, own name, markup, GUIDs); asked once a session")

  -- never: players, player-controlled units (pets, guardians, totems), companions, pets' GUIDs, objects, instances,
  -- secrets, a client that cannot say who controls it, or while off; and no extra API call for a player
  local function none(patch, opts, setup)
    local g = fresh(opts); g.on()
    local u = wolf(); for key, v in pairs(patch or {}) do u[key] = v end
    g.s.units.target = u
    if setup then setup(g) end
    g.event("PLAYER_TARGET_CHANGED"); g.event("UPDATE_MOUSEOVER_UNIT")
    assert(next(g.db().npcs) == nil and not g.db().lastError, "nothing: " .. dump(g.db().npcs) .. " " .. tostring(g.db().lastError))
    return g
  end
  local p = none({ player = true, guid = PLAYER })
  assert(p.s.calls.UnitPlayerControlled == 0 and p.s.calls.CheckInteractDistance == 0, "a player leaves at once")
  none({ controlled = true }); none({ ct = 12, ctName = "Non-combat Pet" }); none({ guid = "Pet-0-4170-0-1234-525-000012AB01" })
  none({ guid = NODE }); none({}, { noControlled = true })
  none({}, nil, function(g) g.s.itype, g.s.iid = "party", 36 end)
  none({}, nil, function(g) g.s.x, g.s.y = 0, 0 end)
  none({}, nil, function(g) g.cmd("track drops off") end)
  local SECRET = {}
  local secret = { issecretvalue = function(v) return v == SECRET end }
  none({ guid = SECRET }, { globals = secret }); none({ player = SECRET }, { globals = secret }); none({ controlled = SECRET }, { globals = secret })
  -- secret details are left out, the rest is kept
  local q = fresh({ globals = secret }); q.on()
  q.s.units.target = wolf({ level = SECRET, class = SECRET, rx = SECRET, near = SECRET, ct = SECRET, ctName = SECRET, speed = SECRET })
  q.event("PLAYER_TARGET_CHANGED")
  assert(dump(q.db().npcs[525]) == "{day=" .. DAY .. ",fam=1,name=Mangy Wolf}", "secrets left out: " .. dump(q.db().npcs[525]))
  local qn = fresh({ globals = secret }); qn.on(); qn.s.units.target = wolf({ name = SECRET }); qn.event("PLAYER_TARGET_CHANGED")
  assert(qn.db().npcs[525] and qn.db().npcs[525].name == nil, "a secret name is left out: " .. dump(qn.db().npcs[525]))
  print("OK   npcs: never players, pets, guardians, totems, companions, objects, inside instances, secrets or while off; players leave at once")

  -- a skull: boss only for a world boss or when the player is at the level cap; else nothing about the level
  local function skull(patch, max)
    local g = fresh(); g.on(); g.s.maxLevel = max
    g.s.units.target = wolf(patch); g.event("PLAYER_TARGET_CHANGED")
    return g.db().npcs[525]
  end
  local b = skull({ level = -1, class = "worldboss" }, 70)
  assert(b.boss == true and b.lv == nil and b.cls == "worldboss", dump(b))
  assert(skull({ level = -1, class = "elite" }, 60).boss == true, "at the level cap a skull is a boss")
  b = skull({ level = -1, class = "elite" }, 70)
  assert(b.boss == nil and b.lv == nil, "a skull seen from below is not kept: " .. dump(b))
  assert(skull({ class = "sideways" }).cls == nil, "classification only from the list")
  print("OK   npcs: a skull is a boss for a world boss or at the level cap, else no level")

  -- interaction windows count as near (the player stands there), loot corpses only when near; the throttle holds
  local v = fresh(); v.on()
  v.s.units.npc = { guid = TAILOR, level = 30, ct = 7, name = "Example Tailor" }
  v.s.merchant = { { id = 4470, n = 1, price = 38, avail = -1 } }
  v.event("MERCHANT_SHOW"); v.drain()
  assert(dump(v.db().npcs[1346].cells) == "{1429:41:65=1}" and #v.events() == 1, "a vendor: " .. dump(v.db().npcs[1346]))
  local qg = fresh(); qg.on(); qg.s.units.questnpc = { guid = TAILOR, level = 30 }; qg.s.quest = 7787; qg.event("QUEST_DETAIL")
  assert(qg.db().npcs[1346].cells, "a quest giver")
  local tr = fresh(); tr.on(); tr.s.units.npc = { guid = "Creature-0-4170-0-1234-5146-000012AAAD", level = 40 }
  tr.s.trainer.rows = { { name = "Frostbolt", st = "available", cost = 1 } }
  tr.event("TRAINER_SHOW"); tr.drain()
  assert(tr.db().npcs[5146].cells and dump(tr.db().npcs[5146].lv) == "{1=40,2=40}", "a trainer")
  local lt = fresh(); lt.on(); lt.s.units.target = wolf({ dead = true })
  lt.loot({ item(2589, 1, { WOLF, 1 }) })
  assert(lt.db().npcs[525] and not lt.db().npcs[525].cells and lt.db().npcs[525].spds == nil, "a corpse from afar: no cell, no speed")
  print("OK   npcs: vendor, quest and trainer windows count as near; a loot corpse is seen too")

  -- svc: the services an npc was seen to offer, a set; each window is a near sighting; within the 30 s only the flags
  local function svc(n) local out = {}; for k in pairs(n and n.svc or {}) do out[#out + 1] = k end; table.sort(out); return table.concat(out, ",") end
  local sv = fresh(); sv.on()
  sv.s.units.npc = { guid = TAILOR, level = 30, name = "Example Tailor" }
  sv.s.merchant = { { id = 4470, n = 1, price = 38, avail = -1 } }; sv.s.canRepair = true
  sv.event("PLAYER_INTERACTION_MANAGER_FRAME_SHOW", 5); sv.event("MERCHANT_SHOW"); sv.drain()
  assert(svc(npcs(sv)[1346]) == "repair,vendor" and npcs(sv)[1346].cells, "a vendor that repairs: " .. dump(npcs(sv)[1346]))
  sv.s.clock = sv.s.clock + 5; sv.event("PLAYER_INTERACTION_MANAGER_FRAME_SHOW", 8)
  sv.s.clock = sv.s.clock + 5; sv.event("CONFIRM_BINDER")
  assert(svc(npcs(sv)[1346]) == "bank,inn,repair,vendor", "within the 30 s the flags still land: " .. dump(npcs(sv)[1346]))
  assert(dump(npcs(sv)[1346].cells) == "{1429:41:65=1}", "but no second count: " .. dump(npcs(sv)[1346]))
  sv.s.units.npc.controlled = true; sv.s.clock = sv.s.clock + 5; sv.event("PLAYER_INTERACTION_MANAGER_FRAME_SHOW", 21)
  assert(svc(npcs(sv)[1346]) == "bank,inn,repair,vendor", "a player-controlled unit of the same id adds nothing")
  sv.s.units.npc.controlled = nil
  -- repair only from the merchant window itself: when the interaction shows, CanMerchantRepair may still answer for the
  -- last merchant (here a vendor that repairs, then one that does not)
  local rp = fresh(); rp.on()
  rp.s.units.npc = { guid = TAILOR, level = 30 }; rp.s.merchant = { { id = 4470, n = 1, price = 38, avail = -1 } }; rp.s.canRepair = true
  rp.event("PLAYER_INTERACTION_MANAGER_FRAME_SHOW", 5); rp.event("MERCHANT_SHOW"); rp.drain(); rp.event("MERCHANT_CLOSED")
  rp.s.units.npc = { guid = "Creature-0-4170-0-1234-1347-000012AB03", level = 30 }
  rp.event("PLAYER_INTERACTION_MANAGER_FRAME_SHOW", 5)
  rp.s.canRepair = false; rp.event("MERCHANT_SHOW"); rp.drain()
  assert(svc(npcs(rp)[1346]) == "repair,vendor" and svc(npcs(rp)[1347]) == "vendor", "a stale answer: " .. dump(rp.db().npcs))
  -- the flags alone may cross the ~500 KB cap: they prune like a full sighting (fillers sized so the window lands just under)
  local function capped(pad)
    local db = { v = 1, on = true, agreed = true, noted = true, prefix = "abcd12", n = 0, events = {}, npcs = {} }
    for i = 1, 9 do db.npcs[2000 + i] = { day = DAY - 1, name = string.rep("n", 50000) } end
    db.npcs[2010] = { day = DAY - 1, name = string.rep("n", pad) }
    local x = fresh({ db = db }); x.s.units.npc = { guid = TAILOR, level = 30 }
    x.event("PLAYER_INTERACTION_MANAGER_FRAME_SHOW", 8)
    local n = 0; for _ in pairs(x.db().npcs) do n = n + 1 end
    return x, n
  end
  local lo, hi = 0, 60000                        -- the largest filler that still leaves all 11 after the window
  while lo < hi do local mid = math.ceil((lo + hi) / 2); local _, n = capped(mid); if n == 11 then lo = mid else hi = mid - 1 end end
  local cx, before = capped(lo)
  assert(before == 11 and svc(npcs(cx)[1346]) == "bank", "calibrated just under the cap: " .. before)
  cx.s.clock = cx.s.clock + 5; cx.event("CONFIRM_BINDER")
  local after = 0; for _ in pairs(cx.db().npcs) do after = after + 1 end
  assert(after < 11 and svc(npcs(cx)[1346]) == "bank,inn", "the flags pushed it over: pruned to " .. after)
  -- every interaction type by its Enum name; the reload keeps the set; a vendor that cannot repair is only a vendor
  local kinds = { [6] = "flight", [7] = "trainer", [8] = "bank", [11] = "guild", [13] = "guild", [14] = "tabard", [18] = "spirit",
                  [20] = "inn", [21] = "auction", [22] = "stable", [23] = "battlemaster", [5] = "vendor" }
  for kind, want in pairs(kinds) do
    local k = fresh(); k.on(); k.s.units.npc = { guid = TAILOR, level = 30 }; k.s.canRepair = false
    k.event("PLAYER_INTERACTION_MANAGER_FRAME_SHOW", kind)
    assert(svc(npcs(k)[1346]) == want and npcs(k)[1346].cells, kind .. ": " .. dump(npcs(k)[1346]))
  end
  local r = fresh({ db = sv.db() }); r.on(); r.s.units.npc = { guid = TAILOR, level = 30 }
  r.event("HEARTHSTONE_BOUND"); r.s.clock = r.s.clock + 40; r.event("PLAYER_INTERACTION_MANAGER_FRAME_SHOW", 22)
  assert(svc(npcs(r)[1346]) == "bank,inn,repair,stable,vendor", "kept across a reload: " .. dump(npcs(r)[1346]))
  -- the trainer and flight master windows flag themselves
  local t2 = fresh(); t2.on(); t2.s.units.npc = { guid = TAILOR, level = 30 }
  t2.s.trainer.rows = { { name = "Frostbolt", st = "available", cost = 1 } }; t2.event("TRAINER_SHOW"); t2.drain()
  t2.s.taxi.nodes = { { nodeID = 2, name = "A", slotIndex = 1, type = "CURRENT", cost = 0 } }
  t2.s.clock = t2.s.clock + 40; t2.event("TAXIMAP_OPENED")
  assert(svc(npcs(t2)[1346]) == "flight,trainer", dump(npcs(t2)[1346]))
  -- a saved svc that is not a set is replaced; junk names in it are not exported (see convert.test.js)
  local j = fresh({ db = { v = 1, on = true, agreed = true, noted = true, prefix = "abcd12", n = 0, events = {},
                           npcs = { [1346] = { day = DAY, svc = "vendor" } } } })
  j.s.units.npc = { guid = TAILOR, level = 30 }; j.event("PLAYER_INTERACTION_MANAGER_FRAME_SHOW", 8)
  assert(svc(npcs(j)[1346]) == "bank" and not j.db().lastError, dump(npcs(j)[1346]))
  -- nothing: a mailbox or other object, a type with no service, an unknown number, no Enum, no npc unit, a player, a pet,
  -- inside an instance, while off; a gossip window is no service and its text is never read
  local function nothing(setup, kind, ev)
    local x = fresh(); x.on(); x.s.units.npc = { guid = TAILOR, level = 30 }
    setup(x)
    x.event(ev or "PLAYER_INTERACTION_MANAGER_FRAME_SHOW", kind)
    local n = (x.db().npcs or {})[1346]
    assert(not (n and n.svc) and not x.db().lastError, "no service: " .. dump(x.db().npcs) .. tostring(x.db().lastError))
    return x
  end
  local mail = nothing(function(x) x.s.units.npc = { guid = "GameObject-0-4170-0-1234-143983-0000AAAA02" } end, 17)
  assert(next(mail.db().npcs) == nil, "an object is never an npc")
  nothing(function(x) x.s.units.npc = { guid = "GameObject-0-4170-0-1234-187293-0000AAAA03" } end, 10)
  nothing(function() end, 24)
  nothing(function() end, 3)
  nothing(function() end, 99)
  nothing(function() end, "5")
  nothing(function(x) x.G.Enum.PlayerInteractionType = nil end, 5)
  nothing(function(x) x.s.units.npc = nil end, 5)
  nothing(function(x) x.s.units.npc = { guid = PLAYER, player = true } end, 5)
  nothing(function(x) x.s.units.npc.controlled = true end, 5)
  nothing(function(x) x.s.itype, x.s.iid = "party", 36 end, 5)
  nothing(function(x) x.cmd("track drops off") end, 5)
  nothing(function(x) x.s.units.npc = nil end, nil, "HEARTHSTONE_BOUND")
  nothing(function(x) x.cmd("track drops off") end, nil, "CONFIRM_BINDER")
  nothing(function(x) x.G.CanMerchantRepair = function() return true end end, nil, "GOSSIP_SHOW")
  print("OK   npcs: svc, the services each npc was seen to offer, from interaction windows, repair, inn binding; never objects or players")

  -- privacy: no GUID, no name, no time finer than a day; /kinv track reports how many are held
  local all = dump(h.db().npcs)
  assert(not all:find("Creature") and not all:find("Tester") and not all:find(tostring(h.s.now))
         and not all:find("=" .. tostring(h.s.clock)), all)
  for _, entry in pairs(h.db().npcs) do
    for key in pairs(entry) do assert(("name lv boss cls ct fam rxA rxH sub spd spds day cells"):find("%f[%w]" .. key .. "%f[%W]"), key) end
  end
  h.cmd("track"); assert(h.last():find("1 NPC held"), h.last())
  print("OK   npcs: no GUID, no player name, no time finer than a day; /kinv track says how many are held")

  -- caps: 3000 npcs (the least recently seen go first, down to 2700), ~500 KB; junk dropped on load
  local c = fresh(); c.on()
  for i = 1, 3001 do
    if i == 101 then c.s.now = c.s.now + 86400 end
    c.s.units.target = wolf({ guid = "Creature-0-4170-0-1234-" .. (10000 + i) .. "-000012AB01", tip = false })
    c.event("PLAYER_TARGET_CHANGED")
  end
  local count, old = 0, 0
  for id, entry in pairs(c.db().npcs) do count = count + 1; if id <= 10100 then old = old + 1 end end
  assert(count == 2700 and old == 0, "3000 cap: " .. count .. " kept, " .. old .. " of the oldest day")
  c.cmd("track"); assert(c.last():find("2700 NPCs held"), c.last())
  c.s.units.target = wolf({ guid = "Creature-0-4170-0-1234-10001-000012AB01", tip = false }); c.event("PLAYER_TARGET_CHANGED")
  assert(c.db().npcs[10001], "a pruned npc leaves the session tables too: seen again at once, it is kept again")
  local big = { v = 1, on = true, agreed = true, prefix = "abc123", events = {}, npcs = { [1] = "junk", ["x"] = {} } }
  for i = 1, 800 do
    local cells = {}
    for j = 1, 40 do cells["1429:" .. j .. ":" .. (i % 100)] = j end
    big.npcs[1000 + i] = { lv = { 10, 12 }, cls = "normal", ct = 7, sub = "Journeyman Leatherworker", day = DAY - (i % 7), cells = cells }
  end
  local bl = fresh({ db = big })
  local left = 0; for _ in pairs(bl.db().npcs) do left = left + 1 end
  assert(left < 800 and left > 400 and bl.db().npcs[1] == nil and bl.db().npcs.x == nil, "~500 KB on load, junk gone: " .. left)
  print("OK   npcs: at most 3000 (least recently seen first) and ~500 KB; junk entries dropped on load")

  -- 180 days: an entry not seen for longer (or with no day) is dropped on load
  do
    local aged = fresh({ db = { v = 1, on = true, agreed = true, prefix = "abc123", events = {},
                                npcs = { [1] = { day = DAY - 181 }, [2] = { day = DAY - 180 }, [3] = { lv = { 1, 1 } } } } })
    local a = aged.db().npcs
    assert(a[1] == nil and a[2] and a[3] == nil, "not seen for 180 days, or no day: dropped on load " .. dump(a))
  end
  print("OK   npcs: not seen for 180 days: dropped on load")

  -- the session tables stay small: past 4000 npcs they are trimmed (the ones not updated for 10 minutes, else all)
  do
    local st = fresh(); st.on()
    local x0, y0 = st.s.x, st.s.y
    local function look(i)
      st.s.units.target = wolf({ guid = "Creature-0-4170-0-1234-" .. (20000 + i) .. "-000012AB01", tip = false })
      st.event("PLAYER_TARGET_CHANGED")
    end
    st.s.x, st.s.y = 0, 0                          -- no position: nothing kept, but each npc waits its 30 s
    for i = 1, 4000 do look(i) end
    st.s.x, st.s.y = x0, y0; look(1)
    assert(st.db().npcs[20001] == nil, "4000 npcs held in the session: the first still waits its 30 s")
    st.s.x, st.s.y = 0, 0; look(4001)
    st.s.x, st.s.y = x0, y0; look(1)
    assert(st.db().npcs[20001], "the 4001st trims the session tables")
    st.s.clock = st.s.clock + 600
    st.s.x, st.s.y = 0, 0; for i = 4002, 8000 do look(i) end   -- the limit again: only those not updated for 10 minutes go
    st.s.x, st.s.y = x0, y0; look(4001); look(8000)
    assert(st.db().npcs[24001] and st.db().npcs[28000] == nil, "an old npc is forgotten, a recent one keeps its 30 s wait")
  end
  print("OK   npcs: the session tables are trimmed past 4000 npcs")
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
