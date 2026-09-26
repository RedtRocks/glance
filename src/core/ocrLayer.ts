/**
 * OCR text layer: recognized words written into a PDF as invisible text
 * (rendering mode 3), placed over the scanned image, so the page can be searched,
 * selected and copied in Glance and in any other PDF viewer.
 */
import {
  PDFDocument,
  PDFNumber,
  PDFOperator,
  PDFOperatorNames,
  StandardFonts,
  TextRenderingMode,
  beginText,
  endText,
  popGraphicsState,
  pushGraphicsState,
  setFontAndSize,
  setTextMatrix,
  setTextRenderingMode,
  showText,
  type PDFFont
} from '@cantoo/pdf-lib'
import type { FontSource } from './annotations'

type Pt = [number, number]

/** One recognized word, located by three corners in PDF user space. */
export interface OcrWord {
  text: string
  /** Baseline start (bottom-left of the word box). */
  origin: Pt
  /** Bottom-right of the word box. */
  end: Pt
  /** Top-left of the word box. */
  top: Pt
}

export interface OcrPageWords {
  index: number
  words: OcrWord[]
}

/** Characters the font can't encode become '?', so one odd glyph can't sink a page. */
function encodable(font: PDFFont, text: string): string {
  let out = ''
  for (const ch of text) {
    try {
      font.encodeText(ch)
      out += ch
    } catch {
      out += '?'
    }
  }
  return out
}

/**
 * Adds an invisible text layer to the given pages. With a Unicode font source
 * (e.g. Arial from the system) any script is kept; otherwise Helvetica is used.
 */
export async function addTextLayer(bytes: Uint8Array, pages: OcrPageWords[], opts: { loadFont?: FontSource; family?: string } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
  let font: PDFFont | null = null
  let unicode = false
  if (opts.loadFont && opts.family) {
    try {
      const data = await opts.loadFont(opts.family)
      if (data) {
        const fontkit = (await import('@cantoo/fontkit')).default
        doc.registerFontkit(fontkit as never)
        font = await doc.embedFont(data, { subset: true })
        unicode = true
      }
    } catch {
      font = null
    }
  }
  font ??= await doc.embedFont(StandardFonts.Helvetica)
  const all = doc.getPages()
  for (const { index, words } of pages) {
    const page = all[index]
    if (!page || !words.length) continue
    const key = page.node.newFontDictionary('GlanceOCR', font.ref)
    const ops: PDFOperator[] = [pushGraphicsState(), beginText(), setTextRenderingMode(TextRenderingMode.Invisible)]
    for (const w of words) {
      const text = unicode ? w.text : encodable(font, w.text)
      if (!text.trim()) continue
      const bx = w.end[0] - w.origin[0]
      const by = w.end[1] - w.origin[1]
      const tx = w.top[0] - w.origin[0]
      const ty = w.top[1] - w.origin[1]
      const len = Math.hypot(bx, by)
      const height = Math.hypot(tx, ty)
      if (len < 0.5 || height < 0.5) continue
      // OCR boxes include descenders; the baseline sits about a fifth of the way up.
      const size = height * 0.9
      const natural = font.widthOfTextAtSize(text, size)
      if (natural <= 0) continue
      const [ux, uy] = [bx / len, by / len]
      const [vx, vy] = [tx / height, ty / height]
      const base: Pt = [w.origin[0] + tx * 0.2, w.origin[1] + ty * 0.2]
      ops.push(
        setFontAndSize(key.asString().slice(1), size),
        // Stretch horizontally so the invisible word spans the visible one exactly.
        PDFOperator.of(PDFOperatorNames.SetTextHorizontalScaling, [PDFNumber.of((len / natural) * 100)]),
        setTextMatrix(ux, uy, vx, vy, base[0], base[1]),
        showText(font.encodeText(text + ' '))
      )
    }
    ops.push(endText(), popGraphicsState())
    page.pushOperators(...ops)
  }
  return doc.save({ useObjectStreams: true })
}
