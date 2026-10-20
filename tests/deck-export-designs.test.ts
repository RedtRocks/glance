import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import JSZip from 'jszip'
import { PDFDocument } from '@cantoo/pdf-lib'
import fontkit from '@cantoo/fontkit'
import { BOARD_LOADERS } from '../src/deck/designs'
import { boardDeck } from '../src/core/deck/template'
import { applyOps } from '../src/core/deck/ops'
import { slideIdMaker } from '../src/core/deck/model'
import type { Board } from '../src/core/deck/design'
import { deckToPdf, instanceFont } from '../src/deck/exportPdf'
import { deckToPptx } from '../src/deck/exportPptx'

const font = (name: string) => new Uint8Array(readFileSync(resolve(__dirname, `../src/styles/fonts/${name}.woff2`)))
const FILES: Record<string, string> = {
  'Urbanist|false': 'urbanist', 'Fraunces|false': 'fraunces', 'Fraunces|true': 'fraunces-italic', 'Bricolage Grotesque|false': 'bricolage-grotesque',
  'Space Grotesk|false': 'space-grotesk', 'Caveat|false': 'caveat', 'DM Serif Display|false': 'dm-serif-display', 'DM Serif Display|true': 'dm-serif-display-italic'
}
const fonts = {
  regular: font('urbanist'),
  file: async (family: string, italic: boolean) => {
    const name = FILES[`${family}|${italic}`] ?? FILES[`${family}|false`]
    return name ? { bytes: font(name), italic: italic && !!FILES[`${family}|true`] } : null
  }
}
// A 4 by 2 picture stands in for the art, which a browser draws (raster.ts).
const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAIAAADwyuo0AAAAGElEQVR4nGNIFvqWLPTt/wmG/ycYGJA5AKOiDMma1gVAAAAAAElFTkSuQmCC', 'base64'))

async function designed(id: string) {
  const board: Board = await BOARD_LOADERS[id]()
  const lookup = (d: string) => board.designs.find((x) => x.id === d)
  const arts: string[] = []
  return { board, deck: boardDeck(board), lookup, arts, art: async (d: { id: string; over?: string }) => (arts.push(d.id), { art: png, over: d.over ? png : undefined }) }
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

describe('designed slides to PDF', () => {
  it('draws the art as a picture and the text as real text in the design fonts', async () => {
    const { deck, lookup, art, arts } = await designed('bakeSale')
    const edited = applyOps(deck, [{ op: 'setSlot', id: deck.slides[0].id, slot: 'title', value: 'Autumn Cake Day' }], slideIdMaker(deck), lookup).deck
    const bytes = await deckToPdf(edited, new Map(), fonts, { designs: lookup, art })
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(6)
    expect(arts).toEqual(edited.slides.map((s) => s.design))
    const pages = await pdfText(bytes)
    expect(pages[0]).toContain('Autumn Cake Day')
    expect(pages[0]).toContain('School hall, Elm Road')
    expect(pages[2]).toContain('Three Ways to Help')
    expect(new TextDecoder('latin1').decode(bytes)).toMatch(/BricolageGrotesque/)
  })

  it('sets a variable font to the box’s weight, with the widths of that weight', () => {
    const at = (wght: number) => {
      const { ttf, face } = instanceFont(font('urbanist'), { wght })
      const plain = fontkit.create(Buffer.from(ttf) as never) as unknown as { variationAxes: object; layout(t: string): { positions: { xAdvance: number }[] } }
      expect(Object.keys(plain.variationAxes)).toEqual([])
      const width = (f: typeof plain) => f.layout('Hello world').positions.reduce((n, p) => n + p.xAdvance, 0)
      return { plain: width(plain), face: width(face as never) }
    }
    const regular = at(400)
    const bold = at(800)
    expect(bold.face).toBeGreaterThan(regular.face * 1.03)
    // The saved instance's own advances match within kerning.
    expect(Math.abs(bold.plain - bold.face) / bold.face).toBeLessThan(0.02)
  })

  it('keeps under-art text under the over picture, and turned boxes turned', async () => {
    const { deck, lookup, art } = await designed('funRun')
    const bytes = await deckToPdf(deck, new Map(), fonts, { designs: lookup, art })
    const pages = await pdfText(bytes)
    expect(pages[0]).toContain('Paws for a Cause')
    expect(pages[0]).toContain('5K')
    // Two pictures (art, then over) with text drawn between them, and text after; a turned box is turned.
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false } as never).promise
    const list = await (await doc.getPage(1)).getOperatorList()
    const { OPS } = pdfjs
    const draws = list.fnArray.flatMap((fn) => (fn === OPS.paintImageXObject ? ['img'] : fn === OPS.showText ? ['text'] : []))
    expect(draws[0]).toBe('img')
    const second = draws.indexOf('img', 1)
    expect(second).toBeGreaterThan(1)
    expect(draws.slice(second + 1)).toContain('text')
    const turns = list.fnArray.flatMap((fn, i) => (fn === OPS.transform ? [list.argsArray[i] as number[]] : [])).filter((m) => Math.abs(m[1]) > 0.01)
    expect(turns.length).toBeGreaterThan(0)
    await doc.loadingTask.destroy()
  })
})

describe('designed slides to PowerPoint', () => {
  it('puts the art in as a full-slide picture and each text box as real text in the design font', async () => {
    const { deck, lookup, art } = await designed('funRun')
    const bytes = await deckToPptx(deck, new Map(), { designs: lookup, art })
    const zip = await JSZip.loadAsync(bytes)
    const xml = await zip.file('ppt/slides/slide1.xml')!.async('string')
    expect(xml).toContain('Paws for a Cause')
    expect(xml).toContain('typeface="Bricolage Grotesque"')
    expect(xml).toContain('typeface="Space Grotesk"')
    // The full-slide art: 13.333 by 7.5 inches in EMU.
    expect(xml).toMatch(/<a:ext cx="12192000" cy="6858000"\/>/)
    // Turned text boxes keep their turn (PowerPoint counts 60000 to a degree).
    expect(xml).toMatch(/<a:xfrm rot="-?\d+"/)
    // The art, the text boxes the over art covers, the over art, then the rest.
    const order = [...xml.matchAll(/<p:pic>|<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1] ?? 'picture')
    expect(order[0]).toBe('picture')
    const over = order.indexOf('picture', 1)
    expect(order.slice(1, over)).toContain('5K')
    expect(order.slice(over + 1)).toContain('Sun 9 May 2027')
  })
})
