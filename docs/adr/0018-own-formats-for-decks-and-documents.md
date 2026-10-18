# Decks and documents Glance creates use its own formats, with Office and PDF as exports

The maintainer wants AI apps and people to create slide decks and documents in Glance, rearrange and restyle them, and get better results than an agent writing a .pptx or .docx with a script. Agents writing Office files directly place boxes by coordinates and pick fonts and colours themselves, and PowerPoint's and Word's freeform layout gives them every way to get it wrong.

So a deck (`.gdeck`) and a document (`.gdoc`) are Glance's own formats: a zip holding a JSON model (a theme, then slides or sections with stable ids, each a layout with filled slots) and a `media/` folder. Agents send content and intent; Glance's layouts and themes decide how it looks. Every change is an operation in `src/core/deck/` (pure, tested), shared by the MCP tools, the Keep and Undo card, and the person's own editing. PowerPoint, Word, PDF, PNG and HTML are exports.

The other option was editing .pptx and .docx as the main format. It opens anywhere without an export step, but Glance could not keep layouts reliable or reflow a slide when its text changes. Spreadsheets are different: a grid maps cleanly onto .xlsx and .csv, so those are edited directly.

## Consequences
- An existing PowerPoint or Word file gets safe operations (reorder, delete, duplicate, replace text) written to a new file, and Convert to make it a deck or document, which can lose layout detail and says so.
- Export fidelity is ours to keep: pptxgenjs and docx (both MIT) write the Office files; they are lazy loaded like the other engines.
- Each format has its own extension so Explorer can show its icon and "Open with".
