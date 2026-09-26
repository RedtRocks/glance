import { describe, expect, it } from 'vitest'
import { degrees, PDFDocument, StandardFonts } from '@cantoo/pdf-lib'
import { DEFAULT_STAMPS, expandTokens, extractPage, parsePageRange, stampPdf, type StampOptions } from '../src/core/stamps'
import { RED_PNG } from './fixtures'

/** Letter-size pages labeled "Page n". */
async function labeledPdf(n: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 0; i < n; i++) doc.addPage([612, 792]).drawText(`Page ${i + 1}`, { x: 300, y: 400, size: 12, font })
  return doc.save()
}

const env = { fileName: 'Report.pdf', date: '26/09/2026' }
const opts = (o: Partial<StampOptions>): StampOptions => ({ ...DEFAULT_STAMPS, ...o })

/** Text items per page, with positions in the page's displayed (rotated) space. */
async function read(bytes: Uint8Array) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false } as never)
  try {
    const doc = await task.promise
    const pages = []
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const vp = page.getViewport({ scale: 1 })
      const items = (await page.getTextContent()).items.flatMap((it) => {
        if (!('str' in it) || !it.str.trim()) return []
        const [a, b, c, d, e, f] = vp.transform
        const [px, py] = [it.transform[4], it.transform[5]]
        const [x, y] = [a * px + c * py + e, b * px + d * py + f]
        return [{ str: it.str, x, y, w: vp.width, h: vp.height }]
      })
      pages.push(items)
    }
    return pages
  } finally {
    await task.destroy()
  }
}

describe('page ranges', () => {
  it('reads lists, open ends and blanks', () => {
    expect(parsePageRange('', 3)).toEqual([0, 1, 2])
    expect(parsePageRange('1-3, 5', 10)).toEqual([0, 1, 2, 4])
    expect(parsePageRange('8-', 10)).toEqual([7, 8, 9])
    expect(parsePageRange('-2', 10)).toEqual([0, 1])
    expect(parsePageRange('2, 2, 1', 10)).toEqual([0, 1])
    expect(parsePageRange('4-20', 5)).toEqual([3, 4])
  })
  it('rejects nonsense', () => {
    expect(parsePageRange('abc', 5)).toBeNull()
    expect(parsePageRange('3-1', 5)).toBeNull()
    expect(parsePageRange('0', 5)).toBeNull()
    expect(parsePageRange('-', 5)).toBeNull()
  })
})

describe('tokens', () => {
  it('expands page, pages, date and file', () => {
    expect(expandTokens('{file}: Page {page} of {PAGES}, {date}', { page: 2, pages: 9, date: 'today', file: 'a.pdf' })).toBe('a.pdf: Page 2 of 9, today')
  })
})

describe('stamping', () => {
  it('numbers pages in the footer and writes headers at the top', async () => {
    const out = await stampPdf(await labeledPdf(3), opts({ header: { left: '{file}', center: '', right: '{date}' } }), env)
    const pages = await read(out)
    expect(pages).toHaveLength(3)
    for (const [i, items] of pages.entries()) {
      const footer = items.find((t) => t.str === `Page ${i + 1} of 3`)
      expect(footer).toBeDefined()
      expect(footer!.y).toBeGreaterThan(footer!.h * 0.8) // viewport y grows downward: bottom of the page
      const file = items.find((t) => t.str === 'Report.pdf')!
      expect(file.y).toBeLessThan(file.h * 0.2)
      expect(file.x).toBeLessThan(file.w / 2)
      expect(items.find((t) => t.str === '26/09/2026')!.x).toBeGreaterThan(file.w / 2)
      expect(items.some((t) => t.str === `Page ${i + 1}`)).toBe(true) // original content kept
    }
  })

  it('stamps only the selected pages and numbers from the start number', async () => {
    const out = await stampPdf(await labeledPdf(4), opts({ pages: '2-3', startNumber: 5, footer: { left: '', center: '{page}/{pages}', right: '' } }), env)
    const pages = await read(out)
    expect(pages[0].map((t) => t.str)).toEqual(['Page 1'])
    expect(pages[1].some((t) => t.str === '5/6')).toBe(true)
    expect(pages[2].some((t) => t.str === '6/6')).toBe(true)
    expect(pages[3].map((t) => t.str)).toEqual(['Page 4'])
  })

  it('puts the header at the top of a page stored sideways', async () => {
    for (const angle of [90, 180, 270]) {
      const src = await PDFDocument.load(await labeledPdf(1))
      src.getPage(0).setRotation(degrees(angle))
      const out = await stampPdf(await src.save(), opts({ header: { left: 'TOPLEFT', center: '', right: '' }, footer: { left: '', center: '', right: 'BOTTOMRIGHT' } }), env)
      const [items] = await read(out)
      const top = items.find((t) => t.str === 'TOPLEFT')!
      const bottom = items.find((t) => t.str === 'BOTTOMRIGHT')!
      expect(top.y, `${angle}°`).toBeLessThan(top.h * 0.3)
      expect(top.x, `${angle}°`).toBeLessThan(top.w * 0.4)
      expect(bottom.y, `${angle}°`).toBeGreaterThan(bottom.h * 0.7)
      expect(bottom.x, `${angle}°`).toBeGreaterThan(bottom.w * 0.3)
    }
  })

  it('adds a text watermark and an image watermark', async () => {
    const text = await stampPdf(await labeledPdf(2), opts({ footer: { left: '', center: '', right: '' }, watermark: { kind: 'text', text: 'DRAFT', size: 0, angle: 45, color: '#808080' } }), env)
    for (const items of await read(text)) expect(items.some((t) => t.str === 'DRAFT')).toBe(true)
    const image = await stampPdf(await labeledPdf(1), opts({ watermark: { kind: 'image', bytes: RED_PNG, type: 'png', scale: 0.5 } }), env)
    const doc = await PDFDocument.load(image)
    expect(doc.getPage(0).node.Resources()!.toString()).toContain('XObject')
  })

  it('previews one page as if it were part of the whole document', async () => {
    const page = await extractPage(await labeledPdf(5), 3)
    const out = await stampPdf(page, opts({}), env, { index: 3, pageCount: 5 })
    const [items] = await read(out)
    expect(items.map((t) => t.str)).toContain('Page 4 of 5')
    expect(items.map((t) => t.str)).toContain('Page 4')
  })

  it('refuses an unreadable page range', async () => {
    await expect(stampPdf(await labeledPdf(1), opts({ pages: 'x' }), env)).rejects.toThrow(/page range/)
  })
})
