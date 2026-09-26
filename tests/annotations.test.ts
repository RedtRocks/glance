import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PDFDict, PDFDocument, PDFName, PDFRawStream, PDFStream, decodePDFRawStream } from '@cantoo/pdf-lib'
import { extractMarkup, writeMarkup } from '../src/core/annotations'
import { DEFAULT_STYLE, type Markup } from '../src/core/markup'
import { RED_PNG, labeledPdf, latin1 } from './fixtures'

const style = DEFAULT_STYLE
const all: Markup[] = [
  { id: 'a', page: 0, style, created: 1, type: 'rect', rect: [10, 10, 60, 40] },
  { id: 'b', page: 0, style, created: 1, type: 'roundRect', rect: [10, 50, 60, 80] },
  { id: 'c', page: 0, style: { ...style, fill: [0, 0, 1] }, created: 1, type: 'oval', rect: [10, 90, 60, 120] },
  { id: 'd', page: 0, style, created: 1, type: 'star', rect: [10, 130, 60, 180] },
  { id: 'e', page: 1, style, created: 1, type: 'bubble', rect: [10, 10, 80, 50] },
  { id: 'f', page: 1, style, created: 1, type: 'arrow', from: [10, 60], to: [80, 90] },
  { id: 'g', page: 1, style, created: 1, type: 'line', from: [10, 100], to: [80, 100] },
  { id: 'h', page: 1, style, created: 1, type: 'polygon', points: [[10, 110], [50, 150], [80, 110]], closed: true },
  { id: 'i', page: 1, style, created: 1, type: 'ink', strokes: [[[10, 160], [20, 170], [30, 165]]] },
  { id: 'j', page: 2, style, created: 1, type: 'text', rect: [5, 100, 95, 180], text: 'Hello Glance — café ✓', fontSize: 10, color: [0, 0, 0] },
  { id: 'k', page: 2, style, created: 1, type: 'note', at: [60, 60], text: 'Remember this' },
  { id: 'l', page: 2, style: { ...style, stroke: [1, 0.85, 0.2] }, created: 1, type: 'highlight', quads: [[5, 30, 90, 30, 5, 20, 90, 20]], contents: 'why?' },
  { id: 'm', page: 2, style, created: 1, type: 'underline', quads: [[5, 15, 90, 15, 5, 5, 90, 5]] },
  { id: 'n', page: 2, style, created: 1, type: 'strike', quads: [[5, 45, 90, 45, 5, 35, 90, 35]] },
  { id: 'o', page: 0, style, created: 1, type: 'signature', rect: [60, 10, 95, 30], png: RED_PNG },
  { id: 'p', page: 2, style, created: 1, type: 'squiggly', quads: [[5, 60, 90, 60, 5, 50, 90, 50]] },
  { id: 'q', page: 1, style, created: 1, type: 'loupe', rect: [20, 20, 80, 80], zoom: 2 }
]

describe('markup ↔ annotations', () => {
  it('round-trips every markup type exactly', async () => {
    const saved = await writeMarkup(await labeledPdf(3), all)
    const { bytes, markup } = await extractMarkup(saved)
    expect(markup.map((m) => m.id).sort()).toEqual(all.map((m) => m.id).sort())
    for (const original of all) {
      const back = markup.find((m) => m.id === original.id)!
      if (original.type === 'signature') {
        expect(back.type).toBe('signature')
        expect([...(back as typeof original).png]).toEqual([...original.png])
        expect((back as typeof original).rect).toEqual(original.rect)
      } else {
        expect(back).toEqual(original)
      }
    }
    // Extracted PDF no longer carries the annotations (they now live as editable markup).
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPages().every((p) => !p.node.Annots())).toBe(true)
  })

  it('writes standard subtypes with appearance streams other viewers can render', async () => {
    const doc = await PDFDocument.load(await writeMarkup(await labeledPdf(3), all))
    const subtypes = doc.getPages().flatMap((p) => {
      const annots = p.node.Annots()
      if (!annots) return []
      return annots.asArray().map((ref) => {
        const d = doc.context.lookup(ref) as import('@cantoo/pdf-lib').PDFDict
        expect(d.get(PDFName.of('AP'))).toBeTruthy()
        return d.get(PDFName.of('Subtype'))!.toString()
      })
    })
    expect(new Set(subtypes)).toEqual(
      new Set(['/Square', '/Polygon', '/Circle', '/Line', '/Ink', '/FreeText', '/Text', '/Highlight', '/Underline', '/StrikeOut', '/Squiggly', '/Stamp'])
    )
  })

  it('leaves no trace of markup that was deleted before saving', async () => {
    const secret: Markup = { id: 's', page: 0, style, created: 1, type: 'note', at: [10, 10], text: 'SECRET-NOTE-TEXT' }
    const once = await writeMarkup(await labeledPdf(1), [secret], { objectStreams: false })
    expect(latin1(once)).toMatch(/FEFF|SECRET/) // present while it exists
    const { bytes, markup } = await extractMarkup(once)
    expect(markup).toHaveLength(1)
    const resaved = await writeMarkup(bytes, [], { objectStreams: false })
    const doc = await PDFDocument.load(resaved)
    const text = doc.context
      .enumerateIndirectObjects()
      .map(([, o]) => o.toString())
      .join('\n')
    expect(text).not.toMatch(/GlanceData|SECRET/)
  })

  it('keeps annotations from other apps untouched', async () => {
    const doc = await PDFDocument.load(await labeledPdf(1))
    const foreign = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Square', Rect: [0, 0, 10, 10] }))
    doc.getPage(0).node.addAnnot(foreign)
    const { markup, bytes } = await extractMarkup(await doc.save())
    expect(markup).toHaveLength(0)
    expect((await PDFDocument.load(bytes)).getPage(0).node.Annots()?.size()).toBe(1)
  })
})

describe('loupe', () => {
  it('draws the page itself, magnified and clipped, as the appearance', async () => {
    const doc = await PDFDocument.load(await writeMarkup(await labeledPdf(1), [{ id: 'l', page: 0, style, created: 1, type: 'loupe', rect: [20, 20, 80, 80], zoom: 2.5 }]))
    const annot = doc.context.lookup(doc.getPage(0).node.Annots()!.get(0)) as PDFDict
    const ap = doc.context.lookup((doc.context.lookup(annot.get(PDFName.of('AP'))) as PDFDict).get(PDFName.of('N'))) as PDFStream
    const res = doc.context.lookup(ap.dict.get(PDFName.of('Resources'))) as PDFDict
    const xobj = doc.context.lookup(res.get(PDFName.of('XObject'))) as PDFDict
    const pg = doc.context.lookup(xobj.get(PDFName.of('Pg'))) as PDFStream
    expect(pg.dict.get(PDFName.of('Subtype'))!.toString()).toBe('/Form')
    const ops = latin1(ap instanceof PDFRawStream ? decodePDFRawStream(ap).decode() : ap.getContents())
    expect(ops).toMatch(/W\s+n/) // clipped to the circle
    expect(ops).toMatch(/2\.5 0 0 2\.5/) // magnified
    expect(ops).toContain('/Pg Do')
  })
})

describe('system fonts in text boxes', () => {
  const liberation = readFileSync(resolve(__dirname, '../node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf'))
  const box = (font?: string): Markup => ({
    id: 't', page: 0, style, created: 1, type: 'text', rect: [5, 100, 195, 180], text: 'Grüße Ωμέγα', fontSize: 12, color: [0, 0, 0], ...(font ? { font } : {})
  })
  const fontOf = async (bytes: Uint8Array) => {
    const doc = await PDFDocument.load(bytes)
    const annot = doc.context.lookup(doc.getPage(0).node.Annots()!.get(0)) as PDFDict
    const ap = doc.context.lookup((doc.context.lookup(annot.get(PDFName.of('AP'))) as PDFDict).get(PDFName.of('N'))) as PDFStream
    const fonts = doc.context.lookup(ap.dict.get(PDFName.of('Resources'))) as PDFDict
    const dict = doc.context.lookup(fonts.get(PDFName.of('Font'))) as PDFDict
    const [, ref] = dict.entries()[0]
    return doc.context.lookup(ref) as PDFDict
  }

  it('embeds the chosen font (subset) and keeps the family for editing', async () => {
    const asked: string[] = []
    const saved = await writeMarkup(await labeledPdf(1), [box('Liberation Sans')], {
      loadFont: async (f) => (asked.push(f), new Uint8Array(liberation))
    })
    expect(asked).toEqual(['Liberation Sans'])
    const font = await fontOf(saved)
    expect(font.get(PDFName.of('Subtype'))!.toString()).toBe('/Type0')
    expect(font.get(PDFName.of('BaseFont'))!.toString()).toMatch(/^\/LiberationSans/)
    // Subset: only the glyphs used, not the whole ~400 KB font.
    expect(saved.length).toBeLessThan(liberation.length / 4)
    const { markup } = await extractMarkup(saved)
    expect(markup[0]).toMatchObject({ type: 'text', font: 'Liberation Sans', text: 'Grüße Ωμέγα' })
  })

  it('falls back to Helvetica when the font is missing', async () => {
    const saved = await writeMarkup(await labeledPdf(1), [box('No Such Font')], { loadFont: async () => null })
    expect((await fontOf(saved)).get(PDFName.of('BaseFont'))!.toString()).toBe('/Helvetica')
  })
})

describe('interoperability', () => {
  it('PDF.js reads every annotation with its appearance', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const bytes = await writeMarkup(await labeledPdf(3), all)
    const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false } as never).promise
    const found: string[] = []
    for (let i = 1; i <= doc.numPages; i++) {
      const annots = await (await doc.getPage(i)).getAnnotations()
      for (const a of annots) {
        found.push(a.subtype)
        expect(a.hasAppearance ?? true).toBe(true)
      }
    }
    expect(found).toHaveLength(all.length)
    await doc.loadingTask.destroy()
  })
})
