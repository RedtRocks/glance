/**
 * Finding certificate-based (digital) signatures in a PDF: each signed field's
 * signature blob, the byte ranges it covers, and what the file says about it.
 * The cryptographic check itself runs in Windows (src-tauri/src/certsig.rs).
 */
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFSignature, PDFString } from '@cantoo/pdf-lib'
import { mayHaveSignatures } from './signatureStatus'

export { mayHaveSignatures }

/** How the signature is packaged (/SubFilter); `unsupported` ones are listed but not checked. */
export type SignatureKind = 'detached' | 'sha1' | 'timestamp' | 'unsupported'

export interface PdfSignature {
  field: string
  /** Page (0-based) of the signature's widget, if it has one. */
  page: number | null
  /** Whether the widget has a visible appearance on the page. */
  visible: boolean
  subFilter: string
  kind: SignatureKind
  byteRange: [number, number, number, number]
  /** The CMS/PKCS#7 blob, without the zero padding. */
  contents: Uint8Array
  name: string
  reason: string
  location: string
  contact: string
  /** /M, the signing time the signer's software wrote, in ms since 1970. */
  claimedTime: number | null
  /** The byte range leaves out exactly the /Contents value and nothing else. */
  wellFormed: boolean
  /** The signature covers the file up to its end; nothing was appended afterwards. */
  coversWholeFile: boolean
  /** Appended after this signature, but the end of the file is covered by a later signature. */
  laterSigned: boolean
}

const KINDS: Record<string, SignatureKind> = {
  'adbe.pkcs7.detached': 'detached',
  'ETSI.CAdES.detached': 'detached',
  'adbe.pkcs7.sha1': 'sha1',
  'ETSI.RFC3161': 'timestamp'
}

/** D:YYYYMMDDHHmmSSOHH'mm' → ms since 1970 (UTC when the offset is missing). */
export function parsePdfDate(s: string): number | null {
  const m = /^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+-])?(\d{2})?'?(\d{2})?'?/.exec(s.trim())
  if (!m) return null
  const n = (v: string | undefined, d: number) => (v === undefined ? d : Number(v))
  let t = Date.UTC(n(m[1], 0), n(m[2], 1) - 1, n(m[3], 1), n(m[4], 0), n(m[5], 0), n(m[6], 0))
  if (m[7] === '+' || m[7] === '-') {
    const offset = (n(m[8], 0) * 60 + n(m[9], 0)) * 60_000
    t += m[7] === '+' ? -offset : offset
  }
  return Number.isFinite(t) ? t : null
}

/** Length of the DER value starting at 0 (tag, length, content), or the whole buffer if unreadable. */
export function derLength(b: Uint8Array): number {
  if (b.length < 2) return b.length
  const l = b[1]
  if (l < 0x80) return Math.min(2 + l, b.length)
  const n = l & 0x7f
  if (n === 0 || n > 4 || b.length < 2 + n) return b.length
  let len = 0
  for (let i = 0; i < n; i++) len = len * 256 + b[2 + i]
  return Math.min(2 + n + len, b.length)
}

const text = (v: unknown): string => (v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : '')

/** The data a signature vouches for: its two byte ranges joined. */
export function signedBytes(bytes: Uint8Array, [a, b, c, d]: PdfSignature['byteRange']): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(b + d)
  out.set(bytes.subarray(a, a + b), 0)
  out.set(bytes.subarray(c, c + d), b)
  return out
}

/** Whether only whitespace follows `end`. */
function onlyWhitespaceAfter(bytes: Uint8Array, end: number): boolean {
  for (let i = end; i < bytes.length; i++) if (![0x20, 0x0a, 0x0d, 0x09, 0x00].includes(bytes[i])) return false
  return true
}

/** The gap between the ranges must be exactly `<hex of contents>`. */
function gapIsContents(bytes: Uint8Array, [, b, c]: PdfSignature['byteRange'], raw: Uint8Array): boolean {
  if (bytes[b] !== 0x3c || bytes[c - 1] !== 0x3e) return false
  const hex = new TextDecoder('latin1').decode(bytes.subarray(b + 1, c - 1)).replace(/\s+/g, '')
  if (hex.length !== raw.length * 2 || !/^[0-9a-fA-F]*$/.test(hex)) return false
  for (let i = 0; i < raw.length; i++) if (parseInt(hex.slice(i * 2, i * 2 + 2), 16) !== raw[i]) return false
  return true
}

function pageOf(doc: PDFDocument, widget: PDFDict): number | null {
  const p = widget.get(PDFName.of('P'))
  const pages = doc.getPages()
  if (p instanceof PDFRef) {
    const i = pages.findIndex((pg) => pg.ref === p)
    if (i >= 0) return i
  }
  // No /P: look for the widget in each page's /Annots.
  for (let i = 0; i < pages.length; i++) {
    const annots = pages[i].node.Annots()
    if (annots?.asArray().some((r) => doc.context.lookup(r) === widget)) return i
  }
  return null
}

function hasArea(widget: PDFDict): boolean {
  const r = widget.lookup(PDFName.of('Rect'))
  if (!(r instanceof PDFArray) || r.size() < 4) return false
  const [x1, y1, x2, y2] = r.asArray().map((v) => (v instanceof PDFNumber ? v.asNumber() : 0))
  const hidden = ((widget.lookup(PDFName.of('F')) as PDFNumber | undefined)?.asNumber?.() ?? 0) & 2
  return Math.abs(x2 - x1) > 1 && Math.abs(y2 - y1) > 1 && !hidden
}

/** Every signed signature field, in the order they were signed. */
export async function findSignatures(bytes: Uint8Array): Promise<PdfSignature[]> {
  if (!mayHaveSignatures(bytes)) return []
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false })
  const out: PdfSignature[] = []
  for (const field of doc.getForm().getFields()) {
    if (!(field instanceof PDFSignature)) continue
    const v = field.acroField.dict.lookup(PDFName.of('V'))
    if (!(v instanceof PDFDict)) continue
    const range = v.lookup(PDFName.of('ByteRange'))
    const contents = v.lookup(PDFName.of('Contents'))
    if (!(range instanceof PDFArray) || range.size() !== 4 || !(contents instanceof PDFHexString || contents instanceof PDFString)) continue
    const byteRange = range.asArray().map((n) => (n instanceof PDFNumber ? n.asNumber() : -1)) as PdfSignature['byteRange']
    const raw = contents.asBytes()
    const [a, b, c, d] = byteRange
    const inBounds = a === 0 && b > 0 && c > b && d >= 0 && c + d <= bytes.length
    const subFilter = (v.lookup(PDFName.of('SubFilter')) as PDFName | undefined)?.decodeText?.() ?? ''
    const widgets = field.acroField.getWidgets()
    const widget = widgets[0]?.dict
    const m = text(v.lookup(PDFName.of('M')))
    out.push({
      field: field.getName(),
      page: widget ? pageOf(doc, widget) : null,
      visible: widget ? hasArea(widget) : false,
      subFilter,
      kind: KINDS[subFilter] ?? 'unsupported',
      byteRange,
      contents: raw.subarray(0, derLength(raw)),
      name: text(v.lookup(PDFName.of('Name'))),
      reason: text(v.lookup(PDFName.of('Reason'))),
      location: text(v.lookup(PDFName.of('Location'))),
      contact: text(v.lookup(PDFName.of('ContactInfo'))),
      claimedTime: m ? parsePdfDate(m) : null,
      wellFormed: inBounds && gapIsContents(bytes, byteRange, raw),
      coversWholeFile: inBounds && onlyWhitespaceAfter(bytes, c + d),
      laterSigned: false
    })
  }
  out.sort((x, y) => x.byteRange[2] + x.byteRange[3] - (y.byteRange[2] + y.byteRange[3]))
  const last = out.at(-1)
  const lastCoversEnd = !!last && last.wellFormed && last.coversWholeFile
  for (const s of out) if (!s.coversWholeFile && s.wellFormed) s.laterSigned = lastCoversEnd
  return out
}

/** What Windows needs to check the signature against: the signed bytes, or for adbe.pkcs7.sha1 their SHA-1. */
export async function dataToVerify(bytes: Uint8Array, sig: PdfSignature): Promise<Uint8Array> {
  const data = signedBytes(bytes, sig.byteRange)
  if (sig.kind !== 'sha1') return data
  return new Uint8Array(await crypto.subtle.digest('SHA-1', data))
}
