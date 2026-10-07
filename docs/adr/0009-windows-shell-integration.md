# Full Windows shell integration, including the Windows 11 top-level context menu

The maintainer wants the most native, Fluent experience possible, so Glance integrates with every Windows entry point from the first release. The Dock drag-and-drop from macOS doesn't exist on Windows: dropping onto a taskbar button only focuses the window.

- "Open with Glance" file associations, and Glance listed in Settings → Apps → Default apps (installer, `src-tauri/windows/default-apps.nsh`)
- Dropping files onto the Glance desktop shortcut or `.exe`
- **Send to → Glance**; several files sent together open together
- **Windows 11 top-level context menu**: Open in Glance, Combine into PDF, Remove Location Info
- The native Windows **Share** sheet (File → Share, and the toolbar overflow menu)

## Consequences
The Windows 11 context menu requires a package identity. The Microsoft Store package has one, and the Store signs it, so that is where the top-level menu lives: its manifest (`scripts/packaging.ts`) declares a `windows.fileExplorerContextMenus` verb per file type and a COM `IExplorerCommand` class per verb, served from `glance_context_menu.dll` (`src-tauri/context-menu`) in a surrogate host. A command gets the whole selection at once and starts the packaged Glance.exe with every file.

The GitHub installer would need a *sparse package* registered next to the classic install, code-signed with a certificate Windows trusts, which Glance doesn't have. So the installer registers the same three verbs as classic Explorer verbs under `HKCU\Software\Classes\SystemFileAssociations` (Windows 11 shows them under "Show more options"). Explorer runs a classic verb once per selected file, so Glance gathers launches that arrive within a moment of each other into one request (`src-tauri/src/explorer.rs`).
