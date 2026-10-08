# AGENTS.md

Instructions for AI coding agents (Claude Code, Codex, Cursor, Copilot and others) working in this repository. Human contributors: the same rules, with more explanation, are in [`CONTRIBUTING.md`](CONTRIBUTING.md).

## What this is

Glance is a free, open-source (Apache-2.0) Apple Preview alternative for Windows: a viewer and light editor for PDFs, images (HEIC, camera RAW, PSD), 3D models and Office files. It is a Tauri 2 app: a Preact + TypeScript UI in WebView2 and a Rust backend. The same UI also ships as a browser app and as Linux `.deb` and `.rpm` packages. Windows is the main platform.

Read before changing behaviour:

- [`CONTEXT.md`](CONTEXT.md): domain vocabulary. Use its terms in code, UI text and docs, and avoid the words it lists under _Avoid_.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): the pieces and where things live.
- [`docs/adr/`](docs/adr): decisions already made. Don't silently reverse one; write a new ADR if a change needs to.

## Commands

```sh
npm ci                         # install (Node 22+)
npm run typecheck              # tsc --noEmit
npm test                       # Vitest: tests/*.test.ts and the translation check (about 10 s)
npm run build                  # typecheck + vite build into dist/
npm run i18n                   # list UI text that skips t()
npm run i18n -- <code>         # create or update src/i18n/locales/<code>.json
cd src-tauri && cargo test     # Rust tests; needs dist/index.html (run npm run build, or create a stub)
cd src-tauri/mcp-bridge && cargo test
node scripts/build-web.mjs     # browser version into dist-web/ (needs the wasm32-unknown-unknown target)
npm run tauri dev              # run the desktop app (needs a display)
```

On Linux, `cargo test` in `src-tauri` needs `libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libxdo-dev`. Windows-only Rust tests (WIC, OCR, shell) are behind `#[cfg(windows)]` and only run in CI's Windows job.

Before you call a change done, run at least `npm run typecheck` and `npm test`, plus `cargo test` if you touched Rust.

## Map

```
src/core/        pure logic, no DOM or backend; unit tested in tests/
src/core/mcp/    MCP protocol and the AI tools' definitions (tools.json)
src/state/       app state (Preact signals), the command registry, actions
src/ui/          components: views/, dialogs/, sidebar/, markup/, image/, ai/
src/pdf/         PDF.js rendering, thumbnails, search (lazy loaded)
src/image/       image editing engine and its worker
src/model/       three.js 3D viewer (lazy loaded)
src/preview/     read-only HTML previews: Office, text, Markdown, EPUB, email, fonts, media
src/platform/    the only bridge to Rust; browser fallbacks for the web version
src/i18n/        t(), msg(), locales/*.json
src-tauri/src/   Rust backend: commands, glance:// protocol, decoders, OCR, signatures, AI apps
src-tauri/mcp-bridge/   glance-mcp, the MCP server AI apps start (relays to Glance)
src-tauri/thumbnailer/  Explorer thumbnail handler DLL (Windows)
src-tauri/context-menu/ Windows 11 right-click menu DLL (Store package only)
web/             browser-version extras: WebAssembly decoders, service worker
site/            the website (plain HTML, no build step)
packaging/       winget and Microsoft Store (MSIX) packaging
tests/           Vitest tests and fixtures
```

## Rules

1. **All UI text goes through `t()`** from `src/i18n`, in English, with `{placeholders}` and ICU plurals, never concatenation: `t('Exported {file}', { file })`. Module-level text (command labels) uses `msg()` and is passed through `t()` where shown. `tests/i18n-source.test.ts` fails otherwise. Put `// i18n-ignore` on (or above) a line only when the string is genuinely not UI text. After changing UI text, if `src/i18n/locales/` has catalogs, run `npm run i18n -- <code>` for each so no catalog keeps unused messages.
2. **Commands go in `src/state/commands.ts`.** Menus, toolbar, shortcuts and the shortcut editor read from that one registry.
3. **OS access only through `src/platform/index.ts`.** Never import `@tauri-apps/api` from UI code. New Rust commands are registered in `generate_handler!` in `src-tauri/src/lib.rs` and, where possible, get a browser fallback in `src/platform`.
4. **Keep Linux and the browser version building.** Gate Windows-only Rust with `#[cfg(windows)]`, and hide Windows-only UI with `isWindows` / `isTauri` / `isWeb` from `src/platform`. CI builds and installs the Linux `.rpm` and `.deb` and builds the web version on every code change; those jobs must stay green.
5. **Pure logic in `src/core` with a test.** New behaviour that can be tested without the DOM gets a `tests/<name>.test.ts`. Fix the code, never weaken, skip or delete a failing test to get green.
6. **Lazy-load heavy engines.** PDF.js, pdf-lib, three.js and the preview libraries load only when a file needs them (`src/state/pdfModules.ts`, dynamic `import()`). Don't import them statically from the startup path.
7. **No GPL or AGPL dependencies.** Permissive licences only. Ask before adding any dependency.
8. **Nothing leaves the device.** No new network requests, telemetry or remote content without the maintainer's agreement; anything added must be in `PRIVACY.md` and the CSP in `src-tauri/tauri.conf.json`. Previews of user files must not fetch from the web (see `src/preview/sanitize.ts`).
9. **Match the surrounding style.** No formatter runs in CI. TypeScript: no semicolons, single quotes, two-space indent. Comments are short and explain why. Use the vocabulary in `CONTEXT.md`.
10. **User-facing docs move with the code.** If you add or change a feature users will notice, update the README feature table or `docs/FORMATS.md` / `docs/AI-APPS.md` as needed, and add a bullet under the top `## New in <version>` section of `CHANGELOG.md` (plain language, written for users). Each release page shows only its own version's section; `scripts/release-notes.ts` builds it.

## Don'ts

- Don't bump the version, tag, or run the Release workflow unless the maintainer asks. Releases are cut by the maintainer once all in-progress work has merged. When asked, the version lives in `package.json`, `package-lock.json` (two fields at the top), `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and `src-tauri/Cargo.lock`; the Release workflow fails if the tag doesn't match or `CHANGELOG.md` lacks `## New in <version>`.
- Don't hand-edit generated files: `package-lock.json` and `Cargo.lock` (use npm and cargo), the per-format site pages under `site/*-viewer/` and `site/sitemap.xml` (regenerate with `node scripts/build-format-pages.mjs`), and `packaging/` manifests produced by `scripts/packaging.ts`.
- Don't change `.github/workflows/` to make a check pass; fix the cause.
- Don't commit build output (`dist/`, `dist-web/`, `src-tauri/target/`).

## CI

Every pull request runs: Frontend (typecheck, tests, build), Web version, Windows (Rust tests, NSIS installer, Store MSIX), Windows ARM64 (check), Rust tests on Linux, Linux RPM and Linux .deb. Changes that only touch `**/*.md`, `assets/`, `site/`, `.github/ISSUE_TEMPLATE/` or `LICENSE` skip the build and test jobs. The Windows job takes the longest (up to an hour on a cold cache), so docs-only changes are worth keeping separate.

## Pull requests

One change per pull request, branched from `main`. Fill in `.github/pull_request_template.md`: what a user sees before and after, how it was tested, and screenshots in light and dark mode for UI changes.
