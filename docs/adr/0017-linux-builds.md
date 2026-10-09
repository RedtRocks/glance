# Ship Linux as RPM and .deb packages

Glance is built for Windows first, but most of it (PDF.js, the Rust decoders, three.js, the MCP bridge) runs anywhere Tauri does. Linux users asked for it, and an RPM built in CI is cheap to keep working.

We build an RPM for Fedora 42+ (x86_64 and aarch64) in a Fedora container on GitHub's runners. `src-tauri/tauri.linux.conf.json` sets the bundle target, installs `glance-mcp` next to `glance` in `/usr/bin`, and supplies a desktop file whose `MimeType=` line lists real MIME types for the file associations. Formats with no registered type (PLY, FBX, USDC) are left out rather than claiming `application/octet-stream`. A .deb for Ubuntu 22.04+ and Debian 12+ (amd64 and arm64) is built in an `ubuntu:22.04` container, so it links against glibc 2.35, and uses the same desktop file and `glance-mcp`.

## Consequences
- Windows-only features (Windows OCR, scanning, CryptoAPI certificate signatures, Open With and default apps, wallpaper, share sheet, speech, XPS, JPEG XR) are hidden on Linux; WIC decoding falls back to the Rust and WebAssembly decoders.
- Secrets (saved signatures, AI API keys) go to the login keyring through the Secret Service instead of DPAPI and Credential Manager.
- The MCP endpoint lives in `$XDG_RUNTIME_DIR/glance` (or `$XDG_STATE_HOME/glance`), readable only by the user. Flatpak uses `$XDG_RUNTIME_DIR/app/$FLATPAK_ID/glance` so separate sandboxes share the endpoint.
- Flatpak covers distributions outside the RPM and .deb targets; AppImage is deliberately excluded.
- PDF.js needs `ReadableStream` async iteration, which WebKitGTK only has from 2.52; `src/pdf/engine.ts` polyfills it for Ubuntu 22.04 and Debian 12.

## Flatpak, not AppImage

Ship a source-built, offline Flatpak manifest for Flathub and x86_64/aarch64 `.flatpak` bundles on every GitHub release. Flathub submission needs the owner's verification of `io.github.redtrocks`.

Tauri's AppImage bundles libwayland, libxkbcommon and libxcb; its open issue reports `EGL_BAD_PARAMETER` aborts on newer Mesa (for example Fedora 44), with blank windows also reported. The `glance-mcp` path inside an AppImage mount also changes on every launch, so AI apps cannot keep a stable command.

Flatpak does not support PostScript: Ghostscript is AGPL and Glance never bundles it. Use the .deb or RPM for PostScript. Ask AI agents run on the host through `flatpak-spawn --host`, using the user's programs rather than sandbox copies.

