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
InCombatLockdown=function() return false end
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
local goodMoney,goodXP,goodBags=c.money,c.xp,c.bags
loaded,mapReady=false,false
emit('PLAYER_MONEY');emit('PLAYER_XP_UPDATE','player')
emit('PLAYER_LOGOUT');advance(100)
check(c.legacyTree==goodLegacy,'late logout preserves Legacy snapshot')
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
