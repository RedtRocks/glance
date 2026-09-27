# Autosave to the original file, with explicit Save, Save As, and Export

The maintainer chose Preview's model over the usual Windows "explicit save + dirty prompt": edits are written back to the original file automatically. Ctrl+S flushes immediately, Save As writes a copy and continues on the copy, and Export writes other formats or options without touching the open document.

## Rules
- **When:** after 10 s without edits, and at most once a minute per document, so steady work keeps one version a minute rather than one per pause. Immediately when the window loses focus, on tab switch, and before a tab or the window closes (so the close prompt only remains for what autosave never writes). Never mid-gesture (dialogs, typing into a text box or a PDF form field). Nothing is written when the content matches what was last saved, such as after undoing back to it.
- **Lossy images (JPEG, WebP):** edits stay in memory and are encoded once, from the original pixels, on close or Ctrl+S. At most one generation of loss per session.
- **Formats Glance can open but not write** (HEIC, PSD, SVG, animated GIF, 3D models): the first edit asks once where to save a PNG/JPEG copy, and autosave then targets that copy. The original is never touched.
- **Pending redactions:** autosave pauses for a document while it has unapplied redactions, so the file on disk is never "looks redacted but isn't". A banner offers Apply or Discard.
- **Safety net:** full version history. Every autosave keeps a version, which the user can browse and restore (see ADR 0006).

## Considered options
Explicit save with a dirty prompt (the Windows norm) and "never touch originals" were both rejected by the maintainer in favor of Preview parity.
