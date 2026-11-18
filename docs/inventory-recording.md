# Recording at reload, logout and exit

KutzInventory collects game data while playing. It checkpoints queued work before leaving the world, while player APIs still have useful values; `PLAYER_LOGOUT` seals the cached record instead of rescanning unloaded data. The game writes **both** saved tables (`KutzInventoryDB`, `KutzInventoryObsDB`) into the account's `SavedVariables/KutzInventory.lua`. Only `/reload`, logout or normal exit writes those in-memory changes to disk; a crash/forced termination can lose them.

## Collection and freshness

| Data | Collection/shutdown behavior |
| --- | --- |
| Location | Movement stops, zone/loading events and safe checkpoints. Unavailable readings preserve the last good coordinates on the same map; a different map never inherits them. In dungeons/raids, only instance name/type is stored as character location. |
| Carried bags | Batched bag-update events read dirty bags. An unloaded backpack cannot clear the cached inventory. |
| Gear | Equipment/inventory/durability events queue coalesced scans; safe checkpoints flush pending work. An empty gear read preserves an existing record. |
| Gold/XP/rested XP | Delayed login reads, immediate money/XP/exhaustion events and manual scan. Reads stop while leaving; checkpoint handling avoids a new teardown zero overwriting gold. |
| Professions, currencies, skills, spells, talents, reputation, PvP | Login/change events queue scans. A checkpoint can finish queued work while player data are usable; unavailable client APIs may leave fields absent or old. |
| Stats/sheet | Latest safe out-of-combat reading; changes during combat can defer updates. Buffs at snapshot time count. |
| Statistics/achievement points | Login, manual scan and post-combat reads throttled to once per ten minutes. |
| Character/warband bank | Requires the bank open and loaded. Cached values represent a visit, not a live view after closing it. |
| Guild bank | Only viewable tabs visited/loaded by the server can be recorded. |
| Recipes/trainers | Requires the corresponding UI/data. Recipe reads skip linked/guild/NPC professions; unlearned entries depend on what the window lists. The hunter's Beast Training window is not stored as a trainer (1.16.0; it used to replace the class trainer's list). |
| NPC summary (`KutzInventoryObsDB.npcs`) | Target, mouseover, an open vendor/quest/trainer window and loot corpses, at most once per NPC per 30 s, only outside instances and only while drop tracking is on; cells only while within about 10 yards (or a window is open with it). |
| Vendor prices | Ready rows at merchant events plus a delayed retry for late rows. |
| AH prices | Only explicit AH commands start scans. Completed responses survive; pending responses cannot finish after the UI closes. |
| Craft counts | In-memory updates on your own system creation messages, persisted on the next game save. |

Checkpoints are requested by hooks for `Logout`, `Quit`, `ReloadUI`, by `PLAYER_LEAVING_WORLD`, and shortly after `PLAYER_ENTERING_WORLD`. They flush queued work only when the player GUID, loaded backpack, world state and login delay indicate usable data. Old timer callbacks are invalidated. Final logout sets save diagnostics, cancels queued work and copies an optional `KutzUIDB.monitor.findings` report.

`characters[].recording` exports save/checkpoint times, checkpoint reason, pending/failed scan names and whether stats were deferred. Per-category `updated` stamps help inspect age. No pending work does **not** mean every bank/trainer was visited or every asynchronous request finished. Inventory 3.x intentionally omits ordinary character stats/talents/reputation/PvP and matching update stamps; format 2 retains them.

The Companion polls saved-file timestamps/sizes every second; it starts with an immediate export/upload and coalesces later file changes/retries. The CLI watches its initially selected files with the same queue; both read a sibling `KutzUI.lua` monitor save when present and prefer newer findings. A monitor-only change does not trigger export. Neither tool can force the game to save or guarantee freshness after a crash. [Upload and privacy behavior](../README.md#privacy-and-uploads) applies to all save paths.

## Activity modules

`Crafts.lua` matches localized `LOOT_ITEM_CREATED_SELF`/`LOOT_ITEM_CREATED_SELF_MULTIPLE` system loot messages, with English fallbacks. A stack of five increments item count by five and craft-message count by one. Conjured items count too; other players' creations and ordinary received loot do not. This always-on feature writes `chars[key].crafted`: first observed craft time, running total, per-item count/message count/name/last time, and the newest **120 dates on which crafting happened** (local dates). It cannot reconstruct earlier activity. Format 3 exports the optional `crafted` block with up to 5,000 most recently crafted item types; format 2 omits it.

`Observations.lua` is default-on for a new install/missing preference; existing off choices persist. It records loot sources/roll lists, quests, vendor stock, trainers' lists (class and profession trainers; never the hunter's Beast Training window) and, from 1.18.0, flight masters' reachable nodes with their prices and how long each flight took (node ids only, no position trail). From 1.18.0 a quest accept also carries the quest log's level, group size, daily/weekly and time-limit facts and the starting item, and a turn-in the reward window's XP and the per-faction reputation changes (two reads a second apart; never a standing, dropped when loot, combat or another quest came in between); quest money is never read. Quest prose comes from detail/progress/completion windows, replacing the character's given name, surname and full name with `$N`, once per quest/action per session and across reloads while retained, under both event half caps. Events also include the character's name/surname and map coordinates outside instances. From 1.17.0 it also keeps a per-install NPC summary (not events) of the creatures the player targets, mouses over, talks to or loots: their names and, from 1.18.0, the services they offer (from the interaction windows opened with them), but no GUIDs, player names, times of day or order of sightings. `/kinv track drops off` stops new recording (both) **without removing old uploadable events or the summary**; there is no local delete command. See [schemas](../schema/README.md#observations-3203120) for limits and fields.

In 1.19.0 drop tracking also records gossip and quest greetings for identified creatures and objects. The recorder replaces the recording character's names with `$N`, drops amounts in gold, silver or copper and drops text with a roster or player target name after scrubbing. Object gossip and greetings also use the same capitalized-word check as NPC say and yell. Gossip options, player chat and mail are excluded.

Readable pages come only from world objects whose GUID and title still match at page read. The recorder checks for an open mailbox and overlapping bag use, requires exactly a nil creator, and checks the material before reading a body. An empty creator string is refused. Bag items and title-only recording are disabled in 1.19.0.

NPC speech and emotes come from an identified, uncontrolled creature. Curly quotes, en and em dashes, and ellipses become ASCII. The recorder scrubs its own and recipient names, plus known roster and player target names when capitals appear past sentence starts. Whispers and emotes allow only `I` and its common contractions as unresolved capitals. Say and yell also allow words from the speaker's name, zone, subzone and the common English word list. An unknown lowercase player name or a name matching an allowed word can still appear in a line or gossip. Consumers should publish a text only when two different recorders sent the same text for the same subject.

Quest accepts can include objective types, required amounts and wording, with the recording character's given name, surname and full name replaced with `$N`. Progress counters and completion status are excluded. Quest markers come from `C_QuestLog.GetQuestsOnMap` on the acceptance map while out of combat. Missing data can fill the same accept event shortly after it is saved.

New text events stop at 2,500 saved events or when the added event would exceed the first 1,000,000 bytes of the approximate saved-event cap. A bounded saved index suppresses duplicate events across sessions. Rejected NPC lines use a session-only checksum cache. A cached rejection skips unit, roster and location reads on repeat. Existing installs see a one-time login notice that describes the new recording and the `/kinv track drops off` command.

The synthetic examples add 469 Lua bytes per gossip, 584 per read page, 443 per line and 419 per quest accept with two objectives and two points. Their compact export sizes are 299, 390, 273 and 201 bytes respectively. The addon's cap estimates for those examples are 302, 394, 276 and 207 bytes. As a size illustration, a long city session with 50 unique recordable lines, 20 gossip texts, five pages and five such quest accepts adds about 39 KB to SavedVariables, including dedup keys and excluding the preexisting fields of the five accepts. Repeats add no data while their keys are kept. At capacity, the three FIFO indexes take up to about 280 KB of Lua using the example serializer. The live file size varies with text lengths, serializer overhead and other activity; the size half cap is measured against the approximate saved-event size.

`Raids.lua` records only manually tracked raid strings within their active window while grouped/instanced. It includes group rosters and system loot messages, with other players' names. `Prices.lua` records vendor prices and manual AH scans independently of the observation switch. No module sends HTTP requests; desktop upload is separate.

## Hearth, Legacy Trees and identity

`GetBindLocation` supplies the hearth name after loading screens and `HEARTHSTONE_BOUND`; an empty answer preserves the last good one. It exports as optional `characters[].hearth` in 3.x.

Legacy Tree ranks/currency are scanned with talents, including queued pre-leave checkpoints. Any staged or incomplete scan preserves the previous complete reading; the applied ranks are used. Both export formats include `legacyTree` when usable.

GUID ownership is selected before any character write. Existing keys stay stable; colliding given names get surname/GUID-based keys. Guild events refresh a delayed name while preserving the old name if membership remains true; explicit false membership clears it.

## Verification

`node tools/check_inventory_logout.js` loads the real addon into an offline Lua VM and exercises reload, logout, Quit and native-exit paths, including unavailable player/map APIs before final events. It checks immediate bag/XP changes, live coordinates, queued checkpoints, late empty/zero data, stale timers, diagnostics, Legacy Trees and guild-loading behavior. `check_crafts.js`, `check_observations.js`, `check_raids.js`, `check_prices.js`, `check_character_identity.js` and `check_scheduling.js` cover their modules. `node tools/check_all.js` runs them with conversion/schema and Companion tests.

Live acceptance still needs WoW Forever: move to a known position, change a bag stack or gain XP, reload/log out/Exit Game normally, and inspect the saved/exported data and timestamps. Visit bank/profession/trainer UIs separately; test combat-deferred reads and same-name logins. A forced process kill is not a normal-save test. Server acknowledgement is a separate upload test, not evidence about all server privacy controls.

### WoW Forever 1.19.0 game-text checklist

- Reload an existing install with tracking on, and another with tracking off. Confirm each gets one login line for the new recording and `/kinv track drops off`. Reload again and confirm the line stays gone and off stays off. Check that the command stops new recording while old events remain exportable.
- Open a world book and turn pages. Confirm `ITEM_TEXT_BEGIN` and `ITEM_TEXT_READY` expose the same `UnitGUID("npc")`, that `ItemTextGetCreator()` returns nil on each page, and that pages deduplicate across reload. Check an object read interrupted by opening mail or using a bag item.
- Open a saved player letter, an NPC-sent letter and an auction letter, then a game book from a bag. Confirm none is recorded in 1.19.0, including beside a world book. Before enabling bag reads, print the return from `ItemTextGetCreator()` for each open and page. All three letters must return a creator and the bag book must return nil. Check the bag use and item-text event ordering before changing the gate.
- Open NPC and object gossip and quest greetings. Check name substitutions, amount and roster/target-name rejection, and object-only rejection of unresolved capitals. Confirm that options and player chat never create observations.
- Collect representative creature say, yell, whisper, emote and raid boss emote events. Check the sender GUID and unit flags, known-name scrubbing and stricter whisper/emote behavior. Check punctuation, zone and subzone wording, controlled creatures, missing unit tokens, and repeats after reload.
- Accept a quest with named prose, objectives and map markers. Verify that only required objective counts survive and that the coordinates match `GetQuestsOnMap` to two decimal places on the acceptance map. Check late data, combat, map changes, and a quest that has a route waypoint but no map row. Check turn-in progress and completion for name substitution.
- Reload and export the save locally. Check the shapes, deduplication and the 2,500-event text gate while loot can still be saved.
