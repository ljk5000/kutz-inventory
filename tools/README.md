# Tools: export, validate, test and package

Run commands below from the repository root. Use Node 22 for the full suite and Companion; standalone CLI export supports Node 18+. The converter/exporter itself needs no npm dependencies. Check tools install from `tools/package-lock.json`; Windows build tools have a separate lockfile.

## Export locally

```sh
node tools/inventory_export.js <path-to-KutzInventory.lua> <output.json>
node tools/inventory_export.js --watch <path-to-KutzInventory.lua> <output.json>
node tools/inventory_export.js --format 2 <path-to-KutzInventory.lua> <output.json>
node tools/inventory_export.js --help
```

No input path: scans all accounts under `Program Files (x86)/World of Warcraft/_forever_/WTF/Account` on Windows. Default output is the repository's `export/inventory.json`, with `auction-scans.json` beside it. Explicit input reads one saved file. If present, a sibling `KutzUI.lua` provides a potentially newer addon-monitor report. The exporter reads/converts saved data, never executes the Lua file. `convert.js` also works as a browser script exposing `KutzConvert`, with no filesystem/network APIs and a table-depth limit of 64.

The CLI prints estimates for profitable vendor crafts and inexpensive skill-ups using observed vendor/AH prices and a 5% AH sale cut. These calculations are local reports, not an uploaded `crafting` section. Prices may be stale, unknown or from different houses; they do not guarantee a sale or skill-up. Formats and field privacy are documented in [schema/README.md](../schema/README.md).

`export_inventory.cmd` runs the exporter once from a Windows shortcut, using the same default paths and inherited environment. The [Companion](../companion/README.md) uses the same conversion/queue code with its own selected game folder and storage directory.

## Explicit uploads

Exporting is local unless **`--upload`** is supplied. Set these environment variables in your shell (keep keys out of shell history, scripts and screenshots):

| Variable | Meaning |
| --- | --- |
| `WOW_IMPORT_URL` | Full import endpoint, e.g. `https://wow.cr0m.com/api/wow/import` |
| `WOW_IMPORT_TOKEN` | Your receiving service's bearer upload key |
| `WOW_AUCTIONS_URL` | Optional full auction endpoint; otherwise trailing `/import` in the import URL becomes `/auctions` |

```sh
node tools/inventory_export.js --upload <saved-file> <output.json>
node tools/inventory_export.js --watch --upload --no-inventory <saved-file> <output.json>
node tools/inventory_export.js --watch --upload --no-auctions <saved-file> <output.json>
```

Both upload types are enabled by default; the two `--no-*` flags select what to **send**, not what gets converted locally. `--format 2` selects the broader legacy character profile; default 3.x includes retained raids/observations/craft history/hearth. The CLI has no account identity GET; it directly POSTs gzipped JSON with `Authorization: Bearer <key>`. HTTPS is required, except HTTP loopback for local tests; redirects are refused and requests use a 20-second timeout. Choose endpoints carefully: your key is sent to each configured endpoint. The server sees source IP/request times as well as the payload. No remote server policy is guaranteed by this code.

Uploads happen **immediately**, including any older pending inventory before the fresh export. With `--watch`, existing selected files are polled every second and changes are coalesced about 400 ms; new account files are not automatically discovered by the CLI after startup (the Companion does rediscover them). Transient errors retry exponentially from 1 to 60 seconds; permanent errors wait for a new save in CLI watch mode. Stop CLI watch mode with Ctrl+C.

`<output>.pending.json` holds unacknowledged inventory; `<output>.auctions-sent.json` records acknowledged/rejected scans by realm/house. Auction sends are spaced 10.5 seconds apart with bounded 429/`Retry-After` handling; 400/413/422 skip the rejected scan until newer data exist. Output locking uses a loopback TCP listener; it serves no API. Tokens are redacted from CLI error text, but local console output includes paths, character names and server error text: do not share it unreviewed. Pending files are not scoped to a site/account; inspect/remove them while stopped before changing destinations. Delete your output folder to remove local exports and sender state. Removing local data never revokes keys or erases server copies.

## Checks

```sh
npm ci --prefix tools
node tools/check_all.js
node tools/validate_export.js <inventory-or-auction-file>
node tools/examples.js
node tools/cli_golden.js
node --test companion/companion.test.js tools/package_release.test.js
```

`check_all.js` covers:

- Lua syntax, Lua 5.1 local/upvalue limits and unexpected globals (`check.js`, `limits.js`, `globals.js`).
- Scheduler/retries, bank/logout/exit snapshots and diagnostics, GUID ownership for same-name characters.
- Vendor/AH scans/migration/supply, tracked raids, drop/quest/vendor/trainer observations, the NPC summary and craft counters in offline Lua.
- Inventory 2.x/3.x and auction schemas, invalid-data rejection, gzip requests and credential-redaction errors.
- Synthetic examples, conversion with no Node globals, exact CLI fixtures, watch queues, outbox and auction sender.
- Companion identity/HTTP/watch/locks, site migration and legacy distribution tests (Node 22+; older Node skips this part).

`examples.js --write` regenerates the saved Lua and inventory examples in `schema/examples`. `cli_golden.js --write` regenerates normalized CLI fixtures. These are for intentional changes; review diffs, do not blindly accept new output. Offline checks do not establish live game behavior or a deployed server's privacy/authorization.

## Packages and releases

`package_release.js <fresh-directory>` creates the legacy PowerShell/Node source distribution: addon plus explicit worker/helper files, no exports/credentials/dependencies. It does **not** build the native executables. See [the Companion source guide](../companion/README.md#source-only-legacy-launcher).

The native portable package is built by `tools/windows/build.js` on Windows x64 with Node 22, .NET Framework's compiler and Windows SDK. `tools/windows/smoke.js` checks the resulting executables using synthetic credentials and local HTTP. Tagged releases then require Azure Artifact Signing and signature/timestamp verification for both executables before ZIP/checksum creation and publication; PR/main artifacts and local builds stay unsigned. [Build inputs, signing configuration, verification and provenance](../companion/README.md#build-from-source) are documented in the Companion guide.

For addon packaging, `build_addon_zips.sh` uses the BigWigs packager commit pinned in `.github/workflows/release-addons.yml`. It needs Bash, jq, zip/unzip and a normal clone (`.git` directory; the upstream packager does not support a worktree's `.git` file). Use a disposable clone for that packaging step if developing in a worktree; do not edit a shared main checkout.

```sh
# Set PACKAGER to the pinned release.sh downloaded from the workflow's PACKAGER_URL.
bash tools/build_addon_zips.sh <output-directory>
node tools/check_release_zip.js <addon.zip> inventory <expected-version> --licensed
node tools/tag_release.js
```

The ZIP validator checks layout, `.toc` dependencies/version, license and fake-game standalone loading. `tag_release.js` previews the tag for HEAD's `.toc`; `--apply` creates it locally and never pushes. Publishing requires a maintainer's deliberate tag push.

Addon `vX.Y.Z` tags publish `KutzInventory-X.Y.Z.zip` and `SHA256SUMS.txt`. Companion `companion-vX.Y.Z` tags must match `tools/windows/package.json` (update lockfile too); they publish `KutzUI-Companion-Windows-x64.zip` and checksums as a prerelease. Public-repository tag runs attest their ZIPs. Normal PR/main builds produce CI artifacts, not releases. The offline-check workflow runs for pushes and PRs.
