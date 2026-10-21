---
name: document-writing
description: How to write and lay out a Glance document (.gdoc) that reads well and looks designed, such as a letter, report, essay, CV, newsletter, menu, poster or certificate. Use when making a new document or adding to one, with glance_create kind document and the glance_doc tools.
metadata:
  kinds: document
  when: create, edit
---

# Document writing

A Glance document is a look (fonts, colours, page art) plus pages and blocks. You send words and structure; the look decides how it is drawn, and long text flows onto new pages in the same look by itself. Never set fonts, sizes or colours in the text, never squeeze text to fit a page, and never write a .docx, HTML or code yourself.

## Pick the shape for the kind of document

- Letter: sender, date, recipient, a greeting, three to five short paragraphs (why you are writing, the detail, what you are asking for), a sign-off and a name.
- Report: a title page or heading, a summary of three to five lines first, then sections with heading 2, tables for numbers, a chart only where it shows a trend, and next steps at the end.
- Essay: a title, an opening paragraph that states the argument, one point per paragraph with evidence, a conclusion. Quotes as quote blocks, sources at the end.
- CV: name and contact line, a two-line profile, experience newest first (role, place, dates, two to four results each, starting with a verb), education, skills. One or two pages.
- Newsletter: a masthead, one lead story, two or three short items, dates to remember, a contact line.
- Posters, menus, certificates and invoices are fixed designed pages: fill each text box within its maxChars and keep tables as real tables (add or remove rows rather than typing rows into a paragraph).

## Writing

- Headings say what the section is about in 2 to 8 words, Title Case in English.
- Paragraphs of two to five sentences. One idea per paragraph. Plain words over formal ones.
- Lists for three or more parallel things; a table when each thing has the same few facts.
- Use a callout or pull quote at most once per page.
- Keep the person's own voice and spelling (UK or US) if they wrote some of the text.

## Templates

- Start from a template whose purpose matches the request, and replace every piece of its sample text: its names, dates, prices and addresses belong to the sample.
- Keep each text box within its maxChars; flowing blocks can be as long as they need.

## Facts

Use what the person gave you. If you need a fact you don't have (a date, an amount, an address, a name), write a placeholder in square brackets like [date] or [phone number] so Glance highlights it for the person. Never invent quotes, references, grades or prices.

## Finish

1. glance_doc_check and fix every finding (placeholders are listed for the person).
2. glance_doc_render the pages and look: headings left alone at the bottom of a page, tables that split badly, empty boxes.
3. Tell the person in a sentence or two what you made and what is left for them to fill.
