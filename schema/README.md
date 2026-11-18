# Export formats

These JSON Schema 2020-12 files describe the local exporter's output. The Companion uses inventory 3.x; the CLI can select 2.x. [The root guide](../README.md#privacy-and-uploads) explains when anything is uploaded. This repository contains the producer/validator, not the receiving server.

| Schema | Version | Contents |
| --- | --- | --- |
| `inventory-export.v3.schema.json` | **3.9.0**, default | Inventory, selected character records, Legacy Trees, tracked raids, crafted history, hearth and retained observations |
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

### Observations (3.2.0–3.9.0)

`observations: { v: 1, addon, events: [...] }` comes from the **same saved file's** `KutzInventoryObsDB` table. The addon retains up to 5,000 events, 30 days and roughly 2 MB; export deduplicates by event ID, sorts by time/ID and caps count/serialized size. IDs combine a random install prefix and counter; they are not cryptographic identities or guaranteed globally unique.

Events include `id`, Unix `t`, optional game build `b`, `type`, `where` and `who`:

- `where`: instance/map ID, UI map, instance type/difficulty inside an instance, otherwise `x`/`y` from 0–1 rounded to four places.
- `who`: recording character's level, numeric class, faction, and optional **name/surname** (3.3.0). No realm or player GUID in this block.
- `loot`: `src` with kind (mob/boss/chest/fishing/herb/mine/skin/container/other, plus schema-compatible future kinds), NPC/object/item ID, creature/object GUID when known, level and attribution method; `items: [{ id, n, link?, won? }]`. Coins-only windows have empty items. Known reopened corpses are deduplicated, with skinning separate.
- `quest`: `act` (`accept`/`turnin`), quest ID, NPC/object giver/ender; turn-in can include item rewards/choice IDs/selected choice, never quest money.
- `vendor`: NPC ID, items with quantity, copper `price` per that quantity, optional item/currency costs and limited stock/null. Same vendor and stock are recorded at most once an hour in a session. From 3.9.0, optional `rx` and `filtered` (below).
- `trainer` (3.9.0): a class or profession trainer's whole list, with costs, spell IDs and `rx` (below).

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

No observation field is intended for coin loot, quest/player money, general chat, guild or other players' names/GUIDs. Ordinary inventory, monitor errors and raids have different data and must be reviewed separately. Recording defaults on in new installs since addon 1.13.0; existing off choices persist. Old retained events still export after `/kinv track drops off`.

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

Inventory is private user data, not a ready-made public profile. Require an explicit sharing policy before exposing GUIDs, location/hearth, money, banks/guild tabs, activity times, diagnostics, monitor messages/stacks, raids (other players and loot) or observations (identity and location history). Names/guilds and all the other character details also deserve intentional sharing controls. Auction documents omit these character fields, but the authenticated receiver can associate uploads with a key and connection metadata. This repository cannot guarantee server access controls or anonymous aggregation.
