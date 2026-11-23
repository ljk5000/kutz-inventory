# Release notes

## KutzInventory 1.23.0

Export 3.16.0: every addition is optional; nothing 3.15.0 had changes meaning or goes away. Format 2 (2.1.0) and auction scans (1.2.0) are unchanged. The full spec, with how each client call was checked: [docs/quest-rewards-and-creature-facts.md](docs/quest-rewards-and-creature-facts.md). Nothing here has been run in the game yet: see the [1.23.0 checklist](docs/inventory-recording.md#wow-forever-1230-checklist).

- **Quest rewards as the window lists them, on accept and turn-in.** With drop tracking on, an accept now carries `rewards` as the offer window listed them, and a turn-in's `rewards` gains the same: the choose-one items with their counts (`choose`), the quest's listed money (`money`, in copper), XP, reward spells, a title, skill points (`skill`), currencies (`cur`) and whether the character was at the level cap (`cap`). A key the window did not list, or the client did not answer plainly, is left out; the window is read again when a reward item finishes loading. `rewards.items`, `choices` and `chose` and a turn-in's top-level `xp` and `rep` are as before.
- **Your gold is still never read.** `rewards.money` is the quest's own reward as its window lists it (`GetRewardMoney`), a fact about the quest like a vendor price. The addon never calls `GetMoney` and never reads `QUEST_TURNED_IN`'s money argument.
- **The reputation a kill gives** (`killrep` events): from the game's own "Reputation with ... increased by ..." line, kept only when every creature you saw die (untapped by other players) from 2 s before the line to 1 s after it was the same creature, and never within 5 s of a quest turn-in. The faction comes from your reputation list by name, read out of combat and cached. Never a standing, never the creature's GUID; once per creature, level, faction and amount per install.
- **Creature health and power** in the NPC summary (`hp`, `pw`): `UnitHealthMax`, and the power type with its maximum, per level (and difficulty inside an instance), read once per existing sighting of a living creature; the value seen most often is kept, six levels per creature.
- **Disenchanting**: the loot window of your own Disenchant is recorded as `src.kind = "disenchant"` with the item it destroyed (from the window's source, else the bag item you clicked just before the cast). A window without that item's id is not recorded at all; earlier versions recorded these as `container`, often without the item.
- **Legacy challenges** (`characters[].legacyChallenges`, recorded with drop tracking on or off): for each character, every Legacy challenge the client knows (65 ids) and the second set (63969-64033, once started or done): completed, whether this character earned it and which of your characters did, the date, and each criterion's progress. Read after login, after achievement and criterion events (at most once per 30 s, never in combat), on `/kinv scan` and at logout when a read is waiting; saved only when something changed. `earnedBy` names your other characters: private, like the quest log.
- Existing installs see one 1.23.0 line at login that says what drop tracking now adds; the first-use note now says it never records "your gold".
- Companion 0.12.8 (below) bundles this addon and sends export 3.16.0.

## Companion 0.12.8

- Uploads the facts in the game's quest cache, `Cache/WDB/<locale>/questcache.wdb` in the selected game folder, as quest-cache 1.0.0 documents to `POST /api/wow/quest-cache` (new schema `schema/quest-cache.schema.json`). Per quest: id, level, minimum level, quest sort, quest info, the next quest in the chain, the XP difficulty column and multiplier, money, the reward spell, the item given at the start, the items given and to choose from, reputation and currencies. Each field was checked against the client's quest query response layout and at least two other sources; what could not be confirmed (quest type, flags, time limit, title, skill, honor, objectives, races, map points) is left out. **No quest text** (title, description, objectives, completion text) is read or sent, and nothing about the player: no character, account, realm, path or key.
- Only builds 70938 and 71037 are read. A file of another build, layout or locale, or a truncated or locked one, is skipped quietly with nothing sent; the game folder is opened read-only and never changed.
- It runs in the existing upload cycle, after the inventory and auction uploads (at start and after each game save), with no new timer or watcher. Only new or changed quests are sent: a hash per quest, recorded in `inventory.json.quest-cache-sent.json` (no key) only after the site accepts it. A new client build or locale, another site or account, or a missing state file sends the whole cache again. At most 500 quests per request, spaced like auction scans.
- A site without the endpoint (HTTP 404/405) is told once in the log and asked again only after the next start; 400/413/422 skip that document until it changes; a refusal of this endpoint (401/403/426) stops only the quest cache, until the next start; a 2xx without `{ "ok": true }` records nothing; other failures wait for the next save. The quest cache is started after the inventory and auction prices and never waited for. A quest-cache problem never delays or fails the inventory or auction uploads. Pausing the Companion stops it too; there is no separate switch in the tray yet. The CLI sends it with `--upload` from a game folder's saved file, to `WOW_QUEST_CACHE_URL` or the import URL ending in `/quest-cache`, and leaves it out with `--no-quest-cache`.
- Bundles KutzInventory 1.23.0 and sends inventory export 3.16.0.

## KutzInventory 1.22.1

- An item facts entry's exported `day` (`d`) now records the last day its exported content changed (first read, a changed field or build, or a new or changed variant) and stays unchanged when the item is met again with nothing new, so Companion 0.12.7's upload trimming does not re-send unchanged bag items every day. A separate saved-only last-met day (`m`, never exported) keeps pruning the least recently met first; dropped items are read again when met again. The table stays capped at 200 kB of the saved file (about 700 items).
- The export stays 3.15.0: `items[].day` keeps its type and range, only its meaning changes (see `schema/README.md`).

## Companion 0.12.7

- Trim already-acknowledged `observations` before upload (`tools/upload_ack.js`). When `/api/wow/import` returns an `ack` (`epoch`, highest event counter per install prefix, and highest summary `day`), the Companion saves those marks beside the export in `<output>.ack.json` (never the API key), bound by a SHA-256 context digest of the site origin, verified username, sorted saved-file list, export schema version and Companion version. Later uploads omit events at or below the acknowledged counter (unless the install rolled back to a lower highest counter) and `npcs`, `items` and `kills` entries from days before the acknowledged day (keeping entries from that day itself and later). Emptied observation parts and their matching `install`/`killsInstall` keys (or `observations` itself when nothing remains) are omitted.
- Everything outside `observations` (`characters`, `prices`, `warband`, `guildBanks`, `raids`, `uiHealth`, `statisticsDays`, ...) is still sent whole, unchanged, and the local `inventory.json` and the game's saved file remain complete. If the state file is missing or unreadable, the context changes, or the server raises `epoch`, the next upload carries everything once. Replayed pending snapshots never advance the marks, and a state-file write error does not fail or repeat an upload.
- Every request names the Companion's version (`X-Kutz-Uploader`, from `companion/version.js`), so cr0m can refuse versions it no longer reads. When it does (HTTP 426, `update_required`), the Companion shows cr0m's own sentence, such as "Update KutzUploader to 0.12.7 or newer to upload.", and stops retrying that save.
- Bundles KutzInventory 1.22.1 and sends inventory export 3.15.0.

## KutzInventory 1.22.0

- A group-loot roll list now names its corpse also when another player opened it. Until now the addon knew the corpse only when you opened it yourself, or for a boss a group member still had targeted when the encounter ended; every other roll list was saved with the instance and no creature, and such a list says nothing about where an item drops. The game does not send the corpse with a roll, so the addon now follows what it does send: which corpses hold loot for you (`UNIT_LOOT`), when a list's rolls are over (`LOOT_ROLLS_COMPLETE`), and which boss encounter its loot history files a roll under (`C_LootHistory`). A corpse holding an item that is being rolled on keeps its flag until the rolls end. The list gets a corpse in three cases only, and the saved event says which (`src.by`):
  - `end`: the loot history files the rolls under a boss encounter you saw end, and one corpse alone got its flag as that encounter ended and still has it. Known at once.
  - `flip`: of the corpses flagged when the rolls began, exactly one lost its flag within half a second of the rolls' end, and no loot window of yours was open around then.
  - `sole`: nothing lost its flag then, one corpse alone was flagged from the rolls' start to their end, no other lost its flag meanwhile for no known reason, and the game said that corpse held loot when the rolls ended.
- A boss of two bodies (Sneed's Shredder, then Sneed) flags both corpses as the encounter ends. Only those two are then considered for the encounter's roll lists, and `flip` and `sole` decide between them, so each body gets its own list.
- Anything less clear stays as before, a list with no creature: two or more corpses left, two losing their flag together, a roll the game gives no handle for, a burst that turns out to be two corpses' rolls, and (boss lists whose encounter you saw end excepted) the first 10 minutes after login, `/reload` or switching drop tracking on, when a corpse from before is not known to be flagged.
- A boss's roll list carries its encounter also when the corpse stays unknown, and a boss found at the end of the encounter is no longer given a roll list the history files under another encounter or none (trash killed just after the boss).
- Nothing new is exported: `src.by` stays in the saved file for now, and `src.encounter` may now stand on a list with no creature. No player name, no roll and no winner is read from the loot history.
- Checked in the offline harness and against nine roll bursts logged in one dungeon run (WoW Forever 1.60.1). Replaying that log through the recorder gives a creature to all four finished lists another player opened (two `flip`, two `sole`, among them both bodies of Sneed) and leaves alone the two the window had already recorded. Not known yet: whether passing on a roll takes the flag off the corpse early (then that list stays without a creature), and whether a chest's roll list flags the chest. See the [1.22.0 checklist](docs/inventory-recording.md#wow-forever-1220-roll-corpse-checklist).

## Companion 0.12.6

- Bundle KutzInventory 1.21.0 and send inventory export 3.15.0. New, all optional: each item's own facts (`observations.items`), kills per day (`observations.kills` with `killsInstall`), the random suffix beside loot, roll, quest and vendor item links (`suffix`, `bonus`), creatures seen inside instances (`npcs[].inst`), every vendor of an item with the day it was last seen (`prices[].vendors`, `vendorDay`, `vendorLimited`), each character's statistics per day (`statisticsDays`), and each character's current quest log (`characters[].questLog`, absent when not recorded, `quests: []` when recorded and empty). Nothing 3.14.0 had is changed or removed; 2.1.0 (`--format 2`) and auction scans 1.2.0 are unchanged.
- Read the new saved shape of unlearned recipes (KutzInventory 1.21.0 keeps each one once per account file). The export is the same from either shape. **Update the Companion before or together with the addon:** Companion 0.12.5 and older reading a file saved by 1.21.0 still export learned recipes, but no unlearned ones.
- Item tooltips are cleaned before they are exported (`tools/tooltip_clean.js`, English client): colour codes, the durability line (its maximum becomes a field), how many pieces of a set are worn, "Already known", cooldowns, maker lines and the reading character's equipment sets and appearance collection are taken out, because they are the reading character's and not the item's.

## KutzInventory 1.21.0

- Record each item's own facts while drop tracking is on (`Facts.lua`). Every item met in bags, bank, warband and guild bank, worn gear, loot and roll lists, vendor stock and quest rewards is read once per item and game build: name, quality, binding, class and subclass, slot, item level, required level, set, stats and every tooltip line (left and right text, and whether the client showed it red). The read uses a link built from the item ID alone, never the copy in the bag, so no enchant, gem, maker or unique ID is involved. Items wait in a queue: one read per 0.25 s, none in combat, none while the frame rate is under 20, a 10 s pause after a read that took over 8 ms, and the queue stops for the session after three slow reads in a row. The table is capped at 200 kB of the saved file (about 730 items); the least recently met go first and are read again when met again.
- A random-suffix item is one item with variants. The suffix (on this client a bonus ID on the link) is kept beside the item on loot, roll, quest and vendor links, and under the item's facts as a variant with its full name ("Soldier's Shield of Intellect") and, where the client gives numbers that differ from the plain item's, its stats. It never becomes an item of its own.
- The NPC summary now also keeps creatures seen inside dungeons, raids and battlegrounds: name, level, type and classification as outside, and instead of map squares (the client gives no position there) the instance map and difficulty with a count.
- Count kills per day, whether or not the corpse is looted: one number per day, creature ID and level, for creatures that died in front of you while you were fighting and that no other player had tapped. 30 days, at most 800 numbers. No corpse ID, no time of day, nothing about any player.
- Keep statistics per day: the newest full list as before, and for the last 30 days the values that changed on each day.
- Keep every vendor seen selling an item (up to nine, the cheapest first) with its NPC ID, price, limited-stock flag and when it was last seen. Earlier only the cheapest was kept.
- Save unlearned recipes once per account file instead of once per character. The first login moves every character's lists; the lists read back record for record as they were (checked by `tools/check_facts.js`, which also compares the export before and after). On the six-character file this was measured on, that freed 275 kB, which is what the item table's cap was set from.
- `/kinv perf` prints how many item facts are held and waiting, the kills counted today, and the worst and average time per frame the new code used this session. The numbers are also saved at logout (`KutzInventoryObsDB.perf`).
- Record each character's current quest log (`questLog`): read time in Unix seconds and up to 35 quests in log order (quest ID, title, level, zone/category header, complete/failed flags, and up to 12 objectives with text, fulfilled/required counts, finished state and objective type). Uses `C_QuestLog` (`GetNumQuestLogEntries`, `GetInfo`, `GetQuestObjectives`, `IsComplete`, `ReadyForTurnIn`, `IsFailed`) with legacy `GetNumQuestLogEntries`, `GetQuestLogTitle`, `GetNumQuestLeaderBoards` and `GetQuestLogLeaderBoard` fallbacks. Collapsed quest log headers are expanded for the read and collapsed back afterwards (in combat, a log with collapsed headers waits for combat to end rather than touching the quest log UI or saving a partial list). Titles, headers and objective text keep the game's wording (no `$N`: a name such as Red is also a word), UI markup is removed, and strings are capped in UTF-8 bytes. Read after login, on `QUEST_LOG_UPDATE`, `QUEST_ACCEPTED`, `QUEST_REMOVED` and `QUEST_TURNED_IN` (debounced), on `/kinv scan`, and at safe pre-logout checkpoints.
- Fix: drops were missed while auto-loot was on. The addon read a loot window when it opened (`LOOT_OPENED`). With auto-loot on, the game, or an addon that takes every slot at once (KutzUI's Fast loot does), had already started taking the items by then. A kill was then recorded with no items, with only some of them, or not at all when the window never opened. The loot is now read at `LOOT_READY`, the first moment the game has it and before anything is taken. `LOOT_OPENED` still reads a window that `LOOT_READY` did not announce.
- A window is still read once. When `LOOT_READY` comes again before the window closes, only a corpse or object the game names by its GUID is added, and each of those counts once as before. Nothing is taken from the current target on such a repeat, so a second corpse is never marked opened and empty by mistake.
- Kills already recorded with no items stay as they are: the addon cannot tell afterwards what they dropped. Nothing changes in what is recorded or exported, only when the window is read.
- Fix: what a vendor pays for an item was read from the game once and then kept for good. A price the game later changed stayed wrong in the export. Each item is now read again once per session (when its profession window, a vendor or `/kinv ah` asks for it); a stored price stays until the game gives a new answer.
- Known limit: the price is the game's answer for the bare item id. For a crafted item the game prices by formula it can differ from what a vendor pays for the one you made (seen on Skycaller's Mail Boots: 86.22s recorded, 43.87s paid). Whether re-reading closes that gap is not checked in the game yet.
- Not yet checked in game. The [1.21.0 checklist](docs/inventory-recording.md#wow-forever-1210-checklist) and [1.21.0 quest log checklist](docs/inventory-recording.md#wow-forever-1210-quest-log-checklist) list what to try before a release.

## Companion 0.12.5

- Send inventory export 3.14.0: each character's statistics (the Statistics tab of the achievement window: kills, deaths, quests and the rest) are uploaded again, with the time they were read. Exports 3.0.0 to 3.13.0 left them out for cr0m to read from the Battle.net API, which has none for this client, so cr0m's Statistics tab stayed empty. KutzInventory already records them; no addon change. The bundled addon is still KutzInventory 1.20.1.
- Statistics can include amounts of gold (for example the most gold ever owned). They are part of the inventory upload only; turn off character uploads to keep them on this PC.

## Companion 0.12.4

- Bundle KutzInventory 1.20.1. The Companion program itself is unchanged from 0.12.3.

## KutzInventory 1.20.1

- Fix: when the game gives no realm name, a character no longer gets a second record. A WoW Forever build of 2026-11-20 answered `GetRealmName()` with an empty text for the whole session. The addon then saved the character under `Name-` beside its real record `Name-Realm`, so it showed twice with the same name, the new copy had no realm, and `/kinv ah` answered "could not tell which auction house this is". The realm is now read from what is already saved when the game does not give it: this character's own record (found by its GUID), else the one realm that every saved character with the same realm number in its GUID (`Player-<number>-...`) has. Nothing is guessed when no saved record knows it or two realms share the number. The character record, the guild bank key, the auction house key and raid attribution all use that name, and a known realm is never overwritten with an empty one.

- A record that 1.20.0 started as `Name-` for a character with no other record moves to its real key at the next login, with its data. One that sits beside the character's real record is left as it is: cr0m reads the two as one character (the newest reading of each section, items made added up).

## Companion 0.12.3

- Bundle KutzInventory 1.20.0.
- Send inventory export 3.13.0: the NPC summary and the trainer, flight, service, quest, game text, tame and objective credit observations recorded by KutzInventory 1.16.0 to 1.20.0. Upload, retry and credential behavior are unchanged.

## KutzInventory 1.20.0

- Record hunter tames while drop tracking is on. When a hunter's Tame Beast begins, the target's creature ID, level and family are noted from its GUID, and its name and level are held in memory to compare. The new pet must come within 30 seconds of the start and within 2 seconds of the channel's end, bear the target's name, and match its level, family and (where the client has `UnitCreatureID`) creature ID wherever both are readable; a cast the client says went to another unit (`UNIT_SPELLCAST_SENT`, a mouseover or focus macro) is not armed. When in doubt, nothing is recorded. The pet's spellbook abilities with ranks (kept once two reads in a row agree; absent means not read), its attack speed (with neither the pet nor the player in combat, flagged `spdAura` when the pet had an aura at every read), its diet and the client's locale (`loc`, the language of the family and diet labels) are read for up to a minute. A tame without a creature ID in the target is not recorded. Interrupting the tame, or Call Pet or Revive Pet, cancels it. The pet's GUID and name and the target's name are never kept. Once per beast, level, abilities and speed per install (keyed by creature ID, level and a checksum, so the saved index stays small), at most 20 a session, under the half caps.

- Record objective credit while drop tracking is on: which creature, item or object counted for a quest objective. A second after the quest log changes, each monster, item and object objective's `numFulfilled` is compared with the last read, in memory only (never saved or exported). When one rose and the player's own evidence of the 6 seconds before names exactly one cause, `{ quest, i, rows, ot, npc|item|object, by }` is recorded. Evidence is a creature a unit token showed dead that no other player had tapped, an item from the player's own "You receive loot / item" line, or an object whose window the player opened (loot windows are no evidence). `by` says how: `name`, the only candidate named in the objective's text (for items the bag count must also agree when the client gives one), or `sole`, for a creature only, the only candidate at all, never while grouped or with a pet out in the last 6 seconds, since a group member's or the pet's kill counts too. Items and objects are credited by name only. `rows` is how many objectives the client listed; the accept event now carries `rows` beside `obj` too, so a reader can tell when credit `i` is the accept's `obj[i]`. A quest listing more than 40 objectives credits nothing, and a count that falls makes that objective's next read a baseline. No progress numbers, no text, nothing about other players. Once per quest, objective and id per install, at most 200 a session (about 295 bytes each), under the half caps.

- Fix: the reputation read put the reputation window back only partly. A header collapsed inside another collapsed header was left open, a collapsed header with no faction ID stopped the read with an error and left reputation unread until a reload, and a read that failed part-way left headers open. Each collapsed header is now opened on its own from the top down (so a nested one is found and opened too) and all of them are closed again from the bottom up, also after a failed read.

- Unit events from party and raid members (`UNIT_HEALTH`) are dropped before any read, so a full raid costs no work, and a failed object read on a quest or gossip window no longer stops the window's own recording.

- Existing installs get one login line about the new recording and `/kinv track drops off`.

Inventory export 3.13.0 (default) adds `tame` and `credit` observations and an optional `rows` beside an accept's `obj`. The observations section stays `v: 1`.

## KutzInventory 1.19.0

- Record gossip and quest greetings for creatures and objects while drop tracking is on. The recorder replaces the character's names with `$N` and drops currency amounts and text with roster or player target names. Object text also passes a capitalized-word check.

- Record book pages from identified world objects. The recorder requires a nil creator and checks for mail before reading the page body. Bag items and title-only reads are disabled.

- Record NPC speech and emotes from identifiable, uncontrolled creatures. Known names become `$N`, and curly quotes, dashes and ellipses become ASCII. Say and yell can use local game labels and a common word list. Whispers and emotes apply a stricter capitalized-word check.

- Include quest objective type, required amount and text on acceptance, and quest markers from `GetQuestsOnMap` for that zone. Quest prose and objectives scrub the recorder's given name, surname and full name. Player progress counts are excluded.

- Stop adding text at half the event-count or approximate size cap. Existing installs get one login line about the new recording and `/kinv track drops off`.

Inventory export 3.12.0 (default) adds `gossip`, `read` and `line` observations and optional `obj` and `poi` on quest accepts. The observations section stays `v: 1`.

## KutzInventory 1.18.0

- Record flight masters for cr0m's item database (drop tracking, `/kinv track`): when a flight master's map opens, every node you can fly to from its node, by taxi node id, with the price the map shows you (a game price, not your money) and the number of legs. The node ids come from `C_TaxiMap.GetAllTaxiNodes` matched slot by slot to the map; when the client gives no ids, the two disagree or there is not exactly one current node, nothing is recorded. Node names are not kept. The same list and reaction from the same flight master is recorded at most once a week.
- Record flight times: from which node to which and the whole seconds from boarding (`TakeTaxiNode`, then losing control on the taxi) to landing (control back, off the taxi). Kept only when the landing is known to be at the chosen node (your position on the taxi map is by that node, or the next flight master's map within 2 minutes is at it), once per route in 30 days. No position or route trail, and never your money.

- The NPC summary records `svc`, the services each NPC was seen to offer (vendor, repair, flight, trainer, bank, guildbank, inn, auction, stable, battlemaster, spirit, guild, tabard), from the interaction window the game opens with it (`PLAYER_INTERACTION_MANAGER_FRAME_SHOW`, matched by the interaction type's name), the vendor, trainer and flight master windows, whether the merchant can repair, and binding your Hearthstone at an inn. Creatures only (never a mailbox or other object); each counts as standing beside it. No gossip text.

- Quest observations carry more facts. On accept, from the quest log: the quest's level, its suggested group size (2 or more), whether it is a daily or weekly, whether it has a time limit, and the item that started it (only when the offer window showed that quest). On turn-in: the XP the reward window showed (only while you are under the level cap with XP not turned off) and the reputation the turn-in changed, as changes per faction (`{ f, d }`), never a standing: standings are read when the reward window opens and again a second after the turn-in, and the changes are dropped whole when a loot window, combat, another reward window or turn-in came in between, more than 5 minutes passed, or more than 6 factions changed. Renown factions and the Guild faction are left out; a change is what this character received (with its reputation bonuses and any spill-over), so it can differ between characters. Quest money is still never read.

Inventory export 3.11.0 (default) adds the observation types `taxi` and `flight`, strictly validated (a doubtful node list is dropped whole), `svc` on NPC summary entries, a sorted list of the known services, and on quest events `lv`, `group`, `freq`, `timed` and `startItem` (accept) and `xp` and `rep` (turn-in; `rep` all or nothing); the observations section stays `v: 1`. 2.1.0 (`--format 2`) and auction scans 1.2.0 are unchanged.

## KutzInventory 1.17.0

- Keep a per-install NPC summary for cr0m's item database (drop tracking, `/kinv track`): when you target, mouse over, talk to (vendor, trainer, quest) or loot a creature, one entry per NPC ID in `KutzInventoryObsDB.npcs` is updated in place: its name, level range, a boss skull (only when it is a world boss or you are at the level cap), classification, creature type and family, its reaction per faction, its subtitle when the tooltip proves one, a beast's usual attack speed, the last day it was seen and counts of the 1% map squares you stood in while within about 10 yards of it.
- Never players, pets, guardians, totems, charmed mobs or companions; nothing inside instances; nothing while the client marks the creature's identity secret. No GUIDs, player names, times finer than a day or order of sightings; the name and subtitle refuse your own name and owner titles ("X's Pet"). The reaction and attack speed are read only while the creature is alive and out of combat, the subtitle only while you are out of combat. At most once per NPC per 30 seconds, 3,000 NPCs (least recently seen go first), 40 squares each and about 500 KB; an NPC not seen for 180 days is dropped.
- `/kinv track drops off` also stops the summary; `/kinv track` reports how many NPCs are held.

Inventory export 3.10.0 (default) adds `observations.npcs` and `observations.install`, a cumulative summary that replaces the one from an earlier export of the same install (its counts are totals, not deltas); the observations section stays `v: 1`. 2.1.0 (`--format 2`) and auction scans 1.2.0 are unchanged.

## KutzInventory 1.16.0

- Record trainers for cr0m's item database (drop tracking, `/kinv track`): when a class or profession trainer's window opens, one `trainer` observation with every service it lists (all three type filters switched on for the read and put back), each with its spell ID where the client's tooltip data gives one, name, rank, required level, skill and abilities, cost and whether it can be learned now or is known, plus the trainer's reaction to the character (`rx`). The same trainer and list is recorded at most once a week, also across sessions while the earlier event is still kept (30 days, or less once the size caps prune it); learning a spell does not re-record it. The hunter's Beast Training window is never recorded.
- Vendor observations add `rx` and are read under the merchant window's all-items filter, put back immediately; `filtered: true` marks a list read with the class filter still on.
- Prices and costs are game prices as shown (after any reputation discount), not the player's money; `rx` tells a list price from a discounted one.
- Fix: the hunter's Beast Training window no longer replaces the character's class trainer list (`trainers.class`).

Inventory export 3.9.0 (default) adds trainer observations and vendor `rx`/`filtered`; the observations section stays `v: 1`, so readers that ignore unknown event types are unaffected. 2.1.0 (`--format 2`) and auction scans 1.2.0 are unchanged.

## Companion 0.12.2

- Require timestamped Authenticode signatures on both Windows executables for future tagged releases, using Azure Artifact Signing and GitHub OIDC. Verify the signatures before recreating the ZIP/checksum and attesting/publishing the final artifact. PR/main CI artifacts and local builds remain unsigned; existing releases are unchanged.

## KutzInventory 1.15.1

- Prepare the addon for public distribution with complete recording, command, export and privacy documentation.
- Replace character, guild and realm examples with obvious placeholders and make code comments self-contained.
- Retain the existing inventory, price, raid, observation, craft and applied Legacy Tree recording behavior. This patch changes documentation and examples, not gameplay recording.

Inventory export versions remain 3.8.0 (default) and 2.1.0 (`--format 2`); auction scans remain 1.2.0.

## Companion 0.12.1

- Bundle KutzInventory 1.15.1.
- Redact upload keys echoed in server error text before displaying the message or saving an auction rejection reason.
- Document exactly what the tray app reads, sends and stores, including immediate uploads on Start, retries, retained observations and credential removal.
- Generate build provenance attestations for tagged ZIPs in the public repository, alongside `SHA256SUMS.txt`. Both executables remain unsigned; see the [verification guide](companion/README.md#verify-the-download).
- Refresh offline test tooling to remove a vulnerable transitive dependency. Development tooling is not shipped in the Windows bundle.

The portable asset remains `KutzUI-Companion-Windows-x64.zip`. The full setup guide remains [companion/README.md](companion/README.md).
