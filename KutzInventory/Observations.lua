-- KutzInventory / Observations: default-on recording of what drops, what quests give, what vendors sell, what
-- trainers teach and where flight masters fly, plus a summary of the NPCs seen, for cr0m's item database. On from the first load of a new install; an
-- install from the opt-in days keeps its choice (off stays off). /kinv track drops off stops all of it (the NPC summary too)
-- and stays off across reloads; /kinv track shows the status.
--
-- A module on its own: its own saved table, KutzInventoryObsDB, and nothing in the other files depends on it (they
-- only call ns.ObsCommand / ns.ObsNote when they exist). Leave this file and its .toc lines out and the addon is the same.
--
-- KutzInventoryObsDB = { v = 1, on = true|false, agreed = true|nil, noted = true|nil,
--                        addon = "1.8.0", prefix = "k1f9c2", n = 17, events = { oldest first }, npcs = { [npcId] = ... } }
--   prefix: random, made once per install; the event ids start with it and the export names the npcs summary's install by it.
--   on: a new table starts true (KutzInventory 1.13.0); an existing one keeps what it holds, only a missing on becomes
--   true. Recording needs on and agreed.
-- Each event: { id = prefix .. "-" .. counter, t = time(), b = "1.60.1.70888", type = "loot"|"quest"|"vendor"|"trainer"|"taxi"|"flight",
--               where = { map, uiMap, itype, difficulty, x, y }, who = { level, class, faction, name, surname }, ... }
--   who.name / who.surname: this character's own name (never anyone else's), so cr0m can credit the right character.
--   items carry link = "|cffa335ee|Hitem:19019|h[Name]|h|r": only the item's quality colour, id and name, so cr0m can name
--   an item no database has yet (the rest of the game's link, with the player's level and spec, is dropped).
--   loot    one per loot source in a loot window: src = { kind, npc|object|item, guid, level, via }, items = { { id, n, link } }
--           (every window is an open: a coins-only corpse is items = {}; coins are never recorded. The same corpse
--           opened twice counts once; skinning it is a separate "skin" open)
--           src.encounter: the DungeonEncounter id, on a boss killed while recording (ENCOUNTER_END; Forever shows no
--           boss1..5 units, so the boss is the dead creature the group targets).
--           via = "roll": a corpse's group-loot roll list (START_LOOT_ROLL), recorded also when another player opened
--           it: only the items at or above src.threshold (the group's loot threshold, 0-7) are in it. Items a loot
--           window of ours showed already are not recorded again, and the same corpse's roll list counts once.
--           An item this player won by roll carries won = true (from the player's own "You won: [item]" loot line).
--   quest   act = "accept"|"turnin", quest, npc|object (the giver / ender), rewards = { items, choices, chose } on turnin,
--           text = { title, details, objectives } on accept and { title, progress, completion } on turnin: the quest's
--           words as the game showed them, with this character's own name put back to "$N". Once per quest and act
--           while the event is kept, and not at all once the events are past half the size cap.
--           1.18.0, on accept: lv, group (2-40), freq ("daily"|"weekly"), timed (true) from the quest log, and startItem
--           (QUEST_DETAIL's arg, only for the quest that window showed). On turnin: xp (GetRewardXP at QUEST_COMPLETE, only
--           under the level cap with XP not turned off) and rep = { { f = factionID, d = change } }: the standings read at
--           QUEST_COMPLETE and again 1 s after the turn-in, only the changes (never a standing), at most 6, none when
--           loot, combat or another reward window or turn-in came in between.
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
--   rx: UnitReaction("npc", "player"), 1 hated .. 4 neutral .. 8 exalted. Prices and costs are what the game shows,
--           which already includes this character's reputation discount: rx tells a list price from a discounted one.
--           They are game prices, not the player's money (taxi costs too).
-- Never recorded: coin loot, quest money (GetRewardMoney, QUEST_TURNED_IN's money), the player's money, a reputation
-- standing, other players' names or GUIDs, chat, guild. (Loot chat is read only for this player's own "You won" line,
-- kept as the won flag; who else rolled or won is never kept.)
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

local ADDON, ns = ...

local PREFIX = "|cffd8b84aKutzInventory|r: "
local MAX_EVENTS, MAX_AGE, MAX_BYTES = 5000, 30 * 86400, 2000000
local CAST_WINDOW = 5                           -- seconds (GetTime) from a gathering / skinning cast to its loot window
local VENDOR_AGAIN = 3600                       -- the same vendor with the same stock is recorded at most once an hour
local LF = string.char(10)
local TEXT_MAX = { title = 200, details = 8000, objectives = 4000, progress = 4000, completion = 8000 }   -- bytes

local function Plain(v)
    if v == nil then return nil end
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
        local pos = Try(M.GetPlayerMapPosition, w.uiMap, "player")
        if type(pos) == "table" and type(pos.GetXY) == "function" then
            local x, y = Try(pos.GetXY, pos)
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

-- An item link cut down to the item's own facts: "|cffa335ee|Hitem:19019|h[Thunderfury]|h|r", or nil.
local function ShortLink(link)
    if type(link) ~= "string" then return nil end
    local colour, id = link:match("|c[fF][fF](%x%x%x%x%x%x)"), link:match("|Hitem:(%d+)")
    local name = link:match("|h%[([^%]|]+)%]|h")
    if not (colour and id and name) or #name > 120 then return nil end
    return "|cff" .. colour:lower() .. "|Hitem:" .. id .. "|h[" .. name .. "]|h|r"
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
local lootDone = false
local Sighting                                  -- (unit, open): the npcs summary's update, defined below

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
-- via = "slot" (GetLootSourceInfo named it) or "target" (the dead target when the window opened)
local function Source(guid, via, fishing)
    local what, id = FromGuid(guid)
    local cast = Now() - lastCast.at <= CAST_WINDOW and lastCast.kind or nil
    local src = {}
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
                break
            end
        end
    end
end

-- Every loot window is an open, coins-only ones too (items = {}): drops / opens is the rate. Coins are never recorded.
local function RecordLoot()
    if lootDone then return end
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
    if #order == 0 then Of(Target(), "target") end           -- a loot window with nothing in it
    for _, key in ipairs(order) do
        local s, e = sources[key], NewEvent("loot")
        e.src, e.items = Source(s.guid, s.via, fishing), s.items
        if e.src.guid then e.src.encounter = bossEncounter[e.src.guid] end
        if not (e.src.guid and Opened(e.src.guid .. "|" .. e.src.kind)) then Add(e) end
        if e.src.guid then Windowed(e.src, s.byId) end
    end
end

-- One burst of rolls, read ROLL_SETTLE seconds after its last roll started (so a window this player opened on the same
-- corpse has been recorded first): one event per corpse, items merged by id like a window's.
local function FlushRolls()
    local list = pendingRolls
    pendingRolls = {}
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
            if not guid and bossKill and not bossKill.claimed and now - bossKill.at <= BOSS_LOOT and bossKill.map == Where().map then
                guid = bossKill.guid
            end
            if guid and bossKill and guid == bossKill.guid then bossKill.claimed = true end
            if not (guid and Opened(guid .. "|roll")) then
                local e, byId = NewEvent("loot"), {}
                e.src, e.items = RollSource(guid), {}
                for _, r in ipairs(rest) do
                    if byId[r.id] then byId[r.id].n = byId[r.id].n + r.n
                    else byId[r.id] = { id = r.id, n = r.n, link = r.link }; e.items[#e.items + 1] = byId[r.id] end
                    rolled[#rolled + 1] = { at = now, id = r.id, item = byId[r.id] }
                end
                Add(e)
                if not guid then sourceless = Fresh(sourceless); sourceless[#sourceless + 1] = { at = now, e = e } end
            end
        end
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
-- quests: accepted (with the giver) and turned in (with the ender and the item rewards; never money)
---------------------------------------------------------------------------
local detail = nil                              -- { quest, what, id, at } from the quest window that offered it
local turnin = nil                              -- { quest, what, id, items, choices, chose } from the reward window
local progress = nil                            -- { quest, text } from the "do you have it yet?" window before it
local hookedReward, haveTurnedInEvent = false, false
-- the extras (1.18.0), filled in further down: facts from the quest log on accept; the reward window's XP and the
-- reputation a turn-in changed. rep: the watch { quest, before = { [factionID] = standing }, at, turned, spoiled, e }
local qx = { REP_MAX = 6, REP_D = 100000, STALE = 300, WAIT = 1, FACTIONS = 1000, rep = nil }

local function QuestId(...)                     -- QUEST_ACCEPTED is (index, questId) in older clients, (questId) in newer
    local a, b = Plain((...)), Plain((select(2, ...)))
    return Int(b, 1) or Int(a, 1)
end

-- The quest window's words. The game writes the character's name into them; it goes back to "$N", so the text is the
-- quest's and not about the player. Cut to the field's limit on a whole UTF-8 character.
local function Prose(fn, max)
    local s = Plain(Try(fn))
    if type(s) ~= "string" then return nil end
    s = s:gsub("%c", function(c) return c == LF and c or "" end):gsub("^%s+", ""):gsub("%s+$", "")
    if s == "" then return nil end
    local given = Me()
    if given then
        local pat = given:gsub("(%W)", "%%%1")
        if given:find("^%w") then pat = "%f[%w]" .. pat end
        if given:find("%w$") then pat = pat .. "%f[%W]" end
        s = s:gsub(pat, "$N")
    end
    s = Cut(s, max)
    return s ~= "" and s or nil
end

local function QuestText(fields)                -- { title = GetTitleText, ... } -> { title = "...", ... } or nil
    local out, any = {}, false
    for key, fn in pairs(fields) do
        local s = Prose(fn, TEXT_MAX[key])
        if s then out[key], any = s, true end
    end
    return any and out or nil
end

-- A quest's text is kept once per quest and act ("7787|accept") among the saved events, and only while the events are
-- under half the size cap, so prose never pushes drops out.
local texted
local function WantsText(quest, act)
    if bytes > MAX_BYTES / 2 then return false end
    if not texted then
        texted = {}
        for _, e in ipairs(DB().events) do
            if type(e) == "table" and e.type == "quest" and type(e.text) == "table" then
                texted[tostring(e.quest) .. "|" .. tostring(e.act)] = true
            end
        end
    end
    local key = quest .. "|" .. act
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
        for _, it in ipairs(p.choices) do choices[#choices + 1] = it.id end
        e.rewards = { items = p.items, choices = choices, chose = p.chose }
        e.xp = p.xp
        if p.text and WantsText(questId, "turnin") then e.text = p.text end
    end
    turnin, progress = nil, nil
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
    e.where, e.from, e.to, e.sec = nil, f.from, f.to, f.sec
    Add(e)
end

-- TakeTaxiNode(slot), after the game ran it: the destination chosen in the window we read
function taxi.Take(slot)
    local d, w = DB(), taxi.window
    if not (d and d.on and d.agreed and w) then return end
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
        local landing, arrived = { from = f.from, to = f.to, sec = sec, at = at }, taxi.Arrived(f)
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
local NPC = { AGAIN = 30, CELL_AGAIN = 600, CELLS = 40, MAX = 3000, BYTES = 500000, SPEEDS = 4, DAYS = 180, SESSION = 4000 }
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
            if type(n) == "table" and Serve(n, svc) then NpcIndex(d); NpcSized(npc, n) end
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
    if not (w.uiMap and w.x and w.y) then return end            -- inside an instance, or no position
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
    if svc then Serve(n, svc) end
    n.day = math.floor(time() / 86400)
    if near then Cell(n, npc, w, now) end
    NpcSized(npc, n)
    if npcSeen.count > NPC.MAX or npcSeen.bytes > NPC.BYTES then PruneNpcs(d, true) end
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
    for i = #list, math.max(1, #list - 200), -1 do
        if list[i] == e then
            local was = Size(e)
            for k, v in pairs(fields) do e[k] = v end
            bytes = bytes + Size(e) - was
            return
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
    local info = i and Try(L.GetInfo, i)
    if type(info) ~= "table" or Plain(info.isHeader) == true or Int(info.questID, 1) ~= quest then return false end
    local lv, group, freq, F = Int(info.level, 1), Int(info.suggestedGroup, 2), Int(info.frequency), Enum and Enum.QuestFrequency
    if lv and lv <= 255 then out.lv = lv end
    if group and group <= 40 then out.group = group end
    if freq and type(F) == "table" then
        if freq == Int(F.Daily) then out.freq = "daily" elseif freq == Int(F.Weekly) then out.freq = "weekly" end
    end
    if Int((Try(L.GetTimeAllowed, quest)), 1) then out.timed = true end
    return true
end

-- The XP the reward window shows (GetRewardXP), only while this character can gain XP: its level and the cap known and
-- under it, and XP not turned off (IsXPUserDisabled, when the client has it, plainly false). nil when 0 or unsure.
function qx.Xp()
    local max, me = Int(Try(GetMaxPlayerLevel), 1), Int(Try(UnitLevel, "player"), 1)
    if not (max and me and me < max) then return nil end
    if type(IsXPUserDisabled) == "function" and not False(IsXPUserDisabled) then return nil end
    return Int((Try(GetRewardXP)), 1)
end

-- Standings by faction id: of the factions in ids (GetFactionDataByID), or of the whole list (headers opened for the
-- read and closed again, from the bottom up, as ScanReputation does). Headers without a standing of their own and,
-- where the client says so, renown factions (their standing restarts each level) are left out. nil when unreadable.
function qx.Standings(ids)
    local R = C_Reputation
    if type(R) ~= "table" then return nil end
    local out = {}
    local function put(f)
        if type(f) ~= "table" then return end
        local id, s = Int(f.factionID, 1), Int(f.currentStanding, -2147483647)
        if not (id and s) or (Plain(f.isHeader) ~= false and Plain(f.isHeaderWithRep) ~= true) then return end
        if type(R.IsMajorFaction) == "function" and not False(R.IsMajorFaction, id) then return end
        out[id] = s
    end
    if ids then
        if type(R.GetFactionDataByID) ~= "function" then return nil end
        for id in pairs(ids) do put(Try(R.GetFactionDataByID, id)) end
        return out
    end
    if type(R.GetNumFactions) ~= "function" or type(R.GetFactionDataByIndex) ~= "function" then return nil end
    local closed = {}
    for i = 1, math.min(Int((Try(R.GetNumFactions))) or 0, qx.FACTIONS) do
        local f = Try(R.GetFactionDataByIndex, i)
        local id = type(f) == "table" and Plain(f.isHeader) == true and Plain(f.isCollapsed) == true and Int(f.factionID, 1)
        if id then closed[id] = true end
    end
    if next(closed) then Try(R.ExpandAllFactionHeaders) end
    local count = math.min(Int((Try(R.GetNumFactions))) or 0, qx.FACTIONS)
    for i = 1, count do put(Try(R.GetFactionDataByIndex, i)) end
    if next(closed) then
        for i = count, 1, -1 do
            local f = Try(R.GetFactionDataByIndex, i)
            local id = type(f) == "table" and Int(f.factionID, 1)
            if id and closed[id] and Plain(f.isCollapsed) == false then Try(R.CollapseFactionHeader, i) end
        end
    end
    return out
end

-- The reputation a turn-in changed: every standing read when the reward window opens (QUEST_COMPLETE, out of combat),
-- the same factions again a second after that quest's turn-in; rep = { { f = factionID, d = change } } of those that
-- changed, sorted by f. Never the standing itself. Nothing when something else could have moved them in between (loot,
-- combat, another reward window or turn-in, more than 5 minutes between the window and the turn-in), when more than 6
-- changed, or when a change is over 100000.
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
-- events: only registered while recording is on
---------------------------------------------------------------------------
local handlers = {}

function handlers.LOOT_OPENED() qx.Spoil(); RecordLoot() end
function handlers.LOOT_CLOSED() lootDone = false end
local function Cast(unit, _, spellId)
    if unit ~= "player" then return end
    local kind = GatherKind(spellId)
    if kind then lastCast.kind, lastCast.at = kind, Now() end
end
handlers.UNIT_SPELLCAST_START = Cast
handlers.UNIT_SPELLCAST_SUCCEEDED = Cast
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
    pendingRolls[#pendingRolls + 1] = { id = id, n = Int(count, 1) or 1, link = ShortLink(link), guid = GuidIn(...) }
    rollToken = rollToken + 1
    local token = rollToken
    if C_Timer and C_Timer.After then
        C_Timer.After(ROLL_SETTLE, function() if token == rollToken then SafeFlushRolls() end end)
    else FlushRolls() end
end

function handlers.CHAT_MSG_LOOT(text) Won(Plain(text)) end

local function QuestGiverSeen()                 -- the quest window is open with it (questnpc, else npc)
    pcall(Sighting, "questnpc", true)
    pcall(Sighting, "npc", true)                -- the same creature: the 30 s throttle makes this a no-op
end

function handlers.QUEST_DETAIL(startItem)       -- (questStartItemID): the item that started it, 0 when none
    QuestGiverSeen()
    local what, id = Giver("questnpc", "npc")
    detail = { quest = Int(Try(GetQuestID), 1), what = what, id = id, at = time(), startItem = Int(startItem, 1),
               text = QuestText({ title = GetTitleText, details = GetQuestText, objectives = GetObjectiveText }) }
end
function handlers.QUEST_ACCEPTED(...)
    local quest = QuestId(...)
    if not quest then return end
    local e = NewEvent("quest")
    e.act, e.quest = "accept", quest
    local p = detail
    if p and p.what and (p.quest == quest or (not p.quest and time() - p.at <= 60)) then e[p.what] = p.id end
    if p and p.quest == quest then                                           -- only a sure match
        if p.text and WantsText(quest, "accept") then e.text = p.text end
        e.startItem = p.startItem
    end
    detail = nil
    local ok, found = pcall(qx.Facts, quest, e)
    Add(e)
    if ok and not found then                    -- not in the log yet: once more a second later, added to the saved event
        qx.Later(function() local f = {}; if qx.Facts(quest, f) and next(f) then qx.Amend(e, f) end end)
    end
end
function handlers.QUEST_PROGRESS()
    progress = { quest = Int(Try(GetQuestID), 1), text = Prose(GetProgressText, TEXT_MAX.progress) }
end
function handlers.QUEST_COMPLETE()
    QuestGiverSeen()
    local what, id = Giver("questnpc", "npc")
    local quest = Int(Try(GetQuestID), 1)
    turnin = { quest = quest, what = what, id = id,
               items = RewardItems("reward", (Try(GetNumQuestRewards))), choices = {},
               text = quest and QuestText({ title = GetTitleText, completion = GetRewardText }) }
    if turnin.text and progress and progress.quest == quest then turnin.text.progress = progress.text end
    for i = 1, Int((Try(GetNumQuestChoices))) or 0 do
        local cid = ItemId(Plain(Try(GetQuestItemLink, "choice", i)))
        turnin.choices[i] = cid and { id = cid } or false
    end
    turnin.xp = quest and qx.Xp()
    HookReward()
    qx.Watch(quest)
end
function handlers.QUEST_TURNED_IN(questId)        -- (questId, xp, money): the money is never read, nor GetRewardMoney
    questId = Int(questId, 1)
    if questId then TurnedIn(questId) end
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
            Sighting("npc", true, svc == "vendor" and Repairs({ svc }) or { svc })
            return
        end
    end
end
-- an innkeeper: "make this inn your home" asked (CONFIRM_BINDER) or done (HEARTHSTONE_BOUND) while talking to it
function handlers.CONFIRM_BINDER() Sighting("npc", true, { "inn" }) end
function handlers.HEARTHSTONE_BOUND() Sighting("npc", true, { "inn" }) end

local RECORDING = { "LOOT_OPENED", "LOOT_CLOSED", "UNIT_SPELLCAST_START", "UNIT_SPELLCAST_SUCCEEDED", "ENCOUNTER_START",
                    "INSTANCE_ENCOUNTER_ENGAGE_UNIT", "ENCOUNTER_END", "START_LOOT_ROLL", "CHAT_MSG_LOOT",
                    "QUEST_DETAIL", "QUEST_ACCEPTED", "QUEST_PROGRESS", "QUEST_COMPLETE", "QUEST_TURNED_IN",
                    "MERCHANT_SHOW", "MERCHANT_CLOSED", "TRAINER_SHOW", "TRAINER_UPDATE", "TRAINER_CLOSED",
                    "TAXIMAP_OPENED", "TAXIMAP_CLOSED", "PLAYER_CONTROL_LOST", "PLAYER_CONTROL_GAINED",
                    "PLAYER_TARGET_CHANGED", "UPDATE_MOUSEOVER_UNIT", "PLAYER_INTERACTION_MANAGER_FRAME_SHOW", "CONFIRM_BINDER",
                    "HEARTHSTONE_BOUND", "PLAYER_REGEN_DISABLED" }

local ev = CreateFrame("Frame")
local hookedBags = false

local function Enable()
    for _, e in ipairs(RECORDING) do
        local ok, err = pcall(ev.RegisterEvent, ev, e)   -- an event this client lacks is simply skipped
        if e == "QUEST_TURNED_IN" then haveTurnedInEvent = ok and err ~= false end
    end
    if not hookedBags and type(hooksecurefunc) == "function" and C_Container and type(C_Container.UseContainerItem) == "function" then
        hookedBags = pcall(hooksecurefunc, C_Container, "UseContainerItem", function(bag, slot)
            local info = C_Container.GetContainerItemInfo and Try(C_Container.GetContainerItemInfo, bag, slot)
            local id = type(info) == "table" and Int(info.itemID, 1)
            if id then lastUsedItem.id, lastUsedItem.at = id, Now() end
        end)
    end
    if not taxi.hooked and type(hooksecurefunc) == "function" and type(TakeTaxiNode) == "function" then
        taxi.hooked = pcall(hooksecurefunc, "TakeTaxiNode", function(slot) pcall(taxi.Take, Plain(slot)) end)
    end
end
local function Disable()
    for _, e in ipairs(RECORDING) do pcall(ev.UnregisterEvent, ev, e) end
    lootDone, detail, turnin, progress, merchantOpen = false, nil, nil, nil, false
    trainer.open, trainer.token = false, trainer.token + 1   -- a read still waiting is dropped
    pendingRolls, rollToken = {}, rollToken + 1          -- a burst still settling is dropped
    taxi.Reset()
    qx.rep = nil                                         -- a turn-in's rep still settling is dropped
end

local function AddonVersion()
    local get = C_AddOns and C_AddOns.GetAddOnMetadata or GetAddOnMetadata
    local v = Plain(Try(get, ADDON, "Version"))
    return type(v) == "string" and v ~= "" and v or nil
end

function handlers.ADDON_LOADED(name)
    if name ~= ADDON then return end
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

-- the first /kinv after updating: two lines about drop tracking, once (an install that kept it off is told how to start it)
function ns.ObsNote()
    local d = DB(true)
    if d.noted then return end
    d.noted = true
    if d.on and d.agreed then
        Say("drop, quest, vendor, trainer and NPC tracking is enabled by default for cr0m's item database. |cffaaaaaa/kinv track|r shows the status.")
        print("  It never records gold or anything about other players. |cffaaaaaa/kinv track drops off|r stops recording.")
    else
        Say("drop, quest, vendor, trainer and NPC tracking for cr0m's item database is off here, as you left it. |cffaaaaaa/kinv track drops on|r starts it.")
        print("  It never records gold or anything about other players. |cffaaaaaa/kinv track|r shows the status.")
    end
end
