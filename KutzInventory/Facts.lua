-- KutzInventory / Facts (1.21.0): what the game says about each item the player meets, read once, and how many of each
-- creature the player's group killed per day. Part of drop tracking: nothing is read or stored while /kinv track drops
-- is off, and everything lives in Observations.lua's saved table.
--
-- KutzInventoryObsDB.items[itemId] = {
--   d = day the entry's exported content last changed (days since 1970; first read, changed field/build, or new/changed variant),
--   m = day last met (days since 1970; saved-only for least-recently-met pruning, never exported),
--   b = index into KutzInventoryObsDB.itemBuilds (the game build the facts were read on, "1.60.1.71037"),
--   f = "quality:bind:class:subclass:itemLevel:requiredLevel:setId:equipLoc" (a part the client did not give is empty),
--   n = name (left out when the tooltip's first line is the name),
--   s = "ITEM_MOD_STAMINA_SHORT=3,RESISTANCE0_NAME=478" (GetItemStats, sorted by key),
--   t = the tooltip, one line of the string per text: the first character says what it is, "-" a line's left text,
--       "!" left text the client showed red (a requirement not met), ">" the right text of the line before, "]" red
--       right text; a line break inside a text is written "|n",
--   v = { ["<suffix id>;<bonus ids joined by :>"] = "<name>" .. "\n" .. "<stats>" }   one per random suffix met
-- }
-- A random-suffix item ("Soldier's Shield of Intellect") is ONE item, 6560, with a variant: never an item of its own.
-- On this client the suffix is a bonus id on the link (item:6560::::::::19:1489:::1:12729::::::: one bonus id, 12729), and
-- the link's older suffix field is empty; both are read, so "0;12729" is that variant's key.
--
-- Every read is made from a link built here from the item id and the suffix alone ("item:6560",
-- "item:6560::::::::::::1:12729"), never from the copy in the bag: no enchant, no gems, no crafter, no unique id, so the
-- facts are the item's and say nothing about anyone's copy.
-- Items are met by Observations.lua (loot, rolls, vendor stock, quest rewards: its ShortLink) and by KutzInventory.lua
-- (bags, bank, warband and guild bank, worn gear: its Item). A met item waits in a queue: one read per 0.25 s, none in
-- combat, none while the frame rate is under 20, a 10 s pause after a read that took over 8 ms, and the queue stops for
-- the session after three slow reads in a row. An item is read again when the game build changes, or when it was pruned
-- and is met again. The table is capped by its size in the saved file (see ITEMS.BYTES).
--
-- KutzInventoryObsDB.kills[day]["<npcId>:<level>"] = count: creatures that died in front of the player while the player
-- was fighting and that no other player had tapped (UNIT_HEALTH with UnitIsDead; level 0 = the client gave none). One
-- number per day, creature and level, not an event per kill, so a corpse nobody loots still counts. The corpse's GUID
-- is held in memory only, to count it once; nothing about any player is stored. 30 days, at most 800 numbers.
--
-- /kinv perf prints how much time this file used per frame (debugprofilestop), worst and average, and the queue's state.
-- /kinv dumpitem [link | id] saves the client's raw tooltip and stats answers for one item to KutzInventoryObsDB.debugItemDumps
-- (debugging; the newest 20; never exported), see "/kinv dumpitem" below.

local ADDON, ns = ...

local Facts = {}
ns.Facts = Facts

-- BYTES is the table's size in the saved file as this client writes it (Disk below). 200 kB is what sharing the
-- unlearned recipes freed on the six-character file this was sized on (275 kB), less the room the kill counts, the
-- statistics days and the vendor lists take: with a full table the file is no bigger than it was. About 730 items
-- (a material is some 115 bytes, a green piece of gear 300, an epic 650); raise it to hold more.
local ITEMS = { BYTES = 200000, MAX = 2500, STEP = 0.25, LINES = 60, LINE = 600, STATS = 30, VARIANTS = 24, TRIES = 3,
                QUEUE = 1000, MET = 6000, SLOW = 8, SLOW_STOP = 3, PAUSE = 10, FPS = 20 }
local KILLS = { DAYS = 30, MAX = 800, SEEN = 500 }
Facts.ITEMS, Facts.KILLS = ITEMS, KILLS

local PREFIX = "|cffd8b84aKutzInventory|r: "
local LF = string.char(10)

local function Plain(v)
    if issecretvalue and issecretvalue(v) then return nil end
    return v
end
local function Secret(v) return issecretvalue ~= nil and issecretvalue(v) and true or false end
local function Results(ok, ...) if ok then return ... end end
local function Try(fn, ...)                     -- every result of a call that may not exist or may fail
    if type(fn) ~= "function" then return nil end
    return Results(pcall(fn, ...))
end
local function False(fn, ...)                   -- the call plainly answered false (not nil, not a secret, not an error)
    if type(fn) ~= "function" then return false end
    local ok, v = pcall(fn, ...)
    return ok and not Secret(v) and v == false
end
local function Num(v) v = Plain(v); return type(v) == "number" and v or nil end
local function Int(v, min) v = Num(v); if v and v == math.floor(v) and v >= (min or 0) then return v end end
local function Day() return math.floor(time() / 86400) end

local function DB()                             -- the observations table, only while recording is on
    local d = KutzInventoryObsDB
    if type(d) == "table" and d.on and d.agreed then return d end
end

---------------------------------------------------------------------------
-- time used per frame
---------------------------------------------------------------------------
local perf = { frames = 0, total = 0, worst = 0, cur = 0, at = nil, reads = 0, slow = 0 }

local function Clock()
    if type(debugprofilestop) ~= "function" then return nil end
    local ok, v = pcall(debugprofilestop)
    if ok and type(v) == "number" then return v end
end
local function FlushFrame()
    if perf.cur > 0 then
        perf.frames, perf.total = perf.frames + 1, perf.total + perf.cur
        if perf.cur > perf.worst then perf.worst = perf.cur end
    end
    perf.cur = 0
end
local function Spent(t0)                        -- the time since t0 goes on the frame it was spent in (GetTime is per frame)
    local t1 = t0 and Clock()
    if not t1 then return 0 end
    local frame = Num(Try(GetTime))
    if frame ~= perf.at then FlushFrame(); perf.at = frame end
    perf.cur = perf.cur + (t1 - t0)
    return t1 - t0
end

---------------------------------------------------------------------------
-- links
---------------------------------------------------------------------------
-- "|cff1eff00|Hitem:6560::::::::19:1489:::1:12729::::::|h[...]|h|r" -> 6560, "0;12729". The second result is nil for a
-- copy with no suffix and no bonus ids. Fields: 1 id, 2 enchant, 3-6 gems, 7 suffix id, 8 unique id, 9 link level,
-- 10 specialization, 11 modifier mask, 12 context, 13 number of bonus ids, then the bonus ids.
local function Parse(link)
    if type(link) ~= "string" then return nil end
    local payload = link:match("|Hitem:([^|]+)|h") or link:match("^item:([^|]+)$")
    if not payload then return nil end
    local f, n = {}, 0
    for part in (payload .. ":"):gmatch("([^:]*):") do
        n = n + 1
        f[n] = part
        if n >= 30 then break end
    end
    local id = tonumber(f[1])
    if not id or id < 1 or id ~= math.floor(id) or id > 2147483647 then return nil end
    local suffix, count = tonumber(f[7]) or 0, tonumber(f[13]) or 0
    if suffix ~= math.floor(suffix) or math.abs(suffix) > 2147483647 then suffix = 0 end
    local bonus = {}
    if count >= 1 and count <= 16 and count == math.floor(count) then
        for i = 1, count do
            local b = tonumber(f[13 + i])
            if not b or b < 1 or b ~= math.floor(b) or b > 2147483647 then bonus = {}; break end
            bonus[i] = b
        end
        table.sort(bonus)
    end
    if suffix == 0 and #bonus == 0 then return id end
    for i = 1, #bonus do bonus[i] = string.format("%d", bonus[i]) end
    return id, string.format("%d", suffix) .. ";" .. table.concat(bonus, ":")
end
Facts.Parse = Parse

local function Tail(var)                        -- what follows "item:<id>" in the clean link of a variant
    local suffix, bonus = var:match("^(%-?%d+);([%d:]*)$")
    if not suffix then return "" end
    local count = 0
    for _ in bonus:gmatch("%d+") do count = count + 1 end
    return "::::::" .. (suffix ~= "0" and suffix or "") .. "::::::" .. (count > 0 and (count .. ":" .. bonus) or "")
end
local function CleanLink(id, var) return "item:" .. string.format("%d", id) .. (var and Tail(var) or "") end
Facts.CleanLink = CleanLink

---------------------------------------------------------------------------
-- the saved table and its size
---------------------------------------------------------------------------
-- The bytes a value takes in the saved file as this client writes it: no indentation, one value per line, CR LF.
--   ["key"] = value,     [123] = value,     a table is "{" ... "}"
local function Disk(v)
    local t = type(v)
    if t == "string" then
        local _, escaped = v:gsub('[%c"\\]', "")
        return #v + escaped + 2
    end
    if t == "number" then return #tostring(v) end
    if t ~= "table" then return 5 end
    local n = 4
    for k, x in pairs(v) do n = n + Disk(x) + 3 + (type(k) == "string" and #k + 7 or #tostring(k) + 5) end
    return n
end
Facts.Disk = Disk
local function EntryDisk(id, e) return #tostring(id) + 8 + Disk(e) end

local index = { items = nil, bytes = 0, count = 0 }

local function Items(d)                         -- d.items, with its size and count known
    if type(d.items) ~= "table" then d.items = {} end
    if index.items ~= d.items then
        index.items, index.bytes, index.count = d.items, 0, 0
        for id, e in pairs(d.items) do index.bytes, index.count = index.bytes + EntryDisk(id, e), index.count + 1 end
    end
    return d.items
end

local buildAt = nil                             -- this session's index into d.itemBuilds (0: the client gave no build)
local function Build(d)
    if buildAt and type(d.itemBuilds) == "table" and (buildAt == 0 or d.itemBuilds[buildAt]) then return buildAt end
    local version, build = Try(GetBuildInfo)
    version, build = Plain(version), Plain(build)
    if not (type(version) == "string" and version ~= "" and #version <= 20 and (type(build) == "string" or type(build) == "number")) then
        buildAt = 0
        if type(d.itemBuilds) ~= "table" then d.itemBuilds = {} end
        return 0
    end
    local b = version .. "." .. tostring(build)
    if type(d.itemBuilds) ~= "table" then d.itemBuilds = {} end
    for i, x in ipairs(d.itemBuilds) do if x == b then buildAt = i; return i end end
    d.itemBuilds[#d.itemBuilds + 1] = b
    buildAt = #d.itemBuilds
    return buildAt
end

local function MetDay(e)
    return type(e) == "table" and (Int(e.m) or Int(e.d)) or 0
end

local function Touch(e, today)
    local old = e.m
    if old == today then return end
    if old == nil then index.bytes = index.bytes + 11 + Disk(today)
    else index.bytes = index.bytes + Disk(today) - Disk(old) end
    e.m = today
end

local function BuildName(d, i)
    return type(d.itemBuilds) == "table" and Int(i, 1) and d.itemBuilds[i] or nil
end

local function SameItem(d, a, b)
    return BuildName(d, a.b) == BuildName(d, b.b) and a.f == b.f and a.n == b.n and a.s == b.s and a.t == b.t
end

-- Over a cap: the least recently met go first (then the lower id), down to 90% so it does not run on every read
local function PruneItems(d, headroom)
    local items = Items(d)
    local max, bytes = ITEMS.MAX, ITEMS.BYTES
    if headroom then max, bytes = math.floor(max * 0.9), math.floor(bytes * 0.9) end
    if index.count <= max and index.bytes <= bytes then return end
    local list = {}
    for id, e in pairs(items) do list[#list + 1] = { id = id, day = MetDay(e) } end
    table.sort(list, function(a, b)
        if a.day ~= b.day then return a.day < b.day end
        return tostring(a.id) < tostring(b.id)
    end)
    for _, x in ipairs(list) do
        if index.count <= max and index.bytes <= bytes then break end
        index.bytes, index.count = index.bytes - EntryDisk(x.id, items[x.id]), index.count - 1
        items[x.id] = nil
    end
end

local function Store(d, id, e)
    local items = Items(d)
    local old = items[id]
    if old ~= nil then index.bytes = index.bytes - EntryDisk(id, old) else index.count = index.count + 1 end
    items[id] = e
    index.bytes = index.bytes + EntryDisk(id, e)
    if index.count > ITEMS.MAX or index.bytes > ITEMS.BYTES then PruneItems(d, true) end
end

---------------------------------------------------------------------------
-- reading one item
---------------------------------------------------------------------------
local function Cut(s, max)                      -- at most max bytes, cut before a split UTF-8 character
    if #s <= max then return s end
    local i = max
    while i > 0 and s:byte(i + 1) >= 128 and s:byte(i + 1) < 192 do i = i - 1 end
    return s:sub(1, i)
end

local function Text(flag, v)                    -- one text of a tooltip line, or nil
    v = Plain(v)
    if type(v) ~= "string" or v == "" then return nil end
    v = v:gsub("\r", ""):gsub(LF, "|n")
    if v:gsub("[%s]", "") == "" then return nil end
    return flag .. Cut(v, ITEMS.LINE)
end

local function Red(c)                           -- the client's red: 1, 0.125, 0.125
    if Secret(c) or type(c) ~= "table" then return false end
    local r, g, b = Num(c.r), Num(c.g), Num(c.b)
    return r ~= nil and g ~= nil and b ~= nil and r > 0.9 and g < 0.3 and b < 0.3
end

local function Tooltip(link)                    -- -> the lines as one string, or nil
    local TI = C_TooltipInfo
    if not (TI and type(TI.GetHyperlink) == "function") then return nil end
    local data = Try(TI.GetHyperlink, link, nil, nil, true)   -- the last argument hides the vendor price line
    if Secret(data) or type(data) ~= "table" then return nil end
    local lines = data.lines
    if Secret(lines) or type(lines) ~= "table" then return nil end
    local out = {}
    for i = 1, math.min(#lines, ITEMS.LINES) do
        local line = lines[i]
        if not Secret(line) and type(line) == "table" then
            local left = Text(Red(line.leftColor) and "!" or "-", line.leftText)
            local right = Text(Red(line.rightColor) and "]" or ">", line.rightText)
            if left or right then
                out[#out + 1] = left or "-"
                if right then out[#out + 1] = right end
            end
        end
    end
    if #out == 0 then return nil end
    return table.concat(out, LF)
end

local function Stats(link)                      -- -> "KEY=3,KEY2=1.5" sorted by key, or nil
    local get = C_Item and C_Item.GetItemStats or GetItemStats
    local t = Try(get, link)
    if Secret(t) or type(t) ~= "table" then return nil end
    local keys = {}
    for k, v in pairs(t) do
        if type(k) == "string" and #k <= 60 and k:find("^[%u%d_]+$") and Num(v) then keys[#keys + 1] = k end
    end
    if #keys == 0 then return nil end
    table.sort(keys)
    local out = {}
    for i = 1, math.min(#keys, ITEMS.STATS) do
        local v = Num(t[keys[i]])
        out[i] = keys[i] .. "=" .. (v == math.floor(v) and string.format("%d", v) or string.format("%.2f", v))
    end
    return table.concat(out, ",")
end

local function Part(v) v = Int(v); return v and string.format("%d", v) or "" end

-- job = { id, var, name (the met link's own text, for a variant), tries }. true: stored; false: the client has not
-- loaded the item yet (asked for, try again); nil: this client cannot say.
local function Read(d, job)
    local info = C_Item and C_Item.GetItemInfo or GetItemInfo
    if type(info) ~= "function" then return nil end
    local link = CleanLink(job.id, job.var)
    local today, build = Day(), Build(d)
    local items = Items(d)
    if job.var then                             -- a random suffix of an item already read on this build
        local e = items[job.id]
        if type(e) ~= "table" or e.b ~= build then return false end
        local has = type(e.v) == "table" and type(e.v[job.var]) == "string" and e.v[job.var] or nil
        local count = 0
        if type(e.v) == "table" then for _ in pairs(e.v) do count = count + 1 end end
        if not has and count >= ITEMS.VARIANTS then return true end
        -- its name is the met link's own text; the client is asked only when the link had none (it may not answer
        -- for a link built here, and then the variant is not kept)
        local mine = type(job.name) == "string" and job.name ~= "" and job.name or Plain((Try(info, link)))
        if type(mine) ~= "string" or mine == "" then return false end
        mine = Cut((mine:gsub("[%c|]", "")), 120)
        if mine == "" then return nil end
        local stats = Stats(link) or ""
        -- A client that ignores the suffix on a link built here answers with the plain item's numbers: not this
        -- variant's, so they are left out rather than passed off as its own.
        if stats == (e.s or "") then stats = "" end
        local val = mine .. LF .. stats
        if has == val then
            Touch(e, today)
            return true
        end
        index.bytes = index.bytes - EntryDisk(job.id, e)
        if type(e.v) ~= "table" then e.v = {} end
        e.v[job.var] = val
        e.d = today
        e.m = today
        index.bytes = index.bytes + EntryDisk(job.id, e)
        if index.bytes > ITEMS.BYTES then PruneItems(d, true) end
        return true
    end
    local name, _, quality, level, req, _, _, _, slot, _, _, class, sub, bind, _, set = Try(info, link)
    name = Plain(name)
    if type(name) ~= "string" or name == "" then
        if C_Item and C_Item.RequestLoadItemDataByID then Try(C_Item.RequestLoadItemDataByID, job.id) end
        return false
    end
    name = Cut((name:gsub("[%c|]", "")), 120)
    slot = Plain(slot)
    slot = type(slot) == "string" and #slot <= 40 and slot:find("^[%u%d_]*$") and slot or ""
    local e = { d = today, m = today, b = build,
                f = table.concat({ Part(quality), Part(bind), Part(class), Part(sub), Part(level), Part(req), Part(set), slot }, ":") }
    e.s = Stats(link)
    local ok, tip = pcall(Tooltip, link)
    if ok and tip then e.t = tip end
    if not (e.t and e.t:sub(1, #name + 1) == "-" .. name and (#e.t == #name + 1 or e.t:sub(#name + 2, #name + 2) == LF)) then e.n = name end
    local old = items[job.id]
    if type(old) == "table" then
        if Int(old.d, 1) and SameItem(d, old, e) then
            e.d = old.d
            e.v = old.v
        elseif BuildName(d, old.b) == BuildName(d, e.b) and type(old.v) == "table" then
            e.v = old.v
        end
    end
    Store(d, job.id, e)
    return true
end

---------------------------------------------------------------------------
-- the queue
---------------------------------------------------------------------------
local met, metCount = {}, 0                     -- links seen this session (in memory): a bag scan costs one lookup each
local queue, head, tail, waiting, failed = {}, 1, 0, {}, {}   -- the jobs are queue[head .. tail] (never #queue: it has holes)
local running, stopped, slowRuns = false, nil, 0
local Step

local function Key(id, var) return var and (id .. "/" .. var) or id end

local function Busy()                           -- in combat, or no way to tell: nothing is read
    if type(InCombatLockdown) ~= "function" and type(UnitAffectingCombat) ~= "function" then return true end
    if type(InCombatLockdown) == "function" and not False(InCombatLockdown) then return true end
    if type(UnitAffectingCombat) == "function" and not False(UnitAffectingCombat, "player") then return true end
    return false
end

local function Kick(delay)
    if running or stopped or head > tail then return end
    if not (C_Timer and type(C_Timer.After) == "function") then return end
    running = true
    C_Timer.After(delay or ITEMS.STEP, Step)
end

local function Push(id, var, name)
    local key = Key(id, var)
    if waiting[key] or failed[key] then return true end
    if tail - head + 1 >= ITEMS.QUEUE then return false end
    tail = tail + 1
    queue[tail] = { id = id, var = var, name = name, tries = 0 }
    waiting[key] = true
    Kick()
    return true
end

local function Work()                           -- at most one read; returns the seconds until the next step
    local d = DB()
    if not d then queue, head, tail, waiting = {}, 1, 0, {}; return nil end   -- turned off: what waited is dropped
    if Busy() then return 2 end
    local fps = Num(Try(GetFramerate))
    if fps and fps > 0 and fps < ITEMS.FPS then return 2 end
    local job = queue[head]
    if not job then queue, head, tail = {}, 1, 0; return nil end
    queue[head] = nil
    head = head + 1
    if head > tail then queue, head, tail = {}, 1, 0 end
    local key = Key(job.id, job.var)
    local t0 = Clock()
    local done = Read(d, job)
    local t1 = t0 and Clock()
    local ms = t1 and (t1 - t0) or nil
    perf.reads = perf.reads + 1
    local again = ITEMS.STEP
    if done == false and job.tries < ITEMS.TRIES then
        job.tries = job.tries + 1
        tail = tail + 1
        queue[tail] = job
        again = 1
    else
        waiting[key] = nil
        if done ~= true then failed[key] = true end
    end
    if ms and ms > ITEMS.SLOW then
        perf.slow, slowRuns = perf.slow + 1, slowRuns + 1
        if slowRuns >= ITEMS.SLOW_STOP then stopped = "three reads in a row took over " .. ITEMS.SLOW .. " ms"; return nil end
        return ITEMS.PAUSE
    end
    slowRuns = 0
    return again
end

Step = function()
    running = false
    local t0 = Clock()
    local ok, again = pcall(Work)
    Spent(t0)
    if not ok then
        stopped = "an error"
        local d = KutzInventoryObsDB
        if type(d) == "table" then d.lastError = "facts: " .. tostring(again) end
        return
    end
    if again then Kick(again) end
end

-- An item link the player met (any copy). Cheap when the link was met before: one table lookup.
function Facts.Meet(link)
    if type(link) ~= "string" or met[link] then return end
    local d = DB()
    if not d then return end
    local t0 = Clock()
    local ok, err = pcall(function()
        local id, var = Parse(link)
        if not id then met[link] = true; return end
        local today, build = Day(), Build(d)
        local e = Items(d)[id]
        local kept = true
        if type(e) == "table" and e.b == build and Int(e.d, 1) then
            Touch(e, today)
            if var then
                local has = type(e.v) == "table" and type(e.v[var]) == "string" and e.v[var] or nil
                local name = link:match("|h%[([^%]|]+)%]|h")
                local cleanName = name and Cut((name:gsub("[%c|]", "")), 120) or ""
                if not has or (cleanName ~= "" and has:sub(1, #cleanName + 1) ~= cleanName .. LF) then
                    kept = Push(id, var, name)
                end
            end
        else
            kept = Push(id, nil)
            if var then kept = Push(id, var, link:match("|h%[([^%]|]+)%]|h")) and kept end
        end
        if kept then                            -- a full queue: the link is met again later
            if metCount >= ITEMS.MET then met, metCount = {}, 0 end
            met[link], metCount = true, metCount + 1
        end
    end)
    Spent(t0)
    if not ok then d.lastError = "facts meet: " .. tostring(err) end
end

-- For Observations.lua's ShortLink: meets the item and returns what its short link keeps of a random suffix ("" if none)
function Facts.Met(link)
    Facts.Meet(link)
    local id, var = Parse(link)
    return id and var and Tail(var) or ""
end

---------------------------------------------------------------------------
-- kills per day
---------------------------------------------------------------------------
local dead, deadCount = {}, 0                   -- corpse GUIDs counted, in memory only
local fighting, foughtAt = false, nil

local function InFight()                        -- the player is fighting, or stopped within the last 2 seconds
    if fighting then return true end
    if type(UnitAffectingCombat) == "function" then
        local v = Plain(Try(UnitAffectingCombat, "player"))
        if v == true then return true end
    end
    local now = Num(Try(GetTime))
    return foughtAt ~= nil and now ~= nil and now - foughtAt <= 2
end

local function PruneKills(kills, today, room)    -- room: make place for this many more numbers
    local days, total = {}, 0
    for day, list in pairs(kills) do
        if type(day) ~= "number" or type(list) ~= "table" or day <= today - KILLS.DAYS or day > today then kills[day] = nil
        else
            days[#days + 1] = day
            for _ in pairs(list) do total = total + 1 end
        end
    end
    table.sort(days)
    local i = 1
    while total > KILLS.MAX - (room or 0) and i < #days do   -- the oldest days go first; today always stays
        for _ in pairs(kills[days[i]]) do total = total - 1 end
        kills[days[i]] = nil
        i = i + 1
    end
    return total
end

local killCount, killDay = nil, nil             -- how many numbers kills holds, and the day it was last pruned for

-- UNIT_HEALTH(unit), from Observations.lua (never the player, a pet or a group member)
function Facts.Died(unit)
    if type(unit) ~= "string" or Plain(Try(UnitIsDead, unit)) ~= true then return end
    local d = DB()
    if not d then return end
    local t0 = Clock()
    local guid = Plain(Try(UnitGUID, unit))
    if type(guid) == "string" and not dead[guid] then
        local kind, id = guid:match("^(%a+)%-%d+%-%d+%-%d+%-%d+%-(%d+)%-%x+$")
        id = tonumber(id)
        if (kind == "Creature" or kind == "Vehicle") and id and id >= 1
           and False(UnitIsPlayer, unit) and False(UnitPlayerControlled, unit) and False(UnitIsTapDenied, unit) and InFight() then
            if deadCount >= KILLS.SEEN then dead, deadCount = {}, 0 end
            dead[guid], deadCount = true, deadCount + 1
            local today = Day()
            if type(d.kills) ~= "table" then d.kills = {} end
            if killDay ~= today or not killCount then killCount, killDay = PruneKills(d.kills, today), today end
            local list = d.kills[today]
            if type(list) ~= "table" then list = {}; d.kills[today] = list end
            local level = Int((Try(UnitLevel, unit)), 1)
            local key = string.format("%d:%d", id, level and level <= 255 and level or 0)
            if list[key] == nil then
                if killCount >= KILLS.MAX then killCount = PruneKills(d.kills, today, 1) end
                if killCount < KILLS.MAX then list[key], killCount = 1, killCount + 1 end
            else
                list[key] = (Int(list[key]) or 0) + 1
            end
            if type(ns.ObsPrefix) == "function" then pcall(ns.ObsPrefix, d) end   -- the install id the export names the counts by
        end
    end
    Spent(t0)
end

---------------------------------------------------------------------------
-- /kinv perf
---------------------------------------------------------------------------
local function Round(v) return math.floor(v * 100 + 0.5) / 100 end

function Facts.Perf()                           -- this session: { frames, worst, avg (ms per frame used), reads, slow }
    FlushFrame()
    return { frames = perf.frames, worst = Round(perf.worst), avg = perf.frames > 0 and Round(perf.total / perf.frames) or 0,
             reads = perf.reads, slow = perf.slow }
end

function Facts.Status()
    local d = KutzInventoryObsDB
    local on = type(d) == "table" and d.on and d.agreed
    local count, bytes, kills = 0, 0, 0
    if type(d) == "table" and type(d.items) == "table" then Items(d); count, bytes = index.count, index.bytes end
    if type(d) == "table" and type(d.kills) == "table" and type(d.kills[Day()]) == "table" then
        for _, n in pairs(d.kills[Day()]) do kills = kills + (Int(n) or 0) end
    end
    local p = Facts.Perf()
    local state = not on and "off (drop tracking is off)" or stopped and ("stopped for this session: " .. stopped)
                  or (tail - head + 1) .. " waiting"
    return string.format("item facts: %d held (%d of %d kB), %s, %d read this session. Kills counted today: %d.",
                         count, math.floor(bytes / 1000 + 0.5), math.floor(ITEMS.BYTES / 1000), state, p.reads, kills),
           Clock() and string.format("time used per frame by item facts and kill counts: worst %.2f ms, average %.2f ms, over %d frames; %d slow reads (over %d ms).",
                                     p.worst, p.avg, p.frames, p.slow, ITEMS.SLOW)
           or "this client has no debugprofilestop: the time used cannot be measured."
end

---------------------------------------------------------------------------
-- /kinv dumpitem [item link | item id]: a debugging aid. What the client answers for one item, written to the saved file
-- (print goes to chat, which /chatlog does not keep). KutzInventoryObsDB.debugItemDumps = { oldest first, at most 20 of
-- { at, date, build, source = "mouse"|"argument", given, hyperlink, id, tooltip, tooltipFull, stats, errors } }.
-- Never exported: convert.js reads the observations only by name (events, npcs, items, kills); tools/convert.test.js checks.
-- Values the client answers are copied as they are (a secret one as the text "<secret>"); no arithmetic, no comparison.
---------------------------------------------------------------------------
local DUMP = { KEEP = 20, NODES = 4000, DEPTH = 10, TEXT = 2000 }
Facts.DUMP = DUMP

local function Copy(v, depth, budget)                -- a plain copy of what the client answered, or "<secret>"
    if Secret(v) then return "<secret>" end
    local t = type(v)
    if t == "string" then return Cut(v, DUMP.TEXT) end
    if t == "boolean" then return v end
    if t == "number" then
        if v ~= v or v == math.huge or v == -math.huge then return tostring(v) end   -- the saved file cannot hold these
        return v
    end
    if t ~= "table" then return nil end              -- functions and userdata are not data
    if depth >= DUMP.DEPTH or budget.n >= DUMP.NODES then budget.cut = true; return "<cut>" end
    local out = {}
    for k, x in pairs(v) do
        if not Secret(k) and (type(k) == "string" or type(k) == "number") then
            budget.n = budget.n + 1
            if budget.n > DUMP.NODES then budget.cut = true; break end
            out[type(k) == "string" and Cut(k, 200) or k] = Copy(x, depth + 1, budget)
        end
    end
    return out
end

local function Dumped(fn, ...)                       -- -> the copy of the call's answer (nil when it answered nothing), or nil and the error
    if type(fn) ~= "function" then return nil, "no such function" end
    local ok, v = pcall(fn, ...)
    if not ok then return nil, "error: " .. Cut(tostring(Plain(v) or "?"), 200) end
    if not Secret(v) and v == nil then return nil, "answered nothing" end
    local budget = { n = 0 }
    local ok2, copy = pcall(Copy, v, 0, budget)
    if not ok2 then return nil, "copy failed: " .. Cut(tostring(Plain(copy) or "?"), 200) end
    if budget.cut and type(copy) == "table" then copy.cut = true end
    return copy
end

-- The item under the mouse: its link, or nil.
local function MouseLink()
    local tip = GameTooltip
    if type(tip) ~= "table" or type(tip.GetItem) ~= "function" then return nil end
    local ok, _, link = pcall(tip.GetItem, tip)
    link = ok and Plain(link) or nil
    return type(link) == "string" and link ~= "" and link or nil
end

function Facts.DumpItem(arg)
    local given, source = "", "argument"
    if type(arg) == "string" then given = arg:gsub("^%s+", ""):gsub("%s+$", "") end
    if given == "" then given, source = MouseLink(), "mouse" end
    if not given then
        print(PREFIX .. "no item under the mouse. Hover an item and type /kinv dumpitem, or /kinv dumpitem <item link or item id>.")
        return true
    end
    local id = given:match("^%d+$")
    local hyperlink = id and ("item:" .. id) or given:match("|H(item:[^|]*)|h") or given:match("^(item:[%w:%-]*)$")
    if not hyperlink then
        print(PREFIX .. "that is not an item link or item id.")
        return true
    end
    local TI = type(C_TooltipInfo) == "table" and C_TooltipInfo or {}
    local errors = {}
    local dump = { at = time(), date = Plain(Try(date, "%Y-%m-%d %H:%M:%S")), source = source, given = Cut(given, 600),
                   hyperlink = Cut(hyperlink, 300) }
    local version, build = Try(GetBuildInfo)
    version, build = Plain(version), Plain(build)
    if type(version) == "string" and (type(build) == "string" or type(build) == "number") then dump.build = version .. "." .. tostring(build) end
    local get = C_Item and C_Item.GetItemStats or GetItemStats
    if id then
        dump.id = tonumber(id)
        dump.tooltip, errors.tooltip = Dumped(TI.GetItemByID, tonumber(id))
    else
        -- as the item facts read it (the last argument hides the vendor price line), and as the client gives it by default
        dump.tooltip, errors.tooltip = Dumped(TI.GetHyperlink, hyperlink, nil, nil, true)
        dump.tooltipFull, errors.tooltipFull = Dumped(TI.GetHyperlink, hyperlink)
    end
    dump.stats, errors.stats = Dumped(get, hyperlink)
    if next(errors) then dump.errors = errors end

    local d = KutzInventoryObsDB
    if type(d) ~= "table" then d = { v = 1 }; KutzInventoryObsDB = d end
    if type(d.debugItemDumps) ~= "table" then d.debugItemDumps = {} end
    local list = d.debugItemDumps
    list[#list + 1] = dump
    while #list > DUMP.KEEP do table.remove(list, 1) end
    print(PREFIX .. "item dump " .. #list .. " of at most " .. DUMP.KEEP .. " saved (" .. Cut(hyperlink, 60) .. "); /reload to write it to disk")
    return true
end

function Facts.Command(msg)
    if type(msg) ~= "string" then return false end
    local text = msg:gsub("^%s+", ""):gsub("%s+$", "")
    if text:lower() == "perf" then
        local a, b = Facts.Status()
        print(PREFIX .. a)
        print("  " .. b)
        return true
    end
    local word, rest = text:match("^(%S+)%s*(.*)$")
    if word and word:lower() == "dumpitem" then return Facts.DumpItem(rest) end
    return false
end

---------------------------------------------------------------------------
-- events: fighting or not (for the kill counts), and the session's numbers on the way out
---------------------------------------------------------------------------
local frame = type(CreateFrame) == "function" and CreateFrame("Frame") or nil
if frame then
    for _, e in ipairs({ "PLAYER_REGEN_DISABLED", "PLAYER_REGEN_ENABLED", "PLAYER_LOGOUT" }) do pcall(frame.RegisterEvent, frame, e) end
    frame:SetScript("OnEvent", function(_, event)
        if event == "PLAYER_REGEN_DISABLED" then fighting = true
        elseif event == "PLAYER_REGEN_ENABLED" then fighting, foughtAt = false, Num(Try(GetTime))
        elseif event == "PLAYER_LOGOUT" then
            local d = KutzInventoryObsDB
            local p = Facts.Perf()
            if type(d) == "table" and p.frames > 0 then
                d.perf = { day = Day(), frames = p.frames, worst = p.worst, avg = p.avg, reads = p.reads, slow = p.slow }
            end
        end
    end)
end
