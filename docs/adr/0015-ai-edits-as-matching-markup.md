# AI edits text as markup that matches the page

The maintainer wants to tell the Ask AI sidebar, by typing or speaking, to change, add or delete text in the open PDF or photo, with the result in the same style as what is already there, and to have this work with every AI company the sidebar offers.

Every company's agent already gets Glance's MCP tools (ADR 0014), so editing is four more tools (`glance_text_layout`, `glance_edit_text`, `glance_add_text`, `glance_erase`) rather than anything company specific. The AI says what to change in words ("tenant" becomes "renter", a paragraph after the heading "Terms"); Glance works out where and how it looks. Models are poor at placing text by coordinates and at guessing fonts, and Glance can read both from the page.

Edits are markup (ADR 0003), not rewritten PDF content streams: a text box whose fill covers the old words, with the new text on the old baseline in the old font, size, colour and line spacing. Rewriting content streams would need every PDF's fonts to contain the new glyphs (subset fonts usually don't), and it can't apply to photos at all. Markup works the same for PDFs and images, can be undone one change at a time, and is flattened into the file on save like any other markup.

## How the look is found
- PDFs: PDF.js text items give each run's font name, size and position; the font name gives family, weight and slant, mapped to an installed Windows font of the same kind. Colour and background are sampled from the rendered page.
- Photos and scans: Windows OCR gives words and lines (ADR 0007); size comes from line height, colour from pixels.
- Lines are grouped into paragraphs (baseline spacing, left edge, size and weight changes). A replacement that fits on its line redraws only the rest of that line; one that doesn't lays the paragraph out again at its own width and spacing, and paragraphs below it move down by the extra lines.
- On textured backgrounds (paper photos, gradients) the cover is a patch blended from the surrounding pixels instead of a flat fill.

## Consequences
- The pure layout code (src/core/textLayout.ts) is tested without a renderer.
- Each turn's changes show in the chat as a card with Keep and Undo; undoing restores any earlier AI markup a change replaced.
- The old text is still in the PDF under the cover. Edits are for changing what a document says, not for hiding it; redaction (ADR 0005) is what removes text for good.
- The mic uses Windows speech recognition (src-tauri/src/speech.rs), so it needs Windows' Online speech recognition setting; the web version uses the browser's.
