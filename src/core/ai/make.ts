/**
 * "What do you want to make?": turning the person's request into a name for the new file
 * and the first message to the AI, which fills the new deck with Glance's deck tools.
 * The message is read by the AI, so it is English; the AI answers in the person's language.
 */

/** A file name from the request: its first few words, without characters Windows refuses. */
export function nameFromRequest(request: string, fallback: string): string {
  const words = request.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 6).join(' ')
  const name = words.length > 48 ? words.slice(0, 48).trimEnd() : words
  return name ? name[0].toUpperCase() + name.slice(1) : fallback
}

/** The first message for a new deck, already open in Glance as `tab`. */
export function deckPrompt(request: string, tab: string): string {
  return [
    `Make slides for me in Glance: ${request.trim()}`,
    '',
    `A new, empty deck is open in Glance (tab ${tab}). Fill it with glance_deck_edit; don't write files, code or a .pptx yourself.`,
    'First plan it: who it is for, the one thing they should remember, and 6 to 12 slides. Start with a title slide, keep one idea per slide in short phrases, mix the layouts (threeCards, bigNumber, timeline, quote, imageRight and the others) and put detail in the speaker notes.',
    'Then call glance_deck_check and fix every finding, look at the slides with glance_deck_render and fix anything that looks wrong, and finish by telling me in a sentence or two what you made.',
    "If you don't have facts you need, use clear placeholders like [date] rather than inventing them."
  ].join('\n')
}

/** The first message for a deck started from a template, open in Glance as `tab`. */
export function templatePrompt(request: string, template: string, tab: string): string {
  return [
    `Make slides for me in Glance from the ${template} template: ${request.trim()}`,
    '',
    `The template is open in Glance (tab ${tab}). Read it with glance_deck_outline and change it with glance_deck_edit; don't write files, code or a .pptx yourself.`,
    'Replace every [bracketed] placeholder with real words for my request, and add, remove or reorder slides where the request needs it. Keep its theme and keep one idea per slide in short phrases.',
    'Then call glance_deck_check and fix every finding, look at the slides with glance_deck_render and fix anything that looks wrong, and finish by telling me in a sentence or two what you made.',
    "If you don't have facts you need, leave a clear placeholder like [date] rather than inventing them."
  ].join('\n')
}
