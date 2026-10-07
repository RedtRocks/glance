# Ship Linux as a Fedora RPM

Glance is built for Windows first, but most of it (PDF.js, the Rust decoders, three.js, the MCP bridge) runs anywhere Tauri does. Linux users asked for it, and an RPM built in CI is cheap to keep working.

We build one package format, RPM for Fedora 42+ (x86_64 and aarch64), in a Fedora container on GitHub's runners. `src-tauri/tauri.linux.conf.json` sets the bundle target, installs `glance-mcp` next to `glance` in `/usr/bin`, and supplies a desktop file whose `MimeType=` line lists real MIME types for the file associations. Formats with no registered type (PLY, FBX, USDC) are left out rather than claiming `application/octet-stream`.

## Consequences
- Windows-only features (Windows OCR, scanning, CryptoAPI certificate signatures, Open With and default apps, wallpaper, share sheet, speech, XPS, JPEG XR) are hidden on Linux; WIC decoding falls back to the Rust and WebAssembly decoders.
- Secrets (saved signatures, AI API keys) go to the login keyring through the Secret Service instead of DPAPI and Credential Manager.
- The MCP endpoint lives in `$XDG_RUNTIME_DIR/glance` (or `$XDG_STATE_HOME/glance`), readable only by the user.
- No .deb, AppImage or Flatpak yet; add one when someone needs it.
