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

`Observations.lua` is default-on for a new install/missing preference; existing off choices persist. It records loot sources/roll lists, quests, vendor stock, trainers' lists (class and profession trainers; never the hunter's Beast Training window) and, from 1.18.0, flight masters' reachable nodes with their prices and how long each flight took (node ids only, no position trail). Quest prose comes from detail/progress/completion windows, replacing occurrences of the character's given name with `$N`, once per quest/action while retained and under half the size cap. This is not general anonymization; events also include the character's name/surname and map coordinates outside instances. From 1.17.0 it also keeps a per-install NPC summary (not events) of the creatures the player targets, mouses over, talks to or loots: their names and, from 1.18.0, the services they offer (from the interaction windows opened with them, never gossip text), but no GUIDs, player names, times of day or order of sightings. `/kinv track drops off` stops new recording (both) **without removing old uploadable events or the summary**; there is no local delete command. See [schemas](../schema/README.md#observations-3203110) for limits and fields.

`Raids.lua` records only manually tracked raid strings within their active window while grouped/instanced. It includes group rosters and system loot messages, with other players' names. `Prices.lua` records vendor prices and manual AH scans independently of the observation switch. No module sends HTTP requests; desktop upload is separate.

## Hearth, Legacy Trees and identity

`GetBindLocation` supplies the hearth name after loading screens and `HEARTHSTONE_BOUND`; an empty answer preserves the last good one. It exports as optional `characters[].hearth` in 3.x.

Legacy Tree ranks/currency are scanned with talents, including queued pre-leave checkpoints. Any staged or incomplete scan preserves the previous complete reading; the applied ranks are used. Both export formats include `legacyTree` when usable.

GUID ownership is selected before any character write. Existing keys stay stable; colliding given names get surname/GUID-based keys. Guild events refresh a delayed name while preserving the old name if membership remains true; explicit false membership clears it.

## Verification

`node tools/check_inventory_logout.js` loads the real addon into an offline Lua VM and exercises reload, logout, Quit and native-exit paths, including unavailable player/map APIs before final events. It checks immediate bag/XP changes, live coordinates, queued checkpoints, late empty/zero data, stale timers, diagnostics, Legacy Trees and guild-loading behavior. `check_crafts.js`, `check_observations.js`, `check_raids.js`, `check_prices.js`, `check_character_identity.js` and `check_scheduling.js` cover their modules. `node tools/check_all.js` runs them with conversion/schema and Companion tests.

Live acceptance still needs WoW Forever: move to a known position, change a bag stack or gain XP, reload/log out/Exit Game normally, and inspect the saved/exported data and timestamps. Visit bank/profession/trainer UIs separately; test combat-deferred reads and same-name logins. A forced process kill is not a normal-save test. Server acknowledgement is a separate upload test, not evidence about all server privacy controls.
