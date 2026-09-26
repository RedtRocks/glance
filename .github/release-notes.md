Glance is a free, open-source, lightweight viewer and editor for PDFs, images and camera RAW on Windows, inspired by macOS Preview.

> **Early preview.** Viewing, PDF page management, markup, signatures, form filling, redaction and image editing (background removal, Instant Alpha, adjust color and size, crop) work. 3D models, batch processing, autosave with version history, text recognition and Windows 11 context-menu entries are in progress. See the [README](https://github.com/RedtRocks/viewer#features) for the roadmap.

## Download

| Your PC | Installer |
|---|---|
| Most Windows PCs (Intel/AMD) | `Glance-…-windows-x64-setup.exe` |
| ARM laptops (Snapdragon, Surface Pro X) | `Glance-…-windows-arm64-setup.exe` |

Not sure? Open **Settings → System → About** and look at **System type**.

## Install

1. Download the installer and run it. It installs for your account only; no administrator rights are needed.
2. **Windows SmartScreen will warn** that the app is from an unknown publisher, because releases aren't code-signed yet. Click **More info → Run anyway**.
3. To make Glance your PDF or image viewer: right-click a file → **Open with → Choose another app → Glance**, and tick **Always use this app**.

Requires Windows 10 (1809+) or Windows 11. The installer downloads the WebView2 runtime if it's missing (it's preinstalled on Windows 11).

## Privacy

No telemetry, no account, no network access. Saved signatures are encrypted with your Windows account.

## Verify your download

Compare the file's hash with `SHA256SUMS.txt`: in PowerShell, run `Get-FileHash .\Glance-…-setup.exe`.
