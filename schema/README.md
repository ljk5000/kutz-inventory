# Export formats

These JSON Schema 2020-12 files describe the local exporter's output. The Companion uses inventory 3.x; the CLI can select 2.x. [The root guide](../README.md#privacy-and-uploads) explains when anything is uploaded. This repository contains the producer/validator, not the receiving server.

| Schema | Version | Contents |
| --- | --- | --- |
| `inventory-export.v3.schema.json` | **3.12.0**, default | Inventory, selected character records, Legacy Trees, tracked raids, crafted history, hearth, retained observations and the NPC summary |
| `inventory-export.schema.json` | **2.1.0**, `--format 2` | Broader character profile including stats/sheet/talents/reputation/PvP, without raids/observations/crafted/hearth |
| `auction-scan.schema.json` | **1.2.0** | One realm/auction house's prices and optional exact stack supply |
| `inventory-export.v1.schema.json` | Historical 1.x | Older inventory with crafting estimates and AH prices; current tools do not write it |

The exporter writes `inventory.json` and `auction-scans.json` (an **array** of scan documents). Uploads send inventory to the import endpoint and **one scan document per request** to the auction endpoint. `examples/` contains visibly synthetic identities and data. `KutzInventory.example.lua` and the v2/v3 JSON are generated from `tools/fixtures/example-KutzInventory.lua`; game item/zone names remain illustrative game content.

From the repository root:

```sh
npm ci --prefix tools
node tools/validate_export.js schema/examples/inventory-export.v3.example.json schema/examples/auction-scan.example.json
node tools/examples.js
```

The validator selects a schema from the document version and handles auction arrays. `examples.js --write` regenerates the inventory examples and saved Lua; inspect changes before committing. `check_all.js` checks output against schemas and rejection cases.

## Inventory fields and conversion

`tools/convert.js` reads saved Lua tables/values without executing them (maximum table nesting 64). It merges characters by their saved stable key, choosing the latest `lastSeen` for duplicates; guild banks use their latest `updated`, and the latest warband snapshot wins. It merges price books and the newest monitor report. Multiple account folders are not preserved as an account list in the export.

Both formats include `schemaVersion`, `exportedAt`, `characters`, vendor `prices`, `warband`, `guildBanks` and `uiHealth` (null if absent). Money/prices use copper. Snapshot/export timestamps are ISO-8601 UTC or null, while some open game-data objects retain numeric Unix times. Observation `t` is explicitly Unix seconds. Container slots and equipped slots become sorted lists; empty slots are absent.

Common character fields include identity (`key`, `name`, optional `surname`, realm, level/class/race/faction/sex/guild/GUID), money/XP/rested XP, item levels, last seen, save diagnostics, location, trainers, update stamps, bags/bank, equipped gear, professions, currencies, skills, spells and recipes. Fields can be null/absent when unavailable; consult the schema's required/optional definitions rather than assuming every client API supplied a value.

### Format 3.x versus 2.x

Format 3 removes `stats`, `sheet`, ordinary `talents`, `spec`, `role`, `reputation`, `statistics`, `pvp`, `achievementPoints`, and their associated update stamps (`stats`, `sheet`, `talents`, `reputation`, `statistics`, `pvp`). Equipped items reduce to `{ slotId, id, link }`; links can still contain enchant/suffix IDs. This reduces duplicate profile data for a receiving site that obtains it elsewhere; **the exporter itself never fetches a profile API**. The addon still records these fields locally; format 2 retains them.

Format 3 additionally exports `raids` (an empty array if none recorded), `observations` when valid retained events exist, and optional character `crafted` and `hearth`. Turning off observation recording does not remove existing observations from export. Format 2 never includes these four additions. Both current formats support `legacyTree`.

Inventory 2.0 removed per-character computed `crafting`, plus AH/buy-price fields from inventory `prices`. Profit/levelling estimates remain a local report from `buildAll`, not an uploaded inventory section. Auction data are separate documents.

### Stable character keys (2.0.1 / 3.7.1)

The addon selects a character's table by GUID before writing identity or inventory. Existing owners retain the exact `Name-Realm` key; a legacy entry with no GUID is claimed on its next login. A different GUID looks for its own same-name entry, then starts empty at `Name-Surname-Realm` or `Name-<guid tail>-Realm`. If taken, it appends the full GUID and, if needed, a number before the realm. A later surname change keeps the key found by GUID. Previously overwritten records cannot be reconstructed.

Treat `characters[].key` as opaque; do not split/rebuild it. Real realm names can contain spaces/hyphens. Warband `updatedBy` and the recording character's raid `by`, `looter` and roster identity use the stable key. Other raid names use client-supplied `Name-Realm`; an unrecognized loot-message name can remain as written. Guild banks use guild/realm keys. Observations carry name/surname directly, not an inventory key.

### Legacy Trees (2.1.0 / 3.8.0)

Optional `characters[].legacyTree`:

```json
{
  "currency": { "available": 12, "spent": 4, "max": 16 },
  "trees": { "1187": { "spentInTree": 3, "nodes": { "100": 2 } } },
  "choices": { "101": 201 }
}
```

The addon reads trees 1187/1188/1189 (or client constants) with talents at login, trait events, manual scans and queued checkpoints. Values represent applied ranks/currency, not staged window changes. It preserves the last complete reading if any API/config/tree is unavailable. Currency comes from the first tree's shared currency, not a sum. The exporter keeps nonnegative integer currency/spend, positive ranks/selected entries and numeric map keys, removes unknown/invalid entries and emits nothing without a usable tree. This is per character, not warband.

### Crafted history (3.4.0) and hearth (3.5.0)

`characters[].crafted` contains `since`, `total`, `items: [{ itemId, name, count, crafts, lastAt }]` and `days: [{ date, items: [{ itemId, count }] }]`. Counts are items; crafts count the character's own “You create” messages (including conjuring). The addon counts from the first observed craft, always on, independent of drop tracking. Export keeps up to 5,000 most recently crafted item types, sorted by item ID, and the newest 120 crafting dates (`YYYY-MM-DD`, local date). Invalid entries are dropped; unusable names/times become null. Running `total` is not reduced by pruning.

Optional `characters[].hearth` is the bind-location name from `GetBindLocation`, recorded after loading screens and `HEARTHSTONE_BOUND`; `updated.hearth` is its read time. Absent until a usable reading.

### Raids (3.1.0)

`raids: [{ string, events }]` contains tracked raids with recorded events. `string` is the exact `KR1.<CODE>.<instanceId>.<startUnix>.<sig>` input. The addon checks shape, not signature; receiving servers must decide authorization themselves.

Events have ISO `t` and `kind`: `start` (instance ID/name/type/difficulty, `by`), `end` (instance ID/name), `encounter_start`/`encounter_end` (encounter ID/name, difficulty, group size, plus success on end), `loot` (item ID/link/count, `looter`) or `roster` (`members`). Missing API values are omitted. Account files tracking the same raid string merge their events. The addon records only during the two-hours-before/eight-hours-after window while grouped in an instance; exact matching instance IDs are preferred, with a window fallback. It retains at most 20 raids, 2,000 events each, pruning raids more than 14 days after start on load/add.

### Observations (3.2.0–3.12.0)

`observations: { v: 1, addon, install?, events: [...], npcs? }` comes from the **same saved file's** `KutzInventoryObsDB` table. The addon retains up to 5,000 events, 30 days and roughly 2 MB; export deduplicates by event ID, sorts by time/ID and caps count/serialized size. IDs combine a random install prefix and counter; they are not cryptographic identities or guaranteed globally unique.

Events include `id`, Unix `t`, optional game build `b`, `type`, `where` and `who`:

- `where`: instance/map ID, UI map, instance type/difficulty inside an instance, otherwise `x`/`y` from 0–1 rounded to four places.
- `who`: recording character's level, numeric class, faction, and optional **name/surname** (3.3.0). No realm or player GUID in this block.
- `loot`: `src` with kind (mob/boss/chest/fishing/herb/mine/skin/container/other, plus schema-compatible future kinds), NPC/object/item ID, creature/object GUID when known, level and attribution method; `items: [{ id, n, link?, won? }]`. Coins-only windows have empty items. Known reopened corpses are deduplicated, with skinning separate.
- `quest`: `act` (`accept`/`turnin`), quest ID, NPC/object giver/ender; turn-in can include item rewards/choice IDs/selected choice, never quest money. From 3.11.0, accept may carry the quest's level, group size, daily/weekly, time limit and starting item, and turn-in the XP and the reputation changes ([below](#quest-extras-3110)). From 3.12.0, accept may also carry `obj` and `poi` ([below](#quest-objectives-and-places-3120)).
- `vendor`: NPC ID, items with quantity, copper `price` per that quantity, optional item/currency costs and limited stock/null. Same vendor and stock are recorded at most once an hour in a session. From 3.9.0, optional `rx` and `filtered` (below).
- `trainer` (3.9.0): a class or profession trainer's whole list, with costs, spell IDs and `rx` (below).
- `taxi` and `flight` (3.11.0): a flight master's reachable nodes with their prices, and how long a flight took ([below](#flight-masters-and-flights-3110)).
- `gossip` (3.12.0): game-authored NPC or object gossip and quest greetings ([below](#game-text-3120)).
- `read` (3.12.0): game-authored pages of books and readable objects ([below](#game-text-3120)).
- `line` (3.12.0): game-authored creature speech and emotes ([below](#game-text-3120)).
- `npcs` and `install` (3.10.0) are not events but a cumulative per-install summary of the creatures the player looked at ([below](#npc-summary-3100)).

From 3.3.0, short links retain only colour, matching item ID and item name: `|cffRRGGBB|Hitem:<id>|h[<name>]|h|r`. Full game link payloads are excluded from these observation item fields.

From 3.6.0, quests can include `text`: accept has title/details/objectives; turn-in has title/progress/completion. Limits: title 200, details/completion 8,000, objectives/progress 4,000. Lua truncates by UTF-8 bytes; the exporter/schema also apply string-length limits. The recorder replaces occurrences of the given name with `$N`; it does not promise general anonymization. Text is read once per quest/action while the event is kept and while under half the saved-event size cap. Class/race wording remains. Shared/auto-accepted quests may lack window text.

From 3.7.0, loot `src.via: "roll"` is a group-loot roll list even when another player opened the corpse. `src.threshold` is the group's quality threshold (0–7); this is a partial view for items at/above that quality. Items already recorded in the character's loot window are not repeated. The corpse can be inferred from the client handle, a matching window or recent boss kill; otherwise kind is `other`. `src.encounter` identifies a boss encounter where known; `items[].won: true` reflects only the recording character's own system win message. Merge known corpse GUIDs carefully; these are observations, not a complete loot census.

From 3.9.0 (KutzInventory 1.16.0), `observations.v` stays `1`: readers ignore event types they do not know, so an older reader skips trainer events and the new vendor fields.

**`rx`** (vendor and trainer events) is `UnitReaction("npc", "player")` when the window was read: an integer 1–8 (1 hated, 4 neutral, 5 friendly, 6 honored, 7 revered, 8 exalted), absent when the client gave none. Every price and cost in these events is what the game showed this character, which **already includes its reputation discount**; `rx` is what lets a reader tell a list price from a discounted one. Prices and costs are game prices, not the player's money.

**Vendor reads** are made under the merchant window's "all" item filter (`SetMerchantFilter(LE_LOOT_FILTER_ALL)`) and the player's filter is put back immediately, in the same frame. `filtered: true` means the filter (this class only) could not be switched, so the items it hides are missing from `items`; it is absent when the read was unfiltered or the client has no merchant filter. `rx` and `filtered` are part of the once-an-hour same-stock check.

**Trainer events** are recorded at `TRAINER_SHOW` (about 0.5 s after the window opens; again on `TRAINER_UPDATE` while the first read was empty, at most 5 reads per window) with all three type filters (available, unavailable, used) switched on for the read and put back afterwards. Exact contract (the exporter drops anything else; a row without a usable `name`, `cost` or `st` is dropped; an event with no usable row, no `npc` or another `kind` is dropped):

```text
{ id, t, b?, type: "trainer", where, who,
  npc:  integer >= 1             the trainer's NPC ID, from UnitGUID("npc") (required; the GUID itself is never kept)
  kind: "class" | "profession"   profession = C_Trainer.GetTrainerType() is Tradeskills; class = any other general trainer
  rx?:  integer 1-8              UnitReaction("npc", "player")
  rows: [ 1-400 of {
    s?:        integer >= 1      spell ID from C_TooltipInfo.GetTrainerService(i) when its type is Spell; absent otherwise
    name:      string 1-120      GetTrainerServiceInfo name
    rank?:     string 1-40       its sub text: "Rank 4", "Journeyman"
    lv?:       integer >= 1      required character level
    skill?:    string 1-64       GetTrainerServiceSkillReq skill name
    skillReq?: integer >= 1      the skill rank it needs
    needs?:    [ 1-5 strings, each 1-120 ]   GetTrainerServiceAbilityReq ability names
    cost:      integer >= 0      copper, as the trainer shows it to this character (after any reputation discount)
    st:        "a" | "u" | "k"   available (learnable now) / unavailable (not yet) / known
  } ] }
```

Strings are game labels as shown: the addon trims them and cuts them to the limit in UTF-8 bytes; the exporter and schema refuse (drop) a label with `|` markup, a control character, more than the limit in characters, or anything shaped like a GUID (`Player-1-2`, `Creature-0-…`). Rows keep the window's order with headers left out. The hunter's Beast Training window (trainer type Pet: no trainer NPC, and it costs training points) is never recorded, nor is a window whose `npc` unit has no creature ID. The same `npc` with the same list and `rx` is recorded at most once in 7 days, checked against the retained events, so it holds across sessions while the earlier event is still kept (30 days, or less once the size caps prune it); the comparison uses each row's name, rank, cost, level and skill rank but not `st` (learning a spell does not re-record the list) and not `s`. One realistic 60-row class trainer event is about 5.2 KB of JSON (about 82 bytes per row, 1.1 KB gzipped); 400 rows is about 33 KB.

### Game text (3.12.0)

KutzInventory 1.19.0 records these events with the usual `id`, `t`, `b?`, `where` and `who` while drop tracking is enabled. A new text event must fit within the first 1,000,000 bytes of the approximate 2,000,000-byte saved-event cap. The addon's separate saved FIFO dedup indexes keep the 2,000 most recently inserted distinct keys per event type, across sessions and event pruning. Hits leave insertion order unchanged. An evicted key may be recorded again. Indexes never export. Export deduplicates by event ID as usual.

**Gossip** comes from `C_GossipInfo.GetText()` at `GOSSIP_SHOW` (legacy `GetGossipText()` when the modern read is unavailable) or `GetGreetingText()` at `QUEST_GREETING`. Dedup uses subject type, subject ID and a checksum of the normalized, capped text, shared between both kinds. A secret or invalid subject or text is skipped. The recorder replaces the recording character's name with `$N`; class and race words are preserved as in quest prose. The source is game text. Gossip options, player chat and mail are excluded.

```text
{ id, t, b?, type: "gossip", where, who,
  npc:     integer 1-2147483647   creature or vehicle ID from UnitGUID("npc"), exactly one of npc or object
  object:  integer 1-2147483647   game object ID from UnitGUID("npc"), exactly one of npc or object
  kind:    "gossip" | "greeting"  the window that supplied the text
  text:    prose 1-4000           normalized game text, line breaks allowed; no pipe markup, GUID shapes or other control characters
}
```

The recorder trims prose, removes control characters other than line feeds, and caps it in UTF-8 bytes on a character boundary. The exporter and schema enforce string-length limits. The exporter drops events without a valid required field or with both subject IDs valid, and projects only the documented fields. GUIDs are never stored in these events.

**Readable pages** are read at `ITEM_TEXT_READY` after an observed `ITEM_TEXT_BEGIN`. A mailbox opened at any point invalidates the reading, including when it closes before the page is ready. The recorder checks the mail event state and visible mail frames, and requires successful `ItemTextGetCreator()` and `ItemTextGetMaterial()` checks at begin and at each page before reading any body. Non-empty or secret creator values, unavailable or secret checks, and materials naming mail, letters or stationery are refused. Title and prose replace the recording character's name with `$N`. The title must match across the open and page events. Dedup uses object ID, item ID or a checksum of the normalized title, with separate namespaces, plus the page number. A page revisited with a different body deduplicates on the same key.

```text
{ id, t, b?, type: "read", where, who,
  item?:     integer 1-2147483647   bag item ID from a secure UseContainerItem post-hook within 1 second before the open,
                                    from a slot flagged readable, with matching item name and no "npc" GUID
  object?:   integer 1-2147483647   game object ID from UnitGUID("npc") on open
  title:     label 1-200           ItemTextGetItem(), required even when a source ID is known
  page:      integer 1-2147483647   ItemTextGetPage(), first page is 1
  last?:     true                  successful ItemTextHasNextPage() returns plain false or nil
  material?: label 1-40            ItemTextGetMaterial() when nonempty and usable
  text:      prose 1-8000          ItemTextGetText(), line breaks allowed; no pipe markup, GUID shapes or other control characters
}
```

At most one source ID is present. When provenance is ambiguous or unavailable, a safely identified game-authored page has the title alone. Labels have no pipe markup, GUID shapes or control characters. Text and labels are capped in UTF-8 bytes by the addon. Consumers render these strings as text. The exporter drops events without usable required fields, with both IDs valid, or with explicit mail or creator metadata. Invalid optional values are omitted.

**NPC lines** come from `CHAT_MSG_MONSTER_SAY`, `CHAT_MSG_MONSTER_YELL`, `CHAT_MSG_MONSTER_WHISPER`, `CHAT_MSG_MONSTER_EMOTE` and `CHAT_MSG_RAID_BOSS_EMOTE`. The speaker must have a plain `Creature-` GUID in argument 12 and resolve to a current unit the client identifies as neither a player, player-controlled nor a non-combat pet. Missing, secret or doubtful identities are skipped. The recording character's, roster members', current player target's and any provided recipient's names are replaced with `$N` in the prose. If the identity checks fail, if non-ASCII text remains after scrubbing, or if capitalized words remain outside a small list of common sentence openers and the pronoun “I” and its contractions, the line is skipped. The handler refuses incoming bodies over 8,000 bytes. Dedup uses NPC ID and a checksum of the normalized, capped text, shared across all five kinds. Same-session repeats of an already accepted body check a bounded checksum cache before roster or location reads.

```text
{ id, t, b?, type: "line", where, who,
  npc:     integer 1-2147483647                        creature ID from the event's sender GUID
  kind:    "say" | "yell" | "whisper" | "emote" | "boss"  source event, in the order listed above
  text:    ASCII prose 1-2000                          normalized game text, line breaks allowed; no pipe markup,
                                                       GUID shapes or other control characters
}
```

Speaker GUIDs and recipient metadata are never saved. Player chat and player or pet speakers are excluded. The unknown-name check relies on the game's capitalization of substituted names. Ambiguous lowercased words cannot be identified as names from the body alone. The exporter drops events with invalid required fields. Location uses the usual `where` precision.

### Flight masters and flights (3.11.0)

From 3.11.0 (KutzInventory 1.18.0) observations may be of type `taxi` and `flight`; `observations.v` stays `1` (an older reader skips both types).

**Taxi events** are recorded at `TAXIMAP_OPENED` while the window's `npc` unit is a creature (its NPC ID from `UnitGUID("npc")`; an object or a player is never recorded). Node ids come from `C_TaxiMap.GetAllTaxiNodes(GetTaxiMapID())`, joined by `slotIndex` to the window's slot functions `TaxiNodeGetType`, `TaxiNodeCost`, `GetNumRoutes` and `TaxiNodeName` (`TaxiNodeGetType` falls back to the node's `state` when the client has no such function). **Nothing is recorded** when the client gives no node ids (names are never used as ids), a node id or slot appears twice, there is not exactly one current node, a reachable slot has no node or no cost, a slot's name disagrees with its node's name, or more than 200 nodes are reachable: a list cut short would read as those nodes being unreachable, so it is refused rather than truncated. The same `npc`, `node`, list of nodes and costs and `rx` is recorded at most once in 7 days, checked against the retained events (`hops` is not part of the check). Exact contract (the exporter drops the whole event when `npc` or `node` is missing or any `to` entry has no usable `node` or `cost`, repeats a node or names `node` itself; a `hops` outside 1-100 is left out):

```text
{ id, t, b?, type: "taxi", where, who,
  npc:  integer >= 1             the flight master's NPC ID, from UnitGUID("npc") (required; the GUID itself is never kept)
  node: integer >= 1             its own taxi node id: the window's one CURRENT node (required)
  rx?:  integer 1-8              UnitReaction("npc", "player")
  to: [ 0-200 of {               every REACHABLE node, sorted by node, each once, never node itself; [] when none yet
    node:  integer >= 1          the taxi node id
    cost:  integer >= 0          copper, TaxiNodeCost as the window shows it to this character (after any reputation
                                 discount; see rx): a game price, not the player's money
    hops?: integer 1-100         GetNumRoutes: the flight legs of the route; absent when the client gave none
  } ] }
```

Nodes the character has not discovered or cannot reach (`DISTANT`, `NONE`) are not listed, so `to` says what this character could reach from here at the time, not the whole network. Node names are not kept; a reader maps node ids to names from game data.

**Flight events** time one flight. It starts when `TakeTaxiNode(slot)` (hooked with `hooksecurefunc`, never called by the addon) picks a node in a taxi window that was read as above (also when its list was not re-recorded that week), followed within 10 seconds by `PLAYER_CONTROL_LOST` with `UnitOnTaxi("player")` a plain `true` (asked again every 0.5 s for 5 s; the start is the moment control was lost). It ends at the next `PLAYER_CONTROL_GAINED` after which `UnitOnTaxi` is a plain `false` (asked again for 3 s while it still says `true`; control regained mid-flight keeps the flight). The landing is trusted only when the player's position on the taxi map (`C_Map.GetPlayerMapPosition(GetTaxiMapID(), "player")`) is within 0.01 map units of the chosen node and no other node of that window is closer, or, when that position cannot be read, when the next taxi window opened within 2 minutes has the chosen node as its current one. Anything else (another landing spot, a secret or missing answer, tracking switched off on the way, under 5 seconds or over an hour) records nothing. One flight per `from` and `to` in 30 days, checked against the retained events. Exact contract (the exporter drops the event when any field fails its check):

```text
{ id, t, b?, type: "flight", who,      no where: never a position or route trail
  t:    integer                  when it landed, from time() (Unix seconds)
  from: integer >= 1             the taxi node id it started at (the flight master's own node)
  to:   integer >= 1             the taxi node id it landed at, the one chosen in the window; never equal to from
  sec:  integer 5-3600           whole seconds from losing control to landing (GetTime, rounded)
}
```

`sec` is this character's flight as flown (the game's flight speed, with any detour of the route); it is not a price and says nothing about money. **Privacy:** a taxi event has the same `where` and `who` as any event (where the flight master stands); a flight event adds only which two nodes and how long, with no position, path or time other than the landing's `t`. Measured as compact JSON with a named `who`: a taxi event with 40 reachable nodes is about 1.6 KB (about 33 bytes per node beyond a 260-byte event with none; 430 bytes gzipped), a flight event about 200 bytes.

### Quest extras (3.11.0)

From 3.11.0 (KutzInventory 1.18.0) quest events may carry a few more facts; `observations.v` stays `1` and every one is optional (an older reader ignores them). Each is left out when the client did not say or the addon was not sure, so a missing field is never proof of "no".

**On accept**, read at `QUEST_ACCEPTED` from the quest log (`C_QuestLog.GetLogIndexForQuestID`, then `C_QuestLog.GetInfo`; the entry must be this quest by its own `questID` and not a header; when the quest is not in the log yet it is read once more about a second later and the fields are added to the saved event), plus the item that started it from the offer window (`QUEST_DETAIL`'s `questStartItemID`, kept only when that window showed this very quest). **On turn-in**: `xp` is what the reward window showed (`GetRewardXP` at `QUEST_COMPLETE`), only while the character is under the level cap (`UnitLevel("player")` below `GetMaxPlayerLevel()`, both known) and XP is not turned off (`IsXPUserDisabled` a plain `false`, or a client without it). `rep` compares standings: every faction's standing is read when the reward window opens (`QUEST_COMPLETE`, out of combat; collapsed headers of the reputation list are opened for the read and closed again, as the addon's reputation scan does) and the same factions again about a second after that quest's `QUEST_TURNED_IN` (by `C_Reputation.GetFactionDataByID`); only the differences are kept, never a standing. Headers without a standing of their own, renown factions (`C_Reputation.IsMajorFaction`; their standing restarts each level), the Guild faction (1168; it is the guild's, not the quest's) and factions first met by this turn-in are left out. **`rep` is dropped whole** when something else could have moved a standing in between: a loot window (`LOOT_OPENED`), combat (`PLAYER_REGEN_DISABLED`, or `InCombatLockdown` not a plain `false` at either read), another reward window or turn-in before the second read, or more than 5 minutes from the window to the turn-in; also on a client without `C_Timer`, when more than 6 factions changed, when one changed by more than 100000, or when nothing changed. Accepting another quest within that second (the next quest of a chain) does not drop it: an accept cannot change a reputation. Exact contract (the exporter leaves out each accept field that fails its check, an `xp` that is not an integer >= 1, and the whole `rep` when any entry fails, a faction repeats or there are more than 6; the schema refuses accept fields on a turn-in and `xp`/`rep` on an accept):

```text
{ id, t, b?, type: "quest", act: "accept", quest, npc? | object?, where, who, text?,
  lv?:        integer 1-255      the quest's level in the quest log (on a client that scales quests, as shown to this character)
  group?:     integer 2-40       the quest log's suggested group size; absent for 0 or 1
  freq?:      "daily" | "weekly" the quest log's frequency (Enum.QuestFrequency Daily / Weekly); absent for any other
  timed?:     true               C_QuestLog.GetTimeAllowed(quest) above 0 when accepted; absent otherwise
  startItem?: integer >= 1       the item that started it (QUEST_DETAIL questStartItemID); absent for 0
}
{ id, t, b?, type: "quest", act: "turnin", quest, npc? | object?, where, who, text?, rewards?,
  xp?:  integer >= 1             GetRewardXP() in the reward window, as offered to this character (it may include the
                                 character's XP bonuses); absent at the level cap, with XP turned off, or when 0
  rep?: [ 1-6 of {               the reputation the turn-in changed, sorted by f, each faction once
    f: integer >= 1              the faction ID (factionID)
    d: integer, -100000 to 100000, never 0   the change in reputation points: positive gained, negative lost
  } ] }
```

`d` is what this character received, not the quest's listed reward: it includes the character's reputation bonuses, and `rep` includes any spill-over to other factions, so the same quest can differ between characters.

**Never recorded:** quest money (`GetRewardMoney` is never called and the money argument of `QUEST_TURNED_IN` is never read), the player's money, and any standing, reputation level or renown level: `d` is a change, so a reader cannot tell from it where the character stands. Measured as compact JSON with a named `who`: the five accept fields add about 65 bytes to an accept (`lv` alone about 8), `xp` about 10 bytes to a turn-in and each `rep` entry about 20 (xp with two changes about 50; six changes about 120).

### Quest objectives and places (3.12.0)

These optional fields are on the existing `type: "quest", act: "accept"` event only. They are read on `QUEST_ACCEPTED`. Each missing field can be filled once on the same retained event from the first usable read within 10 seconds, on a quest-data, quest-log, quest-POI or combat-end update or a one-second fallback. Each field is independent. Abandoning or turning in the quest, or switching tracking off, cancels its pending read.

```text
obj?: [ 1-12 of {                first valid rows in C_QuestLog.GetQuestObjectives(quest) order
  t:    string 1-40              objective type as supplied, matching [a-z][a-z0-9_-]{0,39}
  n:    integer 0-2147483647     numRequired
  text: prose 1-400             objective wording, with progress counters stripped and player name replaced with $N
} ]
poi?: [ 1-8 of {                 first distinct usable quest points in API order, on the accept event's where.uiMap
  map:  integer 1-2147483647     UI map ID
  x:    number 0-100             horizontal map percent, rounded to two decimal places
  y:    number 0-100             vertical map percent, rounded to two decimal places
} ]
```

`obj` is recorded only if it fits under the half-cap gate. Text retains line breaks and excludes pipe markup, GUID shapes and other control characters. The recorder strips leading or trailing ASCII fraction/percent counters and refuses text with a remaining such counter. It caps prose in UTF-8 bytes. Only the required amount is kept. `numFulfilled` and `finished` are never read. The exporter drops invalid rows, retains the first 12 valid rows, and omits an empty `obj`.

`poi` comes from `C_QuestLog.GetQuestsOnMap(uiMapID)` rows for this quest and map, skipping offer markers. When no usable row exists, `C_QuestLog.GetNextWaypointForMap(quest, uiMapID)` can supply one point. Reads require a plain out-of-combat state and the player's map to still be the acceptance map; a quest flagged ready to turn in is skipped when the client supplies that check. There is no UI or map state change. Secret, missing, out-of-range and zero-origin points are omitted. Points are deduplicated after rounding. The exporter also enforces the acceptance map, deduplicates and caps the array, and omits an empty `poi`. These are game quest markers and can represent an objective area or waypoint. They contain no player progress counts. A missing `obj` or `poi` means the recorder had no usable reading.

### NPC summary (3.10.0)

From 3.10.0 (KutzInventory 1.17.0) the observations section may carry `npcs` and `install`; `observations.v` stays `1` (an older reader ignores the two new keys). A section can now hold `npcs` with an empty `events` array (an install that saw creatures but recorded no event yet); without `npcs`, `events` still has at least one event. **A receiver must accept an observations section whose `events` is empty.**

**It is a cumulative per-install summary, not events.** The addon keeps one entry per NPC ID in `KutzInventoryObsDB.npcs` and updates it in place, so a later export from the same install **replaces** the earlier one: counts are running totals, not deltas, and must not be added to what an earlier upload said. `install` is the key for that replacement: the saved file's random per-install prefix, the one the event IDs start with (`k1f9c2` in `k1f9c2-000017`). When one export merges several saved files that hold a summary (several game accounts on one PC), their entries are merged (level ranges widened, cell counts added, the other fields from the most recent sighting) and `install` is their prefixes sorted and joined by `+` (`aa1100+zz9900`); a receiver should let a summary replace every earlier one whose `install` shares a part with it. Two copies of the same install (same prefix) are never added up: the copy with the latest `day` wins, else the larger. Like the event IDs, the prefix is random, not cryptographic and not guaranteed globally unique. A saved file without a valid prefix exports no summary.

When the addon records: on `PLAYER_TARGET_CHANGED` ("target"), `UPDATE_MOUSEOVER_UNIT` ("mouseover"), an open vendor, trainer, flight master or quest window or another interaction window (since 3.11.0, `svc` below) ("npc", "questnpc") and a loot window's corpse while it is the target, mouseover or focus. Only while drop tracking is on (the same switch and agreement as the events), only for creatures (`Creature-`/`Vehicle-` GUIDs) that no player controls (`UnitPlayerControlled` a plain false: no pets, guardians, totems or charmed mobs; a client without the API records nothing) and that are not companions (creature type 12), only where the player has map coordinates (never inside an instance), and at most once per NPC per 30 seconds (sooner only the first time the player comes near it). Nothing is stored while the GUID, `UnitIsPlayer` or `UnitPlayerControlled` is secret; any other value the client marks secret is left out. Exact contract (the exporter drops an entry without a valid `npc` or `day` and leaves out any other field that fails its check):

```text
observations: { v: 1, addon, install?, events: [...], npcs?: [...] }   install is present exactly when npcs is
install: string                     "[0-9a-z]{4,16}", or several of those sorted and joined by "+"
npcs: [ 1-3000 of {                 sorted by npc; the most recently seen kept; at most about 1 MB of JSON
  npc:   integer >= 1               NPC ID from UnitGUID (the GUID itself is never kept)
  name?: label 1-80                 UnitName(unit) as last seen, in the client's language, under the same rules as sub
                                    below (never the recording character's name, markup, a GUID shape, an owner title
                                    or anything with "'s "); never the client's UNKNOWNOBJECT ("Unknown", a unit not
                                    loaded yet). A refused name leaves the last good one
  lv?:   [min, max]                 integers 1-255, min <= max: UnitLevel over all sightings; a skull (-1) is never a level
  boss?: true                       UnitLevel was -1 while UnitClassification was "worldboss" or the character was at the
                                    level cap (GetMaxPlayerLevel); a skull seen by a lower character only says
                                    "10+ levels above" and is not kept
  cls?:  "normal" | "elite" | "rare" | "rareelite" | "worldboss" | "trivial" | "minus"   UnitClassification, last seen
  ct?:   integer 1-100000 | label 1-40      UnitCreatureType: its type id (1 Beast, 7 Humanoid, ...) when the client gives
                                    one, else the localized name (companions, type 12, are never recorded)
  fam?:  integer 1-100000 | label 1-40      UnitCreatureFamily: its family id, else the localized name
  rxA?:  integer 1-8                UnitReaction(unit, "player") last seen by an Alliance character, read only while the NPC
                                    was alive and out of combat (a neutral mob reads hostile once fought, and so does its corpse)
  rxH?:  integer 1-8                the same, by a Horde character (an NPC is often friendly to one side, hostile to the other)
  sub?:  label 1-80                 the subtitle under its name ("Journeyman Tailor") from C_TooltipInfo.GetUnit, taken only
                                    when line 1 is the unit's own name, line 3 is a level line and line 2 is not; "<...>"
                                    brackets removed; never a line naming an owner (the client's pet and summon title
                                    formats), anything with "'s ", the recording character's name, markup, a GUID shape
                                    or over 80 bytes (the exporter refuses "'s " too). Read only while the player is out of
                                    combat, once a session per NPC until one is found; a read stopped by a secret value is
                                    tried again on a later sighting
  svc?:  [ 1-13 of "vendor" | "repair" | "flight" | "trainer" | "bank" | "guildbank" | "inn" | "auction" | "stable" |
         "battlemaster" | "spirit" | "guild" | "tabard" ]   since 3.11.0: the services it was seen to offer, each once,
                                    sorted; a set summed over all sightings (never removed). Sources: the interaction type
                                    of PLAYER_INTERACTION_MANAGER_FRAME_SHOW, matched by its Enum.PlayerInteractionType name
                                    (Merchant vendor, TaxiNode flight, Trainer trainer, Banker bank, GuildBanker guildbank,
                                    Registrar or PetitionVendor guild, GuildTabardVendor or TabardVendor tabard, Binder inn,
                                    Auctioneer auction, StableMaster stable, BattleMaster battlemaster, SpiritHealer or
                                    AreaSpiritHealer spirit); the vendor, trainer and flight master windows the addon reads;
                                    repair when CanMerchantRepair() is true in a merchant window; inn at CONFIRM_BINDER or
                                    HEARTHSTONE_BOUND while talking to it. Only for the "npc" unit when it is a creature (a
                                    mailbox, guild vault or other object never is). Each is a near sighting; within the
                                    30 s only the flags are added. No gossip text or options
  spd?:  integer 10-2000            beasts only (type id 1, or "Beast" without an id): UnitAttackSpeed main hand in
                                    hundredths of a second, read alive and out of combat; the value seen most often over
                                    up to 4 distinct readings (a tie keeps the one that got there first)
  day:   integer 1-1157407          the last day it was seen: floor(unix time / 86400), days since 1970-01-01 UTC
  cells?: [ 1-40 of [uiMap, cx, cy, n] ]    sorted by uiMap, cx, cy
         uiMap integer >= 1           C_Map.GetBestMapForUnit("player")
         cx, cy integer 0-99          floor(x * 100), floor(y * 100) of the player's map position (0-1, four places)
         n integer >= 1               how often the player stood in that 1% square while within about 10 yards of the NPC
                                      (CheckInteractDistance(unit, 3); "not near" when the client refuses, as in combat)
                                      or with a window open with it, so the player's position stands for the NPC's. At most
                                      one count per NPC and square per 10 minutes of a session. At most 40 squares: the addon
                                      keeps the most counted only approximately (a new square at the limit replaces the
                                      least counted one, often a count-1 square); the exporter sends the 40 most counted
} ]
```

Labels follow the trainer label rules above (no `|` markup, control characters or GUID-shaped text, at most the limit in characters). **Privacy:** the summary holds no time finer than a day (one `day` per NPC, the last), no player names (`name` and `sub` are the NPC's own, with the guards above), no GUIDs and no ordered trail: cells are unordered counts sorted by place, and nothing older than 180 days is kept. It still says which NPCs this install's characters looked at, the last day for each, and roughly where the player stood beside them. The addon drops an NPC not seen for 180 days when the game loads, and keeps at most 3,000 NPCs (the least recently seen go first: oldest `day`, then fewest counts) and about 500 KB of saved data for them (its own cap, apart from the events' 2 MB, so the summary and the events never push each other out; 3,000 realistic entries with names measured about 440 KB), and at most 40 squares per NPC. Measured with realistic data (every NPC named, most with 0-3 squares, about one in eight with a subtitle), compact JSON is about 140 bytes per NPC (before `svc`, which adds roughly 15 bytes of saved data per service flag, about 10 in compact JSON): 500 NPCs 70 KB (13 KB gzipped), 3,000 NPCs 432 KB (77 KB gzipped); the exporter's indented file is about 1.8 times that (500 NPCs 127 KB, 3,000 NPCs 791 KB; 15 KB and 93 KB gzipped).

No observation field is intended for coin loot, quest/player money, general chat, guild or other players' names/GUIDs. Ordinary inventory, monitor errors and raids have different data and must be reviewed separately. Recording defaults on in new installs since addon 1.13.0; existing off choices persist. `/kinv track drops off` also stops the NPC summary; old retained events and the summary still export after it.

## Auction scans

A document includes `schemaVersion`, region (client region mapped to `us/kr/eu/tw/cn`, default `us` if unknown), realm (the exact client string, e.g. `Example Realm`), house (`alliance/horde/neutral`), start/scan times, completion, queued/answered counts, addon identity/version and `items` keyed by item ID.

`houseSource` is `npc` (auctioneer faction), `zone` (neutral town) or `player` (faction fallback). Optional `method` is `full` or `search`; migrated older readings omit it. `scope` is `all` for whole-house downloads, `crafting` for crafting-item searches; an absent scope is not evidence of a full house.

`items[id]`:

- `p`: up to three lowest positive integer unit prices in copper; `q`: matching quantities.
- `n`: result rows seen; `t`: ISO read time.
- Optional `c`/`s`: item class/subclass; `e`: equip-slot token; `name`: plain item name up to 120 characters.
- Optional 1.2 `supply: { complete, lots }`: each lot is `[wholeStackBuyoutCopper, unitsPerStack, identicalStackCount, variant]`. Exact buyouts survive fractional unit prices (`p` rounds up for compatibility). `q` describes only the top three, not total stock. Bid-only auctions are excluded; identical buyout/count/variant stacks aggregate.

Fungible materials use an empty variant; weapons/armor retain the `item:...` string or `unknown` if unavailable. Consumers must not present unknown variants as exact gear. Searches/old scans lack supply; totals and purchase costs then remain estimates. Failed raw reads make supply/scan incomplete.

A missing item is **unknown**, except in a **complete** `scope: "all"` snapshot where absence means not listed at scan time. An incomplete full scan cannot establish absence. `p: []` is an answered search with none listed. Legacy empty readings are omitted because old timeouts could look empty. Consume the whole scan document, not split fragments.

No seller name is retained. The JSON carries no scanning character or player GUID, but uploads authenticate with the user's key. The sender tracks latest acknowledged/rejected `scannedAt` per realm/house in `<output>.auctions-sent.json`, spaces sends 10.5 seconds apart, bounds 429 retries, skips permanently rejected scans (400/413/422) until newer, and lets authentication/account refusals reach the caller. See the [Companion guide](../companion/README.md).

## Versioning and consumers

Versions live in `SCHEMA_VERSION`, `SCHEMA_VERSION_3` and `AUCTION_SCHEMA_VERSION` in `tools/convert.js`. Keep schema/output changes together. Description-only cleanup that does not change the contract need not create a new output version; a compatibility-rule correction should use a patch.

| Change | Version change |
| --- | --- |
| Contract clarification/compatible correction | Patch |
| New optional field or enum value | Minor |
| Removed, renamed, retyped or newly required field | Major |

Consumers should tolerate unknown keys/types for forward compatibility; schema validation must still use the intended version. Open game-data objects can gain fields within a major. Format 3 intentionally excludes its dropped profile fields and permits only slotId/id/link in equipped records. A historical inventory without `schemaVersion` is treated as 1.0.0 by this validator. Server consumers should validate untrusted input independently; these client-side checks make no claim about a deployed service's implementation.

## Privacy for consumers

Inventory is private user data, not a ready-made public profile. Require an explicit sharing policy before exposing GUIDs, location/hearth, money, banks/guild tabs, activity times, diagnostics, monitor messages/stacks, raids (other players and loot) or observations (identity and location history; the NPC summary's last-seen days and the squares stood in). Names/guilds and all the other character details also deserve intentional sharing controls. Auction documents omit these character fields, but the authenticated receiver can associate uploads with a key and connection metadata. This repository cannot guarantee server access controls or anonymous aggregation.
