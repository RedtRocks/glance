import { describe, expect, it } from 'vitest'
import { emptyDeck, slideIdMaker, type Slide } from '../src/core/deck/model'
import { applyOps } from '../src/core/deck/ops'
import { editOps, parseRefKey, slotText } from '../src/core/deck/edit'
import { refKey } from '../src/core/deck/html'

function slide(layout: 'bullets' | 'threeCards' | 'comparison' | 'title', slots: Record<string, unknown>): Slide {
  const deck = emptyDeck()
  return applyOps(deck, [{ op: 'add', layout, slots }], slideIdMaker(deck)).deck.slides[0]
}

/** Applies the edit and returns the slot's new value. */
function typed(s: Slide, key: string, text: string) {
  const ops = editOps(s, parseRefKey(key), text)
  const deck = applyOps({ ...emptyDeck(), slides: [s] }, ops, () => 'x').deck
  return deck.slides[0].slots[parseRefKey(key).slot]?.value
}

describe('editing text on a slide', () => {
  it('reads refs back from refKey', () => {
    for (const ref of [{ slot: 'title' }, { slot: 'items', index: 2, part: 'body' as const }, { slot: 'table', index: 1, col: 3 }]) {
      expect(parseRefKey(refKey(ref))).toEqual(ref)
    }
  })

  it('edits a list one entry per line, dropping blank lines', () => {
    const s = slide('bullets', { title: 'T', bullets: ['a', 'b'] })
    expect(slotText(s, { slot: 'bullets' })).toBe('a\nb')
    expect(typed(s, 'bullets', 'a\n\n  c  \n')).toEqual(['a', 'c'])
    expect(typed(s, 'bullets', '  ')).toBeUndefined()
  })

  it('fills a card that was not there yet and drops empty trailing cards', () => {
    const s = slide('threeCards', { title: 'T', items: [{ heading: 'One', body: '' }] })
    expect(typed(s, 'items.2.heading', 'Three')).toEqual([{ heading: 'One', body: '' }, { heading: '', body: '' }, { heading: 'Three', body: '' }])
    expect(typed(s, 'items.0.heading', '')).toBeUndefined()
  })

  it('pads a table out to the cell being typed in', () => {
    const s = slide('comparison', { title: 'T', table: [['A']] })
    expect(typed(s, 'table.1.1', 'x')).toEqual([['A'], ['', 'x']])
  })

  it('clears a text slot left empty and does nothing when the text is unchanged', () => {
    const s = slide('title', { title: 'Hi', subtitle: 'There' })
    expect(typed(s, 'subtitle', '')).toBeUndefined()
    expect(editOps(s, { slot: 'title' }, 'Hi')).toEqual([])
    expect(editOps(s, { slot: 'nope' }, 'x')).toEqual([])
  })
})
