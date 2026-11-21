-- KutzInventory: two shapes of the saved file that keep it small. Plain table work, no game API.
--
-- 1. Recipes not learned yet, saved once per account file (1.21.0). The profession window lists the same hundreds of
--    unlearned recipes for every character that has the profession, and each character used to keep its own copy
--    (734 kB of a 6.17 MB file on six characters). Now:
--      KutzInventoryDB.recipeBook[recipeID] = the record, once
--      chars[key].recipes[profession].unlearnedIds = { 461653, 461654, { recipeID = ..., ... }, ... }
--    A number means "the shared record of that recipe id"; a table is a record that differs from the shared one (kept
--    whole, so nothing is ever merged away). The list keeps the window's order. Learned recipes stay per character:
--    their link, difficulty and skill-up colour are the character's own.
--    Readers call ns.Saved.Unlearned(db, book); tools/convert.js writes the same export from either shape.
--
-- 2. Statistics per day (1.21.0): chars[key].statistics stays the newest full list; chars[key].statDays[day][id] is the
--    value a statistic had when it was seen changed on that day (day = days since 1970, UTC), for the last 30 days.

local ADDON, ns = ...

local Saved = {}
ns.Saved = Saved

Saved.STAT_DAYS = 30                           -- days of changed statistics kept per character
Saved.STAT_DAY_MAX = 400                       -- at most this many values in one day

-- the same value: same type, and for tables the same keys with the same values (records are small and shallow)
local function Same(a, b, depth)
    if a == b then return true end
    if type(a) ~= "table" or type(b) ~= "table" then return false end
    depth = depth or 0
    if depth > 8 then return false end
    for k, v in pairs(a) do if not Same(v, b[k], depth + 1) then return false end end
    for k in pairs(b) do if a[k] == nil then return false end end
    return true
end
Saved.Same = Same

local function RecipeId(u)
    local id = type(u) == "table" and u.recipeID
    if type(id) == "number" and id >= 1 and id == math.floor(id) then return id end
end

local function Books(db, fn)                    -- every character's every profession book
    for _, c in pairs(type(db.chars) == "table" and db.chars or {}) do
        if type(c) == "table" and type(c.recipes) == "table" then
            for _, book in pairs(c.recipes) do if type(book) == "table" then fn(book) end end
        end
    end
end

-- A list of unlearned records -> its saved form. The first record seen for an id becomes the shared one. A record that
-- differs from the shared one replaces it (the newer reading wins), and every list that meant the old one gets the old
-- record spelled out, so no list changes what it says. The same id twice in one list: the second is spelled out.
function Saved.Share(db, list)
    if type(db.recipeBook) ~= "table" then db.recipeBook = {} end
    local book, out, mine = db.recipeBook, {}, {}
    for i, u in ipairs(list) do
        local id = RecipeId(u)
        if not id or mine[id] then out[i] = u
        else
            local shared = book[id]
            if shared == nil then book[id] = u
            elseif not Same(shared, u) then
                Books(db, function(b)
                    local ids = b.unlearnedIds
                    if type(ids) == "table" then
                        for j = 1, #ids do if ids[j] == id then ids[j] = shared end end
                    end
                end)
                book[id] = u
            end
            out[i], mine[id] = id, true
        end
    end
    return out
end

-- A profession book's unlearned records, whichever way they are saved (a list that names a missing id skips it)
function Saved.Unlearned(db, book)
    if type(book) ~= "table" then return {} end
    local ids = book.unlearnedIds
    if type(ids) ~= "table" then return type(book.unlearned) == "table" and book.unlearned or {} end
    local shared, out = type(db) == "table" and type(db.recipeBook) == "table" and db.recipeBook or {}, {}
    for i = 1, #ids do
        local u = ids[i]
        if type(u) == "number" then u = shared[u] end
        if type(u) == "table" then out[#out + 1] = u end
    end
    return out
end

-- Shared records no list names any more are dropped
function Saved.Sweep(db)
    if type(db.recipeBook) ~= "table" then return end
    local used = {}
    Books(db, function(b)
        if type(b.unlearnedIds) == "table" then
            for _, u in ipairs(b.unlearnedIds) do if type(u) == "number" then used[u] = true end end
        end
    end)
    for id in pairs(db.recipeBook) do if not used[id] then db.recipeBook[id] = nil end end
    if next(db.recipeBook) == nil then db.recipeBook = nil end
end

-- Saved files from before 1.21.0: every book's own unlearned list becomes ids. Characters and professions in name
-- order, so the same file always migrates the same way. Returns how many lists it moved.
function Saved.MigrateRecipes(db)
    if type(db) ~= "table" or type(db.chars) ~= "table" then return 0 end
    local keys, moved = {}, 0
    for key, c in pairs(db.chars) do
        if type(c) == "table" and type(c.recipes) == "table" then keys[#keys + 1] = key end
    end
    table.sort(keys, function(a, b) return tostring(a) < tostring(b) end)
    for _, key in ipairs(keys) do
        local names = {}
        for name, book in pairs(db.chars[key].recipes) do
            if type(book) == "table" and type(book.unlearned) == "table" and book.unlearnedIds == nil then names[#names + 1] = name end
        end
        table.sort(names, function(a, b) return tostring(a) < tostring(b) end)
        for _, name in ipairs(names) do
            local book = db.chars[key].recipes[name]
            local n, dense = 0, true
            for k in pairs(book.unlearned) do n = n + 1 end
            for i = 1, n do if type(book.unlearned[i]) ~= "table" then dense = false end end
            if dense then                       -- holes, or entries that are not records: not a list the addon wrote, left as it is
                book.unlearnedIds = Saved.Share(db, book.unlearned)
                book.unlearned = nil
                moved = moved + 1
            end
        end
    end
    return moved
end

-- c: a character's saved table; list: the statistics just read ({ id, value, ... }); today: days since 1970.
-- Before c.statistics is replaced: the values that differ from the last list go under today. A first reading has
-- nothing to differ from and records no day.
function Saved.StatDays(c, list, today)
    if type(c) ~= "table" or type(list) ~= "table" or type(today) ~= "number" then return end
    local days = type(c.statDays) == "table" and c.statDays or nil
    if type(c.statistics) == "table" and #c.statistics > 0 then
        local old = {}
        for _, s in ipairs(c.statistics) do if type(s) == "table" and s.id ~= nil then old[s.id] = s.value end end
        local n = 0
        if days and type(days[today]) == "table" then for _ in pairs(days[today]) do n = n + 1 end end
        for _, s in ipairs(list) do
            local id, value = type(s) == "table" and s.id, type(s) == "table" and s.value
            if type(id) == "number" and (type(value) == "number" or type(value) == "string") and old[id] ~= value then
                if not days then days = {}; c.statDays = days end
                local day = days[today]
                if type(day) ~= "table" then day = {}; days[today] = day end
                if day[id] ~= nil or n < Saved.STAT_DAY_MAX then
                    if day[id] == nil then n = n + 1 end
                    day[id] = value
                end
            end
        end
    end
    Saved.PruneStatDays(c, today)
end

function Saved.PruneStatDays(c, today)
    if type(c) ~= "table" or type(c.statDays) ~= "table" then return end
    for day in pairs(c.statDays) do
        if type(day) ~= "number" or day <= today - Saved.STAT_DAYS or day > today then c.statDays[day] = nil end
    end
    if next(c.statDays) == nil then c.statDays = nil end
end
