# Architecture

A map of how Glance is put together, for anyone about to change it. The reasons behind each choice are in the [ADRs](adr/); the vocabulary is in [`CONTEXT.md`](../CONTEXT.md).

## The big picture

Glance is a [Tauri 2](https://tauri.app) app ([ADR 0001](adr/0001-tauri-webview2.md)):

- **The UI** is Preact + TypeScript, built by Vite, running in the system web view (WebView2 on Windows, WebKitGTK on Linux). Nearly all document logic lives here: PDF rendering and editing, markup, image editing, 3D, previews, the AI tools.
- **The Rust backend** (`src-tauri/`) does what a web page can't: reading and writing files, decoding image formats the web view can't, Windows integration (OCR, scanning, certificate signatures, shell, speech), version history, and talking to AI apps and agents.
- **Helper binaries** built alongside the app: `glance-mcp` (the MCP server AI apps start), the Explorer thumbnail DLL and the Windows 11 context-menu DLL.

The same UI also ships as a browser app (`web/`), where `src/platform` swaps the backend for browser APIs and WebAssembly builds of the Rust decoders.

```
           ┌──────────────── web view ─────────────────┐
 user ───▶ │ src/ui ─▶ src/state ─▶ src/core (pure)    │
           │               │                           │
           │               ▼                           │
           │         src/platform ──── browser fallback│──▶ web/ (WASM decoders, service worker)
           └───────────────┼───────────────────────────┘
                 invoke()  │   glance:// URLs
           ┌───────────────▼───────────────────────────┐
           │ src-tauri/src: commands, protocol.rs,     │
           │ decode/, ocr, certsig, history, mcp/, ... │
           └───────────────▲───────────────────────────┘
                           │ loopback
           AI apps ─▶ glance-mcp (src-tauri/mcp-bridge)
```

## The UI (`src/`)

| Folder | What's there |
|---|---|
| `main.tsx`, `ui/App.tsx` | Start-up and the window: tab strip, toolbar, sidebar, and one view per document kind |
| `state/` | App state as Preact signals. `documents.ts` (open documents), `commands.ts` (every user command: menus, toolbar and shortcuts read from it), `actions.ts` (operations shared by commands and drag-and-drop), `settings.ts`, plus one file per feature (autosave, versions, AI, MCP tools, OCR, batch, …) |
| `core/` | Pure logic with no DOM or backend: page operations, shortcuts, redaction, markup geometry, text layout, version comparison, MCP protocol. This is what `tests/` covers |
| `ui/` | Components. `views/` has one view per document kind (`PdfView`, `ImageView`, `ModelView`, `PreviewView`, …); `dialogs/`, `sidebar/`, `markup/`, `image/` and `ai/` hold the rest |
| `pdf/` | PDF.js integration: rendering, thumbnails, text layer, search |
| `image/` | Image editing: pixel operations in a worker, Instant Alpha, recompression |
| `model/` | The three.js 3D viewer |
| `preview/` | Read-only HTML previews: Word, PowerPoint, Excel, CSV, text and code, Markdown, EPUB, email, fonts, video and audio |
| `platform/` | The only bridge to the backend (see below) |
| `i18n/` | `t()`, `msg()` and the translation catalogs ([ADR 0012](adr/0012-english-text-as-translation-key.md)) |
| `styles/` | CSS: Fluent for the desktop app, the website's look (`web.css`) for the browser version |

**Start-up stays small.** Heavy engines are loaded with dynamic `import()` the first time a document needs them: PDF.js when a PDF opens, pdf-lib on the first PDF edit (`state/pdfModules.ts`), three.js for models, the preview libraries for Office files. Keep new heavy code off the start-up path.

### Opening a file

1. `actions.ts` calls `platform.probe(path)`. The backend (`commands::probe`, with the extension tables in `decode/formats.rs`) returns a `kind`: `pdf`, `image`, `model`, `postscript`, `xps`, `archive`, `preview` or `unsupported`.
2. A document object is created for that kind (`PdfDoc`, `ImageDoc`, `ModelDoc`, `PreviewDoc`) and added to `documents`. PostScript and EPS are converted to PDF through Ghostscript if it is installed; XPS pages and comic archives open as multi-page images.
3. `App.tsx` renders the view for the document's kind. File bytes and decoded pixels are fetched through `glance://` URLs, not through JSON IPC.

### Editing and saving

- **PDF markup** is stored as standard PDF annotations, so it stays editable in Glance and visible elsewhere ([ADR 0003](adr/0003-markup-as-pdf-annotations.md)). Page operations and markup are applied with pdf-lib.
- **Redaction** rasterizes affected PDF pages and burns image areas in, then purges hidden data ([ADR 0005](adr/0005-redaction-by-rasterization.md)).
- **Autosave** writes edited documents in place once edits stop ([ADR 0004](adr/0004-autosave-with-explicit-save.md), [ADR 0008](adr/0008-pdf-incremental-autosave.md)), and every save becomes a **version** in a content-addressed store kept by `src-tauri/src/history.rs` ([ADR 0006](adr/0006-full-version-history.md)).

## The platform bridge (`src/platform/`)

UI code never calls Tauri directly. `platform/index.ts` exposes functions like `probe`, `readFile` and `writeFile`; in the desktop app they `invoke()` Rust commands, and in a plain browser they fall back to in-memory files and WebAssembly decoders (`webDecode.ts`, `heif.ts`). It also exports `isTauri`, `isWeb` and `isWindows`, which the UI uses to hide features a platform lacks.

To add an OS feature: write the Rust command, register it in `generate_handler!` in `src-tauri/src/lib.rs`, add a wrapper in `platform/index.ts` with a browser fallback or a clear "not available" path, and allow it in `src-tauri/capabilities/` if it needs a plugin permission.

## The backend (`src-tauri/`)

| File or folder | What it does |
|---|---|
| `src/lib.rs` | App setup, plugins, single instance, the command list |
| `src/commands.rs`, `files.rs` | File probing, reading, writing, temp files |
| `src/protocol.rs` | The `glance://` scheme: raw file bytes (`/file`) and decoded images (`/decode`) straight to the web view |
| `src/decode/` | Image decoding, Windows Imaging Component first, then Rust decoders ([ADR 0010](adr/0010-native-first-decoding.md)): PSD, RAW previews, EPS, XPS, archives, and `formats.rs`, the list of extensions per kind |
| `src/encode.rs`, `color.rs`, `metadata.rs` | Export, colour conversion, EXIF and location removal |
| `src/ocr.rs` | Text recognition with Windows' built-in OCR ([ADR 0007](adr/0007-windows-ocr.md)) |
| `src/subject.rs` | Remove Background: the bundled U²-Net-p model run with tract ([ADR 0002](adr/0002-bundled-subject-model.md)) |
| `src/certsig.rs` | Certificate signatures through Windows CryptoAPI ([ADR 0013](adr/0013-certificate-signatures-with-windows-cryptoapi.md)) |
| `src/signatures.rs`, `keyring_store.rs` | Saved handwritten signatures and AI API keys: DPAPI and Credential Manager on Windows, the login keyring on Linux |
| `src/history.rs` | Version history |
| `src/shell.rs`, `explorer.rs` | Default apps, Open With, Explorer integration ([ADR 0009](adr/0009-windows-shell-integration.md)) |
| `src/mcp/` | AI apps: the loopback listener `glance-mcp` connects to, and Settings → AI apps |
| `src/agents.rs`, `website.rs` | Ask AI sidebar: starting the AI companies' agents (Agent Client Protocol) and showing their websites |
| `src/speech.rs`, `scan.rs`, `fonts.rs` | Voice input, scanners, installed fonts |
| `mcp-bridge/` | `glance-mcp`, a small binary AI apps launch; it relays MCP messages to Glance |
| `thumbnailer/` | The Explorer thumbnail handler DLL for formats Windows can't preview |
| `context-menu/` | The Windows 11 top-level context-menu DLL, used only by the Store (MSIX) package |
| `tauri.conf.json`, `tauri.linux.conf.json` | App config: version, CSP, file associations, bundles |
| `capabilities/` | Tauri permissions for the main window |

Windows-only code is behind `#[cfg(windows)]`; Linux gets fallbacks or hides the feature ([ADR 0017](adr/0017-linux-builds.md)).

## AI

There are two separate AI features:

- **AI apps use Glance as a tool** ([ADR 0014](adr/0014-ai-apps-through-mcp.md), [`AI-APPS.md`](AI-APPS.md)). An AI app starts `glance-mcp`, which connects to Glance over loopback; `src-tauri/src/mcp` relays JSON-RPC to the web view, where `src/core/mcp/protocol.ts` handles MCP and `src/state/mcpTools.ts` implements the tools declared in `src/core/mcp/tools.json`. Tools run in the same code as the UI, so they open, convert and redact exactly as the app does.
- **The Ask AI sidebar** chats with the AI companies' own agents. `src-tauri/src/agents.rs` starts them; `src/state/ai.ts` speaks the Agent Client Protocol and hands each session Glance's tools. Text edits the AI asks for become ordinary markup the user can keep or undo ([ADR 0015](adr/0015-ai-edits-as-matching-markup.md)).

## Outside the app

| Folder | What it is |
|---|---|
| `web/` | The browser version: Rust decoders compiled to WebAssembly (`web/decoder`) and the offline service worker. Built by `scripts/build-web.mjs` |
| `site/` | The website at redtrocks.github.io/glance, plain HTML. Per-format pages are generated by `scripts/build-format-pages.mjs` |
| `packaging/` | winget manifests and the Microsoft Store MSIX, generated from `tauri.conf.json` by `scripts/packaging.ts` |
| `scripts/` | Build and maintenance scripts: i18n extraction, web build, site pages, packaging, IndexNow |
| `tests/` | Vitest tests, with fixtures in `images/`, `models/`, `office/` and `signatures/` |
| `.github/workflows/` | `ci.yml` (every pull request), `release.yml` (installers, Linux packages, GitHub release), `release-notes.yml` (rewrites published release pages), `winget.yml`, `store.yml`, `pages.yml` (website and web app) |
