-- KutzInventory / Observations: default-on recording of what drops, what quests give, what vendors sell, what
-- trainers teach and where flight masters fly, plus a summary of the NPCs seen, for cr0m's item database. On from the first load of a new install; an
-- install from the opt-in days keeps its choice (off stays off). /kinv track drops off stops all of it (the NPC summary too)
-- and stays off across reloads; /kinv track shows the status.
--
-- A module on its own: its own saved table, KutzInventoryObsDB, and nothing in the other files depends on it (they
-- only call ns.ObsCommand / ns.ObsNote when they exist). Leave this file and its .toc lines out and the addon is the same.
--
-- KutzInventoryObsDB = { v = 1, on = true|false, agreed = true|nil, noted = true|nil,
--                        notedGameText = true|nil, notedPets = true|nil, notedRewards = true|nil (1.23.0),
--                        addon = "1.8.0", prefix = "k1f9c2", n = 17,
--                        events = { oldest first }, npcs = { [npcId] = ... }, textSeen = { [kind] = { next, keys } } }
--   prefix: random, made once per install; the event ids start with it and the export names the npcs summary's install by it.
--   on: a new table starts true (KutzInventory 1.13.0); an existing one keeps what it holds, only a missing on becomes
--   true. Recording needs on and agreed.
-- Each event: { id = prefix .. "-" .. counter, t = time(), b = "1.60.1.70888", type = "loot"|"quest"|"vendor"|"trainer"|"taxi"|"flight"|...,
--               where = { map, uiMap, itype, difficulty, x, y }, who = { level, class, faction, name, surname }, ... }
--   who.name / who.surname: this character's own name (never anyone else's), so cr0m can credit the right character.
--   items carry link = "|cffa335ee|Hitem:19019|h[Name]|h|r": only the item's quality colour, id and name, so cr0m can name
--   an item no database has yet (the rest of the game's link, with the player's level and spec, is dropped).
--   loot    one per loot source in a loot window: src = { kind, npc|object|item, guid, level, via }, items = { { id, n, link } }
--           (every window is an open: a coins-only corpse is items = {}; coins are never recorded. The same corpse
--           opened twice counts once; skinning it is a separate "skin" open. Read at LOOT_READY, before auto-loot or
--           a fast-loot addon takes the slots; at LOOT_OPENED only where LOOT_READY did not come)
--           src.encounter: the DungeonEncounter id, on a boss killed while recording (ENCOUNTER_END; Forever shows no
--           boss1..5 units, so the boss is the dead creature the group targets).
--           via = "roll": a corpse's group-loot roll list (START_LOOT_ROLL), recorded also when another player opened
--           it: only the items at or above src.threshold (the group's loot threshold, 0-7) are in it. Items a loot
--           window of ours showed already are not recorded again, and the same corpse's roll list counts once.
--           An item this player won by roll carries won = true (from the player's own "You won: [item]" loot line).
--           1.22.0: a roll list no window named gets its corpse from the game's loot flags (UNIT_LOOT), src.by =
--           "end"|"flip"|"sole" saying how (see "Which corpse a roll list came from" below), and its boss from the
--           game's loot history. src.by stays in the saved table; the export does not carry it yet.
--           1.23.0: src = { kind = "disenchant", item } for the window of the player's own Disenchant (see de below):
--           item is the destroyed item; a window without its id is not recorded at all.
--   quest   act = "accept"|"turnin", quest, npc|object (the giver / ender), rewards = { items, choices, chose } on turnin,
--           text = { title, details, objectives } on accept and { title, progress, completion } on turnin: the quest's
--           words as the game showed them, with this character's own name put back to "$N". Once per quest and act
--           while the event is kept, and not at all once the events are past half the size cap.
--           1.18.0, on accept: lv, group (2-40), freq ("daily"|"weekly"), timed (true) from the quest log, and startItem
--           (QUEST_DETAIL's arg, only for the quest that window showed). On turnin: xp (GetRewardXP at QUEST_COMPLETE, only
--           under the level cap with XP not turned off) and rep = { { f = factionID, d = change } }: the standings read at
--           QUEST_COMPLETE and again 1 s after the turn-in, only the changes (never a standing), at most 6, none when
--           loot, combat or another reward window or turn-in came in between.
--           1.19.0 also records quest objective definitions (up to 12, with no progress counts) and up to 8 quest POIs
--           on the acceptance map, when the client supplies them safely; from 1.20.0 with rows, the number of objectives
--           the client listed before unusable ones were skipped.
--           1.23.0, rewards as the quest window listed them, on both acts: on accept read at QUEST_DETAIL and kept only
--           when that window showed this very quest and listed at least one reward; on turnin read at QUEST_COMPLETE.
--           rewards = { items, choose = { { id, n, link } } (the choose-one items, at most 10), money (copper: the
--           quest's own GetRewardMoney in that window, never the player's money), xp (as the turnin's xp), spells (ids,
--           ascending, at most 8), title, cap (true: at the level cap), skill = { line, pts }, cur = { { id, n } }
--           (currencies, by id, at most 8) }, plus choices and chose on turnin. A key the window did not list, or the
--           client did not answer plainly, is left out.
--   vendor  npc, rx, filtered, items = { { id, n, link, price (copper per n, as shown), cost = { { item|currency, n } }, limited } }
--           read under the merchant window's "all" item filter, put back at once; filtered = true when it could not be
--           switched (the list then misses the items the class filter hides). The same stock and rx once an hour.
--   trainer npc, kind = "class"|"profession", rx, rows = { { s, name, rank, lv, skill, skillReq, needs, cost, st } }:
--           a trainer's whole list (all three type filters on for the read, put back after), at most 400 rows.
--           s = spell id (from the tooltip data; left out when the client gives none), st = "a" available, "u" not
--           yet, "k" known. The hunter's Beast Training window is never recorded. The same trainer with the same list
--           (st aside, so learning a spell changes nothing) and rx is recorded at most once in 7 days.
--   taxi    npc, node (the flight master's own node, the window's current one), rx, to = { { node, cost, hops } }: every
--           node the flight map lists as reachable, sorted by node, with its price as shown and the number of legs. Node
--           ids come from C_TaxiMap.GetAllTaxiNodes(GetTaxiMapID()), joined by slotIndex to TaxiNodeGetType / TaxiNodeCost
--           / GetNumRoutes; nothing is recorded without them (names are not ids), nor when the two views disagree or more
--           than 200 nodes are reachable. The same npc, node, prices and rx at most once in 7 days (saved events).
--   flight  from, to (node ids), sec (whole seconds), and no where: one flight's duration, from PLAYER_CONTROL_LOST with
--           UnitOnTaxi true soon after TakeTaxiNode (hooked, never called) picked "to" in a taxi window we read, to
--           PLAYER_CONTROL_GAINED with UnitOnTaxi false; only when the landing position is by "to" (no other node closer),
--           or, when the position cannot be read, the next taxi window within 2 minutes is at "to". Never a position
--           trail. One per from/to in 30 days (saved events).
--   gossip NPC or object greeting and dialogue body only, while below the half caps.
--   read   one page from a world object, only when mail and creator checks pass.
--   line   game speech or emotes from an identified, uncontrolled creature; known player names scrubbed.
--   tame   (1.20.0) a hunter's tame: npc (the creature id from the target's GUID when Tame Beast began; no id, no event;
--          the new pet must bear the target's name, and its level and creature id where readable), lv and fam (the
--          target's), spells = { { s, name, rank } } (the new pet's spellbook, the same in two reads), spd (its attack
--          speed in hundredths of a second, out of combat; spdAura = true when the pet had an aura at every read), diet
--          (labels), loc (GetLocale: the language of the labels), where = where the tame began. Never the pet's GUID or
--          name, nor the target's name. Once per beast, level, abilities and speed.
--   credit (1.20.0) quest, i (the objective's index in C_QuestLog.GetQuestObjectives), rows (how many objectives it
--          listed), ot = "monster"|"item"|"object" (its type), npc|item|object (what counted for it), by = "name"|"sole"
--          (how the cause was told; sole only for a creature, solo and with no pet out): when the objective's
--          numFulfilled rose and this player's own evidence of the last 6 s named one cause. numFulfilled is read in
--          memory to see the rise and never saved; nothing about other players. Once per quest, index and id.
--   killrep (1.23.0) npc, lv, f (faction id), d (the change, signed): the reputation one kill gave this character, from
--          its own "Reputation with %s increased by %d." line, when every creature it saw die untapped from 2 s before
--          the line to 1 s after it had that one npc id; not near a quest turn-in. Never a standing. Once per npc, lv, f, d.
--   rx: UnitReaction("npc", "player"), 1 hated .. 4 neutral .. 8 exalted. Prices and costs are what the game shows,
--           which already includes this character's reputation discount: rx tells a list price from a discounted one.
--           They are game prices, not the player's money (taxi costs too).
-- Never recorded: coin loot, the player's money (GetMoney is never called here), QUEST_TURNED_IN's money argument, a
-- reputation standing, player chat, or other players' GUIDs or guild data. The dialogue filters can miss a player name.
-- (Loot chat is read only for this player's own lines: "You won", kept as the won flag, and "You receive loot / item",
-- held for 6 s in memory as objective credit evidence.)
-- At most 5000 events, 30 days and about 2 MB of JSON; the oldest go first.
--
-- npcs (KutzInventory 1.17.0): not events but one summary per install of the creatures this player looked at
-- (PLAYER_TARGET_CHANGED, UPDATE_MOUSEOVER_UNIT, and the vendor / quest / trainer window or loot corpse in front of it),
-- updated in place: KutzInventoryObsDB.npcs[npcId] = { name, lv = { min, max }, boss, cls, ct, fam, rxA, rxH, sub, svc, spd,
-- spds, day, cells = { ["uiMap:cx:cy"] = count } }. svc (1.18.0): the services it was seen to offer, a set { vendor = true,
-- ... } of vendor, repair, flight, trainer, bank, guildbank, inn, auction, stable, battlemaster, spirit, guild, tabard, from
-- PLAYER_INTERACTION_MANAGER_FRAME_SHOW (Enum.PlayerInteractionType by name), the vendor (CanMerchantRepair: repair),
-- trainer and taxi windows, and CONFIRM_BINDER / HEARTHSTONE_BOUND (inn); each is a near sighting. No gossip text. Only creatures no player controls (no pets, guardians, totems, companions),
-- only outside instances, and a value the client keeps secret is left out. Privacy: no time finer than a day (day = the
-- last day it was seen, days since 1970), no player names and no GUIDs (name is the NPC's own, sub its subtitle, taken only when
-- the tooltip's lines prove it is one; both refuse the player's name and owner titles), and no trail: cells are unordered counts of the 1% map squares the player stood in
-- while within about 10 yards of it (or talking to it), so the player's position stands for the NPC's. An NPC not seen
-- for 180 days is dropped on load. Its reaction and attack speed are read only while it is alive and out of combat (a
-- neutral mob reads hostile once fought), its tooltip only while the player is out of combat. At most 3000 NPCs
-- (the least recently seen go first), 40 cells each and its own ~500 KB cap, apart from the events' 2 MB: the summary
-- is replaced, not added to, so it must not push drops out of the events' cap, nor drops push it out (3000 realistic
-- NPCs with names are ~440 KB by Size below). spds is this file's own tally for spd (attack speed -> times seen), not exported.
-- Since 1.23.0 also hp = { { lv, diff, v, c } } and pw = { { lv, diff, t, v, c } }: UnitHealthMax, and UnitPowerType with
-- UnitPowerMax, per level (and difficulty inside an instance), read alive; the value seen most often (NPC.Vitals).
-- Since 1.21.0 a creature seen inside an instance is kept too, without cells: inst = { ["<instance map>:<difficulty>"] =
-- count } says where (NPC.Inside). Item facts (items), per-day kill counts (kills) and the suffix on item links: Facts.lua.

local ADDON, ns = ...

local PREFIX = "|cffd8b84aKutzInventory|r: "
local MAX_EVENTS, MAX_AGE, MAX_BYTES = 5000, 30 * 86400, 2000000
local CAST_WINDOW = 5                           -- seconds (GetTime) from a gathering / skinning cast to its loot window
local VENDOR_AGAIN = 3600                       -- the same vendor with the same stock is recorded at most once an hour
local LF = string.char(10)
local TEXT_MAX = { title = 200, details = 8000, objectives = 4000, progress = 4000, completion = 8000, gossip = 4000, read = 8000, line = 2000 }   -- bytes

local function Plain(v)
    if issecretvalue and issecretvalue(v) then return nil end
    return v
end
local function Try(fn, ...)
    if type(fn) ~= "function" then return nil end
    local ok, a, b, c, d, e, f, g, h, i, j = pcall(fn, ...)
    if ok then return a, b, c, d, e, f, g, h, i, j end
end
local function Secret(v) return issecretvalue ~= nil and issecretvalue(v) and true or false end
local function Say(msg) print(PREFIX .. msg) end
local function Num(v) v = Plain(v); return type(v) == "number" and v or nil end
local function Int(v, min) v = Num(v); if v and v == math.floor(v) and v >= (min or 0) then return v end end

local function Cut(s, max)                      -- at most max bytes, cut before a split UTF-8 character
    if #s <= max then return s end
    local i = max
    while i > 0 and s:byte(i + 1) >= 128 and s:byte(i + 1) < 192 do i = i - 1 end
    return s:sub(1, i)
end

-- A short game label (a spell or skill name, "Rank 4"): trimmed, no control characters, cut to max bytes; nil when
-- empty or when it carries UI markup ("|").
local function Label(v, max)
    v = Plain(v)
    if type(v) ~= "string" then return nil end
    v = Cut(v:gsub("%c", ""):gsub("^%s+", ""):gsub("%s+$", ""), max)
    if v == "" or v:find("|", 1, true) then return nil end
    return v
end

local function Reaction()                       -- the npc's standing with this character: 1 hated .. 8 exalted
    local r = Int(Try(UnitReaction, "npc", "player"), 1)
    return r and r <= 8 and r or nil
end

local function DB(create)
    local d = KutzInventoryObsDB
    if type(d) ~= "table" then
        if not create then return nil end
        d = { v = 1 }
        KutzInventoryObsDB = d
    end
    -- On by default only where nothing was chosen yet: a new install, or a table with no setting. A table from the
    -- opt-in days keeps its on = false (never turned on, or turned off) until /kinv track drops on.
    if d.on == nil then d.on, d.agreed = true, true end
    if type(d.events) ~= "table" then d.events = {} end
    if type(d.npcs) ~= "table" then d.npcs = {} end
    return d
end

---------------------------------------------------------------------------
-- caps: 5000 events, 30 days, ~2 MB of JSON. Over a cap, prune to 90% of it so it doesn't run on every event.
---------------------------------------------------------------------------
local bytes = 0                                 -- the events' approximate JSON size, kept as they are added

local function Size(v)
    local t = type(v)
    if t == "string" then return #v + 2 end
    if t == "number" then return #tostring(v) end
    if t == "boolean" then return 5 end
    if t ~= "table" then return 4 end
    local n = 2
    for k, x in pairs(v) do n = n + Size(x) + (type(k) == "string" and #k + 4 or 1) end
    return n
end

local function Prune(d, headroom)
    local now, keep, sizes, total = time(), {}, {}, 0
    for _, e in ipairs(d.events) do
        if type(e) == "table" and type(e.t) == "number" and e.t + MAX_AGE >= now then
            local s = Size(e)
            keep[#keep + 1], sizes[#sizes + 1], total = e, s, total + s
        end
    end
    local maxEvents, maxBytes = MAX_EVENTS, MAX_BYTES
    if headroom then maxEvents, maxBytes = math.floor(MAX_EVENTS * 0.9), math.floor(MAX_BYTES * 0.9) end
    local drop = math.max(0, #keep - maxEvents)
    for i = 1, drop do total = total - sizes[i] end
    while total > maxBytes and drop < #keep do drop = drop + 1; total = total - sizes[drop] end
    if drop > 0 then
        local out = {}
        for i = drop + 1, #keep do out[#out + 1] = keep[i] end
        keep = out
    end
    d.events, bytes = keep, total
end

local function Add(e)
    local d = DB()
    if not (d and d.on and d.agreed) then return end   -- the one gate: nothing is stored while off
    d.events[#d.events + 1] = e
    bytes = bytes + Size(e)
    if #d.events > MAX_EVENTS or bytes > MAX_BYTES then Prune(d, true) end
end

---------------------------------------------------------------------------
-- what every event carries: id, time, build, where, who
---------------------------------------------------------------------------
local ALNUM = "0123456789abcdefghijklmnopqrstuvwxyz"

local function Prefix(d)                        -- the install's random prefix, made on first use
    if type(d.prefix) ~= "string" or d.prefix == "" then
        local p = {}
        for i = 1, 6 do local r = math.random(1, 36); p[i] = ALNUM:sub(r, r) end
        d.prefix = table.concat(p)
    end
    return d.prefix
end

local function NewId(d)
    Prefix(d)
    d.n = (Int(d.n) or 0) + 1
    return d.prefix .. "-" .. string.format("%06d", d.n)
end

ns.ObsPrefix = Prefix                           -- Facts.lua names its per-day kill counts by the same install id

local function Round4(v) return math.floor(v * 10000 + 0.5) / 10000 end

local function Where()
    local w = {}
    local _, itype, difficulty, _, _, _, _, id = Try(GetInstanceInfo)
    itype = Plain(itype)
    w.map = Int(id)
    local M = C_Map
    if M and M.GetBestMapForUnit then w.uiMap = Int((Try(M.GetBestMapForUnit, "player"))) end
    if type(itype) == "string" and itype ~= "" and itype ~= "none" then
        w.itype, w.difficulty = itype, Int(difficulty)
    elseif w.uiMap and M.GetPlayerMapPosition then  -- coordinates only outside instances
        local pos = Plain(Try(M.GetPlayerMapPosition, w.uiMap, "player"))
        if type(pos) == "table" then
            local x, y = Try(Plain(pos.GetXY), pos)
            x, y = Num(x), Num(y)
            if x and y and (x > 0 or y > 0) and x <= 1 and y <= 1 then w.x, w.y = Round4(x), Round4(y) end
        end
    end
    return w
end

-- This character's own given name and surname. UnitName is the given name; on Forever GetUnitName adds the surname.
local function Me()
    local given = Plain(Try(UnitName, "player"))
    if type(given) ~= "string" or given == "" or #given > 40 then return nil end
    local full, surname = Plain(Try(GetUnitName, "player", true)), nil
    if type(full) == "string" then
        local rest = full:match("^" .. given:gsub("(%W)", "%%%1") .. "%s+(.+)$")
        rest = type(rest) == "string" and rest:gsub("^%s+", ""):gsub("%s+$", "") or ""
        if rest ~= "" and #rest <= 40 and not rest:find("|", 1, true) then surname = rest end
    end
    return given, surname
end

local function Who()                            -- the recording character: level, class id, faction, its own name
    local _, _, class = Try(UnitClass, "player")
    local faction = Plain(Try(UnitFactionGroup, "player"))
    local name, surname = Me()
    return { level = Int(Try(UnitLevel, "player"), 1), class = Int(class, 1),
             faction = type(faction) == "string" and faction ~= "" and faction or nil, name = name, surname = surname }
end

local function NewEvent(kind)
    local d = DB()
    local e = { id = NewId(d), t = time(), type = kind, where = Where(), who = Who() }
    local version, build = Try(GetBuildInfo)
    version, build = Plain(version), Plain(build)
    if type(version) == "string" and version ~= "" and (type(build) == "string" or type(build) == "number") then
        e.b = version .. "." .. tostring(build)
    end
    return e
end

-- "Creature-0-4170-409-1234-11502-000012ABCD" -> "npc", 11502; "GameObject-..." -> "object", id. Anything else
-- (players, their pets, items) -> nil: those GUIDs are never stored.
local function FromGuid(guid)
    if type(guid) ~= "string" then return nil end
    local kind, id = guid:match("^(%a+)%-%d+%-%d+%-%d+%-%d+%-(%d+)%-%x+$")
    if kind == "Creature" or kind == "Vehicle" then return "npc", tonumber(id) end
    if kind == "GameObject" then return "object", tonumber(id) end
end

local function Giver(...)                       -- the npc or object behind the first unit that has one
    for i = 1, select("#", ...) do
        local what, id = FromGuid(Plain(Try(UnitGUID, (select(i, ...)))))
        if what then return what, id end
    end
end

local function ItemId(link)
    return type(link) == "string" and tonumber(link:match("|Hitem:(%d+)") or link:match("^item:(%d+)")) or nil
end

-- An item link cut down to the item's own facts: "|cffa335ee|Hitem:19019|h[Thunderfury]|h|r", or nil. A copy with a
-- random suffix keeps what names the suffix and nothing else (1.21.0, Facts.lua): the link's suffix id and bonus ids,
-- "|cff1eff00|Hitem:6560::::::::::::1:12729|h[Soldier's Shield of Intellect]|h|r": still item 6560, one item. Every item
-- that passes here is also met by Facts.lua, which reads its facts once.
local function ShortLink(link)
    if type(link) ~= "string" then return nil end
    local colour, id = link:match("|c[fF][fF](%x%x%x%x%x%x)"), link:match("|Hitem:(%d+)")
    local name = link:match("|h%[([^%]|]+)%]|h")
    if not (colour and id and name) or #name > 120 then return nil end
    local tail = ""
    if ns.Facts and ns.Facts.Met then
        local ok, t = pcall(ns.Facts.Met, link)
        if ok and type(t) == "string" then tail = t end
    end
    return "|cff" .. colour:lower() .. "|Hitem:" .. id .. tail .. "|h[" .. name .. "]|h|r"
end

---------------------------------------------------------------------------
-- loot: one event per source in each loot window
---------------------------------------------------------------------------
local GATHER_SPELLS = {                         -- spell id -> how the loot window was opened
    [2366] = "herb", [2368] = "herb", [3570] = "herb", [11993] = "herb",
    [2575] = "mine", [2576] = "mine", [3564] = "mine", [10248] = "mine",
    [8613] = "skin", [8617] = "skin", [8618] = "skin", [10768] = "skin",
}
local gatherNames                               -- the same, by the spells' names in the client's language
local lastCast = { kind = nil, at = -1000 }
local bossNpcs = {}                             -- npc ids seen as boss1..boss5 this session
local lastUsedItem = { id = nil, at = -1000 }   -- a container item just opened from the bags
local lootDone = false                          -- this loot window was read; false again once it closes
local Sighting                                  -- (unit, open): the npcs summary's update, defined below
-- objective credit (1.20.0), its functions below: WINDOW seconds of this player's own evidence, at most SAW entries;
-- want = the objective types still open at the last scan (no evidence is kept for a type no objective needs)
-- petAt: the last time a pet of the player's was known to be out (then no creature is told by "sole")
local credit = { WINDOW = 6, SAW = 40, SESSION = 200, DEAD = 500, ROWS = 40, TYPES = { monster = "npc", item = "item", object = "object" },
                 saw = {}, dead = {}, ndead = 0, base = nil, want = {}, n = 0, scans = 0, token = 0, pending = false, petAt = -1000 }

local function SpellName(id)
    if C_Spell and C_Spell.GetSpellName then return Plain(Try(C_Spell.GetSpellName, id)) end
    return Plain((Try(GetSpellInfo, id)))
end

local function GatherKind(spellId)
    spellId = Plain(spellId)
    if GATHER_SPELLS[spellId] then return GATHER_SPELLS[spellId] end
    if not gatherNames then
        gatherNames = {}
        for id, kind in pairs({ [2366] = "herb", [2575] = "mine", [8613] = "skin" }) do
            local name = SpellName(id)
            if type(name) == "string" and name ~= "" then gatherNames[name] = kind end
        end
    end
    local name = spellId and SpellName(spellId)
    return name and gatherNames[name] or nil
end

local function Now() return Num(Try(GetTime)) or 0 end

-- Disenchanting (1.23.0): the player's own Disenchant (spell 13262, or a spell of that name in this client) that
-- succeeded makes the next loot window (within 5 s, until it closes) a "disenchant" one, unless a bag item was used after
-- the cast (then it is that item's container window). The destroyed item: the window's Item- source GUID
-- (C_Item.GetItemIDByGUID), else the bag item clicked (UseContainerItem / PickupContainerItem, hooked) at most 1 s
-- before the cast began. No item id, no event: such a window is recorded as nothing else either.
local de = { SPELL = 13262, AIM = 1, at = -1000, item = nil, pending = nil, startAt = -1000, aimed = nil, aimedAt = -1000,
             name = nil, hooked = false }

function de.Is(spellId)
    spellId = Int(Plain(spellId), 1)
    if not spellId then return false end
    if spellId == de.SPELL then return true end
    if de.name == nil then
        local name = SpellName(de.SPELL)
        de.name = type(name) == "string" and name ~= "" and name or false
    end
    return de.name ~= false and SpellName(spellId) == de.name
end

function de.Aim(id) de.aimed, de.aimedAt = id, Now() end   -- a bag item was clicked or used (id or nil)

function de.Start(unit, spellId)                -- UNIT_SPELLCAST_START: the item clicked just before is the target
    if unit ~= "player" or not de.Is(spellId) then return end
    local now = Now()
    de.pending, de.startAt = now - de.aimedAt <= de.AIM and de.aimed or nil, now
end

function de.Done(unit, spellId)                 -- UNIT_SPELLCAST_SUCCEEDED
    if unit ~= "player" or not de.Is(spellId) then return end
    local now = Now()
    de.at, de.item = now, now - de.startAt <= CAST_WINDOW and de.pending or nil
    de.pending = nil
end

function de.Window()                            -- this loot window follows a Disenchant
    return Now() - de.at <= CAST_WINDOW and not (lastUsedItem.at > de.at)
end

function de.Closed() if Now() - de.at <= CAST_WINDOW then de.at, de.item = -1000, nil end end   -- one window per cast

local function UnitOf(guid)                     -- a unit token that is this GUID right now (to read its level), or nil
    for _, unit in ipairs({ "target", "mouseover", "focus" }) do
        if Plain(Try(UnitGUID, unit)) == guid then return unit end
    end
end

local function IsBoss(unit, npc)
    if bossNpcs[npc] then return true end
    return unit ~= nil and (Plain(Try(UnitClassification, unit)) == "worldboss" or Plain(Try(UnitLevel, unit)) == -1)
end

-- src: kind, npc|object|item, guid (creatures and objects only), level (the creature's, when a unit shows it),
-- via = "slot" (GetLootSourceInfo named it) or "target" (the dead target when the window opened). nil: record nothing
-- (a disenchant window without the destroyed item's id).
local function Source(guid, via, fishing)
    local what, id = FromGuid(guid)
    local cast = Now() - lastCast.at <= CAST_WINDOW and lastCast.kind or nil
    local src = {}
    if not fishing and not what and de.Window() then
        local item = type(guid) == "string" and guid:match("^Item%-") and C_Item and C_Item.GetItemIDByGUID
                     and Int(Try(C_Item.GetItemIDByGUID, guid), 1)
        item = item or de.item
        if not item then return nil end
        return { kind = "disenchant", item = item }
    end
    if fishing then src.kind = "fishing"
    elseif what == "npc" then
        local unit = UnitOf(guid)
        if unit then pcall(Sighting, unit, false) end    -- the corpse in front of us: near only if CheckInteractDistance says so
        src.kind = cast == "skin" and "skin" or IsBoss(unit, id) and "boss" or "mob"
        src.level = unit and Int(Try(UnitLevel, unit), 1) or nil
    elseif what == "object" then src.kind = (cast == "herb" or cast == "mine") and cast or "chest"
    elseif type(guid) == "string" and guid:match("^Item%-") then
        src.kind = "container"
        local item = C_Item and C_Item.GetItemIDByGUID and Int(Try(C_Item.GetItemIDByGUID, guid), 1)
        if not item and Now() - lastUsedItem.at <= CAST_WINDOW then item = lastUsedItem.id end
        src.item = item
    elseif cast == "herb" or cast == "mine" then src.kind = cast   -- a node the client didn't name
    else src.kind = "other" end
    if what then src[what], src.guid = id, guid end
    if what or src.kind == "container" then src.via = via end
    return src
end

-- The same corpse / node opened twice is one open; skinning it is another open of kind "skin".
local opened                                    -- "guid|kind" -> true, built from the saved events on first use
local function Opened(key)
    if not opened then
        opened = {}
        for _, e in ipairs(DB().events) do
            if type(e) == "table" and e.type == "loot" and type(e.src) == "table" and e.src.guid then
                opened[e.src.guid .. "|" .. (e.src.via == "roll" and "roll" or tostring(e.src.kind))] = true
            end
        end
    end
    if opened[key] then return true end
    opened[key] = true
    return false
end

---------------------------------------------------------------------------
-- rolls: what a corpse dropped that went to Need / Greed, also when someone else opened it
---------------------------------------------------------------------------
-- In a group, every item at or above the loot threshold goes to a roll for the whole group the moment the first player
-- opens the corpse (START_LOOT_ROLL), whether or not this player ever opens it. A burst of rolls that start together is
-- one corpse's list. Its source, in this order: a creature or object GUID the client passes with the roll; the corpse a
-- loot window of ours showed those items in (then the window recorded them already, and nothing is added but "won");
-- the boss killed in the last 5 minutes whose loot nobody has rolled yet; else none (kind "other": the instance only).
-- A window opened later on a sourceless list's items names its corpse after all.
local ROLL_SETTLE = 2                           -- seconds after a burst's last START_LOOT_ROLL before the burst is read
local BOSS_LOOT = 300                           -- a boss's roll burst comes within 5 minutes of the kill
local RECENT = 300                              -- loot windows, rolls and sourceless roll lists kept this long to match
local recentWindows = {}                        -- { at, guid, byId = { [itemId] = that item's table in its event } }
local sourceless = {}                           -- { at, e }: roll events recorded without a corpse yet
local rolled = {}                               -- { at, id, item }: items that went to a roll, for "You won"
local pendingRolls, rollToken = {}, 0
local bossKill                                  -- { guid, npc, encounter, map, at, claimed }: the last boss killed
local bossEncounter = {}                        -- creature GUID -> encounter id, for the bosses killed this session
-- the corpses the game flags as holding loot for this player, and the roll bursts they may be the corpse of (below)
local flag = { on = {}, n = 0, MAX = 400, WARM = 600, FLIP = 0.5, OWN = 1, from = -1000, windowAt = -1000, open = false,
               bursts = {}, burst = nil, ends = {} }

local function Fresh(list)                      -- the entries of the last RECENT seconds
    local now, out = Now(), {}
    for _, x in ipairs(list) do if now - x.at <= RECENT then out[#out + 1] = x end end
    return out
end

-- src of a roll list: like a loot window's, with via = "roll" and threshold = the group's loot threshold (the list
-- holds every item of that quality or better). Never "skin": a skinning cast nearby says nothing about a roll.
local function RollSource(guid)
    local what, id = FromGuid(guid)
    local src = { via = "roll", threshold = Int(Try(GetLootThreshold)) }
    if what == "npc" then
        local unit = UnitOf(guid)
        src.kind, src.npc, src.guid, src.encounter = IsBoss(unit, id) and "boss" or "mob", id, guid, bossEncounter[guid]
        src.level = unit and Int(Try(UnitLevel, unit), 1) or nil
    elseif what == "object" then src.kind, src.object, src.guid = "chest", id, guid
    else src.kind = "other" end
    return src
end

-- A loot window showed this corpse (src) with these items: rolls on them are this corpse's, and a roll list recorded
-- before without a corpse that shares an item gets this one.
local function Windowed(src, byId)
    recentWindows = Fresh(recentWindows)
    recentWindows[#recentWindows + 1] = { at = Now(), guid = src.guid, byId = byId }
    if bossKill and src.guid == bossKill.guid then bossKill.claimed = true end
    sourceless = Fresh(sourceless)
    for i = #sourceless, 1, -1 do
        local e = sourceless[i].e
        for _, it in ipairs(e.items) do
            if byId[it.id] then
                e.src = RollSource(src.guid)
                Opened(src.guid .. "|roll")
                table.remove(sourceless, i)
                for _, b in ipairs(flag.bursts) do if b.e == e then b.named = true end end
                break
            end
        end
    end
end

-- Which corpse a roll list came from when another player opened it (1.22.0). The game says which corpses hold loot
-- this player may take (UNIT_LOOT: guid, hasLoot), and a corpse holding an item that is being rolled on stays flagged
-- until its rolls end, whatever else was taken from it. Seen on Forever 1.60.1 in nine roll bursts of one dungeon run:
-- the corpse lost its flag 34 to 270 ms after its last LOOT_ROLLS_COMPLETE when nothing else on it was this player's,
-- and kept it when something was. So the corpse of a roll list nothing else named is among those flagged when its
-- rolls began (or while the burst settled) and still flagged when the last of them ended (LOOT_ROLLS_COMPLETE, by the
-- roll's lootHandle). src.by says how it was told:
--   "end":  the game's loot history files the rolls under a boss encounter this session saw end, and one corpse alone
--           got its flag right as that encounter ended and still has it (see flag.OfEncounter);
--   "flip": exactly one of them lost its flag within FLIP seconds of the rolls' end, no loot window of ours near it;
--   "sole": no flip, it was the only one flagged from the rolls' start to their end, none other lost its flag
--           meanwhile for no known reason, and the game said it held loot (CanLootUnit) when they ended.
-- Anything else: no corpse, as before (never a guess). So too when the corpse could be one this session never saw
-- flagged: in the first WARM seconds of recording (a corpse from before a reload), after the list of flags
-- overflowed, for a roll without a handle, or when the rolls' end never comes. Flags are kept per map.
-- A corpse that loses its flag while the rolls run is no candidate. When that has no known reason (not our own loot
-- window, not the end of another burst's rolls) it also rules "sole" out: it is not known whether passing on a roll
-- takes the flag off the rolls' own corpse (seen so far: a Greed roll does not).
-- One that loses it within FLIP seconds of the end of one roll while others of the burst still run says the burst
-- is two corpses' rolls (opened within ROLL_SETTLE seconds of each other): no corpse then. One that loses it within
-- FLIP seconds of the end of two bursts tells neither of them anything.
-- Not known yet either: whether a chest's roll list flags the chest (then it is a candidate like a corpse) or nothing.
function flag.Map() local _, _, _, _, _, _, _, id = Try(GetInstanceInfo); return Int(id) end

function flag.Reset()                           -- recording starts, or the flags can no longer be trusted to be whole
    flag.on, flag.n, flag.from, flag.bursts, flag.burst, flag.ends, flag.open = {}, 0, Now(), {}, nil, {}, false
end

function flag.Window(open) flag.windowAt, flag.open = Now(), open end   -- a loot window of ours opens or closes

-- A flag lost now is our own doing: a window of ours is open (LOOT_CLOSED may never come: a minute at most) or just closed.
function flag.Ours(now) return now - flag.windowAt <= flag.OWN or (flag.open and now - flag.windowAt <= 60) end

function flag.Ended(encounter)                  -- ENCOUNTER_END, a kill
    if encounter then flag.ends[encounter] = { at = Now(), map = flag.Map() } end
end

function flag.Changed(guid, has)                -- UNIT_LOOT
    guid, has = Plain(guid), Plain(has)
    if not FromGuid(guid) then return end
    local now = Now()
    if has == true then
        if not flag.on[guid] then
            if flag.n >= flag.MAX then flag.Reset() end
            flag.on[guid], flag.n = { at = now, map = flag.Map() }, flag.n + 1
        end
        local b = flag.burst                    -- a corpse flagged while the burst settles may be the one just opened
        if b and flag.on[guid].map == b.map then b.cands[guid] = true end
    elseif has == false then
        if flag.on[guid] then flag.on[guid], flag.n = nil, flag.n - 1 end
        local ours, ended = flag.Ours(now), {}
        for _, b in ipairs(flag.bursts) do      -- the bursts whose rolls just ended and whose corpse it may be
            if not b.named and b.cands[guid] and b.doneAt and now - b.doneAt <= flag.FLIP then ended[#ended + 1] = b end
        end
        if not ours then                        -- true: more than one flip, or one for two bursts, which tells nothing
            for _, b in ipairs(ended) do b.flipped = (#ended > 1 or b.flipped) and true or guid end
        end
        for _, b in ipairs(flag.bursts) do
            if not b.named and b.cands[guid] and not b.doneAt then   -- its rolls still run: not their corpse
                b.cands[guid] = nil
                if not ours and #ended == 0 then                     -- and nothing explains it (see above)
                    b.gone = true
                    if b.endAt and now - b.endAt <= flag.FLIP then b.mixed = true end
                end
            end
        end
    end
end

function flag.Roll(handle)                      -- START_LOOT_ROLL: the burst this roll is in
    local b, now = flag.burst, Now()
    if not b then
        b = { at = now, map = flag.Map(), cands = {}, handles = {}, left = 0, warm = now - flag.from < flag.WARM }
        for guid, f in pairs(flag.on) do if f.map == b.map then b.cands[guid] = true end end
        local keep = {}
        for _, x in ipairs(flag.bursts) do if now - x.at <= RECENT then keep[#keep + 1] = x end end
        keep[#keep + 1] = b
        flag.bursts, flag.burst = keep, b
    end
    if not handle then b.blind = true
    elseif not b.handles[handle] then b.handles[handle], b.left, b.doneAt = true, b.left + 1, nil end
    return b
end

-- The corpses of a boss encounter get their loot flag when the encounter ends, whenever they died (seen on Forever
-- 1.60.1: Rhahk'Zor 33 ms after ENCOUNTER_END, Sneed's Shredder and Sneed both 25 ms after theirs), and their rolls
-- are filed under the encounter in the loot history. So a list the history files under an encounter this session saw
-- end is from one of the burst's candidates that were flagged right then: these, or nil when that is not known.
function flag.OfEncounter(b, enc)
    local ended = enc and flag.ends[enc]
    if not (b and ended and ended.map == b.map) then return nil end
    local out = {}
    for guid in pairs(b.cands) do
        local f = flag.on[guid]
        if f and f.at >= ended.at - 0.5 and f.at <= ended.at + 1.5 then out[#out + 1] = guid end
    end
    return out
end

-- The encounter the game's loot history files a roll under: its id, 0 for none ("Miscellaneous"), nil when the client
-- has no history or does not list the roll.
function flag.Encounter(handle)
    local H = C_LootHistory
    if not (handle and H and H.GetAllEncounterInfos and H.GetSortedDropsForEncounter) then return nil end
    local infos = Plain(Try(H.GetAllEncounterInfos))
    if type(infos) ~= "table" then return nil end
    for i = 1, math.min(#infos, 60) do
        local id = type(infos[i]) == "table" and Int(infos[i].encounterID)
        local drops = id and Plain(Try(H.GetSortedDropsForEncounter, id))
        if type(drops) == "table" then
            for j = 1, math.min(#drops, 80) do
                if type(drops[j]) == "table" and Plain(drops[j].lootListKey) == handle then return id end
            end
        end
    end
end

function flag.Later(b)                          -- Resolve once a flip has had its time
    if C_Timer and C_Timer.After then
        C_Timer.After(flag.FLIP + 0.05, function() if b.doneAt then pcall(flag.Resolve, b, b.doneAt + flag.FLIP) end end)
    else flag.Resolve(b, b.doneAt + flag.FLIP) end
end

function flag.Resolve(b, at)                    -- the burst's list (b.e) has no corpse and its rolls have ended
    if b.named or b.blind or b.warm or not b.e or not b.doneAt then return end
    if (at or Now()) - b.doneAt < flag.FLIP then return flag.Later(b) end   -- a flip may still come
    b.named = true                              -- settled now, corpse or not
    if b.mixed then return end
    local guid, by = nil, nil
    if b.flipped and b.flipped ~= true then guid, by = b.flipped, "flip"
    elseif not b.flipped and not b.gone then
        local n = 0
        for g in pairs(b.cands) do n, guid = n + 1, g end
        if n == 1 and b.had and b.had[guid] then by = "sole" else guid = nil end
    end
    if not guid or Opened(guid .. "|roll") then return end   -- that corpse's roll list is recorded already: not this one
    local what, npc = FromGuid(guid)
    if b.enc and what == "npc" then bossNpcs[npc], bossEncounter[guid] = true, bossEncounter[guid] or b.enc end
    local threshold = b.e.src.threshold
    b.e.src = RollSource(guid)
    b.e.src.threshold, b.e.src.by = threshold, by
    for i = #sourceless, 1, -1 do if sourceless[i].e == b.e then table.remove(sourceless, i) end end
end

function flag.Done(handle)                      -- LOOT_ROLLS_COMPLETE
    handle = Int(Plain(handle))
    if not handle then return end
    for _, b in ipairs(flag.bursts) do
        if b.handles[handle] then
            b.handles[handle], b.left, b.endAt = nil, b.left - 1, Now()
            if b.left == 0 then                 -- the last of them: which candidates hold loot right now (for "sole")
                b.doneAt, b.had = b.endAt, {}
                for guid in pairs(b.cands) do b.had[guid] = Plain(Try(CanLootUnit, guid)) == true end
                flag.Later(b)
            end
        end
    end
end

-- Every loot window is an open, coins-only ones too (items = {}): drops / opens is the rate. Coins are never recorded.
-- Read at LOOT_READY (ready = true), the first moment the client has the loot. With auto-loot on, the game or a
-- fast-loot addon starts taking the slots right there, so at LOOT_OPENED the window is half or wholly empty, or it
-- never opens at all: reading there recorded kills with no items, or nothing. LOOT_OPENED reads only a window
-- LOOT_READY did not (a client without that event).
-- LOOT_READY can come again before the window closes (the client sends it twice for some corpses, and LOOT_CLOSED may
-- not come for a window that never opened). Such a read (again) keeps only what cannot be a repeat or a guess: a
-- source the client names by GUID, which Opened() counts once. Nothing without a GUID, no dead-target fallback (the
-- target may be another corpse by now) and no empty open.
local function RecordLoot(ready)
    local again = lootDone
    if again and not ready then return end
    lootDone = true
    local fishing = Plain(Try(IsFishingLoot)) == true
    local sources, order = {}, {}
    local function Of(guid, via)
        local key = type(guid) == "string" and guid or ""
        if not sources[key] then sources[key] = { guid = guid, via = via, items = {}, byId = {} }; order[#order + 1] = key end
        return sources[key]
    end
    -- without GetLootSourceInfo: the dead target at the moment the window opens (misses it if the target changed)
    local target
    local function Target()
        if target == nil then
            local guid = Plain(Try(UnitGUID, "target"))
            local dead = UnitIsDead == nil or Plain(Try(UnitIsDead, "target"))
            target = type(guid) == "string" and dead and guid or false
        end
        return target or nil
    end
    for slot = 1, Int((Try(GetNumLootItems))) or 0 do
        local link = Plain(Try(GetLootSlotLink, slot))
        local id = ItemId(link)                                -- coins and currencies have no item link: never recorded
        local _, _, quantity = Try(GetLootSlotInfo, slot)
        quantity = Int(quantity, 1) or 1
        local from = { Try(GetLootSourceInfo, slot) }        -- guid1, count1, guid2, count2, ... (area loot)
        local via = "slot"
        if type(Plain(from[1])) ~= "string" then
            -- coins (or a currency) the client names no source for are not a source of their own: without this, every
            -- corpse with coins also left an empty "other" open. A window with only those is still an open (below).
            if id then from, via = { Target() or false, quantity }, "target" else from = {} end
        end
        for i = 1, #from, 2 do
            local guid = Plain(from[i])
            local s = Of(type(guid) == "string" and guid or nil, via)
            if id then
                local n = Int(from[i + 1], 1) or quantity
                if s.byId[id] then s.byId[id].n = s.byId[id].n + n
                else s.byId[id] = { id = id, n = n, link = ShortLink(link) }; s.items[#s.items + 1] = s.byId[id] end
            end
        end
    end
    if #order == 0 and not again then Of(Target(), "target") end   -- a loot window with nothing in it
    for _, key in ipairs(order) do
        local s = sources[key]
        local src = Source(s.guid, s.via, fishing)
        if src and src.guid then src.encounter = bossEncounter[src.guid] end
        local skip = not src or (again and not (src.guid and s.via == "slot"))
        if not skip then
            -- the event (and its id) is made only for an open that is kept
            if not (src.guid and Opened(src.guid .. "|" .. src.kind)) then
                local e = NewEvent("loot")
                e.src, e.items = src, s.items
                Add(e)
            end
            if src.guid then Windowed(src, s.byId) end
        end
    end
end

-- One burst of rolls, read ROLL_SETTLE seconds after its last roll started (so a window this player opened on the same
-- corpse has been recorded first): one event per corpse, items merged by id like a window's.
local function FlushRolls()
    local list, burst = pendingRolls, flag.burst
    pendingRolls, flag.burst = {}, nil
    if #list == 0 then return end
    local now = Now()
    recentWindows, rolled = Fresh(recentWindows), Fresh(rolled)
    local groups, order = {}, {}                -- by the GUID the client gave, else all together
    for _, r in ipairs(list) do
        local key = r.guid or ""
        if not groups[key] then groups[key] = { guid = r.guid, rolls = {} }; order[#order + 1] = key end
        local g = groups[key]
        g.rolls[#g.rolls + 1] = r
    end
    for _, key in ipairs(order) do
        local g = groups[key]
        local guid, rest = g.guid, {}
        for _, r in ipairs(g.rolls) do
            local seen
            for i = #recentWindows, 1, -1 do
                local w = recentWindows[i]
                if (not guid or w.guid == guid) and w.byId[r.id] then seen = w; break end
            end
            if seen then                        -- recorded already by the window: only remember it for "You won"
                guid = guid or seen.guid
                if bossKill and seen.guid == bossKill.guid then bossKill.claimed = true end
                rolled[#rolled + 1] = { at = now, id = r.id, item = seen.byId[r.id] }
            else rest[#rest + 1] = r end
        end
        if #rest > 0 then
            local enc, by                       -- the encounter the game's loot history files these rolls under (0: none)
            for _, r in ipairs(rest) do enc = enc or flag.Encounter(r.handle) end
            -- the candidates flagged as that encounter ended: one is the corpse; several leave it to flip and sole
            -- among them (a boss of two bodies; the kill found at ENCOUNTER_END may be the other one); none still
            -- flagged leaves the flags nothing to say
            local own = not guid and key == "" and flag.OfEncounter(burst, enc) or nil
            if own and #own == 1 then
                guid, by = own[1], "end"
                if bossKill and bossKill.encounter == enc then bossKill.claimed = true end
            elseif own and #own > 1 then
                burst.cands, burst.warm = {}, false
                for _, g in ipairs(own) do burst.cands[g] = true end
            elseif not guid and bossKill and not bossKill.claimed and now - bossKill.at <= BOSS_LOOT and bossKill.map == Where().map
               and (enc == nil or enc == bossKill.encounter) then
                guid = bossKill.guid
            end
            if own and #own == 0 and not guid then burst.named = true end
            if guid and bossKill and guid == bossKill.guid then bossKill.claimed = true end
            enc = enc and enc > 0 and enc or nil
            if guid and enc and not bossEncounter[guid] then
                local what, npc = FromGuid(guid)
                if what == "npc" then bossNpcs[npc], bossEncounter[guid] = true, enc end
            end
            if not (guid and Opened(guid .. "|roll")) then
                local e, byId = NewEvent("loot"), {}
                e.src, e.items = RollSource(guid), {}
                e.src.by = by
                for _, r in ipairs(rest) do
                    if byId[r.id] then byId[r.id].n = byId[r.id].n + r.n
                    else byId[r.id] = { id = r.id, n = r.n, link = r.link }; e.items[#e.items + 1] = byId[r.id] end
                    rolled[#rolled + 1] = { at = now, id = r.id, item = byId[r.id] }
                end
                Add(e)
                if not guid then
                    sourceless = Fresh(sourceless); sourceless[#sourceless + 1] = { at = now, e = e }
                    e.src.encounter = enc       -- the boss's list, its corpse not known (yet)
                    if burst and key == "" and not burst.e then burst.e, burst.enc = e, enc end
                end
            end
        end
    end
    if burst then
        if burst.e then flag.Resolve(burst) else burst.named = true end   -- nothing left for the flags to name
    end
end

local function SafeFlushRolls()
    local ok, err = pcall(FlushRolls)
    local d = DB()
    if not ok and d then d.lastError = "observations rolls: " .. tostring(err) end
end

local function GuidIn(...)                      -- the first creature or object GUID among an event's values, or nil
    for i = 1, select("#", ...) do
        local v = Plain((select(i, ...)))
        if FromGuid(v) then return v end
    end
end

local pulled = {}                               -- creature GUIDs the group targeted alive when the encounter started

local function GroupTargets()                   -- unit, creature GUID, dead? for this player's and the group's targets
    local units, out = { "target", "focus", "mouseover" }, {}
    for i = 1, 5 do units[#units + 1] = "boss" .. i end
    if Try(IsInRaid) then for i = 1, 40 do units[#units + 1] = "raid" .. i .. "target" end
    else for i = 1, 4 do units[#units + 1] = "party" .. i .. "target" end end
    for _, unit in ipairs(units) do
        local guid = Plain(Try(UnitGUID, unit))
        if FromGuid(guid) == "npc" then out[#out + 1] = { guid = guid, dead = Plain(Try(UnitIsDead, unit)) and true } end
    end
    return out
end

local function Pulled(reset)                    -- ENCOUNTER_START (reset) and each engaged unit: who the group is on
    if reset then pulled = {} end
    for _, u in ipairs(GroupTargets()) do if not u.dead then pulled[u.guid] = true end end
end

-- The boss of an encounter just won: the dead creature most of the group is targeting, among those it was on when the
-- fight started (Forever shows no boss1..5 units, so a 5-player boss used to be recorded as a plain "mob"). A trash
-- corpse someone still targets is not the boss; any dead target only on the last try, or when the start was missed.
local function KilledBoss(encounter, last)
    local votes, best, most, any, anyMost = {}, nil, 0, nil, 0
    for _, u in ipairs(GroupTargets()) do
        if u.dead then
            local guid = u.guid
            votes[guid] = (votes[guid] or 0) + 1
            if pulled[guid] and votes[guid] > most then best, most = guid, votes[guid] end
            if votes[guid] > anyMost then any, anyMost = guid, votes[guid] end
        end
    end
    if not best and (last or not next(pulled)) then best = any end
    if not best then return false end
    local _, npc = FromGuid(best)
    bossNpcs[npc], bossEncounter[best] = true, encounter
    bossKill = { guid = best, npc = npc, encounter = encounter, map = Where().map, at = Now(), claimed = false }
    return true
end

-- "You won: [item]" (any language, and the newer one-line forms when the client has them): only this player's own line.
local WON_FORMATS = { "LOOT_ROLL_YOU_WON", "LOOT_ROLL_YOU_WON_NO_SPAM_NEED", "LOOT_ROLL_YOU_WON_NO_SPAM_GREED",
                      "LOOT_ROLL_YOU_WON_NO_SPAM_DE", "LOOT_ROLL_YOU_WON_NO_SPAM_TRANSMOG" }
local function FormatPattern(fmt)               -- "You won: %s" -> "^You won: (.+)$" (as Raids.lua; a translation may write %1$s)
    local parts, i = {}, 1
    local function esc(s) return (s:gsub("[%^%$%(%)%%%.%[%]%*%+%-%?]", "%%%0")) end
    while i <= #fmt do
        local s, e, _, kind = fmt:find("%%(%d*)%$?([sd])", i)
        if not s then parts[#parts + 1] = esc(fmt:sub(i)); break end
        parts[#parts + 1] = esc(fmt:sub(i, s - 1))
        parts[#parts + 1] = kind == "d" and "(%d+)" or "(.+)"
        i = e + 1
    end
    return "^" .. table.concat(parts) .. "$"
end
local wonPatterns
local function WonPatterns()
    if wonPatterns then return wonPatterns end
    wonPatterns = {}
    for i, name in ipairs(WON_FORMATS) do
        local fmt = _G[name]
        if i == 1 and (type(fmt) ~= "string" or fmt == "") then fmt = "You won: %s" end
        if type(fmt) == "string" and fmt ~= "" then wonPatterns[#wonPatterns + 1] = FormatPattern(fmt) end
    end
    return wonPatterns
end

local function Won(text)
    if #rolled == 0 or type(text) ~= "string" then return end
    local link
    for _, p in ipairs(WonPatterns()) do
        for _, c in ipairs({ text:match(p) }) do
            if type(c) == "string" and c:find("|Hitem:", 1, true) then link = c end
        end
        if link then break end
    end
    local id = ItemId(link)
    if not id then return end
    rolled = Fresh(rolled)
    for i = #rolled, 1, -1 do
        local r = rolled[i]
        if r.id == id and not r.item.won then r.item.won = true; return end
    end
end

---------------------------------------------------------------------------
-- quests: accepted (with the giver) and turned in (with the ender), both with the rewards the quest window listed
---------------------------------------------------------------------------
local detail = nil                              -- { quest, what, id, at, rewards } from the quest window that offered it
local turnin = nil                              -- { quest, what, id, items, choices, chose, rewards } from the reward window
local progress = nil                            -- { quest, text } from the "do you have it yet?" window before it
local hookedReward, haveTurnedInEvent = false, false
-- the extras (1.18.0), filled in further down: facts from the quest log on accept; the reward window's XP and the
-- reputation a turn-in changed. rep: the watch { quest, before = { [factionID] = standing }, at, turned, spoiled, e }
local qx = { REP_MAX = 6, REP_D = 100000, STALE = 300, WAIT = 1, FACTIONS = 1000, GUILD = 1168, rep = nil,
             OBJECTIVES = 12, POIS = 8, DATA_WAIT = 10, waiting = {} }

-- The quest window's words. The game writes the character's name into them; it goes back to "$N", so the text is the
-- quest's and not about the player. Cut to the field's limit on a whole UTF-8 character.
local function ReplaceName(s, name, fold)
    local pat = name:gsub("(%W)", "%%%1")
    if fold then pat = pat:gsub("%a", function(c) return "[" .. c:lower() .. c:upper() .. "]" end) end
    if name:find("^%w") then pat = "%f[%w]" .. pat end
    if name:find("%w$") then pat = pat .. "%f[%W]" end
    return (s:gsub(pat, "$N"))
end

local function Prose(s, max, names, fold)
    s = Plain(s)
    if type(s) ~= "string" then return nil end
    s = s:gsub("%c", function(c) return c == LF and c or "" end):gsub("^%s+", ""):gsub("%s+$", "")
    if s == "" then return nil end
    if names then
        for _, name in ipairs(names) do s = ReplaceName(s, name, fold) end
    end
    if max then s = Cut(s, max) end
    return s ~= "" and s or nil
end

-- New game prose fields share a half-cap gate and separate, saved FIFO indexes. Each ring holds only
-- bounded keys, with a session set for constant-time lookups; dropping an event does not forget its key.
local gameText = { CAP = 2000, indexes = {}, mail = false, openers = {} }
-- Before enabling bag pages, confirm in-game that ItemTextGetCreator() prints a creator for a saved
-- player letter, an NPC-sent letter and an auction letter, and prints nil for a game book.
local READ_BAG_ITEMS = false

for word in ("A An And Away Back Be But Can Come Do Don't Everyone For Get Go Good Halt Hear Hello Here How If In It "
    .. "Keep Leave Let Look Move My Never No Now Oh On Our Run See Stand Stay Stop Take That The There These They This "
    .. "Those To Wait Watch We Welcome Well What When Where Who Why With Yes You Your"):gmatch("%S+") do
    gameText.openers[word] = true
end

function gameText.Id(v)
    local id = Int(v, 1)
    if id and id <= 2147483647 then return id end
end

function gameText.Room(added)
    return #DB().events < MAX_EVENTS / 2 and bytes + (added or 0) <= MAX_BYTES / 2
end

function gameText.PlainText(s)
    s = Plain(s)
    if type(s) == "string" and not s:find("|", 1, true) and not s:find("%a+%-%d+%-%d+") then return s end
end

function gameText.Prose(s, max, names, fold)
    return gameText.PlainText(Prose(gameText.PlainText(s), max, names, fold))
end

function gameText.Punctuation(text)
    return (text:gsub("…", "..."):gsub("’", "'"):gsub("‘", "'"):gsub("“", '"'):gsub("”", '"')
        :gsub("–", "-"):gsub("—", "-"))
end

function gameText.OwnNames()
    local given, surname = Me()
    if not given then return nil end
    return surname and { given .. " " .. surname, given, surname } or { given }
end

function gameText.Checksum(s)
    local a, b = 1, 1
    for i = 1, #s do
        local c = s:byte(i)
        a, b = (a * 33.0 + c) % 2147483647, (b * 131.0 + c) % 2147483629
    end
    return string.format("%08x%08x", a, b)
end

function gameText.Index(kind)
    local index = gameText.indexes[kind]
    if index then return index end
    local d = DB()
    if type(d.textSeen) ~= "table" then d.textSeen = {} end
    local ring = d.textSeen[kind]
    if type(ring) ~= "table" or type(ring.keys) ~= "table" or #ring.keys > gameText.CAP
        or not Int(ring.next, 1) or ring.next > gameText.CAP or ring.next > #ring.keys + 1 then
        ring = { next = 1, keys = {} }
        d.textSeen[kind] = ring
    end
    index = { ring = ring, seen = {} }
    for i, key in ipairs(ring.keys) do index.seen[key] = i end
    gameText.indexes[kind] = index
    return index
end

function gameText.Remember(index, key)
    local ring, seen = index.ring, index.seen
    local i = ring.next
    local old = ring.keys[i]
    if old then seen[old] = nil end
    ring.keys[i], seen[key], ring.next = key, i, i % gameText.CAP + 1
end

-- Includes the new event in the half-cap check. A refused event does not consume an ID or a dedup key.
function gameText.Record(kind, key, fields)
    local index = gameText.Index(kind)
    if index.seen[key] then return true end
    local d, e = DB(), NewEvent(kind)
    for k, v in pairs(fields) do e[k] = v end
    if not gameText.Room(Size(e)) then d.n = d.n - 1; return end
    Add(e)
    gameText.Remember(index, key)
    return true
end

function gameText.InMail()
    if gameText.mail then return true end
    for _, name in ipairs({ "MailFrame", "InboxFrame", "OpenMailFrame" }) do
        local frame = _G[name]
        if Secret(frame) or (frame and Plain(Try(frame.IsVisible, frame)) ~= false) then return true end
    end
    return false
end

function gameText.Gossip(kind)
    if not gameText.Room() or gameText.InMail() then return end
    local what, id = Giver("npc")
    id = gameText.Id(id)
    if not id then return end
    local names = gameText.OwnNames()
    if not names then return end
    local s
    if kind == "gossip" then
        s = Try(C_GossipInfo and C_GossipInfo.GetText)
        if not Secret(s) and s == nil then s = Try(GetGossipText) end
    else
        s = Try(GetGreetingText)
    end
    local text = gameText.Prose(s)
    if not text then return end
    local lower = gameText.Punctuation(text):lower():gsub(" ", " "):gsub(" ", " ")
    for _, coin in ipairs({ "gold", "silver", "copper" }) do
        if lower:find("%d%s*%f[%a]" .. coin .. "%f[%A]") then return end
    end
    for _, name in ipairs(names) do text = ReplaceName(text, name, true) end
    local players = {}
    if not gameText.AddRoster(players) then return end
    for _, name in ipairs(players) do
        if ReplaceName(text, name, true) ~= text then return end
    end
    if what == "object" and gameText.HasUnknownName(gameText.Punctuation(text), "npc") then return end
    text = Cut(text, TEXT_MAX.gossip)
    local key = what .. ":" .. id .. ":" .. gameText.Checksum(text)
    gameText.Record("gossip", key, { [what] = id, text = text, kind = kind })
end

-- Read the creator before any title or page body. Try() alone cannot distinguish a nil creator (game
-- text) from a failed call. An empty creator is ambiguous, as is a material used for mail.
function gameText.BookMaterial()
    if type(ItemTextGetCreator) ~= "function" or type(ItemTextGetMaterial) ~= "function" then return nil, false end
    local ok, creator = pcall(ItemTextGetCreator)
    if not ok or Secret(creator) or creator ~= nil then return nil, false end
    local got, raw = pcall(ItemTextGetMaterial)
    if not got or Secret(raw) then return nil, false end
    if raw == nil or raw == "" then return nil, true end
    local material = gameText.PlainText(Label(gameText.PlainText(raw), 40))
    if not material then return nil, false end
    local lower = material:lower()
    if lower:find("mail", 1, true) or lower:find("letter", 1, true) or lower:find("stationery", 1, true) then
        return nil, false
    end
    return material, true
end

function gameText.BookBegin()
    local used = gameText.bookUse
    gameText.book = nil
    if not gameText.Room() or gameText.InMail() then return end
    local clock = used and Num(Try(GetTime))
    if not READ_BAG_ITEMS and used and (not clock or not used.at or clock - used.at <= 1) then return end
    gameText.bookUse = nil
    local ok, guid = pcall(UnitGUID, "npc")
    if not ok or Secret(guid) or (guid ~= nil and type(guid) ~= "string") then return end
    local what, id = FromGuid(guid)
    local object = what == "object" and gameText.Id(id) or nil
    if not READ_BAG_ITEMS and not object then return end
    local recentUse = used and clock and used.at and clock >= used.at and clock - used.at <= 1
    local _, safe = gameText.BookMaterial()
    if not safe then return end
    local title = gameText.PlainText(Try(ItemTextGetItem))
    if not Label(title, 200) then return end
    local item
    if READ_BAG_ITEMS and recentUse and used.title == title then
        if object then object = nil            -- both sources are plausible: keep the title only
        elseif guid == nil then item = used.id end
    end
    gameText.book = { rawTitle = title, item = item, object = object, guid = object and guid or nil }
end

function gameText.BookPage()
    local book = gameText.book
    if not book or not gameText.Room() then return end
    if gameText.InMail() or (book.guid and Plain(Try(UnitGUID, "npc")) ~= book.guid) then
        gameText.book = nil
        return
    end
    local material, safe = gameText.BookMaterial()
    local rawTitle = safe and gameText.PlainText(Try(ItemTextGetItem))
    if rawTitle ~= book.rawTitle then gameText.book = nil; return end
    local page = gameText.Id(Try(ItemTextGetPage))
    if not page then return end
    local names = gameText.OwnNames()
    local title = names and Label(gameText.Prose(rawTitle, 200, names), 200)
    if not title then return end
    local subject = book.object and ("o:" .. book.object) or book.item and ("i:" .. book.item)
        or ("t:" .. gameText.Checksum(title))
    local key = subject .. ":" .. page
    if gameText.Index("read").seen[key] then return end
    local text = gameText.Prose(Try(ItemTextGetText), TEXT_MAX.read, names)
    if not text then return end
    local ok, more = pcall(ItemTextHasNextPage)
    local last = ok and not Secret(more) and (more == false or more == nil)
    gameText.Record("read", key, { item = book.item, object = book.object, title = title, page = page,
                                   last = last and true or nil, material = material, text = text })
end

-- The secure bag post-hook can run before or after BEGIN. With bag recording off, reject an
-- overlapping read even if the client still has a world object in the "npc" unit.
function gameText.BookUse(id, info)
    gameText.bookUse = nil
    local d = DB()
    if not (d and d.on and d.agreed) then return end
    if not READ_BAG_ITEMS then
        gameText.book, gameText.bookUse = nil, { at = Num(Try(GetTime)) }
        return
    end
    if not id or gameText.book or not gameText.Room() or gameText.InMail() then return end
    if Plain(info.isReadable) ~= true then return end
    local title = gameText.PlainText(info.itemName)
    local clock = Num(Try(GetTime))
    if Label(title, 200) and clock then gameText.bookUse = { id = id, title = title, at = clock } end
end

local function QuestId(...)                     -- QUEST_ACCEPTED is (index, questId) in older clients, (questId) in newer
    if select("#", ...) >= 2 then return gameText.Id((select(2, ...))) end
    return gameText.Id((...))
end

local function QuestText(fields)                -- { title = GetTitleText, ... } -> { title = "...", ... } or nil
    if not gameText.Room() then return end
    local names = gameText.OwnNames()
    if not names then return end
    local out, any = {}, false
    for key, fn in pairs(fields) do
        local s = Prose(Try(fn), TEXT_MAX[key], names)
        if s then out[key], any = s, true end
    end
    return any and out or nil
end

-- A quest's text is kept once per quest and act ("7787|accept") among the saved events, and only while the events are
-- below the half caps, so prose leaves room for drops.
local texted
local function WantsText(e, text)
    if not gameText.Room(Size(e) + Size({ text = text }) - 2) then return false end
    if not texted then
        texted = {}
        for _, e in ipairs(DB().events) do
            if type(e) == "table" and e.type == "quest" and type(e.text) == "table" then
                texted[tostring(e.quest) .. "|" .. tostring(e.act)] = true
            end
        end
    end
    local key = e.quest .. "|" .. e.act
    if texted[key] then return false end
    texted[key] = true
    return true
end

local function RewardItems(kind, count)
    local items = {}
    for i = 1, Int(count) or 0 do
        local link = Plain(Try(GetQuestItemLink, kind, i))
        local id = ItemId(link)
        local _, _, n = Try(GetQuestItemInfo, kind, i)
        if id then items[#items + 1] = { id = id, n = Int(n, 1) or 1, link = ShortLink(link) } end
    end
    return items
end

local function TurnedIn(questId)
    local e = NewEvent("quest")
    e.act, e.quest = "turnin", questId
    local p = turnin
    if p and p.quest == questId then
        if p.what then e[p.what] = p.id end
        local choices = {}
        for _, it in ipairs(p.choices) do if it then choices[#choices + 1] = it.id end end   -- false: a slot with no item id
        local r = p.rewards or {}
        r.items, r.choices, r.chose = p.items, choices, p.chose
        e.rewards = r
        e.xp = p.xp
        if p.text and WantsText(e, p.text) then e.text = p.text end
    end
    if qx.window == p then qx.window = nil end
    turnin, progress, qx.turnedAt = nil, nil, Now()
    Add(e)
    pcall(qx.TurnedIn, questId, e)
end

local function HookReward()
    if hookedReward or type(hooksecurefunc) ~= "function" or type(GetQuestReward) ~= "function" then return end
    hookedReward = pcall(hooksecurefunc, "GetQuestReward", function(choice)
        local d, p = DB(), turnin
        if not (d and d.on and p) then return end
        local it = p.choices[Plain(choice)]
        if it then p.chose = it.id end
        if not haveTurnedInEvent then pcall(TurnedIn, p.quest) end  -- a client without QUEST_TURNED_IN
    end)
end

---------------------------------------------------------------------------
-- vendors: what is for sale when the window opens
---------------------------------------------------------------------------
local vendorSeen = {}                           -- npc id -> { at = time(), sig = ... } this session
local merchantOpen = false

local function Repairs(svc)                     -- the services list, with "repair" when this merchant window can repair
    local can = Plain(Try(CanMerchantRepair))
    if can == true or can == 1 then svc[#svc + 1] = "repair" end
    return svc
end

local function Cost(i)
    local cost = {}
    for j = 1, Int((Try(GetMerchantItemCostInfo, i))) or 0 do
        local _, value, link = Try(GetMerchantItemCostItem, i, j)
        value, link = Int(value, 1), Plain(link)
        if value and type(link) == "string" then
            local item, currency = ItemId(link), tonumber(link:match("currency:(%d+)"))
            if item then cost[#cost + 1] = { item = item, n = value }
            elseif currency then cost[#cost + 1] = { currency = currency, n = value } end
        end
    end
    return cost
end

-- The merchant window's item filter (this class / all) hides items from addons too. The read is made under "all" and
-- the filter put back straight after, in the same frame, so the window never draws the other list; this module has no
-- MERCHANT_UPDATE handler, so the filter change cannot start a loop. -> the filter to put back (or nil), and true when
-- the read is still filtered because the filter could not be switched.
local function AllMerchantItems()
    local all = Plain(LE_LOOT_FILTER_ALL)
    if type(GetMerchantFilter) ~= "function" or type(all) ~= "number" then return nil, false end
    local was = Try(GetMerchantFilter)
    if Secret(was) or was == nil or was == all then return nil, false end
    if type(SetMerchantFilter) ~= "function" then return nil, true end
    Try(SetMerchantFilter, all)
    return was, Plain(Try(GetMerchantFilter)) ~= all
end

local function VendorItems()
    local items, sig = {}, {}
    for i = 1, Int((Try(GetMerchantNumItems))) or 0 do
        local id = Int(Try(GetMerchantItemID, i), 1)
        local price, stack, available, extended
        local info = C_MerchantFrame and C_MerchantFrame.GetItemInfo and Try(C_MerchantFrame.GetItemInfo, i)
        if type(info) == "table" then
            price, stack, available, extended = info.price, info.stackCount, info.numAvailable, info.hasExtendedCost
        else
            local _, _, pr, st, av, _, _, ex = Try(GetMerchantItemInfo, i)
            price, stack, available, extended = pr, st, av, ex
        end
        if id then
            local link = ShortLink(Plain(Try(GetMerchantItemLink, i)))
            local it = { id = id, n = Int(stack, 1) or 1, link = ItemId(link) == id and link or nil, price = Int(price) or 0,
                         limited = Int(available) }
            if Plain(extended) then
                local cost = Cost(i)
                if #cost > 0 then it.cost = cost end
            end
            items[#items + 1] = it
            sig[#sig + 1] = id .. ":" .. it.n .. ":" .. it.price .. ":" .. tostring(it.limited)
        end
    end
    return items, sig
end

local function RecordVendor()
    if not merchantOpen then return end
    local what, npc = Giver("npc")
    if what ~= "npc" then return end
    pcall(Sighting, "npc", true, Repairs({ "vendor" }))   -- the window is open with it: the player stands at the vendor
    local was, filtered = AllMerchantItems()
    local ok, items, sig = pcall(VendorItems)
    if was ~= nil then Try(SetMerchantFilter, was) end
    if not ok then error(items, 0) end
    if #items == 0 then return end
    local rx = Reaction()
    sig = table.concat(sig, ",") .. "|" .. tostring(rx) .. (filtered and "|filtered" or "")
    local seen, now = vendorSeen[npc], time()
    if seen and seen.sig == sig and now - seen.at < VENDOR_AGAIN then return end
    vendorSeen[npc] = { at = now, sig = sig }
    local e = NewEvent("vendor")
    e.npc, e.rx, e.items = npc, rx, items
    if filtered then e.filtered = true end
    Add(e)
end

---------------------------------------------------------------------------
-- trainers: what a class or profession trainer teaches, at what price, when the window opens
---------------------------------------------------------------------------
local TRAINER_AGAIN = 7 * 86400                 -- the same trainer with the same list is recorded at most once a week
local TRAINER_ROWS, TRAINER_TRIES = 400, 5      -- rows kept; reads per window while the list comes back empty
local TRAINER_FILTERS = { "available", "unavailable", "used" }
local TRAINER_STATE = { available = "a", unavailable = "u", used = "k" }
local trainer = { open = false, done = false, pending = false, reading = false, tries = 0, token = 0 }
local trainerSeen                               -- npc .. "|" .. signature -> the newest t, from the saved events on first use

-- "class" (any general trainer), "profession", or nil for the hunter's Beast Training window (no trainer NPC, and it
-- costs training points, not copper)
local function TrainerKind()
    local T, E = C_Trainer, Enum and Enum.TrainerType
    local t = T and T.GetTrainerType and Plain(Try(T.GetTrainerType))
    if t ~= nil then
        if t == (E and E.Pet or 3) then return nil end
        return t == (E and (E.Tradeskills or E.Tradeskill) or 2) and "profession" or "class"
    end
    return Plain(Try(IsTradeskillTrainer)) and "profession" or "class"
end

-- A service's spell id: the client has no GetTrainerServiceSpellID, but its tooltip data names the spell. nil when the
-- client gives none (or names something that is not a spell).
local function TrainerSpell(i)
    local TI, spell = C_TooltipInfo, Enum and Enum.TooltipDataType and Enum.TooltipDataType.Spell
    if not (TI and type(TI.GetTrainerService) == "function" and spell ~= nil) then return nil end
    local data = Try(TI.GetTrainerService, i)
    if type(data) ~= "table" or Plain(data.type) ~= spell then return nil end
    return Int(data.id, 1)
end

-- What makes two readings of a trainer the same list: each service's name, rank, cost, level and skill, and rx. Not
-- st (learning a spell changes nothing) and not the spell id (the same whether or not the tooltip answered).
local function TrainerSig(rows, rx)
    local parts = {}
    for i, r in ipairs(rows) do
        if type(r) ~= "table" then r = {} end
        parts[i] = tostring(r.name) .. "/" .. tostring(r.rank or "") .. ":" .. tostring(r.cost) .. ":" .. tostring(r.lv or "")
                   .. ":" .. tostring(r.skillReq or "")
    end
    return table.concat(parts, ",") .. "|" .. tostring(rx)
end

local function TrainerSeen()
    if not trainerSeen then
        trainerSeen = {}
        for _, e in ipairs(DB().events) do
            if type(e) == "table" and e.type == "trainer" and type(e.rows) == "table" and type(e.t) == "number" then
                local key = tostring(e.npc) .. "|" .. TrainerSig(e.rows, e.rx)
                if not trainerSeen[key] or trainerSeen[key] < e.t then trainerSeen[key] = e.t end
            end
        end
    end
    return trainerSeen
end

-- The list, read with every type filter on. -> the event, or nil (empty list, or the same list recorded this week)
local function ReadTrainer(npc, kind)
    local rows, index = {}, {}
    for i = 1, Int((Try(GetNumTrainerServices))) or 0 do
        if #rows >= TRAINER_ROWS then break end
        local name, status, _, lv, rank = Try(GetTrainerServiceInfo, i)
        local st, cost = TRAINER_STATE[Plain(status)], Int((Try(GetTrainerServiceCost, i)))
        name = Label(name, 120)
        if st and name and cost then                -- headers, and rows whose name or cost cannot be read, are left out
            local skill, skillReq = Try(GetTrainerServiceSkillReq, i)
            local row = { name = name, rank = Label(rank, 40), lv = Int(lv, 1) or Int(Try(GetTrainerServiceLevelReq, i), 1),
                          skill = Label(skill, 64), skillReq = Int(skillReq, 1), cost = cost, st = st }
            local needs = {}
            for j = 1, math.min(Int((Try(GetTrainerServiceNumAbilityReq, i))) or 0, 5) do
                needs[#needs + 1] = Label((Try(GetTrainerServiceAbilityReq, i, j)), 120)
            end
            if #needs > 0 then row.needs = needs end
            index[#rows + 1] = i
            rows[#rows + 1] = row
        end
    end
    if #rows == 0 then return nil end
    trainer.done = true
    local rx = Reaction()
    local key, now, seen = npc .. "|" .. TrainerSig(rows, rx), time(), TrainerSeen()
    if seen[key] and now - seen[key] < TRAINER_AGAIN then return nil end
    seen[key] = now
    for n, row in ipairs(rows) do row.s = TrainerSpell(index[n]) end   -- only for a list that is recorded
    local e = NewEvent("trainer")
    e.npc, e.kind, e.rx, e.rows = npc, kind, rx, rows
    return e
end

local function RecordTrainer()
    trainer.pending = false
    if not trainer.open or trainer.done or trainer.tries >= TRAINER_TRIES or type(GetNumTrainerServices) ~= "function" then return end
    trainer.tries = trainer.tries + 1
    local kind = TrainerKind()
    if not kind then trainer.done = true; return end
    local guid = Plain(Try(UnitGUID, "npc"))
    if type(guid) ~= "string" then return end   -- the npc unit is not there yet: the next TRAINER_UPDATE tries again
    local what, npc = FromGuid(guid)
    if what ~= "npc" then trainer.done = true; return end   -- not a creature: never recorded
    pcall(Sighting, "npc", true, { "trainer" })
    trainer.reading = true                     -- the filter switches below fire TRAINER_UPDATE: ignored meanwhile
    local off = {}
    if type(GetTrainerServiceTypeFilter) == "function" and type(SetTrainerServiceTypeFilter) == "function" then
        for _, f in ipairs(TRAINER_FILTERS) do
            local on = Try(GetTrainerServiceTypeFilter, f)
            if not Secret(on) and not on then off[#off + 1] = f; Try(SetTrainerServiceTypeFilter, f, true) end
        end
    end
    local ok, e = pcall(ReadTrainer, npc, kind)
    for _, f in ipairs(off) do Try(SetTrainerServiceTypeFilter, f, false) end
    trainer.reading = false
    if not ok then error(e, 0) end
    if e then Add(e) end
end

local function SoonTrainer()                    -- one read about 0.5 s after the window opens (or its list arrives)
    if trainer.pending or trainer.done or not trainer.open then return end
    trainer.pending = true
    local token = trainer.token
    local function run()
        if token ~= trainer.token then return end
        local ok, err = pcall(RecordTrainer)
        trainer.reading = false
        local d = DB()
        if not ok and d then d.lastError = "observations trainer: " .. tostring(err) end
    end
    if C_Timer and C_Timer.After then C_Timer.After(0.5, run) else run() end
end

---------------------------------------------------------------------------
-- flight masters: where a flight master's map can take this character and at what price; how long a flight takes
---------------------------------------------------------------------------
-- AGAIN: the same flight master, node, prices and rx once a week; FLOWN: one flight time per from/to in 30 days; PICK: a
-- chosen destination waits this long for the flight to start; BOARD: tries (0.5 s apart) for UnitOnTaxi to say so; LAND:
-- the same at landing; CONFIRM: a landing whose position could not be read waits this long for the next taxi window;
-- NEAR: how close (taxi-map units, 0-1) the landing must be to the chosen node, and no other node closer
local TAXI = { AGAIN = 7 * 86400, NODES = 200, FLOWN = 30 * 86400, PICK = 10, BOARD = 10, LAND = 6, CONFIRM = 120,
               NEAR = 0.01, SEC_MIN = 5, SEC_MAX = 3600 }
-- window: the taxi window read when it opened { npc, from, map, slots = { [slot] = node }, pos = { [node] = { x, y } } };
-- pick: the destination chosen in it; flight: the flight under way; landed: a landing waiting for the next taxi window
local taxi = { window = nil, pick = nil, flight = nil, landed = nil, seen = nil, flown = nil, hooked = false, token = 0 }

local function TaxiPos(n)                       -- a node's position on the taxi map, or nil
    local p = type(n) == "table" and Plain(n.position) or nil
    if type(p) ~= "table" then return nil end
    local x, y = Num(p.x), Num(p.y)
    if not (x and y) and type(p.GetXY) == "function" then x, y = Try(p.GetXY, p); x, y = Num(x), Num(y) end
    if x and y and x >= 0 and x <= 1 and y >= 0 and y <= 1 and (x > 0 or y > 0) then return { x, y } end
end

-- The open taxi window: node ids from C_TaxiMap.GetAllTaxiNodes(GetTaxiMapID()), joined by slotIndex to the slot functions
-- (TaxiNodeGetType, TaxiNodeCost, GetNumRoutes). -> { from, map, to = { { node, cost, hops } } sorted by node, slots, pos },
-- or nil when anything needed is missing or doubtful: no node ids (names are not ids), no single current node, a reachable
-- slot no node maps to or without a cost, a slot whose two names disagree, or more than 200 reachable nodes.
function taxi.Read()
    local T, map, count = C_TaxiMap, Int(Try(GetTaxiMapID), 1), Int((Try(NumTaxiNodes)))
    if not (T and type(T.GetAllTaxiNodes) == "function" and map and count and count > 0) then return nil end
    local list = Try(T.GetAllTaxiNodes, map)
    if type(list) ~= "table" or Secret(list) then return nil end
    local bySlot, ids, w = {}, {}, { map = map, to = {}, slots = {}, pos = {} }
    for _, n in ipairs(list) do
        local slot, id = type(n) == "table" and Int(n.slotIndex, 1), type(n) == "table" and Int(n.nodeID, 1)
        if slot and id then
            if bySlot[slot] or ids[id] then return nil end
            bySlot[slot], ids[id], w.pos[id] = n, true, TaxiPos(n)
        end
    end
    local S = Enum and Enum.FlightPathState
    for slot = 1, count do
        local n, kind = bySlot[slot], Plain(Try(TaxiNodeGetType, slot))
        if type(kind) ~= "string" and n and S then
            local st = Plain(n.state)
            kind = st ~= nil and (st == S.Current and "CURRENT" or st == S.Reachable and "REACHABLE") or nil
        end
        if kind == "CURRENT" or kind == "REACHABLE" then
            if not n then return nil end
            local name, other = Plain(n.name), Plain(Try(TaxiNodeName, slot))
            if type(name) == "string" and type(other) == "string" and name ~= other then return nil end
            local id = Int(n.nodeID, 1)
            if kind == "CURRENT" then
                if w.from then return nil end
                w.from = id
            else
                local cost = Int((Try(TaxiNodeCost, slot)))
                if not cost or #w.to >= TAXI.NODES then return nil end
                w.to[#w.to + 1] = { node = id, cost = cost, hops = Int((Try(GetNumRoutes, slot)), 1) }
                w.slots[slot] = id
            end
        end
    end
    if not w.from then return nil end
    table.sort(w.to, function(a, b) return a.node < b.node end)
    return w
end

local function TaxiSig(to)                      -- what makes two readings the same list: each node and its price
    local parts = {}
    for i, x in ipairs(type(to) == "table" and to or {}) do
        parts[i] = type(x) == "table" and (tostring(x.node) .. ":" .. tostring(x.cost)) or "?"
    end
    return table.concat(parts, ",")
end

-- The newest t per key among the saved events, built on first use: taxi (npc|node|prices|rx) and flight (from>to)
function taxi.Index()
    if taxi.seen then return end
    taxi.seen, taxi.flown = {}, {}
    for _, e in ipairs(DB().events) do
        if type(e) == "table" and type(e.t) == "number" then
            local key, into
            if e.type == "taxi" then
                key, into = tostring(e.npc) .. "|" .. tostring(e.node) .. "|" .. TaxiSig(e.to) .. "|" .. tostring(e.rx), taxi.seen
            elseif e.type == "flight" then key, into = tostring(e.from) .. ">" .. tostring(e.to), taxi.flown end
            if key and (not into[key] or into[key] < e.t) then into[key] = e.t end
        end
    end
end

function taxi.Opened()
    taxi.window = nil
    local w = taxi.Read()
    local landed = taxi.landed                  -- a landing whose position could not be read: this window decides it
    taxi.landed = nil
    if landed and w and w.from == landed.to and Now() - landed.at <= TAXI.CONFIRM then taxi.Record(landed) end
    local what, npc = Giver("npc")
    if what ~= "npc" then return end            -- not a creature: never recorded
    pcall(Sighting, "npc", true, { "flight" })
    if not w then return end
    w.npc = npc
    taxi.window = w
    local rx = Reaction()
    taxi.Index()
    local key, now = npc .. "|" .. w.from .. "|" .. TaxiSig(w.to) .. "|" .. tostring(rx), time()
    if taxi.seen[key] and now - taxi.seen[key] < TAXI.AGAIN then return end
    taxi.seen[key] = now
    local e = NewEvent("taxi")
    e.npc, e.node, e.rx, e.to = npc, w.from, rx, w.to
    Add(e)
end

function taxi.Record(f)                        -- a flight both ends of which are known: once per from/to in 30 days
    taxi.Index()
    local key, now = f.from .. ">" .. f.to, time()
    if taxi.flown[key] and now - taxi.flown[key] < TAXI.FLOWN then return end
    taxi.flown[key] = now
    local e = NewEvent("flight")
    e.where, e.from, e.to, e.sec, e.t = nil, f.from, f.to, f.sec, f.t or e.t   -- t: when it landed, also when confirmed later
    Add(e)
end

-- TakeTaxiNode(slot), after the game ran it: the destination chosen in the window we read
function taxi.Take(slot)
    local d, w = DB(), taxi.window
    if not (d and d.on and d.agreed and w) then taxi.pick = nil; return end   -- never an older window's pick
    slot = Int(slot, 1)
    local to = slot and w.slots[slot]
    taxi.pick = to and to ~= w.from and { from = w.from, to = to, at = Now(), map = w.map, pos = w.pos } or nil
end

-- At landing: true when the player stands by the chosen node (no other node closer, within NEAR), false when somewhere
-- else, nil when the position cannot be read on the taxi map
function taxi.Arrived(f)
    local M = C_Map
    local mine = f.pos[f.to]
    if not (mine and M and M.GetPlayerMapPosition) then return nil end
    local pos = Try(M.GetPlayerMapPosition, f.map, "player")
    if type(pos) ~= "table" or Secret(pos) or type(pos.GetXY) ~= "function" then return nil end
    local x, y = Try(pos.GetXY, pos)
    x, y = Num(x), Num(y)
    if not (x and y) or (x == 0 and y == 0) then return nil end
    local best, bestD
    for id, p in pairs(f.pos) do
        local dd = (p[1] - x) ^ 2 + (p[2] - y) ^ 2
        if not bestD or dd < bestD then best, bestD = id, dd end
    end
    return best == f.to and bestD <= TAXI.NEAR ^ 2
end

-- PLAYER_CONTROL_LOST soon after a destination was chosen: the flight starts if UnitOnTaxi says so (now or within 5 s)
function taxi.Board()
    local p = taxi.pick
    taxi.pick = nil
    if not p or Now() - p.at > TAXI.PICK then return end
    taxi.token = taxi.token + 1
    local token, start, tries = taxi.token, Now(), 0
    local function check()
        if token ~= taxi.token then return end
        if Plain(Try(UnitOnTaxi, "player")) == true then
            taxi.flight = { from = p.from, to = p.to, start = start, map = p.map, pos = p.pos }
        elseif tries < TAXI.BOARD and C_Timer and C_Timer.After then
            tries = tries + 1
            C_Timer.After(0.5, function() pcall(check) end)
        end
    end
    check()
end

-- PLAYER_CONTROL_GAINED during a flight: landed once UnitOnTaxi is a plain false (now or within 3 s); kept when it still
-- says true (control came back mid-flight); dropped when the client will not say
function taxi.Land()
    local f = taxi.flight
    if not f then return end
    taxi.token = taxi.token + 1
    local token, at, tries = taxi.token, Now(), 0
    local function check()
        if token ~= taxi.token or taxi.flight ~= f then return end
        local on = Plain(Try(UnitOnTaxi, "player"))
        if on == true and tries < TAXI.LAND and C_Timer and C_Timer.After then
            tries = tries + 1
            C_Timer.After(0.5, function() pcall(check) end)
            return
        end
        if on == true then return end           -- still flying: wait for the next PLAYER_CONTROL_GAINED
        taxi.flight = nil
        if on ~= false then return end
        local sec = math.floor(at - f.start + 0.5)
        if sec < TAXI.SEC_MIN or sec > TAXI.SEC_MAX then return end
        local landing, arrived = { from = f.from, to = f.to, sec = sec, at = at, t = time() }, taxi.Arrived(f)
        if arrived then taxi.Record(landing)
        elseif arrived == nil then taxi.landed = landing end
    end
    check()
end

function taxi.Reset()                           -- tracking switched off: a flight under way is forgotten
    taxi.window, taxi.pick, taxi.flight, taxi.landed, taxi.token = nil, nil, nil, nil, taxi.token + 1
end

---------------------------------------------------------------------------
-- npcs: a summary of the creatures this player looks at, one entry per NPC id, updated in place (see the header)
---------------------------------------------------------------------------
-- DAYS: an entry not seen for this long is dropped on load; SESSION: the session tables below are trimmed past this many npcs
local NPC = { AGAIN = 30, CELL_AGAIN = 600, CELLS = 40, MAX = 3000, BYTES = 500000, SPEEDS = 4, DAYS = 180, SESSION = 4000,
              INSTS = 8, LEVELS = 6, POWER_TYPES = 30 }
local NPC_CLASS = { normal = true, elite = true, rare = true, rareelite = true, worldboss = true, trivial = true, minus = true }
local NPC_RX = { Alliance = "rxA", Horde = "rxH" }      -- the reaction is kept per player faction
local CT_BEAST, CT_COMPANION = 1, 12            -- UnitCreatureType ids: Beast; Non-combat Pet (someone's companion)
-- svc: the services an NPC was seen to offer (a set, svc = { vendor = true, ... }); INTERACTION: Enum.PlayerInteractionType
-- names (PLAYER_INTERACTION_MANAGER_FRAME_SHOW) -> svc, under every name a client may use (a name it lacks is skipped)
NPC.SVC = { vendor = true, repair = true, flight = true, trainer = true, bank = true, guildbank = true, inn = true, auction = true,
            stable = true, battlemaster = true, spirit = true, guild = true, tabard = true }
NPC.INTERACTION = { Merchant = "vendor", TaxiNode = "flight", Trainer = "trainer", Banker = "bank", GuildBanker = "guildbank",
                    Registrar = "guild", PetitionVendor = "guild", GuildTabardVendor = "tabard", TabardVendor = "tabard",
                    Binder = "inn", Auctioneer = "auction", StableMaster = "stable", Stablemaster = "stable",
                    BattleMaster = "battlemaster", Battlemaster = "battlemaster", SpiritHealer = "spirit", AreaSpiritHealer = "spirit" }
-- This session only, never saved: when each npc was last updated (GetTime) and whether the player was near it then,
-- when each npc and cell was last counted, which npcs' tooltips were read, and each entry's approximate JSON size.
-- tracked: how many npcs at holds (at, near, cells and asked only ever hold npcs that at holds).
local npcSeen = { at = {}, near = {}, cells = {}, asked = {}, size = nil, bytes = 0, count = 0, guid = nil, npc = false,
                  tracked = 0 }

local function Forget(id)                       -- an npc out of the session tables (pruned, or not seen for 10 minutes)
    if npcSeen.at[id] then npcSeen.tracked = npcSeen.tracked - 1 end
    npcSeen.at[id], npcSeen.near[id], npcSeen.cells[id], npcSeen.asked[id] = nil, nil, nil, nil
end

-- Past SESSION npcs: forget those not updated for 10 minutes (their throttle and cell waits are over; at most a tooltip is
-- read again); if that is not enough, forget them all
local function TrimSeen(now)
    local old = {}
    for id, t in pairs(npcSeen.at) do if now - t >= NPC.CELL_AGAIN then old[#old + 1] = id end end
    for _, id in ipairs(old) do Forget(id) end
    if npcSeen.tracked >= NPC.SESSION then
        npcSeen.at, npcSeen.near, npcSeen.cells, npcSeen.asked, npcSeen.tracked = {}, {}, {}, {}, 0
    end
end

local function NpcIndex(d)                      -- the sizes and count of the saved summary, once a session; junk goes
    if npcSeen.size then return end
    npcSeen.size, npcSeen.bytes, npcSeen.count = {}, 0, 0
    for id, n in pairs(d.npcs) do
        if type(n) ~= "table" or not Int(id, 1) then d.npcs[id] = nil
        else
            local s = Size(n) + 8
            npcSeen.size[id], npcSeen.bytes, npcSeen.count = s, npcSeen.bytes + s, npcSeen.count + 1
        end
    end
end

local function Cells(n)                         -- all the counts in an entry's cells (how often it was stood beside)
    local w = 0
    if type(n.cells) == "table" then for _, c in pairs(n.cells) do w = w + (Int(c) or 0) end end
    return w
end

local function DropNpc(d, id)
    npcSeen.bytes, npcSeen.count = npcSeen.bytes - (npcSeen.size[id] or 0), npcSeen.count - 1
    d.npcs[id], npcSeen.size[id] = nil, nil
    Forget(id)
end

-- On load (headroom nil): entries not seen for 180 days (or with no day) go. Over 3000 npcs or ~500 KB: the least
-- recently seen go first (then the least stood beside), down to 90% of the cap when adding (headroom)
local function PruneNpcs(d, headroom)
    NpcIndex(d)
    if not headroom then
        local oldest, old = math.floor(time() / 86400) - NPC.DAYS, {}
        for id, n in pairs(d.npcs) do if (Int(n.day) or 0) < oldest then old[#old + 1] = id end end
        for _, id in ipairs(old) do DropNpc(d, id) end
    end
    local max, bytes = NPC.MAX, NPC.BYTES
    if headroom then max, bytes = math.floor(max * 0.9), math.floor(bytes * 0.9) end
    if npcSeen.count <= max and npcSeen.bytes <= bytes then return end
    local list = {}
    for id, n in pairs(d.npcs) do list[#list + 1] = { id = id, day = Int(n.day) or 0, w = Cells(n) } end
    table.sort(list, function(a, b)
        if a.day ~= b.day then return a.day < b.day end
        if a.w ~= b.w then return a.w < b.w end
        return a.id < b.id
    end)
    local i = 0
    while i < #list and (npcSeen.count > max or npcSeen.bytes > bytes) do
        i = i + 1
        DropNpc(d, list[i].id)
    end
end

-- true only when the client answered "no" (false or nil) in a value it lets us see; a missing API or a secret is no answer
local function False(fn, ...)
    if type(fn) ~= "function" then return false end
    local ok, v = pcall(fn, ...)
    return ok and not Secret(v) and not v
end

local function Near(unit)                       -- within about 10 yards; restricted in combat on modern clients: not near
    local v = Try(CheckInteractDistance, unit, 3)
    return not Secret(v) and (v == true or v == 1)
end

-- Adds the services in svc (a list of NPC.SVC names) to entry n; true when one was new
local function Serve(n, svc)
    local new = false
    for _, k in ipairs(type(svc) == "table" and svc or {}) do
        if NPC.SVC[k] then
            if type(n.svc) ~= "table" then n.svc = {} end
            if n.svc[k] ~= true then n.svc[k], new = true, true end
        end
    end
    return new
end

local function NpcSized(npc, n)                 -- an entry changed: its approximate saved size again
    local s = Size(n) + 8
    npcSeen.bytes = npcSeen.bytes - (npcSeen.size[npc] or 0) + s
    npcSeen.size[npc] = s
end

local function AtMaxLevel()
    local max, me = Int(Try(GetMaxPlayerLevel), 1), Int(Try(UnitLevel, "player"), 1)
    return max ~= nil and me ~= nil and me >= max
end

-- The subtitle under an NPC's name ("Journeyman Tailor") from its tooltip, only when the lines prove it is one: line 1
-- is the unit's own name, line 3 is the level line and line 2 is not. Never a title that names an owner ("X's Pet",
-- "X's Companion"), anything with the player's own name, "'s", markup or more than 80 bytes. nil when unsure.
local LEVEL_FORMATS = { "TOOLTIP_UNIT_LEVEL", "TOOLTIP_UNIT_LEVEL_TYPE", "TOOLTIP_UNIT_LEVEL_CLASS", "TOOLTIP_UNIT_LEVEL_RACE_CLASS",
                        "TOOLTIP_UNIT_LEVEL_CLASS_TYPE", "TOOLTIP_UNIT_LEVEL_RACE_CLASS_TYPE", "UNIT_LEVEL_TEMPLATE",
                        "UNIT_TYPE_LEVEL_TEMPLATE", "UNIT_TYPE_PLUS_LEVEL_TEMPLATE", "UNIT_PLUS_LEVEL_TEMPLATE",
                        "UNIT_TYPE_LETHAL_LEVEL_TEMPLATE", "UNIT_LETHAL_LEVEL_TEMPLATE" }
local OWNED_FORMATS = { "UNITNAME_TITLE_PET", "UNITNAME_TITLE_COMPANION", "UNITNAME_TITLE_MINION", "UNITNAME_TITLE_GUARDIAN",
                        "UNITNAME_TITLE_CREATION", "UNITNAME_TITLE_CHARM", "UNITNAME_TITLE_SQUIRE", "UNITNAME_TITLE_OPPONENT" }
for i = 1, 20 do OWNED_FORMATS[#OWNED_FORMATS + 1] = "UNITNAME_SUMMON_TITLE" .. i end
local tipPatterns                               -- { level = { ... }, owned = { ... } }, from the client's own strings

local function TipPatterns()
    if tipPatterns then return tipPatterns end
    tipPatterns = { level = {}, owned = {} }
    for kind, names in pairs({ level = LEVEL_FORMATS, owned = OWNED_FORMATS }) do
        for _, name in ipairs(names) do
            local f = Plain(_G[name])
            if type(f) == "string" and f ~= "" then tipPatterns[kind][#tipPatterns[kind] + 1] = FormatPattern(f) end
        end
    end
    local word = Plain(_G.LEVEL)
    tipPatterns.word = (type(word) == "string" and word ~= "" and word or "Level") .. " "
    return tipPatterns
end

local function Matches(text, list)
    for _, p in ipairs(list) do if text:find(p) then return true end end
    return false
end

local function LevelLine(text)
    local p = TipPatterns()
    return Matches(text, p.level) or text:sub(1, #p.word) == p.word
end

local function TipLine(lines, i)                -- the line's text, or nil; and true when the client kept it secret
    local line = lines[i]
    if Secret(line) then return nil, true end
    local text = type(line) == "table" and line.leftText or nil
    if Secret(text) then return nil, true end
    return type(text) == "string" and text or nil, false
end

-- -> the subtitle or nil, and true when a secret value stood in the way (so it is worth asking again later)
-- An NPC's own text (its name, its subtitle), or nil: never over 80 bytes, "'s ", an owner title, a GUID shape, the
-- recording character's given name or markup
local function NpcText(text)
    if type(text) ~= "string" or #text > 80 or text:find("'s ", 1, true) or Matches(text, TipPatterns().owned) then return nil end
    if text:find("%a+%-%d+%-%d+") then return nil end               -- shaped like a GUID
    local given = Me()
    if given and text:find(given, 1, true) then return nil end
    return Label(text, 80)
end

local function Subtitle(unit)
    local TI = C_TooltipInfo
    if not (TI and type(TI.GetUnit) == "function") then return nil end
    local data = Try(TI.GetUnit, unit)
    local lines = type(data) == "table" and not Secret(data) and data.lines or nil
    if Secret(data) or Secret(lines) then return nil, true end
    if type(lines) ~= "table" then return nil end
    local name = Try(UnitName, unit)
    if Secret(name) then return nil, true end
    local first, s1 = TipLine(lines, 1)
    local second, s2 = TipLine(lines, 2)
    local third, s3 = TipLine(lines, 3)
    if s1 or s2 or s3 then return nil, true end
    if not (type(name) == "string" and first == name and second and third) then return nil end
    if LevelLine(second) or not LevelLine(third) then return nil end
    return NpcText(second:match("^<(.+)>$") or second)
end

-- The attack speed seen most often (on a tie, the one that got there first), from at most 4 counted values (spds)
local function Speed(n, v)
    local c = n.spds
    if type(c) ~= "table" then c = {}; n.spds = c end
    if not c[v] then
        local k, low = 0, nil
        for x, m in pairs(c) do
            k = k + 1
            if x ~= n.spd and (not low or (Int(m) or 0) < (Int(c[low]) or 0)) then low = x end
        end
        if k >= NPC.SPEEDS and low then c[low] = nil end
    end
    c[v] = (Int(c[v]) or 0) + 1
    if not n.spd or c[v] > (Int(c[n.spd]) or 0) then n.spd = v end
end

-- Health and power (1.23.0): n.hp = { { lv, diff, v, c = { [v] = times } } } and n.pw = { { lv, diff, t, v, c = { ["t:v"] =
-- times } } }, one entry per level (and instance difficulty, diff, only when read inside an instance), the most recently
-- read last, at most 6 (the one read longest ago goes). v (and t) is the reading seen most often (a tie keeps the one
-- that got there first) of at most 4 counted values (c, this file's own tally like spds; not exported).
function NPC.Tally(c, key, cur)                 -- one more count of key in c; -> the key seen most often
    if not c[key] then
        local k, low = 0, nil
        for x, m in pairs(c) do
            k = k + 1
            if x ~= cur and (not low or (Int(m) or 0) < (Int(c[low]) or 0)) then low = x end
        end
        if k >= NPC.SPEEDS and low then c[low] = nil end
    end
    c[key] = (Int(c[key]) or 0) + 1
    if cur == nil or c[key] > (Int(c[cur]) or 0) then return key end
    return cur
end

function NPC.Reading(n, field, lv, diff)        -- the entry for lv (and diff), moved to the end as the latest read
    local list = n[field]
    if type(list) ~= "table" then list = {}; n[field] = list end
    for i = #list, 1, -1 do if type(list[i]) ~= "table" then table.remove(list, i) end end   -- junk in a saved file
    for i = #list, 1, -1 do
        local x = list[i]
        if x.lv == lv and x.diff == diff then
            table.remove(list, i)
            list[#list + 1] = x
            if type(x.c) ~= "table" then x.c = {} end
            return x
        end
    end
    while #list >= NPC.LEVELS do table.remove(list, 1) end
    local x = { lv = lv, diff = diff, c = {} }
    list[#list + 1] = x
    return x
end

-- UnitHealthMax, UnitPowerType and UnitPowerMax of a creature alive, at a plain level of 1 or more; each value plain and
-- above 0 (a creature without power has none to read)
function NPC.Vitals(n, unit, level, w, inside)
    if not (level and level >= 1 and level <= 255 and level == math.floor(level) and False(UnitIsDead, unit)) then return end
    local diff = inside and (Int(w.difficulty) or 0) or nil
    local hp = Int(Try(UnitHealthMax, unit), 1)
    if hp then
        local x = NPC.Reading(n, "hp", level, diff)
        x.v = NPC.Tally(x.c, hp, Int(x.v, 1))
    end
    local t = Int((Try(UnitPowerType, unit)))   -- (type, token): the type only
    local pw = t and t <= NPC.POWER_TYPES and Int(Try(UnitPowerMax, unit, t), 1)
    if pw then
        local x = NPC.Reading(n, "pw", level, diff)
        local ct, cv = Int(x.t), Int(x.v, 1)
        local key = NPC.Tally(x.c, t .. ":" .. pw, ct and cv and (ct .. ":" .. cv) or nil)
        local kt, kv = key:match("^(%d+):(%d+)$")
        x.t, x.v = tonumber(kt), tonumber(kv)
    end
end

-- One more count for the 1% map square the player stands in, at most once per npc and square per 10 minutes; at most 40
-- squares per npc (the least counted goes)
local function Cell(n, npc, w, now)
    local cx = math.min(99, math.floor(math.floor(w.x * 10000 + 0.5) / 100))   -- x has 4 places: 0.29 is square 29, not 28
    local cy = math.min(99, math.floor(math.floor(w.y * 10000 + 0.5) / 100))
    local key = string.format("%d:%d:%d", w.uiMap, cx, cy)
    local mine = npcSeen.cells[npc]
    if not mine then mine = {}; npcSeen.cells[npc] = mine end
    if mine[key] and now - mine[key] < NPC.CELL_AGAIN then return end
    mine[key] = now
    local cells = n.cells
    if type(cells) ~= "table" then cells = {}; n.cells = cells end
    if not cells[key] then
        local k, low, lowN = 0, nil, nil
        for x, m in pairs(cells) do
            k, m = k + 1, Int(m) or 0
            if not lowN or m < lowN or (m == lowN and tostring(x) > tostring(low)) then low, lowN = x, m end
        end
        if k >= NPC.CELLS then cells[low] = nil end
    end
    cells[key] = (Int(cells[key]) or 0) + 1
end

-- Inside a dungeon, raid or battleground there are no coordinates (1.21.0): the creature is counted under the instance
-- instead, n.inst["<instance map>:<difficulty>"] = times seen, at most once per npc and instance per 10 minutes and at
-- most 8 instances per npc (the least counted goes). The position check never runs there, so seeing it is enough.
function NPC.Inside(n, npc, w, now)
    local key = string.format("%d:%d", w.map, w.difficulty or 0)
    local mine = npcSeen.cells[npc]
    if not mine then mine = {}; npcSeen.cells[npc] = mine end
    if mine[key] and now - mine[key] < NPC.CELL_AGAIN then return end
    mine[key] = now
    local inst = n.inst
    if type(inst) ~= "table" then inst = {}; n.inst = inst end
    if not inst[key] then
        local k, low, lowN = 0, nil, nil
        for x, m in pairs(inst) do
            k, m = k + 1, Int(m) or 0
            if not lowN or m < lowN or (m == lowN and tostring(x) > tostring(low)) then low, lowN = x, m end
        end
        if k >= NPC.INSTS then inst[low] = nil end
    end
    inst[key] = (Int(inst[key]) or 0) + 1
end

-- unit: "target", "mouseover", "npc", "questnpc" or a loot corpse's unit; open: an interaction window is open with it;
-- svc: the services that window shows it offers (a list), added to its entry even within the 30 s (always a near sighting)
Sighting = function(unit, open, svc)
    -- Cheap exits first, before any table of ours is made or saved data is touched: a player after one API call, not a
    -- creature after one GUID parse (cached per GUID), this npc within 30 s before any further API call. While tracking is
    -- off the two events are not registered at all, and the on/agreed gate below comes before anything is written.
    local p = Try(UnitIsPlayer, unit)
    if Secret(p) or p then return end
    local guid = Plain(Try(UnitGUID, unit))
    if type(guid) ~= "string" then return end
    local npc = npcSeen.npc
    if guid ~= npcSeen.guid then                -- the last GUID (in memory only) and its npc id, so a mouseover parses once
        local what, id = FromGuid(guid)
        npc = what == "npc" and id or false
        npcSeen.guid, npcSeen.npc = guid, npc
    end
    if not npc then return end
    local now, at, near = Now(), npcSeen.at[npc], open and true or nil
    if at and now - at < NPC.AGAIN then
        if npcSeen.near[npc] then
            if not svc or not False(UnitPlayerControlled, unit) then return end
            local d = DB()                      -- a service seen within the 30 s: only the flags, on an entry that exists
            local n = d and d.on and d.agreed and type(d.npcs) == "table" and d.npcs[npc]
            if type(n) == "table" and Serve(n, svc) then
                NpcIndex(d); NpcSized(npc, n)
                if npcSeen.count > NPC.MAX or npcSeen.bytes > NPC.BYTES then PruneNpcs(d, true) end
            end
            return
        end
        near = near or Near(unit)               -- only a first time near it gets through again
        if not near then return end
    end
    if not False(UnitPlayerControlled, unit) then return end   -- pets, guardians, totems, a charmed mob, or no answer
    local d = DB()
    if not (d and d.on and d.agreed) then return end
    if not at then
        if npcSeen.tracked >= NPC.SESSION then TrimSeen(now) end
        npcSeen.tracked = npcSeen.tracked + 1
    end
    npcSeen.at[npc], npcSeen.near[npc] = now, near or false     -- also a try that stores nothing waits its 30 s
    local w = Where()
    local inside = w.itype ~= nil and w.map ~= nil and w.map >= 1   -- in an instance: its map and difficulty stand for the place
    if not (inside or (w.uiMap and w.x and w.y)) then return end   -- no position and no instance
    local ctName, ctId = Try(UnitCreatureType, unit)
    ctId, ctName = Int(ctId, 1), Label(ctName, 40)
    if ctId == CT_COMPANION then return end
    if near == nil then near = Near(unit) end
    npcSeen.near[npc] = near
    NpcIndex(d)
    Prefix(d)                                   -- the install id the export names this summary by
    local n = d.npcs[npc]
    if not n then n = {}; d.npcs[npc] = n; npcSeen.count = npcSeen.count + 1 end
    local cls = Plain(Try(UnitClassification, unit))
    cls = type(cls) == "string" and NPC_CLASS[cls] and cls or nil
    if cls then n.cls = cls end
    local level = Num(Try(UnitLevel, unit))
    if level and level >= 1 and level <= 255 and level == math.floor(level) then
        local lv = n.lv
        if type(lv) ~= "table" or type(lv[1]) ~= "number" or type(lv[2]) ~= "number" then n.lv = { level, level }
        else
            if level < lv[1] then lv[1] = level end
            if level > lv[2] then lv[2] = level end
        end
    elseif level == -1 and (cls == "worldboss" or AtMaxLevel()) then
        n.boss = true                           -- a skull seen by a lower character only says "10+ levels above": not kept
    end
    if ctId then n.ct = ctId elseif ctName and type(n.ct) ~= "number" then n.ct = ctName end
    local famName, famId = Try(UnitCreatureFamily, unit)
    famId, famName = Int(famId, 1), Label(famName, 40)
    if famId then n.fam = famId elseif famName and type(n.fam) ~= "number" then n.fam = famName end
    -- its name as last seen, under the subtitle's rules; never the client's placeholder for a unit not loaded yet
    local name = Plain(Try(UnitName, unit))
    local unknown = Plain(UNKNOWNOBJECT)
    if type(name) == "string" and name ~= (type(unknown) == "string" and unknown or "Unknown") then
        name = NpcText(name)
        if name then n.name = name end
    end
    -- alive and out of combat (a plain no to both): a neutral mob reads hostile once fought, and so does its corpse
    local calm = False(UnitIsDead, unit) and False(UnitAffectingCombat, unit)
    if calm then
        local faction = Plain(Try(UnitFactionGroup, "player"))
        local side, rx = type(faction) == "string" and NPC_RX[faction], Int(Try(UnitReaction, unit, "player"), 1)
        if side and rx and rx <= 8 then n[side] = rx end
    end
    -- the tooltip once a session per npc until it gives a subtitle; not while the player fights, and again later when a
    -- secret value was in the way
    if n.sub == nil and not npcSeen.asked[npc] and False(UnitAffectingCombat, "player") then
        local sub, secret = Subtitle(unit)
        if not secret then npcSeen.asked[npc] = true end
        n.sub = sub
    end
    if calm and (ctId == CT_BEAST or (not ctId and ctName == "Beast")) then
        local mh = Num((Try(UnitAttackSpeed, unit)))
        local v = mh and math.floor(mh * 100 + 0.5)
        if v and v >= 10 and v <= 2000 then Speed(n, v) end
    end
    NPC.Vitals(n, unit, level, w, inside)
    if svc then Serve(n, svc) end
    n.day = math.floor(time() / 86400)
    if inside then NPC.Inside(n, npc, w, now) elseif near then Cell(n, npc, w, now) end
    NpcSized(npc, n)
    if npcSeen.count > NPC.MAX or npcSeen.bytes > NPC.BYTES then PruneNpcs(d, true) end
end

---------------------------------------------------------------------------
-- NPC lines: the chat payload's creature GUID, never the speaker name, determines the NPC ID
---------------------------------------------------------------------------
local line = { kinds = { CHAT_MSG_MONSTER_SAY = "say", CHAT_MSG_MONSTER_YELL = "yell",
                         CHAT_MSG_MONSTER_WHISPER = "whisper", CHAT_MSG_MONSTER_EMOTE = "emote",
                         CHAT_MSG_RAID_BOSS_EMOTE = "boss" },
               raw = {}, count = 0, dropped = { ring = { next = 1, keys = {} }, seen = {} } }

function gameText.AddName(names, value)
    local name = gameText.PlainText(value)
    if not name or #name < 2 or #name > 96 or name ~= Label(name, 96) then return false end
    names[#names + 1] = name
    return true
end

-- Include the name with its realm/surname before the bare given name, so no tail is left after replacement.
function gameText.AddUnit(names, unit)
    local given, realm = Try(UnitName, unit)
    if Secret(realm) or not gameText.AddName(names, given) then return false end
    if realm ~= nil and realm ~= "" then
        if type(realm) ~= "string" or not gameText.AddName(names, given .. "-" .. realm:gsub("%s+", "")) then return false end
    end
    if type(GetUnitName) == "function" then
        local full = Plain(Try(GetUnitName, unit, true))
        if not gameText.AddName(names, full) then return false end
        local suffix = full:sub(1, #given + 1) == given .. " " and full:sub(#given + 2)
        if suffix and not suffix:find("^%-") and not gameText.AddName(names, suffix) then return false end
    end
    return true
end

function gameText.AddRoster(names)
    local ok, target = pcall(UnitGUID, "target")
    if not ok or Secret(target) or (target ~= nil and type(target) ~= "string") then return false end
    if target then
        local player = Plain(Try(UnitIsPlayer, "target"))
        if player ~= true and player ~= false then return false end
        if (player or target:find("^Player%-")) and not gameText.AddUnit(names, "target") then return false end
    end
    local raid, grouped = Plain(Try(IsInRaid)), Plain(Try(IsInGroup))
    if type(raid) ~= "boolean" or type(grouped) ~= "boolean" or (raid and not grouped) then return false end
    if grouped then
        local count = Int(Try(GetNumGroupMembers), 1)
        if not count or count > (raid and 40 or 5) then return false end
        for i = 1, (raid and count or count - 1) do
            if not gameText.AddUnit(names, (raid and "raid" or "party") .. i) then return false end
        end
    end
    return true
end

local NAME_WORD = "()(%a[%a']*)"
local I_WORD = { I = true, ["I'd"] = true, ["I'll"] = true, ["I'm"] = true, ["I've"] = true }

function gameText.SentenceStart(text, at)
    local before = text:sub(1, at - 1)
    return before:match("^[%s\"'(%[]*$") or before:match("[.!?\n][%s\"'()%[%]]*$")
end

function gameText.HasMidSentenceCapital(text)
    text = text:gsub("%$N%f[%A]", "@")
    for at, word in text:gmatch(NAME_WORD) do
        if word:find("%u") and not gameText.SentenceStart(text, at) then return true end
    end
    return false
end

function gameText.ContextWords(speaker)
    local zone = Label(Try(GetRealZoneText), 200) or Label(Try(GetZoneText), 200)
    local subzone = Label(Try(GetSubZoneText), 200)
    local name = Label(Try(UnitName, speaker), 200)
    local words = {}
    for _, label in ipairs({ zone or "", subzone or "", name or "" }) do
        for _, word in gameText.Punctuation(label):gmatch(NAME_WORD) do
            words[word:lower():gsub("'+$", "")] = true
        end
    end
    return words
end

-- No opener exceptions in substitution-heavy speech: a name can be an ordinary English verb.
-- Say, yell and object gossip can use game labels and common words, with corroboration on publish.
function gameText.HasUnknownName(text, speaker, strict)
    if text:find("[\128-\255]") then return true end
    local context
    text = text:gsub("%$N%f[%A]", "@")
    for at, token in text:gmatch(NAME_WORD) do
        local word = token:gsub("'+$", "")
        if word:find("%u") and not I_WORD[word] then
            if strict then return true end
            local initial = gameText.SentenceStart(text, at)
            local common = gameText.openers[word]
                or (ns.CommonWords and word:match("^%u[%l']*$") and ns.CommonWords[word:lower()])
            local nextWord = initial and text:match("^[%s,;:'\"()%-]+(%a[%a']*)", at + #word)
            if not (common and (not initial or (nextWord and not nextWord:find("%u")))) then
                context = context or gameText.ContextWords(speaker)
                if not context[word:lower()] then return true end
            end
        end
    end
    return false
end

function line.Names(recipient, roster)
    local names = {}
    if recipient and recipient ~= "" then
        local base = recipient:match("^([^%-]+)%-")
        if not gameText.AddName(names, recipient) or (base and not gameText.AddName(names, base)) then return nil end
    end
    if not gameText.AddUnit(names, "player") or (roster and not gameText.AddRoster(names)) then return nil end
    table.sort(names, function(a, b) return #a > #b end)
    return names
end

function line.Text(kind, text, recipient, guid)
    -- A creature GUID can be a charmed creature or a summoned guardian. Require a current
    -- uncontrolled unit. Sender and recipient names are never saved as metadata.
    local speaker = Plain(Try(UnitTokenFromGUID, guid))
    if type(speaker) ~= "string" or Plain(Try(UnitGUID, speaker)) ~= guid
        or Plain(Try(UnitIsPlayer, speaker)) ~= false or Plain(Try(UnitPlayerControlled, speaker)) ~= false then return end
    local _, rawType = Try(UnitCreatureType, speaker)
    local ct = Int(rawType, 1)
    if not ct or ct == CT_COMPANION then return end
    text = gameText.PlainText(text)
    if not text then return end
    local names = line.Names(recipient, gameText.HasMidSentenceCapital(gameText.Punctuation(text)))
    text = names and gameText.Prose(text, 8000, names, true)
    if not text then return end
    text = gameText.PlainText(gameText.Punctuation(text))
    if not text or gameText.HasUnknownName(text, speaker, kind ~= "say" and kind ~= "yell") then return end
    return Cut(text, TEXT_MAX.line)
end

function line.Record(kind, text, recipient, guid)
    if not gameText.Room() then return end
    guid, text = Plain(guid), Plain(text)
    if type(guid) ~= "string" or #guid > 128 or guid:sub(1, 9) ~= "Creature-" or type(text) ~= "string" or #text > 8000
        or Secret(recipient) or (recipient ~= nil and (type(recipient) ~= "string" or #recipient > 96)) then return end
    local _, id = FromGuid(guid)
    local npc = gameText.Id(id)
    if not npc then return end

    local checksum = gameText.Checksum(text)
    local rejected = kind .. ":" .. guid .. ":" .. checksum .. ":" .. (recipient and gameText.Checksum(recipient) or "")
    if line.dropped.seen[rejected] then return end
    local raw = npc .. ":" .. checksum
    local index = gameText.Index("line")
    local normalized = line.raw[raw]
    if index.seen[raw] or (normalized and index.seen[normalized]) then return end

    text = line.Text(kind, text, recipient, guid)
    if not text then gameText.Remember(line.dropped, rejected); return end
    local key = npc .. ":" .. gameText.Checksum(text)
    if gameText.Record("line", key, { npc = npc, kind = kind, text = text }) and raw ~= key then
        if line.count >= gameText.CAP then line.raw, line.count = {}, 0 end
        if not line.raw[raw] then line.count = line.count + 1 end
        line.raw[raw] = key
    end
end

---------------------------------------------------------------------------
-- quest extras (1.18.0)
---------------------------------------------------------------------------
function qx.Later(fn)                           -- fn a second from now; nothing without a timer
    if C_Timer and C_Timer.After then C_Timer.After(qx.WAIT, function() pcall(fn) end) end
end

function qx.Amend(e, fields)                    -- add fields to an event already saved, and count its size again
    local d = DB()
    if not (d and d.on and d.agreed) then return end
    local list = d.events
    for i = #list, 1, -1 do
        if list[i] == e then
            local was = Size(e)
            for k, v in pairs(fields) do e[k] = v end
            bytes = bytes + Size(e) - was
            if bytes > MAX_BYTES then Prune(d, true) end
            return true
        end
    end
end

-- On accept, from the quest log: lv (the quest's level, 1-255), group (its suggested group size, only 2-40), freq
-- ("daily" | "weekly", Enum.QuestFrequency by name) and timed (true when it has a time limit). Written into out. True when
-- the log held this quest (its own questID, not a header) or there is no log to ask; false when it is not there yet.
function qx.Facts(quest, out)
    local L = C_QuestLog
    if not (L and type(L.GetLogIndexForQuestID) == "function" and type(L.GetInfo) == "function") then return true end
    local i = Int((Try(L.GetLogIndexForQuestID, quest)), 1)
    local info = i and Plain(Try(L.GetInfo, i))
    if type(info) ~= "table" or Int(info.questID, 1) ~= quest then return false end
    local header = info.isHeader
    if Secret(header) or header == true then return false end
    local lv, group, freq, F = Int(info.level, 1), Int(info.suggestedGroup, 2), Int(info.frequency), Enum and Enum.QuestFrequency
    if lv and lv <= 255 then out.lv = lv end
    if group and group <= 40 then out.group = group end
    if freq and type(F) == "table" then
        if freq == Int(F.Daily) then out.freq = "daily" elseif freq == Int(F.Weekly) then out.freq = "weekly" end
    end
    if Int((Try(L.GetTimeAllowed, quest)), 1) then out.timed = true end
    return true
end

-- Objectives supply their own required amount and wording. The UI can put progress at the front
-- or the end, so remove both forms. A counter still inside the wording makes the row unsuitable.
-- Also returns how many rows the client listed (unusable ones included), 1-40, else nil.
function qx.Objectives(get, quest)
    local names = gameText.OwnNames()
    if not names then return nil end
    local list = Plain(Try(get, quest))
    if type(list) ~= "table" then return nil end
    local rows = {}
    for _, v in ipairs(list) do
        local r = Plain(v)
        if type(r) == "table" then
            local kind, n = Plain(r.type), Int(r.numRequired)
            local text = gameText.PlainText(r.text)
            if type(kind) == "string" and #kind <= 40 and kind:match("^[a-z][a-z0-9_%-]*$")
                and n and n <= 2147483647 and text then
                local fraction, percent = "%d+%s*/%s*%d+", "%d+[.,]?%d*%s*%%"
                text = text:gsub("^%s*" .. fraction .. "%s*[:%-]?%s*", "")
                           :gsub("%s*[:%-]?%s*" .. fraction .. "%s*$", "")
                           :gsub("^%s*" .. percent .. "%s*[:%-]?%s*", "")
                           :gsub("%s*[:%-]?%s*" .. percent .. "%s*$", "")
                if not text:find(fraction) and not text:find(percent) then
                    text = gameText.Prose(text, 400, names)
                    if text and not text:find(fraction) and not text:find(percent) then
                        rows[#rows + 1] = { t = kind, n = n, text = text }
                    end
                end
            end
        end
        if #rows >= qx.OBJECTIVES then break end
    end
    if #rows == 0 then return nil end
    return rows, #list <= credit.ROWS and #list or nil
end

function qx.Poi(L, map, quest)
    if Plain(Try(InCombatLockdown)) ~= false or not C_Map
        or gameText.Id(Try(C_Map.GetBestMapForUnit, "player")) ~= map then return nil end
    if type(L.ReadyForTurnIn) == "function" and not False(L.ReadyForTurnIn, quest) then return nil end
    local rows, seen = {}, {}
    local function add(x, y)
        x, y = Num(x), Num(y)
        if not (x and y and x >= 0 and y >= 0 and x <= 1 and y <= 1 and (x > 0 or y > 0)) then return end
        local cx, cy = math.floor(x * 10000 + 0.5), math.floor(y * 10000 + 0.5)
        local key = cx * 10001 + cy
        if seen[key] or key == 0 then return end
        seen[key] = true
        rows[#rows + 1] = { map = map, x = cx / 100, y = cy / 100 }
    end
    local list = Plain(Try(L.GetQuestsOnMap, map))
    if type(list) == "table" then
        for _, v in ipairs(list) do
            local r = Plain(v)
            if type(r) == "table" and gameText.Id(r.questID) == quest then
                local otherMap, start = r.mapID, r.isQuestStart
                if not Secret(otherMap) and (otherMap == nil or gameText.Id(otherMap) == map)
                    and not Secret(start) and (start == nil or start == false) then
                    add(r.x, r.y)
                end
            end
            if #rows >= qx.POIS then break end
        end
    end
    return #rows > 0 and rows or nil
end

-- Fill each missing field from the first usable read. A late read still belongs to this accept,
-- and carries only facts for the same quest; a late POI also needs the same player UI map.
function qx.AcceptData(e)
    local L, map = C_QuestLog, gameText.Id(e.where.uiMap)
    if type(L) ~= "table" then return false end
    local wantPoi = map and not e.poi and type(L.GetQuestsOnMap) == "function"
    local wantObj = not e.obj and type(L.GetQuestObjectives) == "function" and gameText.Room()
    if not wantObj and not wantPoi then return false end
    local fields = {}
    if wantPoi then fields.poi = qx.Poi(L, map, e.quest) end
    if wantObj then
        fields.obj, fields.rows = qx.Objectives(L.GetQuestObjectives, e.quest)
        if fields.obj and not gameText.Room(Size(fields) - 2) then fields.obj, fields.rows = nil, nil end
    end
    if next(fields) and not qx.Amend(e, fields) then return false end
    return (wantObj and not e.obj) or (wantPoi and not e.poi)
end

function qx.Retry(quest)
    local e = qx.waiting[quest]
    if e and (time() - e.t > qx.DATA_WAIT or not qx.AcceptData(e)) then qx.waiting[quest] = nil end
end

function qx.RetryPending()
    for quest in pairs(qx.waiting) do qx.Retry(quest) end
end

-- The XP the reward window shows (GetRewardXP), only while this character can gain XP: its level and the cap known and
-- under it, and XP not turned off (IsXPUserDisabled, when the client has it, plainly false). nil when 0 or unsure.
function qx.Xp()
    local max, me = Int(Try(GetMaxPlayerLevel), 1), Int(Try(UnitLevel, "player"), 1)
    if not (max and me and me < max) then return nil end
    if type(IsXPUserDisabled) == "function" and not False(IsXPUserDisabled) then return nil end
    return Int((Try(GetRewardXP)), 1)
end

-- The quest's reward as the open quest window lists it (1.23.0): read once when the offer window (QUEST_DETAIL) or the
-- reward window (QUEST_COMPLETE) opens, for the quest that window shows (quest: its GetQuestID, nil when unknown).
-- Returns the rewards table and the choice slots by index ({ id, n, link }, false for a slot without an item id) for
-- the GetQuestReward hook. Each key only when the client answers it plainly and above 0, else left out:
--   items   GetNumQuestRewards / GetQuestItemLink+Info "reward" (always there, may be empty)
--   choose  the same for "choice", at most 10
--   money   GetRewardMoney: the quest's listed copper. Never the player's money: GetMoney is not called, and neither is
--           QUEST_TURNED_IN's money argument read
--   xp      qx.Xp (under the level cap, XP not turned off)
--   spells  C_QuestInfoSystem.GetQuestRewardSpells(quest): ids, each once, ascending, at most 8
--   title   GetRewardTitle, a label of at most 80 bytes
--   cap     true when this character is at the level cap (its level and the cap both known)
--   skill   { line = GetRewardSkillLineID, pts = GetRewardSkillPoints }, only with both; pts at most 1000. The first
--           return of each; when GetRewardSkillPoints answers a name first, its third return (the points, as the
--           default UI reads it as skillName, skillIcon, skillPoints)
--   cur     C_QuestInfoSystem.GetQuestRewardCurrencies(quest): { id = currencyID, n = totalRewardAmount }, by id, each
--           id once (the first row), at most 8
qx.CHOOSE, qx.SPELLS, qx.CURRENCIES, qx.SKILL_PTS, qx.ID_MAX = 10, 8, 8, 1000, 2147483647
function qx.Id(v) v = Int(v, 1); if v and v <= qx.ID_MAX then return v end end
function qx.Rewards(quest)
    local r = { items = RewardItems("reward", (Try(GetNumQuestRewards))) }
    local slots, choose = {}, {}
    for i = 1, Int((Try(GetNumQuestChoices))) or 0 do
        local link = Plain(Try(GetQuestItemLink, "choice", i))
        local id = ItemId(link)
        local it = false
        if id then
            local _, _, n = Try(GetQuestItemInfo, "choice", i)
            it = { id = id, n = Int(n, 1) or 1, link = ShortLink(link) }
            if #choose < qx.CHOOSE then choose[#choose + 1] = it end
        end
        slots[i] = it
    end
    if choose[1] then r.choose = choose end
    r.money = qx.Id((Try(GetRewardMoney)))
    r.xp = qx.Xp()
    local Q = type(C_QuestInfoSystem) == "table" and C_QuestInfoSystem or nil
    local spells = quest and Q and Plain(Try(Q.GetQuestRewardSpells, quest))
    if type(spells) == "table" then
        local seen, list = {}, {}
        pcall(function()
            for _, v in ipairs(spells) do
                local id = qx.Id(v)
                if id and not seen[id] then seen[id] = true; list[#list + 1] = id end
            end
        end)
        table.sort(list)
        for i = #list, qx.SPELLS + 1, -1 do list[i] = nil end
        if list[1] then r.spells = list end
    end
    r.title = Label((Try(GetRewardTitle)), 80)
    if AtMaxLevel() then r.cap = true end
    local line = qx.Id((Try(GetRewardSkillLineID)))
    local a, _, c = Try(GetRewardSkillPoints)
    local pts = Int(a, 1)
    if pts == nil and type(Plain(a)) == "string" then pts = Int(c, 1) end
    if line and pts and pts <= qx.SKILL_PTS then r.skill = { line = line, pts = pts } end
    local rows = quest and Q and Plain(Try(Q.GetQuestRewardCurrencies, quest))
    if type(rows) == "table" then
        local seen, list = {}, {}
        pcall(function()
            for _, row in ipairs(rows) do
                row = Plain(row)
                if type(row) == "table" then
                    local id, n = qx.Id(row.currencyID), qx.Id(row.totalRewardAmount)
                    if id and n and not seen[id] then seen[id] = true; list[#list + 1] = { id = id, n = n } end
                end
            end
        end)
        table.sort(list, function(x, y) return x.id < y.id end)
        for i = #list, qx.CURRENCIES + 1, -1 do list[i] = nil end
        if list[1] then r.cur = list end
    end
    return r, slots
end

-- Whether a rewards table lists anything (cap alone is a fact about the character, not a reward).
function qx.Listed(r)
    return type(r) == "table" and (r.items and r.items[1] or r.choose or r.money or r.xp or r.spells or r.title or r.skill
        or r.cur) and true or false
end

-- The open offer or reward window (qx.window: the detail or turnin table) read again after QUEST_ITEM_UPDATE, see there.
qx.REREAD = 4
function qx.Count(r) return type(r) == "table" and #(r.items or {}) + #(r.choose or {}) or 0 end
function qx.Reread()
    local w = qx.window
    if not w or (w ~= detail and w ~= turnin) then qx.window = nil; return end
    local quest = Int(Try(GetQuestID), 1)
    if not (quest and quest == w.quest) or (w.rereads or 0) >= qx.REREAD then return end
    w.rereads = (w.rereads or 0) + 1
    local ok, r, slots = pcall(qx.Rewards, quest)
    if not (ok and type(r) == "table" and type(slots) == "table") or qx.Count(r) < qx.Count(w.rewards) then return end
    if w == detail then
        if qx.Listed(r) then w.rewards = r end
    else
        w.items, w.choices, w.rewards, w.xp = r.items, slots, r, r.xp
    end
end

-- Standings by faction id: of the factions in ids (GetFactionDataByID), or of the whole list. For the whole list each
-- collapsed header is opened on its own from the top down (so one nested in another shows up next and is opened too),
-- the list is read, and those headers are closed again from the bottom up, also when the read fails part-way. Left
-- out: headers without a standing of their own, the Guild faction (not the quest's), and, where the client says so,
-- renown factions (their standing restarts each level). nil when unreadable or a header would not open. With names, also
-- fills names[faction name] = factionID for those same factions (false for a name two of them share; killrep).
function qx.Standings(ids, names)
    local R = C_Reputation
    if type(R) ~= "table" then return nil end
    local out = {}
    local function put(f)
        if type(f) ~= "table" then return end
        local id, s = Int(f.factionID, 1), Int(f.currentStanding, -2147483647)
        if not (id and s) or id == qx.GUILD or (Plain(f.isHeader) ~= false and Plain(f.isHeaderWithRep) ~= true) then return end
        if type(R.IsMajorFaction) == "function" and not False(R.IsMajorFaction, id) then return end
        out[id] = s
        local name = names and Plain(f.name)
        if type(name) == "string" and name ~= "" then names[name] = (names[name] == nil or names[name] == id) and id or false end
    end
    if ids then
        if type(R.GetFactionDataByID) ~= "function" then return nil end
        for id in pairs(ids) do put(Try(R.GetFactionDataByID, id)) end
        return out
    end
    if type(R.GetNumFactions) ~= "function" or type(R.GetFactionDataByIndex) ~= "function" then return nil end
    local closed, opened = {}, false
    local function count() return math.min(Int((Try(R.GetNumFactions))) or 0, qx.FACTIONS) end
    local ok, read = pcall(function()
        local i, n = 1, count()
        while i <= n do
            local f = Try(R.GetFactionDataByIndex, i)
            local id = type(f) == "table" and Plain(f.isHeader) == true and Plain(f.isCollapsed) == true and Int(f.factionID, 1)
            if id and not closed[id] then
                closed[id], opened = true, true
                if type(R.ExpandFactionHeader) ~= "function" then return false end
                Try(R.ExpandFactionHeader, i)
                f = Try(R.GetFactionDataByIndex, i)
                if not (type(f) == "table" and Plain(f.isCollapsed) == false) then return false end   -- its factions stay hidden
                n = count()
            end
            i = i + 1
        end
        for j = 1, n do put(Try(R.GetFactionDataByIndex, j)) end
        return true
    end)
    local function close(i)
        local f = Try(R.GetFactionDataByIndex, i)
        local id = type(f) == "table" and Int(f.factionID, 1)
        if id and closed[id] and Plain(f.isCollapsed) == false then Try(R.CollapseFactionHeader, i) end
    end
    if opened then                              -- put the list back the way it was, from the bottom up, row by row
        for i = count(), 1, -1 do pcall(close, i) end
    end
    return ok and read and out or nil
end

-- The reputation a turn-in changed: every standing read when the reward window opens (QUEST_COMPLETE, out of combat),
-- the same factions again a second after that quest's turn-in; rep = { { f = factionID, d = change } } of those that
-- changed, sorted by f. Never the standing itself. d is what this character received: with its reputation bonuses and
-- any spill-over to other factions, so the same quest may differ between characters. Nothing when something else could
-- have moved them in between (loot, combat, another reward window or turn-in, more than 5 minutes between the window
-- and the turn-in), when more than 6 changed, or when a change is over 100000.
function qx.Spoil() if qx.rep then qx.rep.spoiled = true end end

function qx.Watch(quest)                        -- QUEST_COMPLETE
    local w = qx.rep
    if w and w.turned then w.spoiled = true; return end   -- a turn-in still settling: neither is sure
    qx.rep = nil
    if not (quest and C_Timer and C_Timer.After and False(InCombatLockdown)) then return end
    local before = qx.Standings()
    if before and next(before) then qx.rep = { quest = quest, before = before, at = Now() } end
end

function qx.TurnedIn(quest, e)
    local w = qx.rep
    if w and w.turned then w.spoiled = true; return end   -- two turn-ins within the second
    if not (w and w.quest == quest and not w.spoiled and Now() - w.at <= qx.STALE and C_Timer and C_Timer.After) then
        qx.rep = nil
        return
    end
    w.turned, w.e = true, e
    qx.Later(function()
        if qx.rep ~= w then return end
        qx.rep = nil
        if w.spoiled or not False(InCombatLockdown) then return end
        local after = qx.Standings(w.before)
        if not after then return end
        local rep = {}
        for f, s in pairs(w.before) do
            local d = after[f] and after[f] - s
            if d and d ~= 0 then
                if math.abs(d) > qx.REP_D then return end
                rep[#rep + 1] = { f = f, d = d }
            end
        end
        if #rep == 0 or #rep > qx.REP_MAX then return end
        table.sort(rep, function(a, b) return a.f < b.f end)
        qx.Amend(e, { rep = rep })
    end)
end

---------------------------------------------------------------------------
-- hunter tames (1.20.0): the beast a hunter tamed (its creature id from the target's GUID when the tame began) and what
-- the pet it became showed: its spellbook's abilities, its attack speed and its diet. Passive reads only: the hunter's
-- own Tame Beast cast is watched, never made; the pet's GUID is compared in memory and never kept.
---------------------------------------------------------------------------
-- arm: the tame being waited for, in memory only (with the target's name, compared with the pet's and never kept);
-- sent: the cast target's name UNIT_SPELLCAST_SENT gave for the last Tame Beast, also in memory only.
local pet = { TAME = 1515, CALL = 883, REVIVE = 982, WINDOW = 30, READ = 60, EVERY = 2, STOP = 2, SPELLS = 24, DIET = 8,
              SESSION = 20, arm = nil, read = nil, sent = nil, n = 0, token = 0 }

function pet.Is(spellId, id)                    -- this spell id, or a spell of the same name in the client's language
    spellId = gameText.Id(spellId)
    if not spellId then return false end
    if spellId == id then return true end
    local name, want = SpellName(spellId), SpellName(id)
    return type(name) == "string" and name ~= "" and name == want
end

function pet.Hunter()
    local _, file, id = Try(UnitClass, "player")
    return Plain(file) == "HUNTER" or Int(id) == 3
end

function pet.Guid()                             -- the pet's GUID now, to tell this pet from another; never stored
    local guid = Plain(Try(UnitGUID, "pet"))
    return type(guid) == "string" and guid ~= "" and guid or nil
end

function pet.Family(unit)                       -- UnitCreatureFamily: the client's id when it gives one, and the name
    local name, id = Try(UnitCreatureFamily, unit)
    return Int(id, 1), Label(name, 40)
end

function pet.Name(unit)                         -- a unit's name, compared in memory only; never kept
    local name = Plain((Try(UnitName, unit)))
    return type(name) == "string" and name ~= "" and name or nil
end

-- UNIT_SPELLCAST_SENT(unit, target, castGUID, spellID): the name of the unit the cast went to, when the client gives one.
function pet.Sent(unit, target, _, spellId)
    if unit ~= "player" or not pet.Is(spellId, pet.TAME) then return end
    target = Plain(target)
    pet.sent = { name = type(target) == "string" and target ~= "" and target or nil, at = Now() }
end

-- UNIT_SPELLCAST_START / _CHANNEL_START by the player. Tame Beast by a hunter with no pet arms a tame of the creature in
-- its target; Call Pet or Revive Pet disarms it (a pet that appears then is not a new one). The id is read from the
-- target, so a cast that went elsewhere (a mouseover or focus macro: UNIT_SPELLCAST_SENT named another unit) arms nothing.
function pet.Start(spellId)
    if pet.Is(spellId, pet.CALL) or pet.Is(spellId, pet.REVIVE) then pet.arm = nil; return end
    if not (pet.Is(spellId, pet.TAME) and pet.Hunter()) then return end
    pet.arm = nil
    local sent = pet.sent
    pet.sent = nil
    if pet.Guid() then return end               -- a hunter with a pet out cannot tame: nothing to wait for
    local what, npc = FromGuid(Plain(Try(UnitGUID, "target")))
    npc = what == "npc" and gameText.Id(npc)
    if not npc or not (False(UnitIsPlayer, "target") and False(UnitPlayerControlled, "target")) then return end
    local name = pet.Name("target")
    if not name or (sent and Now() - sent.at <= pet.STOP and sent.name and sent.name ~= name) then return end
    local raw = Int(Try(UnitLevel, "target"), 1)
    local famId, famName = pet.Family("target")
    pet.arm = { npc = npc, lv = raw and raw <= 255 and raw or nil, raw = raw, name = name, famId = famId, famName = famName,
                where = Where(), at = Now() }
end

function pet.Stop(spellId)                      -- UNIT_SPELLCAST_INTERRUPTED: that tame is over
    if pet.arm and pet.Is(spellId, pet.TAME) then pet.arm = nil end
end

-- UNIT_SPELLCAST_CHANNEL_STOP: the channel ended, tamed or broken; a pet that has not come STOP seconds later is not this
-- tame's (pet.Changed refuses it).
function pet.Ended(spellId)
    if pet.arm and pet.Is(spellId, pet.TAME) then pet.arm.stopped = pet.arm.stopped or Now() end
end

-- UNIT_PET("player") within 30 s of an armed tame (and within 2 s of its channel's end): a pet where there was none, with
-- the beast's name (a fresh tame keeps it), and its level, family and creature id wherever both sides are readable.
function pet.Changed(unit)
    local a = pet.arm
    if Plain(unit) ~= "player" or not a then return end
    if Now() - a.at > pet.WINDOW or (a.stopped and Now() - a.stopped > pet.STOP) then pet.arm = nil; return end
    local guid = pet.Guid()
    if not guid then return end
    pet.arm = nil
    if pet.Name("pet") ~= a.name then return end
    local lv = Int(Try(UnitLevel, "pet"), 1)
    if a.raw and lv and lv ~= a.raw then return end
    if type(UnitCreatureID) == "function" then
        local id = Plain((Try(UnitCreatureID, "pet")))
        if id ~= nil and gameText.Id(type(id) == "string" and tonumber(id) or id) ~= a.npc then return end
    end
    local famId, famName = pet.Family("pet")
    if (a.famId and famId and a.famId ~= famId) or (a.famName and famName and a.famName ~= famName) then return end
    pet.token = pet.token + 1
    pet.read = { arm = a, guid = guid, at = Now(), token = pet.token }
    pet.Read(true)
end

local function ActionSpell(v)                   -- a pet book action id: its low 24 bits are the spell id
    v = Int(v, 1)
    return v and math.floor(v % 16777216) or nil
end

-- The pet's spellbook: { { s, name, rank? } } sorted by s, or nil while it lists nothing. Each id must name the spell the
-- book shows (SpellName(s) == name), which leaves out the pet bar's commands without any list of ids.
function pet.Spells()
    local out, seen = {}, {}
    local function add(id, name, rank)
        id, name = gameText.Id(Plain(id)), Label(name, 120)
        if not (id and name) or seen[id] or SpellName(id) ~= name then return end
        seen[id] = true
        out[#out + 1] = { s = id, name = name, rank = Label(rank, 40) }
    end
    local B, E = C_SpellBook, type(Enum) == "table" and Enum or {}
    local bank = type(E.SpellBookSpellBank) == "table" and E.SpellBookSpellBank.Pet
    local T = type(E.SpellBookItemType) == "table" and E.SpellBookItemType or {}
    if type(B) == "table" and type(B.HasPetSpells) == "function" and type(B.GetSpellBookItemInfo) == "function" and bank ~= nil then
        for i = 1, math.min(Int((Try(B.HasPetSpells))) or 0, 100) do
            local info = Plain(Try(B.GetSpellBookItemInfo, i, bank))
            local kind = type(info) == "table" and Plain(info.itemType)
            if kind ~= false and (kind == nil or (kind ~= T.FutureSpell and kind ~= T.Flyout)) then
                add(Plain(info.spellID) or ActionSpell(info.actionID), info.name, info.subName)
            end
        end
    elseif type(HasPetSpells) == "function" and type(GetSpellBookItemName) == "function" then
        for i = 1, math.min(Int((Try(HasPetSpells))) or 0, 100) do
            local name, rank, id = Try(GetSpellBookItemName, i, "pet")
            if not gameText.Id(Plain(id)) then id = ActionSpell(select(2, Try(GetSpellBookItemInfo, i, "pet"))) end
            add(id, name, rank)
        end
    end
    table.sort(out, function(a, b) return a.s < b.s end)
    while #out > pet.SPELLS do out[#out] = nil end
    return #out > 0 and out or nil
end

-- The pet's diet as the client names it (C_PetInfo.GetPetFoodTypes, else GetPetFoodTypes): sorted labels, at most 8.
-- false without either API, nil while it names none.
function pet.Diet()
    local P, list = C_PetInfo, nil
    if type(P) == "table" and type(P.GetPetFoodTypes) == "function" then list = { Try(P.GetPetFoodTypes) }
    elseif type(GetPetFoodTypes) == "function" then list = { Try(GetPetFoodTypes) }
    else return false end
    if type(Plain(list[1])) == "table" then list = list[1] end
    local out, seen = {}, {}
    for _, v in ipairs(list) do
        local s = Label(v, 40)
        if s and not seen[s] and not s:find("%a+%-%d+%-%d+") then seen[s] = true; out[#out + 1] = s end
    end
    table.sort(out)
    while #out > pet.DIET do out[#out] = nil end
    return #out > 0 and out or nil
end

-- The pet's main-hand attack speed in hundredths of a second, only with the pet alive and neither it nor the player in
-- combat; and true when the pet had no aura at all (so nothing could have hastened or slowed it). nil when unreadable.
function pet.Speed()
    if not (False(UnitIsDead, "pet") and False(UnitAffectingCombat, "pet") and False(UnitAffectingCombat, "player")) then return nil end
    local mh = Num((Try(UnitAttackSpeed, "pet")))
    local v = mh and math.floor(mh * 100 + 0.5)
    if not (v and v >= 10 and v <= 2000) then return nil end
    local A, fn = C_UnitAuras, UnitAura
    if type(A) == "table" and type(A.GetAuraDataByIndex) == "function" then fn = A.GetAuraDataByIndex end
    return v, type(fn) == "function" and False(fn, "pet", 1, "HELPFUL") and False(fn, "pet", 1, "HARMFUL")
end

function pet.Sig(spells)                        -- "s/rank,..." of a book read, to compare two reads and to key the event
    local sig = {}
    for _, x in ipairs(spells or {}) do sig[#sig + 1] = x.s .. (x.rank and ("/" .. x.rank) or "") end
    return table.concat(sig, ",")
end

-- Reads the new pet until its book (the same in two reads in a row, so a book still filling is not taken), an aura-free
-- speed and its diet are in, or 60 s have passed; again every 2 s (again = true) and on PET_BAR_UPDATE / SPELLS_CHANGED.
-- Another pet, or none, ends it without a record.
function pet.Read(again)
    local r = pet.read
    if not r then return end
    if pet.Guid() ~= r.guid then pet.read = nil; return end
    if not r.spells then
        local book = pet.Spells()
        local sig = book and pet.Sig(book)
        if sig and sig == r.book then r.spells = book end
        r.book = sig
    end
    if r.diet == nil then r.diet = pet.Diet() end
    if not r.bare then
        local v, bare = pet.Speed()
        if v then r.spd, r.bare = v, bare end
    end
    local timer = C_Timer and type(C_Timer.After) == "function"
    if (r.spells and r.bare and r.diet ~= nil) or Now() - r.at >= pet.READ or not timer then return pet.Record(r) end
    if again then
        C_Timer.After(pet.EVERY, function() if pet.read == r and r.token == pet.token then pcall(pet.Read, true) end end)
    end
end

function pet.Locale()                           -- the client's locale ("enUS"): the language of fam's name and diet
    local loc = Plain((Try(GetLocale)))
    return type(loc) == "string" and loc:match("^%l%l%u%u$") and loc or nil
end

-- type "tame": npc, lv, fam, spells, spd (+ spdAura when the pet had an aura at every read), diet, loc; where = the tame's
-- start. Once per beast, level, abilities and speed per install (key npc:lv:checksum, so 24 spells cost no more than one);
-- at most 20 a session, and nothing past the half caps.
function pet.Record(r)
    pet.read = nil
    local a = r.arm
    if pet.n >= pet.SESSION then return end
    local rest = table.concat({ pet.Sig(r.spells), r.spd or "", r.spd and not r.bare and "a" or "" }, ":")
    local key = a.npc .. ":" .. (a.lv or "") .. ":" .. gameText.Checksum(rest)
    local fields = { npc = a.npc, lv = a.lv, fam = a.famId or a.famName, spells = r.spells, spd = r.spd,
                     spdAura = r.spd and not r.bare or nil, diet = r.diet or nil, loc = pet.Locale(), where = a.where }
    if gameText.Index("tame").seen[key] then return end
    if gameText.Record("tame", key, fields) then pet.n = pet.n + 1 end
end

---------------------------------------------------------------------------
-- objective credit (1.20.0): which creature, item or object counted for a quest objective. When an objective's
-- numFulfilled goes up (read in memory to see the rise; never saved or exported) and this player's own evidence of the
-- last 6 seconds names exactly one cause, (quest, objective index, type) -> that id is recorded once per install. The
-- evidence: creatures that died that no one else had tapped (UNIT_HEALTH with UnitIsDead), items this player's own loot
-- lines named (CHAT_MSG_LOOT "You receive loot / item"), objects whose window (gossip, greeting, quest, page) this player
-- opened. Nothing about another player, no counts, no position but the event's usual where.
---------------------------------------------------------------------------
credit.LOOT = { { "LOOT_ITEM_SELF_MULTIPLE", "You receive loot: %sx%d." }, { "LOOT_ITEM_PUSHED_SELF_MULTIPLE", "You receive item: %sx%d." },
                { "LOOT_ITEM_SELF", "You receive loot: %s." }, { "LOOT_ITEM_PUSHED_SELF", "You receive item: %s." } }

function credit.Saw(kind, id, name)             -- kind is the objective type the evidence can count for
    id = gameText.Id(id)
    if not (credit.want[kind] and id) then return end
    name = gameText.PlainText(name)
    if #credit.saw >= credit.SAW then table.remove(credit.saw, 1) end
    if pet.Guid() then credit.petAt = Now() end
    credit.saw[#credit.saw + 1] = { kind = kind, id = id, at = Now(),
                                    name = type(name) == "string" and #name >= 3 and #name <= 120 and name:lower() or nil }
end

-- UNIT_HEALTH(unit): a creature this unit token shows dead, once per corpse. Not a player's, not one someone controls, and
-- not one another player had tapped (UnitIsTapDenied plainly false); a missing API or a secret is no answer: no evidence.
-- Called only when UnitIsDead(unit) was plainly true (handlers.UNIT_HEALTH reads it once for this and kr.Died).
function credit.Died(unit)
    if not credit.want.monster then return end
    local guid = Plain(Try(UnitGUID, unit))
    local what, id = FromGuid(guid)
    if what ~= "npc" or credit.dead[guid] then return end
    if not (False(UnitIsPlayer, unit) and False(UnitPlayerControlled, unit) and False(UnitIsTapDenied, unit)) then return end
    if credit.ndead >= credit.DEAD then credit.dead, credit.ndead = {}, 0 end
    credit.dead[guid], credit.ndead = true, credit.ndead + 1   -- the corpse's GUID in memory only, to count it once
    credit.Saw("monster", id, Plain(Try(UnitName, unit)))
end

function credit.Loot(text)                      -- CHAT_MSG_LOOT: only this player's own "You receive" lines
    if not credit.want.item or type(text) ~= "string" then return end
    if not credit.patterns then
        credit.patterns = {}
        for _, f in ipairs(credit.LOOT) do
            local fmt = _G[f[1]]
            credit.patterns[#credit.patterns + 1] = FormatPattern(type(fmt) == "string" and fmt ~= "" and fmt or f[2])
        end
    end
    for _, p in ipairs(credit.patterns) do      -- the link is one of the (at most two) captures; no table per line
        local a, b = text:match(p)
        local c = type(a) == "string" and ItemId(a) and a or type(b) == "string" and ItemId(b) and b
        if c then return credit.Saw("item", ItemId(c), c:match("|h%[([^%]|]+)%]|h")) end
    end
end

function credit.Talked()                        -- an object's gossip, greeting, quest or text window: this player opened it
    if not credit.want.object then return end
    local what, id = FromGuid(Plain(Try(UnitGUID, "npc")))
    if what == "object" then credit.Saw("object", id, Plain(Try(UnitName, "npc"))) end
end

function credit.Quests()                        -- the quest ids in the log, headers left out, at most 100
    local L, out = C_QuestLog, {}
    local function add(quest, header)
        quest = gameText.Id(quest)
        if quest and not Secret(header) and header ~= true and #out < 100 then out[#out + 1] = quest end
    end
    if type(L) == "table" and type(L.GetNumQuestLogEntries) == "function" and type(L.GetInfo) == "function" then
        for i = 1, math.min(Int((Try(L.GetNumQuestLogEntries))) or 0, 200) do
            local info = Plain(Try(L.GetInfo, i))
            if type(info) == "table" then add(info.questID, info.isHeader) end
        end
    elseif type(GetNumQuestLogEntries) == "function" and type(GetQuestLogTitle) == "function" then
        for i = 1, math.min(Int((Try(GetNumQuestLogEntries))) or 0, 200) do
            local _, _, _, header, _, _, _, quest = Try(GetQuestLogTitle, i)
            add(Plain(quest), header)
        end
    end
    return out
end

-- The name as whole words in the objective's text, both lower case. A byte of 128 or more (part of a UTF-8 letter) counts
-- as a word character, so "Kobold" is not found inside "Koboldé" and a name ending in "é" still needs a word end.
function credit.Named(text, name)
    local pat = name:gsub("(%W)", "%%%1")
    if name:find("^[%w\128-\255]") then pat = "%f[%w\128-\255]" .. pat end
    if name:find("[%w\128-\255]$") then pat = pat .. "%f[^%w\128-\255]" end
    return text:find(pat) ~= nil
end

-- One objective rose from was to f (of need), of rows objectives listed. Its cause: the one candidate named in the
-- objective's text (by "name"; an item's bag count must also agree when the client gives it); else, for a creature only,
-- the only candidate there is (by "sole"), but never while grouped or while a pet was out (a member's or the pet's kill out
-- of sight counts too). Items and objects are told by name alone: a quest item can come by trade, mail or a bag with no
-- loot line, and an object without a window leaves no evidence. Candidates: this type's evidence of the window, by id,
-- not yet claimed by an earlier scan.
function credit.Credit(quest, i, kind, text, f, need, rows, solo)
    if credit.n >= credit.SESSION then return end
    local cands, byId = {}, {}
    for _, x in ipairs(credit.saw) do
        if x.kind == kind and (not x.used or x.used == credit.scans) then
            local c = byId[x.id]
            if not c then c = { id = x.id }; byId[x.id] = c; cands[#cands + 1] = c end
            c.name = c.name or x.name
        end
    end
    if #cands == 0 then return end
    if kind == "item" then
        local get = C_Item and C_Item.GetItemCount or GetItemCount
        if type(get) == "function" then
            local keep = {}
            for _, c in ipairs(cands) do
                local n = Int((Try(get, c.id)))
                if n and (n == f or (f == need and n >= need)) then keep[#keep + 1] = c end
            end
            cands = keep
        end
    end
    text = gameText.PlainText(text)
    text = text and text:lower()
    local named, pick, by = 0, nil, nil
    for _, c in ipairs(cands) do
        if text and c.name and credit.Named(text, c.name) then named, pick = named + 1, c end
    end
    if named == 1 then by = "name"
    elseif named == 0 and #cands == 1 and kind == "monster" and solo then
        pick, by = cands[1], "sole"
    end
    if not by then return end
    for _, x in ipairs(credit.saw) do if x.kind == kind and x.id == pick.id then x.used = credit.scans end end
    local key = table.concat({ quest, i, kind, pick.id }, ":")
    if gameText.Index("credit").seen[key] then return end
    if gameText.Record("credit", key, { quest = quest, i = i, rows = rows, ot = kind, [credit.TYPES[kind]] = pick.id, by = by }) then
        credit.n = credit.n + 1
    end
end

-- Every quest's monster, item and object objectives (the first 12), compared with the last scan. A quest new to the log,
-- or not in the last scan, only sets its baseline; so does the first scan. Only the rise is used, never the numbers.
function credit.Scan()
    local L = C_QuestLog
    if type(L) ~= "table" or type(L.GetQuestObjectives) ~= "function" then return end
    local now, old, base, want, fresh = Now(), credit.base, {}, {}, {}
    credit.scans = credit.scans + 1
    for _, x in ipairs(credit.saw) do if now - x.at <= credit.WINDOW then fresh[#fresh + 1] = x end end
    credit.saw = fresh
    if pet.Guid() then credit.petAt = now end
    local solo = False(IsInGroup) and now - credit.petAt > credit.WINDOW
    for _, quest in ipairs(credit.Quests()) do
        local list = Plain(Try(L.GetQuestObjectives, quest))
        if type(list) == "table" then
            local counts, was, rows = {}, old and old[quest], #list   -- rows: how many objectives the client listed
            for i = 1, math.min(rows, qx.OBJECTIVES) do
                local r = Plain(list[i])
                local kind = type(r) == "table" and Plain(r.type)
                local f, need = kind and Int(r.numFulfilled), kind and Int(r.numRequired, 1)
                if credit.TYPES[kind] and f and need and f <= need then
                    -- a fall (a brief 0 while the client loads, an item gone) keeps no baseline: the next read sets one
                    if not (was and was[i] and f < was[i]) then counts[i] = f end
                    if f < need then want[kind] = true end
                    if was and was[i] and f > was[i] and rows <= credit.ROWS then
                        credit.Credit(quest, i, kind, r.text, f, need, rows, solo)
                    end
                end
            end
            base[quest] = counts
        end
    end
    credit.base, credit.want = base, want
end

function credit.Soon()                          -- the quest log changed: one scan a second later for a burst of updates
    if not (C_Timer and C_Timer.After) then return credit.Scan() end
    if credit.pending then return end
    credit.pending = true
    local token = credit.token
    C_Timer.After(1, function()
        if token ~= credit.token then return end
        credit.pending = false
        pcall(credit.Scan)
    end)
end

function credit.Reset()                         -- tracking switched off: the baseline and the evidence are forgotten
    credit.base, credit.want, credit.saw, credit.dead, credit.ndead = nil, {}, {}, {}, 0
    credit.pending, credit.token = false, credit.token + 1
end

---------------------------------------------------------------------------
-- killrep (1.23.0): the reputation a kill gave, tied to the one creature it can only have come from
---------------------------------------------------------------------------
-- The faction message ("Reputation with %s increased by %d.", in the client's own words; the bonus and generic forms do
-- not match) is held for a second, because the creature's death can show after the message. It is kept only when every
-- creature this player saw die untapped by others (kr.Died, the same evidence as credit.Died) from 2 s before the message
-- to 1 s after it has the same npc id; lv only when all of them showed the same level. Nothing within 5 s of a quest
-- turn-in or while a reward window is open (its reputation is the quest's). The faction name becomes its id through a
-- name-to-id table read from the reputation list (qx.Standings) out of combat and reused; it is read again, out of combat
-- and at most once a minute, after a name it did not know. A name it still does not know, or that two factions share,
-- records nothing. Never a standing, never a GUID (the corpses' GUIDs are in memory only, to count each once).
local kr = { BEFORE = 2, AFTER = 1, QUEST = 5, SESSION = 100, DEAD = 500, KEEP = 40, D = 100000, REBUILD = 60,
             deaths = {}, dead = {}, ndead = 0, n = 0, names = nil, stale = true, builtAt = nil, patterns = nil, token = 0 }
kr.FORMATS = { { "FACTION_STANDING_INCREASED", "Reputation with %s increased by %d.", 1 },
               { "FACTION_STANDING_DECREASED", "Reputation with %s decreased by %d.", -1 } }

function kr.Died(unit)                          -- as credit.Died, whether or not a quest wants the creature
    local guid = Plain(Try(UnitGUID, unit))
    local what, id = FromGuid(guid)
    if what ~= "npc" or kr.dead[guid] then return end
    if not (False(UnitIsPlayer, unit) and False(UnitPlayerControlled, unit) and False(UnitIsTapDenied, unit)) then return end
    if kr.ndead >= kr.DEAD then kr.dead, kr.ndead = {}, 0 end
    kr.dead[guid], kr.ndead = true, kr.ndead + 1
    local now, lv = Now(), Int(Try(UnitLevel, unit), 1)
    while kr.deaths[1] and (#kr.deaths >= kr.KEEP or kr.deaths[1].at < now - 10) do table.remove(kr.deaths, 1) end
    kr.deaths[#kr.deaths + 1] = { npc = id, lv = lv and lv <= 255 and lv or nil, at = now }
end

function kr.Build()                             -- the name-to-id table, out of combat, at most once a minute
    local now = Now()
    if not False(InCombatLockdown) or (kr.builtAt and now - kr.builtAt < kr.REBUILD) then return end
    kr.builtAt = now
    local names = {}
    if qx.Standings(nil, names) then kr.names, kr.stale = names, false end
end

function kr.Faction(name)
    local f = kr.names and kr.names[name]
    if f == nil then
        kr.stale = true
        kr.Build()
        f = kr.names and kr.names[name]
    end
    return f or nil                             -- false: two factions share the name
end

function kr.Patterns()
    if kr.patterns then return kr.patterns end
    kr.patterns = {}
    for _, f in ipairs(kr.FORMATS) do
        local fmt = _G[f[1]]
        if type(fmt) ~= "string" or not fmt:find("%%%d*%$?s") or not fmt:find("%%%d*%$?d") then fmt = f[2] end
        local numFirst = fmt:find("%%%d*%$?d") < fmt:find("%%%d*%$?s")   -- a translation may name the amount first
        kr.patterns[#kr.patterns + 1] = { FormatPattern(fmt), f[3], numFirst }
    end
    return kr.patterns
end

function kr.Quest(at)                           -- a quest's reputation could be the one in the message
    if qx.window and qx.window == turnin and qx.rewardAt and Now() - qx.rewardAt < qx.STALE then return true end
    return (qx.turnedAt and math.abs(at - qx.turnedAt) <= kr.QUEST) or (qx.rewardAt and math.abs(at - qx.rewardAt) <= kr.QUEST)
        or false
end

function kr.Message(text)                       -- CHAT_MSG_COMBAT_FACTION_CHANGE
    text = Plain(text)
    if type(text) ~= "string" or kr.n >= kr.SESSION or not gameText.Room() then return end
    local name, amount, sign
    for _, p in ipairs(kr.Patterns()) do
        local a, b = text:match(p[1])
        if a and b then
            if p[3] then a, b = b, a end
            name, amount, sign = a, tonumber(b), p[2]
            break
        end
    end
    if not (name and amount) or amount < 1 or amount > kr.D then return end
    local at, f = Now(), kr.Faction(name)
    if not f or kr.Quest(at) then return end
    local token = kr.token
    local function decide() if token == kr.token then kr.Decide(at, f, sign * amount) end end
    if C_Timer and C_Timer.After then C_Timer.After(kr.AFTER, function() pcall(decide) end) else decide() end
end

function kr.Decide(at, f, d)
    if kr.n >= kr.SESSION or kr.Quest(at) then return end
    local npc, lv, first = nil, nil, true
    for _, x in ipairs(kr.deaths) do
        if x.at >= at - kr.BEFORE and x.at <= at + kr.AFTER then
            if npc and x.npc ~= npc then return end   -- two different creatures: either could have given it
            if first then lv, first = x.lv, false elseif lv ~= x.lv then lv = nil end
            npc = x.npc
        end
    end
    if not npc then return end
    local key = table.concat({ npc, lv or "", f, d }, ":")
    if gameText.Index("killrep").seen[key] then return end
    if gameText.Record("killrep", key, { npc = npc, lv = lv, f = f, d = d }) then kr.n = kr.n + 1 end
end

function kr.Reset()                             -- tracking switched off: the evidence and a message still waiting go
    kr.deaths, kr.dead, kr.ndead, kr.token = {}, {}, 0, kr.token + 1
end

---------------------------------------------------------------------------
-- events: only registered while recording is on
---------------------------------------------------------------------------
local handlers = {}

-- The documented chat payload has text at 1, the optional recipient at 5 and sender GUID at 12.
for event, kind in pairs(line.kinds) do
    local lineKind = kind
    handlers[event] = function(text, _, _, _, recipient, _, _, _, _, _, _, guid)
        line.Record(lineKind, text, recipient, guid)
    end
end

function handlers.LOOT_READY() flag.Window(true); qx.Spoil(); RecordLoot(true) end
function handlers.LOOT_OPENED() flag.Window(true); qx.Spoil(); RecordLoot(false) end
function handlers.LOOT_CLOSED() flag.Window(false); lootDone = false; de.Closed() end
function handlers.UNIT_LOOT(guid, has) flag.Changed(guid, has) end
function handlers.LOOT_ROLLS_COMPLETE(handle) flag.Done(handle) end
local function Cast(unit, _, spellId)
    if unit ~= "player" then return end
    local kind = GatherKind(spellId)
    if kind then lastCast.kind, lastCast.at = kind, Now() end
end
local function Began(unit, castGUID, spellId)
    Cast(unit, castGUID, spellId)
    if unit == "player" then pet.Start(spellId) end
end
handlers.UNIT_SPELLCAST_START = function(unit, castGUID, spellId) Began(unit, castGUID, spellId); de.Start(unit, spellId) end
handlers.UNIT_SPELLCAST_CHANNEL_START = Began   -- Tame Beast is channelled
function handlers.UNIT_SPELLCAST_SUCCEEDED(unit, castGUID, spellId) Cast(unit, castGUID, spellId); de.Done(unit, spellId) end
function handlers.UNIT_SPELLCAST_INTERRUPTED(unit, _, spellId) if unit == "player" then pet.Stop(spellId) end end
function handlers.UNIT_SPELLCAST_CHANNEL_STOP(unit, _, spellId) if unit == "player" then pet.Ended(spellId) end end
handlers.UNIT_SPELLCAST_SENT = pet.Sent
function handlers.UNIT_PET(unit)
    if unit == "player" then credit.petAt = Now() end   -- a pet came or went: no creature is told by "sole" for a while
    pet.Changed(unit)
end
function handlers.PET_BAR_UPDATE() if pet.read then pet.Read(false) end end
handlers.SPELLS_CHANGED = handlers.PET_BAR_UPDATE
local function Engaged(reset)
    for i = 1, 5 do
        local what, id = FromGuid(Plain(Try(UnitGUID, "boss" .. i)))
        if what == "npc" then bossNpcs[id] = true end
    end
    Pulled(reset)
end
function handlers.INSTANCE_ENCOUNTER_ENGAGE_UNIT() Engaged(false) end
function handlers.ENCOUNTER_START() Engaged(true) end
function handlers.ENCOUNTER_END(encounter, _, _, _, success)   -- (id, name, difficulty, group size, success)
    encounter = Int(encounter, 1)
    if Plain(success) ~= 1 and Plain(success) ~= true then return end
    flag.Ended(encounter)
    if not KilledBoss(encounter, false) then                   -- the corpse may not be "dead" yet this frame
        if C_Timer and C_Timer.After then C_Timer.After(1, function() pcall(KilledBoss, encounter, true) end)
        else KilledBoss(encounter, true) end
    end
end

-- (rollID, rollTime, lootHandle): the item is read now, while the roll is open; the burst is read when it has settled.
function handlers.START_LOOT_ROLL(rollID, _, ...)
    local link = Plain(Try(GetLootRollItemLink, rollID))
    local id = ItemId(link)
    if not id then return end
    local _, _, count = Try(GetLootRollItemInfo, rollID)
    local handle = Int(Plain((...)))            -- lootHandle: the loot history's key for this roll, and what its end names
    flag.Roll(handle)
    pendingRolls[#pendingRolls + 1] = { id = id, n = Int(count, 1) or 1, link = ShortLink(link), guid = GuidIn(...), handle = handle }
    rollToken = rollToken + 1
    local token = rollToken
    if C_Timer and C_Timer.After then
        C_Timer.After(ROLL_SETTLE, function() if token == rollToken then SafeFlushRolls() end end)
    else FlushRolls() end
end

function handlers.CHAT_MSG_LOOT(text) text = Plain(text); Won(text); credit.Loot(text) end
function handlers.UNIT_HEALTH(unit)
    local dead = type(unit) == "string" and unit ~= "player" and Plain(Try(UnitIsDead, unit)) == true   -- read once
    if dead then credit.Died(unit) end
    local died = ns.Facts and ns.Facts.Died     -- Facts.lua: kills per day, also for corpses nobody loots
    if died then pcall(died, unit) end
    if dead then kr.Died(unit) end
end
handlers.CHAT_MSG_COMBAT_FACTION_CHANGE = kr.Message
function handlers.PLAYER_ENTERING_WORLD() if kr.stale then kr.Build() end end

local function QuestGiverSeen()                 -- the quest window is open with it (questnpc, else npc)
    pcall(Sighting, "questnpc", true)
    pcall(Sighting, "npc", true)                -- the same creature: the 30 s throttle makes this a no-op
end

function handlers.MAIL_SHOW()
    gameText.mail, gameText.book, gameText.bookUse = true, nil, nil
end
function handlers.MAIL_CLOSED() gameText.mail = false end
-- credit.Talked runs in its own pcall: an error there must not cost the gossip, greeting, page or quest recording
function handlers.GOSSIP_SHOW() pcall(credit.Talked); gameText.Gossip("gossip") end
function handlers.QUEST_GREETING() pcall(credit.Talked); gameText.Gossip("greeting") end

function handlers.ITEM_TEXT_BEGIN() pcall(credit.Talked); gameText.BookBegin() end
function handlers.ITEM_TEXT_READY() gameText.BookPage() end
function handlers.ITEM_TEXT_CLOSED() gameText.book = nil end

function handlers.QUEST_DETAIL(startItem)       -- (questStartItemID): the item that started it, 0 when none
    QuestGiverSeen()
    pcall(credit.Talked)
    local what, id = Giver("questnpc", "npc")
    detail = { quest = Int(Try(GetQuestID), 1), what = what, id = id, at = time(), startItem = Int(startItem, 1),
               text = QuestText({ title = GetTitleText, details = GetQuestText, objectives = GetObjectiveText }) }
    if detail.quest then                        -- the offer's rewards, only for a window that names its quest
        local ok, r = pcall(qx.Rewards, detail.quest)
        if ok and qx.Listed(r) then detail.rewards = r end
    end
    qx.window = detail
end
function handlers.QUEST_ACCEPTED(...)
    local quest = QuestId(...)
    if not quest then return end
    local e = NewEvent("quest")
    e.act, e.quest = "accept", quest
    local p = detail
    if p and p.what and (p.quest == quest or (not p.quest and time() - p.at <= 60)) then e[p.what] = p.id end
    if p and p.quest == quest then                                           -- only a sure match
        e.startItem = p.startItem
        e.rewards = p.rewards
    end
    if qx.window == p then qx.window = nil end
    detail = nil
    local ok, found = pcall(qx.Facts, quest, e)
    if p and p.quest == quest and p.text and WantsText(e, p.text) then e.text = p.text end
    Add(e)
    if ok and not found then                    -- not in the log yet: once more a second later, added to the saved event
        qx.Later(function() local f = {}; if qx.Facts(quest, f) and next(f) then qx.Amend(e, f) end end)
    end
    qx.waiting[quest] = nil
    if qx.AcceptData(e) then
        qx.waiting[quest] = e
        qx.Later(function() if qx.waiting[quest] == e then qx.Retry(quest) end end)
    end
end
function handlers.QUEST_DATA_LOAD_RESULT(quest, success)
    quest = gameText.Id(quest)
    if quest and Plain(success) == true then qx.Retry(quest) end
end
function handlers.QUEST_LOG_UPDATE() qx.RetryPending(); credit.Soon() end
handlers.QUEST_WATCH_UPDATE = credit.Soon
function handlers.UNIT_QUEST_LOG_CHANGED(unit) if unit == "player" then credit.Soon() end end
handlers.QUEST_POI_UPDATE = qx.RetryPending
function handlers.PLAYER_REGEN_ENABLED() qx.RetryPending(); if kr.stale then kr.Build() end end
function handlers.QUEST_REMOVED(quest)
    quest = gameText.Id(quest)
    if quest then qx.waiting[quest] = nil end
end
function handlers.QUEST_PROGRESS()
    local text = QuestText({ progress = GetProgressText })
    progress = { quest = Int(Try(GetQuestID), 1), text = text and text.progress }
    qx.window = nil                             -- another window of the quest frame: nothing to read again
end
function handlers.QUEST_COMPLETE()
    QuestGiverSeen()
    local what, id = Giver("questnpc", "npc")
    local quest = Int(Try(GetQuestID), 1)
    local ok, r, slots = pcall(qx.Rewards, quest)
    if not ok or type(r) ~= "table" then r, slots = { items = {} }, {} end
    turnin = { quest = quest, what = what, id = id, items = r.items, choices = slots, rewards = r,
               text = quest and QuestText({ title = GetTitleText, completion = GetRewardText }) }
    if turnin.text and progress and progress.quest == quest then turnin.text.progress = progress.text end
    turnin.xp = quest and r.xp
    qx.window, qx.rewardAt = turnin, Now()
    HookReward()
    qx.Watch(quest)
end
-- A reward item the client had not loaded when the window opened has no link yet, so the read skipped it; the client
-- says when it has loaded it. The open window is read again, at most qx.REREAD times, and the new read is kept only
-- when it is of the same quest and lists at least as many items as the one before.
function handlers.QUEST_ITEM_UPDATE() qx.Reread() end
function handlers.QUEST_FINISHED() qx.window = nil end   -- the quest window closed
function handlers.QUEST_TURNED_IN(questId)        -- (questId, xp, money): the money argument is never read (rewards.money
                                                  -- is the reward window's listed GetRewardMoney, read at QUEST_COMPLETE)
    questId = Int(questId, 1)
    if questId then
        qx.waiting[questId] = nil
        TurnedIn(questId)
    end
end
-- what could move a reputation besides the turn-in being watched
function handlers.PLAYER_REGEN_DISABLED() qx.Spoil() end

function handlers.MERCHANT_SHOW()
    merchantOpen = true
    if C_Timer and C_Timer.After then C_Timer.After(0.5, function() pcall(RecordVendor) end) else RecordVendor() end
end
function handlers.MERCHANT_CLOSED() merchantOpen = false end

function handlers.TRAINER_SHOW()
    trainer.open, trainer.done, trainer.pending, trainer.tries, trainer.token = true, false, false, 0, trainer.token + 1
    SoonTrainer()
end
-- the list arriving after the window opened (read again while it was empty); also our own filter switches, ignored
function handlers.TRAINER_UPDATE() if not trainer.reading then SoonTrainer() end end
function handlers.TRAINER_CLOSED() trainer.open = false end

-- flight masters: the window is read when it opens; TakeTaxiNode (hooked, after the game ran it) names the destination;
-- the flight is timed from losing control on the taxi to gaining it back on the ground
function handlers.TAXIMAP_OPENED() taxi.Opened() end
function handlers.TAXIMAP_CLOSED() taxi.window = nil end
function handlers.PLAYER_CONTROL_LOST() taxi.Board() end
function handlers.PLAYER_CONTROL_GAINED() taxi.Land() end

-- the npcs summary: these fire all the time, so Sighting leaves early (players, the same npc within 30 s)
function handlers.PLAYER_TARGET_CHANGED() Sighting("target", false) end
function handlers.UPDATE_MOUSEOVER_UNIT() Sighting("mouseover", false) end

-- an interaction window opened with the "npc" unit: the service its type names (Enum.PlayerInteractionType, matched by
-- name, so a client that numbers them differently or lacks one records nothing wrong); a mailbox or other object is no
-- creature and Sighting skips it
function handlers.PLAYER_INTERACTION_MANAGER_FRAME_SHOW(kind)
    local E = Enum and Enum.PlayerInteractionType
    kind = Int(kind)
    if not (kind and type(E) == "table") then return end
    for name, svc in pairs(NPC.INTERACTION) do
        if Int(E[name]) == kind then
            Sighting("npc", true, { svc })      -- never repair here: CanMerchantRepair may still answer for the last
                                                -- merchant; RecordVendor adds it with this merchant's window open
            return
        end
    end
end
-- an innkeeper: "make this inn your home" asked (CONFIRM_BINDER) or done (HEARTHSTONE_BOUND) while talking to it
function handlers.CONFIRM_BINDER() Sighting("npc", true, { "inn" }) end
function handlers.HEARTHSTONE_BOUND() Sighting("npc", true, { "inn" }) end

-- LOOT_READY is first so the loot read registers as early as it can. Where the client calls listeners in the order
-- they registered, the read comes before another addon's slot-taking in the same event (not checked in the client).
local RECORDING = { "LOOT_READY", "LOOT_OPENED", "LOOT_CLOSED",
                    "UNIT_SPELLCAST_START", "UNIT_SPELLCAST_SUCCEEDED", "ENCOUNTER_START",
                    "INSTANCE_ENCOUNTER_ENGAGE_UNIT", "ENCOUNTER_END", "START_LOOT_ROLL", "CHAT_MSG_LOOT",
                    "UNIT_LOOT", "LOOT_ROLLS_COMPLETE",
                    "QUEST_DETAIL", "QUEST_ACCEPTED", "QUEST_PROGRESS", "QUEST_COMPLETE", "QUEST_TURNED_IN", "QUEST_REMOVED",
                    "QUEST_ITEM_UPDATE", "QUEST_FINISHED",
                    "QUEST_DATA_LOAD_RESULT", "QUEST_LOG_UPDATE", "QUEST_POI_UPDATE", "PLAYER_REGEN_ENABLED",
                    "GOSSIP_SHOW", "QUEST_GREETING", "MAIL_SHOW", "MAIL_CLOSED",
                    "ITEM_TEXT_BEGIN", "ITEM_TEXT_READY", "ITEM_TEXT_CLOSED",
                    "MERCHANT_SHOW", "MERCHANT_CLOSED", "TRAINER_SHOW", "TRAINER_UPDATE", "TRAINER_CLOSED",
                    "TAXIMAP_OPENED", "TAXIMAP_CLOSED", "PLAYER_CONTROL_LOST", "PLAYER_CONTROL_GAINED",
                    "PLAYER_TARGET_CHANGED", "UPDATE_MOUSEOVER_UNIT", "PLAYER_INTERACTION_MANAGER_FRAME_SHOW", "CONFIRM_BINDER",
                    "HEARTHSTONE_BOUND", "PLAYER_REGEN_DISABLED",
                    "UNIT_SPELLCAST_CHANNEL_START", "UNIT_SPELLCAST_INTERRUPTED", "UNIT_PET", "PET_BAR_UPDATE", "SPELLS_CHANGED",
                    "UNIT_HEALTH", "QUEST_WATCH_UPDATE", "UNIT_QUEST_LOG_CHANGED", "UNIT_SPELLCAST_SENT",
                    "UNIT_SPELLCAST_CHANNEL_STOP", "CHAT_MSG_COMBAT_FACTION_CHANGE", "PLAYER_ENTERING_WORLD" }

local ev = CreateFrame("Frame")
local hookedBags = false

local function Enable()
    flag.Reset()
    for _, e in ipairs(RECORDING) do
        local ok, err = pcall(ev.RegisterEvent, ev, e)   -- an event this client lacks is simply skipped
        if e == "QUEST_TURNED_IN" then haveTurnedInEvent = ok and err ~= false end
    end
    for e in pairs(line.kinds) do pcall(ev.RegisterEvent, ev, e) end
    if not hookedBags and type(hooksecurefunc) == "function" and C_Container and type(C_Container.UseContainerItem) == "function" then
        hookedBags = pcall(hooksecurefunc, C_Container, "UseContainerItem", function(bag, slot)
            bag, slot = Plain(bag), Int(slot, 1)
            local info = type(bag) == "number" and slot and Plain(Try(C_Container.GetContainerItemInfo, bag, slot))
            local id = type(info) == "table" and gameText.Id(info.itemID)
            if id then lastUsedItem.id, lastUsedItem.at = id, Now() end
            de.Aim(id)
            pcall(gameText.BookUse, id, info)
        end)
    end
    -- a left click on a bag item while a spell waits for its target (Disenchant): the item it was aimed at
    if not de.hooked and type(hooksecurefunc) == "function" and C_Container and type(C_Container.PickupContainerItem) == "function"
        and type(C_Container.GetContainerItemInfo) == "function" then
        de.hooked = pcall(hooksecurefunc, C_Container, "PickupContainerItem", function(bag, slot)
            bag, slot = Plain(bag), Int(slot, 1)
            local info = type(bag) == "number" and slot and Plain(Try(C_Container.GetContainerItemInfo, bag, slot))
            de.Aim(type(info) == "table" and gameText.Id(info.itemID) or nil)
        end)
    end
    if not taxi.hooked and type(hooksecurefunc) == "function" and type(TakeTaxiNode) == "function" then
        taxi.hooked = pcall(hooksecurefunc, "TakeTaxiNode", function(slot) pcall(taxi.Take, Plain(slot)) end)
    end
end
local function Disable()
    for _, e in ipairs(RECORDING) do pcall(ev.UnregisterEvent, ev, e) end
    for e in pairs(line.kinds) do pcall(ev.UnregisterEvent, ev, e) end
    line.raw, line.count = {}, 0
    line.dropped = { ring = { next = 1, keys = {} }, seen = {} }
    lootDone, detail, turnin, progress, merchantOpen = false, nil, nil, nil, false
    trainer.open, trainer.token = false, trainer.token + 1   -- a read still waiting is dropped
    pendingRolls, rollToken = {}, rollToken + 1          -- a burst still settling is dropped
    flag.Reset()
    taxi.Reset()
    gameText.mail, gameText.book, gameText.bookUse = false, nil, nil
    qx.waiting, qx.window = {}, nil
    qx.rep = nil                                         -- a turn-in's rep still settling is dropped
    pet.arm, pet.read, pet.sent, pet.token = nil, nil, nil, pet.token + 1   -- a tame still being read is dropped
    de.at, de.item, de.pending, de.aimed = -1000, nil, nil, nil
    credit.Reset()
    kr.Reset()
end

local function AddonVersion()
    local get = C_AddOns and C_AddOns.GetAddOnMetadata or GetAddOnMetadata
    local v = Plain(Try(get, ADDON, "Version"))
    return type(v) == "string" and v ~= "" and v or nil
end

function handlers.ADDON_LOADED(name)
    if name ~= ADDON then return end
    gameText.upgrade = type(KutzInventoryObsDB) == "table"
    local d = DB(true)                          -- start recording on load, without requiring a command
    if not d then return end
    d.addon = AddonVersion() or d.addon
    Prune(d)
    PruneNpcs(d)
    if d.on and d.agreed then Enable() end
end

pcall(ev.RegisterEvent, ev, "ADDON_LOADED")
ev:SetScript("OnEvent", function(_, event, ...)
    local h = handlers[event]
    if not h then return end
    if event == "UNIT_HEALTH" then              -- many a second in a group: group members and the player are never evidence
        local unit = ...
        if type(unit) ~= "string" or unit == "player" or unit == "pet" or unit:find("^party") or unit:find("^raid") then return end
    end
    local d = DB()
    if event ~= "ADDON_LOADED" and not (d and d.on and d.agreed) then return end
    local ok, err = pcall(h, ...)
    if not ok and d then d.lastError = "observations " .. event .. ": " .. tostring(err) end
end)

---------------------------------------------------------------------------
-- /kinv track
---------------------------------------------------------------------------
local function When(t) return date("%d %b %Y", t) end

local function Status()
    local d = DB(true)
    local n, first = #d.events, d.events[1]
    NpcIndex(d)
    local npcs = npcSeen.count
    Say("drop tracking is " .. (d.on and d.agreed and "|cff40ff40on|r" or "|cffaaaaaaoff|r") .. ". "
        .. n .. " event" .. (n == 1 and "" or "s") .. " kept" .. (first and type(first.t) == "number" and (" since " .. When(first.t)) or "")
        .. ", " .. npcs .. " NPC" .. (npcs == 1 and "" or "s") .. " held"
        .. ". |cffaaaaaa/kinv track drops " .. (d.on and d.agreed and "off" or "on") .. "|r to turn it " .. (d.on and d.agreed and "off" or "on") .. ".")
end

local function Start()
    local d = DB(true)
    d.agreed, d.on = true, true
    d.addon = AddonVersion() or d.addon
    Enable()
    Say("drop tracking is |cff40ff40on|r. It goes up with your next upload. |cffaaaaaa/kinv track drops off|r stops it.")
end

local function Stop()
    local d = DB(true)
    d.on = false
    Disable()
    Say("drop tracking is off (also the NPC summary). What it already recorded stays (and goes up with your next upload); delete it on cr0m.")
end

function ns.ObsCommand(msg)
    local rest = (msg or ""):match("^%s*[Tt][Rr][Aa][Cc][Kk](.*)$")
    if not rest or not (rest == "" or rest:match("^%s")) then return false end
    rest = rest:lower():gsub("%s+", " "):gsub("^ ", ""):gsub(" $", "")
    if rest == "" or rest == "status" or rest == "drops" or rest == "drops status" then Status()
    elseif rest == "drops on" then
        local d = DB(true)
        if d.on and d.agreed then Say("drop tracking is already on.")
        else Start() end
    elseif rest == "drops yes" then Start()
    elseif rest == "drops off" then Stop()
    else Say("|cffaaaaaa/kinv track drops on|r, |cffaaaaaa/kinv track drops off|r or |cffaaaaaa/kinv track|r (status).") end
    return true
end

-- Existing installs get each release's notice they have not seen yet at login (1.19.0, 1.20.0, 1.23.0). The first /kinv still
-- explains the tracking preference.
function ns.ObsNote(atLogin, hadInventory)
    local d = DB(true)
    if atLogin then
        if (hadInventory or gameText.upgrade) and not d.notedGameText then
            Say("1.19.0 adds NPC gossip and spoken lines, book pages from world objects, and quest objectives when drop tracking is on. |cffaaaaaa/kinv track drops off|r stops recording.")
        end
        if (hadInventory or gameText.upgrade) and not d.notedPets then
            Say("1.20.0 adds hunter tames (the beast, and its pet's abilities, attack speed and diet) and which creature, item or object counted for a quest objective when drop tracking is on. |cffaaaaaa/kinv track drops off|r stops recording.")
        end
        if (hadInventory or gameText.upgrade) and not d.notedRewards then
            Say("1.23.0 adds the rewards a quest window lists (its money too: the quest's, never yours), the reputation a kill gives, creatures' health and power, and what disenchanting gives when drop tracking is on. |cffaaaaaa/kinv track drops off|r stops recording.")
        end
        d.notedGameText, d.notedPets, d.notedRewards = true, true, true
        return
    end
    if d.noted then return end
    d.noted = true
    if d.on and d.agreed then
        Say("drop, quest, vendor, trainer, NPC and game text tracking is enabled by default for cr0m's item database. |cffaaaaaa/kinv track|r shows the status.")
        print("  It never records your gold or player chat. |cffaaaaaa/kinv track drops off|r stops recording.")
    else
        Say("drop, quest, vendor, trainer, NPC and game text tracking for cr0m's item database is off here, as you left it. |cffaaaaaa/kinv track drops on|r starts it.")
        print("  It never records your gold or player chat. |cffaaaaaa/kinv track|r shows the status.")
    end
end
