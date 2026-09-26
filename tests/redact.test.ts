import { describe, expect, it } from 'vitest'
import { PDFDocument, PDFName, StandardFonts } from '@cantoo/pdf-lib'
import { applyRedactions, type Rasterize } from '../src/core/redact'
import { RED_PNG, reveals } from './fixtures'

/** Page 1 holds secrets in every place a PDF can hide them; page 2 is public. */
async function secretPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const text = (p: ReturnType<typeof doc.addPage>, s: string) => {
    // Uncompressed on purpose, so the test can search the raw bytes.
    p.node.set(PDFName.of('Contents'), doc.context.register(doc.context.stream(`BT /F1 12 Tf 20 150 Td (${s}) Tj ET`)))
    p.node.set(PDFName.of('Resources'), doc.context.obj({ Font: { F1: font.ref } }))
  }
  const p1 = doc.addPage([200, 200])
  text(p1, 'SECRET-123')
  const p2 = doc.addPage([200, 200])
  text(p2, 'PUBLIC-TEXT')
  // A filled form field on the secret page.
  const field = doc.getForm().createTextField('ssn')
  field.setText('SECRET-FIELD')
  field.addToPage(p1, { x: 20, y: 20, width: 120, height: 20 })
  // A page thumbnail and tagged-PDF alt text duplicating the content.
  p1.node.set(PDFName.of('Thumb'), doc.context.register(doc.context.stream('SECRET-THUMB')))
  doc.catalog.set(PDFName.of('StructTreeRoot'), doc.context.obj({ Type: 'StructTreeRoot', ActualText: 'SECRET-ALT' }))
  doc.catalog.set(PDFName.of('Outlines'), doc.context.obj({ Type: 'Outlines' }))
  return doc.save({ useObjectStreams: false })
}

const fakeRaster: Rasterize = async () => ({ bytes: RED_PNG, type: 'png' })

describe('redaction', () => {
  it('removes every trace of the redacted page but keeps other pages', async () => {
    const before = await secretPdf()
    for (const s of ['SECRET-123', 'SECRET-FIELD', 'SECRET-THUMB', 'SECRET-ALT', 'PUBLIC-TEXT']) expect(await reveals(before, s)).toBe(true)

    const calls: number[] = []
    const raster: Rasterize = async (page, rects) => {
      calls.push(page)
      expect(rects).toEqual([[10, 140, 120, 170]])
      return fakeRaster(page, rects)
    }
    const after = await applyRedactions(before, [{ id: 'r', page: 0, rect: [10, 140, 120, 170] }], raster, { objectStreams: false })
    for (const s of ['SECRET-123', 'SECRET-FIELD', 'SECRET-THUMB', 'SECRET-ALT']) expect(await reveals(after, s), s).toBe(false)
    expect(await reveals(after, 'PUBLIC-TEXT')).toBe(true)
    expect(calls).toEqual([0])

    const doc = await PDFDocument.load(after)
    expect(doc.getPageCount()).toBe(2)
    expect(doc.getPage(0).getSize()).toEqual({ width: 200, height: 200 })
    expect(doc.getPage(0).node.Annots()).toBeUndefined()
    expect(doc.getForm().getFields()).toHaveLength(0)
    expect(doc.catalog.get(PDFName.of('Outlines'))).toBeTruthy()
  })

  it('is a no-op without redactions', async () => {
    const before = await secretPdf()
    expect(await applyRedactions(before, [], fakeRaster)).toBe(before)
  })

  it('leaves no text PDF.js can extract on the redacted page', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const after = await applyRedactions(await secretPdf(), [{ id: 'r', page: 0, rect: [0, 0, 200, 200] }], fakeRaster)
    const doc = await pdfjs.getDocument({ data: after.slice() } as never).promise
    const t1 = await (await doc.getPage(1)).getTextContent()
    const t2 = await (await doc.getPage(2)).getTextContent()
    expect(t1.items).toHaveLength(0)
    expect(t2.items.map((i) => ('str' in i ? i.str : '')).join('')).toContain('PUBLIC-TEXT')
    await doc.loadingTask.destroy()
  })
})
