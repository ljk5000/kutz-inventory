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
const bagSource = source.replace("local READ_BAG_ITEMS = false", "local READ_BAG_ITEMS = true");
const commonWords = fs.readFileSync(path.join(addonDir, "CommonWords.lua"), "utf8");
const factsSource = fs.readFileSync(path.join(addonDir, "Facts.lua"), "utf8");
if (bagSource === source) throw new Error("Could not enable the bag-page path for the fake game");

const code = `
local words = {}
assert(load([=====[${commonWords}]=====], "@CommonWords.lua"))("KutzInventory", words)

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
    G.IsInGroup = function() return false end
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
  local observationSource = opts.readBag and [=====[${bagSource}]=====] or [=====[${source}]=====]
  local chunk = assert(load(observationSource, "@Observations.lua", "t", G))
  local ns = { CommonWords = words.CommonWords }
  chunk("KutzInventory", ns)
  local h = { ns = ns, G = G, s = s, printed = printed, registered = registered, hooks = hooks, popups = popups }
  function h.event(name, ...) frames[1].scripts.OnEvent(frames[1], name, ...) end
  function h.drain() local b = timers; timers = {}; for _, fn in ipairs(b) do fn() end end
  function h.cmd(m) return ns.ObsCommand(m) end
  function h.db() return G.KutzInventoryObsDB end
  function h.events() return (G.KutzInventoryObsDB or {}).events or {} end
  function h.last() return printed[#printed] or "" end
  function h.on() h.cmd("track drops yes") end
  -- a loot window as the game sends it: ready, opened, closed. h.lootOpened: a client that has no LOOT_READY
  function h.loot(slots) s.slots = slots; h.event("LOOT_READY", false); h.event("LOOT_OPENED", false); h.event("LOOT_CLOSED") end
  function h.lootOpened(slots) s.slots = slots; h.event("LOOT_OPENED"); h.event("LOOT_CLOSED") end
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
  h.s.words = "  Welcome back, Tester Testwood, Rogue.  "
  h.event("GOSSIP_SHOW")
  local e = h.events()[1]
  assert(e and e.npc == 11502 and e.type == "gossip" and e.kind == "gossip"
         and e.text == "Welcome back, $N, Rogue." and e.guid == nil and e.where and e.who, h.db().lastError)
  h.s.greeting = "Welcome back, Tester, Rogue."
  h.event("QUEST_GREETING")
  assert(#h.events() == 1 and h.db().n == 1, "same normalized text across both windows")
  h.s.units.npc.guid = NODE
  h.event("QUEST_GREETING")
  e = h.events()[2]
  assert(e and e.object == 1617 and not e.npc and e.kind == "greeting", "distinct object subject")
  h.s.words = "Work with Zorvath's tools."
  h.event("GOSSIP_SHOW")
  assert(#h.events() == 2, "object gossip declines an unknown capitalized name")
  h.s.units.npc.guid = MOB
  h.event("GOSSIP_SHOW")
  assert(h.events()[3].text == h.s.words, "the unknown-capital rule only applies to objects")
  h.s.units.target = { guid = PLAYER, player = true, name = "Exampletarget" }
  h.G.GetUnitName = function(unit) return h.s.units[unit] and h.s.units[unit].name or "Tester Testwood" end
  h.G.IsInGroup = function() return true end
  h.G.GetNumGroupMembers = function() return 2 end
  h.s.units.party1 = { name = "Exampleparty" }
  for _, private in ipairs({ "Deposit 4 GOLD.", "You have 20silver.", "Return with 123 copper.",
      "Welcome, exampletarget!", "Balance belongs to Exampleparty's friend.",
      string.rep("a", 4000) .. " 10 Gold" }) do
    h.s.words = private
    h.event("GOSSIP_SHOW")
  end
  h.s.greeting = "You have 2 gOLd."
  h.event("QUEST_GREETING")
  h.s.greeting = "Welcome back, Exampleparty."
  h.event("QUEST_GREETING")
  assert(#h.events() == 3 and not h.db().lastError, "money and roster/target names in either window are skipped")
  h.G.IsInGroup = function() return false end
  h.s.units.target = nil
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
  assert(#h.events() == 3 and not h.db().lastError, "player, secret values and mail leave no event")
  h.G.InboxFrame, h.G.C_GossipInfo, h.s.legacy = nil, nil, string.rep("a", 3999) .. "é"
  h.event("GOSSIP_SHOW")
  assert(#h.events()[4].text == 3999, "legacy fallback and correct UTF-8 cut")
  h.s.legacy = "Player-" .. string.char(1) .. "1-0123"
  h.event("GOSSIP_SHOW")   -- stripping a control must not let a GUID through
  h.G.GetGossipText = nil
  h.event("GOSSIP_SHOW")
  assert(#h.events() == 4, "missing APIs")
  h.db().events = {}
  local r = gossip({ db = h.db() })
  r.s.words = "Welcome back, Tester, Rogue."
  r.event("GOSSIP_SHOW")
  assert(#r.events() == 0, "saved dedup survives reload and absence of the original event")
  for i = 1, 2000 do r.s.words = "Message number " .. i; r.event("GOSSIP_SHOW") end
  assert(#r.db().textSeen.gossip.keys == 2000 and #r.events() == 2000, r.db().lastError)
  r.s.words = "Welcome back, Tester, Rogue."
  r.event("GOSSIP_SHOW")
  assert(#r.events() == 2001, "oldest key is evicted")
  local full = gossip({ db = { events = { { t = 1767225600, padding = string.rep("x", 1000000) } } } })
  full.G.C_GossipInfo.GetText = function() error("should not read gossip above half cap") end
  full.event("GOSSIP_SHOW")
  assert(#full.events() == 1 and not full.db().textSeen and not full.db().n, "half cap skips gossip")
  print("OK   gossip and greetings, normalized subjects, privacy guards, saved FIFO and size gate")
end

-- Readable pages: provenance, gating before the body read, and persistent per-page dedup.
do
  local secret = {}
  local function library(opts)
    opts = opts or {}
    opts.globals = {
      issecretvalue = function(v) return v == secret end,
      C_Container = { UseContainerItem = function() end, GetContainerItemInfo = function(bag, slot)
        assert(bag == 0 and slot == 1, "only safe hook arguments")
        return { itemID = 54000, itemName = "Example Journal", isReadable = true }
      end },
    }
    local h = fresh(opts)
    local s = h.s
    s.title, s.page, s.material, s.more, s.bodies = "Example Journal", 1, "Parchment", true, 0
    s.body = "A page for Tester."
    h.G.ItemTextGetItem = function() return s.title end
    h.G.ItemTextGetText = function() s.bodies = s.bodies + 1; return s.body end
    h.G.ItemTextGetCreator = function() return s.creator end
    h.G.ItemTextGetMaterial = function() return s.material end
    h.G.ItemTextGetPage = function() return s.page end
    h.G.ItemTextHasNextPage = function() return s.more end
    function h.open() h.event("ITEM_TEXT_BEGIN"); h.event("ITEM_TEXT_READY") end
    return h
  end
  local h = library()
  h.event("ITEM_TEXT_READY")
  assert(h.s.bodies == 0, "no observed begin")
  h.s.units.npc = { guid = NODE }
  h.open()
  local e = h.events()[1]
  assert(e and e.object == 1617 and e.type == "read" and e.title == "Example Journal" and e.text == "A page for $N."
    and e.page == 1 and e.last == nil and e.material == "Parchment", h.db().lastError)
  h.event("ITEM_TEXT_READY")
  assert(h.s.bodies == 1 and h.db().n == 1, "repeats leave the body unread")
  h.s.page, h.s.more = 2, false
  h.event("ITEM_TEXT_READY")
  assert(h.events()[2].last == true and h.events()[2].object == 1617, "last page of the same object")

  h.event("ITEM_TEXT_CLOSED")
  h.s.units.npc, h.s.page, h.s.title, h.s.body = nil, 1, "Example Saved Letter", "Synthetic private letter text."
  h.hooks.UseContainerItem(0, 1)
  h.open()
  assert(#h.events() == 2 and h.s.bodies == 2, "saved bag letter with a nil creator stays unread")
  h.s.clock = h.s.clock + 2
  h.open()
  assert(#h.events() == 2 and h.s.bodies == 2, "no title-only fallback")
  h.s.units.npc = { guid = NODE }
  h.hooks.UseContainerItem(0, 1)
  h.open()
  h.s.clock = h.s.clock + 2
  h.event("ITEM_TEXT_BEGIN")
  h.hooks.UseContainerItem(0, 1)
  h.event("ITEM_TEXT_READY")
  assert(#h.events() == 2 and h.s.bodies == 2, "bag use invalidates a read even with a lingering world GUID")
  h.db().events = {}
  local r = library({ db = h.db() })
  r.s.units.npc = { guid = NODE }
  r.open()
  assert(r.s.bodies == 0 and #r.events() == 0, "object and page dedup across sessions and pruning")
  r.s.page, r.s.body = 4, string.rep("a", 7999) .. "é"
  r.open()
  assert(#r.events()[1].text == 7999, "UTF-8 page cap")

  local bag = library({ readBag = true })
  bag.hooks.UseContainerItem(secret, secret)
  bag.hooks.UseContainerItem(0, 1)
  bag.open()
  assert(bag.events()[1].item == 54000 and not bag.events()[1].object, "enabled: a matching recent bag use")
  bag.event("ITEM_TEXT_CLOSED")
  bag.hooks.UseContainerItem(0, 1)
  bag.s.clock = bag.s.clock + 2
  bag.open()
  assert(not bag.events()[2].item and not bag.events()[2].object, "enabled: a stale bag use leaves a title-only event")
  bag.event("ITEM_TEXT_CLOSED")
  bag.hooks.UseContainerItem(0, 1)
  bag.s.units.npc, bag.s.page = { guid = NODE }, 2
  bag.open()
  assert(bag.events()[3].page == 2 and not bag.events()[3].item and not bag.events()[3].object, "enabled: competing sources")

  local function never(setup, readBag)
    local n = library({ readBag = readBag })
    if not readBag then n.s.units.npc = { guid = NODE } end
    setup(n)
    assert(n.s.bodies == 0 and #n.events() == 0 and not n.db().lastError, "unsafe body left unread")
  end
  never(function(n) n.event("MAIL_SHOW"); n.event("ITEM_TEXT_BEGIN"); n.event("MAIL_CLOSED"); n.event("ITEM_TEXT_READY") end)
  never(function(n) n.event("ITEM_TEXT_BEGIN"); n.event("MAIL_SHOW"); n.event("MAIL_CLOSED"); n.event("ITEM_TEXT_READY") end)
  never(function(n)
    n.G.InboxFrame = { IsVisible = function() return true end }; n.event("ITEM_TEXT_BEGIN")
    n.G.InboxFrame = nil; n.event("ITEM_TEXT_READY")
  end)
  never(function(n) n.s.creator = "Examplewriter"; n.hooks.UseContainerItem(0, 1); n.open() end, true)
  never(function(n) n.s.creator = ""; n.open() end)
  never(function(n) n.event("ITEM_TEXT_BEGIN"); n.s.creator = ""; n.event("ITEM_TEXT_READY") end)
  never(function(n) n.s.creator = ""; n.hooks.UseContainerItem(0, 1); n.open() end, true)
  never(function(n) n.event("ITEM_TEXT_BEGIN"); n.s.units.npc = nil; n.event("ITEM_TEXT_READY") end)
  never(function(n) n.event("ITEM_TEXT_BEGIN"); n.s.creator = secret; n.event("ITEM_TEXT_READY") end)
  never(function(n) n.G.ItemTextGetCreator = nil; n.open() end)
  never(function(n) n.G.ItemTextGetCreator = function() error("not readable") end; n.open() end)
  never(function(n) n.s.material = "ExampleStationery"; n.open() end)
  never(function(n) n.s.material = secret; n.open() end)
  never(function(n) n.s.page = secret; n.open() end)
  never(function(n) n.event("ITEM_TEXT_BEGIN"); n.event("ITEM_TEXT_CLOSED"); n.event("ITEM_TEXT_READY") end)
  never(function(n) n.event("ITEM_TEXT_BEGIN"); n.s.title = "Different Text"; n.event("ITEM_TEXT_READY") end)
  local unreadable = library({ readBag = true })
  unreadable.G.C_Container.GetContainerItemInfo = function()
    return { itemID = 54000, itemName = "Example Journal", isReadable = secret }
  end
  unreadable.hooks.UseContainerItem(0, 1); unreadable.open()
  assert(unreadable.events()[1] and not unreadable.events()[1].item, "bag attribution needs a plain readable flag")
  local full = library({ db = { events = { { t = 1767225600, padding = string.rep("x", 1000000) } } } })
  full.s.units.npc = { guid = NODE }
  full.open()
  assert(full.s.bodies == 0 and not full.db().textSeen, "half cap skips reading")
  print("OK   world-readable pages, disabled bag and title-only paths, per-page dedup, mail and creator guards")
end

-- NPC lines use only the sender GUID and leave repeats before all unit/roster/location reads.
do
  local secret = {}
  local function district(opts)
    opts = opts or {}
    opts.globals = { issecretvalue = function(v) return v == secret end }
    local h = fresh(opts)
    local s = h.s
    s.units.npc = { guid = MOB, ctId = 7, name = "Warden Flintmorrow" }
    h.G.GetRealZoneText = function() return "Examplefen" end
    h.G.GetSubZoneText = function() return "Morrowcross" end
    s.units.target = { guid = PLAYER, name = "Exampletarget", player = true }
    s.units.party1 = { name = "Exampleparty" }
    s.units.raid1 = { name = "Exampleraid" }
    local n = h.G.UnitName
    s.lookup, s.where, s.roster, s.grouped = 0, 0, 0, true
    h.G.IsInGroup = function() s.roster = s.roster + 1; return s.grouped end
    h.G.IsInRaid = function() return s.raid == true end
    h.G.GetNumGroupMembers = function() return s.raid and 1 or 2 end
    h.G.UnitTokenFromGUID = function(guid)
      s.lookup = s.lookup + 1
      if guid == s.units.npc.guid then return "npc" end
    end
    h.G.UnitCreatureType = function() return "Humanoid", s.units.npc.ctId end
    h.G.C_Map.GetBestMapForUnit = function() s.where = s.where + 1; return s.uiMap end
    h.G.UnitName = function(unit)
      if unit == "party1" then return s.units.party1.name, "Example Realm" end
      return n(unit)
    end
    h.G.GetUnitName = function(unit)
      if unit == "player" then return "Tester Testwood" end
      if unit == "party1" then return "Exampleparty Examplefamily" end
      return s.units[unit] and s.units[unit].name
    end
    function h.line(event, body, who, guid, extra)
      h.event(event, body, "Synthetic speaker", nil, nil, who, nil, nil, nil, nil, nil, 1, guid, extra)
    end
    return h
  end
  local h = district()
  local say = "CHAT_MSG_MONSTER_SAY"
  local body = "Keep close, Tester Testwood, exampleparty-ExampleRealm, and Exampletarget."
  h.line(say, body, nil, MOB)
  local e = h.events()[1]
  assert(e and e.npc == 11502 and e.type == "line" and e.kind == "say"
    and e.text == "Keep close, $N, $N, and $N." and e.guid == nil and e.where.x == 0.4123, h.db().lastError)
  h.line("CHAT_MSG_MONSTER_YELL", body, nil, MOB)
  assert(#h.events() == 1 and h.s.lookup == 1 and h.s.roster == 1 and h.s.where == 1, "a repeat costs no game reads")
  h.line("CHAT_MSG_MONSTER_YELL", "Keep close, $N, $N, and $N.", nil, MOB)
  assert(#h.events() == 1 and h.s.lookup == 1 and h.s.roster == 1, "saved normalized checksum before unit reads")
  h.line("CHAT_MSG_MONSTER_YELL", "Look out!", nil, MOB)
  assert(h.s.roster == 1, "only sentence-initial capitals skip the roster read")
  h.line("CHAT_MSG_MONSTER_WHISPER", "I'll guide you, Examplerecipient.", "Examplerecipient", MOB)
  h.line("CHAT_MSG_MONSTER_EMOTE", "%s waves to Exampletarget.", nil, MOB)
  h.s.raid = true
  h.line("CHAT_MSG_RAID_BOSS_EMOTE", "step back, Exampleraid!", nil, MOB)
  assert(h.events()[2].kind == "yell" and h.events()[3].kind == "whisper"
    and h.events()[3].text == "I'll guide you, $N." and h.events()[4].kind == "emote"
    and h.events()[4].text == "%s waves to $N." and h.events()[5].kind == "boss"
    and h.events()[5].text == "step back, $N!", "five supported kinds")
  h.line(say, "Exampleunknown, come here.", nil, MOB)
  local unknown = "Look out for Zorvath's arrows!"
  local lookups, roster, locations = h.s.lookup, h.s.roster, h.s.where
  h.line(say, unknown, nil, MOB)
  assert(h.s.lookup == lookups + 1 and h.s.roster == roster + 1 and #h.events() == 5, "unknown possessive is dropped")
  for _ = 1, 100 do h.line(say, unknown, nil, MOB) end
  assert(h.s.lookup == lookups + 1 and h.s.roster == roster + 1 and h.s.where == locations,
    "100 repeats of a dropped line perform no unit, roster or location reads")
  assert(not h.db().textSeen.dropped, "rejected checksums are session-only")
  for _, event in ipairs({ "CHAT_MSG_MONSTER_WHISPER", "CHAT_MSG_MONSTER_EMOTE", "CHAT_MSG_RAID_BOSS_EMOTE" }) do
    h.line(event, "Wait has fallen...", nil, MOB)
    h.line(event, "The path is safe, Tester.", nil, MOB)
  end
  h.line(say, "Run!", nil, MOB)
  h.line(say, "Run! Quickly now.", nil, MOB)
  h.line(say, "Come here, é.", nil, MOB)
  h.line(say, "Run for cover.", nil, nil, MOB) -- a creature in another argument must not be used
  h.line(say, "Look behind you.", nil, PLAYER)
  h.line(say, "Look behind you.", nil, MOB:gsub("^Creature", "Pet"))
  h.line(say, "Look behind you.", nil, secret)
  h.line(say, secret, nil, MOB)
  h.line(say, "Look behind you.", secret, MOB)
  h.s.units.npc.controlled = true
  h.line(say, "Look behind you.", nil, MOB)
  h.s.units.npc.controlled, h.s.units.npc.ctId = false, 12
  h.line(say, "Look behind you.", nil, MOB)
  h.s.units.npc.ctId = 7
  h.line(say, "Look behind you.", nil, MOB2) -- unresolvable creature
  h.s.raid, h.s.units.party1.name = false, secret
  h.line(say, "Look behind you, Exampleparty.", nil, MOB)
  h.G.IsInGroup = nil
  h.line(say, "Look behind you, Exampletarget.", nil, MOB)
  assert(#h.events() == 5 and not h.db().lastError, "ambiguous names, controlled/unidentified speakers and secret values")
  h.G.IsInGroup = function() return false end
  local yell = "CHAT_MSG_MONSTER_YELL"
  h.line(yell, "Look for Warden Flintmorrow in Examplefen near Morrowcross.", nil, MOB)
  h.line(yell, "“Keep close,” he said — and don’t stop…", nil, MOB)
  h.line(say, "Run, quickly.", nil, MOB)
  h.line(say, "Look out for zorvath's arrows!", nil, MOB)
  h.line(say, "Wait has fallen...", nil, MOB)
  assert(h.events()[6].text == "Look for Warden Flintmorrow in Examplefen near Morrowcross.",
    "speaker, zone and subzone words are allowed in yells")
  assert(h.events()[7].text == [["Keep close," he said - and don't stop...]], "normalized punctuation is retained")
  assert(h.events()[8].text == "Run, quickly.", "an opener can be followed by punctuation then a lowercase word")
  assert(h.events()[9].text == "Look out for zorvath's arrows!", "known gap: lowercase names can pass")
  assert(h.events()[10].text == "Wait has fallen...", "a rejection for a strict kind is not shared with say")
  h.db().events = {}
  local r = district({ db = h.db() })
  r.line(say, "Look out!", nil, MOB)
  assert(#r.events() == 0 and r.s.lookup == 0, "plain repeats survive a reload and event pruning")
  r.line(say, unknown, nil, MOB)
  assert(#r.events() == 0 and r.s.lookup == 1 and r.s.roster == 1, "rejections are read again after reload")
  r.line(say, "The " .. string.rep("a", 2500), nil, MOB)
  assert(#r.events()[1].text == 2000, "line length cap")
  local full = district({ db = { events = { { t = 1767225600, padding = string.rep("x", 1000000) } } } })
  full.line(say, "Look out!", nil, MOB)
  assert(full.s.lookup == 0 and not full.db().textSeen, "half cap skips lines")
  local many = {}
  for i = 1, 2499 do many[i] = { t = 1767225600 } end
  local count = district({ db = { events = many } })
  count.line(say, "Look out!", nil, MOB)
  assert(#count.events() == 2500 and count.events()[2500].type == "line", "text can fill the first half of event slots")
  count.line(say, "Keep close.", nil, MOB)
  local reads = 0
  count.G.C_GossipInfo = { GetText = function() reads = reads + 1; return "Look out." end }
  count.event("GOSSIP_SHOW")
  count.s.units.npc = { guid = NODE }
  count.G.ItemTextGetCreator = function() reads = reads + 1 end
  count.event("ITEM_TEXT_BEGIN"); count.event("ITEM_TEXT_READY")
  assert(#count.events() == 2500 and count.s.lookup == 1 and reads == 0, "count gate skips all new text at half cap")
  count.loot({ item(17076, 1, { MOB, 1 }) })
  assert(#count.events() == 2501 and count.events()[2501].type == "loot", "the text count gate leaves room for loot")
  print("OK   creature lines, strict and contextual name rules, punctuation, negative cache and event-count gate")
end

-- Quest objectives and map markers amend one accept, without storing character progress.
do
  local secret = {}
  local function errands(opts)
    opts = opts or {}
    opts.globals = { issecretvalue = function(v) return v == secret end }
    local h = fresh(opts)
    local s = h.s
    s.combat, s.objReads, s.poiReads, s.waypointReads = false, 0, 0, 0
    h.G.InCombatLockdown = function() return s.combat end
    h.G.C_QuestLog = {
      GetQuestObjectives = function(id)
        assert(id == 7787, "objectives for the accepted quest only")
        s.objReads = s.objReads + 1
        return s.objectives
      end,
      GetQuestsOnMap = function(map)
        assert(map == 1429 and s.combat == false, "map API only on the acceptance map and out of combat")
        s.poiReads = s.poiReads + 1
        return s.points
      end,
      GetNextWaypointForMap = function()
        s.waypointReads = s.waypointReads + 1
        return 0.75, 0.25
      end,
    }
    return h
  end
  local h = errands()
  local row = setmetatable({ type = "monster", numRequired = 10, text = " 7/10 Slay northern raiders, Tester." },
    { __index = function(_, k) error("unexpected objective field " .. k) end })
  h.s.objectives = {
    row, { type = "item", numRequired = 4, text = "Tools recovered: 2/4" },
    { type = "event", numRequired = 0, text = "34.2% - Fill the jar." },
    { type = "progressbar", numRequired = 100, text = "Fill the flask: 6,4%" },
    { type = "item", numRequired = 1, text = "Recovered 2/4 before nightfall" },
    { type = secret, numRequired = 1, text = "Hidden type" }, secret,
    { type = "object", numRequired = secret, text = "Hidden count" },
    { type = "item", numRequired = 1, text = secret },
    { type = "object", numRequired = 1, text = string.rep("a", 399) .. "é" },
  }
  for i = 1, 13 do h.s.objectives[#h.s.objectives + 1] = { type = "reputation", numRequired = i, text = "Earn trust." } end
  h.s.points = { secret, { questID = secret, x = 0.5, y = 0.5 }, { questID = 7788, x = 0.5, y = 0.5 },
    { questID = 7787, mapID = secret, x = 0.5, y = 0.5 }, { questID = 7787, mapID = 1430, x = 0.5, y = 0.5 },
    { questID = 7787, x = 0, y = 0 }, { questID = 7787, x = secret, y = 0.5 },
    { questID = 7787, isQuestStart = true, x = 0.5, y = 0.5 },
    { questID = 7787, isQuestStart = secret, x = 0.5, y = 0.5 },
    { questID = 7787, x = -1, y = 0.5 }, { questID = 7787, x = 0.412345, y = 0.654321 },
    { questID = 7787, x = 0.41234, y = 0.65432 } }
  for i = 1, 9 do h.s.points[#h.s.points + 1] = { questID = 7787, x = i / 10, y = 1 } end
  h.event("QUEST_ACCEPTED", 5, secret)
  assert(#h.events() == 0, "an older event with a secret quest id cannot use its log index as an id")
  h.event("QUEST_ACCEPTED", 7787)
  local e = h.events()[1]
  assert(e and #e.obj == 12 and #e.poi == 8 and e.act == "accept", h.db().lastError)
  assert(e.rows == 23, "rows: every row the client listed, unusable ones too: " .. tostring(e.rows))
  assert(e.obj[1].text == "Slay northern raiders, $N." and e.obj[1].n == 10 and e.obj[1].t == "monster"
    and e.obj[2].text == "Tools recovered" and e.obj[3].text == "Fill the jar." and e.obj[3].n == 0
    and e.obj[4].text == "Fill the flask" and #e.obj[5].text == 399 and e.obj[12].n == 7, dump(e.obj))
  assert(e.poi[1].map == 1429 and e.poi[1].x == 41.23 and e.poi[1].y == 65.43 and e.poi[2].x == 10
    and e.poi[8].x == 70 and e.poi[8].y == 100 and h.s.waypointReads == 0, dump(e.poi))
  h.event("QUEST_LOG_UPDATE"); h.drain()
  assert(h.s.objReads == 1 and h.s.poiReads == 1, "already present fields are never refreshed")
  h.event("QUEST_TURNED_IN", 7787)
  assert(not h.events()[2].obj and not h.events()[2].poi, "accept only")

  local late = errands()
  late.s.objectives, late.s.points, late.s.combat = secret, secret, secret
  late.event("QUEST_ACCEPTED", 7787)
  local saved = late.events()[1]
  assert(saved and not saved.obj and not saved.poi and late.s.poiReads == 0, "secret list or combat status")
  late.s.objectives = { { type = "event", numRequired = 1, text = "Wait for dawn." } }
  late.event("QUEST_DATA_LOAD_RESULT", secret, true)
  late.event("QUEST_DATA_LOAD_RESULT", 7787, secret)
  late.event("QUEST_DATA_LOAD_RESULT", 7788, true)
  assert(not saved.obj and late.s.objReads == 1, "only a plain success for this quest can retry")
  late.event("QUEST_DATA_LOAD_RESULT", 7787, true)
  assert(saved.obj and not saved.poi and #late.events() == 1 and late.events()[1] == saved, "late objective amends in place")
  assert(#saved.obj == 1 and saved.rows == 1, "rows comes with the late obj: " .. tostring(saved.rows))
  late.s.combat = false
  late.s.uiMap = 1430
  late.event("PLAYER_REGEN_ENABLED")
  assert(not saved.poi and late.s.poiReads == 0, "no map read after moving zones")
  late.s.uiMap = 1429
  late.event("QUEST_POI_UPDATE")
  assert(not saved.poi and late.s.waypointReads == 0, "route waypoint API is never called")
  late.s.points = { { questID = 7787, x = 0.12119, y = 0.9 } }
  late.event("QUEST_POI_UPDATE")
  assert(#saved.poi == 1 and saved.poi[1].x == 12.12 and late.s.waypointReads == 0, "late map row amends the accept")
  late.drain()
  assert(late.s.objReads == 2 and late.s.poiReads == 2 and #late.events() == 1 and not late.db().lastError, "one write per field")

  local function missing(setup, update, mayHaveObj)
    local x = errands()
    setup(x)
    x.event("QUEST_ACCEPTED", 7787)
    if update then update(x) end
    x.drain()
    local accept = x.events()[1]
    assert(accept and (mayHaveObj or not accept.obj) and not accept.poi and not x.db().lastError, "missing data safely omitted")
  end
  missing(function(x) x.G.C_QuestLog = nil end)
  missing(function(x) x.G.InCombatLockdown = nil end)
  missing(function(x) x.G.C_QuestLog.GetQuestsOnMap = nil end)
  missing(function(x) x.s.combat = true; x.s.points = { { questID = 7787, x = 0.1, y = 0.1 } } end)
  missing(function(x)
    x.s.points = { { questID = 7787, x = 0.1, y = 0.1 } }
    x.G.C_QuestLog.ReadyForTurnIn = function() return true end
  end)
  local function ready(x)
    x.s.points = { { questID = 7787, x = 0.1, y = 0.1 } }
    x.s.objectives = { { type = "event", numRequired = 1, text = "Wait for dawn." } }
    x.event("QUEST_LOG_UPDATE")
  end
  missing(function() end, function(x) x.s.now = x.s.now + 11; ready(x) end)
  missing(function() end, function(x) x.event("QUEST_REMOVED", 7787); ready(x) end)
  missing(function() end, function(x) x.cmd("track drops off"); x.cmd("track drops on"); ready(x) end)
  local full = errands({ db = { events = { { t = 1767225600, padding = string.rep("x", 1000000) } } } })
  full.s.objectives, full.s.points = { row }, { { questID = 7787, x = 0.1, y = 0.1 } }
  full.event("QUEST_ACCEPTED", 7787)
  assert(full.s.objReads == 0 and not full.events()[2].obj and full.events()[2].poi, "half cap gates objective prose only")
  local big = errands()
  big.s.objectives = {}
  for i = 1, 41 do big.s.objectives[i] = { type = "event", numRequired = 1, text = "Hold the line." } end
  big.event("QUEST_ACCEPTED", 7787)
  assert(#big.events()[1].obj == 12 and big.events()[1].rows == nil, "more than 40 rows: obj without rows")
  assert(full.events()[2].rows == nil, "no obj, no rows")
  print("OK   objective definitions (with rows) and places, independent late data, caps, secrets, no progress counts")
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
  h.ns.ObsNote(true)
  assert(#h.printed == 2 and h.db().notedGameText and h.db().notedPets, "fresh installs skip the upgrade notices")
  for _, on in ipairs({ true, false }) do
    local existing = fresh({ db = { v = 1, on = on, agreed = true, noted = true } })
    existing.ns.ObsNote(true); existing.ns.ObsNote(true); existing.ns.ObsNote()
    local first = existing.printed[1] or ""
    assert(#existing.printed == 2 and first:find("NPC gossip and spoken lines")
      and first:find("book pages from world objects") and first:find("quest objectives")
      and first:find("/kinv track drops off") and existing.db().on == on, "the 1.19.0 line at login")
    assert(existing.last():find("1%.20%.0 adds hunter tames") and existing.last():find("/kinv track drops off"), "the 1.20.0 line at login")
    local reloaded = fresh({ db = existing.db() })
    reloaded.ns.ObsNote(true)
    assert(#reloaded.printed == 0, "upgrade notices survive reload")
    local seen119 = fresh({ db = { v = 1, on = on, agreed = true, noted = true, notedGameText = true } })
    seen119.ns.ObsNote(true)
    assert(#seen119.printed == 1 and seen119.last():find("1%.20%.0"), "a 1.19.0 install sees only the 1.20.0 line")
  end
  print("OK   one-time 1.19.0 and 1.20.0 login notices for existing installs and the original first /kinv note")
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

-- 4b) read at LOOT_READY: auto-loot or a fast-loot addon takes the slots from there, so LOOT_OPENED sees an emptied
-- window or never comes, and LOOT_CLOSED may not come either
do
  local A, B, C = "Creature-0-4170-0-1234-424-000012AA01", "Creature-0-4170-0-1234-424-000012AA02", "Creature-0-4170-0-1234-423-000012AA03"
  local h = fresh(); h.on()
  local function ids() local out = {}; for i, e in ipairs(h.events()) do out[i] = e.id:match("%-(%d+)$") end; return table.concat(out, ",") end
  -- the slots are taken between the two events: the read is LOOT_READY's, with the items
  h.s.units.target = { guid = A, dead = true, level = 16 }
  h.s.slots = { item(2589, 2, { A, 2 }), { n = 0, from = { A, 0 } } }; h.event("LOOT_READY", true)
  h.s.slots = {}; h.event("LOOT_OPENED", true); h.event("LOOT_CLOSED")
  local ev = h.events()
  assert(#ev == 1 and ev[1].src.guid == A and ev[1].src.via == "slot" and ev[1].src.level == 16 and #ev[1].items == 1 and ev[1].items[1].n == 2,
         "the items as LOOT_READY had them: " .. dump(ev[1]))
  -- a window that never opens and never closes: the next corpse's LOOT_READY is still read
  h.s.units.target = { guid = B, dead = true, level = 17 }
  h.s.slots = { item(2592, 1, { B, 1 }) }; h.event("LOOT_READY", true)
  h.s.units.target = { guid = C, dead = true, level = 15 }
  h.s.slots = { item(1212, 1, { C, 1 }) }; h.event("LOOT_READY", true)
  ev = h.events()
  assert(#ev == 3 and ev[2].src.guid == B and ev[3].src.guid == C and ev[3].items[1].id == 1212, "no LOOT_CLOSED between two corpses: " .. #ev)
  -- LOOT_READY twice for one window, the second after the slots went, with another corpse targeted by then: nothing
  -- more, and that other corpse is not marked opened and empty
  local D = "Creature-0-4170-0-1234-424-000012AA04"
  h.s.units.target = { guid = D, dead = true, level = 16 }
  h.event("LOOT_READY", true)                                   -- C's window again, as it was
  h.s.slots = {}; h.event("LOOT_READY", true); h.event("LOOT_OPENED", true)   -- and emptied
  assert(#h.events() == 3, "a repeated LOOT_READY adds nothing: " .. #h.events())
  h.event("LOOT_CLOSED")
  h.s.slots = { item(2589, 1, { D, 1 }) }; h.event("LOOT_READY", true); h.event("LOOT_CLOSED")
  ev = h.events()
  assert(#ev == 4 and ev[4].src.guid == D and #ev[4].items == 1, "the other corpse's own loot is recorded: " .. dump(ev[#ev].src))
  assert(ids() == "000001,000002,000003,000004", "an open that is not kept takes no id: " .. ids())
  -- a source with no GUID to count it by (an opened bag item) is read once per window, however often LOOT_READY comes
  h.s.units.target = nil
  h.G.C_Item = { GetItemIDByGUID = function(g) if g == BAG then return 20708 end end }
  h.s.slots = { item(2589, 4, { BAG, 4 }) }
  h.event("LOOT_READY", true); h.event("LOOT_READY", true); h.event("LOOT_OPENED", true)
  assert(#h.events() == 5 and h.events()[5].src.kind == "container", "one bag, one event: " .. #h.events())
  h.event("LOOT_CLOSED"); h.event("LOOT_READY", true); h.event("LOOT_CLOSED")
  assert(#h.events() == 6 and h.events()[6].src.item == 20708, "the next bag after the window closed: " .. #h.events())
  -- nothing in the window at LOOT_READY: still an open of the dead target, once
  h.s.units.target = { guid = "Creature-0-4170-0-1234-424-000012AA05", dead = true }
  h.s.slots = {}; h.event("LOOT_READY", true); h.event("LOOT_OPENED", true); h.event("LOOT_CLOSED")
  ev = h.events()
  assert(#ev == 7 and ev[7].src.npc == 424 and ev[7].src.via == "target" and #ev[7].items == 0, "an empty window is an open: " .. dump(ev[#ev].src))
  -- a client without LOOT_READY: LOOT_OPENED reads the window as before
  local old = fresh(); old.on()
  old.s.units.target = { guid = A, dead = true }
  old.lootOpened({ item(2589, 1, { A, 1 }) }); old.lootOpened({ item(2592, 1, { B, 1 }) })
  assert(#old.events() == 2 and old.events()[2].src.guid == B and old.events()[2].id:match("%-000002$"), "LOOT_OPENED alone: " .. #old.events())
  assert(h.registered.LOOT_READY and h.registered.LOOT_OPENED and h.registered.LOOT_CLOSED, "the three loot events are registered")
  print("OK   loot is read at LOOT_READY: before the slots are taken, without LOOT_OPENED or LOOT_CLOSED, once per window; LOOT_OPENED alone still reads")
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

-- 6) quests: accept with the giver, turn-in with ender, rewards, choices and the chosen one; never QUEST_TURNED_IN's money
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
         dump(ev[3].rewards) == "{cap=true,choices={1=19018,2=19019},choose={1={id=19018,link=|cffffffff|Hitem:19018|h[X]|h|r,n=1},"
         .. "2={id=19019,link=|cffffffff|Hitem:19019|h[X]|h|r,n=1}},chose=19019,items={1={id=19019,link=|cffffffff|Hitem:19019|h[X]|h|r,n=1}}}",
         dump(ev[3]))
  assert(not dump(h.db()):find("123456") and not dump(h.db()):find("6600"), "quest money and xp are never kept")
  print("OK   quests: accept with the giver, turn-in with the ender, item rewards, choices and the chosen item; never QUEST_TURNED_IN's money")
end

-- 6b) quest text: the words of the quest windows, the character's own name back to "$N", once per quest and act
do
  local h = fresh(); h.on()
  h.s.units.questnpc = { guid = "Creature-0-4170-0-1234-11811-000012AAAB" }
  h.s.quest = 7787
  h.s.text = { title = "  Rise, Thunderfury!  ", details = "Tester, the blade is whole.\\n\\nTesterly folk and Tester's kin wait.",
               objectives = "Bring the Bindings to Demitrian.", progress = "Do you have them, Testwood?",
               completion = "It is done, Tester Testwood.\\rTake it." }
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

-- 6c) quest extras: lv, group, freq, timed and startItem on accept; xp and rep (changes only) on turn-in; never the player's
--     money or a standing. questy() adds the quest log, XP, combat and reputation APIs:
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
    G.GetRewardMoney = function() return 4321 end           -- the quest's listed money: rewards.money since 1.23.0
    G.GetMoney = function() s.moneyRead = true; return 123456 end   -- the player's own money: never read
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
         "never a standing, never the player's money or QUEST_TURNED_IN's")
  assert(e.rewards.money == 4321, "the quest's listed money: " .. dump(e.rewards))
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
  norep("loot that never opened a window before the turn-in", nil, function(x) x.event("LOOT_READY", true) end)
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
  print("OK   quest extras: lv, group, freq, timed, startItem on accept; xp under the cap; rep changes only, dropped when unsure; never the player's money")
end

-- 6d) quest rewards as the quest window listed them (1.23.0), on accept (the offer window, QUEST_DETAIL) and on turn-in
--     (the reward window, QUEST_COMPLETE): choose, money (the quest's GetRewardMoney, never the player's GetMoney), xp,
--     spells, title, cap, skill and cur; each key only when the client answered it plainly. rw() adds the reward APIs:
--     s.money, s.xp, s.title, s.spells, s.cur, s.skillLine, s.skillPts (a table: GetRewardSkillPoints' returns), s.level
do
  local SECRET = {}
  local LINK_A, LINK_B = "|cffffffff|Hitem:18471|h[X]|h|r", "|cffffffff|Hitem:18472|h[X]|h|r"
  local function rw(opts)
    opts = opts or {}
    opts.globals = opts.globals or {}
    opts.globals.issecretvalue = function(v) return v == SECRET end
    local h = fresh(opts); h.on()
    local s, G = h.s, h.G
    s.level, s.maxLevel, s.getMoney = 30, 60, 0
    G.UnitLevel = function(u) if u == "player" then return s.level end; local x = s.units[u]; return x and x.level end
    G.GetRewardMoney = function() return s.money end
    G.GetMoney = function() s.getMoney = s.getMoney + 1; return 98765432 end   -- the player's own money: never read
    G.GetRewardXP = function() return s.xp end
    G.GetRewardTitle = function() return s.title end
    G.GetRewardSkillLineID = function() return s.skillLine end
    G.GetRewardSkillPoints = function() if s.skillPts then return table.unpack(s.skillPts) end end
    G.C_QuestInfoSystem = { GetQuestRewardSpells = function(q) assert(q == s.quest, "the window's quest"); return s.spells end,
                            GetQuestRewardCurrencies = function(q) assert(q == s.quest, "the window's quest"); return s.cur end }
    h.s.units.questnpc = { guid = "Creature-0-4170-0-1234-11811-000012AAAB" }
    return h
  end
  local function lastOf(h, act) local e = h.events(); for i = #e, 1, -1 do if e[i].act == act then return e[i] end end end
  local function fine(h) assert(not h.db().lastError and h.s.getMoney == 0, tostring(h.db().lastError) .. " GetMoney " .. h.s.getMoney) end

  -- "Friend of the Library": nothing always given, two amulets to choose from, 125 copper and 160 XP
  local h = rw()
  h.s.quest, h.s.choices, h.s.money, h.s.xp = 1032, { item(18471, 1), item(18472, 1) }, 125, 160
  h.event("QUEST_DETAIL"); h.event("QUEST_ACCEPTED", 1032)
  local a = lastOf(h, "accept")
  assert(dump(a.rewards) == "{choose={1={id=18471,link=" .. LINK_A .. ",n=1},2={id=18472,link=" .. LINK_B .. ",n=1}},items={},money=125,xp=160}",
         "the offer's rewards on the accept: " .. dump(a.rewards))
  h.s.money = 130                               -- what the reward window says is what the turn-in keeps
  h.event("QUEST_COMPLETE"); h.hooks.GetQuestReward(2); h.event("QUEST_TURNED_IN", 1032, 160, 123456)
  local t = lastOf(h, "turnin")
  assert(dump(t.rewards) == "{choices={1=18471,2=18472},choose={1={id=18471,link=" .. LINK_A .. ",n=1},2={id=18472,link=" .. LINK_B
         .. ",n=1}},chose=18472,items={},money=130,xp=160}" and t.xp == 160, "the reward window's rewards on the turn-in: " .. dump(t))
  assert(not dump(h.db()):find("123456") and not dump(h.db()):find("98765432"), "never QUEST_TURNED_IN's money, never the player's")
  fine(h)

  -- spells, title, skill and currencies: cleaned, sorted, each once, capped
  local x = rw()
  x.s.quest, x.s.rewards = 7000, { item(2589, 5) }
  x.s.spells = { 300, 100, 300, 0, -1, 2.5, "x", SECRET }
  x.s.title = "  Champion of the Example" .. string.char(1) .. " "
  x.s.skillLine, x.s.skillPts = 197, { 5 }
  x.s.cur = { { currencyID = 61, totalRewardAmount = 3 }, { currencyID = 42, totalRewardAmount = 10 }, { currencyID = 61, totalRewardAmount = 9 },
              { currencyID = 7, totalRewardAmount = 0 }, { currencyID = 0, totalRewardAmount = 2 }, "junk", SECRET,
              { currencyID = SECRET, totalRewardAmount = 2 }, { currencyID = 8, totalRewardAmount = 1.5 } }
  x.event("QUEST_DETAIL"); x.event("QUEST_ACCEPTED", 7000)
  a = lastOf(x, "accept")
  assert(dump(a.rewards) == "{cur={1={id=42,n=10},2={id=61,n=3}},items={1={id=2589,link=|cffffffff|Hitem:2589|h[X]|h|r,n=5}},"
         .. "skill={line=197,pts=5},spells={1=100,2=300},title=Champion of the Example}", dump(a.rewards))
  fine(x)
  local function one(setup)
    local y = rw(); y.s.quest = 7001; y.s.money = 1
    setup(y)
    y.event("QUEST_DETAIL"); y.event("QUEST_ACCEPTED", 7001)
    fine(y)
    return lastOf(y, "accept").rewards
  end
  local many = one(function(y) y.s.spells = { 9, 8, 7, 6, 5, 4, 3, 2, 1, 10 } end)
  assert(dump(many.spells) == "{1=1,2=2,3=3,4=4,5=5,6=6,7=7,8=8}", "the lowest 8 spells: " .. dump(many.spells))
  many = one(function(y) y.s.cur = {}; for i = 9, 1, -1 do y.s.cur[#y.s.cur + 1] = { currencyID = i, totalRewardAmount = 1 } end end)
  assert(#many.cur == 8 and many.cur[1].id == 1 and many.cur[8].id == 8, "the lowest 8 currencies: " .. dump(many.cur))
  -- GetRewardSkillPoints in the shape the default UI reads it (skillName, skillIcon, skillPoints)
  assert(dump(one(function(y) y.s.skillLine, y.s.skillPts = 197, { "Tailoring", 136249, 5 } end).skill) == "{line=197,pts=5}", "name first")
  for what, setup in pairs({
    ["no line"] = function(y) y.s.skillPts = { 5 } end,
    ["no points"] = function(y) y.s.skillLine = 197 end,
    ["0 points"] = function(y) y.s.skillLine, y.s.skillPts = 197, { 0 } end,
    ["1001 points"] = function(y) y.s.skillLine, y.s.skillPts = 197, { 1001 } end,
    ["a secret line"] = function(y) y.s.skillLine, y.s.skillPts = SECRET, { 5 } end,
    ["secret points"] = function(y) y.s.skillLine, y.s.skillPts = 197, { SECRET } end,
    ["a name and no points"] = function(y) y.s.skillLine, y.s.skillPts = 197, { "Tailoring", 136249 } end,
    ["the calls missing"] = function(y) y.G.GetRewardSkillLineID, y.G.GetRewardSkillPoints = nil, nil end,
    ["the calls failing"] = function(y) y.G.GetRewardSkillLineID = function() error("no") end; y.s.skillPts = { 5 } end }) do
    assert(not one(setup).skill, what)
  end
  for what, setup in pairs({
    ["a title with markup"] = function(y) y.s.title = "|cffff0000Red|r" end,
    ["an empty title"] = function(y) y.s.title = "   " end,
    ["a secret title"] = function(y) y.s.title = SECRET end,
    ["a number for a title"] = function(y) y.s.title = 5 end }) do
    assert(not one(setup).title, what)
  end
  assert(#one(function(y) y.s.title = string.rep("é", 50) end).title == 80, "a title is cut to 80 bytes on a whole character")
  -- money: only a plain whole number of copper from 1 to 2^31-1
  for what, setup in pairs({
    ["0"] = function(y) y.s.money = 0 end, ["negative"] = function(y) y.s.money = -5 end, ["a fraction"] = function(y) y.s.money = 2.5 end,
    ["too much"] = function(y) y.s.money = 2147483648 end, ["a secret"] = function(y) y.s.money = SECRET end,
    ["a string"] = function(y) y.s.money = "125" end, ["the call missing"] = function(y) y.G.GetRewardMoney = nil end,
    ["the call failing"] = function(y) y.G.GetRewardMoney = function() error("no") end end }) do
    local r = one(function(y) setup(y); y.s.xp = 10 end)
    assert(r and r.xp == 10 and not r.money, "money " .. what .. ": " .. dump(r))
  end
  assert(one(function(y) y.s.money = 2147483647 end).money == 2147483647, "the largest money")
  -- the spells and currencies calls missing, failing or answering junk: left out, nothing else lost
  for what, setup in pairs({
    ["no C_QuestInfoSystem"] = function(y) y.G.C_QuestInfoSystem = nil end,
    ["the calls failing"] = function(y) y.G.C_QuestInfoSystem = { GetQuestRewardSpells = function() error("no") end,
                                                                   GetQuestRewardCurrencies = function() error("no") end } end,
    ["junk"] = function(y) y.s.spells, y.s.cur = "1,2", 7 end,
    ["secret lists"] = function(y) y.s.spells, y.s.cur = SECRET, SECRET end,
    ["a list that errors when read"] = function(y)
      local bomb = setmetatable({}, { __index = function() error("unreadable") end })
      y.s.spells, y.s.cur = bomb, bomb end }) do
    local r = one(setup)
    assert(r and r.money == 1 and not r.spells and not r.cur, what .. ": " .. dump(r))
  end

  -- the level cap: cap = true, no xp; cap alone lists nothing, so an accept with nothing else carries no rewards
  local c = rw(); c.s.level = 60; c.s.quest, c.s.money, c.s.xp = 7100, 600, 900
  c.event("QUEST_DETAIL"); c.event("QUEST_ACCEPTED", 7100)
  assert(dump(lastOf(c, "accept").rewards) == "{cap=true,items={},money=600}", dump(lastOf(c, "accept").rewards))
  c.s.quest, c.s.money = 7101, 0
  c.event("QUEST_DETAIL"); c.event("QUEST_ACCEPTED", 7101)
  assert(not lastOf(c, "accept").rewards, "a window that lists nothing: no rewards on the accept")
  c.event("QUEST_COMPLETE"); c.event("QUEST_TURNED_IN", 7101)
  assert(dump(lastOf(c, "turnin").rewards) == "{cap=true,choices={},items={}}", "a turn-in keeps its rewards as before: " .. dump(lastOf(c, "turnin")))
  c.G.GetMaxPlayerLevel = nil; c.s.quest, c.s.money = 7102, 5
  c.event("QUEST_DETAIL"); c.event("QUEST_ACCEPTED", 7102)
  assert(dump(lastOf(c, "accept").rewards) == "{items={},money=5}", "the cap unknown: no cap, no xp " .. dump(lastOf(c, "accept").rewards))
  fine(c)

  -- only the window of this very quest: another quest's offer, no offer at all, a window without a quest id
  local o = rw(); o.s.quest, o.s.money = 7200, 50
  o.event("QUEST_DETAIL"); o.event("QUEST_ACCEPTED", 7201)
  assert(lastOf(o, "accept").quest == 7201 and not lastOf(o, "accept").rewards, "another quest's offer window")
  o.event("QUEST_ACCEPTED", 7202)
  assert(not lastOf(o, "accept").rewards, "accepted without an offer window (shared, auto-accepted)")
  o.s.quest = nil; o.event("QUEST_DETAIL"); o.s.quest = 7203; o.event("QUEST_ACCEPTED", 7203)
  assert(not lastOf(o, "accept").rewards, "an offer window that did not name its quest")
  o.event("QUEST_DETAIL"); o.event("QUEST_ACCEPTED", 7203); o.event("QUEST_ACCEPTED", 7203)
  local ev = o.events()
  assert(ev[#ev - 1].rewards and not ev[#ev].rewards, "one offer window, one accept with its rewards")
  fine(o)

  -- a reward item the client had not loaded: QUEST_ITEM_UPDATE reads the open window again
  local u = rw(); u.s.quest, u.s.money = 7300, 40
  u.s.choices = { { n = 1 }, item(18472, 1) }   -- the first amulet has no link yet
  u.event("QUEST_DETAIL")
  u.s.choices[1] = item(18471, 1); u.event("QUEST_ITEM_UPDATE")
  u.event("QUEST_ACCEPTED", 7300)
  assert(#lastOf(u, "accept").rewards.choose == 2, "the item loaded while the offer was open: " .. dump(lastOf(u, "accept").rewards))
  u.s.quest = 7301; u.s.choices = { { n = 1 } }; u.s.money = 0
  u.event("QUEST_DETAIL"); u.s.choices[1] = item(18471, 1); u.event("QUEST_ITEM_UPDATE"); u.event("QUEST_ACCEPTED", 7301)
  assert(dump(lastOf(u, "accept").rewards.choose) == "{1={id=18471,link=" .. LINK_A .. ",n=1}}", "a window that listed nothing until then")
  u.s.quest = 7302; u.s.choices = { { n = 1 } }; u.s.money = 7
  u.event("QUEST_DETAIL"); u.event("QUEST_FINISHED"); u.s.choices[1] = item(18471, 1); u.event("QUEST_ITEM_UPDATE"); u.event("QUEST_ACCEPTED", 7302)
  assert(not lastOf(u, "accept").rewards.choose, "the window closed: not read again")
  u.s.quest = 7303; u.s.choices = { item(18471, 1), item(18472, 1) }
  u.event("QUEST_DETAIL"); u.s.choices = { item(18471, 1) }; u.event("QUEST_ITEM_UPDATE"); u.s.quest = 7304; u.event("QUEST_ITEM_UPDATE")
  u.s.quest = 7303; u.event("QUEST_ACCEPTED", 7303)
  assert(#lastOf(u, "accept").rewards.choose == 2, "a read that lists less, or another quest's window, changes nothing")
  local reads = 0
  u.G.GetNumQuestChoices = function() reads = reads + 1; return #u.s.choices end
  u.s.quest = 7305; u.event("QUEST_DETAIL")
  for _ = 1, 10 do u.event("QUEST_ITEM_UPDATE") end
  assert(reads == 5, "the window read once and again at most 4 times: " .. reads)
  -- on the reward window the choice slots follow the new read, so the chosen item is the right one
  local r = rw(); r.s.quest = 7400
  r.s.choices = { { n = 1 }, item(18472, 1) }
  r.event("QUEST_COMPLETE"); r.s.choices[1] = item(18471, 1); r.event("QUEST_ITEM_UPDATE")
  r.hooks.GetQuestReward(1); r.event("QUEST_TURNED_IN", 7400)
  local tr = lastOf(r, "turnin").rewards
  assert(tr.chose == 18471 and dump(tr.choices) == "{1=18471,2=18472}" and #tr.choose == 2, dump(tr))
  -- a slot that never gets an id is not chosen; more than 10 choices keep their slots for the hook, choose keeps 10
  r.s.quest = 7401; r.s.choices = { { n = 1 } }
  for i = 1, 11 do r.s.choices[i + 1] = item(30000 + i, 1) end
  r.event("QUEST_COMPLETE"); r.hooks.GetQuestReward(1); r.event("QUEST_TURNED_IN", 7401)
  tr = lastOf(r, "turnin").rewards
  assert(not tr.chose and #tr.choices == 11 and #tr.choose == 10, dump(tr))
  r.s.quest = 7402; r.event("QUEST_COMPLETE"); r.hooks.GetQuestReward(12); r.event("QUEST_TURNED_IN", 7402)
  assert(lastOf(r, "turnin").rewards.chose == 30011, "the 12th slot's item")
  fine(u); fine(r)

  -- a client without any of the new calls records rewards as before: items, choices and chose on the turn-in, none on accept
  local old = fresh(); old.on(); old.s.quest = 7500; old.s.choices = { item(18471, 1) }
  old.G.GetMaxPlayerLevel = nil
  old.event("QUEST_DETAIL"); old.event("QUEST_ACCEPTED", 7500)
  assert(dump(lastOf(old, "accept").rewards) == "{choose={1={id=18471,link=" .. LINK_A .. ",n=1}},items={}}", "the items alone still list")
  old.s.choices = {}; old.s.quest = 7501
  old.event("QUEST_DETAIL"); old.event("QUEST_ACCEPTED", 7501)
  assert(not lastOf(old, "accept").rewards, "nothing listed")
  old.event("QUEST_COMPLETE"); old.event("QUEST_TURNED_IN", 7501)
  assert(dump(lastOf(old, "turnin").rewards) == "{choices={},items={}}", dump(lastOf(old, "turnin").rewards))
  assert(not old.db().lastError, tostring(old.db().lastError))
  -- every reward call failing at once: the quest events are still recorded, without rewards, and nothing is raised
  local bad = rw()
  for _, k in ipairs({ "GetNumQuestRewards", "GetNumQuestChoices", "GetRewardMoney", "GetRewardXP", "GetRewardTitle", "GetRewardSkillLineID",
                       "GetRewardSkillPoints", "GetMaxPlayerLevel" }) do bad.G[k] = function() error("no") end end
  bad.G.C_QuestInfoSystem = setmetatable({}, { __index = function() error("no") end })
  bad.s.quest = 7600; bad.event("QUEST_DETAIL"); bad.event("QUEST_ACCEPTED", 7600)
  bad.event("QUEST_COMPLETE"); bad.event("QUEST_TURNED_IN", 7600)
  assert(lastOf(bad, "accept") and not lastOf(bad, "accept").rewards and dump(lastOf(bad, "turnin").rewards) == "{choices={},items={}}",
         dump(bad.events()))
  fine(bad)
  print("OK   quest rewards as listed: choose, money (the quest's, never the player's), xp, spells, title, cap, skill, cur; on accept only for its own offer window; re-read when an item loads")
end

-- 6e) killrep (1.23.0): the reputation a kill gave, from the faction message, tied to the one creature id that died around
--     it (2 s before to 1 s after); the faction's id from a name table read out of combat; never a standing or a GUID.
--     kr() adds the reputation list (s.factions, in list order, a collapsed header hiding its children; s.walks counts
--     GetNumFactions, i.e. reads of the list), combat (s.combat) and the tap API.
do
  local SECRET = {}
  local function kr(opts)
    opts = opts or {}
    opts.globals = opts.globals or {}
    opts.globals.issecretvalue = function(v) return v == SECRET end
    local h = fresh(opts); h.on()
    local s, G = h.s, h.G
    s.combat, s.walks, s.n = false, 0, 0
    s.factions = { { id = 1118, name = "Classic", header = true, collapsed = true },
                   { id = 72, name = "Stormwind", st = 31337, parent = 1118 },
                   { id = 87, name = "Bloodsail Buccaneers", st = -27183, parent = 1118 },
                   { id = 21, name = "Booty Bay", st = 3000, parent = 1118 } }
    local function shown()
      local out, hidden = {}, {}
      for _, f in ipairs(s.factions) do
        local under = f.parent and hidden[f.parent]
        if not under then out[#out + 1] = f end
        if f.header and (f.collapsed or under) then hidden[f.id] = true end
      end
      return out
    end
    local function data(f)
      if f then return { factionID = f.id, name = f.name, currentStanding = f.st or 0, isHeader = f.header or false,
                         isHeaderWithRep = false, isCollapsed = f.collapsed or false } end
    end
    G.C_Reputation = { GetNumFactions = function() s.walks = s.walks + 1; return #shown() end,
                       GetFactionDataByIndex = function(i) return data(shown()[i]) end,
                       ExpandFactionHeader = function(i) local f = shown()[i]; if f then f.collapsed = false end end,
                       CollapseFactionHeader = function(i) local f = shown()[i]; if f then f.collapsed = true end end }
    G.InCombatLockdown = function() return s.combat end
    G.UnitIsTapDenied = function(u) local x = s.units[u]; return x and x.tapped or false end
    G.FACTION_STANDING_INCREASED = "Reputation with %s increased by %d."
    G.FACTION_STANDING_DECREASED = "Reputation with %s decreased by %d."
    G.FACTION_STANDING_INCREASED_BONUS = "Reputation with %s increased by %d. (+%.1f bonus)"
    h.event("PLAYER_ENTERING_WORLD")            -- out of combat: the name table is read here
    return h
  end
  local function die(h, npc, extra)             -- a creature this player sees die (a nameplate's UNIT_HEALTH)
    h.s.n = h.s.n + 1
    local u = { guid = string.format("Creature-0-4170-0-1234-%d-%010X", npc, h.s.n), dead = true, level = 12 }
    for k, v in pairs(extra or {}) do u[k] = v end
    h.s.units["nameplate" .. h.s.n] = u
    h.event("UNIT_HEALTH", "nameplate" .. h.s.n)
  end
  local function msg(h, text) h.event("CHAT_MSG_COMBAT_FACTION_CHANGE", text) end
  local function settle(h, sec) h.s.clock = h.s.clock + (sec or 1); h.drain() end
  local function reps(h) local out = {}; for _, e in ipairs(h.events()) do if e.type == "killrep" then out[#out + 1] = e end end; return out end
  local function clean(h)
    assert(not h.db().lastError, tostring(h.db().lastError))
    local all = dump(h.db())
    assert(not all:find("Creature%-") and not all:find("31337") and not all:find("27183"), "no GUID, no standing: " .. all)
  end

  -- one creature, one message: npc, lv, f, d; the list is read once, at login, and its headers put back
  local h = kr()
  assert(h.s.walks > 0 and h.s.factions[1].collapsed == true, "the name table is read at login, the header closed again")
  local walks = h.s.walks
  die(h, 1234); msg(h, "Reputation with Stormwind increased by 25."); settle(h)
  local r = reps(h)
  assert(#r == 1 and r[1].npc == 1234 and r[1].lv == 12 and r[1].f == 72 and r[1].d == 25 and r[1].where and r[1].who
         and r[1].id:match("^[0-9a-z]+%-%d+$") and r[1].b, dump(r))
  local keys = {}
  for k in pairs(r[1]) do keys[#keys + 1] = k end
  table.sort(keys)
  assert(table.concat(keys, ",") == "b,d,f,id,lv,npc,t,type,where,who", table.concat(keys, ","))
  -- a decrease is negative; the death may show up to a second after the message; the same again is not kept twice
  settle(h, 5); msg(h, "Reputation with Bloodsail Buccaneers decreased by 5."); h.s.clock = h.s.clock + 0.5; die(h, 1234); settle(h, 0.5)
  r = reps(h)
  assert(#r == 2 and r[2].f == 87 and r[2].d == -5 and r[2].npc == 1234, dump(r))
  settle(h, 5); die(h, 1234); msg(h, "Reputation with Stormwind increased by 25."); settle(h)
  assert(#reps(h) == 2, "the same npc, lv, f and d once per install")
  assert(h.s.walks == walks, "known names: the list is not read again on a kill")
  clean(h)
  -- the dedup index is saved: the same kill after a reload is not recorded again, a different amount is
  local again = fresh({ db = h.db() })
  again.G.C_Reputation, again.G.InCombatLockdown, again.G.UnitIsTapDenied = h.G.C_Reputation, h.G.InCombatLockdown, h.G.UnitIsTapDenied
  again.G.FACTION_STANDING_INCREASED = "Reputation with %s increased by %d."
  again.s.n = 100
  again.event("PLAYER_ENTERING_WORLD")
  local function dieIn(x, npc) x.s.n = (x.s.n or 0) + 1; x.s.units["nameplate" .. x.s.n] = { guid = string.format("Creature-0-4170-0-1234-%d-%010X", npc, x.s.n), dead = true, level = 12 }; x.event("UNIT_HEALTH", "nameplate" .. x.s.n) end
  dieIn(again, 1234); again.event("CHAT_MSG_COMBAT_FACTION_CHANGE", "Reputation with Stormwind increased by 25."); again.s.clock = again.s.clock + 1; again.drain()
  assert(#reps(again) == 2, "saved index: " .. #reps(again))
  again.s.clock = again.s.clock + 5
  dieIn(again, 1234); again.event("CHAT_MSG_COMBAT_FACTION_CHANGE", "Reputation with Stormwind increased by 20."); again.s.clock = again.s.clock + 1; again.drain()
  assert(#reps(again) == 3 and reps(again)[3].d == 20, dump(reps(again)))

  -- refusals: two different creatures; none; a death too early; a tapped one, a player's, a controlled one; levels that differ
  local function none(why, setup)
    local x = kr()
    setup(x)
    settle(x)
    assert(#reps(x) == 0, why .. ": " .. dump(reps(x)))
    clean(x)
  end
  none("two different creatures", function(x) die(x, 1234); die(x, 5678); msg(x, "Reputation with Stormwind increased by 25.") end)
  none("one before, one just after", function(x) die(x, 1234); msg(x, "Reputation with Stormwind increased by 25."); x.s.clock = x.s.clock + 0.5; die(x, 5678) end)
  none("no death", function(x) msg(x, "Reputation with Stormwind increased by 25.") end)
  none("the death 3 s before", function(x) die(x, 1234); x.s.clock = x.s.clock + 3; msg(x, "Reputation with Stormwind increased by 25.") end)
  none("the death 2 s after", function(x) msg(x, "Reputation with Stormwind increased by 25."); x.s.clock = x.s.clock + 2; die(x, 1234) end)
  none("tapped by another player", function(x) die(x, 1234, { tapped = true }); msg(x, "Reputation with Stormwind increased by 25.") end)
  none("a player", function(x) die(x, 1234, { player = true }); msg(x, "Reputation with Stormwind increased by 25.") end)
  none("a controlled creature", function(x) die(x, 1234, { controlled = true }); msg(x, "Reputation with Stormwind increased by 25.") end)
  none("a pet's GUID", function(x) x.s.n = 1; x.s.units.nameplate1 = { guid = "Pet-0-4170-0-1234-1234-0000000001", dead = true }; x.event("UNIT_HEALTH", "nameplate1"); msg(x, "Reputation with Stormwind increased by 25.") end)
  none("alive", function(x) die(x, 1234, { dead = false }); msg(x, "Reputation with Stormwind increased by 25.") end)
  none("no tap API", function(x) x.G.UnitIsTapDenied = nil; die(x, 1234); msg(x, "Reputation with Stormwind increased by 25.") end)
  none("the bonus form", function(x) die(x, 1234); msg(x, "Reputation with Stormwind increased by 25. (+2.5 bonus)") end)
  none("the generic form", function(x) die(x, 1234); msg(x, "Reputation with Stormwind increased.") end)
  none("a secret line", function(x) die(x, 1234); msg(x, SECRET) end)
  none("an amount of 0", function(x) die(x, 1234); msg(x, "Reputation with Stormwind increased by 0.") end)
  none("an amount past 100000", function(x) die(x, 1234); msg(x, "Reputation with Stormwind increased by 100001.") end)
  none("a name two factions share", function(x)
    x.s.factions[#x.s.factions + 1] = { id = 99, name = "Stormwind", st = 0 }
    x.s.clock = x.s.clock + 61; msg(x, "Reputation with Nowhere increased by 25.")   -- unknown: read again, now with the twin
    die(x, 1234); msg(x, "Reputation with Stormwind increased by 25.")
  end)
  none("tracking switched off while it waits", function(x) die(x, 1234); msg(x, "Reputation with Stormwind increased by 25."); x.cmd("track drops off") end)
  local lv = kr()
  die(lv, 1234, { level = 12 }); die(lv, 1234, { level = 13 }); msg(lv, "Reputation with Stormwind increased by 25."); settle(lv)
  assert(#reps(lv) == 1 and reps(lv)[1].npc == 1234 and reps(lv)[1].lv == nil, "levels that differ: no lv " .. dump(reps(lv)))
  local skull = kr()
  die(skull, 1234, { level = -1 }); msg(skull, "Reputation with Stormwind increased by 25."); settle(skull)
  assert(#reps(skull) == 1 and reps(skull)[1].lv == nil, dump(reps(skull)))

  -- a quest's reputation: the reward window open, a turn-in within 5 s either side, also one during the wait
  local q = kr()
  q.s.quest = 7600; q.event("QUEST_COMPLETE")
  q.s.clock = q.s.clock + 20; die(q, 1234); msg(q, "Reputation with Stormwind increased by 25."); settle(q)
  assert(#reps(q) == 0, "reward window open")
  q.event("QUEST_TURNED_IN", 7600); q.s.clock = q.s.clock + 4; die(q, 1234); msg(q, "Reputation with Stormwind increased by 25."); settle(q)
  assert(#reps(q) == 0, "4 s after a turn-in")
  q.s.clock = q.s.clock + 6; die(q, 1234); msg(q, "Reputation with Stormwind increased by 25."); settle(q)
  assert(#reps(q) == 1, "past 5 s: " .. dump(q.events()))
  local w = kr()
  die(w, 1234); msg(w, "Reputation with Stormwind increased by 25."); w.s.quest = 7600; w.event("QUEST_COMPLETE"); w.event("QUEST_TURNED_IN", 7600); settle(w)
  assert(#reps(w) == 0, "a turn-in during the wait")
  local fin = kr()
  fin.s.quest = 7600; fin.event("QUEST_COMPLETE"); fin.event("QUEST_FINISHED")
  fin.s.clock = fin.s.clock + 6; die(fin, 1234); msg(fin, "Reputation with Stormwind increased by 25."); settle(fin)
  assert(#reps(fin) == 1, "the reward window closed without a turn-in, 6 s ago")

  -- the name table: never read in combat; a name it does not know reads it again out of combat, at most once a minute
  local c = kr()
  local before = c.s.walks
  c.s.factions[#c.s.factions + 1] = { id = 470, name = "Ratchet", st = 100 }
  c.s.combat = true
  die(c, 1234); msg(c, "Reputation with Ratchet increased by 25."); settle(c)
  assert(#reps(c) == 0 and c.s.walks == before, "in combat: not read, nothing recorded")
  c.s.combat = false; c.s.clock = c.s.clock + 60; c.event("PLAYER_REGEN_ENABLED")
  assert(c.s.walks > before, "read again when combat ends")
  before = c.s.walks
  c.s.clock = c.s.clock + 5; die(c, 1234); msg(c, "Reputation with Ratchet increased by 25."); settle(c)
  assert(#reps(c) == 1 and reps(c)[1].f == 470 and c.s.walks == before, dump(reps(c)))
  c.s.factions[#c.s.factions + 1] = { id = 471, name = "Gadgetzan", st = 100 }
  c.s.clock = c.s.clock + 5; die(c, 1234); msg(c, "Reputation with Nowhere increased by 25."); settle(c)
  local afterMiss = c.s.walks
  assert(afterMiss == before, "a miss within the minute: not read again")
  c.s.clock = c.s.clock + 5; die(c, 1234); msg(c, "Reputation with Gadgetzan increased by 25."); settle(c)
  assert(#reps(c) == 1 and c.s.walks == afterMiss, "still within the minute")
  c.s.clock = c.s.clock + 61; die(c, 1234); msg(c, "Reputation with Gadgetzan increased by 25."); settle(c)
  assert(#reps(c) == 2 and reps(c)[2].f == 471 and c.s.walks > afterMiss, dump(reps(c)))
  -- combat state unknown or secret: the list is never read
  local u = kr()
  u.G.InCombatLockdown = function() return SECRET end
  u.s.clock = u.s.clock + 61; u.event("PLAYER_ENTERING_WORLD")
  local n0 = u.s.walks
  u.s.factions[#u.s.factions + 1] = { id = 470, name = "Ratchet", st = 100 }
  die(u, 1234); msg(u, "Reputation with Ratchet increased by 25."); settle(u)
  assert(#reps(u) == 0 and u.s.walks == n0, "secret combat state: no read")

  -- a translation that names the amount first (%2$d ... %1$s)
  local de = kr()
  de.G.FACTION_STANDING_INCREASED = "%2$d Ruf bei %1$s gewonnen."
  die(de, 1234); msg(de, "25 Ruf bei Stormwind gewonnen."); settle(de)
  assert(#reps(de) == 1 and reps(de)[1].f == 72 and reps(de)[1].d == 25, dump(reps(de)))
  -- no format strings: the English forms
  local en = kr()
  en.G.FACTION_STANDING_INCREASED, en.G.FACTION_STANDING_DECREASED = nil, nil
  die(en, 1234); msg(en, "Reputation with Stormwind decreased by 10."); settle(en)
  assert(#reps(en) == 1 and reps(en)[1].d == -10, dump(reps(en)))

  -- at most 100 a session
  local many = kr()
  for i = 1, 101 do die(many, 1234); msg(many, "Reputation with Stormwind increased by " .. i .. "."); settle(many, 5) end
  assert(#reps(many) == 100, "100 a session: " .. #reps(many))
  clean(many)
  -- no C_Timer: decided at once, from the deaths before it
  local nt = kr({ globals = { C_Timer = false } })
  nt.G.C_Timer = nil
  die(nt, 1234); msg(nt, "Reputation with Stormwind increased by 25.")
  assert(#reps(nt) == 1, "no C_Timer: " .. dump(nt.events()))
  -- a client without the reputation list: nothing, no error
  local b2 = fresh({ db = nil }); b2.on(); b2.G.InCombatLockdown = function() return false end
  b2.event("PLAYER_ENTERING_WORLD"); b2.s.units.nameplate1 = { guid = MOB, dead = true }; b2.event("UNIT_HEALTH", "nameplate1")
  b2.event("CHAT_MSG_COMBAT_FACTION_CHANGE", "Reputation with Stormwind increased by 25."); b2.drain()
  b2.event("PLAYER_REGEN_ENABLED"); b2.drain()
  assert(#reps(b2) == 0 and not b2.db().lastError, tostring(b2.db().lastError))
  print("OK   kill reputation: one creature id around the faction message, f from a name table read out of combat, d signed; refusals, quests, dedup, caps")
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
  print("OK   no coin amounts, QUEST_TURNED_IN's money, player GUIDs, realms or other players' names; only this character's own name")
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

-- 11b) rolls another player opened: the corpse from the game's loot flags (UNIT_LOOT) and the rolls' end
--      (LOOT_ROLLS_COMPLETE), the boss from the loot history; anything unclear stays without a corpse
do
  local function guidOf(npc, n) return ("Creature-0-4170-36-1234-%d-00001C%04X"):format(npc, n) end
  local A, B, C, BOSS = guidOf(634, 1), guidOf(598, 2), guidOf(1729, 3), guidOf(644, 4)
  local CHEST = "GameObject-0-4170-36-1234-75293-00001C0005"
  local function game(clock)
    local h = fresh(); h.s.itype, h.s.iid, h.s.difficulty = "party", 36, 1
    h.s.clock = clock or 1000                   -- past the warm-up (recording began at 100)
    h.s.can, h.s.hist = {}, {}
    h.G.CanLootUnit = function(guid) local v = h.s.can[guid]; if v ~= nil then return v, false end end
    h.G.C_LootHistory = {
      GetAllEncounterInfos = function()
        local out = {}
        for id in pairs(h.s.hist) do out[#out + 1] = { encounterID = id } end
        return out
      end,
      GetSortedDropsForEncounter = function(id)
        local out = {}
        for _, key in ipairs(h.s.hist[id] or {}) do out[#out + 1] = { lootListKey = key } end
        return out
      end }
    return h
  end
  local function flagged(h, guid, has) h.s.can[guid] = has; h.event("UNIT_LOOT", guid, has) end
  local function tick(h, sec) h.s.clock = h.s.clock + sec end
  -- START_LOOT_ROLL for each { item id, lootHandle }, filed in the loot history under enc (0: no encounter); then the
  -- burst settles and is recorded: the event it made
  local function start(h, list, enc)
    for _, r in ipairs(list) do
      h.s.nextRoll = (h.s.nextRoll or 0) + 1
      h.s.rolls[h.s.nextRoll] = { link = item(r[1], 1).link, n = 1 }
      if enc and r[2] then h.s.hist[enc] = h.s.hist[enc] or {}; table.insert(h.s.hist[enc], r[2]) end
      h.event("START_LOOT_ROLL", h.s.nextRoll, 60000, r[2])
    end
    h.drain()
    local ev = h.events()
    return ev[#ev]
  end
  local function over(h, handle, after) tick(h, after or 20); h.event("LOOT_ROLLS_COMPLETE", handle) end
  local function settle(h) tick(h, 0.4); h.drain(); h.drain() end
  local function unknown(e) return e.src.kind == "other" and e.src.via == "roll" and not e.src.guid and not e.src.npc and not e.src.by end
  local function fine(...) for _, h in ipairs({ ... }) do assert(not h.db().lastError, tostring(h.db().lastError)) end end

  -- flip: of the corpses flagged when the rolls began, one loses its flag right as they end
  local h = game()
  assert(h.registered.UNIT_LOOT and h.registered.LOOT_ROLLS_COMPLETE, "flag events registered")
  flagged(h, A, true); flagged(h, B, true)
  local e = start(h, { { 10401, 501 } }, 0)
  assert(unknown(e) and not e.src.encounter, dump(e.src))
  over(h, 501); tick(h, 0.04); flagged(h, A, false)
  assert(unknown(e), "not before a flip has had its time: " .. dump(e.src))
  settle(h)
  assert(e.src.kind == "mob" and e.src.npc == 634 and e.src.guid == A and e.src.by == "flip" and e.src.via == "roll"
         and e.src.threshold == 2 and #e.items == 1 and e.items[1].id == 10401, dump(e))
  -- two left and no flip; then two flips at once: no corpse
  flagged(h, C, true)
  e = start(h, { { 10402, 502 } }, 0); over(h, 502); settle(h)
  assert(unknown(e), "two candidates, no flip: " .. dump(e.src))
  e = start(h, { { 10403, 503 } }, 0); over(h, 503); tick(h, 0.05); flagged(h, B, false); flagged(h, C, false); settle(h)
  assert(unknown(e), "two flips: " .. dump(e.src))
  -- one emptied while the rolls ran (not near a roll's end) is out; the other's flip at the end still names it
  flagged(h, B, true); flagged(h, C, true)
  e = start(h, { { 10404, 504 } }, 0); tick(h, 5); flagged(h, C, false); over(h, 504); tick(h, 0.04); flagged(h, B, false); settle(h)
  assert(e.src.guid == B and e.src.npc == 598 and e.src.by == "flip", dump(e.src))
  -- a late flip (past FLIP seconds) names nothing, and a corpse's roll list counts once
  flagged(h, C, true); flagged(h, A, true)
  e = start(h, { { 10405, 505 } }, 0); over(h, 505); tick(h, 0.6); flagged(h, C, false); settle(h)
  assert(unknown(e), "a late flip: " .. dump(e.src))
  flagged(h, C, true)
  e = start(h, { { 10406, 506 } }, 0); over(h, 506); tick(h, 0.04); flagged(h, A, false); settle(h)
  assert(unknown(e), "A's roll list is recorded already: " .. dump(e.src))
  -- a loot window of ours just then explains the lost flag: no flip
  flagged(h, A, true)
  e = start(h, { { 10407, 507 } }, 0); over(h, 507); tick(h, 0.02)
  h.s.units.target = { guid = C, dead = true }
  h.loot({ item(4500, 1, { C, 1 }) }); flagged(h, C, false); settle(h)
  assert(unknown(e), "our own window emptied it: " .. dump(e.src))

  -- sole: the only one flagged from start to end, nothing else lost its flag, and the game still says it holds loot
  local s = game(); flagged(s, C, true)
  e = start(s, { { 10410, 510 } }, 0); over(s, 510); settle(s)
  assert(e.src.guid == C and e.src.npc == 1729 and e.src.kind == "mob" and e.src.by == "sole" and e.src.threshold == 2, dump(e.src))
  flagged(s, C, false); flagged(s, B, true); s.s.can[B] = nil
  e = start(s, { { 10411, 511 } }, 0); over(s, 511); settle(s)
  assert(unknown(e), "the game no longer answers for it: " .. dump(e.src))
  s.s.can[B] = true; flagged(s, A, true)
  e = start(s, { { 10412, 512 } }, 0); tick(s, 5); flagged(s, A, false); over(s, 512); settle(s)
  assert(unknown(e), "another lost its flag while the rolls ran: " .. dump(e.src))
  e = start(s, { { 10413, 513 } }, 0); over(s, 513); settle(s)
  assert(e.src.guid == B and e.src.by == "sole", dump(e.src))
  -- a corpse flagged on another map is no candidate; a chest that is flagged is one
  local m = game(); flagged(m, A, true); m.s.iid = 48; flagged(m, B, true)
  e = start(m, { { 10414, 514 } }, 0); over(m, 514); settle(m)
  assert(e.src.guid == B and e.src.by == "sole" and e.where.map == 48, dump(e))
  flagged(m, CHEST, true)
  e = start(m, { { 10415, 515 } }, 0); over(m, 515); tick(m, 0.04); flagged(m, CHEST, false); settle(m)
  assert(e.src.kind == "chest" and e.src.object == 75293 and e.src.guid == CHEST and e.src.by == "flip", dump(e.src))

  -- two corpses in one burst: one loses its flag right after one roll's end while another roll still runs
  local x = game(); flagged(x, A, true); flagged(x, B, true)
  e = start(x, { { 10420, 520 }, { 10421, 521 } }, 0)
  assert(#e.items == 2, dump(e.items))
  over(x, 520, 10); tick(x, 0.05); flagged(x, A, false); over(x, 521, 10); tick(x, 0.05); flagged(x, B, false); settle(x)
  assert(unknown(e), "a mixed burst: " .. dump(e.src))
  -- a roll without a handle, the warm-up after recording starts, and too many flags to hold: no corpse
  flagged(x, A, true)
  e = start(x, { { 10422, 522 }, { 10423 } }, 0); over(x, 522); tick(x, 0.04); flagged(x, A, false); settle(x)
  assert(unknown(e), "a roll without a handle: " .. dump(e.src))
  local warm = game(300); flagged(warm, A, true); flagged(warm, B, true)
  e = start(warm, { { 10424, 524 } }, 0); over(warm, 524); tick(warm, 0.04); flagged(warm, A, false); settle(warm)
  assert(unknown(e), "warm-up: " .. dump(e.src))
  tick(warm, 600)
  e = start(warm, { { 10425, 525 } }, 0); over(warm, 525); tick(warm, 0.04); flagged(warm, B, false); settle(warm)
  assert(e.src.guid == B and e.src.by == "flip", "after the warm-up: " .. dump(e.src))
  warm.cmd("track drops off"); warm.cmd("track drops on"); flagged(warm, C, true)
  e = start(warm, { { 10426, 526 } }, 0); over(warm, 526); tick(warm, 0.04); flagged(warm, C, false); settle(warm)
  assert(unknown(e), "switched off and on: the flags start again: " .. dump(e.src))
  local full = game()
  for i = 1, 401 do flagged(full, guidOf(598, 100 + i), true) end
  flagged(full, A, true)
  e = start(full, { { 10427, 527 } }, 0); over(full, 527); tick(full, 0.04); flagged(full, A, false); settle(full)
  assert(unknown(e), "the flags overflowed: " .. dump(e.src))

  -- the boss from the loot history: nobody targeted it at ENCOUNTER_END, so there is no kill to give the list to
  local b = game(); flagged(b, BOSS, true); flagged(b, B, true)
  e = start(b, { { 872, 530 }, { 873, 531 } }, 2741)
  assert(e.src.kind == "other" and not e.src.guid and e.src.encounter == 2741 and #e.items == 2, dump(e))
  over(b, 530, 10); settle(b)
  assert(e.src.kind == "other", "one roll still runs: " .. dump(e.src))
  over(b, 531, 5); tick(b, 0.04); flagged(b, BOSS, false); settle(b)
  assert(e.src.kind == "boss" and e.src.npc == 644 and e.src.guid == BOSS and e.src.encounter == 2741 and e.src.by == "flip"
         and e.src.threshold == 2, dump(e.src))
  b.s.units.target = { guid = BOSS, dead = true }
  b.loot({ item(4500, 1, { BOSS, 1 }) })
  local w = b.events()[#b.events()]
  assert(w.src.kind == "boss" and w.src.via == "slot" and w.src.encounter == 2741, "our own window on it after: " .. dump(w.src))
  -- a kill found at ENCOUNTER_END gets only the rolls the history files under its encounter
  local k = game(); k.s.units.party1target = { guid = BOSS }
  k.event("ENCOUNTER_START", 2741, "Rhahk Zor", 1, 5)
  k.event("ENCOUNTER_END", 2741, "Rhahk Zor", 1, 5, 1)
  k.s.units.party1target.dead = true
  k.drain()
  e = start(k, { { 10430, 540 } }, 0)
  assert(unknown(e), "a trash corpse after the kill is not the boss: " .. dump(e.src))
  e = start(k, { { 872, 541 } }, 2741)
  assert(e.src.kind == "boss" and e.src.guid == BOSS and e.src.encounter == 2741 and not e.src.by, dump(e.src))

  -- a window of ours that shows one of the items names the list first; the flags change nothing after
  local n = game(); flagged(n, A, true); flagged(n, B, true)
  e = start(n, { { 10440, 550 } }, 0)
  n.s.units.target = { guid = B, dead = true }
  n.loot({ item(10440, 1, { B, 1 }) })
  assert(e.src.guid == B and not e.src.by, dump(e.src))
  over(n, 550); tick(n, 0.04); flagged(n, A, false); settle(n)
  assert(e.src.guid == B and not e.src.by, dump(e.src))
  -- a client without the loot history or CanLootUnit: the flip alone still names it, "sole" never
  local old = game(); old.G.C_LootHistory, old.G.CanLootUnit = nil, nil
  flagged(old, A, true)
  e = start(old, { { 10450, 560 } }); over(old, 560); settle(old)
  assert(unknown(e), "no CanLootUnit: " .. dump(e.src))
  e = start(old, { { 10451, 561 } }); over(old, 561); tick(old, 0.04); flagged(old, A, false); settle(old)
  assert(e.src.guid == A and e.src.by == "flip" and not e.src.encounter, dump(e.src))
  -- what we emptied ourselves while the rolls ran is out but rules nothing out; and "sole" goes by what the game said
  -- at the rolls' end, also when we empty that corpse right after
  local mine = game(); flagged(mine, A, true); flagged(mine, B, true)
  e = start(mine, { { 10460, 570 } }, 0); tick(mine, 5)
  mine.s.units.target = { guid = B, dead = true }
  mine.loot({ item(4500, 1, { B, 1 }) }); flagged(mine, B, false)
  over(mine, 570); tick(mine, 0.1)
  mine.s.units.target = { guid = A, dead = true }
  mine.loot({ item(4501, 1, { A, 1 }) }); flagged(mine, A, false); settle(mine)
  assert(e.src.guid == A and e.src.by == "sole", dump(e.src))
  -- a flag lost as two bursts end together tells neither; lost as another burst ends, it rules nothing out here
  local two = game(); flagged(two, A, true); flagged(two, B, true)
  local e1 = start(two, { { 10470, 580 } }, 0); tick(two, 5)
  local e2 = start(two, { { 10471, 581 } }, 0)
  over(two, 580, 10); over(two, 581, 0.1); tick(two, 0.1); flagged(two, A, false); settle(two)
  assert(unknown(e1) and unknown(e2), dump(e1.src) .. dump(e2.src))
  flagged(two, C, true)                          -- B and C; the first burst is C's, the second B's
  e1 = start(two, { { 10472, 582 } }, 0); tick(two, 5)
  e2 = start(two, { { 10473, 583 } }, 0)
  over(two, 582, 10); tick(two, 0.1); flagged(two, C, false)
  over(two, 583, 5); settle(two)
  assert(e1.src.guid == C and e1.src.by == "flip" and e2.src.guid == B and e2.src.by == "sole", dump(e1.src) .. dump(e2.src))

  -- a boss encounter this session saw end: the corpse flagged right then is the one, at once (no kill was found)
  local SHRED, SNEED = guidOf(642, 5), guidOf(643, 6)
  local function killed(g, id, corpses)
    g.event("ENCOUNTER_START", id, "Boss", 1, 5); tick(g, 60)
    g.event("ENCOUNTER_END", id, "Boss", 1, 5, 1); tick(g, 0.03)
    for _, c in ipairs(corpses) do flagged(g, c, true) end
    g.drain(); tick(g, 8)
  end
  local one = game(300); flagged(one, B, true)   -- also inside the warm-up: the encounter's end was seen
  killed(one, 2741, { BOSS })
  e = start(one, { { 872, 590 } }, 2741)
  assert(e.src.kind == "boss" and e.src.npc == 644 and e.src.guid == BOSS and e.src.encounter == 2741 and e.src.by == "end"
         and e.src.threshold == 2, dump(e.src))
  e = start(one, { { 10480, 591 } }, 0); over(one, 591); tick(one, 0.1); flagged(one, B, false); settle(one)
  assert(unknown(e), "trash after it, inside the warm-up: " .. dump(e.src))
  -- a boss of two bodies (Sneed's Shredder, then Sneed): two bursts, each to its own corpse
  local sn = game(); flagged(sn, C, true)
  killed(sn, 2742, { SHRED, SNEED })
  e1 = start(sn, { { 1937, 601 } }, 2742); tick(sn, 7)
  e2 = start(sn, { { 273293, 602 }, { 253912, 603 } }, 2742)
  assert(e1.src.kind == "other" and e1.src.encounter == 2742 and e2.src.kind == "other" and #e2.items == 2, dump(e1.src) .. dump(e2.src))
  over(sn, 603, 40); over(sn, 602, 0.8); tick(sn, 0.17); flagged(sn, SNEED, false)
  over(sn, 601, 0.7); settle(sn)
  assert(e2.src.kind == "boss" and e2.src.npc == 643 and e2.src.guid == SNEED and e2.src.by == "flip" and e2.src.encounter == 2742, dump(e2.src))
  assert(e1.src.kind == "boss" and e1.src.npc == 642 and e1.src.guid == SHRED and e1.src.by == "sole" and e1.src.encounter == 2742, dump(e1.src))
  -- the encounter ended in front of us but none of its corpses is flagged (any more): another corpse is never taken
  local none = game(); flagged(none, B, true)
  killed(none, 2741, {})
  e = start(none, { { 872, 610 } }, 2741); over(none, 610); tick(none, 0.1); flagged(none, B, false); settle(none)
  assert(e.src.kind == "other" and not e.src.guid and e.src.encounter == 2741, dump(e.src))
  fine(h, s, m, x, warm, full, b, k, n, old, mine, two, one, sn, none)
  print("OK   rolls another player opened: the corpse by its loot flag (flip, sole), the boss by the loot history; never a guess")
end

-- 10) a client without the APIs: nothing breaks, nothing bogus is stored
do
  local h = fresh({ noApi = true })
  h.cmd("track drops on"); h.cmd("track drops yes")
  for _, e in ipairs({ "LOOT_OPENED", "LOOT_CLOSED", "UNIT_SPELLCAST_SUCCEEDED", "QUEST_DETAIL", "QUEST_ACCEPTED", "QUEST_PROGRESS", "QUEST_COMPLETE", "QUEST_ITEM_UPDATE", "QUEST_FINISHED",
                       "QUEST_TURNED_IN", "MERCHANT_SHOW", "MERCHANT_CLOSED", "INSTANCE_ENCOUNTER_ENGAGE_UNIT", "ENCOUNTER_START",
                       "ENCOUNTER_END", "START_LOOT_ROLL", "UNIT_LOOT", "LOOT_ROLLS_COMPLETE", "CHAT_MSG_LOOT", "TRAINER_SHOW", "TRAINER_UPDATE", "TRAINER_CLOSED",
                       "TAXIMAP_OPENED", "TAXIMAP_CLOSED", "PLAYER_CONTROL_LOST", "PLAYER_CONTROL_GAINED",
                       "PLAYER_TARGET_CHANGED", "UPDATE_MOUSEOVER_UNIT", "PLAYER_INTERACTION_MANAGER_FRAME_SHOW", "CONFIRM_BINDER",
                       "HEARTHSTONE_BOUND", "PLAYER_REGEN_DISABLED", "CHAT_MSG_COMBAT_FACTION_CHANGE", "PLAYER_ENTERING_WORLD", "PLAYER_REGEN_ENABLED" }) do
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
  -- inside an instance (1.21.0): kept, under the instance map and difficulty, with no cell; a place with neither is not
  do
    local g = fresh(); g.on(); g.s.units.target = wolf(); g.s.itype, g.s.iid, g.s.difficulty = "party", 36, 1
    g.event("PLAYER_TARGET_CHANGED"); g.event("UPDATE_MOUSEOVER_UNIT")
    local n = g.db().npcs[525]
    assert(n and n.name == "Mangy Wolf" and n.cells == nil and dump(n.inst) == "{36:1=1}" and not g.db().lastError,
           "inside an instance: " .. dump(g.db().npcs) .. " " .. tostring(g.db().lastError))
  end
  none({}, nil, function(g) g.s.itype, g.s.iid, g.s.x, g.s.y = "party", 0, nil, nil end)
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
  print("OK   npcs: never players, pets, guardians, totems, companions, objects, secrets or while off; players leave at once; inside an instance by map and difficulty")

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
  -- while off; a gossip window is no service and its text is never read
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
  do                                            -- inside an instance (1.21.0): the service is kept with the instance
    local x = fresh(); x.on(); x.s.units.npc = { guid = TAILOR, level = 30 }; x.s.itype, x.s.iid = "party", 36
    x.event("PLAYER_INTERACTION_MANAGER_FRAME_SHOW", 5)
    local n = (x.db().npcs or {})[1346]
    assert(n and svc(n) == "vendor" and dump(n.inst) == "{36:0=1}" and n.cells == nil and not x.db().lastError,
           "a service inside an instance: " .. dump(x.db().npcs) .. tostring(x.db().lastError))
  end
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

-- Hunter tames (1.20.0): the beast from the target's GUID when Tame Beast began, the new pet's book, speed and diet.
do
  local BEAST = "Creature-0-4170-0-1234-3825-000012AC01"
  local PETG = "Pet-0-4170-0-1234-3825-0100AABBCC"
  local names = { [1515] = "Tame Beast", [883] = "Call Pet", [982] = "Revive Pet", [17253] = "Bite", [17255] = "Bite", [2649] = "Growl",
                  [2] = "Not Attack" }
  local function beast(lv) return { guid = BEAST, level = lv or 12, fam = 1, famName = "Wolf", ct = 1, name = "Example Wolf" } end
  local function hunter(opts)
    local h = fresh(opts)
    local s, G = h.s, h.G
    G.UnitClass = function() return "Hunter", "HUNTER", 3 end
    G.GetSpellInfo = function(id) return names[id] end
    G.GetLocale = function() return "enUS" end
    -- the pet's book (old API): { name, rank, spell id, pet action id }; Attack is a command, its action id names no spell
    s.book = { { "Bite", "Rank 1", 17253 }, { "Growl", "Rank 1", 2649 }, { "Attack", nil, nil, 0x07000002 } }
    G.HasPetSpells = function() if s.units.pet then return #s.book, "PET" end end
    G.GetSpellBookItemName = function(i, b) assert(b == "pet", "the pet's book"); local x = s.book[i]; if x then return x[1], x[2], x[3] end end
    G.GetSpellBookItemInfo = function(i) local x = s.book[i]; if x then return x[4] and "PETACTION" or "SPELL", x[4] or x[3] end end
    G.C_PetInfo = { GetPetFoodTypes = function() return s.diet end }
    G.UnitAura = function(u, _, f) local x = s.units[u]; return x and x.auras and x.auras[f] or nil end
    s.diet = { "Meat", "Fish" }
    s.units.target = beast()
    return h
  end
  -- a fresh tame keeps the beast's name and level
  local function newPet(extra)
    local p = { guid = PETG, fam = 1, famName = "Wolf", speed = 1.5, name = "Example Wolf", level = 12 }
    for k, v in pairs(extra or {}) do p[k] = v end
    return p
  end
  -- SENT names the cast's target, the channel starts and ends, and the pet comes; sent = false: SENT gives no name
  local function tame(h, p, spell, sent)
    local t = h.s.units.target
    if sent == nil then sent = t and t.name or "" elseif sent == false then sent = "" end
    h.event("UNIT_SPELLCAST_SENT", "player", sent, "Cast-3-4170-0-1-1515-0000AAAA", spell or 1515)
    h.event("UNIT_SPELLCAST_CHANNEL_START", "player", "Cast-3-4170-0-1-1515-0000AAAA", spell or 1515)
    h.s.x = 0.9                                      -- the beast's place is where the tame began, not where it ended
    h.s.units.target = nil
    h.event("UNIT_SPELLCAST_CHANNEL_STOP", "player", "Cast-3-4170-0-1-1515-0000AAAA", spell or 1515)
    h.s.units.pet = p or newPet()
    h.event("UNIT_PET", "player")
  end
  local function later(h) h.s.clock = h.s.clock + 61; h.drain() end   -- every read the minute allows, then the record

  local h = hunter()
  tame(h)
  assert(#h.events() == 0, "one read of the book is not enough: it waits for a second that agrees")
  h.drain()
  local e = h.events()[1]
  assert(e and e.type == "tame" and e.npc == 3825 and e.lv == 12 and e.fam == 1 and e.spd == 150 and e.spdAura == nil
         and e.where.x == 0.4123 and e.who.class == 3 and e.loc == "enUS", dump(e) .. tostring(h.db().lastError))
  assert(dump(e.spells) == "{1={name=Growl,rank=Rank 1,s=2649},2={name=Bite,rank=Rank 1,s=17253}}", dump(e.spells))
  assert(dump(e.diet) == "{1=Fish,2=Meat}", "the diet, sorted")
  assert(not dump(e):find("Pet%-") and not dump(e):find("Creature%-") and not dump(h.db()):find("Example Wolf"), "no GUID, no name")
  local key = h.db().textSeen.tame.keys[1]
  assert(key:match("^3825:12:%x+$") and #key == 24, "the dedup key: npc:lv:checksum " .. key)
  h.s.units.pet = nil
  h.s.units.target = beast()
  tame(h); h.drain()
  assert(#h.events() == 1, "the same beast, level, book and speed once per install")
  h.s.units.pet = nil
  h.s.units.target = beast(13)
  tame(h, newPet({ level = 13 })); h.drain()
  assert(#h.events() == 2 and h.events()[2].lv == 13, "another level is another record")

  -- refusals, each given every read the minute allows: not a hunter, no creature id, someone's creature, a pet out,
  -- another family, too late, Call Pet, interrupted, the cast at another unit, a pet that is not the beast
  local r = fresh()
  r.s.units.target = beast()
  r.G.GetSpellInfo = function(id) return names[id] end
  tame(r)
  later(r)
  assert(#r.events() == 0 and not r.db().lastError, "a rogue's pet (or anything) is not a tame")
  local function refused(setup, label)
    local x = hunter()
    setup(x)
    later(x)
    assert(#x.events() == 0 and not x.db().lastError, label .. ": " .. dump(x.events()[1]) .. " " .. tostring(x.db().lastError))
  end
  refused(function(x) x.s.units.target = nil; tame(x) end, "no target: the creature id is never guessed")
  refused(function(x) x.s.units.target.guid = PLAYER; tame(x) end, "a player's GUID")
  refused(function(x) x.s.units.target.guid = "Vignette-0-4170-0-1-3825-0000AAAA"; tame(x) end, "not a creature GUID")
  refused(function(x) x.s.units.target.controlled = true; tame(x) end, "a creature someone controls")
  refused(function(x) x.s.units.pet = newPet(); x.event("UNIT_SPELLCAST_CHANNEL_START", "player", "c", 1515)
                      x.s.units.pet = newPet({ guid = PETG .. "0" }); x.event("UNIT_PET", "player") end, "a pet already out")
  refused(function(x) tame(x, newPet({ fam = 2, famName = "Cat" })) end, "a pet of another family")
  refused(function(x)
    x.event("UNIT_SPELLCAST_CHANNEL_START", "player", "c", 1515)
    x.s.clock = x.s.clock + 31
    x.s.units.pet = newPet(); x.event("UNIT_PET", "player")
  end, "a pet more than 30 s later")
  refused(function(x)
    x.event("UNIT_SPELLCAST_CHANNEL_START", "player", "c", 1515)
    x.event("UNIT_SPELLCAST_START", "player", "c", 883)
    x.s.units.pet = newPet(); x.event("UNIT_PET", "player")
  end, "Call Pet in between")
  refused(function(x)
    x.event("UNIT_SPELLCAST_CHANNEL_START", "player", "c", 1515)
    x.event("UNIT_SPELLCAST_INTERRUPTED", "player", "c", 1515)
    x.s.units.pet = newPet(); x.event("UNIT_PET", "player")
  end, "an interrupted tame")
  refused(function(x) x.event("UNIT_SPELLCAST_CHANNEL_START", "player", "c", 999); x.s.units.pet = newPet(); x.event("UNIT_PET", "player") end,
          "another spell")
  refused(function(x) x.event("UNIT_SPELLCAST_CHANNEL_START", "party1", "c", 1515); x.s.units.pet = newPet(); x.event("UNIT_PET", "player") end,
          "someone else's tame")
  refused(function(x)
    x.s.book = {}
    tame(x)
    x.s.units.pet = nil; x.event("UNIT_PET", "player")
    x.drain()
  end, "the pet gone before it was read")
  refused(function(x) x.cmd("track drops off"); tame(x) end, "tracking off")
  -- T1: a mouseover (or focus) macro tamed another wolf while this one was targeted. The client names the cast's target
  -- in UNIT_SPELLCAST_SENT; without that, the pet's name, level and creature id must still be the target's.
  refused(function(x) x.G.UnitCreatureID = function(u) if u == "pet" then return 3826 end end
                      tame(x, newPet({ name = "Other Wolf", level = 14 }), nil, "Other Wolf") end, "T1: a mouseover-macro tame")
  refused(function(x) tame(x, nil, nil, "Other Wolf") end, "T1: SENT named another unit than the target")
  refused(function(x) tame(x, newPet({ name = "Other Wolf" }), nil, false) end, "T1: the pet is not named as the target was")
  refused(function(x) tame(x, newPet({ level = 14 }), nil, false) end, "T1: the pet's level is not the target's")
  refused(function(x) x.G.UnitCreatureID = function(u) if u == "pet" then return 3826 end end; tame(x, nil, nil, false) end,
          "T1: the pet's creature id is not the target's")
  -- T2: a tame broken without INTERRUPTED (only CHANNEL_STOP), then a stabled pet of the same kind taken out 20 s later
  refused(function(x)
    x.event("UNIT_SPELLCAST_SENT", "player", "Example Wolf", "c", 1515)
    x.event("UNIT_SPELLCAST_CHANNEL_START", "player", "c", 1515)
    x.event("UNIT_SPELLCAST_CHANNEL_STOP", "player", "c", 1515)
    x.s.clock = x.s.clock + 20
    x.s.units.pet = newPet({ guid = PETG .. "1" }); x.event("UNIT_PET", "player")
  end, "T2: a broken channel, then a stabled pet")
  refused(function(x)
    local name = x.G.UnitName
    x.G.UnitName = function(u) if u == "target" then return nil end; return name(u) end
    tame(x)
  end, "no target name to compare with the pet's")
  -- what may pass: the pet a second after the channel's end; a creature id, as a number or a string, that agrees
  local slow = hunter()
  slow.event("UNIT_SPELLCAST_CHANNEL_START", "player", "c", 1515)
  slow.event("UNIT_SPELLCAST_CHANNEL_STOP", "player", "c", 1515)
  slow.s.clock = slow.s.clock + 1
  slow.s.units.pet = newPet(); slow.event("UNIT_PET", "player"); slow.drain()
  assert(#slow.events() == 1, "the pet a second after the channel ended")
  for _, id in ipairs({ 3825, "3825" }) do
    local same = hunter()
    same.G.UnitCreatureID = function(u) if u == "pet" then return id end end
    tame(same, newPet({ level = false })); same.drain()
    assert(#same.events() == 1 and same.events()[1].lv == 12, "the same creature id; a pet level that cannot be read")
  end
  local full = hunter({ db = { events = { { t = 1767225600, padding = string.rep("x", 1000000) } } } })
  tame(full); later(full)
  assert(#full.events() == 1 and not full.db().lastError, "past the half caps")

  -- a book that fills later, a fight, then auras: read again every 2 s, up to 60 s, then recorded with what was read
  local w = hunter()
  w.s.book = {}
  tame(w, newPet({ combat = true }))
  assert(#w.events() == 0, "waits for the book and a calm speed")
  w.s.book = { { "Bite", "Rank 2", 17253 } }
  w.drain()
  assert(#w.events() == 0, "the book is in, the speed not yet")
  w.s.units.pet.combat, w.s.units.pet.auras = false, { HELPFUL = "Aspect of the Wild" }
  w.s.units.pet.speed = 2.0
  w.drain()
  assert(#w.events() == 0, "a speed read with an aura waits for a bare one")
  w.s.clock = w.s.clock + 61
  w.drain()
  e = w.events()[1]
  assert(e and e.spd == 200 and e.spdAura == true and e.spells[1].rank == "Rank 2" and #e.spells == 1, dump(e))
  local bare = hunter()
  bare.s.book = {}
  tame(bare, newPet({ auras = { HARMFUL = "Slow" } }))
  bare.s.book = { { "Bite", "Rank 2", 17253 } }
  bare.event("PET_BAR_UPDATE")
  assert(#bare.events() == 0, "the slowed speed is not kept as bare")
  bare.s.units.pet.auras = nil
  bare.event("SPELLS_CHANGED")
  e = bare.events()[1]
  assert(e and e.spd == 150 and e.spdAura == nil, dump(e))
  -- a book still filling: kept only once two reads in a row agree; one that never settles is left out (not read)
  local filling = hunter()
  filling.s.book = { { "Bite", "Rank 1", 17253 } }
  tame(filling)
  filling.s.book = { { "Bite", "Rank 1", 17253 }, { "Growl", "Rank 1", 2649 } }
  filling.event("PET_BAR_UPDATE")
  assert(#filling.events() == 0, "a book that changed between two reads is not in yet")
  filling.drain()
  e = filling.events()[1]
  assert(e and #e.spells == 2, "the book once two reads agree: " .. dump(e))
  local moving = hunter()
  local n = 0
  moving.G.GetSpellBookItemName = function(i) n = n + 1; if i == 1 then return "Bite", "Rank " .. n, 17253 end end
  tame(moving); later(moving)
  e = moving.events()[1]
  assert(e and e.spells == nil and e.spd == 150, "a book that never settles: no spells " .. dump(e))
  -- no speed at all (the pet fought the whole minute), no diet API: still the beast, its level, family and book
  local fight = hunter()
  fight.G.C_PetInfo = nil
  tame(fight, newPet({ combat = true }))
  fight.s.clock = fight.s.clock + 60
  fight.drain()
  e = fight.events()[1]
  assert(e and e.npc == 3825 and e.spd == nil and e.spdAura == nil and e.diet == nil and #e.spells == 2, dump(e))
  -- the player in combat the whole minute, the pet calm: no speed either
  local busy = hunter()
  busy.s.units.player = { combat = true }
  tame(busy); later(busy)
  e = busy.events()[1]
  assert(e and e.spd == nil and #e.spells == 2, "the player in combat: no speed " .. dump(e))
  -- without a timer: one read at once
  local now = hunter()
  now.G.C_Timer = nil
  now.s.book = {}
  tame(now, newPet({ combat = true }))
  e = now.events()[1]
  assert(e and e.spells == nil and e.spd == nil and dump(e.diet) == "{1=Fish,2=Meat}", dump(e))

  -- the modern book (C_SpellBook, Enum.SpellBookSpellBank.Pet) and auras (C_UnitAuras); a future spell is not the pet's
  local m = hunter()
  m.G.HasPetSpells, m.G.GetSpellBookItemName = nil, nil
  m.G.Enum.SpellBookSpellBank = { Player = 0, Pet = 1 }
  m.G.Enum.SpellBookItemType = { None = 0, Spell = 1, FutureSpell = 2, PetAction = 3, Flyout = 4 }
  m.G.C_SpellBook = {
    HasPetSpells = function() return 4, "PET" end,
    GetSpellBookItemInfo = function(i, bank)
      assert(bank == 1, "the pet's bank")
      return ({ { name = "Bite", subName = "Rank 3", itemType = 3, actionID = 16777216.0 * 129 + 17253 },   -- 0x81 (autocast) in the high byte; a float, as WoW numbers are
                { name = "Growl", subName = "", itemType = 1, spellID = 2649 },
                { name = "Attack", itemType = 3, actionID = 0x07000002 },
                { name = "Bite", subName = "Rank 4", itemType = 2, spellID = 17255 } })[i]   -- a future rank, its own id
    end }
  local auras = 0
  m.G.C_UnitAuras = { GetAuraDataByIndex = function(u) auras = auras + 1; assert(u == "pet"); return nil end }
  m.G.UnitAura = function() error("C_UnitAuras first") end
  tame(m); m.drain()
  e = m.events()[1]
  assert(e and dump(e.spells) == "{1={name=Growl,s=2649},2={name=Bite,rank=Rank 3,s=17253}}" and e.spd == 150 and auras == 2, dump(e))

  -- secrets and odd values: a secret GUID, pet name or book entry is skipped; a speed, level or locale out of range is left out
  local secret = {}
  local sx = hunter({ globals = { issecretvalue = function(v) return v == secret end } })
  sx.s.units.target.guid = secret
  tame(sx); later(sx)
  assert(#sx.events() == 0, "a secret target GUID")
  local sn = hunter({ globals = { issecretvalue = function(v) return v == secret end } })
  tame(sn, newPet({ name = secret })); later(sn)
  assert(#sn.events() == 0, "a secret pet name")
  local so = hunter({ globals = { issecretvalue = function(v) return v == secret end } })
  so.G.GetLocale = function() return "english" end
  so.s.units.target.level = -1
  so.s.book = { { secret, "Rank 1", 17253 }, { "Growl", secret, 2649 }, { "Bite", "Rank 1", 2649 } }
  so.s.diet = { "Meat", "Me|cffff0000at", secret, "Player-4170-00ABCDEF", "Meat" }
  tame(so, newPet({ speed = 99 }))
  assert(#so.events() == 0, "no usable speed yet: it waits")
  so.s.clock = so.s.clock + 60; so.drain()
  e = so.events()[1]
  assert(e and e.lv == nil and e.spd == nil and e.loc == nil and dump(e.spells) == "{1={name=Growl,s=2649}}" and dump(e.diet) == "{1=Meat}",
         dump(e))

  -- at most 20 a session
  local many = hunter()
  for i = 1, 21 do
    many.s.units.pet = nil
    many.s.units.target = { guid = "Creature-0-4170-0-1234-" .. (5000 + i) .. "-000012AC01", level = 10, fam = 1, famName = "Wolf",
                            name = "Example Wolf" }
    tame(many, newPet({ level = 10 })); many.drain()
  end
  assert(#many.events() == 20, "20 tames a session")

  -- a client without the pet APIs: the beast alone, and no error
  local bareApi = hunter()
  bareApi.G.HasPetSpells, bareApi.G.C_PetInfo, bareApi.G.UnitAura, bareApi.G.UnitAttackSpeed = nil, nil, nil, nil
  tame(bareApi)
  bareApi.s.clock = bareApi.s.clock + 60; bareApi.drain()
  e = bareApi.events()[1]
  assert(e and e.npc == 3825 and not e.spells and not e.spd and not e.diet and not bareApi.db().lastError, dump(e))
  print("OK   tames: the beast by the target's GUID, a pet with its name, level and id; the book read twice alike, bare speed, diet, locale; refusals, caps")
end

-- Objective credit (1.20.0): an objective's count rose and this player's own evidence named one cause.
do
  local function kobold(n, id) return "Creature-0-4170-0-1234-" .. (id or 6) .. "-0000AB" .. string.format("%04X", n) end
  local CRATE = "GameObject-0-4170-0-1234-3719-0000AAAA02"
  local function pelt(id, name) return "|cffffffff|Hitem:" .. id .. "::::::::12:::::|h[" .. name .. "]|h|r" end
  local function quester(opts)
    local h = fresh(opts)
    local s, G = h.s, h.G
    -- s.log: the quest log's rows; s.obj[quest]: its objectives { type, numFulfilled, numRequired, text }; s.bags[item]
    s.log, s.obj, s.bags = { { questID = 0, isHeader = true }, { questID = 100, isHeader = false } }, {}, {}
    s.obj[100] = { { type = "monster", numFulfilled = 0, numRequired = 10, text = "Kobold Vermin slain: 0/10" },
                   { type = "item", numFulfilled = 0, numRequired = 5, text = "Wolf Pelt: 0/5" },
                   { type = "object", numFulfilled = 0, numRequired = 3, text = "Supply Crate searched: 0/3" },
                   { type = "event", numFulfilled = 0, numRequired = 1, text = "Find the camp" } }
    G.C_QuestLog = { GetNumQuestLogEntries = function() return #s.log end, GetInfo = function(i) return s.log[i] end,
                     GetQuestObjectives = function(q) return s.obj[q] end }
    G.UnitIsTapDenied = function(u) local x = s.units[u]; return x and x.tapped or false end
    G.GetItemCount = function(id) return s.bags[id] or 0 end
    h.event("QUEST_LOG_UPDATE"); h.drain()                      -- the baseline
    return h
  end
  local function rise(h, quest, i, f)
    local r = h.s.obj[quest][i]
    r.numFulfilled = f
    r.text = r.text:gsub("%d+/", f .. "/")
    h.event("QUEST_WATCH_UPDATE", 1); h.event("UNIT_QUEST_LOG_CHANGED", "player"); h.event("QUEST_LOG_UPDATE")
    h.drain()
  end
  local function kill(h, n, name, extra)
    local u = { guid = kobold(n, extra and extra.id), dead = true, name = name or "Kobold Vermin" }
    for k, v in pairs(extra or {}) do u[k] = v end
    h.s.units["nameplate" .. n] = u
    h.event("UNIT_HEALTH", "nameplate" .. n)
  end
  local function credits(h) local out = {}; for _, e in ipairs(h.events()) do if e.type == "credit" then out[#out + 1] = e end end; return out end

  -- a kill named in the objective's text
  local h = quester()
  kill(h, 1)
  rise(h, 100, 1, 1)
  local c = credits(h)
  assert(#c == 1, #c .. " " .. tostring(h.db().lastError))
  local e = c[1]
  assert(e.quest == 100 and e.i == 1 and e.rows == 4 and e.ot == "monster" and e.npc == 6 and e.by == "name" and e.item == nil
         and e.where.x == 0.4123 and e.who.class == 4, dump(e))
  local keys = {}; for k in pairs(e) do keys[#keys + 1] = k end; table.sort(keys)
  assert(table.concat(keys, ",") == "b,by,i,id,npc,ot,quest,rows,t,type,where,who", table.concat(keys, ","))
  assert(not dump(e):find("Creature%-") and not dump(e):find("Kobold") and not dump(e):find("slain"), "no GUID, no name, no text")
  assert(not dump(h.db()):find("numFulfilled") and not dump(h.db()):find("Kobold"), "nothing about progress is saved")
  kill(h, 2); rise(h, 100, 1, 2)
  assert(#credits(h) == 1, "the same quest, objective and creature once per install")
  kill(h, 2); rise(h, 100, 1, 3)
  assert(#credits(h) == 1, "a corpse counts once: its second UNIT_HEALTH is no new evidence")
  -- a creature the text does not name, the only one: "sole"
  kill(h, 3, "Kobold Tunneler", { id = 7 }); rise(h, 100, 1, 4)
  c = credits(h)
  assert(#c == 2 and c[2].npc == 7 and c[2].by == "sole", dump(c[2]))

  -- an item: named, with the bags agreeing; a named one whose bag count disagrees is not it
  local it = quester()
  it.s.bags[750] = 1
  it.event("CHAT_MSG_LOOT", "You receive loot: " .. pelt(750, "Wolf Pelt") .. ".")
  it.event("CHAT_MSG_LOOT", "Someone Else receives loot: " .. pelt(751, "Wolf Pelt") .. ".")
  rise(it, 100, 2, 1)
  c = credits(it)
  assert(#c == 1 and c[1].ot == "item" and c[1].item == 750 and c[1].by == "name" and c[1].npc == nil and c[1].rows == 4, dump(c[1]))
  it.s.obj[100][2].text = "Old Pelt: 1/5"
  it.s.bags[753] = 9
  it.event("CHAT_MSG_LOOT", "You receive loot: " .. pelt(753, "Old Pelt") .. ".")
  rise(it, 100, 2, 2)
  assert(#credits(it) == 1, "a named item whose bag count is not the objective's")
  local full = quester()
  full.s.obj[100][2].numRequired, full.s.bags[750] = 1, 4
  full.event("CHAT_MSG_LOOT", "You receive loot: " .. pelt(750, "Wolf Pelt") .. "x4.")
  rise(full, 100, 2, 1)
  assert(#credits(full) == 1 and credits(full)[1].item == 750, "a finished item objective: the bags may hold more")

  -- objects: a window this player opened (gossip) that the objective's text names
  local ob = quester()
  ob.s.units.npc = { guid = CRATE, name = "Supply Crate" }
  ob.event("GOSSIP_SHOW")
  rise(ob, 100, 3, 1)
  c = credits(ob)
  assert(#c == 1 and c[1].ot == "object" and c[1].object == 3719 and c[1].by == "name", dump(c[1]))
  -- an error while noting the object costs nothing else: the gossip is still read
  local oops = quester()
  oops.s.units.npc = { guid = CRATE, name = "Supply Crate" }
  local boom = true                             -- the first look at the object's GUID (credit.Talked's) fails
  oops.G.issecretvalue = function(v) if boom and v == CRATE then boom = false; error("boom") end; return false end
  local gossipRead = false
  oops.G.C_GossipInfo = { GetText = function() gossipRead = true end }
  oops.event("GOSSIP_SHOW")
  assert(gossipRead and not oops.db().lastError, "credit.Talked in its own pcall: " .. tostring(oops.db().lastError))

  -- refusals
  local function none(setup, label)
    local x = quester()
    setup(x)
    assert(#credits(x) == 0 and not x.db().lastError, label .. ": " .. dump(credits(x)[1]) .. " " .. tostring(x.db().lastError))
  end
  none(function(x) kill(x, 1, nil, { tapped = true }); rise(x, 100, 1, 1) end, "another player's tap")
  none(function(x) kill(x, 1, nil, { guid = PLAYER }); rise(x, 100, 1, 1) end, "a player")
  none(function(x) kill(x, 1, nil, { controlled = true }); rise(x, 100, 1, 1) end, "someone's pet")
  none(function(x) kill(x, 1, nil, { dead = false }); rise(x, 100, 1, 1) end, "not dead")
  none(function(x) x.G.UnitIsTapDenied = nil; kill(x, 1); rise(x, 100, 1, 1) end, "no tap API: no evidence")
  none(function(x) kill(x, 1); x.s.clock = x.s.clock + 7; rise(x, 100, 1, 1) end, "evidence older than 6 s")
  none(function(x) rise(x, 100, 1, 1) end, "no evidence")
  none(function(x) kill(x, 1, "Kobold Tunneler", { id = 7 }); x.s.clock = x.s.clock + 7; x.event("UNIT_HEALTH", "nameplate1"); rise(x, 100, 1, 1) end,
       "a corpse counts once: a later UNIT_HEALTH on it is no new evidence")
  none(function(x) kill(x, 1); kill(x, 2, "Kobold Worker", { id = 8 }); x.s.obj[100][1].text = "Kobolds slain: 0/10"; rise(x, 100, 1, 2) end,
       "two creatures, neither named")
  none(function(x) x.G.IsInGroup = function() return true end; kill(x, 1, "Kobold Tunneler", { id = 7 }); rise(x, 100, 1, 1) end,
       "grouped: a member's kill out of sight counts too, so no sole creature")
  none(function(x) kill(x, 1); x.s.obj[100][4].numFulfilled = 1; rise(x, 100, 4, 1) end, "an event objective")
  -- the reviewer's wrong-id cases. C1: solo with a pet out, the pet kills the quest mob out of sight while the player's
  -- own target, another creature, dies; also with the pet dismissed just before
  local PET = { guid = "Pet-0-4170-0-1234-3825-0100AABBCC", name = "Example Wolf" }
  none(function(x) x.s.units.pet = PET; kill(x, 1, "Kobold Tunneler", { id = 7 }); rise(x, 100, 1, 1) end,
       "C1: a pet out: its kill out of sight counts too, so no sole creature")
  none(function(x) x.s.units.pet = PET; x.s.units.pet = nil; x.event("UNIT_PET", "player")
                   x.s.clock = x.s.clock + 3; kill(x, 1, "Kobold Tunneler", { id = 7 }); rise(x, 100, 1, 1) end,
       "C1: a pet dismissed 3 s before")
  -- C2: the quest item came by trade, mail or the bank (no loot line) while an unrelated item was looted; with or without
  -- a bag count that happens to match
  none(function(x) x.G.GetItemCount = nil
                   x.event("CHAT_MSG_LOOT", "You receive loot: " .. pelt(2589, "Linen Cloth") .. "."); rise(x, 100, 2, 1) end,
       "C2: no bag count: the only item looted is no cause")
  none(function(x) x.s.bags[751], x.s.bags[2589] = 1, 1
                   x.event("CHAT_MSG_LOOT", "You receive loot: " .. pelt(2589, "Linen Cloth") .. "."); rise(x, 100, 2, 1) end,
       "C2: an unrelated item's bag count is no cause either")
  -- C3: a herb node opened (a loot window from an object), then an object objective advanced; and an object window the
  -- objective's text does not name
  none(function(x) x.loot({ item(2447, 1, { NODE, 1 }) }); rise(x, 100, 3, 1) end, "C3: a gathered node is no object credit")
  none(function(x) x.s.units.npc = { guid = CRATE, name = "Old Barrel" }; x.event("GOSSIP_SHOW"); rise(x, 100, 3, 1) end,
       "C3: an object window the text does not name")
  none(function(x)
    x.s.obj[100][5] = nil
    for i = 5, 41 do x.s.obj[100][i] = { type = "event", numFulfilled = 0, numRequired = 1, text = "Hold" } end
    x.event("QUEST_LOG_UPDATE"); x.drain()
    kill(x, 1); rise(x, 100, 1, 1)
  end, "more than 40 objectives: no rows to give, no credit")
  none(function(x)
    x.s.log[3] = { questID = 101 }
    x.s.obj[101] = { { type = "monster", numFulfilled = 2, numRequired = 10, text = "Kobold Vermin slain: 2/10" } }
    kill(x, 1); rise(x, 101, 1, 3)
  end, "a quest new to the log: its baseline first")
  none(function(x) rise(x, 100, 1, 3); kill(x, 1); rise(x, 100, 1, 2) end, "a fall is no rise")
  none(function(x) rise(x, 100, 1, 3); rise(x, 100, 1, 0); kill(x, 1); rise(x, 100, 1, 3) end,
       "a fall makes the next read a baseline: a brief 0 while loading, then the real count, is no rise")
  local back = quester()                        -- after that baseline, a real rise is credited again
  rise(back, 100, 1, 3); rise(back, 100, 1, 0); rise(back, 100, 1, 3); kill(back, 1); rise(back, 100, 1, 4)
  assert(#credits(back) == 1 and credits(back)[1].npc == 6, "a rise after the baseline that followed a fall")
  none(function(x) x.cmd("track drops off"); kill(x, 1); rise(x, 100, 1, 1); x.cmd("track drops on"); kill(x, 2); rise(x, 100, 1, 2) end,
       "tracking off, then on: the first scan is a baseline")
  local used = quester()
  used.s.log[3] = { questID = 102 }
  used.s.obj[102] = { { type = "monster", numFulfilled = 0, numRequired = 10, text = "Kobold Vermin slain: 0/10" } }
  used.event("QUEST_LOG_UPDATE"); used.drain()
  kill(used, 1); rise(used, 100, 1, 1)
  rise(used, 102, 1, 1)
  assert(#credits(used) == 1 and credits(used)[1].quest == 100, "evidence an earlier scan used is not used again")
  kill(used, 2); used.s.obj[100][1].numFulfilled = 2; used.s.obj[102][1].numFulfilled = 2; used.event("QUEST_LOG_UPDATE"); used.drain()
  assert(#credits(used) == 2 and credits(used)[2].quest == 102, "one kill, two quests in the same scan")
  local secret = {}
  none(function(x)
    x.G.issecretvalue = function(v) return v == secret end
    kill(x, 1); x.s.obj[100][1].numFulfilled = secret; x.event("QUEST_LOG_UPDATE"); x.drain()
    x.s.obj[100][1].numFulfilled = 1; x.event("QUEST_LOG_UPDATE"); x.drain()
  end, "a secret count")
  local cap = quester({ db = { events = { { t = 1767225600, padding = string.rep("x", 1000000) } } } })
  kill(cap, 1); rise(cap, 100, 1, 1)
  assert(#credits(cap) == 0 and not cap.db().lastError, "past the half caps")

  -- grouped, a named creature still counts; the old quest log API; no timer: a scan at once
  local g = quester()
  g.G.IsInGroup = function() return true end
  kill(g, 1); rise(g, 100, 1, 1)
  assert(#credits(g) == 1 and credits(g)[1].by == "name", "grouped and named")
  local o = quester()
  o.G.C_QuestLog.GetNumQuestLogEntries, o.G.C_QuestLog.GetInfo = nil, nil
  o.G.GetNumQuestLogEntries = function() return 2, 1 end
  o.G.GetQuestLogTitle = function(i) if i == 1 then return "Zone", 0, 0, true, false, false, 0, 0 end; return "Q", 10, 0, false, false, false, 0, 100 end
  o.event("QUEST_LOG_UPDATE"); o.drain()
  kill(o, 1); rise(o, 100, 1, 1)
  assert(#credits(o) == 1, "GetQuestLogTitle")
  local t = quester({ globals = { C_Timer = false } })
  kill(t, 1); rise(t, 100, 1, 1)
  assert(#credits(t) == 1, "no timer")

  -- at most 200 a session
  local many = quester()
  many.s.obj[100][1].numRequired = 1000
  for n = 1, 201 do kill(many, n, nil, { id = 5000 + n }); rise(many, 100, 1, n) end
  assert(#credits(many) == 200, "200 a session: " .. #credits(many))

  -- a client without the quest APIs: nothing, and no error
  local bare = fresh()
  bare.event("QUEST_LOG_UPDATE"); bare.drain()
  bare.s.units.target = { guid = kobold(1), dead = true }
  bare.event("UNIT_HEALTH", "target"); bare.event("CHAT_MSG_LOOT", "You receive loot: " .. pelt(750, "Wolf Pelt") .. ".")
  bare.event("QUEST_WATCH_UPDATE", 1); bare.drain()
  assert(#bare.events() == 0 and not bare.db().lastError, tostring(bare.db().lastError))
  -- whole words, with letters past ASCII: a name ending in "é" is not found inside a longer word
  local acc = quester()
  acc.s.obj[100][1].text = "Kobolds of Ébène slain: 0/10"
  kill(acc, 1, "Ébè", { id = 9 }); kill(acc, 2, "Kobold Tunneler", { id = 7 }); rise(acc, 100, 1, 1)
  assert(#credits(acc) == 0, "a name that is part of a longer accented word")
  kill(acc, 3, "Ébène", { id = 10 }); kill(acc, 4, "Kobold Tunneler", { id = 11 }); rise(acc, 100, 1, 2)
  assert(#credits(acc) == 1 and credits(acc)[1].npc == 10 and credits(acc)[1].by == "name", dump(credits(acc)[1]))
  -- UNIT_HEALTH for the player, the pet and group members is dropped before anything is read
  local quiet = quester()
  local reads = 0
  local dead = quiet.G.UnitIsDead
  quiet.G.UnitIsDead = function(u) reads = reads + 1; return dead(u) end
  for _, u in ipairs({ "player", "pet", "party1", "partypet2", "raid12", "raidpet3" }) do quiet.event("UNIT_HEALTH", u) end
  assert(reads == 0, "group tokens read nothing")
  quiet.event("UNIT_HEALTH", "nameplate1")
  assert(reads == 1, "a nameplate is read")
  print("OK   objective credit: a creature, item or object counted for a quest objective; by name, or sole for a creature alone; rows; refusals, dedup, caps")
end

-- Facts.lua beside Observations.lua (1.21.0): a looted link keeps its random suffix and stays that one item, the item
-- is met and read once out of combat, and a creature that dies while the player fights is counted for the day whether
-- or not anyone loots it. (Facts.lua alone: tools/check_facts.js.)
do
  local h = fresh(); h.on()
  local reads = {}
  h.G.C_Item = { GetItemInfo = function(link)
                   reads[#reads + 1] = link
                   if link:find("^item:6560") then return "Soldier's Shield", nil, 2, 25, 20, "Armor", "Shields", 1, "INVTYPE_SHIELD", 1, 100, 4, 6, 2, 0, nil end
                   return "Linen Cloth", nil, 1, 5, 0, "Tradeskill", "Cloth", 20, "", 1, 13, 7, 5, 0, 0, nil
                 end,
                 GetItemStats = function(link)
                   if link:find("12729") then return { ITEM_MOD_INTELLECT_SHORT = 5, RESISTANCE0_NAME = 478 } end
                   if link:find("^item:6560") then return { ITEM_MOD_STAMINA_SHORT = 3, RESISTANCE0_NAME = 478 } end
                 end }
  h.G.C_TooltipInfo = h.G.C_TooltipInfo or {}
  h.G.C_TooltipInfo.GetHyperlink = function(link)
    return { lines = { { leftText = link:find("6560") and "Soldier's Shield" or "Linen Cloth" }, { leftText = "Off Hand", rightText = "Shield" } } }
  end
  local fighting = true
  h.G.InCombatLockdown = function() return fighting end
  h.G.UnitAffectingCombat = function() return fighting end
  h.G.UnitIsTapDenied = function(u) local x = h.s.units[u]; return x and x.tapped or false end
  assert(load([=====[${factsSource}]=====], "@Facts.lua", "t", h.G))("KutzInventory", h.ns)

  local CORPSE = "Creature-0-4170-0-1234-2958-00001FAC01"
  local SHIELD = "|cff1eff00|Hitem:6560::::::::19:1489:::1:12729::::::|h[Soldier's Shield of Intellect]|h|r"
  h.s.units.target = { guid = CORPSE, dead = true, level = 14 }
  h.loot({ { link = SHIELD, n = 1, from = { CORPSE, 1 } }, item(2589, 2, { CORPSE, 2 }) })
  local e = h.events()[#h.events()]
  assert(e and e.type == "loot" and e.items[1].id == 6560
         and e.items[1].link == "|cff1eff00|Hitem:6560::::::::::::1:12729|h[Soldier's Shield of Intellect]|h|r",
         "the suffix stays on the short link: " .. dump(e) .. tostring(h.db().lastError))
  assert(e.items[2].id == 2589 and e.items[2].link == "|cffffffff|Hitem:2589|h[X]|h|r", "a plain item's link is unchanged: " .. dump(e.items[2]))
  assert(not dump(e):find("1489") and not dump(e):find(":19:"), "nothing else of the copy's link is kept")
  for _ = 1, 6 do h.drain() end
  assert(#reads == 0 and next(h.db().items or {}) == nil, "nothing is read in combat: " .. #reads)
  fighting = false
  for _ = 1, 8 do h.drain() end
  local items = h.db().items
  local count = 0
  for _ in pairs(items) do count = count + 1 end
  assert(count == 2 and items[6560] and items[2589], "one entry per item, none for the suffixed copy: " .. dump(items) .. tostring(h.db().lastError))
  assert(items[6560].f == "2:2:4:6:25:20::INVTYPE_SHIELD" and items[6560].s == "ITEM_MOD_STAMINA_SHORT=3,RESISTANCE0_NAME=478"
         and items[6560].n == nil and items[6560].t == "-Soldier's Shield\\n-Off Hand\\n>Shield", dump(items[6560]))
  assert(dump(items[6560].v) == "{0;12729=Soldier's Shield of Intellect\\nITEM_MOD_INTELLECT_SHORT=5,RESISTANCE0_NAME=478}",
         "the suffix is a variant of 6560: " .. dump(items[6560].v))
  for _, link in ipairs(reads) do assert(link == "item:6560" or link == "item:2589", "read from a link of the id alone: " .. link) end
  local n = #reads
  h.event("LOOT_CLOSED"); h.s.units.target = { guid = "Creature-0-4170-0-1234-2958-00001FAC02", dead = true, level = 14 }
  h.loot({ { link = SHIELD, n = 1, from = { "Creature-0-4170-0-1234-2958-00001FAC02", 1 } } })
  for _ = 1, 4 do h.drain() end
  assert(#reads == n, "met again: nothing is read twice")

  -- kills: the looted corpse counts once however many unit tokens show it; an unlooted one counts too; another
  -- player's tap, a player, a pet and a death while the player is not fighting do not
  fighting = true
  h.s.units.target = { guid = CORPSE, dead = true, level = 14 }
  h.event("UNIT_HEALTH", "target"); h.event("UNIT_HEALTH", "target")
  h.s.units.nameplate3 = { guid = CORPSE, dead = true, level = 14 }; h.event("UNIT_HEALTH", "nameplate3")
  h.s.units.nameplate4 = { guid = "Creature-0-4170-0-1234-2958-00001FAC03", dead = true, level = 15 }; h.event("UNIT_HEALTH", "nameplate4")
  h.s.units.nameplate5 = { guid = "Creature-0-4170-0-1234-2958-00001FAC04", dead = true, level = 14 }; h.event("UNIT_HEALTH", "nameplate5")
  h.s.units.nameplate6 = { guid = "Creature-0-4170-0-1234-525-00001FAC05", dead = true, level = 11, tapped = true }; h.event("UNIT_HEALTH", "nameplate6")
  h.s.units.nameplate7 = { guid = "Creature-0-4170-0-1234-526-00001FAC06", dead = false, level = 11 }; h.event("UNIT_HEALTH", "nameplate7")
  h.s.units.nameplate8 = { guid = "Creature-0-4170-0-1234-527-00001FAC07", dead = true, level = 11, controlled = true }; h.event("UNIT_HEALTH", "nameplate8")
  h.s.units.nameplate9 = { guid = PLAYER, dead = true, player = true, level = 60 }; h.event("UNIT_HEALTH", "nameplate9")
  h.s.units.party1 = { guid = "Creature-0-4170-0-1234-528-00001FAC08", dead = true, level = 11 }; h.event("UNIT_HEALTH", "party1")
  fighting = false
  h.s.units.nameplate2 = { guid = "Creature-0-4170-0-1234-529-00001FAC09", dead = true, level = 11 }; h.event("UNIT_HEALTH", "nameplate2")
  local day = math.floor(h.s.now / 86400)
  assert(dump(h.db().kills) == "{" .. day .. "={2958:14=2,2958:15=1}}", "kills per day, npc and level: " .. dump(h.db().kills) .. tostring(h.db().lastError))
  assert(not dump(h.db().kills):find("FAC") and not dump(h.db().items):find("Tester"), "no corpse GUID, no player")
  h.cmd("track drops off")
  h.s.units.nameplate2 = { guid = "Creature-0-4170-0-1234-2958-00001FAC0A", dead = true, level = 14 }; fighting = true; h.event("UNIT_HEALTH", "nameplate2")
  assert(dump(h.db().kills) == "{" .. day .. "={2958:14=2,2958:15=1}}" and not h.db().lastError, "nothing counted while off")
  print("OK   item facts and kills beside drop tracking: the suffix on a looted link, one item with a variant, no read in combat or twice, kills per day")
end
`;

// The real /kinv: every file the .toc loads, in a fake game where unknown globals are harmless stubs.
const toc = fs.readFileSync(path.join(addonDir, "KutzInventory.toc"), "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l.endsWith(".lua"));
const slash = (files, existing = false) => `
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
local existing = ${existing}
if existing then KutzInventoryDB = {} end
for _, file in ipairs({ ${files.map((f) => `{ ${JSON.stringify(f)}, [=====[${fs.readFileSync(path.join(addonDir, f), "utf8")}]=====] }`).join(",\n")} }) do
  chunk = assert(load(file[2], "@" .. file[1], "t", env))
  chunk("KutzInventory", ns)
end
for _, event in ipairs({ "ADDON_LOADED", "PLAYER_LOGIN" }) do
  for _, f in ipairs(frames) do
    local on = f.scripts.OnEvent
    if on then on(f, event, "KutzInventory") end
  end
end
if not ns.ObsCommand then                       -- built without Observations.lua: /kinv and /kinv track still work
  assert(KutzInventoryObsDB == nil, "loading the addon without the module made KutzInventoryObsDB")
  SlashCmdList.KUTZINVENTORY(""); SlashCmdList.KUTZINVENTORY("track drops on")
  assert(not table.concat(printed, " "):find("/kinv track") and KutzInventoryObsDB == nil and not KutzInventoryDB.lastError, "without the module")
  say("OK   the addon runs without Observations.lua (no note, no /kinv track, no KutzInventoryObsDB)")
  return
end
assert(KutzInventoryObsDB and KutzInventoryObsDB.on and KutzInventoryObsDB.agreed, "loading the addon turns drop tracking on")
local _, upgradeLines = table.concat(printed):gsub("1%.19%.0 adds NPC gossip and spoken lines", "")
assert(upgradeLines == (existing and 1 or 0), "login notice also applies to an install with no old observations table")
local _, petLines = table.concat(printed):gsub("1%.20%.0 adds hunter tames", "")
assert(petLines == (existing and 1 or 0), "the 1.20.0 login notice, once, for an existing install")
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
for (const chunk of [code, slash(toc), slash(toc, true), slash(toc.filter((f) => f !== "Observations.lua"))]) {
    const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
    if (lauxlib.luaL_dostring(L, to_luastring(chunk)) !== 0) {
        console.error("FAIL " + to_jsstring(lua.lua_tostring(L, -1))); process.exit(1);
    }
}
