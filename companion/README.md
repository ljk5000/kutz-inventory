# KutzUI Companion (KutzUploader)

**Companion 0.12.2 bundles KutzInventory 1.15.1.** See [release notes](../CHANGELOG.md) for the public release.

The Windows tray app uploads KutzInventory saves to [wow.cr0m.com](https://wow.cr0m.com), the optional receiving website. The site calls it **KutzUploader**; its launcher is **KutzUICompanion.exe**. The addon is usable without uploading. Read the [full addon/data guide](../README.md) before sharing a game client used by several people.

## Set up

1. Get `KutzUI-Companion-Windows-x64.zip` and `SHA256SUMS.txt` from the same [release](https://github.com/ljk5000/kutz-inventory/releases) (`companion-vX.Y.Z`). [Verify the download](#verify-the-download), then extract the **whole ZIP** to a permanent writable folder. Windows 10/11 x64 is the intended target; no separate Node/npm installation or administrator access is needed. The UI uses Windows .NET Framework; the worker runtime is bundled.
2. With the game closed, copy the bundle's `AddOns/KutzInventory` into `<client>/Interface/AddOns`. Check `Interface/AddOns/KutzInventory/KutzInventory.toc`; enable **cr0m Inventory** in game. Other addons are optional.
3. Run `KutzUICompanion.exe`, keeping `KutzInventoryUploader.exe` beside it. Select the **client folder containing `WTF` and `Interface`**. Every account's `SavedVariables/KutzInventory.lua` under `WTF/Account` is merged; there is no account/character picker.
4. Leave the site as `https://wow.cr0m.com`, or choose your own HTTPS origin implementing the same API. **Get key** opens that site's `/private/settings#wow-upload-key` in your browser. Create an upload key there and paste it into the app. Permissions, expiry and server policy are controlled by that service, not this repo.
5. Choose **Upload my characters** and/or **Upload auction house prices** (both default on). **Connect / save** verifies the key and displays the username returned by the server. **Remember securely** defaults on; uncheck it for a key kept only for this app session.
6. Click **Start**. This immediately uploads existing saved data and replays pending inventory when character uploads are enabled. Future `/reload` or logout saves trigger further exports/uploads. It does not wait for your first new game save.

A legacy saved origin of `https://cr0m.com` migrates to `https://wow.cr0m.com` on launch. Credentials are scoped to each origin; the old site's key is not reused. Reconnect with a key for the new site.

## What the executables do

`KutzUICompanion.exe` is the C# settings/tray UI. On Connect or Start it launches the adjacent `KutzInventoryUploader.exe`, a Node Single Executable Application containing the worker and local exporter code. The UI passes settings and the key through redirected stdin, not command-line arguments.

1. Connect/Start calls `GET /api/wow/identity` with the bearer key. Connect alone sends no inventory. The app remembers settings/key only after account verification succeeds.
2. Start validates the game folder and takes a loopback TCP output lock on `127.0.0.1` (a path-derived port from 10000–29999). This listener closes incoming connections; it serves no API or exports.
3. The worker reads each account's `KutzInventory.lua` and any sibling `KutzUI.lua` to select the latest addon-monitor report. The converter parses Lua values without executing the saved file. It writes inventory 3.x and an array of auction scans locally, even if only one upload switch is on.
4. It sends the selected JSON to the configured site, gzipped and authenticated. Existing/pending data are sent at startup. It checks saved-file modification times/sizes every second and coalesces changes for roughly 400 ms before processing. A sibling monitor file change alone does not trigger a scan.
5. Inventory is saved to an outbox before sending; acknowledgement deletes that pending file. The next session may replay it, including after switching game folders/sites. Pause and inspect/delete old exports while the app is stopped if changing whom/where you share.
6. While running, transient errors retry at 1, 2, 4… seconds capped at 60 seconds. Auction requests are at least 10.5 seconds apart; 429 responses use `Retry-After` capped at 60 seconds with up to three attempts per send. Each house's scan is skipped once its timestamp has been acknowledged. HTTP 400/413/422 mark that auction scan rejected and skip it until a newer scan exists. Other permanent errors block session requests; correct settings/key and restart uploading. The two recognized account-link refusals keep watching and retry every five minutes or on a game save.
7. Pause cancels polling/retries and aborts active upload requests. Exit closes stdin, waits for the worker and terminates it if needed. A request the server already received can still finish.

There is no executable self-update, telemetry endpoint, gameplay automation, game-memory reading, game/Battle.net password collection, unrelated-folder search, service installation or remote-code download. The tray UI can open your browser or export folder at your request. These are ordinary desktop processes running with your user rights, not a sandbox or a proof that the software has no bugs.

### Network endpoints and data

All app HTTP requests use the configured origin (default `https://wow.cr0m.com`):

| Endpoint | Trigger and payload |
| --- | --- |
| `GET /api/wow/identity` | Connect, Start or configured resume: bearer key, no inventory |
| `POST /api/wow/import` | Start/resume, game saves and retries with character uploads on: bearer key and full inventory 3.x snapshot |
| `POST /api/wow/auctions` | Start/resume, saves and retries with auction uploads on: bearer key and one newer scan per realm/house |
| `/private/settings#wow-upload-key` | Get key opens your browser; sign-in is handled there |

The UI requires HTTPS. The worker accepts HTTP loopback for local tests. Redirects are refused and requests time out after 20 seconds. There is no direct Battle.net network call in this app; account linking mentioned in server refusals happens on the website.

Inventory includes **all saved characters** under that client: names/surnames, realm, guild, game GUIDs, gold/XP, possessions including shared banks, professions/recipes/trainers, skills/spells, Legacy Trees, last location/coordinates and hearth, craft history, timestamps/diagnostics, retained observations, tracked raid events and optional addon-monitor reports. Those reports can contain addon names, error messages/stacks and session/performance history. Inventory 3.x removes ordinary talents, stats/sheet, spec/role, reputation, achievement statistics/PvP and detailed equipped-item fields; [schema/README.md](../schema/README.md) gives the exact contract.

Observations are on by default on a new addon install: loot/quest/vendor events include time, map/coordinates and the recording character's **name/surname**, level, class and faction. `/kinv track drops off` stops new events but old ones still upload. Raids added with `/kinv raid` include group names and loot. Auction documents have realm/house, scan times, item names/categories/prices/stack variants and no character/player GUID/account-folder fields; the key still associates them with your account. The raw saved files, game-folder path and Windows settings are not sent as fields. The server sees your source IP and upload timing. Its privacy, retention and authorization behavior cannot be verified from this repo.

## Tray controls and startup

Start hides Settings once watching begins. **X and Minimize keep the tray app running.** Right-click the tray icon for Settings, Start/Pause, Windows sign-in startup, export folder or **Exit Companion**; double-click reopens Settings. Launching the app a second time activates the existing window.

Pause is remembered across restarts and preserves the startup preference. Windows sign-in startup is **off by default**, requires a remembered key and writes only the per-user Run entry `HKCU/Software/Microsoft/Windows/CurrentVersion/Run` named `KutzUI Companion` with the executable path and `--watch`. A configured app with a saved key resumes quietly when launched unless paused, even on manual launch. Older installations without a saved pause preference resume only with `--watch`. Moving the package requires Connect / save in the new location to update startup. Updating startup removes the older `KutzUI Companion.lnk` in your Windows Startup folder.

## Local storage and removal

| Location | Contents |
| --- | --- |
| `%LOCALAPPDATA%/KutzUI/Companion/settings.json` | Game path, site, remember/pause and upload preferences; never the key |
| Same folder: `inventory.json`, `auction-scans.json` | Latest converted data, unencrypted |
| Same folder: `inventory.json.pending.json` | Unacknowledged inventory snapshot, deleted after success |
| Same folder: `inventory.json.auctions-sent.json` | Acknowledged/rejected scan timestamps and rejection reason |
| Same folder: `.tmp` writes | Temporary files which may remain after interruption |
| Windows Credential Manager, Generic Credentials: `KutzUI.Companion/<lowercase-site-origin>` | Remembered upload key and server-returned username for your Windows user (`CredentialStore.cs`) |
| Per-user Windows Run entry | Optional sign-in startup, as above |

Without Remember, the verified key stays in app memory for the session and the saved credential for that origin is removed. Credential Manager protects the persistent copy for your user; other software running as that user can access it. Exports rely on ordinary filesystem permissions and are not encrypted. Game data stay in the client's account `SavedVariables/KutzInventory.lua` (both addon tables in one file).

To upgrade, **Exit Companion** and replace the extracted app files; retain LocalAppData settings and the game's saved files. Do not run the legacy PowerShell and native versions together.

To uninstall:

1. Pause, then **Forget key**. This disables sign-in startup and deletes the currently selected site's credential.
2. Choose **Exit Companion**, then delete the extracted app folder.
3. Optionally delete `%LOCALAPPDATA%/KutzUI/Companion` and any CLI exports. In Windows Credential Manager remove other `KutzUI.Companion/` entries, including an old site's entry if used. If needed, remove the named Run entry and legacy Startup shortcut manually.
4. Revoke keys on the receiving service. Deleting local files/keys does not delete uploaded data or invalidate other key copies; use the service's controls for those.
5. To remove the addon too, close the game, remove `Interface/AddOns/KutzInventory`, and optionally only that addon's `KutzInventory.lua` and `.bak` from account SavedVariables. Keep the rest of `WTF`.

## Verify the download

The tagged release workflow Authenticode-signs **both executables** with Azure Artifact Signing after building and smoke-testing them. It verifies their signatures and timestamps before creating the published ZIP. Earlier releases may be unsigned; local source builds and PR/main CI artifacts are unsigned. The worker's original Node signature is removed before injecting project code, so a signed release identifies this project's verified publisher, not Node's publisher. SmartScreen can still warn. Do not disable Windows security policy for this app.

Download the ZIP and `SHA256SUMS.txt` from the same release and compare the complete hash in PowerShell:

```powershell
Get-FileHash .\KutzUI-Companion-Windows-x64.zip -Algorithm SHA256
Get-Content .\SHA256SUMS.txt
```

After extracting, check both executable signatures in PowerShell:

```powershell
'KutzUICompanion.exe', 'KutzInventoryUploader.exe' | ForEach-Object {
  $signature = Get-AuthenticodeSignature -LiteralPath (Join-Path '.\KutzUI-Companion-Windows-x64' $_)
  $signature | Format-List Path, Status, StatusMessage
  $signature.SignerCertificate | Format-List Subject, Issuer
  $signature.TimeStamperCertificate | Format-List Subject, Issuer
}
```

For a signed release, require `Status: Valid` for **each** file, a timestamp certificate, and the expected publisher. An individual Artifact Signing certificate uses the publisher's verified legal name, which can differ from the GitHub username or app name. Check it against that release's signing-job log (the verification step prints the certificate subject). You can also use Windows Properties → Digital Signatures, or Windows SDK `signtool verify /pa /all /v <exe>`. A signature establishes publisher identity and integrity, not that the app is free of malware or vulnerabilities. A missing/invalid signature is not a verified signed download.

This checks against the published checksum, not for malware. For a release with a GitHub provenance attestation:

```sh
gh attestation verify KutzUI-Companion-Windows-x64.zip -R ljk5000/kutz-inventory
```

Review the repository, workflow and source commit/tag reported. The release workflow attests tagged ZIPs in a public repository. An unavailable or failed verification is not a verified download. An attestation proves provenance, not absence of vulnerabilities. You can also inspect/build the source at the release tag. Exact binary reproducibility is not promised (the workflow selects the Node 22 line and a hosted Windows toolchain, not fixed patch/image versions).

## Build from source

Use a Windows x64 machine with **Node 22**, Windows .NET Framework's 64-bit `csc.exe`, Windows SDK `signtool.exe`, and the Node distribution's adjacent `LICENSE` file. From the repository root:

```sh
npm ci --prefix tools
node tools/check_all.js
npm ci --prefix tools/windows
node tools/windows/build.js export/windows
node tools/windows/smoke.js export/windows/KutzUI-Companion-Windows-x64/KutzInventoryUploader.exe export/windows/KutzUI-Companion-Windows-x64/KutzUICompanion.exe
```

Choose a fresh build output directory each time. `tools/windows/build.js`:

- Bundles `worker.js`, `session.js`, `transport.js` and the required local `tools/` modules with locked esbuild; Node's SEA mechanism produces the blob; locked postject injects it into a copy of the running Node executable after `signtool remove /s`.
- Compiles `Companion.cs`, `Companion.Tray.cs`, `CredentialStore.cs`, generated assembly version, manifest (`asInvoker`) and icon with Framework `csc.exe` and Windows Forms/Drawing/Web.Extensions.
- Copies `KutzInventory/`, `WINDOWS.md`, project/Node/Lucide licenses and writes `build.json` with version, OS/architecture, Node version and CI commit (null outside CI unless `GITHUB_SHA` is set).

[windows-companion.yml](../.github/workflows/windows-companion.yml) uses a Windows hosted runner and Node 22, installs locked build tools, runs behavior/package tests, builds, and smoke-tests the real executables against a loopback fake server without Node on their PATH. PR/main builds produce an explicitly unsigned CI artifact. On matching `companion-vX.Y.Z` tags, a separate Windows job uses the `release-signing` environment and GitHub OIDC to log in to Azure without a stored client secret. Azure Artifact Signing signs exactly the two executables using SHA256 and an RFC 3161 timestamp from `http://timestamp.acs.microsoft.com`. Windows SDK `signtool` and PowerShell verify both signatures and require timestamps; only then is the ZIP recreated and its `SHA256SUMS.txt` calculated. The release job consumes only that signed artifact, publishes a prerelease and, in a public repository, a provenance attestation for the final ZIP. Signing/configuration/verification failures stop publication. The tag must match `tools/windows/package.json`; update its lockfile too. There is no SBOM step.

### Maintainer signing configuration

Preconfigure the GitHub environment **`release-signing`** to allow only `companion-v*` tags. Set these environment variables: `AZURE_CLIENT_ID` (managed identity Client ID, not Object/Principal ID), `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_SIGNING_ENDPOINT`, `AZURE_SIGNING_ACCOUNT_NAME` and `AZURE_SIGNING_CERTIFICATE_PROFILE_NAME`. Use a Public Trust certificate profile and its account's regional endpoint (East US: `https://eus.codesigning.azure.net/`). The managed identity needs the Artifact Signing Certificate Profile Signer role; its federated credential must match the repository's actual GitHub OIDC subject for environment `release-signing`, issuer `https://token.actions.githubusercontent.com`, and audience `api://AzureADTokenExchange`. Newly created repositories can use owner/repository IDs in that subject; copying a legacy name-only example can fail. See [Azure's signing action](https://github.com/Azure/artifact-signing-action) and [GitHub's OIDC subject reference](https://docs.github.com/en/actions/reference/security/oidc#immutable-subject-claims).

These identifiers are configuration, not private keys. The signing job alone receives `id-token: write`; regular builds have read-only repository permissions. Azure holds the signing keys. This setup must pass a real tagged build before a particular release can be claimed to be signed; changing the workflow does not sign existing assets.

The smoke test exercises tray/window lifecycle, credential roundtrip with a synthetic target, worker exit and standalone identity/export/upload/pause. Live game/server acceptance and startup preferences still require a manual test. Full offline checks use Node 22+; CI uses 22.

### Source-only legacy launcher

`node tools/package_release.js <fresh-directory>` builds a **legacy PowerShell source package**, not the two native executables. It copies the addon, `Companion.ps1`, `Start.cmd`, credential helper and six local worker/exporter modules. It requires Node 22+ on PATH; keep `companion` and `tools` adjacent. `Start.cmd` runs Windows PowerShell without bypassing execution policy. That window has no native tray behavior: closing it stops its worker, Pause disables its Startup-folder shortcut, and it has no separate upload-category switches or persistent native pause preference. Use the portable executable for the documented tray behavior.

Report security issues privately through [SECURITY.md](../SECURITY.md). Please do not attach real keys, account folders, saved files or exports to public issues.
