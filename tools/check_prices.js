// Offline check for KutzInventory/Prices.lua: AH prices stored per auction house, the scan record, the
// pre-1.3.0 migration rule, and that an item which never answered is not recorded as "none listed".
"use strict";
const fs = require("fs");
const path = require("path");
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require("fengari");

const source = fs.readFileSync(path.join(__dirname, "..", "KutzInventory", "Prices.lua"), "utf8");

const code = `
local function fresh(env)
  -- a tiny fake game; env overrides per case
  local frames, clock, now = {}, 0, 1700000000
  local G = {}
  setmetatable(G, { __index = _G })
  G.CreateFrame = function()
    local f = { scripts = {} }
    function f:SetScript(n, fn) self.scripts[n] = fn end
    function f:RegisterEvent() return true end
    function f:Show() self.shown = true end
    function f:Hide() self.shown = false end
    frames[#frames + 1] = f
    return f
  end
  G.C_Timer = { After = function() end }
  G.GetTime = function() return clock end
  G.time = function() return now end
  G.print = function() end
  G.GetRealmName = function() return env.realm end
  G.GetCurrentRegion = function() return 1 end
  G.UnitFactionGroup = function(u) if u == "npc" then return env.npc end return env.player end
  G.GetSubZoneText = function() return env.subzone or "" end
  G.GetZoneText = function() return env.zone or "" end
  G.C_AddOns = { GetAddOnMetadata = function() return "1.3.0" end }
  G.C_Item = { GetItemInfo = function(id) local v = env.sell and env.sell[id]; if v then return "Item " .. id, nil, nil, nil, nil, nil, nil, nil, nil, nil, v end return nil end, RequestLoadItemDataByID = function(id) env.requested = env.requested or {}; env.requested[id] = true end,
                GetItemNameByID = function(id) return env.cache and env.cache[id] end,
                GetItemInfoInstant = function(id) if id == 9999 then return id, "Armor", "Plate", "INVTYPE_HEAD", 0, 4, 4 end return id, "Trade Goods", "Herb", "", 0, 7, 9 end }
  local queries = {}
  G.C_AuctionHouse = {
    SendSearchQuery = function(key) queries[#queries + 1] = key.itemID end,
    MakeItemKey = function(id) return { itemID = id } end,
    IsThrottledMessageSystemReady = function() return true end,
    GetNumCommoditySearchResults = function(id) return #(env.listings[id] or {}) end,
    GetCommoditySearchResultInfo = function(id, i) local l = env.listings[id][i]; return { unitPrice = l[1], quantity = l[2] } end,
    ReplicateItems = env.replicate and function() end or nil,
    GetNumReplicateItems = env.replicate and function() return #env.replicate end or nil,
    GetReplicateItemLink = function(i) local r = env.replicate and env.replicate[i + 1]; return r and r[4] end,
    GetReplicateItemInfo = env.replicate and function(i)
      local r = env.replicate[i + 1]
      return (r[1] ~= 4321) and ("Item " .. r[1]) or nil, nil, r[2], nil, nil, nil, nil, nil, nil, r[3], nil, "SomeBidder", nil, "SomeSeller", "SomeSeller-Realm", nil, r[1]
    end or nil,
  }
  G.KutzInventoryDB = env.db
  local chunk = assert(load(${JSON.stringify("")} .. [=====[${source}]=====], "@Prices.lua", "t", G))
  local ns = {}
  chunk("KutzInventory", ns)
  local runner, ev = frames[1], frames[2]
  local h = { ns = ns, G = G, queries = queries }
  function h.event(name, a) ev.scripts.OnEvent(ev, name, a) end
  function h.tick(dt) clock = clock + (dt or 0.1); if runner.shown then runner.scripts.OnUpdate(runner, dt or 0.1) end end
  function h.running() return runner.shown end
  function h.later(s) now = now + s end
  function h.frames() return frames end
  return h
end

local function recipeDB(chars, ah)
  return { chars = chars, prices = { vendor = {}, sell = {}, ah = ah or {} } }
end
local function char(realm, faction, items)
  local reagents = {}
  for i, id in ipairs(items) do reagents[i] = { itemID = id, quantity = 1 } end
  return { realm = realm, faction = faction, recipes = { Tailoring = { recipes = { { recipeID = 1, outputItemID = 9000, reagents = reagents } } } } }
end
local REALM = "Example Realm"

-- 1) migration: one realm + one faction -> moved to that house, with a "legacy" scan record
do
  local db = recipeDB({ a = char(REALM, "Alliance", {}), b = char(REALM, "Alliance", {}) },
                      { [2589] = { p = { 10 }, q = { 5 }, n = 1, t = 100 }, [2996] = { p = {}, q = {}, n = 0, t = 200 } })
  local h = fresh({ db = db, realm = REALM, player = "Alliance", npc = "Alliance", listings = {} })
  h.event("MERCHANT_SHOW")                                     -- any access to the price tables migrates
  local key = REALM .. "|alliance"
  assert(db.prices.ah[2589] == nil and db.prices.ah[2996] == nil, "legacy entries were left in place")
  assert(db.prices.ah[key] and db.prices.ah[key][2589].p[1] == 10, "legacy entries did not move to " .. key)
  local s = db.prices.scans[key]
  assert(s and s.method == "legacy" and s.complete == false and s.houseSource == "player" and s.startedAt == 100 and s.finishedAt == 200, "legacy scan record")
end
-- 1b) mixed factions -> dropped
do
  local db = recipeDB({ a = char(REALM, "Alliance", {}), b = char(REALM, "Horde", {}) }, { [2589] = { p = { 10 }, q = { 5 }, n = 1, t = 100 } })
  local h = fresh({ db = db, realm = REALM, player = "Alliance", npc = "Alliance", listings = {} })
  h.event("MERCHANT_SHOW")
  assert(next(db.prices.ah) == nil, "legacy prices from mixed factions were kept")
  assert(next(db.prices.scans) == nil, "a scan record was made for dropped prices")
end

-- 2) which house
do
  local h = fresh({ db = recipeDB({}), realm = REALM, player = "Alliance", npc = "Horde", listings = {} })
  local house, src = h.ns.DetectHouse(); assert(house == "horde" and src == "npc", "npc faction: " .. tostring(house) .. "/" .. tostring(src))
  h = fresh({ db = recipeDB({}), realm = REALM, player = "Alliance", npc = nil, subzone = "Booty Bay", listings = {} })
  house, src = h.ns.DetectHouse(); assert(house == "neutral" and src == "zone", "neutral town: " .. tostring(house) .. "/" .. tostring(src))
  h = fresh({ db = recipeDB({}), realm = REALM, player = "Horde", npc = nil, listings = {} })
  house, src = h.ns.DetectHouse(); assert(house == "horde" and src == "player", "player fallback: " .. tostring(house) .. "/" .. tostring(src))
end

-- 3) item-by-item: one listed, one none listed, one that never answers
do
  local db = recipeDB({ a = char(REALM, "Horde", { 100, 200, 300 }) })
  local listings = { [100] = { { 50, 3 }, { 60, 1 } }, [200] = {} }
  local h = fresh({ db = db, realm = REALM, player = "Horde", npc = "Horde", listings = listings })
  h.event("AUCTION_HOUSE_SHOW")
  h.ns.StartAH(true)
  local guard = 0
  while h.running() and guard < 500 do
    guard = guard + 1
    local before = #h.queries
    h.tick(0.1)
    if #h.queries > before then
      local id = h.queries[#h.queries]
      if id ~= 300 then h.event("COMMODITY_SEARCH_RESULTS_UPDATED", id) end      -- 300 never answers; 9000 (the product) has none listed
    end
  end
  local key = REALM .. "|horde"
  local ah, s = db.prices.ah[key], db.prices.scans[key]
  assert(ah and ah[100] and ah[100].p[1] == 50 and ah[100].q[1] == 3, "listed item not stored under the house")
  assert(ah[200] and #ah[200].p == 0, "searched-and-none-listed item not stored as p = {}")
  assert(ah[300] == nil, "an item that never answered was recorded")
  assert(ah[9000] and #ah[9000].p == 0, "the product was searched and none listed")
  assert(s and s.method == "search" and s.complete == false and s.queued == 4 and s.answered == 3, "scan record after timeouts: " .. tostring(s and s.answered))
  assert(s.houseSource == "npc" and s.addonVersion == "1.3.0" and s.region == 1 and s.startedAt and s.finishedAt, "scan record fields")
end

-- 4) the whole-AH download: every queued item answers, so the scan is complete
do
  local db = recipeDB({ a = char(REALM, "Alliance", { 100, 200 }) })
  local h = fresh({ db = db, realm = REALM, player = "Alliance", npc = "Alliance", listings = {},
                    replicate = { { 100, 2, 100 }, { 100, 1, 70 }, { 555, 1, 1 } } })      -- {itemID, count, buyout}
  h.event("AUCTION_HOUSE_SHOW")
  h.ns.StartAH(false)
  h.event("REPLICATE_ITEM_LIST_UPDATE")
  for _ = 1, 40 do if h.running() then h.tick(0.1) end end
  local key = REALM .. "|alliance"
  local ah, s = db.prices.ah[key], db.prices.scans[key]
  assert(ah and ah[100] and ah[100].p[1] == 50 and ah[100].p[2] == 70 and ah[100].n == 2, "full scan prices: " .. tostring(ah and ah[100] and ah[100].p[1]))
  assert(ah[200] and #ah[200].p == 0 and ah[555] == nil, "full scan: absent wanted item is none listed; unwanted item ignored")
  assert(s and s.method == "full" and s.complete == true and s.queued == 3 and s.answered == 3, "full scan record")
end

-- 5) a scan stopped by closing the AH is not complete
do
  local db = recipeDB({ a = char(REALM, "Alliance", { 100, 200 }) })
  local h = fresh({ db = db, realm = REALM, player = "Alliance", npc = "Alliance", listings = { [100] = { { 5, 1 } } } })
  h.event("AUCTION_HOUSE_SHOW"); h.ns.StartAH(true)
  h.tick(0.1); h.event("COMMODITY_SEARCH_RESULTS_UPDATED", h.queries[#h.queries])
  h.event("AUCTION_HOUSE_CLOSED"); h.tick(0.1)
  local s = db.prices.scans[REALM .. "|alliance"]
  assert(s and s.complete == false and s.answered == 1, "stopped scan should be incomplete")
end
-- 6) /kinv ah all: every item from the whole-AH download, replacing the house's prices, with class / subclass
do
  local key = REALM .. "|alliance"
  local db = recipeDB({ a = char(REALM, "Alliance", { 100 }) }, { [key] = { [777] = { p = { 1 }, q = { 1 }, n = 1, t = 1 } } })
  db.prices.ahByHouse = true
  local h = fresh({ db = db, realm = REALM, player = "Alliance", npc = "Alliance", listings = {},
                    replicate = { { 100, 2, 100 }, { 555, 1, 30 }, { 555, 4, 80 }, { 9999, 1, 5 } } })
  h.event("AUCTION_HOUSE_SHOW")
  h.ns.StartAH(false, true)
  h.event("REPLICATE_ITEM_LIST_UPDATE")
  for _ = 1, 40 do if h.running() then h.tick(0.1) end end
  local ah, s = db.prices.ah[key], db.prices.scans[key]
  assert(ah[777] == nil, "a whole-AH read must replace the house's older prices")
  assert(ah[555] and ah[555].p[1] == 20 and ah[555].p[2] == 30 and ah[555].n == 2, "every item is kept, not only crafting ones")
  assert(ah[9999] and ah[100] and ah[100].p[1] == 50, "all items stored")
  assert(ah[555].c == 7 and ah[555].s == 9, "item class / subclass stored")
  assert(ah[555].name == "Item 555", "item name from the download")
  assert(ah[9999].e == "INVTYPE_HEAD" and ah[555].e == nil, "equip slot stored for gear only")
  for _, r in pairs(ah) do for k, v in pairs(r) do assert(tostring(v) ~= "SomeSeller" and tostring(v) ~= "SomeSeller-Realm" and tostring(v) ~= "SomeBidder", "a seller or bidder name was stored") end end
  assert(s and s.scope == "all" and s.rows == 4 and s.complete == true and s.queued == 3 and s.answered == 3 and s.method == "full", "whole-AH scan record")
  -- again right away: the game's 15-minute wait, and no item-by-item fallback
  h.ns.StartAH(false, true)
  assert(not h.running(), "/kinv ah all within 15 minutes must not start a scan")
end
-- 7) names the download did not have: requested after a whole-AH read, remembered, used by the next scan
do
  local key = REALM .. "|alliance"
  local env = { realm = REALM, player = "Alliance", npc = "Alliance", listings = {}, cache = {},
                replicate = { { 100, 1, 10 }, { 4321, 1, 99 } } }                 -- 4321 comes without a name
  env.db = recipeDB({ a = char(REALM, "Alliance", { 100 }) })
  local h = fresh(env)
  h.event("AUCTION_HOUSE_SHOW"); h.ns.StartAH(false, true); h.event("REPLICATE_ITEM_LIST_UPDATE")
  for _ = 1, 40 do if h.running() then h.tick(0.1) end end
  local p = env.db.prices
  assert(p.ah[key][100].name == "Item 100" and p.names[100] == "Item 100", "a downloaded name is remembered")
  assert(p.ah[key][4321] and p.ah[key][4321].name == nil, "the unnamed item is stored without a name")
  local namer = h.frames()[3]
  assert(namer and namer.shown, "missing names are requested after a whole-AH read")
  namer.scripts.OnUpdate(namer, 0.2)
  assert(env.requested and env.requested[4321] and not env.requested[100], "only the missing name is requested")
  env.cache[4321] = "Copper Bar"; h.event("GET_ITEM_INFO_RECEIVED", 4321)
  assert(p.names[4321] == "Copper Bar" and p.ah[key][4321].name == "Copper Bar", "the name that arrives is recorded")
  -- 16 minutes later the download still lacks the name: the remembered one is used
  h.later(16 * 60); h.event("AUCTION_HOUSE_SHOW"); h.ns.StartAH(false, true); h.event("REPLICATE_ITEM_LIST_UPDATE")
  for _ = 1, 40 do if h.running() then h.tick(0.1) end end
  assert(p.ah[key][4321].name == "Copper Bar", "the next whole-AH scan uses the remembered name")
end
-- 8) exact stacks, tied minimum supply, rational unit prices, variants, and bid-only listings
do
  local key = REALM .. "|alliance"
  local db = recipeDB({ a = char(REALM, "Alliance", { 100 }) })
  local h = fresh({ db = db, realm = REALM, player = "Alliance", npc = "Alliance", listings = {},
    replicate = { { 100, 3, 100 }, { 100, 3, 100 }, { 100, 1, 50 }, { 100, 2, 0 },
      { 9999, 1, 500, "|Hitem:9999:0:0:0:0:0:-10|h[Helm]|h" },
      { 9999, 1, 800, "|Hitem:9999:0:0:0:0:0:-20|h[Helm]|h" } } })
  h.event("AUCTION_HOUSE_SHOW"); h.ns.StartAH(false, true); h.event("REPLICATE_ITEM_LIST_UPDATE")
  for _ = 1, 40 do if h.running() then h.tick(0.1) end end
  local ah = db.prices.ah[key]
  assert(ah[100].p[1] == 34, "rational unit prices round up, exact buyout is retained separately")
  local lots = ah[100].supply.lots
  assert(ah[100].supply.complete and #lots == 2, "all stack groups must survive")
  assert(lots[1][1] == 100 and lots[1][2] == 3 and lots[1][3] == 2, "identical stacks aggregate without rounding")
  assert(ah[100].n == 3, "bid-only listings aren't purchasable supply")
  assert(ah[9999].supply.lots[1][4] ~= ah[9999].supply.lots[2][4], "gear variants must stay distinct")
end
-- 9) malformed raw rows never certify a full download or replace a previously good house
do
  local key = REALM .. "|alliance"
  local db = recipeDB({ a = char(REALM, "Alliance", { 100 }) }, { [key] = { [777] = {p={5},q={1},n=1,t=1} } })
  db.prices.ahByHouse = true
  local h = fresh({db=db,realm=REALM,player="Alliance",npc="Alliance",listings={},replicate={{100,0,100}}})
  h.event("AUCTION_HOUSE_SHOW"); h.ns.StartAH(false,true); h.event("REPLICATE_ITEM_LIST_UPDATE")
  for _ = 1, 40 do if h.running() then h.tick(0.1) end end
  assert(db.prices.ah[key][777] and not db.prices.scans[key].complete, "bad raw rows must preserve the previous house")
end
-- 10) one unreadable listing among good ones: the good ones are kept, nothing is wiped, nothing is certified complete
do
  local key = REALM .. "|alliance"
  local db = recipeDB({ a = char(REALM, "Alliance", { 100 }) }, { [key] = { [777] = {p={5},q={1},n=1,t=1} } })
  db.prices.ahByHouse = true
  local h = fresh({db=db,realm=REALM,player="Alliance",npc="Alliance",listings={},replicate={{100,2,60},{200,0,10}}})
  h.event("AUCTION_HOUSE_SHOW"); h.ns.StartAH(false,true); h.event("REPLICATE_ITEM_LIST_UPDATE")
  for _ = 1, 40 do if h.running() then h.tick(0.1) end end
  local ah, s = db.prices.ah[key], db.prices.scans[key]
  assert(ah[100] and ah[100].p[1] == 30, "a readable listing next to a bad one must be saved")
  assert(ah[100].supply.complete == false, "supply next to a bad listing must not be marked complete")
  assert(ah[777], "an item missing from a partial download must keep its old price")
  assert(s and s.complete == false and s.scope == "all", "a partial download is recorded as incomplete")
end
-- 11) what a vendor pays is read again each session: a stored price is replaced, kept while the game has no answer,
--     and asked only once in a session
do
  local db = recipeDB({})
  db.prices.sell[252563], db.prices.sell[4234], db.prices.sell[7070] = 8622, 150, 400
  local env = { db = db, realm = REALM, player = "Alliance", npc = "Alliance", listings = {}, sell = { [252563] = 4387, [4234] = 150 } }
  local h = fresh(env)
  h.ns.RecordSell(252563); h.ns.RecordSell(4234); h.ns.RecordSell(7070)
  assert(db.prices.sell[252563] == 4387, "a price the game changed must replace the stored one: " .. tostring(db.prices.sell[252563]))
  assert(db.prices.sell[4234] == 150, "an unchanged price stays")
  assert(db.prices.sell[7070] == 400 and env.requested[7070], "no answer yet: the stored price stays and the item is requested")
  env.sell[252563] = 1                                         -- a second answer in the same session is not read
  h.ns.RecordSell(252563)
  assert(db.prices.sell[252563] == 4387, "an item is asked once a session")
  env.sell[7070] = 380
  h.event("GET_ITEM_INFO_RECEIVED", 7070)                      -- the item loaded: now it answers
  assert(db.prices.sell[7070] == 380, "the price of an item that loaded later: " .. tostring(db.prices.sell[7070]))
  local again = fresh(env)                                     -- the next session reads again
  again.ns.RecordSell(252563)
  assert(db.prices.sell[252563] == 1, "the next session must read the price again")
end
print("OK prices per auction house, scan records, legacy migration, no-answer items left out, whole-AH scans, item names, exact supply, vendor prices read again each session")
`;

const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
if (lauxlib.luaL_dostring(L, to_luastring(code)) !== 0) {
  console.error("FAIL " + to_jsstring(lua.lua_tostring(L, -1)));
  process.exit(1);
}
