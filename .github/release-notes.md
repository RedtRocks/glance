Glance is a free, open-source, lightweight viewer and editor for PDFs, images and camera RAW and 3D models on Windows, inspired by macOS Preview.

> **Early preview.** Most of Preview's everyday features work, plus version history, 3D models, certificate signatures and more. Glance's entries in Explorer's right-click menu are under **Show more options** on Windows 11; the top-level entry comes once releases are code-signed. See the [README](https://github.com/RedtRocks/glance#features) for the full list.

## New in 0.4.1

- **Fixes the endless update notice in 0.4.0.** The 0.4.0 installer still called itself 0.3.0 inside, so it kept offering 0.4.0 as an update. Installing 0.4.1 stops that.
- **Redaction on images works.** Mark areas, then Apply Redactions: the areas are painted solid black into the pixels, as one step you can undo. Discard and the warning bar work on images like they do on PDFs, and Print uses the edited image.
- **Instant Alpha: hold Shift to add, Alt to subtract.** Like Preview, Shift-drag grows the current selection (of any kind) and Alt-drag takes a region away, with a live preview. Escape keeps the old selection.
- **The More options (⋯) menu works.** Share, Print, Export and the other items in it did nothing when clicked. The menu also closes with Escape.
- **Pick the highlighter color.** The Highlight button in the main toolbar and in the markup bar now has a dropdown with highlight colors (or any color), underline, strikethrough and squiggly underline. Picking a color recolors the selected highlight or highlights the selected text.
- **System fonts load faster for text boxes.** The font list (Aa in the markup bar) reads only what it needs from each installed font and starts loading when the markup bar opens, so your Windows fonts show up right away.

## New in 0.4.0

- **Certificate signatures in PDFs.** A banner above signed PDFs (Adobe, DocuSign and others) says whether each signature is valid, who signed and when, and whether the document changed since; View → Signatures has the details. Trust comes from the Windows certificate store. **Markup → Sign with Certificate** signs with your own certificate or smart card.
- **Header, footer and watermark** (Pages → Header, Footer & Watermark): page numbers, header and footer text with page, date and file-name fields, and text or image watermarks on all pages or a range, with a live preview.
- **Straighten images** (Image → Straighten, Ctrl+Shift+L): rotate by any angle with a slider, an exact value or by dragging, over a grid, with optional crop to fill. Rotate, flip, crop and resize now work on images with markup, which moves with the pixels.
- **Single-key tools** like Photoshop and Figma: V select, H hand, Z zoom, M marquee, L lasso, W Instant Alpha, B draw, U shapes, R rectangle, O oval, T text, S note, C crop, [ and ] for line width, and Space to pan. Every key can be changed in Settings.
- **Reopen tabs on launch** with each tab's page and zoom (off by default; turn it on in Settings).
- **3D viewer:** lighting presets, backgrounds, clay, normals and X-ray materials, ground shadow, floor grid and camera views. Models keep their true colors, and textures show up without having to move the view.
- **Touchpad gestures:** two-finger drag orbits a 3D model (Shift pans), and pinch zooms images and PDFs smoothly.
- **Autosave is calmer:** it saves after 10 seconds without edits, at most once a minute, never while you're typing in a form field, and not at all when nothing changed.
- **Instant Alpha fix:** a quick click no longer leaves a blue tint that Delete can't remove.
- **Ready for translation:** all text now goes through a translation layer, and Glance follows the Windows display language (Settings → Language) as translations are added.

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
