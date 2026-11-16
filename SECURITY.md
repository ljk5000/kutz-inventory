# Security policy

Please report suspected vulnerabilities privately using [GitHub's “Report a vulnerability” form](https://github.com/ljk5000/kutz-inventory/security/advisories/new). Private vulnerability reporting must be enabled by the repository owner for that form to be available. If it is unavailable, ask the maintainer in an issue to enable it **without disclosing vulnerability details**.

Include the affected version/tag, component, impact and minimal reproduction using synthetic data. Do not include upload keys, passwords, real SavedVariables, account paths or private exports in a public issue. Share any necessary sensitive evidence only in the private advisory.

Security fixes target the current source and future releases; older builds are not promised backports. The Windows executables are currently unsigned. Checksums and any available build attestations verify integrity/origin, not absence of vulnerabilities. See the [Companion guide](companion/README.md) for storage, network behavior, verification and credential removal.

If a key may have leaked, revoke it on the receiving service and generate another. Removing a local credential does not revoke the key or erase server data. No response deadline or guaranteed security review is offered.
