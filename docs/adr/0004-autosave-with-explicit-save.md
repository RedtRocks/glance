# Autosave to the original file, with explicit Save, Save As, and Export

The maintainer chose Preview's model over the usual Windows "explicit save + dirty prompt": edits are written back to the original file automatically. Ctrl+S flushes immediately, Save As writes a copy and continues on the copy, and Export writes other formats or options without touching the open document.

## Rules
- **When:** after 2 s without edits, and immediately on tab switch, window blur, or close. Never mid-gesture.
- **Lossy images (JPEG, WebP):** edits stay in memory and are encoded once, from the original pixels, on close or Ctrl+S. At most one generation of loss per session.
- **Formats Glance can open but not write** (HEIC, PSD, SVG, animated GIF, 3D models): the first edit asks once where to save a PNG/JPEG copy, and autosave then targets that copy. The original is never touched.
- **Pending redactions:** autosave pauses for a document while it has unapplied redactions, so the file on disk is never "looks redacted but isn't". A banner offers Apply or Discard.
- **Safety net:** full version history. Every autosave keeps a version, which the user can browse and restore (see ADR 0006).

## Considered options
Explicit save with a dirty prompt (the Windows norm) and "never touch originals" were both rejected by the maintainer in favor of Preview parity.
