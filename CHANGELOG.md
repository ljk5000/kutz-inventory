# Release notes

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
