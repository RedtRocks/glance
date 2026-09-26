# Version history: a deduplicated chunk store with macOS-style thinning

Because autosave overwrites originals (ADR 0004), every autosave keeps a version. Storing full copies was rejected as too expensive. Instead, versions follow the macOS model and add block-level deduplication.

- **Storage:** a content-defined chunk store (FastCDC chunking, BLAKE3 hashes) in `%LOCALAPPDATA%\Glance\Versions`. A version is a manifest of chunk hashes, so unchanged regions are stored once. PDFs autosave as incremental updates (ADR 0008), so consecutive versions share almost everything.
- **Thinning (as macOS does):** keep every version from the last day, one per day for the last month, and one per week after that.
- **Purgeable:** like macOS's purgeable space, the oldest versions are deleted automatically when the disk runs low on free space. No fixed quota.
- **Deletion is real:** deleting versions garbage-collects any chunks no longer referenced, so their bytes leave the store.

## Considered options
- A single "Revert to Last Opened" copy: rejected, because the maintainer wanted full history.
- Full copies per version: rejected on disk cost.
