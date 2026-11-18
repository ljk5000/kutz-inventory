-- KutzInventory / Observations: default-on recording of what drops, what quests give, what vendors sell and what
-- trainers teach, for cr0m's item database. On from the first load of a new install; an install from the opt-in days keeps
-- its choice (off stays off). /kinv track drops off stops it and stays off across reloads; /kinv track shows the status.
--
-- A module on its own: its own saved table, KutzInventoryObsDB, and nothing in the other files depends on it (they
-- only call ns.ObsCommand / ns.ObsNote when they exist). Leave this file and its .toc lines out and the addon is the same.
--
-- KutzInventoryObsDB = { v = 1, on = true|false, agreed = true|nil, noted = true|nil,
--                        addon = "1.8.0", prefix = "k1f9c2", n = 17, events = { oldest first } }
--   on: a new table starts true (KutzInventory 1.13.0); an existing one keeps what it holds, only a missing on becomes
--   true. Recording needs on and agreed.
-- Each event: { id = prefix .. "-" .. counter, t = time(), b = "1.60.1.70888", type = "loot"|"quest"|"vendor"|"trainer",
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
--   vendor  npc, rx, filtered, items = { { id, n, link, price (copper per n, as shown), cost = { { item|currency, n } }, limited } }
--           read under the merchant window's "all" item filter, put back at once; filtered = true when it could not be
--           switched (the list then misses the items the class filter hides). The same stock and rx once an hour.
--   trainer npc, kind = "class"|"profession", rx, rows = { { s, name, rank, lv, skill, skillReq, needs, cost, st } }:
--           a trainer's whole list (all three type filters on for the read, put back after), at most 400 rows.
--           s = spell id (from the tooltip data; left out when the client gives none), st = "a" available, "u" not
--           yet, "k" known. The hunter's Beast Training window is never recorded. The same trainer with the same list
--           (st aside, so learning a spell changes nothing) and rx is recorded at most once in 7 days.
--   rx: UnitReaction("npc", "player"), 1 hated .. 4 neutral .. 8 exalted. Prices and costs are what the game shows,
--           which already includes this character's reputation discount: rx tells a list price from a discounted one.
--           They are game prices, not the player's money.
-- Never recorded: coin loot, quest money, the player's money, other players' names or GUIDs, chat, guild. (Loot chat is
-- read only for this player's own "You won" line, kept as the won flag; who else rolled or won is never kept.)
-- At most 5000 events, 30 days and about 2 MB of JSON; the oldest go first.

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

local function NewId(d)
    if type(d.prefix) ~= "string" or d.prefix == "" then
        local p = {}
        for i = 1, 6 do local r = math.random(1, 36); p[i] = ALNUM:sub(r, r) end
        d.prefix = table.concat(p)
    end
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
        if p.text and WantsText(questId, "turnin") then e.text = p.text end
    end
    turnin, progress = nil, nil
    Add(e)
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
    trainer.reading = true                      -- the filter switches below fire TRAINER_UPDATE: ignored meanwhile
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
-- events: only registered while recording is on
---------------------------------------------------------------------------
local handlers = {}

function handlers.LOOT_OPENED() RecordLoot() end
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

function handlers.QUEST_DETAIL()
    local what, id = Giver("questnpc", "npc")
    detail = { quest = Int(Try(GetQuestID), 1), what = what, id = id, at = time(),
               text = QuestText({ title = GetTitleText, details = GetQuestText, objectives = GetObjectiveText }) }
end
function handlers.QUEST_ACCEPTED(...)
    local quest = QuestId(...)
    if not quest then return end
    local e = NewEvent("quest")
    e.act, e.quest = "accept", quest
    local p = detail
    if p and p.what and (p.quest == quest or (not p.quest and time() - p.at <= 60)) then e[p.what] = p.id end
    if p and p.text and p.quest == quest and WantsText(quest, "accept") then e.text = p.text end   -- only a sure match
    detail = nil
    Add(e)
end
function handlers.QUEST_PROGRESS()
    progress = { quest = Int(Try(GetQuestID), 1), text = Prose(GetProgressText, TEXT_MAX.progress) }
end
function handlers.QUEST_COMPLETE()
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
    HookReward()
end
function handlers.QUEST_TURNED_IN(questId)        -- (questId, xp, money): the money is never read
    questId = Int(questId, 1)
    if questId then TurnedIn(questId) end
end

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

local RECORDING = { "LOOT_OPENED", "LOOT_CLOSED", "UNIT_SPELLCAST_START", "UNIT_SPELLCAST_SUCCEEDED", "ENCOUNTER_START",
                    "INSTANCE_ENCOUNTER_ENGAGE_UNIT", "ENCOUNTER_END", "START_LOOT_ROLL", "CHAT_MSG_LOOT",
                    "QUEST_DETAIL", "QUEST_ACCEPTED", "QUEST_PROGRESS", "QUEST_COMPLETE", "QUEST_TURNED_IN",
                    "MERCHANT_SHOW", "MERCHANT_CLOSED", "TRAINER_SHOW", "TRAINER_UPDATE", "TRAINER_CLOSED" }

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
end
local function Disable()
    for _, e in ipairs(RECORDING) do pcall(ev.UnregisterEvent, ev, e) end
    lootDone, detail, turnin, progress, merchantOpen = false, nil, nil, nil, false
    trainer.open, trainer.token = false, trainer.token + 1   -- a read still waiting is dropped
    pendingRolls, rollToken = {}, rollToken + 1          -- a burst still settling is dropped
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
    Say("drop tracking is " .. (d.on and d.agreed and "|cff40ff40on|r" or "|cffaaaaaaoff|r") .. ". "
        .. n .. " event" .. (n == 1 and "" or "s") .. " kept" .. (first and type(first.t) == "number" and (" since " .. When(first.t)) or "")
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
    Say("drop tracking is off. What it already recorded stays (and goes up with your next upload); delete it on cr0m.")
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
        Say("drop, quest, vendor and trainer tracking is enabled by default for cr0m's item database. |cffaaaaaa/kinv track|r shows the status.")
        print("  It never records gold or anything about other players. |cffaaaaaa/kinv track drops off|r stops recording.")
    else
        Say("drop, quest, vendor and trainer tracking for cr0m's item database is off here, as you left it. |cffaaaaaa/kinv track drops on|r starts it.")
        print("  It never records gold or anything about other players. |cffaaaaaa/kinv track|r shows the status.")
    end
end
