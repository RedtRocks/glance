import { describe, expect, it } from 'vitest'
import { emptyDeck, slideIdMaker, type Deck } from '../src/core/deck/model'
import { applyOps, DeckError, type DeckOp } from '../src/core/deck/ops'
import { checkDeck } from '../src/core/deck/check'
import { editOps } from '../src/core/deck/edit'
import { parseDeck } from '../src/core/deck/file'
import { slideHtml } from '../src/core/deck/html'
import { themeOf } from '../src/core/deck/themes'
import { fitDesignText, placeTexts, shownText, slotSpecsOf, type Board, type Design, type DesignText } from '../src/core/deck/design'
import { boardDeck, checkOneTemplate, createSlideOps } from '../src/core/deck/template'

const text = (name: string, sample: string, more: Partial<DesignText> = {}): DesignText => ({
  name, x: 100, y: 100, w: 800, h: 120, rotate: 0, font: 'Urbanist', size: 96, weight: 800, italic: false, colour: '#111111', opacity: 1,
  letterSpacing: 0, lineHeight: 1.2, align: 'left', valign: 'top', charW: 0.5, maxChars: Math.ceil(sample.length * 1.4), sample, ...more
})
const design = (id: string, ...texts: DesignText[]): Design => ({ id, role: 'Cover', bg: '#ffffff', art: '<div class="art"></div>', texts })
const board: Board = {
  id: 'fair',
  fonts: [{ family: 'Urbanist', weight: 800, italic: false }],
  designs: [
    design('fair.1', text('title', 'Spring Fair'), text('text2', 'Saturday 4 May', { size: 40 })),
    design('fair.2', text('title', 'Three ways to help'), text('text2', 'Bake'), text('text3', 'Sell')),
    design('fair.3', text('title', 'Thank you'))
  ]
}
const other: Board = { id: 'gala', fonts: [], designs: [design('gala.1', text('title', 'Gala'))] }
const lookup = (id: string) => [...board.designs, ...other.designs].find((d) => d.id === id)

function deckOf(ops: DeckOp[], start: Deck = emptyDeck()) {
  return applyOps(start, ops, slideIdMaker(start), lookup).deck
}

describe('slotSpecsOf', () => {
  it('gives a layout its own slots, a designed slide its design’s, and an unknown design none', () => {
    expect(slotSpecsOf({ layout: 'quote' }, lookup).map((s) => s.name)).toEqual(['quote', 'attribution'])
    const specs = slotSpecsOf({ layout: 'design', design: 'fair.2' }, lookup)
    expect(specs).toEqual([
      { name: 'title', kind: 'text', required: true, maxChars: 26, hint: 'Three ways to help' },
      { name: 'text2', kind: 'text', required: true, maxChars: 6, hint: 'Bake' },
      { name: 'text3', kind: 'text', required: true, maxChars: 6, hint: 'Sell' }
    ])
    expect(slotSpecsOf({ layout: 'design', design: 'fair.9' }, lookup)).toEqual([])
    expect(slotSpecsOf({ layout: 'design' }, lookup)).toEqual([])
  })
})

describe('operations on designed slides', () => {
  it('adds a design by id, with or without layout design, and checks its slots', () => {
    const deck = deckOf([
      { op: 'add', design: 'fair.1', slots: { title: 'Summer Fair', text2: 'Sunday' } },
      { op: 'add', layout: 'design', design: 'fair.2' }
    ])
    expect(deck.slides.map((s) => [s.layout, s.design])).toEqual([['design', 'fair.1'], ['design', 'fair.2']])
    expect(deck.slides[0].slots.title).toEqual({ kind: 'text', value: 'Summer Fair' })
    expect(() => deckOf([{ op: 'add', design: 'fair.1', slots: { subtitle: 'x' } }])).toThrow(/design fair.1 has no slot subtitle; it has title, text2/)
    expect(() => deckOf([{ op: 'add', design: 'fair.1', slots: { title: ['a list'] } }])).toThrow(/slot title takes text/)
    expect(() => deckOf([{ op: 'add', design: 'fair.9' }])).toThrow(/no design fair.9; glance_templates/)
    expect(() => deckOf([{ op: 'add', design: '<script>' }])).toThrow(/design must be a design id/)
    expect(() => deckOf([{ op: 'add', layout: 'bullets', design: 'fair.1' }])).toThrow(/a layout or a design, not both/)
    expect(() => deckOf([{ op: 'add', layout: 'design' }])).toThrow(DeckError)
    // Without the designs loaded, a designed slide can't be made.
    expect(() => applyOps(emptyDeck(), [{ op: 'add', design: 'fair.1' }], () => 's1')).toThrow(/no design fair.1/)
  })

  it('repeats a design as often as asked, and mixes designs in any order', () => {
    const deck = deckOf(['fair.1', 'fair.2', 'fair.2', 'fair.3', 'fair.2', 'fair.2'].map((design) => ({ op: 'add', design })))
    expect(deck.slides.map((s) => s.design)).toEqual(['fair.1', 'fair.2', 'fair.2', 'fair.3', 'fair.2', 'fair.2'])
    expect(new Set(deck.slides.map((s) => s.id)).size).toBe(6)
  })

  it('sets and clears slots, switches design or layout keeping what fits, and duplicates', () => {
    let deck = deckOf([{ op: 'add', design: 'fair.2', slots: { title: 'Help', text2: 'Bake', text3: 'Sell' } }])
    deck = applyOps(deck, [{ op: 'setSlot', id: 's1', slot: 'text2', value: 'Cook' }, { op: 'clearSlot', id: 's1', slot: 'text3' }, { op: 'duplicate', id: 's1' }], slideIdMaker(deck), lookup).deck
    expect(deck.slides[0].slots).toEqual({ title: { kind: 'text', value: 'Help' }, text2: { kind: 'text', value: 'Cook' } })
    expect(deck.slides[1].design).toBe('fair.2')
    const r = applyOps(deck, [{ op: 'setLayout', id: 's1', design: 'fair.3' }], slideIdMaker(deck), lookup)
    expect(r.deck.slides[0]).toMatchObject({ layout: 'design', design: 'fair.3', slots: { title: { kind: 'text', value: 'Help' } } })
    expect(r.dropped).toEqual([{ id: 's1', slots: ['text2'] }])
    const back = applyOps(r.deck, [{ op: 'setLayout', id: 's1', layout: 'section' }], slideIdMaker(r.deck), lookup).deck.slides[0]
    expect(back.layout).toBe('section')
    expect(back.design).toBeUndefined()
    expect(back.slots.title).toEqual({ kind: 'text', value: 'Help' })
    expect(() => applyOps(deck, [{ op: 'merge', ids: ['s1', 's2'] }], slideIdMaker(deck), lookup)).toThrow(/no list/)
    expect(() => applyOps(deck, [{ op: 'clearSlot', id: 's1', slot: 'nope' }], slideIdMaker(deck), lookup)).toThrow(/design fair.2 has no slot nope/)
  })

  it('stores typing in a designed slide’s text box', () => {
    const deck = deckOf([{ op: 'add', design: 'fair.1', slots: { title: 'Fair' } }])
    const slide = deck.slides[0]
    expect(editOps(slide, { slot: 'title' }, 'Summer fair', lookup)).toEqual([{ op: 'setSlot', id: 's1', slot: 'title', value: 'Summer fair' }])
    expect(editOps(slide, { slot: 'title' }, '  ', lookup)).toEqual([{ op: 'clearSlot', id: 's1', slot: 'title' }])
    expect(editOps(slide, { slot: 'text2' }, 'Sunday', lookup)).toEqual([{ op: 'setSlot', id: 's1', slot: 'text2', value: 'Sunday' }])
    expect(editOps(slide, { slot: 'text2' }, 'Sunday')).toEqual([])
  })
})

describe('the design check on designed slides', () => {
  it('passes a template deck, and flags empty or long slots, unknown designs and the missing cover', () => {
    const deck = boardDeck(board)
    expect(checkDeck(deck, lookup)).toEqual([])
    const s2 = deck.slides[1]
    const edited = applyOps(deck, [
      { op: 'setSlot', id: s2.id, slot: 'text2', value: 'Bake a cake or two' },
      { op: 'clearSlot', id: s2.id, slot: 'text3' }
    ], slideIdMaker(deck), lookup).deck
    expect(checkDeck(edited, lookup)).toEqual([
      { code: 'overflow', id: s2.id, slot: 'text2', detail: 'text2 is too long for design fair.2: keep it under 6 characters, or split the slide.' },
      { code: 'missing', id: s2.id, slot: 'text3', detail: 'Fill text3: design fair.2 needs it.' }
    ])
    const noCover = applyOps(deck, [{ op: 'delete', ids: [deck.slides[0].id] }], slideIdMaker(deck), lookup).deck
    expect(checkDeck(noCover, lookup)[0]).toMatchObject({ code: 'noTitleSlide', detail: expect.stringContaining('fair.1') })
    expect(checkDeck(deck, () => undefined).map((f) => f.code)).toEqual(['unknownDesign', 'unknownDesign', 'unknownDesign'])
  })

  it('flags the same design three times in a row, not three designs of one template', () => {
    const three = (d: string) => [{ op: 'add', design: 'fair.1' }, ...[0, 1, 2].map(() => ({ op: 'add', design: d, slots: { title: 'Thanks' } }))] as DeckOp[]
    expect(checkDeck(deckOf(three('fair.3')), lookup).map((f) => f.code)).toEqual(['missing', 'missing', 'repeatLayout'])
    const mixed = deckOf([{ op: 'add', design: 'fair.1', slots: { title: 'A', text2: 'B' } }, { op: 'add', design: 'fair.3', slots: { title: 'C' } }, { op: 'add', design: 'fair.1', slots: { title: 'D', text2: 'E' } }, { op: 'add', design: 'fair.3', slots: { title: 'F' } }])
    expect(checkDeck(mixed, lookup)).toEqual([])
  })
})

describe('reading designed slides from a file', () => {
  const raw = { version: 1, theme: 'wollo', slides: [{ id: 's1', layout: 'design', design: 'fair.1', slots: { title: { kind: 'text', value: 'Fair' }, bogus: { kind: 'text', value: 'x' } } }] }

  it('checks a known design’s slots', () => {
    const { deck, warnings } = parseDeck(raw, lookup)
    expect(deck.slides[0]).toMatchObject({ layout: 'design', design: 'fair.1', slots: { title: { kind: 'text', value: 'Fair' } } })
    expect(deck.slides[0].slots.bogus).toBeUndefined()
    expect(warnings).toEqual([expect.stringContaining('left out bogus')])
  })

  it('keeps the text of a design this Glance doesn’t have, and leaves out slides with no design', () => {
    const { deck, warnings } = parseDeck({ ...raw, slides: [...raw.slides, { id: 's2', layout: 'design', slots: {} }] })
    expect(deck.slides).toHaveLength(1)
    expect(deck.slides[0].slots).toEqual({ title: { kind: 'text', value: 'Fair' }, bogus: { kind: 'text', value: 'x' } })
    expect(warnings).toEqual([expect.stringContaining("doesn't have (fair.1)"), expect.stringContaining('Slide 2 names no design')])
  })
})

describe('drawing designed slides', () => {
  it('fits longer text by shrinking it, down to half, and keeps the sample at the design’s size', () => {
    const t = board.designs[0].texts[0]
    expect(fitDesignText(t, t.sample)).toBe(96)
    expect(fitDesignText(t, 'Fair')).toBe(96)
    const long = fitDesignText(t, 'The Big Spring Fair on the Green')
    expect(long).toBeLessThan(96)
    expect(long).toBeGreaterThanOrEqual(48)
    expect(fitDesignText(t, 'x'.repeat(400))).toBe(48)
  })

  it('shrinks the sample too when the real font needs more room than the box', () => {
    const t: DesignText = { ...board.designs[0].texts[0], wrap: undefined }
    const wide = (_b: DesignText, line: string, size: number) => line.length * size * 4
    expect(fitDesignText(t, t.sample, wide)).toBeLessThan(96)
  })

  it('applies the box’s text transform for exports', () => {
    expect(shownText(text('a', 'x', { transform: 'uppercase' }), 'Bake sale')).toBe('BAKE SALE')
    expect(shownText(text('a', 'x', { transform: 'capitalize' }), 'bake sale')).toBe('Bake Sale')
  })

  it('draws the art, the text boxes under the over layer, the over layer, then the rest; hints only while editing', () => {
    const d: Design = { ...design('fair.1', text('title', 'Fair', { under: true }), text('text2', 'Sat')), over: '<div class="over"></div>' }
    const look = () => d
    const slide = { id: 's1', layout: 'design' as const, design: 'fair.1', slots: { title: { kind: 'text' as const, value: 'Fête & fun' } }, notes: '', hidden: false }
    expect(placeTexts(slide, d).map((p) => p.placeholder)).toEqual([false, true])
    const html = slideHtml(slide, themeOf('wollo'), { resolveSrc: () => null, designs: look })
    const at = (s: string) => html.indexOf(s)
    expect(at('class="art"')).toBeLessThan(at('Fête &amp; fun'))
    expect(at('Fête &amp; fun')).toBeLessThan(at('class="over"'))
    expect(html).not.toContain('data-ref="text2"')
    const editing = slideHtml(slide, themeOf('wollo'), { resolveSrc: () => null, designs: look, placeholder: (_ref, sample) => `hint ${sample}` })
    expect(at.call(null, 'class="over"')).toBeGreaterThan(0)
    expect(editing.indexOf('hint Sat')).toBeGreaterThan(editing.indexOf('class="over"'))
    // A design that isn't loaded still shows its text, plainly.
    expect(slideHtml(slide, themeOf('wollo'), { resolveSrc: () => null })).toContain('Fête &amp; fun')
  })
})

describe('glance_create from a template', () => {
  it('starts from the template’s own slides when no slides are given', () => {
    const ops = createSlideOps(board, undefined)
    expect(ops.map((o) => o.op === 'add' && o.design)).toEqual(['fair.1', 'fair.2', 'fair.3'])
    expect(deckOf(ops).slides[0].slots.title).toEqual({ kind: 'text', value: 'Spring Fair' })
  })

  it('takes designs by id or number, repeated, for a deck of any length', () => {
    const slides = [{ design: 1, slots: { title: 'Gala', text2: 'Friday' } }, ...Array.from({ length: 11 }, (_, i) => ({ design: i % 2 ? 'fair.2' : 3, slots: { title: `Slide ${i + 2}` } }))]
    const ops = createSlideOps(board, slides)
    checkOneTemplate(ops, board)
    const deck = deckOf(ops)
    expect(deck.slides).toHaveLength(12)
    expect(deck.slides.slice(0, 4).map((s) => s.design)).toEqual(['fair.1', 'fair.3', 'fair.2', 'fair.3'])
  })

  it('keeps a deck to one template’s designs, and still takes plain layouts', () => {
    expect(() => checkOneTemplate(createSlideOps(board, [{ design: 'gala.1' }]), board)).toThrow(/one template; these slides use gala and fair/)
    expect(() => checkOneTemplate(createSlideOps(undefined, [{ design: 'fair.1' }, { design: 'gala.1' }]))).toThrow(/one template/)
    const ops = createSlideOps(undefined, [{ layout: 'title', slots: { title: 'Plain' } }])
    expect(deckOf(ops).slides[0].layout).toBe('title')
    expect(() => createSlideOps(undefined, undefined)).toThrow(/slides must be a list/)
    expect(() => createSlideOps(board, [null])).toThrow(/each slide must be an object/)
  })
})
