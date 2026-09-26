import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { PDFDocument, PDFSignature } from '@cantoo/pdf-lib'
import { dataToVerify, derLength, findSignatures, mayHaveSignatures, parsePdfDate, signedBytes } from '../src/core/pdfSignatures'
import { SIGNATURE_ROOM, embedSignature, prepareSignature } from '../src/core/pdfSign'
import { labeledPdf } from './fixtures'

const fixture = (name: string) => new Uint8Array(readFileSync(`tests/signatures/${name}`))

async function pageCount(bytes: Uint8Array): Promise<number> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false } as never)
  const n = (await task.promise).numPages
  await task.destroy()
  return n
}

describe('finding signatures', () => {
  it('skips unsigned PDFs without parsing', async () => {
    const bytes = await labeledPdf(1)
    expect(mayHaveSignatures(bytes)).toBe(false)
    expect(await findSignatures(bytes)).toEqual([])
  })

  it('reads a signature that covers the whole file', async () => {
    const bytes = fixture('signed.pdf')
    const [sig, ...rest] = await findSignatures(bytes)
    expect(rest).toEqual([])
    expect(sig).toMatchObject({
      field: 'Signature',
      page: 0,
      visible: false,
      kind: 'detached',
      subFilter: 'adbe.pkcs7.detached',
      name: 'Glance Test Signer',
      reason: 'Approved',
      location: 'Test',
      claimedTime: Date.UTC(2026, 0, 15, 12),
      wellFormed: true,
      coversWholeFile: true,
      laterSigned: false
    })
    // The padding is trimmed: the blob is exactly one DER value.
    expect(sig.contents[0]).toBe(0x30)
    expect(derLength(sig.contents)).toBe(sig.contents.length)
    expect(sig.contents.length).toBeLessThan(SIGNATURE_ROOM)
    const [, b, c, d] = sig.byteRange
    expect(signedBytes(bytes, sig.byteRange).length).toBe(b + d)
    expect(c + d).toBe(bytes.length)
    expect(await dataToVerify(bytes, sig)).toEqual(signedBytes(bytes, sig.byteRange))
  })

  it('tells later signatures apart from later changes', async () => {
    const twice = await findSignatures(fixture('signed-twice.pdf'))
    expect(twice.map((s) => [s.name, s.coversWholeFile, s.laterSigned])).toEqual([
      ['Glance Test Signer', false, true],
      ['Second Signer', true, false]
    ])
    expect(twice[1].field).toBe('Signature 2')
    const [changed] = await findSignatures(fixture('signed-then-changed.pdf'))
    expect(changed).toMatchObject({ wellFormed: true, coversWholeFile: false, laterSigned: false })
  })

  it('flags a byte range that skips more than the signature', async () => {
    const bytes = fixture('signed.pdf')
    const [sig] = await findSignatures(bytes)
    const text = new TextDecoder('latin1').decode(bytes)
    const at = text.indexOf('/ByteRange [')
    const original = `/ByteRange [${sig.byteRange.join(' ')}]`
    const forged = `/ByteRange [0 ${sig.byteRange[1] - 10} ${sig.byteRange[2]} ${sig.byteRange[3]}]`.padEnd(original.length, ' ')
    const tampered = bytes.slice()
    tampered.set(new TextEncoder().encode(forged), at)
    const [bad] = await findSignatures(tampered)
    expect(bad.wellFormed).toBe(false)
  })

  it('hashes the signed bytes for adbe.pkcs7.sha1', async () => {
    const bytes = fixture('signed.pdf')
    const [sig] = await findSignatures(bytes)
    const digest = await dataToVerify(bytes, { ...sig, kind: 'sha1' })
    expect(digest.length).toBe(20)
  })

  it('parses PDF dates with offsets', () => {
    expect(parsePdfDate("D:20260115130000+01'00'")).toBe(Date.UTC(2026, 0, 15, 12))
    expect(parsePdfDate("D:20260115070000-05'00")).toBe(Date.UTC(2026, 0, 15, 12))
    expect(parsePdfDate('D:2026')).toBe(Date.UTC(2026, 0, 1))
    expect(parsePdfDate('yesterday')).toBeNull()
  })
})

describe('adding a signature', () => {
  it('appends to the file, leaving earlier bytes and signatures untouched', async () => {
    const original = fixture('signed.pdf')
    const prepared = await prepareSignature(original, { name: 'Someone', time: 0 })
    expect(prepared.pdf.subarray(0, original.length)).toEqual(original)
    const [, b, c, d] = prepared.byteRange
    expect(c - b).toBe(SIGNATURE_ROOM * 2 + 2)
    expect(c + d).toBe(prepared.pdf.length)
    const blob = Uint8Array.from([0x30, 0x03, 0x02, 0x01, 0x07])
    const out = embedSignature(prepared, blob)
    const sigs = await findSignatures(out)
    expect(sigs).toHaveLength(2)
    expect(sigs[1]).toMatchObject({ name: 'Someone', wellFormed: true, coversWholeFile: true, contents: blob })
    // The first signature's bytes are unchanged, so it still verifies.
    expect(signedBytes(out, sigs[0].byteRange)).toEqual(signedBytes(original, sigs[0].byteRange))
    expect(await pageCount(out)).toBe(2)
    const reloaded = await PDFDocument.load(out)
    expect(reloaded.getForm().getFields().filter((f) => f instanceof PDFSignature)).toHaveLength(2)
  })

  it('refuses a signature too large for the reserved room', async () => {
    const prepared = await prepareSignature(await labeledPdf(1))
    expect(() => embedSignature(prepared, new Uint8Array(SIGNATURE_ROOM + 1))).toThrow()
  })
})
