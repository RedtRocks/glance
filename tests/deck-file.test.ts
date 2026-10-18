import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { emptyDeck, isMediaPath, slideIdMaker } from '../src/core/deck/model'
import { applyOps, DeckError } from '../src/core/deck/ops'
import { parseDeck, readDeck, writeDeck } from '../src/core/deck/file'

const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3])

function sample() {
  const deck = emptyDeck()
  return applyOps(deck, [
    { op: 'add', layout: 'title', slots: { title: 'Bake Sale' } },
    { op: 'add', layout: 'fullImage', slots: { image: { src: 'media/cake.png', alt: 'A cake' } } }
  ], slideIdMaker(deck)).deck
}

describe('.gdeck files', () => {
  it('round-trips a deck and the pictures it uses, dropping unused ones', async () => {
    const deck = sample()
    const bytes = await writeDeck({ deck, media: new Map([['media/cake.png', png], ['media/old.png', png]]) })
    const back = await readDeck(bytes)
    expect(back.deck).toEqual(deck)
    expect([...back.media.keys()]).toEqual(['media/cake.png'])
    expect(back.media.get('media/cake.png')).toEqual(png)
    expect(back.warnings).toEqual([])
  })

  it('warns about a missing picture instead of failing', async () => {
    const back = await readDeck(await writeDeck({ deck: sample(), media: new Map() }))
    expect(back.warnings).toEqual(['The picture media/cake.png is missing from the file.'])
  })

  it('refuses files that are not decks', async () => {
    await expect(readDeck(new Uint8Array([1, 2, 3]))).rejects.toThrow(DeckError)
    const zip = new JSZip()
    zip.file('other.txt', 'hi')
    await expect(readDeck(await zip.generateAsync({ type: 'uint8array' }))).rejects.toThrow(/no deck.json/)
  })
})

describe('parseDeck', () => {
  it('keeps what is sound and says what it left out', () => {
    const { deck, warnings } = parseDeck({
      version: 1,
      theme: 'wollo',
      slides: [
        { id: 's1', layout: 'title', slots: { title: { kind: 'text', value: 'Hi' }, bogus: { kind: 'text', value: 'x' } } },
        { id: 's1', layout: 'bullets', slots: { bullets: { kind: 'list', value: ['a', 2] } } },
        { id: 's3', layout: 'poster', slots: {} },
        { layout: 'fullImage', slots: { image: { kind: 'image', value: { src: '../../secret.png', alt: '' } } } }
      ]
    })
    expect(deck.slides.map((s) => [s.id, s.layout, Object.keys(s.slots)])).toEqual([
      ['s1', 'title', ['title']],
      ['s2', 'bullets', []],
      ['s3', 'fullImage', []]
    ])
    expect(warnings).toHaveLength(4)
    expect(warnings[2]).toMatch(/Slide 3 has a layout/)
  })

  it('warns when a newer Glance made the deck', () => {
    expect(parseDeck({ version: 99, slides: [] }).warnings[0]).toMatch(/newer Glance/)
    expect(() => parseDeck({ slides: 'no' })).toThrow(DeckError)
  })
})

describe('media paths and ids', () => {
  it('allows only plain picture names inside media/', () => {
    expect(isMediaPath('media/cake photo (1).jpg')).toBe(true)
    for (const bad of ['cake.jpg', 'media/../x.png', 'media/a/b.png', 'C:\\x.png', 'media/x.exe', 'media/.png']) expect(isMediaPath(bad), bad).toBe(false)
  })

  it('numbers new slides after the highest id', () => {
    const deck = sample()
    deck.slides[0].id = 's9'
    expect(slideIdMaker(deck)()).toBe('s10')
  })
})
