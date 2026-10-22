/**
 * Document to PDF: one A4 page per laid-out page. Everything but the text (the look's art,
 * tints, lines, charts and pictures) is drawn as a picture at three times the page's
 * points; the text is real text over it, in the look's fonts at each line's weight and
 * optical size, placed where the layout put it, so it can be searched and copied.
 *
 * Only call this through a dynamic import: it pulls in pdf-lib and fontkit.
 */
import { PDFDocument, PDFName, PDFString, type PDFPage } from '@cantoo/pdf-lib'
import fontkit from '@cantoo/fontkit'
import { PAGE_H, PAGE_W } from '../core/doc/look'
import type { PageLayout } from '../core/doc/layout'
import type { PlacedText } from '../core/deck/design'
import { colour, designFace, drawDesignText, isWoff2, typeface, woff2ToTtf, type DesignFace, type FontkitFont, type PdfFonts } from '../deck/exportPdf'

export interface DocPdfInput {
  pages: PageLayout[]
  /** A page without its text, as PNG. */
  art: (page: PageLayout) => Promise<Uint8Array>
  fonts: PdfFonts
  title?: string
}

export async function docToPdf({ pages, art, fonts, title }: DocPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.registerFontkit(fontkit as never)
  const open = () => fontkit.create(fonts.regular as never) as unknown as FontkitFont
  const bytes = isWoff2(fonts.regular) ? woff2ToTtf(open()) : fonts.regular
  const fallback = typeface(pdf, open(), await pdf.embedFont(bytes, { subset: true }))
  const faces = new Map<string, Promise<DesignFace>>()
  const faceOf = (f: { font: string; italic: boolean; weight: number; size: number }) => {
    const axes = { wght: f.weight, opsz: Math.round(f.size) }
    const key = `${f.font}|${f.italic}|${axes.wght}|${axes.opsz}`
    if (!faces.has(key)) faces.set(key, designFace(pdf, fonts, f.font, f.italic, axes, fallback))
    return faces.get(key)!
  }
  let states = 0
  for (const p of pages) {
    const page = pdf.addPage([PAGE_W, PAGE_H])
    page.drawImage(await pdf.embedPng(await art(p)), { x: 0, y: 0, width: PAGE_W, height: PAGE_H })
    for (const it of p.items) {
      if (it.kind === 'box') {
        if (it.placeholder || !it.text.trim()) continue
        const placed: PlacedText = { box: it.box, text: it.text, size: it.size, placeholder: false } as PlacedText
        await drawDesignText(page, placed, await faceOf({ font: it.box.font, italic: it.box.italic, weight: it.box.weight, size: it.size }), () => `GlanceD${++states}`, 1, PAGE_H)
        continue
      }
      if (it.kind !== 'text') continue
      let x = it.x
      for (const s of it.segs) {
        const text = transformed(s.text, it.transform)
        if (!text) continue
        const face = await faceOf(s.font)
        const sx = it.x + s.x
        x = sx
        const lh = it.h
        const baseline = it.y + (lh - (face.type.ascent + face.type.descent) * s.font.size) / 2 + face.type.ascent * s.font.size
        face.type.draw(page, text, x, PAGE_H - baseline, s.font.size, colour(s.colour), { spacing: s.font.letterSpacing || undefined, slant: face.slant })
        if (s.underline) page.drawRectangle({ x, y: PAGE_H - baseline - s.font.size * 0.12, width: s.w, height: Math.max(0.5, s.font.size * 0.06), color: colour(s.colour) })
        if (s.href) link(page, s.href, x, PAGE_H - it.y - lh, s.w, lh)
      }
    }
  }
  if (!pages.length) pdf.addPage([PAGE_W, PAGE_H])
  if (title) pdf.setTitle(title, { showInWindowTitleBar: true })
  pdf.setCreator('Glance')
  return pdf.save()
}

const transformed = (s: string, t?: string) => (t === 'uppercase' ? s.toUpperCase() : t === 'lowercase' ? s.toLowerCase() : s)

/** A clickable link over a run of text. */
function link(page: PDFPage, href: string, x: number, y: number, w: number, h: number) {
  if (!/^(https?:|mailto:)/.test(href)) return
  const ctx = page.doc.context
  const annot = ctx.register(ctx.obj({
    Type: 'Annot', Subtype: 'Link', Rect: [x, y, x + w, y + h], Border: [0, 0, 0],
    A: { Type: 'Action', S: 'URI', URI: PDFString.of(href) }
  }))
  const annots = page.node.lookup(PDFName.of('Annots'))
  if (annots && 'push' in annots) (annots as unknown as { push(r: unknown): void }).push(annot)
  else page.node.set(PDFName.of('Annots'), ctx.obj([annot]))
}

