# Glance

A free, open-source reader and light editor for documents, images, 3D models and 190+ other file types, with an AI assistant and agent built in.

## Documents

**Document**:
One opened file, shown in its own tab. It is a *PDF document*, an *image document*, a *model document*, or a *deck*.
_Avoid_: File (on-disk only), tab (UI only)

**Page**:
One page of a PDF document or of a multi-page TIFF. Pages can be reordered, rotated, deleted, and dragged between documents.
_Avoid_: Slide (that belongs to a deck), sheet

**Deck**:
A document Glance creates and edits as a set of slides, which people or AI apps build, rearrange and restyle, and export as PowerPoint, PDF or images. A PowerPoint file that is only viewed is not a deck until it is converted.
_Avoid_: Presentation, slideshow, PPT

**Slide**:
One part of a deck: a layout with its content filled in. Slides can be added, reordered, restyled, hidden and deleted.
_Avoid_: Page (that belongs to page-based documents), card

**Frame**:
One still image of an animated GIF. Frames are shown for inspection and export but can't be reordered or edited.
_Avoid_: Page (for animations)

**Sidebar**:
The panel beside a document listing its pages, table of contents, highlights and notes, or bookmarks.

**Page Controls**:
Previous/next page buttons, plus a page number field for long documents. Shown only when the document has more than one page.
_Avoid_: Page flicker, pager

**Contact Sheet**:
A full-window grid of large page thumbnails, used for overview and reordering.
_Avoid_: Grid view, overview

## Editing

**Markup**:
Anything the user draws on a document: shapes, arrows, text boxes, highlights, notes, sketches, and signatures. Markup stays editable.
_Avoid_: Annotation (the PDF storage term), drawing

**Signature**:
A saved handwritten signature the user can place as markup.

**Certificate Signature**:
A cryptographic signature embedded in a PDF by signing software (Adobe, DocuSign), tied to the signer's certificate. Glance checks whether it is valid; it is not markup.
_Avoid_: Digital signature (in the UI), e-signature

**Redaction**:
A marked area whose content is permanently destroyed when applied. Not the same as a black rectangle drawn as markup.
_Avoid_: Blackout, censor

**Instant Alpha**:
Making a region of similar color transparent by clicking and dragging to set the tolerance.
_Avoid_: Magic wand

**Subject**:
The foreground object in an image, as found by Remove Background.
_Avoid_: Cutout, foreground

**Collage**:
A new image composed from several images arranged on a layout.

**Quartz Filter**:
An appearance filter applied at export time (Black & White, Sepia, Reduce File Size, and so on).

## Creating

**Template**:
A finished deck or document, with sample content, that a person or an AI app starts from.
_Avoid_: Blank, starter, preset

**Theme**:
The fonts, colours, sizes and spacing a deck or document uses. Switching theme restyles every slide at once.
_Avoid_: Style, skin, look (that means the app's own Wollo or Windows look)

**Brand Kit**:
A person's own logo, colours, fonts and tone, which every template and theme can use.
_Avoid_: Brand, style guide

**Skill**:
Know-how for one kind of work, such as slide design or writing a resume, that Glance gives to whichever AI is helping.
_Avoid_: Prompt, plugin

**Check**:
An automatic review of a file, such as design, spelling or accessibility, that lists what to fix.
_Avoid_: Lint, validation

## Inspection

**Inspector**:
The panel that shows file information and metadata and offers ways to remove it.

**Metadata**:
Information stored in a file beyond its visible content: authorship, dates, camera details, and location.

**Location Info**:
The GPS part of an image's metadata.
_Avoid_: Geotag, EXIF GPS

## Workflow

**Version**:
A saved earlier state of a document, kept each time Glance autosaves, which the user can browse and restore.
_Avoid_: Backup, snapshot, revision

**Update**:
A newer release of Glance itself. The user is told when one is available and may decline it.
_Avoid_: Version (that means a document's saved state), upgrade

**Text Recognition**:
Finding text in scanned pages and photos so it can be searched, selected, and copied.
_Avoid_: Live Text, OCR (in the UI)

**Batch**:
Applying one set of operations to many files at once.
_Avoid_: Bulk edit

**Drag Out**:
Dragging pages or an image out of Glance to create a new file wherever they are dropped.
