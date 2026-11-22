// Run the real inventory addon in a fake client whose APIs disappear before PLAYER_LOGOUT.
const fs = require("fs"), path = require("path");
const {lua,lauxlib,lualib,to_luastring,to_jsstring} = require("fengari");
const source = fs.readFileSync(path.join(__dirname,"../KutzInventory/KutzInventory.lua"),"utf8");
for (const mode of ["Logout","Quit","ReloadUI","NativeExit"]) for (const earlyUnload of [false,true]) {
 const driver = `
local now, loaded, mapReady = 0, true, true
local x, y, coins, xp, count = 0.10, 0.20, 12345, 50, 2
local timers, hooks, frame = {}, {}, nil
local function check(ok,msg) assert(ok, '${mode}${earlyUnload?" (early unload)":""}: '..msg) end
time = function() return 1700000000 + math.floor(now) end
GetTime = function() return now end
wipe = function(t) for k in pairs(t) do t[k]=nil end end
CreateFrame = function()
 frame = {events={}}
 function frame:RegisterEvent(e) self.events[e]=true end
 function frame:SetScript(_,fn) self.event=fn end
 return frame
end
C_Timer = {After=function(delay,fn) timers[#timers+1]={at=now+delay,fn=fn} end}
local function advance(amount)
 now=now+amount
 local batch=timers;timers={}
 for _,t in ipairs(batch) do if t.at<=now then t.fn() else timers[#timers+1]=t end end
end
hooksecurefunc = function(name,fn) hooks[name]=fn end
Logout=function() end;Quit=function() end;ReloadUI=function() end
UnitName=function() return 'Tester' end; GetRealmName=function() return 'Realm' end
UnitClass=function() return 'Warrior','WARRIOR' end;UnitRace=function() return 'Human' end
UnitFactionGroup=function() return 'Alliance' end;UnitLevel=function() return 30 end;UnitSex=function() return 2 end
UnitGUID=function() return loaded and 'Player-Test' or nil end;UnitExists=function() return loaded end
local inCombat = false
InCombatLockdown=function() return inCombat end
GetMoney=function() return loaded and coins or 0 end
UnitXPMax=function() return loaded and 1000 or 0 end;UnitXP=function() return loaded and xp or 0 end
GetXPExhaustion=function() return loaded and 200 or nil end
GetInstanceInfo=function() return 'Elwynn Forest','none' end
bind='Goldshire';GetBindLocation=function() return loaded and bind or '' end
GetRealZoneText=function() return mapReady and 'Elwynn Forest' or '' end
GetZoneText=GetRealZoneText;GetSubZoneText=function() return 'Goldshire' end
C_Map={GetBestMapForUnit=function() return mapReady and 37 or nil end,
 GetPlayerMapPosition=function() return mapReady and {GetXY=function() return x,y end} or nil end}
C_Container={GetContainerNumSlots=function(bag) return loaded and bag==0 and 16 or 0 end,
 GetContainerItemInfo=function(bag,slot) if loaded and bag==0 and slot==1 then return {hyperlink='item:2318:[Light Leather]',stackCount=count,quality=1,itemName='Light Leather'} end end}
SlashCmdList={}
local rank, available, entryID, staged, committed = 2, 12, 201, false, nil
C_Traits = {
 ConfigHasStagedChanges=function(config) return staged end,
 GetConfigIDByTreeID=function(id) return loaded and id+1000 or nil end,
 GetTreeCurrencyInfo=function(config,id,exclude)
  check(config==id+1000 and exclude==true,'per-tree config, applied currency only')
  return {{quantity=available,spent=4,maxQuantity=16,spentInTree=id==1187 and 4 or 0}}
 end,
 GetTreeNodes=function() return {100,101,102,103} end,
 GetNodeInfo=function(_,id)
  if id==100 then return {activeRank=rank,currentRank=rank+1,ranksPurchased=1,entryIDs={200,201},activeEntry={entryID=entryID},
   entryIDsWithCommittedRanks=committed and {committed} or nil} end
  if id==101 then return {ranksPurchased=1,entryIDs={202},activeEntry={entryID=202}} end
  if id==102 then return {activeRank=0,currentRank=1,ranksPurchased=2} end
  return {activeRank=0,currentRank=0}
 end,
}
local inGuild, guildName = true, nil
IsInGuild=function() return inGuild end
GetGuildInfo=function() return guildName end
GetCurrentGuildBankTab=function() return 1 end
GetGuildBankTabInfo=function() return 'Supplies',nil,true end
GetGuildBankItemLink=function(_,slot) if slot==1 then return 'item:2318:[Light Leather]' end end
GetGuildBankItemInfo=function() return nil,1 end
KutzInventoryDB={chars={['Tester-Realm']={guild='Saved Guild'}}}
assert(load([====[${source}]====]))('KutzInventory',{})
local function emit(e,...) check(frame.events[e],e..' not registered');frame.event(frame,e,...) end
emit('ADDON_LOADED','KutzInventory');emit('PLAYER_LOGIN');emit('PLAYER_ENTERING_WORLD')
advance(1);advance(4);advance(15)
local c=KutzInventoryDB.chars['Tester-Realm']
check(c.guild=='Saved Guild','login must preserve a guild whose name is not loaded')
guildName='Loaded Guild';emit('GUILD_ROSTER_UPDATE');emit('GUILDBANKBAGSLOTS_CHANGED');advance(1)
check(c.guild=='Loaded Guild','late roster supplies guild name')
check(KutzInventoryDB.guilds['Loaded Guild-Realm'].tabs[1].items[1].id==2318,'guild name refresh and bank scan queue independently')
guildName=nil;emit('PLAYER_GUILD_UPDATE','player');advance(1)
check(c.guild=='Loaded Guild','guilded nil name preserves previous guild')
inGuild=false;emit('PLAYER_GUILD_UPDATE','target');advance(1)
check(c.guild=='Loaded Guild','other unit guild changes ignored')
emit('PLAYER_GUILD_UPDATE','player');advance(1)
check(c.guild==nil,'leaving guild clears name')
check(c.legacyTree.currency.available==12 and c.legacyTree.currency.spent==4 and c.legacyTree.currency.max==16,'currency')
for _,id in ipairs({'1187','1188','1189'}) do
 local t=c.legacyTree.trees[id]
 check(t.nodes['100']==2 and t.nodes['101']==1,'applied rank wins over staged; purchased fallback')
 check(t.nodes['102']==nil and t.nodes['103']==nil,'staged-only rank is not recorded')
end
check(c.legacyTree.trees['1187'].spentInTree==4,'tree spending')
check(c.legacyTree.choices['100']==201 and c.legacyTree.choices['101']==nil,'choice entries only')
for _,event in ipairs({'TRAIT_CONFIG_UPDATED','TRAIT_NODE_CHANGED','TRAIT_TREE_CURRENCY_INFO_UPDATED'}) do
 rank=rank+1;available=available-1;emit(event);advance(3)
 check(c.legacyTree.trees['1187'].nodes['100']==rank and c.legacyTree.currency.available==available,'refresh '..event)
end
do -- clicks not yet applied (staged) leave the last applied reading alone, logout included
 local before, applied = c.legacyTree, rank
 staged=true;rank=rank+1;emit('TRAIT_NODE_CHANGED');advance(3)
 check(c.legacyTree==before and c.legacyTree.trees['1187'].nodes['100']==applied,'staged config keeps the applied snapshot')
 staged=false;emit('TRAIT_CONFIG_UPDATED');advance(3)
 check(c.legacyTree.trees['1187'].nodes['100']==rank,'applied changes recorded')
 committed=200;emit('TRAIT_CONFIG_UPDATED');advance(3)
 check(c.legacyTree.choices['100']==200,'committed choice entry wins over the preview entry')
 committed=nil
end
local good=c.legacyTree
local getNodes=C_Traits.GetTreeNodes
C_Traits.GetTreeNodes=function(id) if id==1188 then return nil end return getNodes(id) end
c.legacyTree=nil;emit('TRAIT_NODE_CHANGED');advance(3)
check(c.legacyTree==nil,'one missing tree leaves field absent')
c.legacyTree=good;emit('TRAIT_NODE_CHANGED');advance(3)
check(c.legacyTree==good,'one missing tree preserves previous complete snapshot')
C_Traits.GetTreeNodes=function() return {} end
c.legacyTree=nil;emit('TRAIT_NODE_CHANGED');advance(3)
check(c.legacyTree==nil,'empty unloaded trees leave field absent')
c.legacyTree=good
C_Traits.GetTreeNodes=getNodes
local traits=C_Traits
for _,missing in ipairs({'all','GetConfigIDByTreeID','GetTreeCurrencyInfo','GetTreeNodes','GetNodeInfo'}) do
 c.legacyTree=nil
 local fn=traits[missing]
 if missing=='all' then C_Traits=nil else traits[missing]=nil end
 emit('TRAIT_NODE_CHANGED');advance(3)
 check(c.legacyTree==nil,'unavailable API leaves field absent: '..missing)
 c.legacyTree=good;emit('TRAIT_NODE_CHANGED');advance(3)
 check(c.legacyTree==good,'unavailable API preserves complete reading: '..missing)
 C_Traits=traits;traits[missing]=fn
end
-- Constants may exist independently of the load-on-demand LegacySystem globals.
Constants={LegacyConsts={LEGACY_TREE_PROFESSIONS_ID=2187,LEGACY_TREE_ADVENTURE_ID=2188,LEGACY_TREE_PROGRESSION_ID=2189}}
emit('TRAIT_NODE_CHANGED');advance(3)
check(c.legacyTree.trees['2187'] and not c.legacyTree.trees['1187'],'prefer client constants')
Constants=nil
rank=0;emit('TRAIT_NODE_CHANGED');advance(3)
check(c.legacyTree.trees['1187'].nodes['100']==nil and c.legacyTree.choices['100']==201,'zero ranks omitted; active choice follows client')
entryID=nil;emit('TRAIT_NODE_CHANGED');advance(3)
check(c.legacyTree.choices['100']==nil,'cleared active choice is removed')
check(c.updated.legacyTree,'timestamp')
check(c.money==12345,'initial money was flushed before login data settled')
check(c.bags[0].items[1].count==2,'initial bag scan')
check(c.location.x==10,'initial live location')
check(c.hearth=='Goldshire' and c.updated.hearth,'hearth read after login')
bind='Stormwind City';emit('HEARTHSTONE_BOUND');advance(1)
check(c.hearth=='Stormwind City','a new bind at an innkeeper must record without a reload')
x,y=0.42,0.64;emit('PLAYER_STOPPED_MOVING')
check(c.location.x==42 and c.location.y==64,'stopped movement must record without a reload')
count=7;emit('BAG_UPDATE',0);emit('BAG_UPDATE_DELAYED')
check(c.bags[0].items[1].count==7,'last-moment bag update must be immediate')
xp=99;emit('PLAYER_XP_UPDATE','player');check(c.xp==99,'last-moment XP must be immediate')
coins=54321;emit('PLAYER_MONEY');check(c.money==54321,'money change')
do -- trainers: the class trainer's list; the hunter's Beast Training window (trainer type Pet) never replaces it
 local ttype,list=0,{{'Frostbolt','available',10},{'Blizzard','unavailable',20}}
 C_Trainer={GetTrainerType=function() return ttype end}
 GetNumTrainerServices=function() return #list end
 GetTrainerServiceInfo=function(i) local r=list[i];return r[1],r[2],nil,r[3] end
 GetTrainerServiceCost=function() return 100 end
 emit('TRAINER_SHOW');advance(1)
 check(c.trainers and c.trainers.class and #c.trainers.class==2 and c.trainers.class[1].name=='Frostbolt','class trainer recorded')
 ttype,list=3,{{'Growl','available',1}}
 emit('TRAINER_SHOW');advance(1)
 check(#c.trainers.class==2 and c.trainers.class[1].name=='Frostbolt','Beast Training must not replace the class trainer')
 C_Trainer,GetNumTrainerServices=nil,nil
end
do -- reputation: collapsed headers, one nested in another and one with no factionID, are opened for the read and put back
 local rows={ -- the whole list in order; p = the parent header's row; c = collapsed (headers only)
  {name='Alliance',id=469,h=true,c=false},{name='Stormwind',id=72,p=1},
  {name='Alliance Forces',id=891,h=true,child=true,c=true,p=1},{name='Silverwing Sentinels',id=890,p=3},
  {name='Other',id=1169,h=true,c=true},{name='Inner Circle',h=true,child=true,c=true,p=5},{name='Deep Faction',id=999,p=6},
  {name='Wintersaber Trainers',id=589,p=5},{name='Misc',h=true,c=false},{name='Ravenholdt',id=349,p=9}}
 local function shown()
  local out={}
  for _,r in ipairs(rows) do
   local p,ok=r.p,true
   while p do if rows[p].c then ok=false end; p=rows[p].p end
   if ok then out[#out+1]=r end
  end
  return out
 end
 local expandAll=0
 C_Reputation={GetNumFactions=function() return #shown() end,
  GetFactionDataByIndex=function(i) local r=shown()[i]; if r then return {name=r.name,factionID=r.id,isHeader=r.h or false,isChild=r.child or false,
   isCollapsed=r.c or false,reaction=5,currentStanding=r.standing or 100} end end,
  ExpandFactionHeader=function(i) shown()[i].c=false end,CollapseFactionHeader=function(i) shown()[i].c=true end,
  ExpandAllFactionHeaders=function() expandAll=expandAll+1; for _,r in ipairs(rows) do if r.h then r.c=false end end end}
 emit('UPDATE_FACTION');advance(5)
 local got={}
 for _,r in ipairs(c.reputation or {}) do got[#got+1]=r.factionID end
 check(table.concat(got,',')=='72,890,999,589,349','every faction, nested ones too: '..table.concat(got,','))
 check(c.reputation[3].group=='Other' and c.reputation[3].subGroup=='Inner Circle','groups')
 check(rows[3].c and rows[5].c and rows[6].c and not rows[1].c and not rows[9].c and expandAll==0,'the window as the player left it')
 rows[8].standing=250;emit('UPDATE_FACTION');advance(5)
 check(c.reputation[4].value==250,'read again on the next change')
 local get=C_Reputation.GetFactionDataByIndex
 local broken=setmetatable({},{__index=function() error('read failed') end})
 C_Reputation.GetFactionDataByIndex=function(i) local f=get(i); if f and f.factionID==999 then return broken end; return f end
 local saved=KutzInventoryDB.lastError
 emit('UPDATE_FACTION');advance(5)
 check(tostring(KutzInventoryDB.lastError):find('read failed'),'the failure is reported: '..tostring(KutzInventoryDB.lastError))
 check(rows[3].c and rows[5].c and rows[6].c and c.reputation[4].value==250,'a read that fails part-way still puts the window back')
 C_Reputation.GetFactionDataByIndex=get;KutzInventoryDB.lastError=saved
 rows[8].standing=300;emit('UPDATE_FACTION');advance(5)
 check(c.reputation[4].value==300,'and the next change is read again')
 C_Reputation=nil
end
do -- quest log: modern C_QuestLog, collapsed headers restored (also on error), combat defer, $N scrubbing, empty vs unloaded, legacy fallback
 local qrows = {
  { h = true, title = "Elwynn Forest", c = false },
  { id = 33, title = "|cffffff00Wolves for Tester|r", lv = 5, p = 1 },
  { id = 9999, title = "Hidden Tracking Quest", lv = 1, hidden = true, p = 1 },
  { h = true, title = "Stormwind City", c = true },
  { id = 463, title = "The Greenwarden", lv = 21, done = true, p = 4 },
  { id = 500, title = "Timed Escort", lv = 18, failed = true, p = 4 },
 }
 local objs = {
  [33] = { { text = "Tough Wolf Meat for Tester: 3/8", type = "monster", finished = false, numFulfilled = 3, numRequired = 8 },
           { text = "Return to Goldshire", type = "event", finished = true } },
  [463] = {},
  [500] = { { text = "Escort complete", type = "event", finished = false, numFulfilled = 0, numRequired = 1 } },
 }
 local function qshown()
  local out = {}
  for _, r in ipairs(qrows) do
   if not r.p or not qrows[r.p].c then out[#out + 1] = r end
  end
  return out
 end
 local function qtotal()
  local n = 0
  for _, r in ipairs(qrows) do if not r.h and not r.hidden then n = n + 1 end end
  return n
 end
 local qLogEvents = 0
 ExpandQuestHeader = function(i) qshown()[i].c = false; qLogEvents = qLogEvents + 1; emit('QUEST_LOG_UPDATE') end
 CollapseQuestHeader = function(i) qshown()[i].c = true; qLogEvents = qLogEvents + 1; emit('QUEST_LOG_UPDATE') end
 C_QuestLog = {
  GetNumQuestLogEntries = function() return #qshown(), qtotal() end,
  GetInfo = function(i)
   local r = qshown()[i]
   if not r then return nil end
   return { title = r.title, questID = r.id or 0, level = r.lv or 0, isHeader = r.h or false,
            isCollapsed = r.c or false, isHidden = r.hidden or false }
  end,
  IsComplete = function(id) for _, r in ipairs(qrows) do if r.id == id then return r.done or false end end return false end,
  IsFailed = function(id) for _, r in ipairs(qrows) do if r.id == id then return r.failed or false end end return false end,
  GetQuestObjectives = function(id) return objs[id] or {} end,
 }
 -- combat with a collapsed header: defers without expanding, resumes on PLAYER_REGEN_ENABLED
 inCombat = true
 emit('QUEST_LOG_UPDATE'); advance(2)
 check(c.questLog == nil and qrows[4].c == true and qLogEvents == 0, 'collapsed quest header in combat defers without mutating UI')
 inCombat = false
 emit('PLAYER_REGEN_ENABLED'); advance(2)
 check(c.questLog and c.questLog.at and #c.questLog.quests == 3, 'quest log read after combat ends: ' .. tostring(c.questLog and #c.questLog.quests))
 check(qrows[4].c == true and not qrows[1].c, 'collapsed quest header put back as player left it')
 local q1, q2, q3 = c.questLog.quests[1], c.questLog.quests[2], c.questLog.quests[3]
 check(q1.id == 33 and q1.title == 'Wolves for $N' and q1.lv == 5 and q1.header == 'Elwynn Forest' and q1.done == nil and q1.failed == nil, 'first quest + $N + markup')
 check(#q1.obj == 2 and q1.obj[1].text == 'Tough Wolf Meat for $N: 3/8' and q1.obj[1].have == 3 and q1.obj[1].need == 8 and q1.obj[1].done == false and q1.obj[1].type == 'monster', 'objective 1')
 check(q1.obj[2].text == 'Return to Goldshire' and q1.obj[2].done == true and q1.obj[2].have == nil and q1.obj[2].need == nil and q1.obj[2].type == 'event', 'objective 2')
 check(q2.id == 463 and q2.header == 'Stormwind City' and q2.done == true and q2.failed == nil and #q2.obj == 0, 'collapsed complete quest')
 check(q3.id == 500 and q3.failed == true and q3.done == nil, 'failed quest')
 -- error part-way through read still collapses opened headers back and allows later reads
 local getInfo = C_QuestLog.GetInfo
 local broken = setmetatable({}, { __index = function() error('quest read failed') end })
 C_QuestLog.GetInfo = function(i) local f = getInfo(i); if f and f.questID == 463 then return broken end; return f end
 local savedErr = KutzInventoryDB.lastError
 emit('QUEST_ACCEPTED'); advance(2)
 check(tostring(KutzInventoryDB.lastError):find('quest read failed'), 'quest read error reported')
 check(qrows[4].c == true, 'failed quest read still collapses opened header back')
 C_QuestLog.GetInfo = getInfo; KutzInventoryDB.lastError = savedErr
 -- unloaded log (total > 0, GetInfo nil) preserves previous snapshot
 C_QuestLog.GetNumQuestLogEntries = function() return 0, 3 end
 emit('QUEST_REMOVED'); advance(2)
 check(#c.questLog.quests == 3, 'unloaded quest log must not overwrite saved log with empty')
 -- genuinely empty log records quests = {}
 C_QuestLog.GetNumQuestLogEntries = function() return 0, 0 end
 emit('QUEST_TURNED_IN'); advance(2)
 check(c.questLog and #c.questLog.quests == 0, 'empty quest log records quests = {}')
 -- legacy fallback when C_QuestLog is absent
 C_QuestLog = nil
 local legRows = {
  { "Duskwood", 0, 0, true, false, nil, 0, 0 },
  { "Night Watch for Tester", 22, 0, false, false, 1, 0, 56 },
 }
 GetNumQuestLogEntries = function() return #legRows, 1 end
 GetQuestLogTitle = function(i) local r = legRows[i]; if r then return r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8] end end
 GetNumQuestLeaderBoards = function(idx) return idx == 2 and 1 or 0 end
 GetQuestLogLeaderBoard = function(j, idx) if idx == 2 and j == 1 then return "Skeletal Fighter slain: 8/8", "monster", true end end
 emit('QUEST_LOG_UPDATE'); advance(2)
 check(#c.questLog.quests == 1 and c.questLog.quests[1].id == 56 and c.questLog.quests[1].title == 'Night Watch for $N'
       and c.questLog.quests[1].header == 'Duskwood' and c.questLog.quests[1].done == true
       and #c.questLog.quests[1].obj == 1 and c.questLog.quests[1].obj[1].done == true and c.questLog.quests[1].obj[1].type == 'monster',
       'legacy GetQuestLogTitle + GetQuestLogLeaderBoard fallback')
 -- leave legacy APIs active across logout/checkpoint to verify checkpoint refresh and early-unload preservation
 legRows[2][1] = "Night Watch Updated"
end
rank=7;emit('TRAIT_NODE_CHANGED')
emit('PLAYER_EQUIPMENT_CHANGED')
if '${mode}'~='NativeExit' then
 check(hooks['${mode}'],'request checkpoint hook')
 hooks['${mode}']();check(c.recording.checkpoint=='${mode}','request checkpoint reason')
end
x=0.43
${earlyUnload?"loaded,mapReady=false,false":""}
emit('PLAYER_LEAVING_WORLD');check(c.location.x==${earlyUnload?42:43},'pre-leave position or last good live location')
${earlyUnload?"":"check(#c.recording.pending==0,'checkpoint must finish safe queued scans')"}
check(c.legacyTree.trees['1187'].nodes['100']==${earlyUnload && mode === 'NativeExit' ? 'nil' : '7'},'queued talent checkpoint records Legacy while APIs ready')
local goodLegacy=c.legacyTree
local goodQuests=c.questLog
check(goodQuests and goodQuests.quests[1].title=='${earlyUnload && mode === 'NativeExit' ? 'Night Watch for $N' : 'Night Watch Updated'}','logout checkpoint refreshes questLog while APIs ready')
local goodMoney,goodXP,goodBags=c.money,c.xp,c.bags
loaded,mapReady=false,false
GetNumQuestLogEntries=function() return 0, 0 end
emit('PLAYER_MONEY');emit('PLAYER_XP_UPDATE','player')
emit('PLAYER_LOGOUT');advance(100)
check(c.legacyTree==goodLegacy,'late logout preserves Legacy snapshot')
check(c.questLog==goodQuests,'late logout preserves questLog snapshot')
check(c.location.x==${earlyUnload?42:43},'unavailable logout map must preserve position')
check(c.money==goodMoney and c.xp==goodXP,'late zero wallet must not replace real values')
check(c.hearth=='Stormwind City','an empty late answer must not erase the hearth')
check(c.bags==goodBags and c.bags[0].items[1].count==7,'unloaded inventory must not erase bags')
check(c.recording.savedAt,'saved status')
check(not KutzInventoryDB.lastError,'addon error: '..tostring(KutzInventoryDB.lastError))
print('OK ${mode}${earlyUnload?" (early unload)":""}: live location, queued scans, final bags/XP, and unloaded API preservation')
`;
 const L=lauxlib.luaL_newstate();lualib.luaL_openlibs(L);
 if(lauxlib.luaL_dostring(L,to_luastring(driver))!==0) {console.error(to_jsstring(lua.lua_tostring(L,-1)));process.exit(1)}
}
const assert = require("node:assert/strict");
const {build} = require("./inventory_export");
const result=build([{chars:{"Tester-Realm":{name:"Tester",realm:"Realm",recording:{savedAt:1700000010,checkpointAt:1700000009,checkpoint:"Quit",pending:{1:"recipes"},failed:{1:"gear"},deferredStats:true}}}}]).characters[0];
assert.equal(result.recording.savedAt,"2023-11-14T22:13:30.000Z");
assert.deepEqual(result.recording.pending,["recipes"]);
assert.deepEqual(result.recording.failed,["gear"]);
assert.equal(result.recording.deferredStats,true);
console.log("OK save diagnostics survive the SavedVariables-to-website export");
