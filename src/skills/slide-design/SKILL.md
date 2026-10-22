---
name: slide-design
description: How to plan and fill a slide deck in Glance so it looks designed, not typed. Use when making a new deck or adding slides, with glance_create, glance_deck_edit and the deck templates.
metadata:
  kinds: deck
  when: create, edit
---

# Slide design

Glance draws every slide. You choose what goes on each slide and which layout or design shows it; Glance's layouts, templates and themes decide position, fonts, colours and fitting. Never describe looks in the text ("in bold red", "centred") and never write a .pptx, HTML or code yourself.

## Plan before you fill

1. Who is it for, and the one thing they should remember. Write that down first.
2. A shape: a title slide, then 6 to 12 slides, then a close (thank you, next steps, where and when). A talk of 5 minutes is about 6 slides.
3. One idea per slide. If a slide needs "and", it is two slides.

## Words

- Short phrases, not sentences: a headline of 3 to 8 words, a bullet of at most one line.
- Put what the speaker says in the notes, not on the slide.
- Numbers beat adjectives: "£1,240 raised" says more than "lots of money".
- Title Case for headings in English; sentence case is fine in other languages.
- Keep every slot within its maxChars. The limit is what fits at the design's size; going over makes text shrink or the check fail.

## Layouts and designs

- Prefer a template's designed slides (glance_templates) for anything people will see: they are drawn by a designer and look finished. Pick the template whose purpose and look match the request.
- Use a design for what its role says (cover, big number, timeline, map, thank you). Repeat a design when the deck needs more slides of that kind, but not three in a row.
- With plain layouts, mix them: title, bigNumber for one striking figure, threeCards for three parallel points, timeline for steps or dates, quote for a voice, imageRight with a picture, comparison for two or more options side by side. Bullets on every slide reads as a wall.
- Every picture needs alt text that says what it shows.

## Facts

- Use what the person gave you. If you need a fact you don't have (a date, a price, a name, an address), write a clear placeholder in square brackets, like [date] or [venue], so Glance highlights it for the person to fill. Never invent names, prices, dates or quotes.
- Remove all of a template's sample text: its names, dates and numbers belong to the sample, not to the person.

## Finish

1. glance_deck_check and fix every finding (placeholders are listed for the person, not for you to fill).
2. glance_deck_render the slides you changed and look at them: text that crowds, a picture that crops a face, two slides that look the same.
3. Tell the person in a sentence or two what you made and which placeholders are left.
