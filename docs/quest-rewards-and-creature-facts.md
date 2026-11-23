# Quest rewards, kill reputation, creature health and disenchanting (KutzInventory 1.23.0, export 3.16.0)

Status: spec for the `feat/record-quest-money-and-facts` branch. Hand-off to the receiving site: this file plus
`schema/examples/inventory-export.v3.example.json`. `observations.v` stays `1`; every field here is optional.

## What is recorded today (so it is not added twice)

| Fact | Today (1.22.1 / 3.15.0) |
| --- | --- |
| Turn-in reward items | `rewards.items` (`id`, `n`, `link`), `rewards.choices` (item ids only, no counts), `rewards.chose` |
| Turn-in XP | top-level `xp` (`GetRewardXP` at `QUEST_COMPLETE`), absent at the level cap or with XP off |
| Turn-in reputation | top-level `rep` (`f`, `d`): what the standings actually moved by, never a standing |
| The recording character's level | `who.level` on every event |
| Rewards when the quest is offered | nothing |
| Quest money | nothing, on purpose until now (`GetRewardMoney` never called) |
| Reward spell or title | nothing |
| Reputation from a kill | nothing |
| A creature's health or power | nothing (`npcs[]` has level, type, reaction, attack speed) |
| Disenchanting | a loot window with an `Item-` source is recorded as `src.kind: "container"`; a destroyed item often resolves to no item id, so the result is mislabelled or has no source item |

## How the calls were checked

`C:\projects\WoWEnvironment` and `C:\projects\wowforeverbetaaddons` are empty on this machine, so there is no client
interface extract. Each name below was found as a string in the installed client (`_forever_\Wow.exe`, build
1.60.1.71037); spell ids were checked in the decoded client tables (`wow-sources/data/client/70938`). A name in the
binary shows the client knows the function or event; what it answers must still be seen in the game (checklist below).

| Name | In the client | Used for |
| --- | --- | --- |
| `GetRewardMoney`, `GetRewardXP`, `GetNumQuestRewards`, `GetNumQuestChoices`, `GetQuestItemInfo`, `GetQuestItemLink` | yes | the offer and reward windows |
| `C_QuestInfoSystem.GetQuestRewardSpells`, `GetQuestRewardSpellInfo` | yes | reward spells |
| `GetRewardTitle` | yes | reward title |
| `GetRewardSkillLineID`, `GetRewardSkillPoints` | yes | skill points a quest grants (return shape undocumented: see below) |
| `C_QuestInfoSystem.GetQuestRewardCurrencies` | yes | reward currencies (`QuestRewardCurrencyInfo`: `currencyID`, `totalRewardAmount`) |
| `QUEST_ITEM_UPDATE`, `QUEST_FINISHED` | not checked in the binary | re-reading the open window when a reward item loads (an event the client lacks is skipped) |
| `GetMaxPlayerLevel`, `UnitLevel`, `IsXPUserDisabled` | yes (already used) | level and cap |
| `CHAT_MSG_COMBAT_FACTION_CHANGE`, `FACTION_STANDING_INCREASED`, `C_Reputation.GetFactionDataByID/ByIndex` | yes | kill reputation |
| `UnitHealthMax`, `UnitPowerMax`, `UnitPowerType` | yes | creature health and power |
| `GetLootSourceInfo`, `C_Item.GetItemIDByGUID`, `UNIT_SPELLCAST_SUCCEEDED`, spell 13262 Disenchant | yes | disenchanting |
| `C_Container.PickupContainerItem`, `C_Container.GetContainerItemInfo`, `UNIT_SPELLCAST_START` | not checked in the binary (`GetContainerItemInfo` and the `UseContainerItem` hook are already used) | the bag item a Disenchant was aimed at (a client without them falls back to the source GUID alone) |
| `GetNumRewardSpells`, `GetQuestLogRewardSpell`, `GetNumRewardCurrencies`, `GetQuestCurrencyInfo` | **no** | not used |
| Spells 31252 Prospecting, 51005 Milling | **not in this client's spell table** | dropped: the game version has neither |
| `GetNumQuestLogRewardFactions`, `GetQuestLogRewardFactionInfo` | yes, but see below | not used in 1.23.0 |

**`GetRewardSkillPoints` return shape.** Neither the local API annotations nor the binary say what it returns. The
addon takes its first return as the points when that is a plain integer; when the first return is a string it takes
the third (Blizzard's default quest UI reads the call as `skillName, skillIcon, skillPoints`; recalled from that UI,
not from a file on this machine). `GetRewardSkillLineID`'s first return is taken as the line id. The checklist prints
both.

**Dropped: reputation as the quest window lists it.** The two quest-log calls exist, but they read the selected
quest-log entry (the addon would have to change the selection), and their amounts are raw values whose scale differs
between client versions. Nothing here could confirm either. The reputation a turn-in really gave is already recorded
(`rep`), and `who.level` and `rewards.cap` now sit beside it. Listed reputation stays out until the checklist's
print-out shows what the calls answer.

## 1. Quest rewards as the window shows them (`quest` events, both acts)

`rewards` is now written on `act: "accept"` too, and gains keys on both acts. It describes the quest's reward as the
quest window showed it to this character. Existing keys keep their meaning.

When: on accept, read at `QUEST_DETAIL` (the offer window) and written to the accept event only when that window
showed this very quest (`GetQuestID()` equals the accepted quest; the same rule as `startItem`) and listed at least one
reward (`cap` alone is a fact about the character, not a reward: no `rewards` then). On turn-in, read at
`QUEST_COMPLETE` (the reward window), always written as before. A quest accepted without an offer window (shared,
auto-accepted) has no `rewards`. One read per window, plus (added in the build) a re-read of the open window when the
client says it has loaded a reward item (`QUEST_ITEM_UPDATE`): an item the client had not cached has no link yet and
would be skipped. At most 4 re-reads a window, only while the window is open (`QUEST_FINISHED` and `QUEST_PROGRESS`
close it) and shows the same quest, and a re-read is kept only when it lists at least as many items. Nothing per
frame.

```text
rewards?: {
  items:    [ 0-10 of { id, n, link?, suffix?, bonus? } ]   always given (GetNumQuestRewards, GetQuestItemInfo/Link "reward")
  choose?:  [ 1-10 of { id, n, link?, suffix?, bonus? } ]   choose one (GetNumQuestChoices, GetQuestItemInfo/Link "choice"); new
  choices?: [ item ids ]        turn-in only, unchanged (kept for older readers; the same items as choose)
  chose?:   item id             turn-in only, unchanged
  money?:   integer 1-2147483647   copper. GetRewardMoney() in that window: the QUEST'S reward, the same for every
                                character of that level. Never the player's money; absent when 0 or unreadable
  xp?:      integer >= 1        GetRewardXP() in that window, under the same guards as the turn-in's xp (below the level
                                cap, XP not turned off). On a turn-in the top-level xp stays too
  spells?:  [ 1-8 of integer >= 1 ]   reward spell ids, ascending, each once (C_QuestInfoSystem.GetQuestRewardSpells(quest))
  title?:   label 1-80          GetRewardTitle(): a title the quest grants
  cap?:     true                the character was at the level cap at the read (UnitLevel("player") >= GetMaxPlayerLevel(),
                                both known). A capped character's money can include converted XP, and xp is absent
  skill?:   { line: integer >= 1, pts: integer 1-1000 }   GetRewardSkillLineID() and GetRewardSkillPoints(): skill points
                                the quest grants in that skill line; left out unless both are usable
  cur?:     [ 1-8 of { id: integer >= 1, n: integer >= 1 } ]   reward currencies, sorted by id, each once:
                                C_QuestInfoSystem.GetQuestRewardCurrencies(quest), each row's currencyID and
                                totalRewardAmount (the first row of an id wins; the lowest 8 ids)
}

Every key but items is left out when the client function is missing, errors, answers a secret value, or answers 0 or
something out of range. A client with none of the new calls records exactly what it did before (items, choices, chose
on a turn-in; on an accept, rewards only when items or choices were listed). Saved and exported in the same shape;
the exporter drops each new key alone when it fails its check. In the schema, rewards.required is now ["items"] and
an if/then keeps choices required on a turn-in and refuses choices and chose on an accept.
```

**The exact key for quest money is `rewards.money`** (in `observations.events[]`, `type: "quest"`). It is named for what
it is. It matches the receiving site's money-key filter by design, so the site must allow this one path on purpose.
`QUEST_TURNED_IN`'s money argument stays unread, and `GetMoney` is never called for this.

Level scaling: `who.level` (already on every event) is the character's level at the read; with the accept's `lv` (the
quest's level) and `rewards.cap` a reader can tell a full reward from a reduced or converted one.

Size: about 60 bytes for money, XP and the cap flag; about 55 bytes per item with a link. A quest with two choices,
money and XP adds about 190 bytes to an accept and about 130 to a turn-in. No new dedup index: one accept and one
turn-in event per quest already exist.

## 2. Reputation from a kill (`killrep` event, new type)

```text
{ id, t, b?, type: "killrep", where, who,
  npc: integer >= 1            the creature, from the dead creature's GUID (the GUID is never kept)
  lv?: integer 1-255           its level, when a unit token showed it
  f:   integer >= 1            faction id
  d:   integer -100000..100000, never 0   the change this character received (bonuses included, like a turn-in's rep.d)
}
```

When: `CHAT_MSG_COMBAT_FACTION_CHANGE` (matched against the client's own `FACTION_STANDING_INCREASED` /
`FACTION_STANDING_DECREASED` formats, English forms as fallback; other formats, such as the generic and bonus ones,
record nothing; a translation that names the amount before the faction is read the right way round). The faction name
is turned into an id from the reputation list: a name-to-id table read with the same walk as a turn-in's `rep`
(`C_Reputation.GetFactionDataByIndex`, collapsed headers opened and closed again), only out of combat (`InCombatLockdown`
plainly false), at login (`PLAYER_ENTERING_WORLD`) and reused. A name it does not know marks it stale; it is read
again out of combat (at once, or when combat ends) and at most once a minute, never on every kill. A name still not
found, or one two factions share, records nothing. The message is tied to a creature only when every creature this
player saw die untapped by others (the existing death evidence: `UnitIsDead`, an NPC GUID, `UnitIsPlayer`,
`UnitPlayerControlled` and `UnitIsTapDenied` plainly false), **from 2 seconds before the message to 1 second after
it**, had the same NPC id; none or two different ids record nothing. `lv` is kept only when all of those deaths
showed the same plain level. Nothing within 5 seconds of a quest turn-in or of a reward window opening, nor while a
reward window is open. `who.level` tells a reduced amount from a full one. Never a standing.

Correction to the first draft, which looked only at the 2 seconds before the message: the server likely sends the
reputation change as soon as the kill is credited, while the creature's death reaches the client with the next batch
of unit updates, so the line can come first. The message is therefore held for 1 second (`C_Timer.After`; a client
without it decides at once, from the deaths before) and decided then; a turn-in seen during that second also drops it.
The death is read once per `UNIT_HEALTH` for both this and objective credit, so the event costs no more reads than
before. The in-game checklist asks which comes first.

Dedup: once per `npc`, `lv`, `f` and `d` per install (a saved FIFO index of 2,000 keys, like `credit`), at most 100 a
session, only under the half caps. About 230 bytes an event.

## 3. Creature health and power (`npcs[]` summary, new keys)

```text
hp?: [ 1-6 of { lv, v, diff? } ]       lv 1-255, v integer >= 1: UnitHealthMax(unit)
pw?: [ 1-6 of { lv, t, v, diff? } ]    t integer 0-30: UnitPowerType(unit); v integer >= 1: UnitPowerMax(unit, t)
                                       diff: the instance difficulty id, present exactly when read inside an instance
```

When: at the existing NPC sighting (target, mouseover, interaction window; at most once per NPC per 30 seconds), only
while the creature is alive, its level is a plain number of 1 or more, and each value is plain (not secret) and above
0. Per `lv` (and `diff`) the value seen most often over up to 4 distinct readings is kept, as `spd` does; at most 6
levels per NPC, the most recently seen. Like the rest of the summary it is cumulative per install and replaced by a
later export. A buff or debuff on the creature can change the number: a reader should want two installs to agree.
About 20 bytes per entry, inside the summary's own 500 KB cap.

As built: the reading needs `UnitIsDead` plainly false (a secret or missing answer reads nothing) and is taken in or
out of combat (a creature's maximum does not change when it is fought). Saved in `KutzInventoryObsDB.npcs[id]` as
`hp = { { lv, diff, v, c = { [v] = times } } }` and `pw = { { lv, diff, t, v, c = { ["t:v"] = times } } }`, the
most recently read last; `c` is the addon's own tally (like `spds`) and is never exported. For `pw` the type and the
maximum are counted as one pair, so `t` and `v` always come from the same reading. `diff` is the instance's
difficulty id (0 when the client gives none inside an instance). The export sorts each list by `lv`, then `diff` (none
first). Two installs' entries for the same creature join per `lv` and `diff`, the install seen last winning a level
both have, at most 6.

## 4. Disenchanting (`loot` event, new `src.kind`)

```text
src: { kind: "disenchant", item: integer >= 1 }     the destroyed item; items[] is what it gave
```

When: a loot window within 5 seconds of the player's own Disenchant cast (`UNIT_SPELLCAST_SUCCEEDED`, spell 13262 or
a spell of the same name). `src.item` comes from the window's `Item-` source GUID (`C_Item.GetItemIDByGUID`), else
from the bag item the cast was aimed at. **No item id, no event**: such a window is not recorded as `container` or
`other` either. Prospecting and milling do not exist in this game version.

As built: the cast counts from `UNIT_SPELLCAST_SUCCEEDED` (unit `player`); a cast that never succeeded marks nothing.
"The bag item the cast was aimed at" is the bag item clicked at most 1 second before the cast began
(`UNIT_SPELLCAST_START`): `C_Container.PickupContainerItem` (a left click while the spell waits for its target) and
`C_Container.UseContainerItem` (a right click) are hooked after the game runs them (never called), and the slot's
`C_Container.GetContainerItemInfo(bag, slot).itemID` is read. A window whose source is a creature or an object, or a
fishing window, stays what it was. One window per cast: the window closing ends it. A bag item used after the cast (a
container opened) makes the window that item's `container` window as before. The exported `src` of a disenchant
window is exactly `{ kind, item }`.

## Versions and compatibility

- KutzInventory **1.23.0**; inventory export **3.16.0** (new optional fields, one new event type, one new enum value:
  a minor). `observations.v` stays `1`. Format 2 is unchanged.
- **Old site, new addon:** unknown keys inside `rewards`, `rewards` on an accept, `hp`/`pw` in `npcs[]` and the
  `killrep` type are ignored by a reader that keeps known fields only. A `disenchant` loot event is dropped whole by a
  reader with a closed list of source kinds, which is right: it must not be read as a container.
- **New site, old addon:** every new field is absent, which means "not recorded", never "none". An older addon's
  disenchant windows are `container` events, often without `item`; the site should not treat those as container drops
  of nothing.
- An exporter older than 3.16.0 reading a 1.23.0 saved file leaves the new fields out.

## What the receiving site must change

1. Allow `rewards.money` through the money-key filter for quest events only, and amend the "gold is never shared"
   rule to say a quest's listed reward is a game fact, not a person's gold.
2. Read `rewards` on accept events; read `choose`, `money`, `xp`, `spells`, `title`, `cap`, `skill` and `cur` on both
   acts. `rewards.choices` is absent on an accept (schema: `rewards` requires only `items` now; a turn-in still has
   `choices`).
3. Accept the `killrep` event type and the `disenchant` source kind (with `src.item`).
4. Read `hp` and `pw` from `npcs[]`; show a value only when two installs agree.
5. Validate against export schema 3.16.0.

## Not in this version, room kept

- Coin dropped by creatures, anything about another player, computed drop rates: out of scope.
- Reputation as the quest window lists it: see above.
- Reserved for follow-ups the owner may confirm (nothing built): a signal that a character left its guild, and
  per-character Legacy challenge completion. Both would be character fields (`characters[]`), not observations, and
  would take the next minor (3.17.0).

## In-game checklist (nothing here has been run in the game yet)

- Open a quest offer with money and a choice of items: `/dump GetRewardMoney(), GetRewardXP(), GetNumQuestRewards(),
  GetNumQuestChoices(), GetRewardTitle()` and `/dump C_QuestInfoSystem.GetQuestRewardSpells(GetQuestID())`. In an
  offer window of a quest that grants skill points (or any offer window), `/dump GetRewardSkillLineID()` and `/dump
  GetRewardSkillPoints()`: which return is the line id and which the points? And `/dump
  C_QuestInfoSystem.GetQuestRewardCurrencies(GetQuestID())`. Do the
  numbers match the window in the offer window as well as in the reward window? Accept, `/reload`, and find
  `rewards` on the accept event; turn in and find it on the turn-in. "Friend of the Library" should show both
  amulets under `choose`, `money = 125` and `xp = 160` at a level that gets the full reward.
- Repeat on a character at the level cap and on one far above the quest's level; note money, XP and `cap`.
- Kill a creature that gives reputation, alone: one `killrep` with its `npc`, `f` and `d`. Kill two different
  creatures at once: none. Turn in a quest beside a fresh corpse: none. Print the chat line and `/dump
  FACTION_STANDING_INCREASED, FACTION_STANDING_DECREASED`. Does the reputation line come before or after the corpse's
  health reaches 0 (a chat frame timestamp beside `/etrace` with `UNIT_HEALTH` and `CHAT_MSG_COMBAT_FACTION_CHANGE`)?
  Right after login, kill one: is it recorded (the list is first read at `PLAYER_ENTERING_WORLD`; if the client has
  not filled it yet, a kill is missed until the next read out of combat)?
- Target a creature at full health, in and out of a dungeon: `/dump UnitHealthMax("target"), UnitPowerType("target"),
  UnitPowerMax("target")`, then `/dump KutzInventoryObsDB.npcs[<id>]`. Are the values plain in combat? Is
  `UnitHealthMax` the real number for a creature (not 100, a percentage, as some classic clients gave for units
  outside the group)? If it is a percentage, `hp` must not ship.
- Disenchant an item: `/dump GetLootSourceInfo(1)` with the window open. Is the source an `Item-` GUID, and does
  `C_Item.GetItemIDByGUID` still answer? Find the event with `kind = "disenchant"` and the right `item`, once picking
  the item with a left click and once with a right click (the aimed-at fallback when the GUID no longer answers).
- Listed reputation, for a later version: with a quest selected in the log, `/dump GetNumQuestLogRewardFactions(),
  GetQuestLogRewardFactionInfo(1)` and compare with what the turn-in gave.
