# Architecture decision records

Each file records one decision: the problem, what was chosen and why, and what follows from it. Read the ones near your change before starting; a change that goes against one needs a new record that replaces it, not a quiet reversal.

- [0001](0001-tauri-webview2.md): Build on Tauri 2 + WebView2, not Electron or WinUI
- [0002](0002-bundled-subject-model.md): Bundle U²-Net-p and run it in Rust with tract
- [0003](0003-markup-as-pdf-annotations.md): Markup is saved as editable PDF annotations, not flattened
- [0004](0004-autosave-with-explicit-save.md): Autosave to the original file, with explicit Save, Save As, and Export
- [0005](0005-redaction-by-rasterization.md): Redaction rasterizes affected pages and forces a full rewrite
- [0006](0006-full-version-history.md): Version history: a deduplicated chunk store with macOS-style thinning
- [0007](0007-windows-ocr.md): Use the built-in Windows OCR engine for text recognition
- [0008](0008-pdf-incremental-autosave.md): PDF autosave appends incremental updates; privacy operations rewrite the file
- [0009](0009-windows-shell-integration.md): Full Windows shell integration, including the Windows 11 top-level context menu
- [0010](0010-native-first-decoding.md): Decode images through Windows Imaging Component first, then pure-Rust decoders
- [0011](0011-no-quick-look-pair-with-peek.md): No built-in quick preview; pair with PowerToys Peek
- [0012](0012-english-text-as-translation-key.md): English text is the translation key
- [0013](0013-certificate-signatures-with-windows-cryptoapi.md): Check PDF certificate signatures with the Windows CryptoAPI and certificate store
- [0014](0014-ai-apps-through-mcp.md): AI apps use Glance through MCP, with the tools running in the app
- [0015](0015-ai-edits-as-matching-markup.md): AI edits text as markup that matches the page
- [0016](0016-anonymous-install-count.md): Count installs with one anonymous daily check-in
- [0017](0017-linux-builds.md): Ship Linux as RPM and .deb packages

## Writing one

Add `NNNN-short-title.md` with the next number, and add it to the list above. Keep it short, in the same shape as the others:

```markdown
# The decision, stated as a sentence

The problem and the forces at play. What was chosen, and the alternatives that
were rejected with the reason for each.

## Consequences
- What this makes easier or harder, and what has to stay true for it to hold.
```

Records are not rewritten when things change later. Add a new one that says which record it replaces, and add a line at the top of the old one pointing to it.
