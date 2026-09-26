/**
 * PDF page management on raw bytes (pdf-lib). Every function returns new bytes and
 * leaves document-level data (outline, metadata, forms) intact.
 */
import { PDFDocument, PDFName, PDFNumber, degrees, type PDFPage } from '@cantoo/pdf-lib'

async function load(bytes: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
}

async function save(doc: PDFDocument): Promise<Uint8Array> {
  return doc.save({ useObjectStreams: true, updateFieldAppearances: false })
}

/**
 * New page order after moving `moving` (original indices) so they land before
 * original index `to` (use `n` for the end). Moved pages keep their relative order.
 */
export function computeMoveOrder(n: number, moving: number[], to: number): number[] {
  const set = new Set(moving.filter((i) => i >= 0 && i < n))
  const moved = [...set].sort((a, b) => a - b)
  const rest: number[] = []
  let insertAt = 0
  for (let i = 0; i < n; i++) {
    if (set.has(i)) continue
    if (i < to) insertAt++
    rest.push(i)
  }
  rest.splice(insertAt, 0, ...moved)
  return rest
}

const INHERITABLE = ['Resources', 'MediaBox', 'CropBox', 'Rotate'].map((n) => PDFName.of(n))

/**
 * Rebuilds the page tree in `order` (order[i] = source index of new page i) as one flat
 * list under the root. Inheritable attributes are copied onto each page first, so pages
 * that lived in nested subtrees keep their size, rotation and resources.
 */
async function reorder(doc: PDFDocument, order: number[]): Promise<void> {
  const pages = doc.getPages()
  for (const page of pages) {
    for (const name of INHERITABLE) {
      if (!page.node.get(name)) {
        const inherited = page.node.getInheritableAttribute(name)
        if (inherited) page.node.set(name, inherited)
      }
    }
  }
  const rootRef = doc.catalog.get(PDFName.of('Pages'))!
  const root = doc.catalog.Pages()
  root.set(PDFName.of('Kids'), doc.context.obj(order.map((i) => pages[i].ref)))
  root.set(PDFName.of('Count'), PDFNumber.of(order.length))
  for (const page of pages) page.node.set(PDFName.of('Parent'), rootRef)
}

export async function movePages(bytes: Uint8Array, moving: number[], to: number): Promise<Uint8Array> {
  const doc = await load(bytes)
  const order = computeMoveOrder(doc.getPageCount(), moving, to)
  await reorder(doc, order)
  return save(doc)
}

export async function reorderPages(bytes: Uint8Array, order: number[]): Promise<Uint8Array> {
  const doc = await load(bytes)
  await reorder(doc, order)
  return save(doc)
}

export async function rotatePages(bytes: Uint8Array, indices: number[], delta: 90 | -90 | 180): Promise<Uint8Array> {
  const doc = await load(bytes)
  for (const i of indices) {
    const page = doc.getPage(i)
    const next = (((page.getRotation().angle + delta) % 360) + 360) % 360
    page.setRotation(degrees(next))
  }
  return save(doc)
}

export async function deletePages(bytes: Uint8Array, indices: number[]): Promise<Uint8Array> {
  const doc = await load(bytes)
  if (indices.length >= doc.getPageCount()) throw new Error('A document must keep at least one page.')
  for (const i of [...new Set(indices)].sort((a, b) => b - a)) doc.removePage(i)
  return save(doc)
}

function pageSize(page: PDFPage | undefined): [number, number] {
  if (!page) return [612, 792] // US Letter
  const { width, height } = page.getSize()
  const r = page.getRotation().angle % 180 !== 0
  return r ? [height, width] : [width, height]
}

/** Inserts a blank page at `at`, sized like its neighbor. */
export async function insertBlankPage(bytes: Uint8Array, at: number): Promise<Uint8Array> {
  const doc = await load(bytes)
  const n = doc.getPageCount()
  const neighbor = doc.getPages()[Math.min(Math.max(at - 1, 0), n - 1)]
  doc.insertPage(Math.min(at, n), pageSize(neighbor))
  return save(doc)
}

/** Copies pages of another PDF into this one at `at`. */
export async function insertPdfPages(
  bytes: Uint8Array,
  source: Uint8Array,
  at: number,
  sourceIndices?: number[]
): Promise<Uint8Array> {
  const doc = await load(bytes)
  const src = await load(source)
  const indices = sourceIndices ?? src.getPageIndices()
  const copied = await doc.copyPages(src, indices)
  const start = Math.min(at, doc.getPageCount())
  copied.forEach((p, k) => doc.insertPage(start + k, p))
  return save(doc)
}

export interface ImageInput {
  bytes: Uint8Array
  type: 'png' | 'jpg'
}

/** Adds each image as its own page, page size = image size at 72 DPI (as Preview does). */
async function addImagePages(doc: PDFDocument, images: ImageInput[], at: number): Promise<void> {
  let pos = Math.min(at, doc.getPageCount())
  for (const img of images) {
    const embedded = img.type === 'png' ? await doc.embedPng(img.bytes) : await doc.embedJpg(img.bytes)
    const page = doc.insertPage(pos++, [embedded.width, embedded.height])
    page.drawImage(embedded, { x: 0, y: 0, width: embedded.width, height: embedded.height })
  }
}

export async function insertImagePages(bytes: Uint8Array, images: ImageInput[], at: number): Promise<Uint8Array> {
  const doc = await load(bytes)
  await addImagePages(doc, images, at)
  return save(doc)
}

export async function pdfFromImages(images: ImageInput[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  await addImagePages(doc, images, 0)
  return save(doc)
}

/** A new standalone PDF with just these pages (Drag Out, Export Selected Pages). */
export async function extractPages(bytes: Uint8Array, indices: number[]): Promise<Uint8Array> {
  const src = await load(bytes)
  const out = await PDFDocument.create()
  const copied = await out.copyPages(src, indices)
  copied.forEach((p) => out.addPage(p))
  return save(out)
}

/** Splits a PDF into consecutive parts of `size` pages (the last may be shorter), or at page starts. */
export function splitGroups(n: number, opts: { every: number } | { starts: number[] }): number[][] {
  const starts = 'every' in opts
    ? Array.from({ length: Math.ceil(n / Math.max(1, opts.every)) }, (_, k) => k * Math.max(1, opts.every))
    : [...new Set([0, ...opts.starts.filter((s) => s > 0 && s < n)])].sort((a, b) => a - b)
  return starts.map((s, k) => Array.from({ length: (starts[k + 1] ?? n) - s }, (_, i) => s + i))
}

export async function splitPdf(bytes: Uint8Array, groups: number[][]): Promise<Uint8Array[]> {
  const out: Uint8Array[] = []
  for (const g of groups) out.push(await extractPages(bytes, g))
  return out
}

export async function pageCount(bytes: Uint8Array): Promise<number> {
  return (await load(bytes)).getPageCount()
}
