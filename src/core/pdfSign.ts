/**
 * Adding a certificate-based signature to a PDF. The signature is appended as an
 * incremental update so earlier signatures stay valid: first a placeholder with room
 * for the signature, then the CMS blob (made by Windows from the user's certificate)
 * is written into that room.
 */
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString, type PDFObject } from '@cantoo/pdf-lib'
import type { PdfSignature } from './pdfSignatures'

/** Bytes reserved for the CMS blob: certificate chain, timestamp, and revocation data fit. */
export const SIGNATURE_ROOM = 24 * 1024
/** Stands in for each ByteRange number until the offsets are known; wide enough for any file. */
const WIDE = 9_999_999_999

export interface SignOptions {
  /** Field name; must not already exist. */
  field?: string
  name?: string
  reason?: string
  location?: string
  time?: number
}

export interface PreparedSignature {
  pdf: Uint8Array
  byteRange: PdfSignature['byteRange']
}

function pdfDate(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
}

const latin1 = (b: Uint8Array): string => new TextDecoder('latin1').decode(b)

function uniqueFieldName(doc: PDFDocument, wanted: string): string {
  const taken = new Set(doc.getForm().getFields().map((f) => f.getName()))
  let name = wanted
  for (let i = 2; taken.has(name); i++) name = `${wanted} ${i}`
  return name
}

/** An array stored under `key` in `dict`, created if missing; marks whichever object holds it as changed. */
function arrayIn(doc: PDFDocument, dict: PDFDict, dictRef: PDFRef | undefined, key: string): PDFArray {
  const snap = doc.context.snapshot!
  const raw: PDFObject | undefined = dict.get(PDFName.of(key))
  if (raw instanceof PDFRef) {
    const arr = doc.context.lookup(raw, PDFArray)
    snap.markRefForSave(raw)
    return arr
  }
  if (dictRef) snap.markRefForSave(dictRef)
  if (raw instanceof PDFArray) return raw
  const arr = doc.context.obj([])
  dict.set(PDFName.of(key), arr)
  return arr
}

/** Appends an invisible signature field whose value has room for the signature. */
export async function prepareSignature(bytes: Uint8Array, o: SignOptions = {}): Promise<PreparedSignature> {
  const doc = await PDFDocument.load(bytes, { forIncrementalUpdate: true, updateMetadata: false })
  const ctx = doc.context
  const snap = ctx.snapshot
  if (!snap) throw new Error('The PDF couldn’t be opened for signing.')
  const page = doc.getPage(0)

  const value: Record<string, unknown> = {
    Type: 'Sig',
    Filter: 'Adobe.PPKLite',
    SubFilter: 'adbe.pkcs7.detached',
    ByteRange: [0, WIDE, WIDE, WIDE],
    Contents: PDFHexString.of('0'.repeat(SIGNATURE_ROOM * 2)),
    M: PDFString.of(pdfDate(o.time ?? Date.now()))
  }
  if (o.name) value.Name = PDFHexString.fromText(o.name)
  if (o.reason) value.Reason = PDFHexString.fromText(o.reason)
  if (o.location) value.Location = PDFHexString.fromText(o.location)
  const valueRef = ctx.register(ctx.obj(value as never))

  const widgetRef = ctx.register(
    ctx.obj({
      Type: 'Annot',
      Subtype: 'Widget',
      FT: 'Sig',
      T: PDFHexString.fromText(uniqueFieldName(doc, o.field ?? 'Signature')),
      V: valueRef,
      Rect: [0, 0, 0, 0],
      F: 132, // Print, Locked
      P: page.ref
    } as never)
  )
  arrayIn(doc, page.node, page.ref, 'Annots').push(widgetRef)

  const catalogRef = ctx.trailerInfo.Root as PDFRef
  const acroRaw = doc.catalog.get(PDFName.of('AcroForm'))
  let acro: PDFDict
  let acroRef: PDFRef | undefined
  if (acroRaw instanceof PDFRef) {
    acroRef = acroRaw
    acro = ctx.lookup(acroRaw, PDFDict)
    snap.markRefForSave(acroRaw)
  } else if (acroRaw instanceof PDFDict) {
    acro = acroRaw
    snap.markRefForSave(catalogRef)
  } else {
    acro = ctx.obj({})
    acroRef = ctx.register(acro)
    doc.catalog.set(PDFName.of('AcroForm'), acroRef)
    snap.markRefForSave(catalogRef)
  }
  arrayIn(doc, acro, acroRef ?? catalogRef, 'Fields').push(widgetRef)
  acro.set(PDFName.of('SigFlags'), PDFNumber.of(3)) // SignaturesExist, AppendOnly

  const update = await doc.saveIncremental(snap, { useObjectStreams: false })
  const pdf = new Uint8Array(bytes.length + update.length)
  pdf.set(bytes, 0)
  pdf.set(update, bytes.length)
  return fillByteRange(pdf, bytes.length)
}

/** Finds the placeholder in the appended update and writes the real ByteRange. */
function fillByteRange(pdf: Uint8Array, from: number): PreparedSignature {
  const tail = latin1(pdf.subarray(from))
  const hole = tail.indexOf(`<${'0'.repeat(SIGNATURE_ROOM * 2)}>`)
  const placeholder = /\/ByteRange\s*\[\s*0\s+9999999999\s+9999999999\s+9999999999\s*\]/.exec(tail)
  if (hole < 0 || !placeholder) throw new Error('Couldn’t reserve room for the signature.')
  const b = from + hole
  const c = b + SIGNATURE_ROOM * 2 + 2
  const byteRange: PreparedSignature['byteRange'] = [0, b, c, pdf.length - c]
  const text = `/ByteRange [${byteRange.join(' ')}]`.padEnd(placeholder[0].length, ' ')
  pdf.set(new TextEncoder().encode(text), from + placeholder.index)
  return { pdf, byteRange }
}

/** Writes the CMS blob into the reserved room. */
export function embedSignature(prepared: PreparedSignature, cms: Uint8Array): Uint8Array {
  if (cms.length > SIGNATURE_ROOM) throw new Error('The signature is too large.')
  const hex = [...cms].map((x) => x.toString(16).padStart(2, '0')).join('').padEnd(SIGNATURE_ROOM * 2, '0')
  const out = prepared.pdf.slice()
  out.set(new TextEncoder().encode(hex), prepared.byteRange[1] + 1)
  return out
}
