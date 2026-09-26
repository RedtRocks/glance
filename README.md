<p align="center"><img src="assets/icon.svg" width="96" alt=""></p>

# Glance

**A free, open-source, lightweight viewer and editor for PDFs, images, camera RAW and 3D models on Windows, inspired by macOS Preview.**

Glance brings Preview's everyday superpowers to Windows: rearranging and merging PDF pages by dragging, dragging pages out to create new files, real redaction, markup and signatures, background removal, metadata scrubbing, batch processing, and more. It's built to feel native on Windows 11 (Fluent design, Mica, Explorer integration) while staying small and fast.

> **Status: early development (Milestone 2).** Viewing, PDF page management, markup, signatures, forms and redaction work today. Everything else is on the roadmap below and in [`docs/adr`](docs/adr).

## Why it's light

- **Tauri 2 + WebView2**: the UI runs in the Edge engine already built into Windows 10/11, so Glance doesn't ship its own browser. The installer is about 10 MB.
- **Rust backend**: file access and image decoding run natively. Windows' own codecs come first ([WIC](docs/adr/0010-native-first-decoding.md)), so camera RAW and HEIC work whenever Windows supports them.
- **Lazy engines**: the startup bundle is ~35 KB gzipped. PDF.js loads only when you open a PDF, pdf-lib only when you first edit one, and the 3D engine only for models.

## Features

| | Status |
|---|---|
| Tabs, drag-and-drop to open, Open with / Send to, single instance | ✅ |
| PDF viewing: continuous, single, two-page; zoom; HiDPI rendering; text selection; links | ✅ |
| Thumbnails, table of contents, contact sheet | ✅ |
| Page management: reorder, rotate, delete, insert blank/from file, undo/redo | ✅ |
| Drag pages between documents (copy; Shift = move), onto tabs, or out of the window to create a PDF | ✅ |
| Search, print, slideshow, dark appearance for PDFs | ✅ |
| Context-aware toolbar (page controls only for multi-page documents), Customize Toolbar | ✅ |
| Rebindable keyboard shortcuts (Windows conventions, Preview's shortcuts mapped) | ✅ |
| Formats: PDF, AI, EPS/PS (via Ghostscript), JPEG, PNG, GIF, WebP, AVIF, BMP, ICO, SVG, TIFF, HEIC, JPEG 2000, JPEG XL, JPEG XR, EXR, HDR, TGA, DDS, QOI, PNM, ICNS, PSD, CBZ, camera RAW ([full list](docs/FORMATS.md)) | ✅ (XPS and 3D coming) |
| Markup: sketch (shape recognition), draw, rectangle, rounded rectangle, oval, line, arrow, star, polygon, speech bubble, text boxes, notes, highlight/underline/strikethrough; move, resize, restyle, undo | ✅ |
| Markup saved as standard, editable PDF annotations (reopen in Glance to keep editing) | ✅ |
| Signatures: draw with mouse/pen (pressure) or import a photo; stored encrypted with Windows DPAPI | ✅ |
| Fill in PDF forms | ✅ |
| Redaction that truly removes content (pages rasterized; form data, thumbnails, tags and orphaned objects purged) | ✅ |
| Highlights & Notes sidebar, bookmarks | ✅ |
| Instant Alpha, Remove Background / Copy Subject (bundled AI model), Adjust Color/Size, crop | Milestone 3 |
| Inspector: metadata and GPS removal, annotation/link cleanup; autosave and version history | Milestone 4 |
| 3D models, collage, batch processing, text recognition (Windows OCR) | Milestone 5 |
| Windows 11 context menu, Share, installer polish, update notifications | Milestone 6 |

Glance deliberately has no quick-look popup: pair it with [PowerToys Peek](https://learn.microsoft.com/windows/powertoys/peek) (Ctrl+Space in Explorer) and press Enter to continue in Glance ([ADR 0011](docs/adr/0011-no-quick-look-pair-with-peek.md)).

## Privacy

No telemetry, no accounts, no network access except an optional update check (coming in Milestone 6).

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
  platform/          Bridge to the Rust backend (with a browser fallback for UI testing)
src-tauri/           Rust backend
  src/decode/        Image decoding: WIC, JPEG 2000, JPEG XL, PSD, ICNS, RAW previews, EPS, CBZ
  src/protocol.rs    glance:// scheme serving files and decoded images to the UI
docs/adr/            Architecture decision records
CONTEXT.md           Domain glossary
```

## Contributing

Issues and pull requests are welcome. Please read [`CONTEXT.md`](CONTEXT.md) for the project's vocabulary and [`docs/adr`](docs/adr) for the decisions behind the design.

## License

[Apache-2.0](LICENSE). Glance never bundles GPL/AGPL components. Ghostscript, used for PostScript, is run as a separate program only if you install it.
