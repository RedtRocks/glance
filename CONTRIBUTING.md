# Contributing to Glance

Thanks for helping. Bug reports, ideas, translations and pull requests are all welcome. This page covers setting up, the conventions the tests enforce, and how a change gets merged. If you are a coding agent (Claude Code, Codex, Cursor and the like), read [`AGENTS.md`](AGENTS.md) too: it is the same rules in a checklist.

Before a large change, skim:

- [`CONTEXT.md`](CONTEXT.md): the project's vocabulary. Use these words in code, UI text and docs ("markup", not "annotation"; "redaction", not "blackout").
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): how the pieces fit together and where things live.
- [`docs/adr`](docs/adr): the decisions behind the design. A change that goes against one needs a new ADR that replaces it.

## Reporting bugs and asking for features

Open an [issue](https://github.com/RedtRocks/glance/issues/new/choose). For a bug, say which version (Help → About Glance), Windows or Linux, installer or Microsoft Store, the file type, and the steps. If it only happens with one file and you can share it, attach it. Users without a GitHub account can use **Help → Send Feedback** in the app.

Security problems: please don't open a public issue. Report them privately with **Help → Send Feedback**, which emails the maintainer, or through the [Security tab](https://github.com/RedtRocks/glance/security) if private reporting is offered there.

## Setting up

You need Node.js 22+ and Rust (stable). On Windows, WebView2 is already installed on Windows 10 and 11. On Linux, install the Tauri prerequisites first:

```sh
# Ubuntu / Debian
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libxdo-dev
# Fedora
sudo dnf install gcc gcc-c++ clang webkit2gtk4.1-devel openssl-devel librsvg2-devel libxdo-devel
```

Then:

```sh
npm install
npm run tauri dev      # the desktop app with hot reload
npm run dev            # the UI alone in a browser at http://localhost:1420 (no Rust needed)
```

The UI runs in a plain browser too: everything that needs the OS goes through `src/platform`, which falls back to browser APIs. That is the quickest loop for UI work, but check OS features (files, decoding, OCR, AI apps) in the desktop app.

## Checks to run before a pull request

```sh
npm run typecheck                  # TypeScript
npm test                           # Vitest: unit tests in tests/, plus the translation check
npm run build                      # typecheck + production bundle
cd src-tauri && cargo test         # Rust tests (WIC and other Windows tests run only on Windows)
cd src-tauri/mcp-bridge && cargo test       # glance-mcp, if you touched it
cd src-tauri/thumbnailer && cargo test      # Explorer thumbnails (Windows), if you touched them
```

`cargo test` in `src-tauri` needs a `dist/` folder; run `npm run build` once, or create `dist/index.html` with any content. For the browser version, `node scripts/build-web.mjs` builds `dist-web/` (it needs `rustup target add wasm32-unknown-unknown`); see [`web/README.md`](web/README.md).

There is no formatter or linter in CI. Match the style of the file you are editing: TypeScript without semicolons and with single quotes, short doc comments that say why.

## Conventions the tests enforce

### All UI text goes through `t()`

Every piece of text a user can see is written in English and passed through `t()` from `src/i18n`, with placeholders instead of string concatenation:

```ts
t('Save changes automatically')
t('Exported {file}', { file: name })
t('{count, plural, one {# page} other {# pages}}', { count })
```

Text defined outside a component (command labels, menu names) is marked with `msg()` so the tooling finds it, and passed through `t()` where it is shown. The English text is the key ([ADR 0012](docs/adr/0012-english-text-as-translation-key.md)).

`tests/i18n-source.test.ts` fails on UI text that skips `t()`, and on `t()` calls with anything other than a plain string. `npm run i18n` lists offenders. For text that really isn't UI (a file extension, a log line), put `// i18n-ignore` on that line or the line above.

**Adding a language:** run `npm run i18n -- <code>` (for example `de` or `pt-BR`) and fill in `src/i18n/locales/<code>.json`. Run the same command again after UI text changes to add new messages and drop unused ones; the tests fail if a catalog keeps messages the app no longer uses or loses a placeholder. To check layout with longer text, pick the pseudo-locale in Settings → Language (dev builds only).

### Commands live in one registry

Menu items, toolbar buttons, keyboard shortcuts and the shortcut editor all read from `src/state/commands.ts`. Add a new action there once rather than wiring a button directly. Default shortcuts follow Windows conventions first (see `src/core/shortcuts.ts`).

### Pure logic in `src/core`, tested in `tests/`

Anything that can be written without the DOM or the backend (page operations, parsing, layout maths) goes in `src/core` and gets a Vitest test in `tests/<name>.test.ts`. UI components stay thin.

### OS access only through `src/platform`

UI code never calls Tauri directly. Add a function to `src/platform/index.ts` that invokes the Rust command and, where possible, falls back to a browser API so the web version keeps working. On the Rust side, register the command in `src-tauri/src/lib.rs` (`generate_handler!`).

### Windows first, Linux and the browser kept working

Windows is the main platform, but CI also builds the browser version and Linux `.rpm` and `.deb` packages, and all of them must stay green. Windows-only features (OCR, scanning, certificate signatures, shell integration, speech) are hidden on Linux and in the browser rather than failing; check `isWindows`, `isTauri` or `isWeb` from `src/platform`, and use `#[cfg(windows)]` in Rust. See [ADR 0017](docs/adr/0017-linux-builds.md).

### Licences

Glance is Apache-2.0 and never bundles GPL or AGPL code. New dependencies must be permissively licensed (MIT, Apache-2.0, BSD, ISC, zlib and similar). LGPL is acceptable only when loaded as a separate, replaceable module, as libheif is in the browser version.

### Privacy

Nothing a user opens leaves their device. Don't add network calls, telemetry or remote content without discussing it in an issue first; `PRIVACY.md` and the content-security policy in `src-tauri/tauri.conf.json` must describe anything that is added.

## Common tasks

- **A new file format:** detection and decoding in `src-tauri/src/decode/` (`formats.rs` lists extensions), read-only HTML previews in `src/preview/` with their extensions in `src/core/previews.ts` (kept in sync with `PREVIEWS` in `formats.rs`), file associations in `src-tauri/tauri.conf.json` and `src-tauri/linux/glance.desktop`, then a row in [`docs/FORMATS.md`](docs/FORMATS.md).
- **A new AI tool for AI apps:** the definition goes in `src/core/mcp/tools.json` and the implementation in `src/state/mcpTools.ts`; see [`docs/AI-APPS.md`](docs/AI-APPS.md).
- **A new setting:** `src/state/settings.ts`, shown in `src/ui/dialogs/SettingsDialog.tsx`.
- **A design decision:** add `docs/adr/NNNN-short-title.md` with the next number (see [`docs/adr/README.md`](docs/adr/README.md)).
- **The website:** plain HTML in `site/`, see [`site/README.md`](site/README.md).

## Pull requests

1. Fork the repository and branch from `main`.
2. Keep one change per pull request, with a test for new logic.
3. Run the checks above.
4. If the change is something users will notice, add a line to the top section of [`CHANGELOG.md`](CHANGELOG.md) (see below). Update the README's feature table or `docs/` if they describe what you changed.
5. Open the pull request and fill in the template. Screenshots in light and dark mode help for UI changes.

CI runs on every pull request:

| Job | What it checks |
|---|---|
| Frontend | `npm ci`, typecheck, `npm test`, production build |
| Web version | The WebAssembly decoders and the offline browser build |
| Windows | Rust tests (WIC included), the NSIS installer, Default apps registration, the Store MSIX package and AI apps through it |
| Windows ARM64 | `cargo check` for ARM64 |
| Rust tests (Linux) | `cargo test` on Ubuntu |
| Linux RPM / Linux .deb | Builds and installs the packages on Fedora 42 and Ubuntu 22.04, then smoke-tests the AI tools |

Pull requests that only touch Markdown, `assets/`, `site/`, issue templates or `LICENSE` skip the build and test jobs (a skipped job counts as passed). Every pull request's Windows installer is attached to its CI run as the `glance-windows-x64-installer` artifact, so reviewers can try it.

## Releases (maintainers)

Release notes live in [`CHANGELOG.md`](CHANGELOG.md), newest first, under `## New in <version>` headings, written for users rather than developers. The Release workflow fails unless it has a section for the tag being released. Each release page shows only that section, under a download table for the files attached, with install help folded away and a link to the changelog for earlier versions (`scripts/release-notes.ts`). After fixing an earlier version's notes, run **Actions → Release notes** with its tag (or `all`) to rewrite its page.

To release:

1. Bump the version in `package.json`, `package-lock.json` (both `version` fields at the top), `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and `src-tauri/Cargo.lock` (the `glance` package). The Release workflow fails if the tag doesn't match `tauri.conf.json`.
2. Make sure the notes have `## New in <version>`.
3. Merge to `main`, then run **Actions → Release** with the tag (`v0.7.0`).

The workflow builds the x64 and ARM64 Windows installers and the Linux packages, publishes the GitHub release with one `SHA256SUMS.txt` for every file, submits to winget, and builds the Microsoft Store bundle (uploaded by hand in Partner Center). See [`packaging/README.md`](packaging/README.md).

## Licence of contributions

By contributing you agree that your work is released under the [Apache-2.0 licence](LICENSE), like the rest of Glance.
