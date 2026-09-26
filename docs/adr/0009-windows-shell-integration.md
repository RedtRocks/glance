# Full Windows shell integration, including the Windows 11 top-level context menu

The maintainer wants the most native, Fluent experience possible, so Glance integrates with every Windows entry point from the first release. The Dock drag-and-drop from macOS doesn't exist on Windows: dropping onto a taskbar button only focuses the window.

- "Open with Glance" file associations (installer)
- Dropping files onto the Glance desktop shortcut or `.exe`
- **Send to → Glance**; several files sent together open together
- **Windows 11 top-level context menu**: Open in Glance, Combine into PDF, Remove Location Info
- The native Windows **Share** sheet (File → Share, and the toolbar overflow menu)

## Consequences
The Windows 11 context menu requires a package identity. We ship a *sparse package* registered by the NSIS installer next to the classic install, and a COM `IExplorerCommand` handler. Both must be code-signed, so releases need a signing certificate.

Until releases are signed, the installer registers the same three verbs as classic Explorer verbs under `HKCU\Software\Classes\SystemFileAssociations` (Windows 11 shows them under "Show more options"). Explorer runs a classic verb once per selected file, so Glance gathers launches that arrive within a moment of each other into one request (`src-tauri/src/explorer.rs`).
