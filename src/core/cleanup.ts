/**
 * Clean Up PDF (Preview's "remove annotations/links" plus privacy scrubbing) and
 * compaction (ADR 0007). Everything removed is also garbage-collected, so the data
 * is really gone from the file rather than merely unreferenced.
 */
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef, type PDFObject } from '@cantoo/pdf-lib'
import { collectGarbage } from './gc'

export interface CleanupOptions {
  /** Comments and markup from other apps (not links or form fields). */
  annotations: boolean
  links: boolean
  /** Title, author, producer, dates and the XMP packet. */
  metadata: boolean
  /** Embedded files and file-attachment annotations. */
  attachments: boolean
  /** Document, page and annotation JavaScript. */
  javascript: boolean
}

export interface CleanupReport {
  annotations: number
  links: number
  metadata: boolean
  attachments: number
  scripts: number
  before: number
  after: number
}

const N = (s: string) => PDFName.of(s)
const KEEP = new Set(['/Widget']) // form fields stay
const INFO_KEYS = ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer', 'CreationDate', 'ModDate', 'Trapped']

function dictOf(doc: PDFDocument, o: PDFObject | undefined): PDFDict | undefined {
  const v = o instanceof PDFRef ? doc.context.lookup(o) : o
  return v instanceof PDFDict ? v : undefined
}

function isJavaScriptAction(doc: PDFDocument, o: PDFObject | undefined): boolean {
  const d = dictOf(doc, o)
  return d?.get(N('S'))?.toString() === '/JavaScript'
}

/** Name-tree entries under Names/<key>, counted. */
function countNameTree(doc: PDFDocument, root: PDFDict | undefined): number {
  if (!root) return 0
  const names = root.get(N('Names'))
  let n = names instanceof PDFArray ? Math.floor(names.size() / 2) : 0
  const kids = root.get(N('Kids'))
  if (kids instanceof PDFArray) for (let i = 0; i < kids.size(); i++) n += countNameTree(doc, dictOf(doc, kids.get(i)))
  return n
}

export async function cleanUp(bytes: Uint8Array, o: CleanupOptions): Promise<{ bytes: Uint8Array; report: CleanupReport }> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
  const report: CleanupReport = { annotations: 0, links: 0, metadata: false, attachments: 0, scripts: 0, before: bytes.length, after: 0 }
  const catalog = doc.catalog
  const names = dictOf(doc, catalog.get(N('Names')))

  for (const page of doc.getPages()) {
    const annots = page.node.Annots()
    if (annots) {
      for (let i = annots.size() - 1; i >= 0; i--) {
        const a = dictOf(doc, annots.get(i))
        const subtype = a?.get(N('Subtype'))?.toString() ?? ''
        const drop =
          (o.links && subtype === '/Link') ||
          (o.attachments && subtype === '/FileAttachment') ||
          (o.annotations && subtype !== '/Link' && subtype !== '/FileAttachment' && !KEEP.has(subtype))
        if (drop) {
          annots.remove(i)
          if (subtype === '/Link') report.links++
          else if (subtype === '/FileAttachment') report.attachments++
          else if (subtype !== '/Popup') report.annotations++
          continue
        }
        // Scripts triggered by annotations and form fields.
        if (o.javascript && a) {
          if (isJavaScriptAction(doc, a.get(N('A')))) {
            a.delete(N('A'))
            report.scripts++
          }
          if (a.has(N('AA'))) {
            a.delete(N('AA'))
            report.scripts++
          }
        }
      }
      if (annots.size() === 0) page.node.delete(N('Annots'))
    }
    if (o.javascript && page.node.has(N('AA'))) {
      page.node.delete(N('AA'))
      report.scripts++
    }
    if (o.metadata) {
      page.node.delete(N('Metadata'))
      page.node.delete(N('PieceInfo'))
    }
  }

  if (o.attachments && names?.has(N('EmbeddedFiles'))) {
    report.attachments += countNameTree(doc, dictOf(doc, names.get(N('EmbeddedFiles'))))
    names.delete(N('EmbeddedFiles'))
    catalog.delete(N('AF'))
  }
  if (o.javascript) {
    if (names?.has(N('JavaScript'))) {
      report.scripts += Math.max(1, countNameTree(doc, dictOf(doc, names.get(N('JavaScript')))))
      names.delete(N('JavaScript'))
    }
    if (isJavaScriptAction(doc, catalog.get(N('OpenAction')))) {
      catalog.delete(N('OpenAction'))
      report.scripts++
    }
    if (catalog.has(N('AA'))) {
      catalog.delete(N('AA'))
      report.scripts++
    }
  }
  if (o.metadata) {
    const info = (doc as unknown as { getInfoDict(): PDFDict }).getInfoDict()
    for (const k of INFO_KEYS) if (info.has(N(k))) (report.metadata = true), info.delete(N(k))
    if (catalog.has(N('Metadata'))) {
      catalog.delete(N('Metadata'))
      report.metadata = true
    }
    catalog.delete(N('PieceInfo'))
  }
  collectGarbage(doc)
  const out = await doc.save({ useObjectStreams: true, updateFieldAppearances: false })
  report.after = out.length
  return { bytes: out, report }
}

/**
 * Share of the file taken by incremental updates appended after the first
 * revision (other apps and PDF.js form saving append instead of rewriting).
 */
export function appendedShare(bytes: Uint8Array): number {
  const eof = [0x25, 0x25, 0x45, 0x4f, 0x46] // %%EOF
  for (let i = 0; i + eof.length <= bytes.length; i++) {
    if (bytes[i] === 0x25 && eof.every((b, k) => bytes[i + k] === b)) {
      const end = i + eof.length
      return end >= bytes.length - 2 ? 0 : (bytes.length - end) / bytes.length
    }
  }
  return 0
}

/** ADR 0007: rewrite the file once appended updates exceed a quarter of it. */
export const COMPACT_THRESHOLD = 0.25

export async function compact(bytes: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
  collectGarbage(doc)
  return doc.save({ useObjectStreams: true, updateFieldAppearances: false })
}
