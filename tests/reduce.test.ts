import { describe, expect, it } from 'vitest'
import { PDFDocument, PDFName, PDFNumber, PDFRawStream } from '@cantoo/pdf-lib'
import { reduceFileSize, type Recompress } from '../src/core/reduce'

/** A PDF with one large raw RGB image (noise, so Flate can't shrink it much). */
async function pdfWithImage(w: number, h: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([600, 400])
  const px = new Uint8Array(w * h * 3)
  let x = 7
  for (let i = 0; i < px.length; i++) px[i] = (x = (x * 1103515245 + 12345) & 0x7fffffff) >> 16
  const img = doc.context.register(doc.context.flateStream(px, { Type: 'XObject', Subtype: 'Image', Width: w, Height: h, ColorSpace: 'DeviceRGB', BitsPerComponent: 8 }))
  page.node.setXObject(PDFName.of('Im0'), img)
  return doc.save()
}

// Stand-in for the canvas encoder: scales dimensions and returns a small "JPEG".
const fake: Recompress = async (img, maxSide) => {
  const s = Math.min(1, maxSide / Math.max(img.width, img.height))
  return { jpeg: new Uint8Array(1000).fill(0xff), width: Math.round(img.width * s), height: Math.round(img.height * s), gray: img.kind === 'gray' }
}

describe('Reduce File Size', () => {
  it('replaces large images with smaller JPEG streams and shrinks the file', async () => {
    const before = await pdfWithImage(800, 600)
    const { bytes, images, after } = await reduceFileSize(before, { maxSide: 400, quality: 0.6 }, fake)
    expect(images).toBe(1)
    expect(after).toBeLessThan(before.length / 10)
    const doc = await PDFDocument.load(bytes)
    const xobj = [...doc.context.enumerateIndirectObjects()].map(([, o]) => o).find((o) => o instanceof PDFRawStream && o.dict.get(PDFName.of('Subtype'))?.toString() === '/Image') as PDFRawStream
    expect(xobj.dict.get(PDFName.of('Filter'))!.toString()).toBe('/DCTDecode')
    expect((xobj.dict.get(PDFName.of('Width')) as PDFNumber).asNumber()).toBe(400)
    expect((xobj.dict.get(PDFName.of('Height')) as PDFNumber).asNumber()).toBe(300)
  })

  it('keeps an image when recompressing would not help', async () => {
    const before = await pdfWithImage(20, 20)
    const big: Recompress = async (img) => ({ jpeg: new Uint8Array(1_000_000), width: img.width, height: img.height, gray: false })
    const { images } = await reduceFileSize(before, { maxSide: 400, quality: 0.6 }, big)
    expect(images).toBe(0)
  })
})
