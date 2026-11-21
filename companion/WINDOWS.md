# KutzUI Companion for Windows (KutzUploader)

This is the uploader called KutzUploader on wow.cr0m.com. The portable package targets Windows 10/11 x64, includes its Node runtime, and uses Windows .NET Framework for the settings/tray UI. No separate Node/npm install or administrator access is needed. Addon and bundle versions are independent: `build.json` identifies the app build; `AddOns/KutzInventory/KutzInventory.toc` identifies the included addon.

## Companion 0.12.4 · KutzInventory 1.20.1

This release bundles KutzInventory 1.20.1, which no longer saves a character twice when the game gives no realm name; the Companion program is unchanged from 0.12.3 and sends inventory export 3.13.0. Like 0.12.2, it requires timestamped Authenticode signing for both Windows executables. The release workflow verifies the signatures before packaging, calculating the checksum and generating ZIP provenance. It retains the 0.12.1 upload-key redaction and recording behavior. The original 0.12.1 release was unsigned; use the verification steps below for this download.

## Install and connect

1. Download `KutzUI-Companion-Windows-x64.zip` and `SHA256SUMS.txt` from the same [GitHub release](https://github.com/ljk5000/kutz-inventory/releases). Verify the hash below, then extract the **entire ZIP** to a permanent writable folder. Do not run from inside the ZIP.
2. With the game closed, copy `AddOns/KutzInventory` into your WoW Forever client's `Interface/AddOns` folder. Check `Interface/AddOns/KutzInventory/KutzInventory.toc`, then enable **cr0m Inventory** in game. It needs no other addon.
3. Run **KutzUICompanion.exe**, keeping **KutzInventoryUploader.exe** beside it. Select the client folder containing `WTF` and `Interface`.
4. Leave the site as `https://wow.cr0m.com`, the optional receiving website, or select your own compatible HTTPS origin. **Get key** opens `/private/settings#wow-upload-key` in your browser. Generate an upload key there and paste it into Companion. The receiving site controls permissions and expiry.
5. Choose **Upload my characters** and/or **Upload auction house prices** (both default on). **Connect / save** verifies the key and displays the server-returned username. Remember securely defaults on; without it the key lasts only for the app session.
6. Click **Start**. It sends existing saved data immediately; `/reload` or logout in game produces later saves/uploads. The app reads **all accounts under that client's `WTF/Account`**, with no account/character picker.

## What runs, reads and sends

The C# UI starts the adjacent Node-based uploader worker on Connect/Start and sends the key via redirected stdin, never command-line arguments. Connect/Start calls `GET /api/wow/identity` with the bearer key; Connect alone sends no inventory. Start converts each account's `SavedVariables/KutzInventory.lua` and any sibling `KutzUI.lua` monitor findings into local JSON without executing the Lua file. It polls saved-file modification time/size every second and coalesces changes for about 400 ms. A monitor-only change does not trigger it.

Character uploads send gzipped inventory 3.x to `POST /api/wow/import`. Auction uploads send one gzipped newer scan per realm/house to `POST /api/wow/auctions`. All requests use the configured origin, default **https://wow.cr0m.com**, with `Authorization: Bearer <key>`; redirects are refused and requests time out after 20 seconds. The worker also accepts HTTP loopback for local tests. Get key opens the website in your browser; the app itself does not call Battle.net or ask for its password.

Inventory includes saved character names/surnames, realm, guild, GUIDs, money/XP, gear and possessions, shared banks, professions/recipes/trainers, skills/spells, applied Legacy Trees, last location/coordinates and hearth, timestamps/diagnostics, craft history, retained drop/quest/vendor observations and explicitly tracked raids. Observations are on by default on a new addon install and include your name/surname and map/coordinates. `/kinv track drops off` stops new recording but **existing events still upload**. Tracked raids include group names and loot. Optional monitor data include addon names, errors/stacks and session/performance history. Inventory 3.x excludes detailed stats/sheet, ordinary talents, spec/role, reputation, achievement statistics/PvP and detailed gear metadata. See the [data guide and schemas](https://github.com/ljk5000/kutz-inventory/blob/main/schema/README.md).

Auction documents include realm/house, scan times, item names/categories/prices, quantities and stack/gear variants, with no character names, player GUIDs or account-folder fields. They remain associated with your bearer key. Raw Lua files, your game path and Windows settings are not sent as fields. The service sees source IP and request times; this repo cannot establish its retention, privacy or deletion policy. Inspect the local export before uploading.

The app does the tray/settings, credential storage, conversion, upload/retry and optional startup described here. It has no self-updater, telemetry endpoint, gameplay automation, game-memory reader, unrelated-folder search, installed service or remote-code download. It runs with your normal Windows user's filesystem/network rights, not in a sandbox.

## Retries, tray and startup

Existing pending inventory is replayed on Start when character uploads are on, even if you changed the selected game/site. Inspect/delete old exports while stopped before changing whom/where you share. Local conversion writes both inventory and auctions even with just one upload category enabled.

Network/408/429/server failures retry at 1–60 seconds. Auction sends are spaced at least 10.5 seconds apart; 429 waits use `Retry-After` capped at 60 seconds, up to three attempts per send. Acknowledged scan timestamps prevent re-sending the same scan; HTTP 400/413/422 mark that scan rejected until a newer one exists. Permanent/key errors block session requests until corrected. Recognized account-link refusals retry every five minutes and on saves after you fix account linking on the site.

Start hides Settings when watching begins. **Closing or minimizing Settings keeps the tray app running.** Right-click its icon for Settings, Start/Pause, Run at Windows sign-in, Open export folder and **Exit Companion**. Double-click reopens Settings; a second launch activates the existing app.

Pause stops polling/retries, aborts requests and stays paused across restarts, preserving your startup preference. Exit closes/terminates the worker. A request the server already received may still complete.

Windows sign-in startup is **off by default** and requires a remembered key. When you enable it, the app writes `HKCU/Software/Microsoft/Windows/CurrentVersion/Run`, value `KutzUI Companion`, pointing to the executable with `--watch`. Configured unpaused launches (including manual launches) can resume automatically. For old settings without a pause preference, only `--watch` resumes. Updating startup removes the older `KutzUI Companion.lnk` Startup-folder shortcut. A saved `https://cr0m.com` origin migrates to `https://wow.cr0m.com`, without reusing the old site's key.

## Storage, upgrade and uninstall

`%LOCALAPPDATA%/KutzUI/Companion` contains:

- `settings.json`: client path, site and remember/pause/upload preferences, never the key.
- `inventory.json` and `auction-scans.json`: latest unencrypted private exports.
- `inventory.json.pending.json`: unsent inventory, removed after success.
- `inventory.json.auctions-sent.json`: acknowledged/rejected scan times and rejection reasons. Interrupted writes can leave `.tmp` files.

**Remember securely** stores the key and verified username in the current user's Windows Credential Manager as a generic credential named `KutzUI.Companion/<lowercase-site-origin>` using `CredentialStore.cs`. Unchecking Remember removes that site's saved key after verification; the session copy stays in process memory. Credential Manager is not protection against software running as your Windows user. Exports use ordinary filesystem permissions and are not encrypted. A `127.0.0.1` TCP listener on a path-derived port from 10000–29999 serves only as an exporter lock and closes connections immediately.

Upgrade by choosing **Exit Companion** and replacing the extracted app files. Keep LocalAppData and game saves. Moving the package requires Connect / save in the new location to update startup. Do not run the legacy PowerShell app alongside it.

To uninstall, Pause, **Forget key** (removes the selected site's credential and disables startup), **Exit Companion**, then delete the extracted folder. Optionally delete the LocalAppData folder and other export directories. Remove other/old `KutzUI.Companion/` generic credentials in Windows Credential Manager if used, and the named Run entry/legacy Startup shortcut if still present. Revoke keys on the receiving site; local deletion does not revoke other copies or delete uploads.

To remove the addon, close the game and delete `Interface/AddOns/KutzInventory`. Optionally delete only this addon's `KutzInventory.lua` and `.bak` from each relevant account's `SavedVariables` folder. Both addon saved tables are in that file. Do not delete the whole `WTF` folder.

## Download integrity and source builds

The tagged release workflow now requires Azure Artifact Signing for both executables before publication. Earlier releases, including the original 0.12.1 build, may be unsigned; local source builds are unsigned. Check the actual download. SmartScreen can still warn; no security policy is disabled by this package. In PowerShell, compare the entire SHA256 with the matching ZIP's line in the release's checksum file before extraction:

```powershell
Get-FileHash .\KutzUI-Companion-Windows-x64.zip -Algorithm SHA256
Get-Content .\SHA256SUMS.txt
```

After extraction, use `Get-AuthenticodeSignature` on **both** `KutzUICompanion.exe` and `KutzInventoryUploader.exe`, or inspect Windows Properties → Digital Signatures. For a signed release, require `Status: Valid`, a timestamp certificate and the expected publisher (the release signing-job log prints its certificate subject). Individual certificates display the verified legal name, which can differ from the app name or GitHub username. The [full verification guide](https://github.com/ljk5000/kutz-inventory/blob/main/companion/README.md#verify-the-download) includes commands. Missing/invalid signatures are not verified signed downloads; signatures do not prove absence of vulnerabilities.

For a release with a GitHub build provenance attestation:

```sh
gh attestation verify KutzUI-Companion-Windows-x64.zip -R ljk5000/kutz-inventory
```

Check the reported repo, workflow and source commit/tag. The release workflow attests tagged ZIPs in a public repository. An unavailable or failed verification is not a verified download. Checksums establish integrity against the published value and attestations establish origin; neither proves absence of malware or vulnerabilities.

Release builds come from the [GitHub Actions workflow](https://github.com/ljk5000/kutz-inventory/blob/main/.github/workflows/windows-companion.yml) on matching `companion-vX.Y.Z` tags. It installs Node 22 and locked esbuild/postject on Windows, runs tests, builds and smoke-tests both executables. A separate tag-only job logs into Azure using GitHub OIDC and the `release-signing` environment, signs both executables with SHA256 and an RFC 3161 timestamp, and verifies the signatures/timestamps. Only then does it create the release ZIP/`SHA256SUMS.txt`; publication depends on that job succeeding. PR/main CI artifacts stay unsigned. `tools/windows/build.js` bundles the local worker/exporter modules, creates a Node SEA blob, removes the copied Node executable's signature with Windows SDK `signtool` and injects the blob with postject. Framework `csc.exe` compiles the three C# sources, generated version, `asInvoker` manifest and icon. It copies the addon, documentation, project/runtime/icon notices and `build.json`. Signing occurs after these modifications and uses the configured Artifact Signing regional endpoint and Microsoft's timestamp service (`http://timestamp.acs.microsoft.com`). Those are build-time contacts, not Companion runtime requests. There is no SBOM step. Runtime patch/hosted toolchain versions are not fully fixed; byte-identical rebuilds are not promised.

To inspect/build your release tag on Windows x64, use Node 22, .NET Framework `csc.exe`, Windows SDK `signtool.exe` and the Node distribution's adjacent `LICENSE`. From the source root:

```sh
npm ci --prefix tools
node tools/check_all.js
npm ci --prefix tools/windows
node tools/windows/build.js export/windows
node tools/windows/smoke.js export/windows/KutzUI-Companion-Windows-x64/KutzInventoryUploader.exe export/windows/KutzUI-Companion-Windows-x64/KutzUICompanion.exe
```

Use a fresh output directory. The [full guide](https://github.com/ljk5000/kutz-inventory/blob/main/companion/README.md) explains inputs/tests and the separate legacy source launcher. The smoke test uses synthetic credentials and a loopback server; live game/server and Windows-startup acceptance still need manual testing.

Source: [ljk5000/kutz-inventory](https://github.com/ljk5000/kutz-inventory). License: MIT plus the included Node/runtime and Lucide notices. Report vulnerabilities through [private GitHub advisories](https://github.com/ljk5000/kutz-inventory/security/advisories/new); do not post keys or real saved files in public issues.
