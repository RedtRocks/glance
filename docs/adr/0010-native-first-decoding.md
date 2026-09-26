# Decode images through Windows Imaging Component first, then pure-Rust decoders

macOS Preview opens hundreds of formats (including camera RAW) because macOS has a system-wide image engine. Windows' equivalent is **WIC** (Windows Imaging Component), the engine Photos uses. Codecs installed in Windows (Raw Image Extension, HEIF/AVIF/WebP extensions, JPEG XR, DDS) plug into it. Glance asks WIC first, so it opens whatever the user's Windows can open and gains new formats as Windows adds them.

When WIC can't decode a file (Windows 10 without extensions, or formats WIC never supported), Glance falls back to permissively licensed, pure-Rust decoders. For RAW, it extracts the full-size JPEG preview every camera embeds.

**PostScript/EPS** needs Ghostscript, which is AGPL and can't be bundled in an Apache-2.0 app. Glance runs Ghostscript as a separate program when it's installed. Otherwise it shows the EPS's embedded preview and offers `winget install ArtifexSoftware.GhostScript`.

**XPS/OXPS** render through the XPS Rasterization Service that ships with Windows.

Decoded pixels reach the UI as 32-bit BMP over a custom URI scheme, so WebView2's own decoder does the work, with no base64 or JSON in the path.
