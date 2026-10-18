# Fonts

Self-hosted so visitors' browsers never contact Google when loading nbview. Latin subset only, as variable fonts; other scripts fall back to the system font.

| File | Font | Version | Source |
|---|---|---|---|
| `jetbrains-mono-latin.woff2` | JetBrains Mono (weights 400 to 600) | v24 | https://github.com/JetBrains/JetBrainsMono |
| `source-serif-4-latin.woff2`, `source-serif-4-italic-latin.woff2` | Source Serif 4 (400 to 700, italic 400) | v15 | https://github.com/adobe-fonts/source-serif |

Both fonts are licensed under the SIL Open Font License 1.1 (https://openfontlicense.org). JetBrains Mono is Copyright 2020 The JetBrains Mono Project Authors. Source Serif is Copyright 2014 to 2021 Adobe, with Reserved Font Name "Source".

To update, download the new woff2 files from the projects above (or from Google Fonts) and replace these files; the `@font-face` rules are at the top of `assets/css/style.css`.
