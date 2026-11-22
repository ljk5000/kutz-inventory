# Release notes

## Companion 0.12.7

- Trim already-acknowledged `observations` before upload (`tools/upload_ack.js`). When `/api/wow/import` returns an `ack` (`epoch`, highest event counter per install prefix, and highest summary `day`), the Companion saves those marks beside the export in `<output>.ack.json` (never the API key), bound by a SHA-256 context digest of the site origin, verified username, sorted saved-file list, export schema version and Companion version. Later uploads omit events at or below the acknowledged counter (unless the install rolled back to a lower highest counter) and `npcs`, `items` and `kills` entries from days before the acknowledged day (keeping entries from that day itself and later). Emptied observation parts and their matching `install`/`killsInstall` keys (or `observations` itself when nothing remains) are omitted.
- Everything outside `observations` (`characters`, `prices`, `warband`, `guildBanks`, `raids`, `uiHealth`, `statisticsDays`, ...) is still sent whole, unchanged, and the local `inventory.json` and the game's saved file remain complete. If the state file is missing or unreadable, the context changes, or the server raises `epoch`, the next upload carries everything once. Replayed pending snapshots never advance the marks, and a state-file write error does not fail or repeat an upload.
- Every request names the Companion's version (`X-Kutz-Uploader`, from `companion/version.js`), so cr0m can refuse versions it no longer reads. When it does (HTTP 426, `update_required`), the Companion shows cr0m's own sentence, such as "Update KutzUploader to 0.12.7 or newer to upload.", and stops retrying that save.
- Continues to bundle KutzInventory 1.21.0 and send inventory export 3.15.0.

## Companion 0.12.6

- Bundle KutzInventory 1.21.0 and send inventory export 3.15.0. New, all optional: each item's own facts (`observations.items`), kills per day (`observations.kills` with `killsInstall`), the random suffix beside loot, roll, quest and vendor item links (`suffix`, `bonus`), creatures seen inside instances (`npcs[].inst`), every vendor of an item with the day it was last seen (`prices[].vendors`, `vendorDay`, `vendorLimited`) and each character's statistics per day (`statisticsDays`). Nothing 3.14.0 had is changed or removed.
- Read the new saved shape of unlearned recipes (KutzInventory 1.21.0 keeps each one once per account file). The export is the same from either shape. **Update the Companion before or together with the addon:** Companion 0.12.5 and older reading a file saved by 1.21.0 still export learned recipes, but no unlearned ones.
- Item tooltips are cleaned before they are exported (`tools/tooltip_clean.js`, English client): colour codes, the durability line (its maximum becomes a field), how many pieces of a set are worn, "Already known", cooldowns, maker lines and the reading character's equipment sets and appearance collection are taken out, because they are the reading character's and not the item's.

## KutzInventory 1.21.0

- Record each item's own facts while drop tracking is on (`Facts.lua`). Every item met in bags, bank, warband and guild bank, worn gear, loot and roll lists, vendor stock and quest rewards is read once per item and game build: name, quality, binding, class and subclass, slot, item level, required level, set, stats and every tooltip line (left and right text, and whether the client showed it red). The read uses a link built from the item ID alone, never the copy in the bag, so no enchant, gem, maker or unique ID is involved. Items wait in a queue: one read per 0.25 s, none in combat, none while the frame rate is under 20, a 10 s pause after a read that took over 8 ms, and the queue stops for the session after three slow reads in a row. An entry's exported `day` (`d`) records the last day its exported content changed (first read, a changed field or build, or a new or changed variant) and stays unchanged when the item is met again with nothing new, so Companion upload trimming does not re-send unchanged bag items every day. The table is capped at 200 kB of the saved file (about 700 items); a separate saved-only last-met day (`m`, never exported) keeps pruning least-recently-met first, and dropped items are read again when met again.
- A random-suffix item is one item with variants. The suffix (on this client a bonus ID on the link) is kept beside the item on loot, roll, quest and vendor links, and under the item's facts as a variant with its full name ("Soldier's Shield of Intellect") and, where the client gives numbers that differ from the plain item's, its stats. It never becomes an item of its own.
- The NPC summary now also keeps creatures seen inside dungeons, raids and battlegrounds: name, level, type and classification as outside, and instead of map squares (the client gives no position there) the instance map and difficulty with a count.
- Count kills per day, whether or not the corpse is looted: one number per day, creature ID and level, for creatures that died in front of you while you were fighting and that no other player had tapped. 30 days, at most 800 numbers. No corpse ID, no time of day, nothing about any player.
- Keep statistics per day: the newest full list as before, and for the last 30 days the values that changed on each day.
- Keep every vendor seen selling an item (up to nine, the cheapest first) with its NPC ID, price, limited-stock flag and when it was last seen. Earlier only the cheapest was kept.
- Save unlearned recipes once per account file instead of once per character. The first login moves every character's lists; the lists read back record for record as they were (checked by `tools/check_facts.js`, which also compares the export before and after). On the six-character file this was measured on, that freed 275 kB, which is what the item table's cap was set from.
- `/kinv perf` prints how many item facts are held and waiting, the kills counted today, and the worst and average time per frame the new code used this session. The numbers are also saved at logout (`KutzInventoryObsDB.perf`).
- Not yet checked in game. The [1.21.0 checklist](docs/inventory-recording.md#wow-forever-1210-checklist) lists what to try before a release.

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
