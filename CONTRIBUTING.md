# Contributing

Bug reports, documentation corrections and focused pull requests are welcome. Include the addon/Companion version, WoW Forever build, steps to reproduce and expected behavior. Use synthetic examples; remove character/guild/account names, paths, credentials and private error text. Report vulnerabilities through [SECURITY.md](SECURITY.md).

Work on a branch in a separate worktree; keep each fix in a clear commit. From the repository root with Node 22:

```sh
npm ci --prefix tools
node tools/check_all.js
```

For Windows executable changes, also follow the [build and smoke-test guide](companion/README.md#build-from-source). For addon behavior, test in WoW Forever as well as the offline fake-game checks. State what you tested and what you could not check in the pull request.

Keep schemas, examples and documentation consistent with changed behavior. `node tools/examples.js --write` and `node tools/cli_golden.js --write` update generated fixtures; inspect those changes before committing. Do not commit real game saves, exports, tokens or build outputs. Preserve third-party notices. Contributions are under the repository's MIT license, subject to existing third-party asset notices.

Release tags, publishing and GitHub settings are maintainer actions. Small compatible fixes may be batched before shipping.
