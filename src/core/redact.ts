/**
 * Redaction (ADR 0005): pages containing a redaction are replaced by a rasterized
 * image with the areas painted over *in the pixels*, and everything else that could
 * still carry the page's content is removed from the file.
 */
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef } from '@cantoo/pdf-lib'
import { collectGarbage } from './gc'
import type { Rect, Redaction } from './markup'

export interface Raster {
  bytes: Uint8Array
  type: 'jpg' | 'png'
}

/**
 * Renders page `pageIndex` (unrotated, covering its crop box) with `rects` (PDF space)
 * filled solid black, burned into the pixels.
 */
export type Rasterize = (pageIndex: number, rects: Rect[]) => Promise<Raster>

/** Page entries that can carry a copy of the page's content or metadata about it. */
const PAGE_KEYS_TO_DROP = ['Annots', 'Thumb', 'PieceInfo', 'Metadata', 'B', 'AA', 'StructParents', 'Group', 'SeparationInfo']

function removeFieldsFor(doc: PDFDocument, widgetRefs: Set<string>): void {
  const acro = doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict)
  const fields = acro?.lookupMaybe(PDFName.of('Fields'), PDFArray)
  if (!fields) return
  const prune = (arr: PDFArray): void => {
    for (let i = arr.size() - 1; i >= 0; i--) {
      const ref = arr.get(i)
      if (ref instanceof PDFRef && widgetRefs.has(ref.tag)) {
        arr.remove(i)
        continue
      }
      const field = doc.context.lookup(ref)
      if (!(field instanceof PDFDict)) continue
      const kids = field.lookupMaybe(PDFName.of('Kids'), PDFArray)
      if (kids) {
        prune(kids)
        if (kids.size() === 0) arr.remove(i)
      }
    }
  }
  prune(fields)
}

export async function applyRedactions(
  bytes: Uint8Array,
  redactions: Redaction[],
  rasterize: Rasterize,
  options: { objectStreams?: boolean } = {}
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
  const byPage = new Map<number, Rect[]>()
  for (const r of redactions) byPage.set(r.page, [...(byPage.get(r.page) ?? []), r.rect])
  if (!byPage.size) return bytes

  const ctx = doc.context
  const widgetRefs = new Set<string>()
  for (const [pageIndex, rects] of [...byPage].sort((a, b) => a[0] - b[0])) {
    const page = doc.getPage(pageIndex)
    const raster = await rasterize(pageIndex, rects)
    const image = raster.type === 'jpg' ? await doc.embedJpg(raster.bytes) : await doc.embedPng(raster.bytes)
    const box = page.getCropBox()

    for (const ref of page.node.Annots()?.asArray() ?? []) if (ref instanceof PDFRef) widgetRefs.add(ref.tag)

    // Replace the page's content in place, so bookmarks and links to this page keep working.
    const content = ctx.flateStream(`q ${box.width} 0 0 ${box.height} ${box.x} ${box.y} cm /Redacted Do Q`)
    page.node.set(PDFName.of('Contents'), ctx.register(content))
    page.node.set(PDFName.of('Resources'), ctx.obj({ XObject: { Redacted: image.ref } }))
    for (const key of PAGE_KEYS_TO_DROP) page.node.delete(PDFName.of(key))
  }

  removeFieldsFor(doc, widgetRefs)
  // The structure tree (tagged PDF) often duplicates page text as /ActualText or /Alt.
  doc.catalog.delete(PDFName.of('StructTreeRoot'))
  doc.catalog.delete(PDFName.of('MarkInfo'))

  collectGarbage(doc)
  return doc.save({ useObjectStreams: options.objectStreams ?? true, updateFieldAppearances: false })
}
