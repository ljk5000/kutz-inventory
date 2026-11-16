# Release notes

## Unreleased

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
