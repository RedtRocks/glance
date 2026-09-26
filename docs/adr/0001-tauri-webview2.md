# Build on Tauri 2 + WebView2, not Electron or WinUI

Glance must be lightweight, start fast, and feel native on Windows. Electron was prototyped and rejected because it bundles its own Chromium + Node (~150 MB, slow cold start). C#/WinUI 3 or C++/Win32 would mean re-implementing PDF, 3D, and image codecs, and can't be built in Linux CI. Tauri renders in the OS-provided WebView2 (preinstalled on Windows 10/11) and uses a Rust backend, giving us a ~10 MB installer and mature web engines (PDF.js, pdf-lib, three.js).

## Consequences
The UI is HTML/CSS styled after Fluent rather than real WinUI controls. OS integration (file associations, drag-out, clipboard, screenshots) goes through Rust or Tauri plugins.
