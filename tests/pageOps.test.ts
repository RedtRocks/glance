import { describe, expect, it } from 'vitest'
import { PDFDocument, PDFName, PDFRef, StandardFonts } from '@cantoo/pdf-lib'
import { labeledPdf } from './fixtures'
import {
  computeMoveOrder,
  deletePages,
  extractPages,
  insertBlankPage,
  insertImagePages,
  insertPdfPages,
  movePages,
  rotatePages
} from '../src/core/pageOps'

/** A PDF whose pages are labeled by width: page i is (100 + i) points wide. */
async function labeled(n: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 0; i < n; i++) {
    const p = doc.addPage([100 + i, 200])
    p.drawText(`Page ${i + 1}`, { x: 10, y: 100, size: 12, font })
  }
  doc.setTitle('Fixture')
  return doc.save()
}

async function widths(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes)
  return doc.getPages().map((p) => p.getWidth() - 100)
}

describe('computeMoveOrder', () => {
  it('moves a block forward and backward', () => {
    expect(computeMoveOrder(5, [0], 3)).toEqual([1, 2, 0, 3, 4])
    expect(computeMoveOrder(5, [3, 4], 0)).toEqual([3, 4, 0, 1, 2])
    expect(computeMoveOrder(5, [1, 3], 5)).toEqual([0, 2, 4, 1, 3])
  })
  it('is a no-op when dropping onto itself', () => {
    expect(computeMoveOrder(4, [2], 2)).toEqual([0, 1, 2, 3])
    expect(computeMoveOrder(4, [2], 3)).toEqual([0, 1, 2, 3])
  })
  it('ignores out-of-range indices and duplicates', () => {
    expect(computeMoveOrder(3, [9, 0, 0], 3)).toEqual([1, 2, 0])
  })
})

describe('page operations', () => {
  it('moves pages and keeps document metadata', async () => {
    const out = await movePages(await labeled(4), [3], 0)
    expect(await widths(out)).toEqual([3, 0, 1, 2])
    expect((await PDFDocument.load(out)).getTitle()).toBe('Fixture')
  })

  it('rotates selected pages, wrapping around 360', async () => {
    let bytes = await rotatePages(await labeled(3), [0, 2], -90)
    bytes = await rotatePages(bytes, [0], 180)
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPages().map((p) => p.getRotation().angle)).toEqual([90, 0, 270])
  })

  it('deletes pages but refuses to delete all of them', async () => {
    const src = await labeled(3)
    expect(await widths(await deletePages(src, [1]))).toEqual([0, 2])
    await expect(deletePages(src, [0, 1, 2])).rejects.toThrow(/at least one page/)
  })

  it('inserts a blank page sized like its neighbor', async () => {
    const out = await insertBlankPage(await labeled(2), 1)
    expect(await widths(out)).toEqual([0, 0, 1])
  })

  it('merges pages from another PDF at a position', async () => {
    const other = await labeled(3) // widths 0,1,2
    const base = await deletePages(await labeled(12), [...Array(10).keys()]) // widths 10, 11
    const out = await insertPdfPages(base, other, 1, [2, 0])
    expect(await widths(out)).toEqual([10, 2, 0, 11])
  })

  it('extracts pages into a standalone PDF', async () => {
    const out = await extractPages(await labeled(5), [4, 1])
    expect(await widths(out)).toEqual([4, 1])
  })

  it('inserts images as pages at their pixel size', async () => {
    // 1x1 red PNG
    const png = Uint8Array.from(
      atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='),
      (c) => c.charCodeAt(0)
    )
    const out = await insertImagePages(await labeled(1), [{ bytes: png, type: 'png' }], 1)
    const doc = await PDFDocument.load(out)
    expect(doc.getPageCount()).toBe(2)
    expect(doc.getPage(1).getSize()).toEqual({ width: 1, height: 1 })
    // A scan says its resolution: 1 px at 144 dpi is half a point.
    const scanned = await PDFDocument.load(await insertImagePages(await labeled(1), [{ bytes: png, type: 'png', dpi: 144 }], 1))
    expect(scanned.getPage(1).getSize()).toEqual({ width: 0.5, height: 0.5 })
  })
})

describe('nested page trees', () => {
  it('keeps inherited MediaBox and Rotate when reordering', async () => {
    // Build a PDF whose pages inherit MediaBox/Rotate from an intermediate Pages node.
    const doc = await PDFDocument.create()
    for (let i = 0; i < 3; i++) doc.addPage([100 + i, 200])
    const ctx = doc.context
    const rootRef = doc.catalog.get(PDFName.of('Pages')) as PDFRef
    const pages = doc.getPages()
    const mid = ctx.obj({
      Type: 'Pages',
      Kids: pages.slice(1).map((p) => p.ref),
      Count: 2,
      Parent: rootRef,
      MediaBox: [0, 0, 555, 666],
      Rotate: 90
    })
    const midRef = ctx.register(mid)
    for (const p of pages.slice(1)) {
      p.node.delete(PDFName.of('MediaBox'))
      p.node.set(PDFName.of('Parent'), midRef)
    }
    doc.catalog.Pages().set(PDFName.of('Kids'), ctx.obj([pages[0].ref, midRef]))
    const nested = await doc.save()

    const out = await PDFDocument.load(await movePages(nested, [0], 3))
    expect(out.getPageCount()).toBe(3)
    expect(out.getPages().map((p) => [p.getWidth(), p.getRotation().angle])).toEqual([
      [555, 90],
      [555, 90],
      [100, 0]
    ])
  })
})

describe('splitting', () => {
  it('groups pages every N, with a shorter last part', async () => {
    const { splitGroups } = await import('../src/core/pageOps')
    expect(splitGroups(5, { every: 2 })).toEqual([[0, 1], [2, 3], [4]])
    expect(splitGroups(3, { every: 1 })).toEqual([[0], [1], [2]])
  })
  it('starts a new part at each chosen page, ignoring the first and out-of-range pages', async () => {
    const { splitGroups } = await import('../src/core/pageOps')
    expect(splitGroups(6, { starts: [4, 2, 0, 9] })).toEqual([[0, 1], [2, 3], [4, 5]])
  })
  it('writes each part as its own PDF', async () => {
    const { splitPdf, splitGroups, pageCount } = await import('../src/core/pageOps')
    const parts = await splitPdf(await labeledPdf(5), splitGroups(5, { every: 2 }))
    expect(await Promise.all(parts.map(pageCount))).toEqual([2, 2, 1])
  })
})
