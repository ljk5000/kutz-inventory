# Third-party notices

What in this repository, or in a release download, was not written for this project.

## In the downloads

- The **KutzInventory** addon calls the game's API and includes no copies of Blizzard's files.
  `KutzInventory/CommonWords.lua` uses the first 4,000 ASCII lowercase entries of Michael Wehar's
  [5000-more-common.txt](https://github.com/MichaelWehar/Public-Domain-Word-Lists/blob/e2fe9d32eeb86179b464aba0e91fa96904b8e7e8/5000-more-common.txt),
  sorted and converted into a Lua lookup table. Wehar generated the list using OPTED and
  [released it into the public domain](https://github.com/MichaelWehar/Public-Domain-Word-Lists/blob/e2fe9d32eeb86179b464aba0e91fa96904b8e7e8/README.md).
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
