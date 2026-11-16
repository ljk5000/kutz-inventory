const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require('fengari');
const root = path.resolve(__dirname, '..');
const inventory = fs.readFileSync(path.join(root, 'KutzInventory/KutzInventory.lua'), 'utf8');
const scheduler = inventory.slice(inventory.indexOf('local pendingRun = {}'), inventory.indexOf('-- One item, from a link'));
// the recipe reader and its window handlers, as the addon has them
const recipes = inventory.slice(inventory.indexOf('local REAGENT_BASIC'), inventory.indexOf('-- trainers: everything the open trainer'));
const recipeHandlers = inventory.slice(inventory.indexOf('local function ReadRecipesNow()'),
    inventory.indexOf('function handlers.TRADE_SKILL_LIST_UPDATE()'));
const code = `
local timers = {} local db = {}
C_Timer = { After = function(delay, fn) timers[#timers + 1] = fn end }
${scheduler}
local function drain() local batch = timers; timers = {}; for _, fn in ipairs(batch) do fn() end end
for _, key in ipairs({'bags', 'recipes'}) do
    local result, calls
    local function scan(force) result = force; calls = (calls or 0) + 1 end
    Soon(key, scan, 1); Soon(key, scan, 1, true); Soon(key, scan, 1)
    assert(#timers == 1); drain(); assert(result == true and calls == 1)
    Soon(key, scan, 1, true); Soon(key, scan, 1); drain(); assert(result == true and calls == 2)
    Soon(key, scan, 1); drain(); assert(not result and calls == 3)
end
local attempts = 0
local function retry(force)
    attempts = attempts + 1; assert(force)
    if attempts == 1 then Soon('recipes', retry, 1, force) end
end
Soon('recipes', retry, 1, true); drain(); drain(); assert(attempts == 2)
Soon('failure', function() error('test failure') end, 1); drain(); assert(db.lastError)
local recovered = false
Soon('failure', function() recovered = true end, 1); drain(); assert(recovered)
print('OK scan scheduling upgrades, retries and failure recovery')
`;

// While crafting, "list changed" fires after every craft. The full recipe read runs only when the list length or the
// skill changed: a skill-up at most once per 30 s, plus one read after the last while the window is open. Opening the
// window and learning a recipe always read; an empty list from a closed window never wipes the record.
const recipeCode = `
local timers, db, ns, handlers = {}, {}, {}, {}
local loggingOut, worldLeaving = false, false
local clock, skill, ids = 1000, 10, { 1, 2, 3 }
GetTime = function() return clock end
time = function() return 1767225600 end
C_Timer = { After = function(delay, fn) timers[#timers + 1] = { at = clock + (delay or 1), fn = fn } end }
local function Plain(v) return v end
local function Try(fn, ...) if type(fn) == "function" then return fn(...) end end
local function PlainText(t) return t end
local me = { updated = {} }
C_TradeSkillUI = {
    GetRecipeInfo = function(id) return { learned = true, name = "R" .. id } end,
    GetRecipeSchematic = function() return { reagentSlotSchematics = {} } end,
    GetBaseProfessionInfo = function() return { professionName = "Alchemy", skillLevel = skill } end,
    GetChildProfessionInfo = function() return { skillLevel = skill } end,
    GetAllRecipeIDs = function() return ids end,
}
${scheduler}
${recipes}
${recipeHandlers}
local function run(seconds)                     -- the game clock moves on; every timer that comes due runs
    clock = clock + seconds
    local again = true
    while again do
        again = false
        for i, t in ipairs(timers) do
            if t.at <= clock then table.remove(timers, i); t.fn(); again = true; break end
        end
    end
end
local function listChanged() Soon("recipes", ScanRecipes, 2) end
local function record() return me.recipes and me.recipes.Alchemy end
handlers.TRADE_SKILL_SHOW(); run(1)
assert(record() and #record().recipes == 3 and record().skill == 10, "opening the window reads")
local stamp = record()
for _ = 1, 5 do listChanged(); run(3) end
assert(record() == stamp, "crafts with nothing changed rebuild nothing")
run(30); skill = 11; listChanged(); run(3)
assert(record() ~= stamp and record().skill == 11, "a skill-up 30 s after the last read reads at once")
stamp = record()
skill = 12; listChanged(); run(3)
assert(record() == stamp, "a second skill-up within 30 s waits")
skill = 13; listChanged(); run(3); listChanged(); run(3)
assert(record() == stamp, "still waiting, one read pending")
run(30)
assert(record() ~= stamp and record().skill == 13, "the waiting read runs after 30 s, with the newest skill")
stamp = record()
skill = 14; listChanged(); run(3); handlers.TRADE_SKILL_CLOSE(); run(40)
assert(record() == stamp, "the window closed: the waiting read does nothing")
handlers.TRADE_SKILL_SHOW(); run(1)
assert(record() ~= stamp and record().skill == 14, "opening again reads")
ids = { 1, 2, 3, 4 }; listChanged(); run(3)
assert(#record().recipes == 4, "a longer list reads at once")
stamp = record()
skill = 15; listChanged(); run(3)
handlers.NEW_RECIPE_LEARNED(); run(1)
assert(record() ~= stamp and record().skill == 15, "learning a recipe reads now, replacing a waiting read")
stamp = record()
run(40)
assert(record() == stamp, "the replaced read never runs")
ids = {}; listChanged(); run(3)
assert(#record().recipes == 4, "an empty list (the window already gone) keeps the record")
print('OK recipe reads while crafting: only when the list or the skill changed, a skill-up at most every 30 s')
`;
for (const chunk of [code, recipeCode]) {
    const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
    if (lauxlib.luaL_dostring(L, to_luastring(chunk)) !== 0) {
        console.error(to_jsstring(lua.lua_tostring(L, -1))); process.exit(1);
    }
}
