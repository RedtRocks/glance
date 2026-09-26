# Redaction rasterizes affected pages and forces a full rewrite

A black rectangle over text hides nothing, and surgically removing glyphs is error-prone: one bug leaks data. When redactions are applied, only the pages containing one are re-rendered at 300 DPI with the areas filled solid, and replace the original page (dropping its text, annotations, and links). Redacted pages lose text selection and search, in exchange for guaranteed removal.

Applying redactions always does a **full rewrite** of the file, never an incremental update: an incremental update would leave the original page objects inside the file (ADR 0008).

Earlier **versions** (ADR 0006) still contain the unredacted content. The maintainer chose not to delete them automatically. Instead, applying shows a warning with an optional "Delete earlier versions of this file" action.
