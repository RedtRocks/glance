Glance is a free, open-source, lightweight viewer and editor for PDFs, images and camera RAW on Windows, inspired by macOS Preview.

> **Early preview.** Most of Preview's everyday features work, plus version history, 3D models and more. The Windows 11 right-click menu entry comes once releases are code-signed. See the [README](https://github.com/RedtRocks/glance#features) for the full list.

## New in 0.3.0

- **Version history and autosave.** Every save keeps a version (File → Browse Versions: preview, restore or open a copy). Edits save automatically a few seconds after you stop (turn it off in Settings). Versions share unchanged data, so they take little space.
- **Safe with other apps and windows.** A file opens in one window only; if another app changes it, Glance pauses autosave and asks before replacing anything.
- **3D models.** GLB/glTF, OBJ, STL, PLY, 3MF, Collada, FBX, USDZ and 3DS: orbit, zoom, wireframe, turntable, animations and PNG snapshots.
- **XPS and OpenXPS** documents, rendered by Windows.
- **Clean Up PDF** removes comments, links, metadata, attached files and scripts for real, and PDFs are compacted when saving.
- **Create Collage** from photos (rows or grid).
- **Share** through the Windows share sheet, **Send to → Glance** in Explorer, and **update notifications** you can skip or turn off.

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

No telemetry and no account. The only network request is an optional daily update check (Settings). Background removal and text recognition run on your PC. Saved signatures are encrypted with your Windows account.

## Verify your download

Compare the file's hash with `SHA256SUMS.txt`: in PowerShell, run `Get-FileHash .\Glance-…-setup.exe`.
