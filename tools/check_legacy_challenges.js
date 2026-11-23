// Legacy challenges (1.23.0): the real inventory addon in a fake client. Read after login, re-read after an achievement
// or criterion event (no sooner than 30 s after the last read, never in combat), saved only when something differs,
// set 61 only once started, nothing from a client without the achievement functions.
const fs = require("fs"), path = require("path");
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require("fengari");
const source = fs.readFileSync(path.join(__dirname, "../KutzInventory/KutzInventory.lua"), "utf8");

const driver = `
local now = 0
local timers, hooks, frame = {}, {}, nil
time = function() return 1700000000 + math.floor(now) end
GetTime = function() return now end
wipe = function(t) for k in pairs(t) do t[k] = nil end end
CreateFrame = function()
  frame = { events = {} }
  function frame:RegisterEvent(e) self.events[e] = true end
  function frame:SetScript(_, fn) self.event = fn end
  return frame
end
C_Timer = { After = function(delay, fn) timers[#timers + 1] = { at = now + delay, fn = fn } end }
local function advance(amount)
  local stop = now + amount
  while true do
    local nextAt
    for _, t in ipairs(timers) do if t.at <= stop and (not nextAt or t.at < nextAt) then nextAt = t.at end end
    if not nextAt then break end
    now = math.max(now, nextAt)
    local batch = timers; timers = {}
    for _, t in ipairs(batch) do if t.at <= now then t.fn() else timers[#timers + 1] = t end end
  end
  now = stop
end
hooksecurefunc = function(name, fn) hooks[name] = fn end
Logout = function() end; Quit = function() end; ReloadUI = function() end
UnitName = function() return 'Tester' end; GetRealmName = function() return 'Realm' end
UnitClass = function() return 'Warrior', 'WARRIOR' end; UnitRace = function() return 'Human' end
UnitFactionGroup = function() return 'Alliance' end; UnitLevel = function() return 30 end; UnitSex = function() return 2 end
UnitGUID = function() return 'Player-Test' end; UnitExists = function() return true end
local inCombat = false
InCombatLockdown = function() return inCombat end
C_Container = { GetContainerNumSlots = function(bag) return bag == 0 and 16 or 0 end, GetContainerItemInfo = function() end }
SlashCmdList = {}
GetMoney = function() return 100 end; UnitXP = function() return 5 end; UnitXPMax = function() return 10 end
GetInstanceInfo = function() return 'Elwynn Forest', 'none' end
local secret = {}
issecretvalue = function(v) return v == secret end

-- the account's achievements as this character's client reports them
local ach = {
  [684]   = { true, 3, 14, 26, true, 'Tester', { { 1001, true, 1, 1 } } },
  [61502] = { true, 2, 29, 24, false, 'Altchar', { { 2001, true, 25, 25 } } },
  [62054] = { false, 0, 0, 0, false, '', { { 3001, false, 7, 25 }, { 3002, false, 0, 1 }, { nil, true, 1, 1 } } },
  [63969] = { true, 13, 1, 26, true, 'Tester', {} },                       -- set 61, completed (not a real date)
  [63970] = { false, 0, 0, 0, false, '', { { 4001, false, 3, 10 } } },    -- set 61, started
  [63971] = { false, 0, 0, 0, false, '', { { 4101, false, 0, 10 } } },    -- set 61, untouched: left out
}
local reads = 0
GetAchievementInfo = function(id)
  local a = ach[id]
  if id == 684 then reads = reads + 1 end
  if not a then return nil end
  return id, 'Name ' .. id, 10, a[1], a[2], a[3], a[4], 'Text', 0, 1, '', false, a[5], a[6], false
end
GetAchievementNumCriteria = function(id) return ach[id] and #ach[id][7] or 0 end
GetAchievementCriteriaInfo = function(id, i)
  local c = ach[id][7][i]
  if not c then error('no criterion ' .. i) end
  return 'Criterion', 0, c[2], c[3], c[4], '', 0, 0, '', c[1], true, 0, 0
end

KutzInventoryDB = { chars = {} }
assert(load([====[${source}]====]))('KutzInventory', {})
local function emit(e, ...) assert(frame.events[e], e .. ' not registered'); frame.event(frame, e, ...) end
local function dump(v)
  if type(v) ~= 'table' then return tostring(v) end
  local keys = {}
  for k in pairs(v) do keys[#keys + 1] = k end
  table.sort(keys, function(a, b) return tostring(a) < tostring(b) end)
  local out = {}
  for _, k in ipairs(keys) do out[#out + 1] = (type(k) == 'number' and '' or (k .. '=')) .. dump(v[k]) end
  return '{' .. table.concat(out, ',') .. '}'
end
local function check(ok, msg) assert(ok, msg .. ' (lastError ' .. tostring(KutzInventoryDB.lastError) .. ')') end

emit('ADDON_LOADED', 'KutzInventory'); emit('PLAYER_LOGIN'); emit('PLAYER_ENTERING_WORLD')
for _, e in ipairs({ 'RECEIVED_ACHIEVEMENT_LIST', 'ACHIEVEMENT_EARNED', 'CRITERIA_EARNED', 'CRITERIA_UPDATE' }) do
  check(frame.events[e], e .. ' registered')
end
local c = KutzInventoryDB.chars['Tester-Realm']
advance(15)
check(c.legacyChallenges == nil and reads == 0, 'nothing read before the login read')
advance(1)
check(reads == 1, 'one login read: ' .. reads)
local lc = c.legacyChallenges
check(lc and lc.at == 1700000016 and c.updated.legacyChallenges == lc.at, 'login read saved with its time')
check(dump(lc.list) == '{' ..
  '{completed=true,criteria={{completed=true,id=1001,quantity=1,reqQuantity=1}},date=2026-03-14,earnedBy=Tester,id=684,set=60,wasEarnedByMe=true},' ..
  '{completed=true,criteria={{completed=true,id=2001,quantity=25,reqQuantity=25}},date=2024-02-29,earnedBy=Altchar,id=61502,set=60,wasEarnedByMe=false},' ..
  '{completed=false,criteria={{completed=false,id=3001,quantity=7,reqQuantity=25},{completed=false,id=3002,quantity=0,reqQuantity=1}},id=62054,set=60,wasEarnedByMe=false},' ..
  '{completed=true,criteria={},earnedBy=Tester,id=63969,set=61,wasEarnedByMe=true},' ..
  '{completed=false,criteria={{completed=false,id=4001,quantity=3,reqQuantity=10}},id=63970,set=61,wasEarnedByMe=false}}',
  'login reading: ' .. dump(lc.list))

-- an event with nothing changed: one read, nothing rewritten
advance(30); emit('CRITERIA_UPDATE'); emit('CRITERIA_UPDATE'); advance(2)
check(reads == 2 and c.legacyChallenges == lc and c.updated.legacyChallenges == 1700000016, 'unchanged: not rewritten')

-- a change, seen on ACHIEVEMENT_EARNED: no sooner than 30 s after the last read, then saved
ach[62054][1], ach[62054][2], ach[62054][3], ach[62054][4] = true, 11, 23, 26
ach[62054][7][1][2], ach[62054][7][1][3] = true, 25
emit('ACHIEVEMENT_EARNED', 62054, false); advance(2)
check(reads == 2 and c.legacyChallenges == lc, 'within 30 s of the last read: waits')
emit('CRITERIA_EARNED', 62054, 'x', false); advance(27)
check(reads == 2, 'still waiting, one read pending')
advance(1)
check(reads == 3 and c.legacyChallenges ~= lc, 'read 30 s after the last')
lc = c.legacyChallenges
check(lc.at == now + 1700000000 and c.updated.legacyChallenges == lc.at, 'moved at and updated')
local e = lc.list[3]
check(e.id == 62054 and e.completed == true and e.date == '2026-11-23' and e.criteria[1].completed and e.criteria[1].quantity == 25, dump(e))

-- combat: the read waits for combat to end
advance(40); ach[63971][7][1][3] = 1                                     -- set 61: now started
inCombat = true; emit('CRITERIA_UPDATE'); advance(10)
check(reads == 3 and c.legacyChallenges == lc, 'no read in combat')
advance(60)
check(reads == 3, 'no read later while still in combat')
inCombat = false; emit('PLAYER_REGEN_ENABLED'); advance(4)
check(reads == 3, 'a few seconds after combat')
advance(1)
check(reads == 4 and #c.legacyChallenges.list == 6 and c.legacyChallenges.list[6].id == 63971, 'read after combat; started set 61 joins')
lc = c.legacyChallenges

-- no achievement answered (data not there): the saved reading stays
local real = GetAchievementInfo
GetAchievementInfo = function(id) if id == 684 then reads = reads + 1 end end
advance(40); emit('ACHIEVEMENT_EARNED'); advance(2)
check(reads == 5 and c.legacyChallenges == lc, 'nothing answered keeps the saved reading')
GetAchievementInfo = real

-- secret, wrong-typed and failing answers leave the field (or the entry, or the criterion) out, never an error
ach[684][6] = secret; ach[61502][5] = 'yes'; ach[61502][6] = string.rep('x', 65)
ach[62054][7][2][3] = -1; ach[62054][7][2][4] = 2.5
local crit = GetAchievementCriteriaInfo
GetAchievementCriteriaInfo = function(id, i) if id == 63970 then error('boom') end return crit(id, i) end
advance(40); KutzInventoryDB.lastError = nil; emit('ACHIEVEMENT_EARNED'); advance(2)
check(reads == 6 and not KutzInventoryDB.lastError, 'secret answers read without error')
local by = {}
for _, x in ipairs(c.legacyChallenges.list) do by[x.id] = x end
check(by[684].earnedBy == nil and by[684].wasEarnedByMe == true, 'secret earnedBy left out')
check(by[61502].earnedBy == nil and by[61502].wasEarnedByMe == nil, 'odd types left out: ' .. dump(by[61502]))
check(dump(by[62054].criteria[2]) == '{completed=false,id=3002}', 'bad quantities left out: ' .. dump(by[62054].criteria))
check(by[63970] == nil, 'set 61 with criteria that fail to read is not started')
GetAchievementCriteriaInfo = crit
lc = c.legacyChallenges

-- /kinv scan reads at once; a read waiting at the logout checkpoint runs there
ach[684][6] = 'Tester'; SlashCmdList.KUTZINVENTORY('scan')
check(reads == 7 and c.legacyChallenges ~= lc and c.legacyChallenges.list[1].earnedBy == 'Tester', '/kinv scan reads')
ach[61502][6] = 'Altchar'; emit('CRITERIA_UPDATE'); advance(2)
check(reads == 7, 'waiting after /kinv scan')
hooks.Logout()
check(reads == 8 and c.legacyChallenges.list[2].earnedBy == 'Altchar', 'the logout checkpoint runs the waiting read')
print('OK legacy challenges: login read, change-only saves, 30 s limit, combat deferral, set 61 once started, guarded answers, /kinv scan and checkpoint')
`;

// A client without the achievement functions: nothing saved, no error, no timer of its own.
const bare = driver
  .replace(/GetAchievementInfo = function\(id\)\n/, "local _ = function(id)\n")
  .replace("GetAchievementNumCriteria = function", "local _2 = function")
  .replace("GetAchievementCriteriaInfo = function", "local _3 = function")
  .replace(/advance\(15\)[\s\S]*$/, `advance(60); emit('ACHIEVEMENT_EARNED'); advance(60); SlashCmdList.KUTZINVENTORY('scan'); hooks.Logout()
check(c.legacyChallenges == nil and c.updated.legacyChallenges == nil and not KutzInventoryDB.lastError, 'no functions: nothing')
print('OK legacy challenges: a client without the achievement functions records nothing and raises nothing')
`);

let failed = false;
for (const chunk of [driver, bare]) {
  const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
  if (lauxlib.luaL_dostring(L, to_luastring(chunk)) !== 0) {
    console.error("FAIL " + to_jsstring(lua.lua_tostring(L, -1))); failed = true;
  }
}
process.exit(failed ? 1 : 0);
