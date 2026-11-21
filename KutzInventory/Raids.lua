-- KutzInventory / Raids: records cr0m raids you joined, so the site can see who was there and what dropped.
--
-- cr0m gives each joined raid a string: KR1.<CODE>.<instanceId>.<startUnix>.<sig>
--   CODE      6 characters, A-Z and 2-9 (the raid's join code)
--   instanceId the raid's instance (0 = unknown)
--   startUnix the scheduled start, UTC seconds
--   sig       12 characters, the site's signature. The addon can't check it; it keeps the string as pasted.
-- /kinv raid <string> tracks it, /kinv raid lists them, /kinv raid clear <CODE> drops one.
--
-- Account-wide, in KutzInventoryDB.raids[CODE]:
--   { string = "KR1...", instanceId = n, start = unix, events = { { t = time(), kind = "...", ... }, ... },
--     open = { id, name } while recording in an instance, leftAt = time the loading screen out of it started }
-- A raid is "active" from 2 h before its start to 8 h after, while you are in a party or raid group and inside an
-- instance. Then it records:
--   start / end            entering / leaving the instance (start has the client's instanceId, instanceName, ...)
--   encounter_start / _end ENCOUNTER_START / ENCOUNTER_END: encounterId, encounterName, difficultyId, groupSize, success
--   loot                   CHAT_MSG_LOOT for anyone in the group: itemId, itemLink, count, looter
--   roster                 the group's members at start and after each encounter
-- Our own character uses its stable inventory key; other players use the client's "Name-Realm".
-- Nothing is recorded for raids that aren't tracked. Who may upload a raid is the site's business, not the addon's.

local ADDON, ns = ...

local PREFIX = "|cffd8b84aKutzInventory|r: "
local BEFORE, AFTER = 2 * 3600, 8 * 3600        -- the active window around the scheduled start
local KEEP = 14 * 86400                         -- forget a raid 14 days after its start
local MAX_RAIDS, MAX_EVENTS = 20, 2000

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
local function Say(msg) print(PREFIX .. msg) end

-- "KR1.ABC234.409.1767225600.ABCDEFGHJKMN" -> code, instanceId, start; nil if it is not that shape
local function Parse(s)
    if type(s) ~= "string" then return nil end
    local code, inst, start, sig = s:match("^KR1%.([A-Z2-9][A-Z2-9][A-Z2-9][A-Z2-9][A-Z2-9][A-Z2-9])%.(%d+)%.(%d+)%.([A-Z0-9]+)$")
    if not code or #sig ~= 12 or #inst > 10 or #start > 12 then return nil end
    return code, tonumber(inst), tonumber(start)
end
ns.ParseRaidString = Parse

local function Raids(create)
    local db = KutzInventoryDB
    if type(db) ~= "table" then return nil end
    if create and type(db.raids) ~= "table" then db.raids = {} end
    return type(db.raids) == "table" and db.raids or nil
end

-- forget raids 14 days after their start, and keep at most MAX_RAIDS (the oldest start goes first)
local function Prune()
    local raids = Raids()
    if not raids then return end
    local now, codes = time(), {}
    for code, r in pairs(raids) do
        if type(r) ~= "table" or type(r.start) ~= "number" or r.start + KEEP < now then raids[code] = nil
        else codes[#codes + 1] = code end
    end
    table.sort(codes, function(a, b) return raids[a].start < raids[b].start end)
    for n = 1, #codes - MAX_RAIDS do raids[codes[n]] = nil end
end

local function MyKey()
    if ns.CharacterKey then return ns.CharacterKey() end
    local name, realm = Plain(Try(UnitName, "player")), ns.RealmName and ns.RealmName() or Plain(Try(GetRealmName))
    if type(name) ~= "string" or type(realm) ~= "string" then return nil end
    return name .. "-" .. realm
end

-- Our own stable inventory key; other group members use their client-supplied Name-Realm.
local function UnitKey(unit)
    local me = ns.Me and ns.Me()
    if unit == "player" or (me and me.guid and Plain(Try(UnitGUID, unit)) == me.guid) then return MyKey() end
    local name, realm = Try(UnitName, unit)
    name, realm = Plain(name), Plain(realm)
    if type(name) ~= "string" or name == "" or name == _G.UNKNOWNOBJECT then return nil end
    if type(realm) ~= "string" or realm == "" then realm = ns.RealmName and ns.RealmName() or Plain(Try(GetRealmName)) or "" end
    return name .. "-" .. realm
end

local function InGroup()
    return Try(IsInRaid) or Try(IsInGroup) or (Plain(Try(GetNumGroupMembers)) or 0) > 0
end

local function GroupUnits()
    local units, n = { "player" }, Plain(Try(GetNumGroupMembers)) or 0
    if Try(IsInRaid) then
        units = {}
        for i = 1, math.min(n, 40) do units[#units + 1] = "raid" .. i end
    else
        for i = 1, math.min(n - 1, 4) do units[#units + 1] = "party" .. i end
    end
    return units
end

local function Roster()
    local members, seen = {}, {}
    for _, unit in ipairs(GroupUnits()) do
        local key = UnitKey(unit)
        if key and not seen[key] then seen[key] = true; members[#members + 1] = key end
    end
    table.sort(members)
    return members
end

-- where we are, if it counts: { id, name, type, difficulty } inside a party/raid instance while grouped, else nil
local function Where()
    if not InGroup() then return nil end
    local inside, itype = Try(IsInInstance)
    local name, gtype, difficulty, _, _, _, _, id = Try(GetInstanceInfo)
    itype = Plain(itype) or Plain(gtype)
    if IsInInstance and not inside then return nil end
    if not itype or itype == "none" or itype == "pvp" or itype == "arena" then return nil end
    return { id = Plain(id), name = Plain(name), type = itype, difficulty = Plain(difficulty) }
end

local function Add(r, e)
    r.events = type(r.events) == "table" and r.events or {}
    if #r.events >= MAX_EVENTS then return end
    e.t = e.t or time()
    r.events[#r.events + 1] = e
end

local leaving = false                           -- between PLAYER_LEAVING_WORLD and PLAYER_ENTERING_WORLD

-- Open or close each tracked raid for where we are now. Returns the raids that are recording.
local function Refresh()
    local raids = Raids()
    if not raids or next(raids) == nil or leaving then return {} end
    local now, where = time(), Where()
    local active, matched = {}, false
    if where then
        for code, r in pairs(raids) do
            if type(r) == "table" and type(r.start) == "number" and now >= r.start - BEFORE and now <= r.start + AFTER then
                -- ids may be journal or map ids: prefer the raid whose id matches, else take any raid in its window
                local same = (r.instanceId or 0) ~= 0 and r.instanceId == where.id
                active[code] = same and 2 or 1
                matched = matched or same
            end
        end
        if matched then for code, v in pairs(active) do if v ~= 2 then active[code] = nil end end end
    end
    local open = {}
    for code, r in pairs(raids) do
        if type(r) == "table" then
            if r.open and (not active[code] or r.open.id ~= where.id) then
                Add(r, { t = r.leftAt or now, kind = "end", instanceId = r.open.id, instanceName = r.open.name })
                r.open = nil
            end
            r.leftAt = nil
            if active[code] then
                if not r.open then
                    r.open = { id = where.id, name = where.name }
                    Add(r, { t = now, kind = "start", instanceId = where.id, instanceName = where.name, instanceType = where.type,
                             difficultyId = where.difficulty, by = MyKey() })
                    Add(r, { t = now, kind = "roster", members = Roster() })
                end
                open[#open + 1] = r
            end
        end
    end
    return open
end
ns.RefreshRaids = Refresh

---------------------------------------------------------------------------
-- loot messages, read with the client's own format strings (any language)
---------------------------------------------------------------------------
local LOOT_FORMATS = {                           -- global name, about you?, has a count?, English fallback
    { "LOOT_ITEM_SELF_MULTIPLE", true, true, "You receive loot: %sx%d." },
    { "LOOT_ITEM_BONUS_ROLL_SELF_MULTIPLE", true, true, "You receive bonus loot: %sx%d." },
    { "LOOT_ITEM_MULTIPLE", false, true, "%s receives loot: %sx%d." },
    { "LOOT_ITEM_BONUS_ROLL_MULTIPLE", false, true, "%s receives bonus loot: %sx%d." },
    { "LOOT_ITEM_SELF", true, false, "You receive loot: %s." },
    { "LOOT_ITEM_BONUS_ROLL_SELF", true, false, "You receive bonus loot: %s." },
    { "LOOT_ITEM", false, false, "%s receives loot: %s." },
    { "LOOT_ITEM_BONUS_ROLL", false, false, "%s receives bonus loot: %s." },
}
local lootPatterns

-- "%s receives loot: %sx%d." -> "^(.+) receives loot: (.+)x(%d+)%.$" and which argument each capture is
-- (translations may reorder them as %2$s)
local function FormatPattern(fmt)
    local parts, order, i, auto = {}, {}, 1, 0
    local function esc(s) return (s:gsub("[%^%$%(%)%%%.%[%]%*%+%-%?]", "%%%0")) end
    while i <= #fmt do
        local s, e, pos, kind = fmt:find("%%(%d*)%$?([sd])", i)
        if not s then parts[#parts + 1] = esc(fmt:sub(i)); break end
        parts[#parts + 1] = esc(fmt:sub(i, s - 1))
        auto = auto + 1
        order[#order + 1] = tonumber(pos) or auto
        parts[#parts + 1] = kind == "d" and "(%d+)" or "(.+)"
        i = e + 1
    end
    return "^" .. table.concat(parts) .. "$", order
end

local function LootPatterns()
    if lootPatterns then return lootPatterns end
    lootPatterns = {}
    for _, f in ipairs(LOOT_FORMATS) do
        local fmt = _G[f[1]]
        if type(fmt) ~= "string" or fmt == "" then fmt = f[4] end
        local pat, order = FormatPattern(fmt)
        lootPatterns[#lootPatterns + 1] = { pat = pat, order = order, self = f[2], count = f[3] }
    end
    return lootPatterns
end

-- a loot line -> looter name ("" for you), item link, count; nil when it is not a loot line
local function ParseLoot(text)
    if type(text) ~= "string" then return nil end
    for _, p in ipairs(LootPatterns()) do
        local caps = { text:match(p.pat) }
        if caps[1] then
            local args = {}
            for n, which in ipairs(p.order) do args[which] = caps[n] end
            local first = p.self and 1 or 2
            local who = p.self and "" or args[1]
            local link, count = args[first], p.count and tonumber(args[first + 1]) or 1
            if who and link then return who, link, count end
        end
    end
end
ns.ParseLoot = ParseLoot

-- "Name" or "Name-Realm" from a loot line -> the group member's "Name-Realm", else the name as written
local function LooterKey(name)
    for _, unit in ipairs(GroupUnits()) do
        local key = UnitKey(unit)
        local short = Plain(Try(UnitName, unit))
        if key and (key == name or short == name) then return key end
    end
    return name
end

---------------------------------------------------------------------------
-- events
---------------------------------------------------------------------------
local handlers = {}

function handlers.ADDON_LOADED(name) if name == ADDON then Prune() end end
function handlers.PLAYER_ENTERING_WORLD()
    leaving = false
    if not Raids() then return end
    if C_Timer and C_Timer.After then C_Timer.After(1, Refresh) else Refresh() end   -- instance info settles after the load
end
function handlers.PLAYER_LEAVING_WORLD()
    local raids = Raids()
    for _, r in pairs(raids or {}) do if type(r) == "table" and r.open then r.leftAt = time() end end
    leaving = true
end
function handlers.GROUP_ROSTER_UPDATE() Refresh() end
handlers.ZONE_CHANGED_NEW_AREA = handlers.GROUP_ROSTER_UPDATE

function handlers.ENCOUNTER_START(id, name, difficulty, size)
    for _, r in ipairs(Refresh()) do
        Add(r, { kind = "encounter_start", encounterId = Plain(id), encounterName = Plain(name), difficultyId = Plain(difficulty),
                 groupSize = Plain(size) })
    end
end
function handlers.ENCOUNTER_END(id, name, difficulty, size, success)
    success = Plain(success)
    local open = Refresh()
    local members = #open > 0 and Roster() or nil
    for _, r in ipairs(open) do
        Add(r, { kind = "encounter_end", encounterId = Plain(id), encounterName = Plain(name), difficultyId = Plain(difficulty),
                 groupSize = Plain(size), success = success == 1 or success == true })
        Add(r, { kind = "roster", members = members })
    end
end
function handlers.CHAT_MSG_LOOT(text, sender)
    local raids = Raids()
    if not raids or next(raids) == nil then return end
    local who, link, count = ParseLoot(Plain(text))
    local itemId = type(link) == "string" and tonumber(link:match("item:(%d+)"))
    if not itemId then return end
    local open = Refresh()
    if #open == 0 then return end
    if who == "" then who = MyKey()
    else
        sender = Plain(sender)
        if who == nil or who == "" then who = sender end
        who = who and LooterKey(who)
    end
    if not who then return end
    for _, r in ipairs(open) do
        Add(r, { kind = "loot", itemId = itemId, itemLink = link, count = count, looter = who })
    end
end

local ev = CreateFrame("Frame")
for _, e in ipairs({ "ADDON_LOADED", "PLAYER_ENTERING_WORLD", "PLAYER_LEAVING_WORLD", "GROUP_ROSTER_UPDATE", "ZONE_CHANGED_NEW_AREA",
                     "ENCOUNTER_START", "ENCOUNTER_END", "CHAT_MSG_LOOT" }) do
    pcall(ev.RegisterEvent, ev, e)              -- an event this client lacks is simply skipped
end
ev:SetScript("OnEvent", function(_, event, ...)
    local h = handlers[event]
    if not h then return end
    local ok, err = pcall(h, ...)
    if not ok and type(KutzInventoryDB) == "table" then KutzInventoryDB.lastError = "raids " .. event .. ": " .. tostring(err) end
end)

---------------------------------------------------------------------------
-- /kinv raid
---------------------------------------------------------------------------
local function When(t) return date("%a %d %b %Y, %H:%M", t) end

local function List()
    local raids, codes = Raids(), {}
    for code, r in pairs(raids or {}) do if type(r) == "table" and type(r.start) == "number" then codes[#codes + 1] = code end end
    if #codes == 0 then
        Say("no raids tracked. On cr0m, copy your raid's string and type |cffaaaaaa/kinv raid <string>|r.")
        return
    end
    table.sort(codes, function(a, b) return raids[a].start < raids[b].start end)
    Say("tracked raids (|cffaaaaaa/kinv raid clear <CODE>|r drops one):")
    for _, code in ipairs(codes) do
        local r = raids[code]
        print(string.format("  %s  %s (your time), %d events%s", code, When(r.start), #(r.events or {}),
            r.open and ", |cff40ff40recording|r" or ""))
    end
end

local function Track(s)
    local code, inst, start = Parse(s)
    if not code then
        Say("that isn't a raid string. It looks like |cffaaaaaaKR1.ABC234.0.1767225600.ABCDEFGHJKMN|r: copy it from the raid's page on cr0m.")
        return
    end
    if start + KEEP < time() then Say("raid " .. code .. " started more than 14 days ago, so it isn't tracked."); return end
    local raids = Raids(true)
    if not raids then return end
    local r = raids[code]
    if type(r) == "table" and r.string == s then Say("raid " .. code .. " is already tracked (" .. When(start) .. ")."); return end
    if type(r) ~= "table" then r = { events = {} } end
    r.string, r.instanceId, r.start = s, inst, start      -- a new string for the same code (rescheduled) keeps its events
    raids[code] = r
    Prune()
    if raids[code] ~= r then Say("raid " .. code .. " is older than the 20 you already track, so it was not kept."); return end
    Say("tracking raid " .. code .. ", starting " .. When(start) .. " (your time). It records from 2 hours before to 8 hours after, "
        .. "inside the instance with your group. It goes up with your next upload.")
    Refresh()
end

local function RaidCommand(msg)
    local rest = (msg or ""):match("^%s*[Rr][Aa][Ii][Dd](.*)$")
    if not rest or not (rest == "" or rest:match("^%s")) then return false end
    rest = rest:gsub("^%s+", ""):gsub("%s+$", "")
    if rest == "" then List(); return true end
    local code = rest:match("^[Cc][Ll][Ee][Aa][Rr]%s+(%S+)$")
    if code then
        code = code:upper()
        local raids = Raids()
        if raids and raids[code] then raids[code] = nil; Say("stopped tracking raid " .. code .. ".")
        else Say("no tracked raid " .. code .. ". |cffaaaaaa/kinv raid|r lists them.") end
        return true
    end
    Track(rest)
    return true
end
ns.RaidCommand = RaidCommand
