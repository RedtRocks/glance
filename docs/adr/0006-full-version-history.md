# Every autosave keeps a version

Because autosave overwrites originals (ADR 0004), the maintainer chose full version history over a single "Revert to Last Opened" copy: each autosave stores the previous file contents as a version the user can browse and restore. This costs disk space. Retention limits, and what happens to versions that still contain redacted content, are decided in the design interview.
