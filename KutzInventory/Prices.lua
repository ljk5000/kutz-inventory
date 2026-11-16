-- KutzInventory / Prices: what crafting materials and products cost, for the exporter's profit maths.
--
-- Account-wide, in KutzInventoryDB.prices:
--   vendor[itemID] = { price = copper per item, vendor = NPC name, limited = true|nil, t = time }   what a vendor sells it for
--   sell[itemID]   = copper per item                                                               what a vendor pays you (the game's sell price)
--   ah[house][itemID] = { p = {3 lowest unit prices}, q = {their quantities}, n = result rows seen, t = time }
--                    p empty = searched and none listed. An item that never answered is not stored at all.
--   ah[house][itemID] also has c, s = the item's class / subclass (C_Item.GetItemInfoInstant), for AH categories,
--                    e = the equip slot token for gear (INVTYPE_HEAD, ...), and name = the item's name from the
--                    whole-AH download (its first field; never the seller) or, if the game had not cached it, from
--   names[itemID]  = item names learned so far (account-wide), filled in after each whole-AH read.
--   scans[house]   = { startedAt, finishedAt, method = "full"|"search"|"legacy", complete, queued, answered,
--                      houseSource = "npc"|"zone"|"player", addonVersion, region,
--                      scope = "all"|"crafting", rows = listings in the whole-AH download }   the last scan of that house
--
-- /kinv ah: the whole-AH download (ReplicateItems), keeping the 3 cheapest of EVERY item. It replaces that house's
-- prices, since an item missing from it is not listed. Only the count, buyout and item ID of each listing are read,
-- never the seller. The game allows it about once every 15 minutes. /kinv ah slow: crafting items, one search each.
--   house = "<realm>|<alliance|horde|neutral>", e.g. "Example Realm|alliance" (realm as GetRealmName gives it)
--
-- Which auction house: the auctioneer's own faction (UnitFactionGroup("npc")), else the neutral towns by subzone
-- (Booty Bay, Gadgetzan, Everlook), else the character's faction. houseSource says which one decided.
-- Until 1.3.0, ah[itemID] had no house. On first load those prices move to "<realm>|<faction>" if every recorded
-- character shares one realm and faction (the scanner must have been one of them); otherwise they are dropped.
--
-- Vendor prices are recorded whenever you open a vendor. AH prices come from /kinv ah while the auction house is
-- open: it reads the whole AH in one go (the game allows that about every 15 minutes; otherwise, or with
-- /kinv ah slow, it searches item by item) for every material and product of every recipe your characters know (and the ones they could
-- learn), one item at a time at the pace the game allows, and keeps the 3 cheapest listings. Items a vendor always
-- has are skipped (the vendor price is used for those); limited-stock ones are scanned too. Nothing here runs unless a vendor or the AH is open.

local ADDON, ns = ...

local function Plain(v)
    if v == nil then return nil end
    if issecretvalue and issecretvalue(v) then return nil end
    return v
end
local function Try(fn, ...)
    if type(fn) ~= "function" then return nil end
    local ok, a, b, c, d, e, f, g, h, i, j, k, l = pcall(fn, ...)
    if ok then return a, b, c, d, e, f, g, h, i, j, k, l end
end
local function Say(msg) print("|cffd8b84aKutzInventory|r: " .. msg) end

-- Before 1.3.0 the AH prices were one account-wide table keyed by item ID. Move them to their house, if we can tell.
local function MigrateLegacyAH(p, chars)
    local legacy, count = {}, 0
    for k, v in pairs(p.ah) do
        if type(k) == "number" and type(v) == "table" then legacy[k] = v; count = count + 1 end
    end
    if count == 0 then return end
    for k in pairs(legacy) do p.ah[k] = nil end
    local realm, faction, same = nil, nil, true
    for _, c in pairs(chars or {}) do
        if type(c) == "table" then
            if realm == nil then realm, faction = c.realm, c.faction
            elseif c.realm ~= realm or c.faction ~= faction then same = false end
        end
    end
    if not (same and type(realm) == "string" and (faction == "Alliance" or faction == "Horde")) then return end
    local key = realm .. "|" .. string.lower(faction)
    local into = p.ah[key] or {}
    p.ah[key] = into
    local first, last = nil, 0
    for id, v in pairs(legacy) do
        if not into[id] or (into[id].t or 0) < (v.t or 0) then into[id] = v end
        local t = tonumber(v.t) or 0
        first = math.min(first or t, t); last = math.max(last, t)
    end
    if not p.scans[key] then
        p.scans[key] = { startedAt = first, finishedAt = last, method = "legacy", complete = false,
                         queued = count, answered = count, houseSource = "player" }
    end
end

local function P()
    local db = KutzInventoryDB
    if not db then return nil end
    db.prices = db.prices or {}
    local p = db.prices
    p.vendor, p.sell, p.ah, p.scans, p.names = p.vendor or {}, p.sell or {}, p.ah or {}, p.scans or {}, p.names or {}
    if not p.ahByHouse then
        MigrateLegacyAH(p, db.chars)
        p.ahByHouse = true
    end
    return p
end
ns.MigrateLegacyAH = MigrateLegacyAH       -- for the offline checks

---------------------------------------------------------------------------
-- which auction house this is
---------------------------------------------------------------------------
local NEUTRAL_TOWNS = { ["Booty Bay"] = true, ["Gadgetzan"] = true, ["Everlook"] = true }
local function DetectHouse()
    local npc = Plain(Try(UnitFactionGroup, "npc"))
    if npc == "Alliance" or npc == "Horde" then return string.lower(npc), "npc" end
    if npc == "Neutral" then return "neutral", "npc" end
    if NEUTRAL_TOWNS[Plain(Try(GetSubZoneText)) or ""] or NEUTRAL_TOWNS[Plain(Try(GetZoneText)) or ""] then
        return "neutral", "zone"
    end
    local me = Plain(Try(UnitFactionGroup, "player"))
    if me == "Alliance" or me == "Horde" then return string.lower(me), "player" end
    return nil, nil
end
ns.DetectHouse = DetectHouse

---------------------------------------------------------------------------
-- vendor sell prices (from the game's item info; it may need a moment to load an item)
---------------------------------------------------------------------------
local wantSell = {}
local function RecordSell(id)
    local p = P()
    if not (p and id) or p.sell[id] then return end
    local info = { Try(C_Item and C_Item.GetItemInfo or GetItemInfo, id) }
    local sellPrice = Plain(info[11])
    if type(sellPrice) == "number" then p.sell[id] = sellPrice; wantSell[id] = nil
    else
        wantSell[id] = true
        if C_Item and C_Item.RequestLoadItemDataByID then Try(C_Item.RequestLoadItemDataByID, id) end
    end
end

ns.RecordSell = function(id) if id then pcall(RecordSell, tonumber(id)) end end

---------------------------------------------------------------------------
-- every item a recipe uses or makes, over all characters
---------------------------------------------------------------------------
local function CraftItems()
    local ids, seen = {}, {}
    local function add(id) id = tonumber(id); if id and id > 0 and not seen[id] then seen[id] = true; ids[#ids + 1] = id end end
    local function reagents(list) for _, r in pairs(list or {}) do if type(r) == "table" then add(r.itemID) end end end
    for _, c in pairs((KutzInventoryDB or {}).chars or {}) do
        for _, book in pairs(c.recipes or {}) do
            for _, r in pairs(book.recipes or {}) do add(r.outputItemID); reagents(r.reagents) end
            for _, r in pairs(book.unlearned or {}) do add(r.outputItemID); reagents(r.reagents) end
        end
    end
    table.sort(ids)
    return ids
end

---------------------------------------------------------------------------
-- vendor buy prices: everything the open vendor sells for gold
---------------------------------------------------------------------------
local function ScanVendor()
    local p = P()
    if not (p and GetMerchantNumItems) then return end
    local npc = Plain(UnitName("npc"))
    for i = 1, (Try(GetMerchantNumItems) or 0) do
        local id = Plain(Try(GetMerchantItemID, i))
        local price, stack, available, extended
        local info = C_MerchantFrame and C_MerchantFrame.GetItemInfo and Try(C_MerchantFrame.GetItemInfo, i)
        if type(info) == "table" then
            price, stack, available, extended = info.price, info.stackCount, info.numAvailable, info.hasExtendedCost
        else
            local _, _, pr, st, av, _, _, ex = Try(GetMerchantItemInfo, i)
            price, stack, available, extended = pr, st, av, ex
        end
        price, stack = Plain(price), Plain(stack)
        if id and type(price) == "number" and price > 0 and not extended then
            local per = price / math.max(1, stack or 1)
            local old = p.vendor[id]
            if not old or per <= old.price or old.vendor == npc then          -- keep the cheapest vendor
                p.vendor[id] = { price = per, vendor = npc, limited = (Plain(available) or -1) >= 0 or nil, t = time() }
            end
            RecordSell(id)
        end
    end
end

---------------------------------------------------------------------------
-- the AH scan
---------------------------------------------------------------------------
local AH = C_AuctionHouse
local scan = { queue = nil, pos = 0, waitingFor = nil, waited = 0, found = 0, none = 0, timedOut = 0, open = false,
               full = nil,                               -- full = the whole-AH download in progress (see below)
               house = nil, houseSource = nil, houseKey = nil, method = nil, startedAt = nil }
local FULL_COOLDOWN = 15 * 60                            -- the game allows one whole-AH download about every 15 minutes
local FULL_ROWS_PER_FRAME = 4000                         -- reading the download a slice at a time, so the game doesn't stutter
local runner = CreateFrame("Frame")
runner:Hide()

local PRICE_SORT = { { sortOrder = (Enum and Enum.AuctionHouseSortOrder and Enum.AuctionHouseSortOrder.Price) or 0, reverseSort = false } }

-- The game's own item class / subclass (what the AH categories are built from) and, for gear, its equip slot
-- token (INVTYPE_HEAD, ...: how the AH splits Armor by slot). Instant: no server query.
local function ItemClass(id)
    local _, _, _, equipLoc, _, c, s = Try(C_Item and C_Item.GetItemInfoInstant, id)
    equipLoc = Plain(equipLoc)
    if type(equipLoc) ~= "string" or not equipLoc:match("^INVTYPE_[%u%d_]+$") or equipLoc == "INVTYPE_NON_EQUIP_IGNORE" then equipLoc = nil end
    return Plain(c), Plain(s), equipLoc
end

local function Save(id, prices, qtys, n, name, supply)
    local p = P()
    if not (p and scan.houseKey) then return end
    if name then p.names[id] = name else name = p.names[id] end       -- remembered across scans (see below)
    local into = p.ah[scan.houseKey] or {}
    p.ah[scan.houseKey] = into
    local c, s, e = ItemClass(id)
    into[id] = { p = prices, q = qtys, n = n, t = time(), c = c, s = s, e = e, name = name, supply = supply }
    if #prices > 0 then scan.found = scan.found + 1 else scan.none = scan.none + 1 end
end

---------------------------------------------------------------------------
-- item names. The whole-AH download only names items the game already has cached, so after a whole-AH read the
-- missing ones are requested (about 100 a second, only while some are missing) and remembered in prices.names.
-- The next scan uses them; the server keeps a name it already has when a later scan omits it.
---------------------------------------------------------------------------
local wantName, nameQueue, namer = {}, {}, nil
local function RecordName(id)
    local p = P()
    if not p then return true end
    local name = Plain(Try(C_Item and C_Item.GetItemNameByID, id))
    if type(name) ~= "string" or name == "" then return false end
    p.names[id], wantName[id] = name, nil
    for _, house in pairs(p.ah) do
        if type(house) == "table" and type(house[id]) == "table" and not house[id].name then house[id].name = name end
    end
    return true
end
local function QueueMissingNames(ids)
    local p = P()
    if not p then return end
    for _, id in ipairs(ids) do if not p.names[id] then nameQueue[#nameQueue + 1] = id end end
    if #nameQueue == 0 then return end
    if not namer then
        namer = CreateFrame("Frame")
        namer:SetScript("OnUpdate", function(self, elapsed)
            self.wait = (self.wait or 0) + elapsed
            if self.wait < 0.1 then return end
            self.wait = 0
            for _ = 1, 10 do
                local id = table.remove(nameQueue)
                if not id then self:Hide(); return end
                if not RecordName(id) then
                    wantName[id] = true
                    Try(C_Item and C_Item.RequestLoadItemDataByID, id)
                end
            end
        end)
    end
    namer:Show()
end

local function AddonVersion()
    local get = C_AddOns and C_AddOns.GetAddOnMetadata
    return Plain(Try(get, ADDON, "Version"))
end

local function ReadCommodity(id)
    local prices, qtys = {}, {}
    local n = Plain(Try(AH.GetNumCommoditySearchResults, id)) or 0
    for i = 1, math.min(n, 3) do
        local r = Try(AH.GetCommoditySearchResultInfo, id, i)
        if r and Plain(r.unitPrice) then prices[#prices + 1] = r.unitPrice; qtys[#qtys + 1] = Plain(r.quantity) or 1 end
    end
    Save(id, prices, qtys, n)
end

local function ReadItem(itemKey)
    local id = itemKey.itemID
    local rows = {}
    local n = Plain(Try(AH.GetNumItemSearchResults, itemKey)) or 0
    for i = 1, math.min(n, 50) do
        local r = Try(AH.GetItemSearchResultInfo, itemKey, i)
        local buyout, q = r and Plain(r.buyoutAmount), r and (Plain(r.quantity) or 1)
        if buyout and buyout > 0 and q and q > 0 then rows[#rows + 1] = { buyout / q, q } end
    end
    table.sort(rows, function(a, b) return a[1] < b[1] end)
    local prices, qtys = {}, {}
    for i = 1, math.min(#rows, 3) do prices[i] = math.floor(rows[i][1] + 0.5); qtys[i] = rows[i][2] end
    Save(id, prices, qtys, n)
end

-- stopped = the scan ended early (AH closed, or /kinv ah again). complete = every queued item answered.
local function Finish(why, stopped)
    runner:Hide()
    if scan.queue then
        local answered = scan.found + scan.none
        local p = P()
        if p and scan.houseKey then
            p.scans[scan.houseKey] = {
                startedAt = scan.startedAt, finishedAt = time(), method = scan.method,
                complete = (not stopped) and answered == #scan.queue, queued = #scan.queue, answered = answered,
                houseSource = scan.houseSource, addonVersion = AddonVersion(), region = Plain(Try(GetCurrentRegion)),
                scope = scan.all and "all" or "crafting", rows = scan.rows,
            }
        end
        if scan.all and not stopped then
            Say(string.format("whole AH read: %d listings, %d different items.", scan.rows or 0, scan.found))
        end
        Say(string.format("AH scan %s: %d of %d items checked, %d listed, %d not on the AH%s. Saved on /reload or logout.",
            why or "done", answered, #scan.queue, scan.found, scan.none,
            scan.timedOut > 0 and string.format(", %d gave no answer (not recorded)", scan.timedOut) or ""))
    end
    scan.queue, scan.waitingFor, scan.startedAt = nil, nil, nil
end

---------------------------------------------------------------------------
-- Fast way: download every listing on the AH at once (C_AuctionHouse.ReplicateItems, Blizzard's documented call
-- to "query the entire auction house"), then keep the 3 cheapest of each item we want. Seconds instead of minutes.
---------------------------------------------------------------------------
local function ReplicateRow(i)
    local name, _, count, _, _, _, _, _, _, buyout, _, _, _, _, _, _, itemID = AH.GetReplicateItemInfo(i)
    return count, buyout, itemID, name
end

local function FullStep()
    local f = scan.full
    if not f.total then
        if not f.readyAt then                                 -- still waiting for the download
            if GetTime() - f.started > 60 then return "timeout" end
            return
        end
        if GetTime() - f.readyAt < 1 then return end         -- let it settle
        f.total, f.i = Plain(Try(AH.GetNumReplicateItems)) or 0, 0
        if f.total == 0 then return "timeout" end
        scan.rows = f.total
    end
    local stop = math.min(f.total, f.i + FULL_ROWS_PER_FRAME)
    for i = f.i, stop - 1 do                                  -- the download is numbered from 0
        local ok, count, buyout, id, name = pcall(ReplicateRow, i)  -- count, buyout, item ID and item name: never the seller
        local readable = ok and type(id) == "number" and id >= 1 and id % 1 == 0
            and type(count) == "number" and count >= 1 and count % 1 == 0
            and (buyout == nil or (type(buyout) == "number" and buyout % 1 == 0))
        -- An unreadable listing is skipped and counted, never fatal: the rest of the download is still good.
        -- It does make the snapshot incomplete (see the end of the download below).
        if not readable then f.bad = (f.bad or 0) + 1 end
        if readable and (f.all or f.wanted[id]) and buyout and buyout > 0 then
            local unit = buyout / count
            -- Preserve every purchasable stack. Never reconstruct a stack's buyout from its rounded unit price.
            f.supply, f.lotKeys = f.supply or {}, f.lotKeys or {}
            local supply = f.supply[id] or { lots = {}, complete = true }
            f.supply[id], f.lotKeys[id] = supply, f.lotKeys[id] or {}
            local c = ItemClass(id)
            local variant = ""
            if c == 2 or c == 4 then
                local link = Plain(Try(AH.GetReplicateItemLink, i))
                variant = type(link) == "string" and link:match("(item:[%d:%-]+)") or "unknown"
            elseif c == nil then variant = "unknown" end
            local key = tostring(buyout) .. "/" .. tostring(count) .. "/" .. variant
            local lot = f.lotKeys[id][key]
            if lot then lot[3] = lot[3] + 1 else
                lot = { buyout, count, 1, variant }
                supply.lots[#supply.lots + 1], f.lotKeys[id][key] = lot, lot
            end
            local top = f.rows[id] or {}
            f.rows[id] = top
            f.listings[id] = (f.listings[id] or 0) + 1
            if not f.names[id] then name = Plain(name); if type(name) == "string" and name ~= "" then f.names[id] = name end end
            if #top < 3 or unit < top[#top][1] then           -- keep the 3 cheapest, cheapest first
                top[#top + 1] = { unit, count }
                table.sort(top, function(a, b) return a[1] < b[1] end)
                if #top > 3 then top[4] = nil end
            end
        end
    end
    f.i = stop
    if f.i < f.total then return end
    scan.badRows = f.bad or 0
    if scan.badRows > 0 and f.supply then
        for _, supply in pairs(f.supply) do supply.complete = false end
    end
    if f.all then
        -- the whole AH, every item: this replaces the house's prices (an item not in it is not listed now).
        -- With unreadable listings an absent item might just be unreadable, so keep the old prices instead.
        local p = P()
        if p and scan.houseKey and scan.badRows == 0 then p.ah[scan.houseKey] = {} end
        local ids = {}
        for id in pairs(f.rows) do ids[#ids + 1] = id end
        table.sort(ids)
        scan.queue = ids
    end
    for _, id in ipairs(scan.queue) do
        local prices, qtys = {}, {}
        for k, r in ipairs(f.rows[id] or {}) do prices[k] = math.ceil(r[1]); qtys[k] = r[2] end
        Save(id, prices, qtys, f.listings[id] or 0, f.names[id], f.supply and f.supply[id])
    end
    if f.all then QueueMissingNames(scan.queue) end
    return scan.badRows > 0 and "partial" or "done"
end

local StartSlow                                               -- the item-by-item search, below

runner:SetScript("OnUpdate", function(_, elapsed)
    if not scan.open then scan.full = nil; Finish("stopped (AH closed)", true); return end
    if scan.full then
        local ok, result = pcall(FullStep)
        if (not ok or result == "timeout") and scan.all then
            scan.full = nil
            Finish("stopped: the whole-AH download did not come (the game allows it about once every 15 minutes)", true)
        elseif not ok or result == "timeout" then
            scan.full = nil
            Say("the whole-AH download did not come (the game allows it about once every 15 minutes) - searching item by item instead.")
            StartSlow(scan.queue)
        elseif result == "done" then
            scan.full = nil
            Finish("done (whole AH read)")
        elseif result == "partial" then                       -- saved, but not marked complete
            scan.full = nil
            Finish(string.format("done, but %d listings could not be read (prices saved, scan marked incomplete)", scan.badRows), true)
        end
        return
    end
    if scan.waitingFor then
        scan.waited = scan.waited + elapsed
        if scan.waited < 4 then return end
        scan.timedOut = scan.timedOut + 1                   -- no answer: unknown, so nothing is recorded for it
        scan.waitingFor = nil
    end
    if AH.IsThrottledMessageSystemReady and not Try(AH.IsThrottledMessageSystemReady) then return end
    scan.pos = scan.pos + 1
    local id = scan.queue[scan.pos]
    if not id then Finish(); return end
    local key = Try(AH.MakeItemKey, id)
    if not key then return end
    scan.waitingFor, scan.waited = id, 0
    Try(AH.SendSearchQuery, key, PRICE_SORT, false)
    if scan.pos % 25 == 0 then Say(string.format("AH scan: %d / %d ...", scan.pos, #scan.queue)) end
end)

StartSlow = function(queue)
    scan.queue, scan.pos, scan.found, scan.none, scan.timedOut, scan.waitingFor = queue, 0, 0, 0, 0, nil
    scan.method, scan.startedAt = "search", scan.startedAt or time()
    Say(string.format("AH scan of %d crafting items, one search each (about %d s). /kinv ah again stops it.", #queue, math.ceil(#queue * 0.6)))
    runner:Show()
end

local function LastFull() local p = P(); return p and p.lastFull or 0 end
-- slow = item by item; all = the whole-AH download keeping every item (/kinv ah all), never item by item
local function StartAH(slow, all)
    if not (AH and AH.SendSearchQuery and AH.MakeItemKey) then Say("this client has no auction house functions for addons."); return end
    if not scan.open then Say("open the auction house first, then type /kinv ah."); return end
    if scan.queue then scan.full = nil; Finish("stopped", true); return end   -- /kinv ah again stops it
    if not scan.houseKey then Say("could not tell which auction house this is (realm or faction unknown)."); return end
    scan.all, scan.rows = all and true or false, nil
    if all then
        if not (AH.ReplicateItems and AH.GetNumReplicateItems and AH.GetReplicateItemInfo) then
            Say("this client cannot download the whole auction house."); return
        end
        local wait = FULL_COOLDOWN - (time() - LastFull())
        if wait > 0 then
            Say(string.format("the whole-AH download is available again in %d min (the game allows one about every 15 minutes). /kinv ah slow searches your crafting items one by one now.", math.ceil(wait / 60)))
            return
        end
        scan.startedAt, scan.method = time(), "full"
        scan.queue, scan.pos, scan.found, scan.none, scan.timedOut, scan.waitingFor = {}, 0, 0, 0, 0, nil
        scan.full = { all = true, wanted = {}, rows = {}, listings = {}, names = {}, started = GetTime() }
        P().lastFull = time()
        Try(AH.ReplicateItems)
        Say("reading the whole auction house, every item (a few seconds)...")
        runner:Show()
        return
    end
    scan.startedAt = time()
    local p = P()
    local queue = {}
    for _, id in ipairs(CraftItems()) do
        RecordSell(id)
        local v = p.vendor[id]
        if not v or v.limited then queue[#queue + 1] = id end  -- a vendor always has it: that price is used instead
    end
    if #queue == 0 then Say("no recipes recorded yet: open each profession window once (with \"show unlearned\" on), then try again."); return end
    local wait = FULL_COOLDOWN - (time() - LastFull())
    if slow or not (AH.ReplicateItems and AH.GetNumReplicateItems and AH.GetReplicateItemInfo) or wait > 0 then
        if not slow and wait > 0 and AH.ReplicateItems then
            Say(string.format("the fast whole-AH read is available again in %d min; searching item by item now.", math.ceil(wait / 60)))
        end
        StartSlow(queue)
        return
    end
    local wanted = {}
    for _, id in ipairs(queue) do wanted[id] = true end
    scan.queue, scan.pos, scan.found, scan.none, scan.timedOut, scan.waitingFor = queue, 0, 0, 0, 0, nil
    scan.method = "full"
    scan.full = { wanted = wanted, rows = {}, listings = {}, names = {}, started = GetTime() }
    P().lastFull = time()                                    -- remembered across /reload: the game's wait is too
    Try(AH.ReplicateItems)
    Say(string.format("reading the whole auction house for %d crafting items (a few seconds)...", #queue))
    runner:Show()
end
ns.StartAH = StartAH

---------------------------------------------------------------------------
-- events
---------------------------------------------------------------------------
local ev = CreateFrame("Frame")
for _, e in ipairs({ "MERCHANT_SHOW", "MERCHANT_UPDATE", "AUCTION_HOUSE_SHOW", "AUCTION_HOUSE_CLOSED",
                     "COMMODITY_SEARCH_RESULTS_UPDATED", "ITEM_SEARCH_RESULTS_UPDATED", "GET_ITEM_INFO_RECEIVED",
                     "REPLICATE_ITEM_LIST_UPDATE" }) do
    pcall(ev.RegisterEvent, ev, e)
end
local vendorPending = false
ev:SetScript("OnEvent", function(_, event, a)
    if event == "MERCHANT_SHOW" or event == "MERCHANT_UPDATE" then
        pcall(ScanVendor)                      -- capture ready rows now, even if the vendor closes before the retry
        if not vendorPending then
            vendorPending = true
            C_Timer.After(0.5, function() vendorPending = false; pcall(ScanVendor) end)
        end
    elseif event == "AUCTION_HOUSE_SHOW" then
        scan.open = true
        local house, source = DetectHouse()
        local realm = Plain(Try(GetRealmName))
        scan.house, scan.houseSource = house, source
        scan.houseKey = (house and type(realm) == "string" and realm ~= "") and (realm .. "|" .. house) or nil
    elseif event == "AUCTION_HOUSE_CLOSED" then scan.open = false
    elseif event == "COMMODITY_SEARCH_RESULTS_UPDATED" then
        if scan.waitingFor and a == scan.waitingFor then scan.waitingFor = nil; pcall(ReadCommodity, a) end
    elseif event == "ITEM_SEARCH_RESULTS_UPDATED" then
        if scan.waitingFor and type(a) == "table" and a.itemID == scan.waitingFor then scan.waitingFor = nil; pcall(ReadItem, a) end
    elseif event == "REPLICATE_ITEM_LIST_UPDATE" then
        if scan.full then scan.full.readyAt = GetTime() end
    elseif event == "GET_ITEM_INFO_RECEIVED" then
        if a and wantSell[a] then RecordSell(a) end
        if a and wantName[a] then RecordName(a) end
    end
end)
