# Companion icon

`retriever.png` is the generated golden-retriever app artwork. `Companion.ico` is its Windows icon, embedded in the executable, settings window and tray. A Windows warning icon indicates a status that needs attention.

The design uses framing inspired by the ISC-licensed [Lucide dog icon](https://github.com/lucide-icons/lucide/blob/55782beff3a0133df79c417eb68f96e8f19e2404/icons/dog.svg). Keep `Lucide-LICENSE.txt` with the assets and in Windows distributions; see the repository's `REUSE.toml` and `THIRD-PARTY-NOTICES.md`.

From the repository root, regenerate the ICO from the PNG with:

```powershell
powershell -NoProfile -File tools/windows/make_icon.ps1
```

It creates transparent 16, 20, 24, 32, 40, 48, 64, 96, 128 and 256 px frames. The normal build consumes the committed ICO and does not run an image generator.
