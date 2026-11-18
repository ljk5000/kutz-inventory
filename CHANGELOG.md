# Release notes

## KutzInventory 1.18.0

- Record flight masters for cr0m's item database (drop tracking, `/kinv track`): when a flight master's map opens, every node you can fly to from its node, by taxi node id, with the price the map shows you (a game price, not your money) and the number of legs. The node ids come from `C_TaxiMap.GetAllTaxiNodes` matched slot by slot to the map; when the client gives no ids, the two disagree or there is not exactly one current node, nothing is recorded. Node names are not kept. The same list and reaction from the same flight master is recorded at most once a week.
- Record flight times: from which node to which and the whole seconds from boarding (`TakeTaxiNode`, then losing control on the taxi) to landing (control back, off the taxi). Kept only when the landing is known to be at the chosen node (your position on the taxi map is by that node, or the next flight master's map within 2 minutes is at it), once per route in 30 days. No position or route trail, and never your money.

- The NPC summary records `svc`, the services each NPC was seen to offer (vendor, repair, flight, trainer, bank, guildbank, inn, auction, stable, battlemaster, spirit, guild, tabard), from the interaction window the game opens with it (`PLAYER_INTERACTION_MANAGER_FRAME_SHOW`, matched by the interaction type's name), the vendor, trainer and flight master windows, whether the merchant can repair, and binding your Hearthstone at an inn. Creatures only (never a mailbox or other object); each counts as standing beside it. No gossip text.

Inventory export 3.11.0 (default) adds the observation types `taxi` and `flight`, strictly validated (a doubtful node list is dropped whole), and `svc` on NPC summary entries, a sorted list of the known services; the observations section stays `v: 1`. 2.1.0 (`--format 2`) and auction scans 1.2.0 are unchanged.

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
