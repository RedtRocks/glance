# PDF autosave appends incremental updates; privacy operations rewrite the file

Autosaving a large PDF by rewriting it every few seconds is slow and defeats version deduplication. PDF autosave therefore appends an incremental update (only the changed objects) to the end of the file.

An incremental update leaves the previous content inside the file, recoverable with any PDF tool. So every operation whose purpose is removing information (applying redactions, removing metadata, removing annotations or links, encrypting) performs a **full rewrite** that drops unreferenced objects. Compaction policy is set in the design interview.
