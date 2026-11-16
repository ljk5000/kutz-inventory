# Third-party notices

What in this repository, or in a release download, was not written for this project.

## In the downloads

- The **KutzInventory** addon contains only this project's code (MIT). It calls the game's API.
  None of Blizzard's files are copied.
- The **Companion worker**, `KutzInventoryUploader.exe`, embeds the Node.js runtime (MIT and others). `tools/windows/build.js` copies
  Node's licence into the zip as `RUNTIME-LICENSE.txt`, and this project's licence as `LICENSE.txt`.
- The Companion icon artwork has Lucide-inspired framing. The ISC notice in
  `companion/Assets/Lucide-LICENSE.txt` is copied into the Windows ZIP as `Lucide-LICENSE.txt`.
  The asset licensing is recorded in `REUSE.toml`; see `companion/Assets/README.md` for regeneration.

## Development tools (not in any download)

Installed by `npm ci` in `tools/` from `tools/package-lock.json`: fengari (MIT), luaparse (MIT), ajv and
ajv-formats (MIT). The Companion build uses esbuild (MIT) and postject (Apache-2.0) from
`tools/windows/package-lock.json`.

## Not used

Auctionator's saved prices are not read: its authors reserve all rights, so KutzInventory records its
own prices.
