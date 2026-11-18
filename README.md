# KutzInventory

KutzInventory records your characters' possessions, professions and activity in the **WoW Forever** client (1.60.1, interface 16001). Use it to keep an inventory across characters, export JSON, or upload snapshots to [wow.cr0m.com](https://wow.cr0m.com) with the optional Windows Companion, called **KutzUploader** on the site.

The addon works on its own. Retail and Classic are not supported targets. It has no desktop network access; uploading requires a separate action outside the game.

**Release versions:** KutzInventory **1.20.0** and Companion **0.12.2**. See [release notes](CHANGELOG.md).

- [Install the addon](#install-the-addon)
- [Features and commands](#features-and-commands)
- [Privacy and uploads](#privacy-and-uploads)
- [Windows Companion / KutzUploader](#windows-companion--kutzuploader)
- [Exporting and development](#exporting-and-development)

## Install the addon

Download from [GitHub Releases](https://github.com/ljk5000/kutz-inventory/releases):

| Asset | Contents |
| --- | --- |
| `KutzInventory-X.Y.Z.zip` (`vX.Y.Z` tags) | The standalone addon |
| `KutzUI-Companion-Windows-x64.zip` (`companion-vX.Y.Z` tags) | Windows Companion and an `AddOns/KutzInventory` folder |

1. Close the game and extract the download. For the standalone addon, copy `KutzInventory`; for the Companion bundle, copy `AddOns/KutzInventory` into your game client's `Interface/AddOns`.
2. Check the layout: `<client>/Interface/AddOns/KutzInventory/KutzInventory.toc`. Avoid an extra nested `KutzInventory` folder.
3. Start the game and enable **cr0m Inventory** in the AddOns list. Open each bank tab, profession window and trainer you want recorded.
4. Type `/kinv` to see the records. `/reload` or logout lets the game write them to disk.

No other addon is required. If a `KutzUIDB.monitor.findings` snapshot is present, it is copied for export; the exporter also checks a sibling `KutzUI.lua` and uses the newer monitor snapshot.

## Features and commands

Records reflect what the client made available, with timestamps for freshness. Banks and recipes can be old until you visit them again; unavailable APIs can leave fields absent. The addon uses game events and delayed, coalesced reads. Auction scans process work across frames while active.

### Inventory and character records — `KutzInventory.lua`

| Records | When collected |
| --- | --- |
| Given name, surname, realm, GUID, level, class, race, faction, sex, guild, specialization and role | Login; level/spec and guild changes refresh the relevant identity fields |
| Backpack, bags, keyring where available, reagent bag; item IDs, links, names, counts, quality, bound flag, icons, categories and item levels | After login/loading and bag changes; `/kinv scan` |
| Character bank and warband bank contents; warband money and last recording character | While the bank is open and its data are loaded |
| Guild bank contents, tab names and money | The visible, viewable tab when its contents arrive; click through tabs to record them |
| Equipped gear, durability, item stats and average item levels | Login, equipment/inventory and durability changes |
| Character sheet: health/power, attributes, weapons, modifiers, defense and resistances; combat ratings | Login and stat/equipment changes, out of combat; deferred reads resume after combat |
| Gold, XP, XP needed and rested XP | After login settles, money/XP/exhaustion events and manual scans; protects against late unloaded zero values |
| Professions, currencies, skills (including weapon skills and languages), spellbook abilities and ranks | Login and corresponding skill/currency/spell changes |
| Talents, groups/tabs, selected ranks, points, loadout name/import string where available, selected PvP talents | Login and talent/spec changes |
| Applied Legacy Tree ranks, choices, shared currency and points spent per tree | With talent reads; staged changes are excluded; a failed/incomplete read retains the last complete one |
| Learned recipes, output quantities, required/optional reagents and alternatives; unlearned recipes and learning sources | When your own profession window opens/changes or a recipe is learned; enable “show unlearned” for the entries the window otherwise hides |
| Trainer services, requirements, costs and availability | When a trainer opens/updates; its filters are temporarily enabled and restored. The hunter's Beast Training window is skipped |
| Reputation, paragon/friendship data where available | Login and reputation changes; collapsed headers are temporarily expanded and restored |
| Nonzero achievement statistics and total achievement points | After login; after combat at most once per ten minutes; manual scans |
| PvP kills, honor, honor level, yesterday/session totals and played rated brackets | Login and PvP/honor changes |
| Zone, subzone, map and coordinates outside instances; instance name/type in dungeons and raids | Movement stops, zone/loading events and safe checkpoints before leaving |
| Hearthstone bind location | After loading screens and `HEARTHSTONE_BOUND` |
| Save/checkpoint diagnostics and optional addon-monitor findings | Checkpoints/logout; monitor findings copied at logout |

Character records use GUID ownership to separate characters with the same given name. Existing keys stay stable; a new collision uses a surname or GUID suffix. This cannot recover previously overwritten records. See [recording details](docs/inventory-recording.md).

### Vendor and auction prices — `Prices.lua`

Opening/updating a vendor records gold purchase prices (including the NPC name and limited-stock flag) and item sell prices. Cheapest observed vendors are preferred; revisiting that vendor can update its price. Recipe materials/products also request sell prices from the game's item data.

At an open auction house, `/kinv ah` (or `/kinv ah all`) downloads the whole house. It keeps the three lowest unit prices and quantities per item, listing counts, item names/categories/equip slots and exact purchasable stack supply, including gear variant strings. It excludes bid-only listings and does not retain seller names. Unreadable rows make the scan incomplete. Missing item names are requested from the game's cache after the download.

The whole-house request has an approximately 15-minute cooldown. `/kinv ah slow` searches recorded crafting materials/products individually, skipping unlimited vendor stock. Unanswered searches stay unknown. Prices are stored per realm and house (Alliance, Horde or neutral), inferred from the auctioneer, neutral town or player faction. Repeating an AH command during a scan stops it; closing the AH stops processing. It never buys, bids or posts auctions.

### Tracked raids — `Raids.lua`

`/kinv raid <string>` adds a raid string supplied by the site, such as `KR1.ABC234.409.1767225600.ABCDEFGHJKMN`. The addon checks its shape, **not its signature**. During the window from two hours before to eight hours after the scheduled start, while grouped inside an instance, it records entry/exit, boss encounter starts/results, group rosters, and system loot messages with looter names, item links and counts. It prefers a matching instance ID; if none matches, tracked raids in the time window can still record the current instance.

Only explicitly tracked raids record events. Up to 20 raids and 2,000 events per raid are retained; raids older than 14 days are pruned on load/add. Raid strings and recorded events are included in 3.x inventory uploads. Server authorization is outside this addon.

### Drop, quest, vendor, trainer and flight observations — `Observations.lua`

**On by default for new installs or a missing preference.** An existing off preference stays off. `/kinv track drops off` stops new recording, the NPC summary included; it **does not erase old events or the summary, or exclude them from later uploads**.

While enabled, it records:

- Loot windows by source (creature/boss, chest, fishing, gathering, skinning or opened item), including empty/coins-only corpses without coin amounts. Known sources are deduplicated; skinning counts separately.
- Group-loot roll lists, including when another player opens the corpse, the loot threshold and boss encounter when identified. Your own system “You won” line adds a flag; other players' rolls/wins are not retained in observations.
- NPC and object gossip or quest greetings, with your names replaced with `$N`. Amounts in gold, silver or copper and text that still contains roster or player target names are skipped.
- Game-authored pages from world objects. The creator must be nil. Bag items, title-only reads and mail are excluded.
- NPC speech and emotes with identifiable creature speakers. The recorder scrubs player names it recognizes. An unknown lowercase name or a name that matches an allowed word can still appear in dialogue or gossip. See the [consumer guidance](schema/README.md#game-text-3120).
- Quest acceptance/turn-in, giver/ender IDs and item rewards/choices. Available quest prose is deduplicated by quest and action and recorded under the event-count and size half caps. Occurrences of your given name, surname and full name are replaced with `$N`. From 1.18.0, an accept also carries the quest's level, group size, daily/weekly, whether it is timed and the item that started it; a turn-in the XP the reward window showed (under the level cap only) and the reputation it changed, as per-faction changes only: your standing itself is never kept, and the changes are dropped when loot, combat or another quest came in between. Since 1.19.0 an accept can also carry quest objective definitions and map markers for the acceptance zone. Player progress counts are excluded.
- Vendor stock, quantities, prices, item/currency costs and limited stock, read under the window's all-items filter (your filter is put back at once), and the vendor's reaction to you. Identical stock from the same NPC is recorded at most once per hour in a session.
- Class and profession trainers' lists: each service's spell ID where the client gives one, name, rank, required level/skill/abilities, cost, whether you can learn it now or know it, and the trainer's reaction to you. The same list from the same trainer is recorded at most once a week, while the earlier event is still kept (30 days, or less once the size caps prune it). The hunter's Beast Training window is not recorded.
- A summary of the creatures you target, mouse over, talk to or loot (1.17.0), one entry per NPC, updated in place rather than as events: its name, level range, classification, creature type and family, its reaction to your faction, its subtitle when the tooltip proves one, the services it offers (vendor, repair, flight, trainer, bank, inn, auction, stable and the like, from the windows you open with it; 1.18.0), a beast's attack speed, the last **day** it was seen, and counts of the 1% map squares you stood in while within about 10 yards of it. Never players, pets, guardians, totems or companions, nothing inside instances, no GUIDs, player names or times of day, and no order of sightings. At most 3,000 NPCs (least recently seen go first), and none not seen for 180 days.
- Flight masters (1.18.0): the node ids you can fly to from the flight master's own node and each flight's price, at most once a week for the same list. Nothing when the client gives no node ids. Node names are not kept.
- Flight times (1.18.0): from which node to which and how many seconds the flight took, once per route in 30 days, only when the landing is known to be at the chosen node. No position or route trail.
- Hunter tames (1.20.0): when you tame a beast, its NPC ID (from your target when Tame Beast began; nothing without one), level and family, and what the new pet showed within a minute: its spellbook's abilities and ranks, its attack speed (read out of combat; flagged when the pet had an aura) and its diet. Never the pet's GUID or name. At most 20 a session.

Events include time, game build, map/instance, coordinates outside instances, and **your level, class, faction, given name and surname**. Creature/object GUIDs may identify loot sources. Vendor prices, trainer costs and flight prices are game prices as shown to you (after any reputation discount), not your money. This module does not store player GUIDs, guild, coin loot, quest money, reputation standings or player chat. Raids and inventory have their own, broader data described above. The addon retains at most 5,000 events, 30 days and roughly 2 MB, pruning oldest entries. The NPC summary has its own cap of about 500 KB.

### Items created — `Crafts.lua`

Always on: parses your own system “You create” loot lines, including conjured items, and counts items immediately even if you later sell or use them. It keeps per-item totals, craft-message counts, first/last times, a running total and the newest 120 crafting dates in local time. Earlier activity is unknown. It uses `KutzInventoryDB`, independently of the drop-tracking switch. `/kinv` shows the totals.

### All slash commands and options

| Command | Effect |
| --- | --- |
| `/kinv` | Summary for saved characters, banks, crafts and any last error |
| `/kinv scan` | Rescan available character data; cannot open banks/professions/trainers for you |
| `/kinv ah`, `/kinv ah all` | Whole auction-house scan, or stop an active scan |
| `/kinv ah slow` | Individual crafting-item searches, or stop an active scan |
| `/kinv raid` | List tracked raids |
| `/kinv raid <string>` | Add/update a tracked raid |
| `/kinv raid clear <CODE>` | Remove that local tracked raid and its events |
| `/kinv track` | Observation status (events kept, NPCs held); aliases: `track status`, `track drops`, `track drops status` |
| `/kinv track drops on` | Enable observations (`drops yes` is also accepted) |
| `/kinv track drops off` | Stop new observations and the NPC summary, retaining what is kept |

There is no addon options window. Ordinary inventory and craft recording stay on while the addon is enabled. Upload controls belong to the separate desktop tools.

## Privacy and uploads

The game saves **both** `KutzInventoryDB` and `KutzInventoryObsDB` in `WTF/Account/<account>/SavedVariables/KutzInventory.lua` on `/reload` or logout. They are two tables in the **same file**; `Observations.lua` is source code, not a separate saved-data file.

- `KutzInventoryDB`: character records, shared warband/guild banks, vendor/AH prices, tracked raids, optional monitor snapshot, database version and last error.
- `KutzInventoryObsDB`: observation events, the NPC summary, recording preference/compatibility flags, addon version, random event-ID prefix/counter (the prefix also names the install in exports) and last observation error. The `agreed` flag is initialized automatically on new installs; it is not an upload consent prompt.

The addon sends no HTTP requests. Its auction/item API queries go through the game. Outside the game:

| Your action | What leaves the machine | Destination |
| --- | --- | --- |
| Companion **Get key** | Opens a browser; the browser handles sign-in | Configured site `/private/settings#wow-upload-key` |
| Companion **Connect / save** | Bearer key for account verification, no inventory | `GET /api/wow/identity` |
| Companion **Start**, or a later configured resume | Bearer key and selected data immediately (including pending snapshots), then on game saves/retries | `POST /api/wow/import` and/or `POST /api/wow/auctions` |
| CLI with `--upload` | Bearer key and selected export data; immediately, then on saves/retries with `--watch` | `WOW_IMPORT_URL`; auctions use `WOW_AUCTIONS_URL` or the import URL with trailing `/import` replaced by `/auctions` |
| CLI without `--upload` | Nothing | Local JSON files only |

The Companion defaults to **https://wow.cr0m.com**, the optional receiving website, or an HTTPS origin you choose. CLI URLs must be supplied explicitly. Uploads are gzipped JSON with an `Authorization: Bearer` key; redirects are refused. HTTP loopback is allowed by the worker/CLI for local tests. The receiving service also sees the connection's source IP and upload times. This repo cannot establish the server's storage, sharing, retention or deletion behavior; check the service before uploading.

The Companion reads **all accounts** under the selected client's `WTF/Account`, merging their `KutzInventory.lua` files and any sibling `KutzUI.lua` monitor findings. There is no per-character/account picker. The inventory snapshot contains names/surnames, realm, guild, GUIDs, gold/XP, bags/banks/gear, skills/spells/professions/recipes/trainers, Legacy Trees, latest location and hearth, timestamps/diagnostics, crafted history, tracked raids and retained observations. Monitor data can include other addon names, error messages and stacks, memory/performance and session history; free-text errors can contain sensitive context. Inventory 3.x omits detailed stats, sheet, ordinary talents, spec/role, reputation, statistics, PvP and achievement points; `--format 2` includes those but omits raids, observations, crafted history and hearth.

Auction documents have realm/region/house, scan times and item prices/supply, without character names, player GUIDs or account-folder names. They are still authenticated uploads linked to your key. The raw Lua file, Windows account name, game-folder path and settings file are not sent as upload fields. See [schemas and field privacy](schema/README.md); inspect local exports before sending them.

## Windows Companion / KutzUploader

**KutzUploader on the site is `KutzUICompanion.exe` in the download.** Follow the [full guide](companion/README.md) or [portable Windows instructions](companion/WINDOWS.md). Windows 10/11 x64 is the intended target; the package includes its Node runtime and uses Windows .NET Framework for the tray UI. It requests no administrator privileges.

1. Extract the entire ZIP to a permanent writable folder and run `KutzUICompanion.exe`, keeping `KutzInventoryUploader.exe` beside it.
2. Choose the game client folder; get a personal key from the configured site, paste it, choose upload switches (both default on), and **Connect / save** to verify the account.
3. **Start** verifies again, exports existing saves and uploads selected data immediately. The worker polls file timestamps/sizes every second, coalesces changes for about 400 ms, and exports again after game saves. It also reads a sibling monitor save if present.
4. Inventory failures keep a pending snapshot. Network/408/429/server failures retry with delays of 1–60 seconds; auction requests are spaced at least 10.5 seconds apart, with bounded `Retry-After` handling. Account-link refusals retry every five minutes and on saves. Rejected keys stop the session's requests until corrected. Each new auction scan is sent once according to local acknowledgement state.
5. **Pause** stops watching/retries and is remembered. Closing/minimizing Settings keeps the tray app alive; **Exit Companion** stops the worker. A request already received by the service may still complete.

Settings and unencrypted private exports live in `%LOCALAPPDATA%/KutzUI/Companion`: `settings.json`, `inventory.json`, `auction-scans.json`, `inventory.json.pending.json` while unsent, and `inventory.json.auctions-sent.json`. Temporary writes may leave `.tmp` files. A loopback TCP listener on `127.0.0.1` acts only as an exporter lock and immediately closes connections.

With **Remember securely**, `CredentialStore.cs` saves a generic credential for the current Windows user under `KutzUI.Companion/<site-origin>`. The key is passed to the worker through stdin and kept in process memory; it is not written in exports/settings or command-line arguments. Without Remember it lasts for the app session. Credential Manager does not protect against software running as your Windows user.

Windows sign-in startup is **off by default**, requires a remembered key and is enabled only through your setting. It writes the per-user Run entry `HKCU/Software/Microsoft/Windows/CurrentVersion/Run` → `KutzUI Companion`. Configured, unpaused launches can resume uploads automatically. A saved legacy `https://cr0m.com` origin migrates to `https://wow.cr0m.com`; its old site's key is not reused. The app removes its older PowerShell startup shortcut when updating startup.

The app's implemented work is the tray/settings UI, key verification/storage, saved-file conversion, upload/retry and optional startup described here. It does not automate gameplay, read game memory, ask for a game/Battle.net password, scan unrelated folders, install services, self-update, or download/execute remote code. Desktop programs still run with your ordinary user's filesystem/network rights; they are not sandboxed.

### Build provenance and verifying a download

The tagged release workflow signs both executables with Azure Artifact Signing and verifies their Authenticode signatures and timestamps before publishing. Existing downloads from earlier workflow versions may be unsigned; a local source build is unsigned. Check the actual files as described in the [Companion verification guide](companion/README.md#verify-the-download). A signature identifies the verified publisher, not an absence of vulnerabilities. SmartScreen can still warn; do not disable security controls to run it.

`tools/windows/build.js` bundles the worker and local exporter modules with locked esbuild/postject, injects them into a copy of the official Node executable using Node SEA, and compiles the C# sources with Windows .NET Framework `csc.exe`. It removes Node's original signature before injection; signing is a separate release-only step. The bundle includes this addon's source folder, licenses, README and `build.json` (version, runtime and CI commit). The [Windows workflow](.github/workflows/windows-companion.yml) uses Node 22 on Windows x64, checks/tests/builds and runs standalone smoke tests. Matching `companion-vX.Y.Z` tags then require signing through the `release-signing` environment, verify both executables, recreate the ZIP and `SHA256SUMS.txt`, and publish a prerelease. Missing configuration or failed signing/verification stops publication. PR/main CI artifacts are unsigned.

Download the ZIP and `SHA256SUMS.txt` from the **same release**. In PowerShell:

```powershell
Get-FileHash .\KutzUI-Companion-Windows-x64.zip -Algorithm SHA256
Get-Content .\SHA256SUMS.txt
```

Compare the full hash with that ZIP's line before extraction. A checksum checks file integrity against the published value; it is not a malware verdict or publisher signature. You can inspect the code and [build locally](companion/README.md#build-from-source); builds are not promised byte-for-byte reproducible.

The release workflows generate GitHub provenance attestations for tagged ZIPs in a public repository. Verify your download with:

```sh
gh attestation verify KutzUI-Companion-Windows-x64.zip -R ljk5000/kutz-inventory
# For an addon release, substitute KutzInventory-X.Y.Z.zip.
```

Check the result's repository, workflow and source commit/tag. An unavailable or failed verification is not a verified download. Attestations establish origin, not that the software is free of vulnerabilities. See [GitHub's verification guide](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations).

### Remove the app and data

Pause, **Forget key** (removes the currently selected site's credential and disables startup), then **Exit Companion**. Delete the extracted app folder. Optionally delete `%LOCALAPPDATA%/KutzUI/Companion` and any CLI export folders; they contain private snapshots. Remove other/old site entries beginning `KutzUI.Companion/` in Windows Credential Manager if you used them. Revoke keys on the receiving service; local removal does not revoke them or delete server copies.

To remove the addon, close the game and delete only `Interface/AddOns/KutzInventory`. To remove its records too, delete `KutzInventory.lua` and its `.bak` in the relevant account's `SavedVariables` folder. Do not delete the whole `WTF` folder.

## Exporting and development

The exporter needs Node.js 18+ for CLI use; use **Node 22** for the full checks and Companion build. Exporting/conversion needs no npm dependencies:

```sh
node tools/inventory_export.js <path-to-KutzInventory.lua> <output.json>
node tools/inventory_export.js --watch <path-to-KutzInventory.lua> <output.json>
node tools/inventory_export.js --format 2 <path-to-KutzInventory.lua> <output.json>
```

With no input it looks for all accounts in the conventional Windows `Program Files (x86)/World of Warcraft/_forever_/WTF/Account` folder. Default output is `export/inventory.json` beside the source tree, with `auction-scans.json` alongside it. It prints a local crafting-profit/levelling estimate using observed vendor and AH prices (5% AH sale cut); these are estimates, not guaranteed sale prices. Add `--upload` only after setting `WOW_IMPORT_URL` and `WOW_IMPORT_TOKEN`. `--no-inventory` and `--no-auctions` select upload categories; local conversion still includes both. Details and all tooling: [tools/README.md](tools/README.md).

[JSON schemas and synthetic examples](schema/README.md) describe inventory **3.13.0** (default), inventory **2.1.0** (`--format 2`), auction-scan **1.2.0**, and historical inventory 1.x. `tools/convert.js` parses saved Lua values without executing the file and can also run in a browser.

From the repository root:

```sh
npm ci --prefix tools
node tools/check_all.js
node tools/validate_export.js schema/examples/inventory-export.v3.example.json schema/examples/auction-scan.example.json
```

Checks cover Lua syntax/load limits/globals, fake-game recording/lifecycle, schemas/examples, exact CLI output, conversion, local HTTP uploads, retries/locks and Companion packaging. They do not replace testing in the WoW Forever client. [CONTRIBUTING.md](CONTRIBUTING.md) covers changes; [companion/README.md](companion/README.md#build-from-source) covers the Windows build.

### Release process

Addon tags `vX.Y.Z` must match `KutzInventory/KutzInventory.toc`. `tools/tag_release.js` previews a tag; `--apply` creates it locally. A maintainer pushes the intended tag to trigger checked packaging and a release with `KutzInventory-X.Y.Z.zip` and `SHA256SUMS.txt`.

Companion tags `companion-vX.Y.Z` must match `tools/windows/package.json` and its lockfile version. Their workflow publishes `KutzUI-Companion-Windows-x64.zip` and checksums as a prerelease. Bundle versions and addon versions are independent: inspect `build.json` and the included `.toc`. Workflows also build/check on pull requests and pushes to `main`; offline checks run on pushes and pull requests. Public tag runs attest the ZIPs.

## License and security

[MIT](LICENSE), with [third-party notices](THIRD-PARTY-NOTICES.md) and [REUSE metadata](REUSE.toml). Node's runtime notices travel in the Windows bundle; icon notices are included too. World of Warcraft is a trademark of Blizzard Entertainment, Inc. This project is not made or endorsed by Blizzard.

Report vulnerabilities privately using [GitHub security advisories](https://github.com/ljk5000/kutz-inventory/security/advisories/new), as described in [SECURITY.md](SECURITY.md). Never put upload keys or real SavedVariables in a public issue.
