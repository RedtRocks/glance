import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import JSZip from 'jszip'
import { PDFDocument } from '@cantoo/pdf-lib'
import { emptyDeck, layoutIds, slideIdMaker, type Deck } from '../src/core/deck/model'
import { applyOps, type DeckOp } from '../src/core/deck/ops'
import { deckToPdf, wrap } from '../src/deck/exportPdf'
import { deckToPptx } from '../src/deck/exportPptx'

// A 4 by 2 picture: purple on the left half, yellow on the right.
const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAIAAADwyuo0AAAAGElEQVR4nGNIFvqWLPTt/wmG/ycYGJA5AKOiDMma1gVAAAAAAElFTkSuQmCC', 'base64'))
const media = new Map([['media/cake.png', png]])
const fonts = { regular: new Uint8Array(readFileSync(resolve(__dirname, '../src/styles/fonts/urbanist.woff2'))) }
const cake = { src: 'media/cake.png', alt: 'A cake', focus: { x: 0.2, y: 0.5 } }

/** One slide of every layout, the section slide hidden, with notes on the first. */
function sample(): Deck {
  const slots: Record<string, Record<string, unknown>> = {
    title: { title: 'Bake Sale Results', subtitle: 'Spring term, Year 5', image: cake },
    section: { title: 'What we sold' },
    bullets: { title: 'Highlights', bullets: ['Lemon drizzle sold out by ten', 'Every class baked something', 'A new record for the school'] },
    twoColumns: { title: 'Sweet and savoury', left: ['Brownies', 'Flapjacks'], right: ['Cheese scones', 'Sausage rolls'] },
    imageLeft: { title: 'The winning cake', image: cake, body: 'Mrs Patel\'s lemon drizzle, gone in eleven minutes.' },
    imageRight: { title: 'Setting up', image: cake, body: 'Tables went up at eight.' },
    fullImage: { image: cake, caption: 'The cake table at nine o\'clock' },
    bigNumber: { stat: '£1,240', statLabel: 'Raised for the library', body: 'Our best sale yet.' },
    threeCards: { title: 'Thank you', items: [{ heading: 'Bakers', body: 'Forty families' }, { heading: 'Helpers', body: 'Twelve parents' }, { heading: 'Buyers', body: 'Everyone' }] },
    quote: { quote: 'Best Friday of the year.', attribution: 'A Year 2 pupil' },
    comparison: { title: 'Year on year', table: [['', 'Last year', 'This year'], ['Raised', '£900', '£1,240'], ['Cakes', '160', '210']] },
    timeline: { title: 'The day', items: [{ heading: '8:00', body: 'Set up' }, { heading: '9:00', body: 'Doors open' }, { heading: '12:00', body: 'Sold out' }] }
  }
  const deck = emptyDeck()
  const ops: DeckOp[] = layoutIds.map((layout) => ({ op: 'add', layout, slots: slots[layout] }))
  const made = applyOps(deck, ops, slideIdMaker(deck))
  const [first, second] = made.added
  return applyOps(made.deck, [
    { op: 'setNotes', id: first, notes: 'Thank the PTA first.' },
    { op: 'hide', ids: [second], hidden: true }
  ], () => 'x').deck
}

async function pdfText(bytes: Uint8Array): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false } as never).promise
  const pages: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent()
    pages.push(content.items.map((it) => ('str' in it ? it.str : '')).join(' ').replace(/\s+/g, ' '))
  }
  await doc.loadingTask.destroy()
  return pages
}

describe('deck to PDF', () => {
  it('draws one page per shown slide, with real text in the deck font', async () => {
    const deck = sample()
    const bytes = await deckToPdf(deck, media, fonts)
    const doc = await PDFDocument.load(bytes)
    const shown = deck.slides.filter((s) => !s.hidden)
    expect(doc.getPageCount()).toBe(shown.length)
    expect(doc.getPage(0).getSize()).toEqual({ width: 960, height: 540 })
    expect(doc.getTitle()).toBe('Bake Sale Results')
    const pages = await pdfText(bytes)
    expect(pages[0]).toContain('Bake Sale Results')
    expect(pages[0]).toContain('Spring term, Year 5')
    // The hidden slide (section) is left out, so the bullets come second.
    expect(pages[1]).toContain('Lemon drizzle sold out by ten')
    expect(pages.join(' ')).not.toContain('What we sold')
    expect(pages.join(' ')).toContain('£1,240')
    expect(new TextDecoder('latin1').decode(bytes)).toMatch(/Urbanist/)
  })

  it('accepts a TrueType font as well, and a deck with no slides', async () => {
    const ttf = new Uint8Array(readFileSync(resolve(__dirname, '../node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf')))
    const bytes = await deckToPdf(sample(), new Map(), { regular: ttf })
    expect((await pdfText(bytes))[0]).toContain('Bake Sale Results')
    // A PDF needs a page, so a deck with nothing to show gets one blank slide.
    expect((await PDFDocument.load(await deckToPdf(emptyDeck(), media, fonts))).getPageCount()).toBe(1)
  })

  it('wraps at spaces and breaks words longer than a line', () => {
    const mono = { widthOfTextAtSize: (t: string, size: number) => t.length * size }
    expect(wrap('one two three', 70, 10, mono)).toEqual(['one two', 'three'])
    expect(wrap('abcdefghij', 40, 10, mono)).toEqual(['abcd', 'efgh', 'ij'])
    expect(wrap('  ', 40, 10, mono)).toEqual([''])
  })

  it('skips pictures it cannot draw instead of failing', async () => {
    const broken = new Map([['media/cake.png', new Uint8Array([1, 2, 3])]])
    expect((await PDFDocument.load(await deckToPdf(sample(), broken, fonts))).getPageCount()).toBe(11)
  })
})

describe('deck to PowerPoint', () => {
  it('writes every slide with its text, notes, hidden flag and pictures', async () => {
    const deck = sample()
    const zip = await JSZip.loadAsync(await deckToPptx(deck, media))
    const xml = (path: string) => zip.file(path)!.async('string')
    for (let i = 1; i <= deck.slides.length; i++) expect(zip.file(`ppt/slides/slide${i}.xml`), `slide${i}`).toBeTruthy()
    expect(zip.file(`ppt/slides/slide${deck.slides.length + 1}.xml`)).toBeNull()

    const first = await xml('ppt/slides/slide1.xml')
    expect(first).toContain('Bake Sale Results')
    expect(first).toContain('latin typeface="Urbanist"')
    // A title beside a picture is 110 slide units, which is 55 pt.
    expect(first).toMatch(/sz="5500"/)
    // Rounded picture corners: the title picture has the theme's radius.
    expect(first).toMatch(/<p:pic>[\s\S]*prst="roundRect"[\s\S]*<\/p:pic>/)

    const notes = await Promise.all(Object.keys(zip.files).filter((p) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(p)).map(xml))
    expect(notes.join('')).toContain('Thank the PTA first.')

    expect(await xml('ppt/slides/slide2.xml')).toMatch(/<p:sld[^>]* show="0"/)
    expect(await xml('ppt/slides/slide3.xml')).not.toMatch(/show="0"/)

    const bullets = await xml('ppt/slides/slide3.xml')
    expect(bullets).toContain('Lemon drizzle sold out by ten')
    expect(bullets).toContain('<a:buClr><a:srgbClr val="6312F6"/></a:buClr>')

    const all = await Promise.all(deck.slides.map((_, i) => xml(`ppt/slides/slide${i + 1}.xml`)))
    expect(all.join('')).toContain('£1,240')
    expect(Object.keys(zip.files).some((p) => p.startsWith('ppt/media/') && p.endsWith('.png'))).toBe(true)
  })

  it('crops pictures to cover their box at the focus point', async () => {
    const deck = sample()
    const zip = await JSZip.loadAsync(await deckToPptx(deck, media))
    // fullImage (slide 7): a 2:1 picture on a 16:9 slide is cropped left and right, 20% of the way from the left.
    const xml = await zip.file('ppt/slides/slide7.xml')!.async('string')
    const [, l, r, t, b] = /<a:srcRect l="(-?\d+)" r="(-?\d+)" t="(-?\d+)" b="(-?\d+)"/.exec(xml)!.map(Number)
    expect(t).toBe(0)
    expect(b).toBe(0)
    expect(l + r).toBeCloseTo(100000 * (1 - (16 / 9) / 2), -2)
    expect(l / (l + r)).toBeCloseTo(0.2, 2)
  })
})
