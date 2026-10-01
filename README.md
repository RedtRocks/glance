<p align="center"><img src="assets/banner.jpg" alt="Glance: Preview's best tricks, built for Windows 11"></p>

<p align="center">
  <a href="https://github.com/RedtRocks/glance/releases/latest"><img src="https://img.shields.io/github/v/release/RedtRocks/glance?style=flat-square&label=release&color=0f6cbd" alt="Latest release"></a>
  <img src="https://img.shields.io/badge/Windows-10%20%7C%2011-0078d4?style=flat-square" alt="Windows 10 and 11">
  <img src="https://img.shields.io/badge/x64%20%2B%20ARM64-~10%20MB-0e7490?style=flat-square" alt="x64 and ARM64, about 10 MB">
  <a href="LICENSE"><img src="https://img.shields.io/github/license/RedtRocks/glance?style=flat-square&color=6b7280" alt="Apache-2.0 license"></a>
</p>

<p align="center">
  <b>A free, open-source, lightweight viewer and editor for PDFs, images, camera RAW and 3D models on Windows, inspired by macOS Preview.</b>
</p>

<p align="center">
  <a href="https://github.com/RedtRocks/glance/releases/latest"><b>⬇&nbsp; Download for Windows</b></a>
  &nbsp;·&nbsp;
  <a href="#features">Features</a>
  &nbsp;·&nbsp;
  <a href="docs/FORMATS.md">80+ formats</a>
  &nbsp;·&nbsp;
  <a href="#building-from-source">Build from source</a>
</p>

<p align="center">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/screenshots/markup-dark.webp">
  <img src="assets/screenshots/markup-light.webp" alt="Glance with a lease agreement open: thumbnails on the left, the markup toolbar on top, a highlighted address and a hand-drawn circle around the date">
</picture>
</p>

Glance brings Preview's everyday superpowers to Windows: rearranging and merging PDF pages by dragging, dragging pages out to create new files, real redaction, markup and signatures, background removal, metadata scrubbing, batch processing, and more. It's built to feel native on Windows 11 (Fluent design, Mica, Explorer integration) while staying small and fast.

> **Status: early preview.** Viewing, PDF page management, markup, signatures, forms, redaction, OCR, image editing, batch editing and metadata tools work today. Everything else is on the roadmap below and in [`docs/adr`](docs/adr).

## A quick tour

<table>
  <tr>
    <td width="50%" valign="top">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/screenshots/pages-dark.webp">
  <img src="assets/screenshots/pages-light.webp" alt="Contact sheet of a 12-page travel PDF with two pages selected">
</picture>
      <h3>Pages you can grab</h3>
      Reorder, rotate, merge and split by dragging thumbnails. Drag pages into another tab to combine documents, or out of the window to make a new PDF.
    </td>
    <td width="50%" valign="top">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/screenshots/redact-dark.webp">
  <img src="assets/screenshots/redact-light.webp" alt="Remove Sensitive Text dialog listing a name, an email address and an ID number to redact">
</picture>
      <h3>Redaction that really removes</h3>
      Remove Sensitive Text finds names, emails, phone, card and ID numbers. Applying it deletes the text underneath, not just covers it.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/screenshots/alpha-dark.webp">
  <img src="assets/screenshots/alpha-light.webp" alt="A mug photo with its background removed by Instant Alpha, shown on a transparency checkerboard">
</picture>
      <h3>Instant Alpha and Remove Background</h3>
      Click to cut a background away (Shift adds, Alt subtracts), or let the bundled AI model find the subject. Everything runs on your PC.
    </td>
    <td width="50%" valign="top">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/screenshots/model-dark.webp">
  <img src="assets/screenshots/model-light.webp" alt="A blue torus knot 3D model in the model viewer">
</picture>
      <h3>3D models too</h3>
      GLB, glTF, OBJ, STL, FBX, USDZ and more: orbit, wireframe, turntable, lighting and materials, with a snapshot when you need a still.
    </td>
  </tr>
</table>

## Why it's light

- **Tauri 2 + WebView2**: the UI runs in the Edge engine already built into Windows 10/11, so Glance doesn't ship its own browser. The installer is about 10 MB.
- **Rust backend**: file access and image decoding run natively. Windows' own codecs come first ([WIC](docs/adr/0010-native-first-decoding.md)), so camera RAW and HEIC work whenever Windows supports them.
- **Lazy engines**: the startup bundle is ~35 KB gzipped. PDF.js loads only when you open a PDF, pdf-lib only when you first edit one, and the 3D engine only for models.

## Features

<sub>Everything below works today unless it says otherwise.</sub>

| | Status |
|---|---|
| Tabs, drag-and-drop to open, Open with / Send to, single instance; menus tailored to each file type | ✅ |
| PDF viewing: continuous, single, two-page; zoom; HiDPI rendering; text selection; links | ✅ |
| Thumbnails, table of contents, contact sheet | ✅ |
| Page management: reorder, rotate, delete, duplicate, insert blank/from file, split, merge, undo/redo | ✅ |
| Drag pages between documents (hover a tab to open it; copy, Shift = move) or out of the window to create a PDF; right-click Copy/Move To | ✅ |
| Search, print, slideshow, dark appearance for PDFs | ✅ |
| Export pages as PDF, PNG, JPEG or TIFF (72-600 ppi) | ✅ |
| Context-aware toolbar (page controls only for multi-page documents), Customize Toolbar | ✅ |
| Rebindable keyboard shortcuts (Windows conventions, Preview's shortcuts mapped, Photoshop-style single-key tools: V, H, Z, M, L, W, B, U, R, O, T, S, C, [ ], Space to pan) | ✅ |
| Formats: PDF, AI, EPS/PS (via Ghostscript), XPS/OXPS, JPEG, PNG, GIF, WebP, AVIF, BMP, ICO, SVG, TIFF, HEIC, JPEG 2000, JPEG XL, JPEG XR, EXR, HDR, TGA, DDS, QOI, PNM, ICNS, PSD, CBZ, camera RAW ([full list](docs/FORMATS.md)); Open With another app for PSD, AI and RAW | ✅ |
| Markup: sketch (shape recognition), draw, rectangle, rounded rectangle, oval, line, arrow, star, polygon, speech bubble, loupe (magnifier), text boxes in any installed font, notes, highlight (any color), underline, strikethrough, squiggly underline | ✅ |
| Markup saved as standard, editable PDF annotations (reopen in Glance to keep editing) | ✅ |
| Signatures: draw with mouse/pen (pressure), capture with the camera, or import a photo; stored encrypted with Windows DPAPI | ✅ |
| Fill in PDF forms | ✅ |
| Certificate signatures (Adobe, DocuSign and others): a banner says whether each is valid, who signed and when, and whether the document changed since; trust comes from the Windows certificate store. Sign with your own certificate or smart card (Markup → Sign with Certificate) | ✅ |
| Redaction that truly removes content (PDF pages rasterized, image areas burned in black; form data, thumbnails, tags and orphaned objects purged); Remove Sensitive Text finds names, emails, phone, card and ID numbers | ✅ |
| Text recognition (Windows OCR): scanned PDFs become searchable and selectable; copy text from images | ✅ |
| Highlights & Notes sidebar, bookmarks | ✅ |
| Remove Background and Copy Subject with a bundled AI model (U²-Net-p, runs locally in Rust) | ✅ |
| Instant Alpha (Shift adds, Alt subtracts); rectangular, elliptical, lasso and smart-lasso selection; crop, delete, invert selection | ✅ |
| Adjust Color (exposure, contrast, highlights, shadows, saturation, temperature, tint, sepia, definition, sharpness, gamma, levels with histogram, Auto Levels) with live preview | ✅ |
| Adjust Size (fit-into presets, units, resolution), rotate and flip | ✅ |
| Straighten: rotate by any angle with a slider or by dragging, grid overlay, crop to fill | ✅ |
| Markup on images, flattened on save; export as PNG, JPEG, WebP, TIFF, BMP or PDF, optionally converted to Display P3, Adobe RGB or Gray | ✅ |
| Inspector (Ctrl+I): EXIF, color profile, PDF properties; Remove Location | ✅ |
| Batch Edit Images: rotate, flip, resize, convert, remove location | ✅ |
| Set an image as the desktop background or lock screen | ✅ |
| Autosave and version history (File → Browse Versions); reopen tabs on launch (optional, in Settings); Clean Up PDF (annotations, links, metadata, attachments, scripts) | ✅ |
| Share (Windows share sheet), Send to, update notifications you can skip or turn off | ✅ |
| 3D models: GLB/glTF, OBJ, STL, PLY, 3MF, DAE, FBX, USDZ, 3DS (orbit, camera views, wireframe, turntable, lighting, backgrounds, clay/normals/X-ray materials, ground shadow, grid, animations, snapshot) | ✅ |
| Create Collage (justified rows or grid) | ✅ |
| Password-protected PDF export (AES-256, permissions), Reduce File Size, New from Clipboard, Import from Scanner | ✅ |
| Page numbers, headers, footers and text or image watermarks on PDFs (Pages → Header, Footer & Watermark, with live preview) | ✅ |
| Touchpad gestures: pinch to zoom smoothly; two-finger orbit and Shift + two-finger pan for 3D models | ✅ |
| Interface follows the Windows display language, with a Language setting (English only so far; translations welcome) | ✅ |
| Explorer right-click menu: Open in Glance, Combine into PDF, Remove Location Info (on Windows 11 under "Show more options") | ✅ |
| Windows 11 top-level context menu (needs a signed build) | Milestone 6 |

Signing on an iPhone or iPad (Preview's Continuity feature) isn't possible on Windows; use the camera or a photo of your signature instead.

Glance deliberately has no quick-look popup: pair it with [PowerToys Peek](https://learn.microsoft.com/windows/powertoys/peek) (Ctrl+Space in Explorer) and press Enter to continue in Glance ([ADR 0011](docs/adr/0011-no-quick-look-pair-with-peek.md)).

## Privacy

No telemetry and no accounts. The only network request is an optional daily check for a newer release on GitHub (turn it off in Settings; the Microsoft Store version leaves updates to the Store). Background removal and text recognition run on your PC.

## Building from source

Requirements: Node.js 22+, Rust (stable), and on Windows the WebView2 runtime (preinstalled on Windows 10/11).

```sh
npm install
npm run tauri dev        # run with hot reload
npm run tauri build      # produce the NSIS installer in src-tauri/target/release/bundle/nsis
npm test                 # frontend unit tests
cd src-tauri && cargo test   # decoder tests (WIC tests run on Windows)
```

Every pull request builds a Windows installer in CI (see the `glance-windows-x64-installer` artifact).

## Project layout

```
src/                 Preact UI
  core/              Pure logic (page operations, shortcuts, page-control rules), unit tested
  pdf/               PDF.js integration: rendering, thumbnails, search
  state/             Documents, commands registry, actions, settings
  ui/                Components (toolbar, sidebar, views, dialogs)
  i18n/              Translations: t(), language choice, locales/*.json
  platform/          Bridge to the Rust backend (with a browser fallback for UI testing)
src-tauri/           Rust backend
  src/decode/        Image decoding: WIC, JPEG 2000, JPEG XL, PSD, ICNS, RAW previews, EPS, CBZ
  src/protocol.rs    glance:// scheme serving files and decoded images to the UI
packaging/           winget manifests and the Microsoft Store (MSIX) package and listing
docs/adr/            Architecture decision records
CONTEXT.md           Domain glossary
```

## Contributing

Issues and pull requests are welcome. Please read [`CONTEXT.md`](CONTEXT.md) for the project's vocabulary and [`docs/adr`](docs/adr) for the decisions behind the design.

**Translations.** Write every piece of UI text through `t()` from `src/i18n` (see the comment at the top of `src/i18n/index.ts`), in English, with placeholders instead of string concatenation: `t('Exported {file}', { file })`, `t('{count, plural, one {# page} other {# pages}}', { count })`. Text defined outside components, such as command labels, is marked with `msg()` and passed through `t()` where it's shown. `npm test` fails on UI text that skips `t()`, and `npm run i18n` lists it. To add or update a language, run `npm run i18n -- <code>` (for example `de` or `pt-BR`) and fill in `src/i18n/locales/<code>.json`. To check layout with longer text, pick the pseudo-locale in Settings → Language (shown in dev builds).

## License

[Apache-2.0](LICENSE). Glance never bundles GPL/AGPL components. Ghostscript, used for PostScript, is run as a separate program only if you install it.
