# Autosave to the original file, with explicit Save, Save As, and Export

The maintainer chose Preview's model over the usual Windows "explicit save + dirty prompt": edits are written back to the original file automatically. Ctrl+S flushes immediately, Save As writes a copy and continues on the copy, and Export writes other formats or options without touching the open document. Windows users won't expect this, so the safeguards (timing, lossy formats, unwritable formats, revert) are decided in the design interview and recorded here.
