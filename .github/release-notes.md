Glance is a free, open-source, lightweight viewer and editor for PDFs, images and camera RAW on Windows, inspired by macOS Preview.

> **Early preview.** Most of Preview's everyday features work: PDF viewing and page management, markup, signatures, forms, real redaction, text recognition, and image editing with background removal. Autosave with version history, 3D models and Windows 11 context-menu entries are next. See the [README](https://github.com/RedtRocks/glance#features) for the full list.

## New in 0.2.0

**Fixes from testing 0.1.0**
- Highlights no longer hide the text underneath.
- Closing a window with unsaved changes asks to save them (pending redactions included).
- The sidebar no longer shows another document's pages after switching tabs.
- Dragging pages between PDFs is easier: hover a tab to open it, then drop exactly where you want. Right-click a page for Copy/Move To, Duplicate, Split and more.
- Menus show only what applies to the open file, and the View menu uses one-choice groups.

**PDF**
- Text boxes in any installed font; highlights in any color; squiggly underline; loupe (magnifier).
- Duplicate pages, Split PDF, and export pages as PNG, JPEG or TIFF.
- Remove Sensitive Text finds names, emails, phone, card and ID numbers to redact.
- Recognize Text (Windows OCR) makes scanned PDFs searchable and selectable.
- Sign with your camera.

**Images**
- Remove Background and Copy Subject, Instant Alpha, selections, crop, Adjust Color (now with Definition and Gamma) and Adjust Size.
- Inspector (Ctrl+I) with EXIF, color profile and **Remove Location**.
- Batch Edit Images: rotate, resize, convert and remove location for many images at once.
- Export in Display P3, Adobe RGB or Gray; copy text from an image; set an image as your desktop background or lock screen.
- Open PSD, AI and RAW files in another app with one click.

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
