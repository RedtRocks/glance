/**
 * What the AI needs to know about an open deck for a guided request (guide.ts): its
 * template, the slides the person picked (or the one on screen) with each slot's text and
 * maxChars, and the placeholders still to fill.
 */
import type { Deck, Slide, SlotValue } from '../deck/model'
import { boardOf, designIds, slotSpecsOf, type BoardInfo, type DesignLookup } from '../deck/design'
import { findPlaceholders, type FileContext, type SlotInfo } from './guide'

/** A slot's text as one string: list entries and table rows on lines, cards as "heading: body". */
export function slotValueText(v: SlotValue | undefined): string {
  if (!v) return ''
  switch (v.kind) {
    case 'text':
      return v.value
    case 'list':
      return v.value.join('\n')
    case 'items':
      return v.value.map((it) => `${it.heading}: ${it.body}`).join('\n')
    case 'table':
      return v.value.map((r) => r.join(' | ')).join('\n')
    case 'image':
      return v.value.alt
  }
}

function slotsOf(slide: Slide, designs: DesignLookup): SlotInfo[] {
  return slotSpecsOf(slide, designs)
    .filter((spec) => spec.kind !== 'image')
    .map((spec) => ({ name: spec.name, text: slotValueText(slide.slots[spec.name]), ...(spec.maxChars ? { maxChars: spec.maxChars } : {}) }))
}

/** Every placeholder in the deck's slots and notes. */
export function deckPlaceholders(deck: Deck): string[] {
  return findPlaceholders(deck.slides.flatMap((s) => [...Object.values(s.slots).map(slotValueText), s.notes]).join('\n'))
}

/** Where each placeholder is: slide id and slot, for the check. */
export function placeholderSpots(deck: Deck): { id: string; slot: string; placeholder: string }[] {
  return deck.slides.flatMap((s) => [
    ...Object.entries(s.slots).flatMap(([slot, v]) => findPlaceholders(slotValueText(v)).map((placeholder) => ({ id: s.id, slot, placeholder }))),
    ...findPlaceholders(s.notes).map((placeholder) => ({ id: s.id, slot: 'notes', placeholder }))
  ])
}

export function deckContext(
  deck: Deck,
  at: { tab: string; name?: string; path?: string; selected: string[]; current: number },
  designs: DesignLookup,
  board: (id: string) => BoardInfo | undefined
): FileContext {
  const boards = [...new Set(designIds(deck.slides).map(boardOf))]
  const info = boards.length === 1 ? board(boards[0]) : undefined
  const picked = at.selected.length ? deck.slides.filter((s) => at.selected.includes(s.id)) : deck.slides.slice(at.current, at.current + 1)
  return {
    kind: 'deck',
    tab: at.tab,
    ...(at.name ? { name: at.name } : {}),
    ...(at.path ? { path: at.path } : {}),
    ...(info ? { template: { id: info.id, name: info.name, look: info.look } } : boards.length ? {} : { look: `theme ${deck.theme}` }),
    count: deck.slides.length,
    selection: {
      kind: 'deck',
      slides: picked.slice(0, 12).map((s) => {
        const role = s.design ? designs(s.design)?.role : undefined
        return { id: s.id, number: deck.slides.indexOf(s) + 1, layout: s.layout, ...(s.design ? { design: s.design } : {}), ...(role ? { role } : {}), slots: slotsOf(s, designs) }
      })
    },
    placeholders: deckPlaceholders(deck)
  }
}
