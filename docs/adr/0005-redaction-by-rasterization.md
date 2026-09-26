# Redaction rasterizes affected pages

A black rectangle over text hides nothing, and surgically removing glyphs is error-prone: one bug leaks data. When redactions are applied, only the pages containing one are re-rendered at 300 DPI with the areas filled solid, and replace the original page (dropping its text, annotations, and links). Redacted pages lose text selection and search, in exchange for guaranteed removal.
