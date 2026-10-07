# Ship Linux as RPM and .deb packages

Glance is built for Windows first, but most of it (PDF.js, the Rust decoders, three.js, the MCP bridge) runs anywhere Tauri does. Linux users asked for it, and an RPM built in CI is cheap to keep working.

We build an RPM for Fedora 42+ (x86_64 and aarch64) in a Fedora container on GitHub's runners. `src-tauri/tauri.linux.conf.json` sets the bundle target, installs `glance-mcp` next to `glance` in `/usr/bin`, and supplies a desktop file whose `MimeType=` line lists real MIME types for the file associations. Formats with no registered type (PLY, FBX, USDC) are left out rather than claiming `application/octet-stream`. A .deb for Ubuntu 22.04+ and Debian 12+ (amd64 and arm64) is built in an `ubuntu:22.04` container, so it links against glibc 2.35, and uses the same desktop file and `glance-mcp`.

## Consequences
- Windows-only features (Windows OCR, scanning, CryptoAPI certificate signatures, Open With and default apps, wallpaper, share sheet, speech, XPS, JPEG XR) are hidden on Linux; WIC decoding falls back to the Rust and WebAssembly decoders.
- Secrets (saved signatures, AI API keys) go to the login keyring through the Secret Service instead of DPAPI and Credential Manager.
- The MCP endpoint lives in `$XDG_RUNTIME_DIR/glance` (or `$XDG_STATE_HOME/glance`), readable only by the user.
- No AppImage or Flatpak yet; add one when someone needs it.
- PDF.js needs `ReadableStream` async iteration, which WebKitGTK only has from 2.52; `src/pdf/engine.ts` polyfills it for Ubuntu 22.04 and Debian 12.
