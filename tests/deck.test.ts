import { describe, expect, it } from 'vitest'
import { emptyDeck, type Deck } from '../src/core/deck/model'
import { applyOps, DeckError, type DeckOp } from '../src/core/deck/ops'
import { checkDeck } from '../src/core/deck/check'

function ids() {
  let n = 0
  return () => `s${++n}`
}

/** A deck of `n` bullets slides s1..sn, titled by their id. */
function deckOf(n: number): Deck {
  const ops: DeckOp[] = Array.from({ length: n }, (_, i) => ({ op: 'add', layout: 'bullets', slots: { title: `s${i + 1}`, bullets: ['a'] } }))
  return applyOps(emptyDeck(), ops, ids()).deck
}

const order = (deck: Deck) => deck.slides.map((s) => s.id)

describe('applyOps', () => {
  it('adds slides at the end, first, or after a slide', () => {
    const next = ids()
    let deck = applyOps(emptyDeck(), [{ op: 'add', layout: 'title', slots: { title: 'Bake Sale' } }], next).deck
    deck = applyOps(deck, [{ op: 'add', layout: 'quote', slots: { quote: 'Yum' } }], next).deck
    deck = applyOps(deck, [{ op: 'add', layout: 'section', slots: { title: 'Why' }, after: null }], next).deck
    const r = applyOps(deck, [{ op: 'add', layout: 'bullets', after: 's1' }], next)
    expect(order(r.deck)).toEqual(['s3', 's1', 's4', 's2'])
    expect(r.added).toEqual(['s4'])
  })

  it('moves slides, keeping their deck order whatever order the ids come in', () => {
    const deck = deckOf(5)
    expect(order(applyOps(deck, [{ op: 'move', ids: ['s4', 's2'], after: 's5' }], ids()).deck)).toEqual(['s1', 's3', 's5', 's2', 's4'])
    expect(order(applyOps(deck, [{ op: 'move', ids: ['s3'], after: null }], ids()).deck)).toEqual(['s3', 's1', 's2', 's4', 's5'])
  })

  it('refuses to move a slide after itself', () => {
    expect(() => applyOps(deckOf(3), [{ op: 'move', ids: ['s2'], after: 's2' }], ids())).toThrow(DeckError)
  })

  it('deletes, duplicates and hides', () => {
    const next = ids()
    const base = applyOps(emptyDeck(), [{ op: 'add', layout: 'bullets', slots: { title: 'A', bullets: ['x'] } }, { op: 'add', layout: 'quote', slots: { quote: 'Q' } }], next).deck
    const r = applyOps(base, [{ op: 'duplicate', id: 's1' }, { op: 'delete', ids: ['s2'] }, { op: 'hide', ids: ['s1'], hidden: true }], next)
    expect(order(r.deck)).toEqual(['s1', 's3'])
    expect(r.deck.slides[1].slots.title).toEqual({ kind: 'text', value: 'A' })
    expect(r.deck.slides[0].hidden).toBe(true)
  })

  it('is all or nothing: a bad op leaves the deck as it was', () => {
    const deck = deckOf(2)
    const before = structuredClone(deck)
    expect(() => applyOps(deck, [{ op: 'delete', ids: ['s1'] }, { op: 'delete', ids: ['s9'] }], ids())).toThrow(/Operation 2 \(delete\): no slide s9/)
    expect(deck).toEqual(before)
  })

  it('checks slot values against the layout', () => {
    const deck = deckOf(1)
    expect(() => applyOps(deck, [{ op: 'setSlot', id: 's1', slot: 'bullets', value: 'not a list' }], ids())).toThrow(/takes a list of text/)
    expect(() => applyOps(deck, [{ op: 'setSlot', id: 's1', slot: 'image', value: { src: 'a.png' } }], ids())).toThrow(/has no slot image/)
    expect(() => applyOps(deck, [{ op: 'add', layout: 'poster' as never }], ids())).toThrow(/no layout poster/)
  })

  it('keeps matching slots on a layout change and reports the rest', () => {
    const r = applyOps(deckOf(1), [{ op: 'setLayout', id: 's1', layout: 'section' }], ids())
    expect(r.deck.slides[0]).toMatchObject({ layout: 'section', slots: { title: { kind: 'text', value: 's1' } } })
    expect(r.dropped).toEqual([{ id: 's1', slots: ['bullets'] }])
  })

  it('splits a list onto a new slide and merges it back', () => {
    const next = ids()
    const base = applyOps(emptyDeck(), [{ op: 'add', layout: 'bullets', slots: { title: 'T', bullets: ['1', '2', '3', '4', '5'] } }], next).deck
    const split = applyOps(base, [{ op: 'split', id: 's1' }], next)
    expect(split.deck.slides.map((s) => s.slots.bullets.value)).toEqual([['1', '2', '3'], ['4', '5']])
    const merged = applyOps(split.deck, [{ op: 'merge', ids: ['s1', split.added[0]] }], next)
    expect(merged.deck.slides).toHaveLength(1)
    expect(merged.deck.slides[0].slots.bullets.value).toEqual(['1', '2', '3', '4', '5'])
  })

  it('clamps an image focus point into the picture', () => {
    const r = applyOps(emptyDeck(), [{ op: 'add', layout: 'fullImage', slots: { image: { src: 'media/cake.jpg', alt: 'A cake', focus: { x: 1.4, y: -1 } } } }], ids())
    expect(r.deck.slides[0].slots.image.value).toEqual({ src: 'media/cake.jpg', alt: 'A cake', focus: { x: 1, y: 0 } })
  })
})

describe('checkDeck', () => {
  it('asks for a title slide first and flags three same layouts in a row', () => {
    const codes = checkDeck(deckOf(3)).map((f) => [f.code, f.id])
    expect(codes).toEqual([['noTitleSlide', 's1'], ['repeatLayout', 's3']])
  })

  it('flags missing, too long and too many', () => {
    const deck = applyOps(emptyDeck(), [
      { op: 'add', layout: 'title' },
      { op: 'add', layout: 'bullets', slots: { title: 'x'.repeat(61), bullets: Array(7).fill('ok') } },
      { op: 'add', layout: 'imageLeft', slots: { title: 'Cake', image: { src: 'media/c.jpg', alt: '' } } }
    ], ids()).deck
    expect(checkDeck(deck).map((f) => [f.code, f.id, f.slot])).toEqual([
      ['missing', 's1', 'title'],
      ['overflow', 's2', 'title'],
      ['tooMany', 's2', 'bullets'],
      ['missingAlt', 's3', 'image']
    ])
  })

  it('skips hidden slides and passes a clean deck', () => {
    const deck = applyOps(emptyDeck(), [
      { op: 'add', layout: 'title', slots: { title: 'Bake Sale' } },
      { op: 'add', layout: 'threeCards', slots: { title: 'Three Ways to Help', items: [{ heading: 'Bake', body: 'Anything sweet' }, { heading: 'Bring', body: 'A friend' }, { heading: 'Buy', body: 'A treat' }] } },
      { op: 'add', layout: 'bullets' }
    ], ids()).deck
    deck.slides[2].hidden = true
    expect(checkDeck(deck)).toEqual([])
    expect(checkDeck(emptyDeck()).map((f) => f.code)).toEqual(['empty'])
  })
})

describe('the AI apps’ deck catalog', () => {
  it('names every layout and slot in glance_create, so AI apps can fill them', async () => {
    const { LAYOUTS } = await import('../src/core/deck/model')
    const { default: catalog } = await import('../src/core/mcp/tools.json')
    const create = catalog.tools.find((t) => t.name === 'glance_create')!.description
    for (const [layout, slots] of Object.entries(LAYOUTS)) {
      expect(create, layout).toContain(`${layout}`)
      for (const s of slots) expect(create, `${layout}.${s.name}`).toMatch(new RegExp(`\\b${s.name}${s.required ? '\\*' : ''}`))
    }
  })
})
