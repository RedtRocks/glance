import { describe, expect, it } from 'vitest'
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFString, StandardFonts, decodePDFRawStream, type PDFObject } from '@cantoo/pdf-lib'
import { appendedShare, cleanUp, compact } from '../src/core/cleanup'
import { latin1 } from './fixtures'

/** Every object in the file, decoded (object streams and Flate included). */
async function allText(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes)
  let out = ''
  const strings = (o: PDFObject | undefined): void => {
    if (o instanceof PDFString || o instanceof PDFHexString) out += ' ' + o.decodeText()
    else if (o instanceof PDFDict) for (const [, v] of o.entries()) strings(v)
    else if (o instanceof PDFArray) for (let i = 0; i < o.size(); i++) strings(o.get(i))
  }
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    strings(obj instanceof PDFRawStream ? obj.dict : obj)
    if (obj instanceof PDFRawStream) {
      out += obj.dict.toString()
      try {
        out += latin1(decodePDFRawStream(obj).decode())
      } catch {
        out += latin1(obj.contents)
      }
    } else out += obj.toString()
  }
  // Info strings are hex/UTF-16 in pdf-lib; decode them too.
  const info = doc.getTitle() ?? ''
  return out + info + (doc.getAuthor() ?? '')
}

const ALL = { annotations: true, links: true, metadata: true, attachments: true, javascript: true }
const NONE = { annotations: false, links: false, metadata: false, attachments: false, javascript: false }

async function busyPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle('Secret project')
  doc.setAuthor('Jane Doe')
  const page = doc.addPage([300, 300])
  page.drawText('Hello', { x: 20, y: 250, font: await doc.embedFont(StandardFonts.Helvetica) })
  const c = doc.context
  const link = c.register(c.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 50, 50], A: { S: 'URI', URI: PDFString.of('https://example.com/tracker') } }))
  const note = c.register(c.obj({ Type: 'Annot', Subtype: 'Text', Rect: [60, 60, 80, 80], Contents: PDFString.of('internal note: fire Bob') }))
  const jsAnnot = c.register(c.obj({ Type: 'Annot', Subtype: 'Widget', Rect: [100, 100, 150, 120], A: { S: 'JavaScript', JS: PDFString.of('app.alert("hi")') } }))
  page.node.set(PDFName.of('Annots'), c.obj([link, note, jsAnnot]))
  await doc.attach(new TextEncoder().encode('salary data'), 'salaries.csv', { mimeType: 'text/csv' })
  doc.addJavaScript('onOpen', 'app.alert("tracking")')
  return doc.save({ useObjectStreams: false })
}

describe('Clean Up PDF', () => {
  it('removes annotations, links, metadata, attachments and scripts, and the data is gone from the file', async () => {
    const before = await busyPdf()
    const original = await allText(before)
    for (const secret of ['tracker', 'fire Bob', 'salary data', 'tracking', 'app.alert', 'Secret project', 'Jane Doe']) expect(original).toContain(secret)
    const { bytes, report } = await cleanUp(before, ALL)
    expect(report).toMatchObject({ annotations: 1, links: 1, metadata: true, attachments: 1 })
    expect(report.scripts).toBeGreaterThanOrEqual(2)
    const text = await allText(bytes)
    for (const secret of ['tracker', 'fire Bob', 'salary data', 'tracking', 'app.alert', 'Secret project', 'Jane Doe']) expect(text).not.toContain(secret)
    // Form fields stay (without their script); page content stays.
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPage(0).node.Annots()!.size()).toBe(1)
  })

  it('removes only what was asked', async () => {
    const { bytes, report } = await cleanUp(await busyPdf(), { ...NONE, links: true })
    expect(report).toMatchObject({ links: 1, annotations: 0, attachments: 0, scripts: 0, metadata: false })
    const text = await allText(bytes)
    expect(text).not.toContain('tracker')
    expect(text).toContain('fire Bob')
  })

  it('measures appended incremental updates and compacts them away', async () => {
    const base = await busyPdf()
    expect(appendedShare(base)).toBe(0)
    const update = new TextEncoder().encode('\n1 0 obj\n<< /Junk (' + 'x'.repeat(base.length) + ') >>\nendobj\ntrailer\n<< >>\n%%EOF\n')
    const grown = new Uint8Array(base.length + update.length)
    grown.set(base)
    grown.set(update, base.length)
    expect(appendedShare(grown)).toBeGreaterThan(0.25)
    const small = await compact(base)
    expect(appendedShare(small)).toBe(0)
  })
})
