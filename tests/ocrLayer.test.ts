import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PDFDocument } from '@cantoo/pdf-lib'
import { addTextLayer } from '../src/core/ocrLayer'

async function blankPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.addPage([612, 792])
  return doc.save()
}

async function textOf(bytes: Uint8Array) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false } as never).promise
  const content = await (await doc.getPage(1)).getTextContent()
  await doc.loadingTask.destroy()
  return content.items.filter((i) => 'str' in i && i.str.trim()) as { str: string; transform: number[]; width: number }[]
}

describe('OCR text layer', () => {
  it('makes recognized words extractable at their positions', async () => {
    const out = await addTextLayer(await blankPdf(), [
      {
        index: 0,
        words: [
          { text: 'Invoice', origin: [72, 700], end: [172, 700], top: [72, 724] },
          { text: '#4711', origin: [180, 700], end: [240, 700], top: [180, 724] }
        ]
      }
    ])
    const items = await textOf(out)
    const text = items.map((i) => i.str).join(' ')
    expect(text).toContain('Invoice')
    expect(text).toContain('#4711')
    const inv = items.find((i) => i.str.includes('Invoice'))!
    expect(inv.transform[4]).toBeCloseTo(72, 0)
    expect(inv.transform[5]).toBeGreaterThan(700)
    expect(inv.transform[5]).toBeLessThan(710)
    // Words are stretched to their recognized boxes: the run ends where "#4711" ends (240),
    // give or take the trailing space.
    const last = items.find((i) => i.str.includes('#4711'))!
    const end = last.transform[4] + last.width
    expect(end).toBeGreaterThan(238)
    expect(end).toBeLessThan(262)
  })

  it('keeps non-Latin text with an embedded Unicode font', async () => {
    const liberation = readFileSync(resolve(__dirname, '../node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf'))
    const out = await addTextLayer(await blankPdf(), [{ index: 0, words: [{ text: 'Ωμέγα', origin: [72, 600], end: [150, 600], top: [72, 620] }] }], {
      loadFont: async () => new Uint8Array(liberation),
      family: 'Liberation Sans'
    })
    expect((await textOf(out)).map((i) => i.str).join('')).toContain('Ωμέγα')
  })

  it('follows rotated text direction', async () => {
    const out = await addTextLayer(await blankPdf(), [{ index: 0, words: [{ text: 'UP', origin: [300, 300], end: [300, 360], top: [276, 300] }] }])
    const [item] = await textOf(out)
    const [a, b] = item.transform
    expect(Math.abs(a)).toBeLessThan(1e-6 + Math.abs(b)) // runs vertically
  })
})
