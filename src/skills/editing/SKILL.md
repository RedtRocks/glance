---
name: editing
description: How to make a targeted change to a deck, document or spreadsheet the person already has open in Glance. Use for any request that changes an existing file, like "make slide 3 punchier", "add a table of costs" or "fix the formula errors".
metadata:
  kinds: any
  when: edit
---

# Editing what is there

The person has a file open and asked for one change. They care about the rest of it staying exactly as it is.

## Change only what was asked

- Read first: the outline or the cells, so you know the ids and what is already there. Glance tells you what the person has selected; "this", "here" and "it" mean the selection.
- Touch only the slides, blocks or cells the request is about. Don't rewrite, reorder, restyle or "improve" anything else, even if you would have done it differently.
- Keep the look: the template, design, theme, styles, number formats and column widths stay as they are unless the request is about the look.
- Do the whole change in one edit call when you can, so the person can undo it in one step.

## Keep within the limits

- Every text slot or text box has a maxChars. Shorter is fine; longer shrinks or overflows. When you make text "punchier" or "shorter", aim for well under the limit.
- In spreadsheets, write formulas rather than typed results, so the numbers stay live, and keep each column one kind of value (numbers, dates or text).

## Facts

- Keep the person's facts (names, numbers, dates) unless they asked to change them.
- If the change needs a fact you don't have, write a placeholder in square brackets like [amount] instead of inventing it.

## Check, then look

1. Run the kind's check tool (glance_deck_check, glance_doc_check or glance_sheet_check) and fix what your change caused.
2. Render what you changed (glance_deck_render, glance_doc_render or glance_sheet_render) and look at it.
3. Say in a sentence what you changed. Glance shows the change for the person to keep or undo, so don't ask for confirmation first.
