-- KutzInventory: keeps a record of what every character owns, in the saved file KutzInventoryDB.
--
-- An addon cannot write files itself; the game writes KutzInventoryDB to
--   WTF\Account\<account>\SavedVariables\KutzInventory.lua
-- on logout and /reload. tools/inventory_export.js turns that file into JSON.
--
-- Events mark what changed, and a short delayed
-- scan reads only that (one bag, the equipped gear, ...). The bank, warband bank and guild bank can
-- only be read while they are open, so they are recorded on each visit and kept until the next one.

local ADDON, ns = ...                       -- ns is shared with Prices.lua
local DB_VERSION = 1

local BANK_FIRST, BANK_LAST = 6, 14          -- Enum.BagIndex.CharacterBankTab_1 .. _9
local WARBAND_FIRST, WARBAND_LAST = 15, 23   -- Enum.BagIndex.AccountBankTab_1 .. _9
local BAG_FIRST, BAG_LAST = -1, 5            -- keyring (if this client has one), backpack, bags 1-4, reagent bag

local db, me, meKey                           -- KutzInventoryDB, this character's entry and its stable key
local hadInventory
local bankOpen, guildBankOpen = false, false
local loggedInAt, loggingOut = nil, false
local worldLeaving = false

---------------------------------------------------------------------------
-- small helpers
---------------------------------------------------------------------------
local function Plain(v)                       -- a value we may store (not a hidden "secret" value)
    if v == nil then return nil end
    if issecretvalue and issecretvalue(v) then return nil end
    return v
end

local function Try(fn, ...)                   -- a call that may not exist on this client / may fail
    if type(fn) ~= "function" then return nil end
    local ok, a, b, c, d, e, f, g, h, i, j = pcall(fn, ...)
    if ok then return a, b, c, d, e, f, g, h, i, j end
end

local pendingRun = {}
local function Soon(key, fn, delay, force)   -- coalesce from the first request; never downgrade a full scan
    if loggingOut then return end
    local pending = pendingRun[key]
    if pending then
        pending.force = pending.force or force
        return
    end
    pending = { force = force, fn = fn }
    pendingRun[key] = pending
    C_Timer.After(delay or 1, function()
        if loggingOut or pendingRun[key] ~= pending then return end
        if worldLeaving then return end       -- resume after the next loading screen, never read unloading data
        pendingRun[key] = nil
        local ok, err = pcall(fn, pending.force)
        if not ok and db then db.lastError = tostring(err) end
    end)
end

-- One item, from a link (+ what the container already told us)
local function Item(link, count, quality, bound, name, icon)
    link = Plain(link)
    if type(link) ~= "string" then return nil end
    if ns.Facts and ns.Facts.Meet then ns.Facts.Meet(link) end   -- Facts.lua reads each item's own facts once
    local id = tonumber(link:match("item:(%-?%d+)"))
    local it = {
        id = id, link = link, count = Plain(count) or 1,
        quality = Plain(quality), bound = Plain(bound) or nil, icon = Plain(icon),
        name = Plain(name) or link:match("%[(.-)%]"),
    }
    if C_Item and C_Item.GetDetailedItemLevelInfo then
        local il = Plain(Try(C_Item.GetDetailedItemLevelInfo, link))
        if type(il) == "number" and il > 1 then it.ilvl = il end
    end
    if id and C_Item and C_Item.GetItemInfoInstant then
        local _, itemType, subType, equipLoc, ic, classID, subClassID = Try(C_Item.GetItemInfoInstant, id)
        it.type, it.subType = Plain(itemType), Plain(subType)
        it.classID, it.subClassID = Plain(classID), Plain(subClassID)
        if Plain(equipLoc) and equipLoc ~= "" then it.equipLoc = equipLoc end
        it.icon = it.icon or Plain(ic)
    end
    return it
end

---------------------------------------------------------------------------
-- containers (bags, bank tabs, warband tabs)
---------------------------------------------------------------------------
local function ReadContainer(bag)
    local size = Plain(Try(C_Container.GetContainerNumSlots, bag)) or 0
    if size <= 0 then return nil end
    local box = { size = size, name = Plain(Try(C_Container.GetBagName, bag)), items = {} }
    if bag >= 1 and C_Container.ContainerIDToInventoryID then          -- the bag item itself
        local inv = Try(C_Container.ContainerIDToInventoryID, bag)
        if inv then box.link = Plain(Try(GetInventoryItemLink, "player", inv)) end
    end
    local used = 0
    for slot = 1, size do
        local info = Try(C_Container.GetContainerItemInfo, bag, slot)
        if info and info.hyperlink then
            local it = Item(info.hyperlink, info.stackCount, info.quality, info.isBound, info.itemName, info.iconFileID)
            if it then box.items[slot] = it; used = used + 1 end
        end
    end
    box.used = used
    return box
end

local dirtyBags = {}

local function ScanBags(all)
    if (Try(C_Container.GetContainerNumSlots, 0) or 0) <= 0 then return end
    me.bags = me.bags or {}
    for bag = BAG_FIRST, BAG_LAST do
        if all or dirtyBags[bag] then me.bags[bag] = ReadContainer(bag) end
    end
    if bankOpen then
        me.bank = me.bank or {}
        db.warband.bank = db.warband.bank or {}
        for bag = BANK_FIRST, BANK_LAST do
            if all or dirtyBags[bag] then me.bank[bag] = ReadContainer(bag) end
        end
        for bag = WARBAND_FIRST, WARBAND_LAST do
            if all or dirtyBags[bag] then db.warband.bank[bag] = ReadContainer(bag) end
        end
        me.updated.bank = time()
        db.warband.updated = time()
        db.warband.updatedBy = meKey
        if C_Bank and C_Bank.FetchDepositedMoney and Enum.BankType then
            db.warband.money = Plain(Try(C_Bank.FetchDepositedMoney, Enum.BankType.Account)) or db.warband.money
        end
    end
    wipe(dirtyBags)
    me.updated.bags = time()                  -- gold: ScanWallet (a bag scan at login read 0 before it loaded)
end

---------------------------------------------------------------------------
-- equipped gear
---------------------------------------------------------------------------
local SLOT_NAMES = {
    "AMMOSLOT", "HEADSLOT", "NECKSLOT", "SHOULDERSLOT", "SHIRTSLOT", "CHESTSLOT", "WAISTSLOT", "LEGSSLOT",
    "FEETSLOT", "WRISTSLOT", "HANDSSLOT", "FINGER0SLOT", "FINGER1SLOT", "TRINKET0SLOT", "TRINKET1SLOT",
    "BACKSLOT", "MAINHANDSLOT", "SECONDARYHANDSLOT", "RANGEDSLOT", "TABARDSLOT",
    "PROF0TOOLSLOT", "PROF0GEAR0SLOT", "PROF0GEAR1SLOT", "PROF1TOOLSLOT", "PROF1GEAR0SLOT", "PROF1GEAR1SLOT",
    "COOKINGTOOLSLOT", "COOKINGGEAR0SLOT", "FISHINGTOOLSLOT", "FISHINGGEAR0SLOT", "FISHINGGEAR1SLOT",
}
local slotIDs                                   -- { {id=, name=}, ... } for the slots this client has

local function Slots()
    if slotIDs then return slotIDs end
    slotIDs = {}
    for _, name in ipairs(SLOT_NAMES) do
        local id = Try(GetInventorySlotInfo, name)
        if type(id) == "number" then slotIDs[#slotIDs + 1] = { id = id, name = name } end
    end
    return slotIDs
end

local function ScanGear()
    local gear = {}
    for _, s in ipairs(Slots()) do
        local link = Try(GetInventoryItemLink, "player", s.id)
        if link then
            local it = Item(link, 1, Plain(Try(GetInventoryItemQuality, "player", s.id)))
            if it then
                it.slot = s.name
                local cur, max = Try(GetInventoryItemDurability, s.id)
                it.durability, it.durabilityMax = Plain(cur), Plain(max)
                local stats = C_Item and C_Item.GetItemStats and Try(C_Item.GetItemStats, link) or Try(GetItemStats, link)
                if type(stats) == "table" then
                    local copy = {}
                    for k, v in pairs(stats) do if Plain(v) then copy[k] = v end end
                    it.stats = copy
                end
                gear[s.id] = it
            end
        end
    end
    -- an empty read while the game is still loading (or already unloading) your gear must not wipe
    -- what was recorded; a really empty character just keeps its last record until something is worn
    if next(gear) == nil and me.equipped and next(me.equipped) then return end
    me.equipped = gear
    local overall, equipped = Try(GetAverageItemLevel)
    me.ilvl, me.ilvlEquipped = Plain(overall), Plain(equipped)
    me.updated.equipped = time()
end

---------------------------------------------------------------------------
-- character stats (a snapshot out of combat: buffs at that moment count)
---------------------------------------------------------------------------
local CR = {                                    -- combat ratings by name, when the client defines them
    "CR_CRIT_MELEE", "CR_CRIT_RANGED", "CR_CRIT_SPELL", "CR_HASTE_MELEE", "CR_HASTE_RANGED", "CR_HASTE_SPELL",
    "CR_MASTERY", "CR_VERSATILITY_DAMAGE_DONE", "CR_LIFESTEAL", "CR_AVOIDANCE", "CR_SPEED",
    "CR_DODGE", "CR_PARRY", "CR_BLOCK", "CR_HIT_MELEE", "CR_HIT_RANGED", "CR_HIT_SPELL", "CR_EXPERTISE",
    "CR_DEFENSE_SKILL", "CR_RESILIENCE_CRIT_TAKEN",
}

-- The character pane's stat list, section by section, the way Forever's own pane computes it
-- (General, Primary attributes, Weapons, Modifiers, Defense, Resistances). Read with the other stats.
local function R2(v) v = Plain(v); if type(v) == "number" then return math.floor(v * 100 + 0.5) / 100 end end
local SCHOOLS = { "holy", "fire", "nature", "frost", "shadow", "arcane" }   -- spell schools 2-7 / resistances 1-6

local function Weapon(minD, maxD, speed)
    minD, maxD, speed = Plain(minD), Plain(maxD), Plain(speed)
    if not (minD and maxD and speed and speed > 0) then return nil end
    return { min = math.max(1, math.floor(minD)), max = math.max(1, math.ceil(maxD)), speed = R2(speed),
             dps = R2((minD + maxD) / 2 / speed) }
end

local function AP(base, pos, neg)
    base = Plain(base)
    if not base then return nil end
    pos, neg = Plain(pos) or 0, Plain(neg) or 0
    return { base = base, bonus = pos, penalty = neg, total = base + pos + neg }
end

local function ScanSheet()
    local sh = {}
    -- General
    local _, powerToken = Try(UnitPowerType, "player")
    local _, runSpeed = Try(GetUnitSpeed, "player")
    sh.general = { health = Plain(Try(UnitHealthMax, "player")), power = Plain(Try(UnitPowerMax, "player")),
                   powerType = Plain(powerToken),
                   moveSpeed = Plain(runSpeed) and R2(runSpeed / (_G.BASE_MOVEMENT_SPEED or 7) * 100) or nil }   -- percent
    -- Primary attributes
    sh.primary = {}
    for i, k in ipairs({ "strength", "agility", "stamina", "intellect", "spirit" }) do
        local base, eff, pos, neg = Try(UnitStat, "player", i)
        if Plain(eff) then sh.primary[k] = { base = Plain(base), total = Plain(eff), bonus = Plain(pos), penalty = Plain(neg) } end
    end
    -- Weapons
    local w = {}
    local mainSpeed, offSpeed = Try(UnitAttackSpeed, "player")
    local minD, maxD, minOff, maxOff = Try(UnitDamage, "player")
    w.mainHand = Weapon(minD, maxD, mainSpeed)
    w.offHand = Weapon(minOff, maxOff, offSpeed)
    local rSpeed, rMin, rMax = Try(UnitRangedDamage, "player")
    w.ranged = Weapon(rMin, rMax, rSpeed)
    w.attackPower = AP(Try(UnitAttackPower, "player"))
    w.rangedAttackPower = AP(Try(UnitRangedAttackPower, "player"))
    sh.weapons = w
    -- Modifiers
    local function bonus(name) local idx = _G[name]; return type(idx) == "number" and (Plain(Try(GetCombatRatingBonus, idx)) or 0) or 0 end
    local m = {}
    m.hit = { melee = R2(bonus("CR_HIT_MELEE") + (Plain(Try(GetHitModifier)) or 0)),
              ranged = R2(bonus("CR_HIT_RANGED") + (Plain(Try(GetRangedHitModifier)) or 0)),
              spell = R2(bonus("CR_HIT_SPELL") + (Plain(Try(GetSpellHitModifier)) or 0)) }
    local spellCrit, spellPower, schoolPower = nil, nil, {}
    for i, school in ipairs(SCHOOLS) do
        local c = Plain(Try(GetSpellCritChance, i + 1))
        if c and (not spellCrit or c < spellCrit) then spellCrit = c end
        local sp = Plain(Try(GetSpellBonusDamage, i + 1))
        if sp then schoolPower[school] = sp; if not spellPower or sp < spellPower then spellPower = sp end end
    end
    m.crit = { melee = R2(Try(GetCritChance)), ranged = R2(Try(GetRangedCritChance)), spell = R2(spellCrit) }
    local rangedHaste = Try(GetRangedHaste)
    m.haste = { melee = R2(Try(GetMeleeHaste)), ranged = R2(rangedHaste), spell = R2(Try(UnitSpellHaste, "player")) }
    local exMain, exOff, exRanged = Try(GetExpertise)
    m.expertise = { mainHand = R2(exMain), offHand = R2(exOff), ranged = R2(exRanged) }
    m.armorPenetration = R2(Try(GetArmorPenetration))
    m.spellPower, m.spellPowerBySchool = spellPower, schoolPower
    m.healing = Plain(Try(GetSpellBonusHealing))
    m.spellPenetration = Plain(Try(GetSpellPenetration))
    sh.modifiers = m
    -- Defense
    local d = {}
    local defBase, defMod = Try(UnitDefenseSkill, "player")
    defBase, defMod = Plain(defBase), Plain(defMod)
    if defBase then d.defense = { base = defBase, bonus = defMod or 0, total = defBase + (defMod or 0) } end
    d.dodge, d.parry, d.block = R2(Try(GetDodgeChance)), R2(Try(GetParryChance)), R2(Try(GetBlockChance))
    d.blockValue = Plain(Try(GetShieldBlock))
    local baseArmor, effArmor, _, bonusArmor = Try(UnitArmor, "player")
    if Plain(effArmor) then d.armor = { base = Plain(baseArmor), total = Plain(effArmor), bonus = Plain(bonusArmor) } end
    sh.defense = d
    -- Resistances
    local res = {}
    for i, school in ipairs(SCHOOLS) do
        local base, total, pos, neg = Try(UnitResistance, "player", i)
        if Plain(total) then res[school] = { base = Plain(base), total = Plain(total), bonus = Plain(pos), penalty = Plain(neg) } end
    end
    sh.resistances = res
    me.sheet = sh
    me.updated.sheet = time()
end

local function ScanStats()
    if InCombatLockdown() then return false end
    local st = {}
    local function put(k, v) v = Plain(v); if type(v) == "number" then st[k] = v end end
    for i, k in ipairs({ "strength", "agility", "stamina", "intellect", "spirit" }) do
        local base, eff = Try(UnitStat, "player", i)
        put(k, eff); put(k .. "Base", base)
    end
    local _, armor = Try(UnitArmor, "player"); put("armor", armor)
    put("health", Try(UnitHealthMax, "player"))
    put("power", Try(UnitPowerMax, "player"))
    put("critMelee", Try(GetCritChance)); put("critRanged", Try(GetRangedCritChance)); put("critSpell", Try(GetSpellCritChance, 2))
    put("haste", Try(GetHaste)); put("mastery", Try(GetMasteryEffect))
    local vers = (Try(GetCombatRatingBonus, _G.CR_VERSATILITY_DAMAGE_DONE) or 0) + (Try(GetVersatilityBonus, _G.CR_VERSATILITY_DAMAGE_DONE) or 0)
    if _G.CR_VERSATILITY_DAMAGE_DONE then put("versatility", vers) end
    put("leech", Try(GetLifesteal)); put("avoidance", Try(GetAvoidance)); put("speed", Try(GetSpeed))
    put("dodge", Try(GetDodgeChance)); put("parry", Try(GetParryChance)); put("block", Try(GetBlockChance))
    local base, pos, neg = Try(UnitAttackPower, "player")
    if Plain(base) then put("attackPower", base + (Plain(pos) or 0) + (Plain(neg) or 0)) end
    put("spellPower", Try(GetSpellBonusDamage, 2)); put("healing", Try(GetSpellBonusHealing))
    local ratings = {}
    for _, name in ipairs(CR) do
        local idx = _G[name]
        if type(idx) == "number" then
            local v = Plain(Try(GetCombatRating, idx))
            if type(v) == "number" and v > 0 then ratings[name] = v end
        end
    end
    st.ratings = ratings
    me.stats = st
    pcall(ScanSheet)
    me.updated.stats = time()
    return true
end

---------------------------------------------------------------------------
-- who we are, professions, currencies
---------------------------------------------------------------------------
local function PlayerName()
    -- UnitName is the given name. On Forever, GetUnitName adds the surname ("Examplehero First").
    local given = Plain(UnitName("player"))
    local surname
    local full = Plain(Try(GetUnitName, "player", true))
    if type(full) == "string" and type(given) == "string" and given ~= "" then
        local rest = full:match("^" .. given:gsub("(%W)", "%%%1") .. "%s+(.+)$")
        if type(rest) == "string" then
            rest = rest:gsub("^%s+", ""):gsub("%s+$", "")
            if rest ~= "" then surname = rest end
        end
    end
    return given, surname
end

-- The realm's name. One client build (2026-11-20) answered "" for the whole session: the character got a second,
-- realm-less record ("Name-") and /kinv ah could not tell its auction house. A saved record still knows the name: this
-- character's own, else the one realm every saved character with the same realm number in its GUID
-- ("Player-<number>-...") was saved with. "" only when nothing saved knows it.
local function RealmName()
    local realm = Plain(Try(GetRealmName))
    if type(realm) == "string" and realm ~= "" then return realm end
    local guid = Plain(Try(UnitGUID, "player"))
    if type(guid) ~= "string" or type(db) ~= "table" or type(db.chars) ~= "table" then return "" end
    local number, found = guid:match("^Player%-(%d+)%-"), nil
    for _, c in pairs(db.chars) do
        if type(c) == "table" and type(c.realm) == "string" and c.realm ~= "" and type(c.guid) == "string" then
            if c.guid == guid then return c.realm end
            if number and c.guid:match("^Player%-(%d+)%-") == number then
                if found == nil then found = c.realm elseif found ~= c.realm then found = false end
            end
        end
    end
    return found or ""
end
ns.RealmName = RealmName                      -- Prices.lua (the auction house's key) and Raids.lua

local function CharacterKey()
    local given, surname = PlayerName()
    local realm, guid = RealmName(), Plain(UnitGUID("player"))
    -- Without an owner we cannot safely choose a table. PLAYER_LOGIN normally always has a GUID.
    if type(guid) ~= "string" or guid == "" then error("Cannot select character without player GUID") end
    local base = given .. "-" .. realm
    local old = db.chars[base]
    if old and old.guid == guid then return base end
    -- Find an existing disambiguated key before claiming even an empty/legacy base key. Surnames can change.
    local found
    local prefix, suffix = given .. "-", "-" .. realm
    for key, c in pairs(db.chars) do
        if key:sub(1, #prefix) == prefix and key:sub(-#suffix) == suffix and c.guid == guid then
            if not found or key < found then found = key end
        end
    end
    if found then return found end
    -- A record started while the game gave no realm name ("Name-", realm ""), for a character with no other record:
    -- it is this character's data, so it moves to the real key. One with a realm-named twin stays where it is.
    if not old and realm ~= "" then
        local orphan
        for key, c in pairs(db.chars) do
            if key:sub(1, #prefix) == prefix and key:sub(-1) == "-" and type(c) == "table" and c.guid == guid
               and (c.realm == nil or c.realm == "") and (not orphan or key < orphan) then orphan = key end
        end
        if orphan then
            db.chars[base], db.chars[orphan] = db.chars[orphan], nil
            db.chars[base].realm = realm
            return base
        end
    end
    if not old or not old.guid then return base end -- preserve ownership of pre-GUID saves
    local tail = guid:match("([^-]+)$") or guid
    local stem = given .. "-" .. (surname or tail)
    local key = stem .. suffix
    if db.chars[key] then
        -- A surname (or even a GUID tail from another server) may already be taken. Never reuse its data.
        stem = stem .. "-" .. guid
        key = stem .. suffix
        local n = 2
        while db.chars[key] do key = stem .. "-" .. n .. suffix; n = n + 1 end
    end
    return key
end

local function ScanGuild()
    if not me then return end
    local inGuild = Plain(Try(IsInGuild))
    local guild = Plain(Try(GetGuildInfo, "player"))
    if inGuild == false then
        me.guild = nil
    elseif type(guild) == "string" and guild ~= "" then
        me.guild = guild
    end -- A guilded character can log in before the server has sent its guild name.
end

local function ScanIdentity()
    me.name, me.surname = PlayerName()
    local realm = RealmName()
    if realm ~= "" or type(me.realm) ~= "string" then me.realm = realm end -- never blank a realm we know
    local className, classFile = UnitClass("player")
    me.class, me.classFile = className, classFile
    me.race, me.faction = UnitRace("player"), UnitFactionGroup("player")
    me.level = Plain(UnitLevel("player"))
    me.sex = Plain(UnitSex("player"))
    ScanGuild()
    me.guid = Plain(UnitGUID("player"))
    local spec = Try(GetSpecialization)
    if spec then
        local _, specName, _, _, role = Try(GetSpecializationInfo, spec)
        me.spec, me.role = Plain(specName), Plain(role)
    end
    me.lastSeen = time()
end

-- Keep a live location at zone changes, movement stops and before leaving the world. Waiting for PLAYER_LOGOUT
-- alone is too late on a normal logout/exit: the map can already be unavailable by then.
local function ScanLocation()
    -- in a dungeon or raid: only the instance's name
    local iname, itype = Try(GetInstanceInfo)
    iname, itype = Plain(iname), Plain(itype)
    if (itype == "party" or itype == "raid") and iname and iname ~= "" then
        me.location = { zone = iname, instance = itype == "raid" and "raid" or "dungeon" }
        me.updated.location = time()
        return true
    end
    local M = C_Map
    local mapID = M and Plain(Try(M.GetBestMapForUnit, "player"))
    local zone = Plain(Try(GetRealZoneText))
    if not zone or zone == "" then zone = Plain(Try(GetZoneText)) end
    if not (mapID and zone and zone ~= "") then return false end
    local loc = { zone = zone, mapID = mapID }
    local sub = Plain(Try(GetSubZoneText))
    if sub and sub ~= "" then loc.subzone = sub end
    local pos = Try(M.GetPlayerMapPosition, mapID, "player")          -- nil inside instances
    if pos and pos.GetXY then
        local x, y = Try(pos.GetXY, pos)
        x, y = Plain(x), Plain(y)
        if x and y and (x > 0 or y > 0) then
            loc.x, loc.y = math.floor(x * 10000 + 0.5) / 100, math.floor(y * 10000 + 0.5) / 100   -- 0-100, like map coordinates
        end
    end
    if not loc.x and me.location and me.location.mapID == mapID and me.location.zone == zone then
        loc.x, loc.y = me.location.x, me.location.y  -- a late partial map read must not erase good coordinates
    end
    me.location = loc
    me.updated.location = time()
    return true
end

-- Where the Hearthstone is set: the inn's town or district, as the Hearthstone's tooltip names it. Read after login
-- and when an innkeeper changes it (HEARTHSTONE_BOUND). An empty answer keeps the last good one.
local function ScanHearth()
    local at = Plain(Try(GetBindLocation))
    if type(at) ~= "string" or at == "" then return false end
    me.hearth = at
    me.updated.hearth = time()
    return true
end

-- Gold and experience. Right at login (before the server sends them) and during logout (after the game clears
-- them) both read as 0, which used to overwrite the real values. So they are read a few seconds after login, on
-- PLAYER_MONEY / PLAYER_XP_UPDATE and by /kinv scan, never at logout, and only once XP has loaded (the XP needed
-- for the next level is never 0 while it has).
local function ScanWallet(moneyEvent)
    if loggingOut or worldLeaving or not loggedInAt then return false end
    local settled = moneyEvent or (GetTime() - loggedInAt) >= 3        -- the server has sent your gold by now
    local money = Plain(GetMoney())
    if settled and type(money) == "number" then me.money = money; me.updated.money = time() end
    -- XP is checked on its own: "XP needed for next level" is never 0 once it has loaded, except at the
    -- level cap, where there is no XP to record (it is then left as it was)
    local xpMax = Plain(UnitXPMax("player"))
    if type(xpMax) ~= "number" or xpMax <= 0 then return settled end
    me.xp, me.xpMax = Plain(UnitXP("player")), xpMax
    me.restedXP = Plain(Try(GetXPExhaustion))
    me.updated.wallet = time()
    return true
end

local function ScanProfessions()
    local list = {}
    local profs = { Try(GetProfessions) }
    for i = 1, 6 do
        local idx = profs[i]
        if idx then
            local name, icon, skill, maxSkill, _, _, skillLine, modifier, specIndex = Try(GetProfessionInfo, idx)
            if name then
                list[#list + 1] = { name = name, icon = icon, skill = Plain(skill), max = Plain(maxSkill),
                                    skillLine = Plain(skillLine), modifier = Plain(modifier), spec = Plain(specIndex),
                                    kind = (i <= 2 and "primary") or "secondary" }
            end
        end
    end
    if #list == 0 and GetNumSkillLines then                        -- older-style skill list
        for i = 1, (Try(GetNumSkillLines) or 0) do
            local name, isHeader, _, rank, _, _, maxRank = Try(GetSkillLineInfo, i)
            if name and not isHeader then list[#list + 1] = { name = name, skill = Plain(rank), max = Plain(maxRank) } end
        end
    end
    me.professions = list
    me.updated.professions = time()
end

local function ScanCurrencies()
    if not (C_CurrencyInfo and C_CurrencyInfo.GetCurrencyListSize) then return end
    local list = {}
    for i = 1, (Try(C_CurrencyInfo.GetCurrencyListSize) or 0) do
        local c = Try(C_CurrencyInfo.GetCurrencyListInfo, i)
        if c and not c.isHeader and c.name then
            local link = Try(C_CurrencyInfo.GetCurrencyListLink, i)
            list[#list + 1] = { name = c.name, id = link and tonumber(link:match("currency:(%d+)")) or nil,
                                quantity = Plain(c.quantity), max = Plain(c.maxQuantity), icon = c.iconFileID,
                                account = c.isAccountWide or nil }
        end
    end
    me.currencies = list
    me.updated.currencies = time()
end

---------------------------------------------------------------------------
-- skills (the character sheet's Skills list: weapon skills, defense, languages, armor, professions)
-- and the spellbook (every ability you know, with its rank)
---------------------------------------------------------------------------
local function ScanSkills()
    local list, header = {}, nil
    local S = C_SkillInfo
    local n = S and Try(S.GetNumSkillLines) or Try(GetNumSkillLines) or 0
    for i = 1, n do
        local s = S and Try(S.GetSkillLineInfo, i)
        if s then
            if s.isHeader then header = Plain(s.name)
            else
                list[#list + 1] = { name = Plain(s.name), skillID = Plain(s.skillID), category = header,
                                    rank = Plain(s.rank), max = Plain(s.maxRank), modifier = Plain(s.modifier),
                                    temp = (Plain(s.tempPoints) or 0) > 0 and s.tempPoints or nil }
            end
        else
            local name, isHeader, _, rank, temp, modifier, maxRank = Try(GetSkillLineInfo, i)
            if isHeader then header = name
            elseif name then list[#list + 1] = { name = name, category = header, rank = Plain(rank), max = Plain(maxRank), modifier = Plain(modifier) } end
        end
    end
    me.skills = list
    me.updated.skills = time()
end

local function ScanSpells()
    local B = C_SpellBook
    if not (B and B.GetNumSpellBookSkillLines and Enum and Enum.SpellBookSpellBank) then return end
    local bank = Enum.SpellBookSpellBank.Player
    local spellType = Enum.SpellBookItemType and Enum.SpellBookItemType.Spell
    local list = {}
    for line = 1, (Try(B.GetNumSpellBookSkillLines) or 0) do
        local info = Try(B.GetSpellBookSkillLineInfo, line)
        if info and not info.shouldHide then
            for slot = info.itemIndexOffset + 1, info.itemIndexOffset + info.numSpellBookItems do
                local s = Try(B.GetSpellBookItemInfo, slot, bank)
                if s and (spellType == nil or s.itemType == spellType) and s.name then
                    list[#list + 1] = { name = Plain(s.name), rank = Plain(s.subName ~= "" and s.subName or nil),
                                        spellID = Plain(s.spellID), tab = Plain(info.name), icon = Plain(s.iconID),
                                        passive = s.isPassive or nil, offSpec = s.isOffSpec or nil }
                end
            end
        end
    end
    me.spells = list
    me.updated.spells = time()
end

---------------------------------------------------------------------------
-- recipes you have learned, with their bill of materials. The game only lists a profession's recipes
-- while its window is open, so each profession is recorded when you open it (and kept until next time).
---------------------------------------------------------------------------
local REAGENT_BASIC = (Enum and Enum.CraftingReagentType and Enum.CraftingReagentType.Basic) or 1
local lastRecipeScan = {}                          -- profession -> { t = GetTime(), n = recipe IDs, skill = level } at the last read
local tradeSkillOpen = false                       -- a profession window is open (TRADE_SKILL_SHOW .. TRADE_SKILL_CLOSE)

local function ItemName(id)
    if not id then return nil end
    return Plain(C_Item and C_Item.GetItemNameByID and Try(C_Item.GetItemNameByID, id)) or nil
end

local function Reagent(slot)
    local r = { quantity = Plain(slot.quantityRequired), required = slot.required or nil }
    local first = slot.reagents and slot.reagents[1]
    if first then
        r.itemID, r.currencyID = Plain(first.itemID), Plain(first.currencyID)
        r.name = ItemName(r.itemID)
    end
    if slot.reagents and #slot.reagents > 1 then                  -- the same reagent in several qualities
        local alt = {}
        for _, x in ipairs(slot.reagents) do alt[#alt + 1] = Plain(x.itemID) end
        r.alternatives = alt
    end
    if slot.slotInfo and slot.slotInfo.slotText then r.slot = Plain(slot.slotInfo.slotText) end
    return r
end

-- plain text from a string with color codes, textures and line breaks in it
local function PlainText(t)
    t = Plain(t)
    if type(t) ~= "string" then return nil end
    t = t:gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", ""):gsub("|T.-|t", ""):gsub("|A.-|a", ""):gsub("|n", "; "):gsub("\n", "; ")
    t = t:gsub("%s+", " "):gsub("^[%s;]+", ""):gsub("[%s;]+$", "")
    return t ~= "" and t or nil
end

local function ScanRecipes(force)
    local T = C_TradeSkillUI
    if not (T and T.GetRecipeInfo and T.GetRecipeSchematic) then return end
    -- someone else's list (a linked profession, guild crafters, an NPC crafter) is not yours
    if Try(T.IsTradeSkillLinked) or Try(T.IsTradeSkillGuild) or Try(T.IsNPCCrafting) then return end
    if T.IsTradeSkillReady and not Try(T.IsTradeSkillReady) then Soon("recipes", ScanRecipes, 1, force); return end
    local prof = Try(T.GetBaseProfessionInfo) or {}
    local child = Try(T.GetChildProfessionInfo) or {}
    local name = Plain(prof.professionName) or Plain(child.professionName)
    if not name or name == "" then return end
    local ids = Try(T.GetAllRecipeIDs) or Try(T.GetFilteredRecipeIDs) or {}
    local skill = Plain(child.skillLevel or prof.skillLevel)
    -- Crafting fires "list changed" after every craft, and a full read rebuilds the record of every recipe (and the
    -- game hands back fresh info tables for each): megabytes of garbage a minute while crafting. So a craft re-reads
    -- only when something recorded changed: a longer or shorter list at once; a skill-up (difficulty colors) at most
    -- once per 30 s, with one more read after the last one if the window is still open. Opening the window,
    -- switching professions and learning a recipe always read (force).
    if not force and #ids == 0 then return end           -- a window already gone never empties the record
    local last = lastRecipeScan[name]
    if not force and last and last.n == #ids then
        if last.skill == skill then return end
        local wait = 30 - (GetTime() - last.t)
        if wait > 0 then
            Soon("recipes", function() if tradeSkillOpen then ScanRecipes() end end, wait)
            return
        end
    end
    lastRecipeScan[name] = { t = GetTime(), n = #ids, skill = skill }

    local recipes, unlearned = {}, {}
    for _, id in ipairs(ids) do
        local info = Try(T.GetRecipeInfo, id)
        if info and not info.learned then
            -- not known yet: what it makes and where it is learned (only the ones the window lists, so its
            -- "show unlearned" filter must be on)
            local s = Try(T.GetRecipeSchematic, id, false) or {}
            local u = { recipeID = id, name = Plain(info.name), outputItemID = Plain(s.outputItemID),
                        source = T.GetRecipeSourceText and PlainText(Try(T.GetRecipeSourceText, id)) or nil,
                        makesMin = Plain(s.quantityMin), makesMax = Plain(s.quantityMax), reagents = {} }
            for _, slot in ipairs(s.reagentSlotSchematics or {}) do
                if slot.reagentType == REAGENT_BASIC then u.reagents[#u.reagents + 1] = Reagent(slot) end
            end
            unlearned[#unlearned + 1] = u
        elseif info and info.learned then
            local s = Try(T.GetRecipeSchematic, id, false) or {}
            local rec = {
                recipeID = id, name = Plain(info.name), icon = Plain(info.icon), link = Plain(info.hyperlink),
                categoryID = Plain(info.categoryID), difficulty = Plain(info.relativeDifficulty),
                skillUps = Plain(info.numSkillUps), canSkillUp = info.canSkillUp or nil,
                outputItemID = Plain(s.outputItemID), outputName = ItemName(Plain(s.outputItemID)),
                makesMin = Plain(s.quantityMin), makesMax = Plain(s.quantityMax),
                reagents = {}, optional = {},
            }
            for _, slot in ipairs(s.reagentSlotSchematics or {}) do
                if slot.reagentType == REAGENT_BASIC then
                    rec.reagents[#rec.reagents + 1] = Reagent(slot)
                else                                                  -- optional / finishing reagents
                    rec.optional[#rec.optional + 1] = Reagent(slot)
                end
            end
            if #rec.optional == 0 then rec.optional = nil end
            recipes[#recipes + 1] = rec
        end
    end
    if ns.RecordSell then                                 -- what a vendor pays for each material and product (Prices.lua)
        for _, list in ipairs({ recipes, unlearned }) do
            for _, r in ipairs(list) do
                ns.RecordSell(r.outputItemID)
                for _, x in ipairs(r.reagents or {}) do ns.RecordSell(x.itemID) end
            end
        end
    end
    me.recipes = me.recipes or {}
    -- The unlearned recipes are the same for every character with the profession: saved once per account file
    -- (db.recipeBook), and this book keeps their ids (Saved.lua). Without that file: the list itself, as before.
    local S = ns.Saved
    if S and type(me.recipes[name]) == "table" then me.recipes[name].unlearnedIds = nil end   -- this book's old list no longer counts
    local shared, ids = false, nil
    if S then shared, ids = pcall(S.Share, db, unlearned) end
    me.recipes[name] = {
        professionID = Plain(prof.professionID), skill = Plain(child.skillLevel or prof.skillLevel),
        max = Plain(child.maxSkillLevel or prof.maxSkillLevel), updated = time(), recipes = recipes,
        unlearned = not shared and unlearned or nil, unlearnedIds = shared and ids or nil,
    }
    if S then pcall(S.Sweep, db) end
    me.updated.recipes = time()
end

---------------------------------------------------------------------------
-- trainers: everything the open trainer teaches, with the skill / level it needs, its cost, and whether you can
-- learn it now ("available"), not yet ("unavailable") or know it ("used"). The trainer window's filters hide
-- entries from addons too, so all three are switched on for the read and put back afterwards.
---------------------------------------------------------------------------
local readingTrainer = false
local TRAINER_FILTERS = { "available", "unavailable", "used" }

-- The hunter's Beast Training window is a trainer window too (C_Trainer.GetTrainerType() == Enum.TrainerType.Pet): it
-- is not this character's class or profession trainer, so it never replaces trainers.class.
local function PetTrainer()
    local T = C_Trainer
    if not (T and T.GetTrainerType) then return false end
    local pet = Enum and Enum.TrainerType and Enum.TrainerType.Pet or 3
    return Plain(Try(T.GetTrainerType)) == pet
end

local function ScanTrainer()
    if readingTrainer or not GetNumTrainerServices or PetTrainer() then return end
    readingTrainer = true
    local saved = {}
    if GetTrainerServiceTypeFilter and SetTrainerServiceTypeFilter then
        for _, f in ipairs(TRAINER_FILTERS) do
            saved[f] = Try(GetTrainerServiceTypeFilter, f) and true or false
            if not saved[f] then Try(SetTrainerServiceTypeFilter, f, true) end
        end
    end
    local list, skillCount = {}, {}
    for i = 1, (Try(GetNumTrainerServices) or 0) do
        local name, status, _, reqLevel = Try(GetTrainerServiceInfo, i)
        name, status = Plain(name), Plain(status)
        if name and status ~= "header" then
            local skillName, skillReq = Try(GetTrainerServiceSkillReq, i)
            skillName, skillReq = Plain(skillName), Plain(skillReq)
            if skillName then skillCount[skillName] = (skillCount[skillName] or 0) + 1 end
            local lvl = Plain(Try(GetTrainerServiceLevelReq, i)) or Plain(reqLevel)
            list[#list + 1] = { name = name, skillReq = skillReq, cost = Plain(Try(GetTrainerServiceCost, i)),
                                reqLevel = lvl, status = status }
        end
    end
    for f, was in pairs(saved) do
        if not was then Try(SetTrainerServiceTypeFilter, f, false) end
    end
    readingTrainer = false
    if #list == 0 then return end
    -- which profession: the skill most entries ask for (a class trainer's entries ask for none)
    local key, best = nil, 0
    for k, n in pairs(skillCount) do if n > best then key, best = k, n end end
    key = key or ((Try(IsTradeskillTrainer) and "profession") or "class")
    me.trainers = me.trainers or {}
    me.trainers[key] = list
    me.updated.trainers = time()
end

---------------------------------------------------------------------------
-- reputation. Collapsed headers in the reputation window hide their factions from addons too, so they are
-- opened for the moment of the read and closed again afterwards (the window looks exactly as before). Each collapsed
-- header is opened on its own from the top down, so one nested in a collapsed header shows up next and is opened (and
-- later closed) too; the headers are closed again from the bottom up also when the read fails part-way.
---------------------------------------------------------------------------
local readingReps = false

local function RepCount(R) return math.min(tonumber(Plain(Try(R.GetNumFactions))) or 0, 1000) end
local function RepHeaderKey(f)                                -- a header's factionID, else its name; nil: it is left alone
    local id, name = Plain(f.factionID), Plain(f.name)
    if type(id) == "number" and id > 0 then return id end
    if type(name) == "string" and name ~= "" then return "name:" .. name end
end

local function ReadReputation(R)
    local list, header, subHeader = {}, nil, nil
    for i = 1, RepCount(R) do
        local f = Try(R.GetFactionDataByIndex, i)
        if f and f.name then
            if f.isHeader and not f.isChild then header, subHeader = Plain(f.name), nil
            elseif f.isHeader then subHeader = Plain(f.name) end
            if not f.isHeader or f.isHeaderWithRep then
                local rep = {
                    factionID = Plain(f.factionID), name = Plain(f.name), group = header, subGroup = subHeader,
                    reaction = Plain(f.reaction), standing = Plain(_G["FACTION_STANDING_LABEL" .. tostring(f.reaction)]),
                    value = Plain(f.currentStanding), min = Plain(f.currentReactionThreshold), max = Plain(f.nextReactionThreshold),
                    atWar = f.atWarWith or nil, accountWide = f.isAccountWide or nil, watched = f.isWatched or nil,
                }
                if R.IsFactionParagon and Try(R.IsFactionParagon, f.factionID) then
                    local cur, threshold, _, pending = Try(R.GetFactionParagonInfo, f.factionID)
                    rep.paragon = { value = Plain(cur), threshold = Plain(threshold), rewardPending = pending or nil }
                end
                if C_GossipInfo and C_GossipInfo.GetFriendshipReputation then
                    local fr = Try(C_GossipInfo.GetFriendshipReputation, f.factionID)
                    if fr and fr.friendshipFactionID and fr.friendshipFactionID > 0 then
                        rep.standing = Plain(fr.reaction) or rep.standing
                        rep.value, rep.min, rep.max = Plain(fr.standing), Plain(fr.reactionThreshold), Plain(fr.nextThreshold)
                    end
                end
                list[#list + 1] = rep
            end
        end
    end
    return list
end

local function ScanReputation()
    local R = C_Reputation
    if not (R and R.GetNumFactions and R.GetFactionDataByIndex) then return end
    readingReps = true
    local opened = {}                                         -- keys of the headers the player had collapsed
    local ok, list = pcall(function()
        if type(R.ExpandFactionHeader) == "function" then     -- without it, only what the window shows is read
            local i, n = 1, RepCount(R)
            while i <= n do
                local f = Try(R.GetFactionDataByIndex, i)
                local key = type(f) == "table" and Plain(f.isHeader) == true and Plain(f.isCollapsed) == true and RepHeaderKey(f)
                if key and not opened[key] then
                    opened[key] = true
                    Try(R.ExpandFactionHeader, i)
                    n = RepCount(R)
                end
                i = i + 1
            end
        end
        return ReadReputation(R)
    end)
    if next(opened) then                                      -- put the window back the way it was
        local function close(i)
            local f = Try(R.GetFactionDataByIndex, i)
            local key = type(f) == "table" and Plain(f.isHeader) == true and Plain(f.isCollapsed) == false and RepHeaderKey(f)
            if key and opened[key] then Try(R.CollapseFactionHeader, i) end
        end
        for i = RepCount(R), 1, -1 do pcall(close, i) end     -- from the bottom up, so indexes don't shift; row by row
    end
    readingReps = false
    if not ok then error(list, 0) end
    me.reputation = list
    me.updated.reputation = time()
end

---------------------------------------------------------------------------
-- statistics (the Statistics tab of the achievement window: kills, deaths, quests, dungeons, ...)
-- Only the ones with a value are kept. Re-read at login and then at most every 10 minutes, out of combat.
---------------------------------------------------------------------------
local lastStats = 0

local function ScanStatistics(force)
    if not (GetStatisticsCategoryList and GetStatistic) then return end
    if InCombatLockdown() then return end
    if not force and GetTime() - lastStats < 600 then return end
    lastStats = GetTime()
    local list = {}
    for _, cat in ipairs(Try(GetStatisticsCategoryList) or {}) do
        local catName, parentID = Try(GetCategoryInfo, cat)
        local parentName = (parentID and parentID > 0) and Try(GetCategoryInfo, parentID) or nil
        for i = 1, (Try(GetCategoryNumAchievements, cat) or 0) do
            local id, name = Try(GetAchievementInfo, cat, i)
            if id then
                local value = Plain(Try(GetStatistic, id))
                if value ~= nil and value ~= "" and value ~= "--" and value ~= "0" then
                    list[#list + 1] = { id = id, name = Plain(name), category = Plain(catName), parent = Plain(parentName),
                                        value = tonumber(value) or value }
                end
            end
        end
    end
    -- the values that changed since the last reading go under today, for 30 days (Saved.lua); the list is the newest
    if ns.Saved then pcall(ns.Saved.StatDays, me, list, math.floor(time() / 86400)) end
    me.statistics = list
    me.achievementPoints = Plain(Try(GetTotalAchievementPoints))
    me.updated.statistics = time()
end

---------------------------------------------------------------------------
-- PvP: kills, honor, honor level, rated brackets you have played
---------------------------------------------------------------------------
local function ScanPvP()
    local p = {}
    local hk, dk, rank = Try(GetPVPLifetimeStats)
    p.honorableKills, p.dishonorableKills, p.highestRank = Plain(hk), Plain(dk), Plain(rank)
    local shk, shonor = Try(GetPVPSessionStats)
    p.todayKills, p.todayHonor = Plain(shk), Plain(shonor)
    local yhk, yhonor = Try(GetPVPYesterdayStats)
    p.yesterdayKills, p.yesterdayHonor = Plain(yhk), Plain(yhonor)
    p.honorLevel = Plain(Try(UnitHonorLevel, "player"))
    p.honor, p.honorMax = Plain(Try(UnitHonor, "player")), Plain(Try(UnitHonorMax, "player"))
    local rated = {}
    for bracket = 1, 9 do
        local rating, seasonBest, weeklyBest, seasonPlayed, seasonWon, weeklyPlayed, weeklyWon = Try(GetPersonalRatedInfo, bracket)
        rating, seasonPlayed = Plain(rating), Plain(seasonPlayed)
        if (rating and rating > 0) or (seasonPlayed and seasonPlayed > 0) then
            rated[#rated + 1] = { bracket = bracket, rating = rating, seasonBest = Plain(seasonBest), weeklyBest = Plain(weeklyBest),
                                  seasonPlayed = seasonPlayed, seasonWon = Plain(seasonWon),
                                  weeklyPlayed = Plain(weeklyPlayed), weeklyWon = Plain(weeklyWon) }
        end
    end
    p.rated = rated
    me.pvp = p
    me.updated.pvp = time()
end

---------------------------------------------------------------------------
-- quest log: current quests and objective progress, in log order (at most 35 quests, 12 objectives each).
-- Collapsed headers hide quests from the log APIs too, so out of combat they are expanded for the read
-- and collapsed back afterwards (in combat, if any header is collapsed, the read waits for combat to end
-- rather than mutating the quest log frame or saving a partial list).
---------------------------------------------------------------------------
local readingQuests, questsWaiting = false, false
local questsToggledAt = -1e9   -- GetTime() of our own header expand/collapse: its QUEST_LOG_UPDATE comes a frame later

local qlog = { MAX_QUESTS = 35, MAX_OBJ = 12, MAX_ROWS = 200 }

function qlog.Int(v, min)
    v = Plain(v)
    if type(v) == "number" and v >= (min or 0) and v <= 2147483647 and v == math.floor(v) then return v end
end

function qlog.Cut(s, max)
    if #s <= max then return s end
    local i = max
    while i > 0 and s:byte(i + 1) >= 128 and s:byte(i + 1) < 192 do i = i - 1 end
    return s:sub(1, i)
end

function qlog.ReplaceName(s, name)
    local pat = name:gsub("(%W)", "%%%1")
    if name:find("^%w") then pat = "%f[%w]" .. pat end
    if name:find("%w$") then pat = pat .. "%f[%W]" end
    return (s:gsub(pat, "$N"))
end

function qlog.Text(s, max, names)
    s = Plain(s)
    if type(s) ~= "string" then return nil end
    s = s:gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", ""):gsub("|T.-|t", ""):gsub("|A.-|a", "")
         :gsub("|H.-|h", ""):gsub("|h", ""):gsub("|n", " "):gsub("[\r\n]", " "):gsub("%c", "")
         :gsub("|", ""):gsub("%s+", " "):gsub("^%s+", ""):gsub("%s+$", "")
    if s == "" then return nil end
    for _, name in ipairs(names) do s = qlog.ReplaceName(s, name) end
    s = qlog.Cut(s, max):gsub("%s+$", "")
    return s ~= "" and s or nil
end

function qlog.OwnNames()
    local given, surname = PlayerName()
    if type(given) ~= "string" or given == "" then return {} end
    if type(surname) == "string" and surname ~= "" then return { given .. " " .. surname, given, surname } end
    return { given }
end

function qlog.Mode()
    local L = C_QuestLog
    if type(L) == "table" and type(L.GetNumQuestLogEntries) == "function" and type(L.GetInfo) == "function" then
        return "modern", L
    end
    if type(GetNumQuestLogEntries) == "function" and type(GetQuestLogTitle) == "function" then
        return "legacy", nil
    end
    return nil, nil
end

function qlog.Counts(mode, L)
    local shown, total
    if mode == "modern" then shown, total = Try(L.GetNumQuestLogEntries)
    else shown, total = Try(GetNumQuestLogEntries) end
    shown = qlog.Int(shown, 0)
    if not shown then return nil, nil end
    return math.min(shown, qlog.MAX_ROWS), qlog.Int(total, 0)
end

function qlog.HeaderState(mode, L, i)
    if mode == "modern" then
        local info = Plain(Try(L.GetInfo, i))
        if type(info) ~= "table" then return false, false, nil end
        return Plain(info.isHeader) == true, Plain(info.isCollapsed) == true, Plain(info.title)
    end
    local title, _, _, isHeader, isCollapsed = Try(GetQuestLogTitle, i)
    return Plain(isHeader) == true, Plain(isCollapsed) == true, Plain(title)
end

function qlog.Row(mode, L, i)
    if mode == "modern" then
        local info = Plain(Try(L.GetInfo, i))
        if type(info) ~= "table" then return nil end
        local isHeader = Plain(info.isHeader) == true
        local isHidden = Plain(info.isHidden) == true or Plain(info.isInternalOnly) == true
        local id = not isHeader and qlog.Int(info.questID, 1) or nil
        local title = Plain(info.title)
        if not isHeader and id and (type(title) ~= "string" or title == "") then
            if type(L.GetTitleForQuestID) == "function" then title = Plain(Try(L.GetTitleForQuestID, id)) end
            if (type(title) ~= "string" or title == "") and type(L.GetTitleForLogIndex) == "function" then
                title = Plain(Try(L.GetTitleForLogIndex, i))
            end
        end
        local failed = id and type(L.IsFailed) == "function" and Plain(Try(L.IsFailed, id)) == true or false
        local done = false
        if id and not failed then
            if type(L.IsComplete) == "function" and Plain(Try(L.IsComplete, id)) == true then done = true
            elseif type(L.ReadyForTurnIn) == "function" and Plain(Try(L.ReadyForTurnIn, id)) == true then done = true end
        end
        return { isHeader = isHeader, isHidden = isHidden, title = title, id = id,
                 lv = qlog.Int(info.level, 1), done = done, failed = failed }
    end
    local title, level, _, isHeader, _, isComplete, _, questID = Try(GetQuestLogTitle, i)
    isHeader = Plain(isHeader) == true
    local comp = Plain(isComplete)
    local failed = comp == -1
    local done = (not failed) and (comp == 1 or comp == true)
    return { isHeader = isHeader, isHidden = false, title = Plain(title),
             id = not isHeader and qlog.Int(questID, 1) or nil,
             lv = qlog.Int(level, 1), done = done, failed = failed }
end

function qlog.Objectives(L, id, logIndex, names)
    local obj = {}
    local getObj = (type(L) == "table" and L.GetQuestObjectives)
                   or (type(C_QuestLog) == "table" and C_QuestLog.GetQuestObjectives) or nil
    if type(getObj) == "function" then
        local list = Plain(Try(getObj, id))
        if type(list) == "table" then
            for _, raw in ipairs(list) do
                local r = Plain(raw)
                if type(r) == "table" then
                    local text = qlog.Text(r.text, 400, names)
                    if text then
                        local otype = Plain(r.type)
                        if type(otype) ~= "string" or #otype > 40 or not otype:match("^[a-z][a-z0-9_%-]*$") then otype = nil end
                        obj[#obj + 1] = {
                            text = text,
                            have = qlog.Int(r.numFulfilled, 0),
                            need = qlog.Int(r.numRequired, 0),
                            done = Plain(r.finished) == true,
                            type = otype,
                        }
                        if #obj >= qlog.MAX_OBJ then break end
                    end
                end
            end
        end
    elseif type(GetNumQuestLeaderBoards) == "function" and type(GetQuestLogLeaderBoard) == "function" then
        local n = math.min(qlog.Int(Try(GetNumQuestLeaderBoards, logIndex), 0) or 0, 40)
        for j = 1, n do
            local desc, otype, finished = Try(GetQuestLogLeaderBoard, j, logIndex)
            local text = qlog.Text(desc, 400, names)
            if text then
                otype = Plain(otype)
                if type(otype) ~= "string" or #otype > 40 or not otype:match("^[a-z][a-z0-9_%-]*$") then otype = nil end
                obj[#obj + 1] = { text = text, done = Plain(finished) == true, type = otype }
                if #obj >= qlog.MAX_OBJ then break end
            end
        end
    end
    return obj
end

function qlog.Read(mode, L, names)
    local shown, total = qlog.Counts(mode, L)
    if not shown then return nil end
    local quests, seen, header = {}, {}, nil
    for i = 1, shown do
        local r = qlog.Row(mode, L, i)
        if r then
            if r.isHeader then
                header = qlog.Text(r.title, 120, names)
            elseif not r.isHidden and r.id and not seen[r.id] then
                local title = qlog.Text(r.title, 200, names)
                if title then
                    seen[r.id] = true
                    quests[#quests + 1] = {
                        id = r.id,
                        title = title,
                        lv = (r.lv and r.lv <= 255) and r.lv or nil,
                        header = header,
                        done = r.done and true or nil,
                        failed = r.failed and true or nil,
                        obj = qlog.Objectives(L, r.id, i, names),
                    }
                    if #quests >= qlog.MAX_QUESTS then break end
                end
            end
        end
    end
    if #quests == 0 and ((total and total > 0) or (total == nil and shown > 0)) then return nil end
    return { at = time(), quests = quests }
end

local function ScanQuestLog()
    if not me or loggingOut or worldLeaving or readingQuests then return false end
    local mode, L = qlog.Mode()
    if not mode then return false end
    local shown = qlog.Counts(mode, L)
    if not shown then return false end
    local hasCollapsed = false
    for i = 1, shown do
        local isH, isC = qlog.HeaderState(mode, L, i)
        if isH and isC then hasCollapsed = true; break end
    end
    if hasCollapsed and Plain(Try(InCombatLockdown)) == true then
        questsWaiting = true
        return false
    end
    local names = qlog.OwnNames()
    readingQuests = true
    local opened = {}
    local ok, snap = pcall(function()
        if hasCollapsed and type(ExpandQuestHeader) == "function" and type(CollapseQuestHeader) == "function" then
            local i, n = 1, shown
            while i <= n do
                local isH, isC, title = qlog.HeaderState(mode, L, i)
                if isH and isC and type(title) == "string" and title ~= "" and not opened[title] then
                    opened[title] = true
                    Try(ExpandQuestHeader, i)
                    n = (qlog.Counts(mode, L)) or n
                end
                i = i + 1
            end
        end
        return qlog.Read(mode, L, names)
    end)
    if next(opened) then
        local n = (qlog.Counts(mode, L)) or 0
        local function close(idx)
            local isH, isC, title = qlog.HeaderState(mode, L, idx)
            if isH and not isC and type(title) == "string" and opened[title] then
                Try(CollapseQuestHeader, idx)
            end
        end
        for idx = n, 1, -1 do pcall(close, idx) end
        questsToggledAt = GetTime()
    end
    readingQuests = false
    if not ok then error(snap, 0) end
    if not snap then return false end
    questsWaiting = false
    me.questLog = snap
    me.updated.questLog = snap.at
    return true
end

---------------------------------------------------------------------------
-- talents: the modern trees (class / spec / hero) when the client has them, else the old talent tabs.
-- Only the talents you have taken are stored (with rank), plus unspent points and the loadout name.
---------------------------------------------------------------------------
local function SpellName(spellID)
    if not spellID then return nil end
    if C_Spell and C_Spell.GetSpellName then return Plain(Try(C_Spell.GetSpellName, spellID)) end
    return Plain((Try(GetSpellInfo, spellID)))
end

local function ActiveConfigID()
    local id = C_ClassTalents and Try(C_ClassTalents.GetActiveConfigID)
    if id then return id end
    -- Forever's own talent window (Camelot): one config per spec group (primary / secondary)
    if C_SpecializationInfo and C_SpecializationInfo.GetCombatConfigIDForSpecGroup then
        local group = Try(C_SpecializationInfo.GetActiveSpecGroup) or 1
        return Try(C_SpecializationInfo.GetCombatConfigIDForSpecGroup, group)
    end
end

local function TraitTalents()
    if not C_Traits then return nil, "no C_Traits" end
    local configID = ActiveConfigID()
    if not configID then return nil, "no talent config (no talent points yet?)" end
    local config = Try(C_Traits.GetConfigInfo, configID)
    if not (config and config.treeIDs) then return nil, "talent config " .. tostring(configID) .. " has no trees" end
    local t = { system = "traits", configID = configID, trees = {}, taken = {}, groups = {} }
    t.specGroup = C_SpecializationInfo and Plain(Try(C_SpecializationInfo.GetActiveSpecGroup))
    -- the named parts of a tree (on Forever: the old three talent tabs, e.g. Arms / Fury / Protection)
    local groupName = {}
    for _, treeID in ipairs(config.treeIDs) do
        local infos = Try(C_Traits.GetGroupDisplayInfoByTreeID, treeID) or {}
        local ids = {}
        for _, g in ipairs(infos) do ids[#ids + 1] = g.groupID; groupName[g.groupID] = Plain(g.displayName) end
        local points = {}
        for _, gc in ipairs((#ids > 0 and Try(C_Traits.GetGroupCurrencyInfo, configID, ids)) or {}) do
            points[gc.traitNodeGroupID] = gc.currencyInfos
        end
        for _, g in ipairs(infos) do
            local entry = { groupID = g.groupID, treeID = treeID, name = Plain(g.displayName), order = Plain(g.orderIndex) }
            for _, cur in ipairs(points[g.groupID] or {}) do
                entry.spent = (entry.spent or 0) + (Plain(cur.spent) or 0)
                entry.unspent = Plain(cur.quantity)
                entry.max = Plain(cur.maxQuantity)
            end
            t.groups[#t.groups + 1] = entry
        end
    end
    local spec = Try(GetSpecialization)
    local specID = spec and Try(GetSpecializationInfo, spec)
    if specID and C_ClassTalents.GetLastSelectedSavedConfigID then
        local saved = Try(C_ClassTalents.GetLastSelectedSavedConfigID, specID)
        local info = saved and Try(C_Traits.GetConfigInfo, saved)
        t.loadout = info and Plain(info.name)
    end
    t.importString = Plain(Try(C_Traits.GenerateImportString, configID))      -- paste-able in the talent window
    for _, treeID in ipairs(config.treeIDs) do
        local tree = { treeID = treeID, points = {} }
        for _, cur in ipairs(Try(C_Traits.GetTreeCurrencyInfo, configID, treeID, false) or {}) do
            tree.points[#tree.points + 1] = { unspent = Plain(cur.quantity), max = Plain(cur.maxQuantity), spent = Plain(cur.spent) }
        end
        t.trees[#t.trees + 1] = tree
        for _, nodeID in ipairs(Try(C_Traits.GetTreeNodes, treeID) or {}) do
            local node = Try(C_Traits.GetNodeInfo, configID, nodeID)
            local rank = node and Plain(node.activeRank)
            if rank and rank > 0 and node.activeEntry then
                local entryID = node.activeEntry.entryID
                local entry = entryID and Try(C_Traits.GetEntryInfo, configID, entryID)
                local def = entry and entry.definitionID and Try(C_Traits.GetDefinitionInfo, entry.definitionID)
                local spellID = def and Plain(def.spellID)
                local group
                for _, gid in ipairs(node.groupIDs or {}) do group = group or groupName[gid] end
                t.taken[#t.taken + 1] = {
                    treeID = treeID, nodeID = nodeID, entryID = entryID, spellID = spellID, group = group,
                    name = (def and Plain(def.overrideName)) or SpellName(spellID),
                    rank = rank, maxRank = Plain(node.maxRanks), subTreeID = Plain(node.subTreeID),
                    x = Plain(node.posX), y = Plain(node.posY),
                }
            end
        end
    end
    return t
end

local function TabTalents()                               -- the old 3-tab talent trees
    if not (C_SpecializationInfo and C_SpecializationInfo.GetTalentInfo) then return nil end
    local t = { system = "tabs", tabs = {}, taken = {} }
    for tab = 1, 5 do
        local _, tabName, _, _, spent = Try(GetTalentTabInfo, tab)
        local any = false
        for i = 1, 60 do
            local info = Try(C_SpecializationInfo.GetTalentInfo, { specializationIndex = tab, talentIndex = i })
            if not info then break end
            any = true
            local rank = Plain(info.rank)
            if rank and rank > 0 then
                t.taken[#t.taken + 1] = { tab = tab, index = i, talentID = Plain(info.talentID), spellID = Plain(info.spellID),
                                          name = Plain(info.name), rank = rank, maxRank = Plain(info.maxRank),
                                          tier = Plain(info.tier), column = Plain(info.column) }
            end
        end
        if not any and not tabName then break end
        t.tabs[#t.tabs + 1] = { tab = tab, name = Plain(tabName), spent = Plain(spent) }
    end
    t.unspent = Plain(Try(GetUnspentTalentPoints))
    if #t.tabs == 0 then return nil end
    return t
end

-- Blizzard_LegacySystem is load-on-demand; only the client APIs/constants are needed here.
local function ScanLegacyTree()
    if not C_Traits then return end
    local const = Constants and Constants.LegacyConsts or {}
    local treeIDs = { const.LEGACY_TREE_PROFESSIONS_ID or 1187, const.LEGACY_TREE_ADVENTURE_ID or 1188,
                      const.LEGACY_TREE_PROGRESSION_ID or 1189 }
    local result = { trees = {}, choices = {} }
    local function number(v)
        v = Plain(v)
        if type(v) == "number" and v >= 0 and v < math.huge and v == math.floor(v) then return v end
    end
    for _, treeID in ipairs(treeIDs) do
        local configID = Plain(Try(C_Traits.GetConfigIDByTreeID, treeID))
        if not configID then return end
        -- Clicked but not applied yet: node info is a preview, so keep the last applied reading until Apply Changes.
        if Try(C_Traits.ConfigHasStagedChanges, configID) then return end
        local currencies = Try(C_Traits.GetTreeCurrencyInfo, configID, treeID, true) -- applied only, not staged
        local currency = currencies and currencies[1]
        local nodes = Try(C_Traits.GetTreeNodes, treeID)
        if not currency or type(nodes) ~= "table" or not next(nodes) then return end
        local spentInTree = number(currency.spentInTree)
        if not spentInTree then return end
        if not result.currency then
            local available, spent, max = number(currency.quantity), number(currency.spent), number(currency.maxQuantity)
            if not available or not spent or not max then return end
            result.currency = { available = available, spent = spent, max = max }
        end
        local tree = { spentInTree = spentInTree, nodes = {} }
        for _, nodeID in ipairs(nodes) do
            local node = Try(C_Traits.GetNodeInfo, configID, nodeID)
            if not node then return end
            -- Nothing is staged here (checked above), so the preview ranks are the applied ones.
            local rank = number(node.activeRank) or number(node.ranksPurchased)
            if rank and rank > 0 then
                tree.nodes[tostring(nodeID)] = rank
            end
            local types = Enum and Enum.TraitNodeType or {}
            local choice = (node.type ~= nil and (node.type == types.Selection or node.type == types.SubTreeSelection))
                           or (type(node.entryIDs) == "table" and #node.entryIDs > 1)
            local committed = type(node.entryIDsWithCommittedRanks) == "table" and node.entryIDsWithCommittedRanks[1]
            local entryID = number(committed) or (node.activeEntry and number(node.activeEntry.entryID))
            if choice and entryID and entryID > 0 then result.choices[tostring(nodeID)] = entryID end
        end
        result.trees[tostring(treeID)] = tree
    end
    me.legacyTree = result
    me.updated.legacyTree = time()
end

local function ScanTalents()
    ScanLegacyTree()
    local t, why = TraitTalents()
    t = t or TabTalents()
    if not t then
        me.talents = { system = "none", reason = why }      -- /kinv and the JSON say why
        me.updated.talents = time()
        return
    end
    if C_SpecializationInfo and C_SpecializationInfo.GetAllSelectedPvpTalentIDs then
        local pvp = {}
        for _, id in ipairs(Try(C_SpecializationInfo.GetAllSelectedPvpTalentIDs) or {}) do pvp[#pvp + 1] = Plain(id) end
        t.pvp = pvp
    end
    t.spec = me.spec
    me.talents = t
    me.updated.talents = time()
end

---------------------------------------------------------------------------
-- guild bank (only the tab you are looking at is sent by the server)
---------------------------------------------------------------------------
local function ScanGuildBankTab()
    if not (guildBankOpen and GetCurrentGuildBankTab) then return end
    local guild = Plain(Try(GetGuildInfo, "player"))
    if not guild then return end
    local key = guild .. "-" .. RealmName()
    local g = db.guilds[key] or { tabs = {} }
    db.guilds[key] = g
    local tab = Try(GetCurrentGuildBankTab)
    if not tab then return end
    local name, icon, viewable = Try(GetGuildBankTabInfo, tab)
    if not viewable then return end
    local box = { name = name, icon = icon, items = {}, size = 98 }
    for slot = 1, 98 do
        local link = Try(GetGuildBankItemLink, tab, slot)
        if link then
            local tex, count, _, _, quality = Try(GetGuildBankItemInfo, tab, slot)
            box.items[slot] = Item(link, count, quality, nil, nil, tex)
        end
    end
    box.updated = time()
    g.tabs[tab] = box
    g.money = Plain(Try(GetGuildBankMoney)) or g.money
    g.updated = time()
end

---------------------------------------------------------------------------
-- events
---------------------------------------------------------------------------
local ev = CreateFrame("Frame")
local statsWaiting = false

local function WantStats()
    statsWaiting = true
    Soon("stats", function() if ScanStats() then statsWaiting = false end end, 2)
end

local function SetBankOpen(open)
    bankOpen = open
    if open then Soon("bags", ScanBags, 0.5, true) end
end

local function PendingKeys()
    local keys = {}
    for key in pairs(pendingRun) do keys[#keys + 1] = key end
    table.sort(keys)
    return keys
end

local function Checkpoint(reason)
    if not me or loggingOut then return end
    pcall(ScanLocation)
    -- Only flush while the player's data is still present. In particular, do not turn an unloaded bag read
    -- into an empty inventory. The final logout handler only seals the already collected snapshot.
    local ready = not worldLeaving and loggedInAt and GetTime() - loggedInAt >= 3 and me.guid
                  and Try(UnitExists, "player") and Try(UnitGUID, "player") == me.guid
                  and (Try(C_Container.GetContainerNumSlots, 0) or 0) > 0
    if ready then
        local keys = PendingKeys()
        local failed, ranQuests = {}, false
        for _, key in ipairs(keys) do
            local pending = pendingRun[key]
            if pending then
                pendingRun[key] = nil       -- invalidate its timer before running it (a retry gets a new token)
                if key == "quests" then ranQuests = true end
                -- PLAYER_MONEY records spending immediately. A new zero during teardown is not fresh gold.
                if key ~= "wallet" or Try(GetMoney) ~= 0 or not me.money or me.money == 0 then
                    local ok, err = pcall(pending.fn, pending.force)
                    if not ok then
                        db.lastError = key .. ": " .. tostring(err)
                        failed[#failed + 1] = key
                    end
                else
                    pendingRun[key] = pending  -- retain the skipped read in the final save diagnostics
                end
            end
        end
        if not ranQuests and reason ~= "PLAYER_ENTERING_WORLD" then
            local ok, err = pcall(ScanQuestLog)
            if not ok then
                db.lastError = "quests: " .. tostring(err)
                failed[#failed + 1] = "quests"
            end
        end
        me.recording = { checkpointAt = time(), checkpoint = reason, pending = PendingKeys(), failed = failed }
    end
end

local handlers = {}

ns.Me = function() return me end              -- this character's entry, nil before PLAYER_LOGIN (Crafts.lua)
ns.CharacterKey = function() return meKey end -- shared attribution (warband and Raids.lua)

function handlers.ADDON_LOADED(name)
    if name ~= ADDON then return end
    hadInventory = type(KutzInventoryDB) == "table"
    KutzInventoryDB = KutzInventoryDB or {}
    db = KutzInventoryDB
    db.version = DB_VERSION
    db.chars = db.chars or {}
    db.warband = db.warband or {}
    db.guilds = db.guilds or {}
    if ns.Saved then                            -- Saved.lua: unlearned recipes once per account file, 30 statistics days
        local ok, err = pcall(function()
            if ns.Saved.MigrateRecipes(db) > 0 then ns.Saved.Sweep(db) end
            for _, c in pairs(db.chars) do ns.Saved.PruneStatDays(c, math.floor(time() / 86400)) end
        end)
        if not ok then db.lastError = "saved shapes: " .. tostring(err) end
    end
end

function handlers.PLAYER_LOGIN()
    if ns.ObsNote then ns.ObsNote(true, hadInventory) end
    meKey = CharacterKey()
    db.chars[meKey] = db.chars[meKey] or {}
    me = db.chars[meKey]
    me.updated = me.updated or {}
    loggedInAt = GetTime()
    loggingOut, worldLeaving = false, false
    ScanIdentity()
    Soon("wallet", ScanWallet, 4)
    Soon("bags", ScanBags, 3, true)
    Soon("gear", ScanGear, 4)
    Soon("profs", ScanProfessions, 5)
    Soon("money", ScanCurrencies, 5)
    Soon("talents", ScanTalents, 6)
    Soon("skills", ScanSkills, 6)
    Soon("spells", ScanSpells, 7)
    Soon("reps", ScanReputation, 8)
    Soon("pvp", ScanPvP, 8)
    Soon("quests", ScanQuestLog, 8)
    Soon("statistics", function() ScanStatistics(true) end, 15)
    WantStats()
    for _, e in ipairs({ "BAG_UPDATE", "BAG_UPDATE_DELAYED", "PLAYER_EQUIPMENT_CHANGED", "PLAYER_MONEY", "PLAYER_XP_UPDATE",
                         "CURRENCY_DISPLAY_UPDATE", "SKILL_LINES_CHANGED", "PLAYER_LEVEL_UP", "PLAYER_REGEN_ENABLED",
                         "BANKFRAME_OPENED", "BANKFRAME_CLOSED", "PLAYERBANKSLOTS_CHANGED", "UPDATE_INVENTORY_DURABILITY",
                         "PLAYER_ENTERING_WORLD", "PLAYER_LEAVING_WORLD", "PLAYER_STOPPED_MOVING",
                         "ZONE_CHANGED", "ZONE_CHANGED_INDOORS", "ZONE_CHANGED_NEW_AREA", "HEARTHSTONE_BOUND", "UPDATE_EXHAUSTION",
                         "PLAYER_INTERACTION_MANAGER_FRAME_SHOW", "PLAYER_INTERACTION_MANAGER_FRAME_HIDE",
                         "GUILDBANKBAGSLOTS_CHANGED", "PLAYER_LOGOUT", "UNIT_INVENTORY_CHANGED",
                         "ACTIVE_TALENT_GROUP_CHANGED", "PLAYER_SPECIALIZATION_CHANGED",
                         "TRAIT_CONFIG_UPDATED", "TRAIT_NODE_CHANGED", "TRAIT_TREE_CURRENCY_INFO_UPDATED",
                         "GUILD_ROSTER_UPDATE", "PLAYER_GUILD_UPDATE", "PLAYER_TALENT_UPDATE", "CHARACTER_POINTS_CHANGED",
                         "SPELLS_CHANGED", "LEARNED_SPELL_IN_SKILL_LINE", "LEARNED_SPELL_IN_TAB",
                         "TRADE_SKILL_SHOW", "TRADE_SKILL_CLOSE", "TRADE_SKILL_LIST_UPDATE", "TRADE_SKILL_DATA_SOURCE_CHANGED", "NEW_RECIPE_LEARNED",
                         "UPDATE_FACTION", "PLAYER_PVP_KILLS_CHANGED", "HONOR_XP_UPDATE", "PVP_RATED_STATS_UPDATE",
                         "QUEST_LOG_UPDATE", "QUEST_ACCEPTED", "QUEST_REMOVED", "QUEST_TURNED_IN",
                         "TRAINER_SHOW", "TRAINER_UPDATE", "UNIT_STATS", "UNIT_RESISTANCES", "UNIT_ATTACK_POWER",
                         "UNIT_RANGED_ATTACK_POWER", "COMBAT_RATING_UPDATE" }) do
        pcall(ev.RegisterEvent, ev, e)            -- an event this client lacks is simply skipped
    end
    for _, name in ipairs({ "Logout", "Quit", "ReloadUI" }) do
        if type(_G[name]) == "function" and type(hooksecurefunc) == "function" then
            local reason = name
            pcall(hooksecurefunc, name, function() Checkpoint(reason) end)
        end
    end
end

function handlers.BAG_UPDATE(bag) if type(bag) == "number" then dirtyBags[bag] = true end end
function handlers.BAG_UPDATE_DELAYED() if not worldLeaving and not loggingOut and next(dirtyBags) then ScanBags() end end
function handlers.PLAYERBANKSLOTS_CHANGED() if bankOpen then Soon("bags", ScanBags, 0.5, true) end end
function handlers.PLAYER_EQUIPMENT_CHANGED() Soon("gear", ScanGear, 1); WantStats() end
function handlers.UNIT_INVENTORY_CHANGED(unit) if unit == "player" then Soon("gear", ScanGear, 1) end end
function handlers.UPDATE_INVENTORY_DURABILITY() Soon("gear", ScanGear, 0.5) end
function handlers.PLAYER_MONEY()
    if loggingOut or worldLeaving then return end
    if not ScanWallet(true) then Soon("wallet", ScanWallet, 3) end
end
function handlers.PLAYER_XP_UPDATE(unit) if not unit or unit == "player" then ScanWallet() end end
handlers.UPDATE_EXHAUSTION = handlers.PLAYER_XP_UPDATE
function handlers.CURRENCY_DISPLAY_UPDATE() Soon("money", ScanCurrencies, 3) end
function handlers.SKILL_LINES_CHANGED() Soon("profs", ScanProfessions, 3); Soon("skills", ScanSkills, 3) end
function handlers.SPELLS_CHANGED() Soon("spells", ScanSpells, 3) end      -- fires often; one read per 3 s burst
handlers.LEARNED_SPELL_IN_SKILL_LINE = handlers.SPELLS_CHANGED
handlers.LEARNED_SPELL_IN_TAB = handlers.SPELLS_CHANGED
local function ReadRecipesNow()                 -- replaces a skill-up read still waiting out its 30 s
    pendingRun.recipes = nil
    Soon("recipes", ScanRecipes, 1, true)
end
function handlers.TRADE_SKILL_SHOW() tradeSkillOpen = true; ReadRecipesNow() end
handlers.TRADE_SKILL_DATA_SOURCE_CHANGED = handlers.TRADE_SKILL_SHOW
handlers.NEW_RECIPE_LEARNED = ReadRecipesNow
function handlers.TRADE_SKILL_CLOSE() tradeSkillOpen = false end
function handlers.TRADE_SKILL_LIST_UPDATE() Soon("recipes", ScanRecipes, 2) end
function handlers.UPDATE_FACTION() if not readingReps then Soon("reps", ScanReputation, 5) end end   -- fires on every rep gain
function handlers.PLAYER_PVP_KILLS_CHANGED() Soon("pvp", ScanPvP, 5) end
handlers.HONOR_XP_UPDATE = handlers.PLAYER_PVP_KILLS_CHANGED
handlers.PVP_RATED_STATS_UPDATE = handlers.PLAYER_PVP_KILLS_CHANGED
-- Our own expand/collapse fires QUEST_LOG_UPDATE after the read ends; without the 1 s quiet time a collapsed header would
-- make the read reschedule itself every 2 s for ever. Accept, remove and turn-in are never ours, so they always read.
function handlers.QUEST_LOG_UPDATE()
    if not readingQuests and GetTime() - questsToggledAt >= 1 then Soon("quests", ScanQuestLog, 2) end
end
function handlers.QUEST_ACCEPTED() Soon("quests", ScanQuestLog, 2) end
handlers.QUEST_REMOVED = handlers.QUEST_ACCEPTED
handlers.QUEST_TURNED_IN = handlers.QUEST_ACCEPTED
function handlers.PLAYER_LEVEL_UP() Soon("who", ScanIdentity, 2); Soon("wallet", ScanWallet, 2); WantStats() end
function handlers.ACTIVE_TALENT_GROUP_CHANGED() Soon("who", ScanIdentity, 2); Soon("talents", ScanTalents, 3); WantStats() end
handlers.PLAYER_SPECIALIZATION_CHANGED = handlers.ACTIVE_TALENT_GROUP_CHANGED
function handlers.TRAIT_CONFIG_UPDATED() Soon("talents", ScanTalents, 2); WantStats() end
handlers.TRAIT_NODE_CHANGED = handlers.TRAIT_CONFIG_UPDATED
handlers.TRAIT_TREE_CURRENCY_INFO_UPDATED = handlers.TRAIT_CONFIG_UPDATED
function handlers.GUILD_ROSTER_UPDATE() Soon("guildName", ScanGuild, 1) end
function handlers.PLAYER_GUILD_UPDATE(unit)
    if not unit or unit == "player" then Soon("guildName", ScanGuild, 1) end
end
handlers.PLAYER_TALENT_UPDATE = handlers.TRAIT_CONFIG_UPDATED
handlers.CHARACTER_POINTS_CHANGED = handlers.TRAIT_CONFIG_UPDATED
function handlers.PLAYER_REGEN_ENABLED()
    if statsWaiting then WantStats() end
    if questsWaiting then Soon("quests", ScanQuestLog, 1) end
    Soon("statistics", ScanStatistics, 5)               -- does nothing if read less than 10 minutes ago
end
function handlers.TRAINER_SHOW() if not readingTrainer then Soon("trainer", ScanTrainer, 0.5) end end
handlers.TRAINER_UPDATE = handlers.TRAINER_SHOW          -- also fires when we flip the filters: ignored while reading
function handlers.UNIT_STATS(unit) if unit == "player" then WantStats() end end   -- buffs, gear: one read per 2 s burst
handlers.UNIT_RESISTANCES = handlers.UNIT_STATS
handlers.UNIT_ATTACK_POWER = handlers.UNIT_STATS
handlers.UNIT_RANGED_ATTACK_POWER = handlers.UNIT_STATS
function handlers.COMBAT_RATING_UPDATE() WantStats() end
function handlers.BANKFRAME_OPENED() SetBankOpen(true) end
function handlers.BANKFRAME_CLOSED() bankOpen = false end

local BANKER_TYPES = { [8] = true, [68] = true }          -- Banker, AccountBanker (PlayerInteractionType)
local GUILD_BANKER = 10
function handlers.PLAYER_INTERACTION_MANAGER_FRAME_SHOW(kind)
    if BANKER_TYPES[kind] then SetBankOpen(true)
    elseif kind == GUILD_BANKER then guildBankOpen = true end
end
function handlers.PLAYER_INTERACTION_MANAGER_FRAME_HIDE(kind)
    if BANKER_TYPES[kind] then bankOpen = false
    elseif kind == GUILD_BANKER then guildBankOpen = false end
end
function handlers.GUILDBANKBAGSLOTS_CHANGED() guildBankOpen = true; Soon("guild", ScanGuildBankTab, 0.5) end

function handlers.PLAYER_ENTERING_WORLD()
    worldLeaving = false
    Soon("bags", ScanBags, 1, true)
    Soon("wallet", ScanWallet, 3)
    Soon("location", ScanLocation, 1)
    Soon("hearth", ScanHearth, 1)
    C_Timer.After(1, function() Checkpoint("PLAYER_ENTERING_WORLD") end)
end
function handlers.PLAYER_STOPPED_MOVING() if not worldLeaving and not loggingOut then ScanLocation() end end
function handlers.ZONE_CHANGED() Soon("location", ScanLocation, 0.2) end
function handlers.HEARTHSTONE_BOUND() Soon("hearth", ScanHearth, 0.5) end
handlers.ZONE_CHANGED_INDOORS = handlers.ZONE_CHANGED
handlers.ZONE_CHANGED_NEW_AREA = handlers.ZONE_CHANGED
function handlers.PLAYER_LEAVING_WORLD()
    Checkpoint("PLAYER_LEAVING_WORLD")
    worldLeaving = true
end

function handlers.PLAYER_LOGOUT()                        -- last chance before the game writes the file
    -- No inventory/character re-read: these APIs can already report empty/zero values here.
    loggingOut = true
    me.recording = me.recording or {}
    me.recording.savedAt = time()
    me.recording.pending = PendingKeys()                  -- expose any work that could not safely finish
    me.recording.deferredStats = statsWaiting or nil       -- combat-only data remains the last safe snapshot
    wipe(pendingRun)
    me.lastSeen = time()
    -- KutzUI's addon monitor keeps a ranked snapshot in KutzUIDB.monitor.findings. Copy it so a
    -- SavedVariables export of this file still has it. The exporter also reads KutzUI.lua beside
    -- this file and keeps whichever snapshot is newer (logout order between the two addons varies).
    local mon = _G.KutzUIDB and KutzUIDB.monitor and KutzUIDB.monitor.findings
    if type(mon) == "table" then db.uiHealth = mon end
end

ev:RegisterEvent("ADDON_LOADED")
ev:RegisterEvent("PLAYER_LOGIN")
ev:SetScript("OnEvent", function(_, event, ...)
    local h = handlers[event]
    if h and (db or event == "ADDON_LOADED") and (me or event == "ADDON_LOADED" or event == "PLAYER_LOGIN") then
        local ok, err = pcall(h, ...)
        if not ok and db then db.lastError = event .. ": " .. tostring(err) end
    end
end)

---------------------------------------------------------------------------
-- /kinv : what is recorded (and a manual rescan)
---------------------------------------------------------------------------
local function Count(boxes)
    local n = 0
    for _, box in pairs(boxes or {}) do
        for _, it in pairs(box.items or {}) do n = n + (it.count or 1) end
    end
    return n
end

local function Ago(t)
    if not t then return "never" end
    local s = time() - t
    if s < 120 then return s .. "s ago" elseif s < 7200 then return math.floor(s / 60) .. "m ago" end
    return math.floor(s / 3600) .. "h ago"
end

SLASH_KUTZINVENTORY1 = "/kinv"
SlashCmdList.KUTZINVENTORY = function(msg)
    if not me then return end
    if ns.ObsNote then ns.ObsNote() end      -- once, after updating: what /kinv track does (Observations.lua)
    -- /kinv ah (or ah all): the whole auction house, every item. /kinv ah slow: crafting items, one search each.
    if msg == "ah" or msg == "ah slow" or msg == "ah all" then
        if ns.StartAH then ns.StartAH(msg == "ah slow", msg ~= "ah slow") end
        return
    end
    -- /kinv raid <string> tracks a cr0m raid, /kinv raid lists them, /kinv raid clear <CODE> (Raids.lua)
    if ns.RaidCommand and ns.RaidCommand(msg) then return end
    -- /kinv track drops on|off, /kinv track (status): default-on drop / quest / vendor / trainer recording (Observations.lua)
    if ns.ObsCommand and ns.ObsCommand(msg) then return end
    -- /kinv perf: item facts held and waiting, and the time Facts.lua used per frame
    if ns.Facts and ns.Facts.Command and ns.Facts.Command(msg) then return end
    if msg == "scan" then
        ScanIdentity(); ScanWallet(); ScanBags(true); ScanGear(); ScanProfessions(); ScanCurrencies(); ScanTalents(); ScanSkills(); ScanSpells(); ScanStats(); ScanGuildBankTab(); ScanRecipes(true)
        ScanReputation(); ScanPvP(); ScanStatistics(true); ScanQuestLog()
        print("|cffd8b84aKutzInventory|r: everything rescanned. It reaches the file on /reload or logout.")
        return
    end
    print("|cffd8b84aKutzInventory|r — saved to disk on /reload or logout. |cffaaaaaa/kinv scan|r rescans now, |cffaaaaaa/kinv ah|r (at the auction house) records every item's price, |cffaaaaaa/kinv ah slow|r searches your crafting items one by one, |cffaaaaaa/kinv raid|r lists the cr0m raids you track" .. (ns.ObsCommand and ", |cffaaaaaa/kinv track|r says whether drop tracking is on" or "") .. (ns.Facts and ", |cffaaaaaa/kinv perf|r says what reading item facts costs per frame" or "") .. ".")
    for key, c in pairs(db.chars) do
        local u = c.updated or {}
        local gear = 0
        for _ in pairs(c.equipped or {}) do gear = gear + 1 end
        local gold = type(c.money) == "number" and string.format("%dg %ds %dc", math.floor(c.money / 10000),
            math.floor(c.money / 100) % 100, c.money % 100) or "?"
        local xp = c.xpMax and c.xpMax > 0 and string.format("%d/%d", c.xp or 0, c.xpMax) or "?"
        print(string.format("  %s (%s %s): %s, XP %s, bags %d items, bank %d (%s), gear %d slots, talents %d%s, skills %d, spells %d",
            key, tostring(c.level or "?"), tostring(c.class or "?"), gold, xp, Count(c.bags), Count(c.bank), Ago(u.bank), gear,
            c.talents and #(c.talents.taken or {}) or 0, c.talents and c.talents.reason and (" (" .. c.talents.reason .. ")") or "",
            #(c.skills or {}), #(c.spells or {})))
        local parts = {}
        for prof, p in pairs(c.recipes or {}) do parts[#parts + 1] = string.format("%s %d (%s)", prof, #(p.recipes or {}), Ago(p.updated)) end
        print("      recipes: " .. (#parts > 0 and table.concat(parts, ", ") or "none yet - open each profession window once"))
        print(string.format("      reputations %d, currencies %d, statistics %d, honorable kills %s",
            #(c.reputation or {}), #(c.currencies or {}), #(c.statistics or {}), tostring(c.pvp and c.pvp.honorableKills or "?")))
        if ns.CraftedLine then print(ns.CraftedLine(c)) end   -- items created, counted as they are made (Crafts.lua)
    end
    print(string.format("  warband bank: %d items (%s)", Count(db.warband.bank), Ago(db.warband.updated)))
    for key, g in pairs(db.guilds) do print(string.format("  guild bank %s: %d items (%s)", key, Count(g.tabs), Ago(g.updated))) end
    if db.lastError then print("  last error: " .. db.lastError) end
end
