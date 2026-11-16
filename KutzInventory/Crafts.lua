-- KutzInventory / Crafts: counts the items this character creates, at the moment the game says so.
--
-- The game keeps no "items crafted" statistic, and the bag snapshot at /reload or logout misses anything that was
-- made and then sold, mailed, used or disenchanted before it. So each "You create: ..." line in the loot chat is
-- counted when it arrives. Always on (it is your own activity, like your bags); it is not part of /kinv track and
-- writes nothing to KutzInventoryObsDB.
--
-- On this character's entry in KutzInventoryDB.chars:
--   crafted = { since = time() when counting began (crafts before that are unknown),
--               total = items created since then,
--               items = { [itemId] = { count = items made, crafts = "You create" lines, name = "Item Name", lastAt = time() } },
--               days  = { ["YYYY-MM-DD"] = { [itemId] = items made that day } } }      -- your local date, newest 120 days
-- Every "You create" line counts, a profession craft or conjured food alike; cr0m decides what to show.
-- Only your own lines: "<Name> creates: ..." (someone near you) never matches.

local ADDON, ns = ...

local KEEP_DAYS = 120

local function Plain(v)
    if v == nil then return nil end
    if issecretvalue and issecretvalue(v) then return nil end
    return v
end

-- the client's own format strings (any language); the stack form first, because the single form also fits its text
local CREATE_FORMATS = {                        -- global name, has a count?, English fallback
    { "LOOT_ITEM_CREATED_SELF_MULTIPLE", true, "You create: %sx%d." },
    { "LOOT_ITEM_CREATED_SELF", false, "You create: %s." },
}
local createPatterns

-- "You create: %sx%d." -> "^You create: (.+)x(%d+)%.$" and which argument each capture is
-- (translations may reorder them as %2$s). The same reading as Raids.lua's loot lines.
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

local function CreatePatterns()
    if createPatterns then return createPatterns end
    createPatterns = {}
    for _, f in ipairs(CREATE_FORMATS) do
        local fmt = _G[f[1]]
        if type(fmt) ~= "string" or fmt == "" then fmt = f[3] end
        local pat, order = FormatPattern(fmt)
        createPatterns[#createPatterns + 1] = { pat = pat, order = order, count = f[2] }
    end
    return createPatterns
end

-- one of your own "You create" lines -> item link, count; nil for every other line
local function ParseCreate(text)
    if type(text) ~= "string" then return nil end
    for _, p in ipairs(CreatePatterns()) do
        local caps = { text:match(p.pat) }
        if caps[1] then
            local args = {}
            for n, which in ipairs(p.order) do args[which] = caps[n] end
            local link, count = args[1], p.count and tonumber(args[2]) or 1
            if link and count and count >= 1 then return link, count end
        end
    end
end
ns.ParseCreate = ParseCreate

-- keep the newest KEEP_DAYS days ("YYYY-MM-DD" sorts as text)
local function PruneDays(days)
    local keys = {}
    for k in pairs(days) do
        if type(k) == "string" then keys[#keys + 1] = k else days[k] = nil end
    end
    table.sort(keys)
    for n = 1, #keys - KEEP_DAYS do days[keys[n]] = nil end
end

local function Record(link, count)
    local itemId = tonumber(link:match("item:(%d+)"))
    local me = ns.Me and ns.Me()                -- this character's entry (KutzInventory.lua), there from PLAYER_LOGIN on
    if not itemId or type(me) ~= "table" then return end
    local now = time()
    if type(me.crafted) ~= "table" then me.crafted = { since = now, total = 0, items = {}, days = {} } end
    local c = me.crafted
    if type(c.items) ~= "table" then c.items = {} end
    if type(c.days) ~= "table" then c.days = {} end
    c.since = c.since or now
    c.total = (tonumber(c.total) or 0) + count

    local it = c.items[itemId]
    if type(it) ~= "table" then it = { count = 0, crafts = 0 }; c.items[itemId] = it end
    it.count = (tonumber(it.count) or 0) + count
    it.crafts = (tonumber(it.crafts) or 0) + 1
    it.name = link:match("|h%[(.+)%]|h") or it.name
    it.lastAt = now

    local day = date("%Y-%m-%d")
    if type(day) ~= "string" then return end
    local d = c.days[day]
    if type(d) ~= "table" then
        d = {}
        c.days[day] = d
        PruneDays(c.days)
    end
    d[itemId] = (tonumber(d[itemId]) or 0) + count
end

-- one line for /kinv's list of what is recorded
function ns.CraftedLine(c)
    local crafted = type(c) == "table" and c.crafted
    if type(crafted) ~= "table" or type(crafted.since) ~= "number" then
        return "      items crafted: none counted yet (each one is counted as you make it)"
    end
    local kinds = 0
    for _ in pairs(crafted.items or {}) do kinds = kinds + 1 end
    return string.format("      items crafted: %d (%d different), counted since %s", tonumber(crafted.total) or 0, kinds,
        tostring(date("%Y-%m-%d", crafted.since)))
end

local ev = CreateFrame("Frame")
pcall(ev.RegisterEvent, ev, "CHAT_MSG_LOOT")
ev:SetScript("OnEvent", function(_, event, text)
    if event ~= "CHAT_MSG_LOOT" then return end
    local link, count = ParseCreate(Plain(text))
    if not link then return end
    local ok, err = pcall(Record, link, count)
    if not ok and type(KutzInventoryDB) == "table" then KutzInventoryDB.lastError = "crafts: " .. tostring(err) end
end)
