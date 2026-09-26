import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib'

/** A PDF whose pages are labeled by width: page i is (100 + i) points wide, 200 tall. */
export async function labeledPdf(n: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 0; i < n; i++) {
    const p = doc.addPage([100 + i, 200])
    p.drawText(`Page ${i + 1}`, { x: 10, y: 100, size: 12, font })
  }
  doc.setTitle('Fixture')
  return doc.save()
}

/** 1x1 red PNG. */
export const RED_PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0)
)

export const latin1 = (b: Uint8Array): string => Buffer.from(b).toString('latin1')

/**
 * Everything a PDF could reveal about `secret`: raw bytes, every decompressed stream,
 * and hex-encoded strings (ASCII and UTF-16BE, as PDF text strings are stored).
 */
export async function reveals(bytes: Uint8Array, secret: string): Promise<boolean> {
  const { PDFDocument, PDFRawStream, decodePDFRawStream } = await import('@cantoo/pdf-lib')
  const hex = (s: string) => [...s].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('').toUpperCase()
  const utf16 = (s: string) => [...s].map((c) => c.charCodeAt(0).toString(16).padStart(4, '0')).join('').toUpperCase()
  const needles = [secret, hex(secret), utf16(secret)]
  const haystacks = [latin1(bytes).toUpperCase().replace(/\s+/g, '')]
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    haystacks.push(obj.toString().toUpperCase())
    if (obj instanceof PDFRawStream) {
      try {
        haystacks.push(latin1(decodePDFRawStream(obj).decode()).toUpperCase())
      } catch {
        /* undecodable filter (e.g. DCT image data) */
      }
    }
  }
  return needles.some((n) => haystacks.some((h) => h.includes(n.toUpperCase())))
}
