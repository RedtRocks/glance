/**
 * Deck to PDF: one page per shown slide, drawn from the same layout boxes as the HTML
 * view (src/core/deck/html.ts), so the export looks like the deck in Glance. Text is real
 * text in the deck's font, wrapped here with the font's own widths.
 *
 * A designed slide is its art as a picture (drawn by the caller at twice the page's
 * pixels, see raster.ts), with each text box as real text over it in the design's own
 * font: variable fonts are set to the box's weight, and turned boxes are turned.
 *
 * Only call this through a dynamic import: it pulls in pdf-lib and fontkit.
 */
import {
  PDFDocument, PDFOperator, PDFOperatorNames, appendBezierCurve, beginText, clip, closePath, endPath, endText, fill, lineTo,
  concatTransformationMatrix, moveText, moveTo, popGraphicsState, pushGraphicsState, rgb, setCharacterSpacing, setFillingColor, setFontAndSize,
  setGraphicsState, setLineWidth, setStrokingColor, setTextMatrix, stroke,
  PDFName, type PDFFont, type PDFHexString, type PDFImage, type PDFPage, type RGB
} from '@cantoo/pdf-lib'
import fontkit from '@cantoo/fontkit'
import { SLIDE_H, SLIDE_W, layoutSlide, type Box, type TextBox } from '../core/deck/layout'
import { type Deck, type Slide } from '../core/deck/model'
import { themeOf, type DeckTheme } from '../core/deck/themes'
import { DESIGN_SCALE, placeTexts, shownText, type Design, type DesignLookup, type MeasureText, type PlacedText } from '../core/deck/design'

/** PDF points per slide unit: a 1920 by 1080 slide becomes a 960 by 540 pt page. */
const S = 0.5
const PAGE_W = SLIDE_W * S
const PAGE_H = SLIDE_H * S
const SCALE = S
const PDF_H = PAGE_H

export interface PdfFonts {
  /** The layouts' font. */
  regular: Uint8Array
  /** A designed slide's font file, and whether it is the italic one (an upright file is slanted). */
  file?: (family: string, italic: boolean) => Promise<{ bytes: Uint8Array; italic: boolean } | null>
}

/** What designed slides need: the designs, and their art as PNG (`over` on a clear background). */
export interface PdfDesigns {
  designs: DesignLookup
  art: (design: Design) => Promise<{ art: Uint8Array; over?: Uint8Array }>
}

export async function deckToPdf(deck: Deck, media: Map<string, Uint8Array>, fonts: PdfFonts, designed?: PdfDesigns): Promise<Uint8Array> {
  const theme = themeOf(deck.theme)
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit as never)
  const open = () => fontkit.create(fonts.regular as never) as unknown as FontkitFont
  // Converting caches glyphs without their characters, so text layout gets a fresh copy.
  const bytes = isWoff2(fonts.regular) ? woff2ToTtf(open()) : fonts.regular
  const face = open()
  const type = typeface(doc, face, await doc.embedFont(bytes, { subset: true }))
  const images = new Map<string, Promise<PDFImage | null>>()
  const imageOf = (src: string) => {
    if (!images.has(src)) images.set(src, embedImage(doc, media.get(src)))
    return images.get(src)!
  }

  const shown = deck.slides.filter((s) => !s.hidden)
  const designedPage = designed ? designedPages(doc, fonts, designed, type) : null
  for (const slide of shown) {
    const page = doc.addPage([PAGE_W, PAGE_H])
    const design = slide.layout === 'design' && slide.design ? designed?.designs(slide.design) : undefined
    if (design && designedPage) {
      await designedPage(page, slide, design)
      continue
    }
    fillRect(page, 0, 0, SLIDE_W, SLIDE_H, 0, colour(theme.bg))
    for (const box of layoutSlide(slide, theme)) await drawBox(page, box, theme, type, imageOf)
  }
  // A PDF needs a page; a deck with nothing to show gets one blank slide.
  if (!shown.length) fillRect(doc.addPage([PAGE_W, PAGE_H]), 0, 0, SLIDE_W, SLIDE_H, 0, colour(theme.bg))

  const title = shown.map((s) => s.slots.title).find((v) => v?.kind === 'text' && v.value.trim())
  if (title?.kind === 'text') doc.setTitle(title.value.trim(), { showInWindowTitleBar: true })
  doc.setCreator('Glance')
  return doc.save()
}

async function drawBox(page: PDFPage, box: Box, theme: DeckTheme, type: Typeface, imageOf: (src: string) => Promise<PDFImage | null>) {
  switch (box.type) {
    case 'rect':
      if (box.fill !== 'none') fillRect(page, box.x, box.y, box.w, box.h, box.radius, colour(box.fill))
      if (box.line) {
        // Drawn inside the box, like html.ts's border.
        const i = box.line.width / 2
        page.pushOperators(
          pushGraphicsState(), setStrokingColor(colour(box.line.colour)), setLineWidth(box.line.width * S),
          ...roundRect(box.x + i, box.y + i, box.w - 2 * i, box.h - 2 * i, Math.max(0, box.radius - i)), stroke(), popGraphicsState()
        )
      }
      return
    case 'image': {
      const img = box.image ? await imageOf(box.image.src) : null
      // Like the HTML view: a picture that can't be shown leaves an empty card.
      if (!img || !box.image) return fillRect(page, box.x, box.y, box.w, box.h, box.radius, colour(theme.surface))
      const f = box.image.focus ?? { x: 0.5, y: 0.5 }
      const w = box.w * S
      const h = box.h * S
      // object-fit: cover, then object-position at the focus point.
      const k = Math.max(w / img.width, h / img.height)
      const dw = img.width * k
      const dh = img.height * k
      const left = box.x * S + (w - dw) * f.x
      const top = box.y * S + (h - dh) * f.y
      page.pushOperators(pushGraphicsState(), ...roundRect(box.x, box.y, box.w, box.h, box.radius), clip(), endPath())
      page.drawImage(img, { x: left, y: PAGE_H - top - dh, width: dw, height: dh })
      page.pushOperators(popGraphicsState())
      return
    }
    case 'text':
      if (!box.placeholder) drawText(page, box, theme, type)
  }
}

/** Lays text out the way html.ts's flex column does: paragraphs (or bullets) with gaps, aligned in the box. */
function drawText(page: PDFPage, box: TextBox, theme: DeckTheme, type: Typeface) {
  const size = box.size * S
  const lh = size * box.lineHeight
  const indent = box.bullets ? size * 1.1 : 0
  const gap = size * (box.bullets ? 0.5 : 0.3)
  const width = box.w * S - indent
  // List entries collapse white space like HTML; paragraphs keep line breaks (pre-wrap).
  const blocks = box.paragraphs.map((p) => (box.bullets ? [p] : p.split('\n')).flatMap((line) => wrap(line, width, size, type)))
  const height = blocks.reduce((n, lines) => n + lines.length * lh, 0) + Math.max(0, blocks.length - 1) * gap
  const free = box.h * S - height
  let top = box.y * S + (box.valign === 'top' ? 0 : box.valign === 'middle' ? free / 2 : free)
  const color = colour(box.colour)
  // Where the baseline sits in a CSS line box: half the leading above the font's ascent.
  const baseline = (lh - (type.ascent + type.descent) * size) / 2 + type.ascent * size
  for (const lines of blocks) {
    if (box.bullets) {
      const d = 0.32 * box.size
      fillRect(page, box.x, (top + lh / 2) / S - d / 2, d, d, d / 2, colour(theme.accent))
    }
    for (const line of lines) {
      const x = box.x * S + indent + (box.align === 'center' ? (width - type.widthOfTextAtSize(line, size)) / 2 : 0)
      if (line) type.draw(page, line, x, PAGE_H - top - baseline, size, color)
      top += lh
    }
    top += gap
  }
}

// Designed slides

/** Draws designed slides: art, the text boxes under `over`, `over`, then the other text boxes. */
function designedPages(doc: PDFDocument, fonts: PdfFonts, designed: PdfDesigns, fallback: Typeface) {
  const arts = new Map<string, Promise<{ art: PDFImage; over?: PDFImage }>>()
  const artOf = (d: Design) => {
    if (!arts.has(d.id)) {
      arts.set(d.id, designed.art(d).then(async ({ art, over }) => ({ art: await doc.embedPng(art), over: over ? await doc.embedPng(over) : undefined })))
    }
    return arts.get(d.id)!
  }
  const faces = new Map<string, Promise<DesignFace>>()
  const faceOf = (p: PlacedText) => {
    const box = p.box
    // As html.ts sets it: the optical size of the drawn size on the 640 by 360 board.
    const axes = { wght: box.weight, opsz: Math.round(p.size / DESIGN_SCALE) }
    const key = `${box.font}|${box.italic}|${axes.wght}|${axes.opsz}`
    if (!faces.has(key)) faces.set(key, designFace(doc, fonts, box.font, box.italic, axes, fallback))
    return faces.get(key)!
  }
  // Text is fitted with the fonts' own widths, at the design's optical size.
  const shapers = new Map<string, FontkitFont | null>()
  const shaperKey = (b: PlacedText['box']) => `${b.font}|${b.italic}|${b.weight}|${Math.round(b.size / DESIGN_SCALE)}`
  const loadShapers = async (d: Design) => {
    for (const b of d.texts) {
      const key = shaperKey(b)
      if (shapers.has(key)) continue
      const file = await fonts.file?.(b.font, b.italic)
      shapers.set(key, file ? instanceFont(file.bytes, { wght: b.weight, opsz: Math.round(b.size / DESIGN_SCALE) }).face : null)
    }
  }
  const measure: MeasureText = (b, line, size) => {
    const f = shapers.get(shaperKey(b))
    const spacing = ((b.letterSpacing / b.size) * size) * [...line].length
    if (!f) return line.length * size * b.charW + spacing
    return (f.layout(line).positions.reduce((n, p) => n + p.xAdvance, 0) / f.unitsPerEm) * size + spacing
  }
  let states = 0
  return async (page: PDFPage, slide: Slide, design: Design) => {
    fillRect(page, 0, 0, SLIDE_W, SLIDE_H, 0, colour(design.bg))
    const { art, over } = await artOf(design)
    page.drawImage(art, { x: 0, y: 0, width: PAGE_W, height: PAGE_H })
    await loadShapers(design)
    const placed = placeTexts(slide, design, measure).filter((p) => !p.placeholder)
    const draw = async (under: boolean) => {
      for (const p of placed.filter((q) => !!q.box.under === under)) await drawDesignText(page, p, await faceOf(p), () => `GlanceA${++states}`)
    }
    await draw(true)
    if (over) page.drawImage(over, { x: 0, y: 0, width: PAGE_W, height: PAGE_H })
    await draw(false)
  }
}

export interface DesignFace {
  type: Typeface
  /** No italic file: the upright one is slanted, as browsers do. */
  slant: boolean
}

export async function designFace(doc: PDFDocument, fonts: PdfFonts, family: string, italic: boolean, axes: { wght: number; opsz: number }, fallback: Typeface): Promise<DesignFace> {
  const file = await fonts.file?.(family, italic)
  if (!file) return { type: fallback, slant: italic }
  const { ttf, face: shaper } = instanceFont(file.bytes, axes)
  const face = fontkit.create(ttf as never) as unknown as FontkitFont
  return { type: typeface(doc, face, await doc.embedFont(ttf, { subset: true }), shaper), slant: italic && !file.italic }
}

/**
 * A font file as plain TrueType for embedding: WOFF2 unpacked, and a variable font set to
 * `axes` (clamped to its ranges; axes it lacks are ignored) and saved without variations.
 * `face` lays text out at those axes, kerning included, as a browser does.
 */
export function instanceFont(bytes: Uint8Array, axes: Record<string, number>): { ttf: Uint8Array; face: FontkitFont } {
  const ttf = isWoff2(bytes) ? woff2ToTtf(fontkit.create(bytes as never) as unknown as FontkitFont) : bytes
  const base = fontkit.create(ttf as never) as unknown as FontkitFont
  const vary = base.variationAxes ?? {}
  if (!Object.keys(vary).length) return { ttf, face: base }
  const coords: Record<string, number> = {}
  for (const [tag, want] of Object.entries(axes)) {
    const a = vary[tag]
    if (a) coords[tag] = Math.min(a.max, Math.max(a.min, want))
  }
  const face = base.getVariation!(coords)
  return { ttf: rebuildTtf(face, true), face }
}

/** One design text box: wrapped with the font's widths, aligned as html.ts does, turned about its centre. */
/** `S` and `PAGE_H` are the deck's; documents pass their own (1 point per unit, A4). */
export async function drawDesignText(page: PDFPage, p: PlacedText, face: DesignFace, stateName: () => string, S = SCALE, PAGE_H = PDF_H) {
  const t = p.box
  const size = p.size * S
  const spacing = (t.letterSpacing / t.size) * p.size * S
  const font = { widthOfTextAtSize: (s: string, z: number) => face.type.widthOfTextAtSize(s, z) + spacing * [...s].length }
  const w = t.w * S
  const h = t.h * S
  const indent = ((t.indent ?? 0) * p.size * S) / t.size
  const lh = size * t.lineHeight
  const lines: { text: string; indent: number }[] = []
  shownText(t, p.text).split('\n').forEach((para, i) => {
    const first = i === 0 ? indent : 0
    if (t.wrap) return void lines.push({ text: para, indent: first })
    const head = wrap(para, w - first, size, font)
    lines.push({ text: head[0], indent: first })
    if (head.length > 1) for (const line of wrap(para.slice(para.indexOf(head[0]) + head[0].length).trim(), w, size, font)) lines.push({ text: line, indent: 0 })
  })
  const free = h - lines.length * lh
  let top = t.y * S + (t.valign === 'top' ? 0 : t.valign === 'middle' ? free / 2 : free)
  const baseline = (lh - (face.type.ascent + face.type.descent) * size) / 2 + face.type.ascent * size
  const ops: PDFOperator[] = [pushGraphicsState()]
  if (t.rotate) {
    // CSS turns clockwise with y down; PDF's y goes up, so the angle flips.
    const cx = (t.x + t.w / 2) * S
    const cy = PAGE_H - (t.y + t.h / 2) * S
    const a = (-t.rotate * Math.PI) / 180
    const [cos, sin] = [Math.cos(a), Math.sin(a)]
    ops.push(concatTransformationMatrix(cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy))
  }
  if (t.opacity < 1) {
    const name = stateName()
    page.node.setExtGState(PDFName.of(name), page.doc.context.obj({ ca: t.opacity, CA: t.opacity }))
    ops.push(setGraphicsState(name))
  }
  page.pushOperators(...ops)
  const shadow = t.shadow ? parseShadow(t.shadow) : null
  for (const line of lines) {
    const lw = font.widthOfTextAtSize(line.text, size)
    const x = t.x * S + (t.align === 'center' ? (w - lw) / 2 : t.align === 'right' ? w - lw : line.indent)
    const y = PAGE_H - top - baseline
    if (line.text) {
      if (shadow) face.type.draw(page, line.text, x + shadow.dx * S, y - shadow.dy * S, size, shadow.colour, { spacing, slant: face.slant })
      face.type.draw(page, line.text, x, y, size, colour(t.colour), { spacing, slant: face.slant })
    }
    top += lh
  }
  page.pushOperators(popGraphicsState())
}

/** The first of a CSS text-shadow list, when it is sharp enough to draw as a second copy. */
function parseShadow(css: string): { colour: RGB; dx: number; dy: number } | null {
  const m = /rgba?\(([^)]+)\)\s+(-?[\d.]+)px\s+(-?[\d.]+)px(?:\s+([\d.]+)px)?/.exec(css)
  if (!m || Number(m[4] ?? 0) > 4) return null
  const [r, g, b] = m[1].split(/[,\s/]+/).filter(Boolean).map(Number)
  return { colour: rgb(r / 255, g / 255, b / 255), dx: Number(m[2]), dy: Number(m[3]) }
}

/** Breaks one paragraph into lines no wider than `width`, at spaces, or anywhere in a word too long for a line. */
export function wrap(text: string, width: number, size: number, font: { widthOfTextAtSize(t: string, s: number): number }): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  if (!words.length) return ['']
  const fits = (t: string) => font.widthOfTextAtSize(t, size) <= width
  const lines: string[] = []
  let line = ''
  for (let word of words) {
    const joined = line ? `${line} ${word}` : word
    if (fits(joined)) {
      line = joined
      continue
    }
    if (line) lines.push(line)
    line = ''
    // overflow-wrap: anywhere; a word wider than the box breaks between characters.
    while (!fits(word)) {
      const chars = [...word]
      let n = 1
      while (n < chars.length && fits(chars.slice(0, n + 1).join(''))) n++
      lines.push(chars.slice(0, n).join(''))
      word = chars.slice(n).join('')
    }
    line = word
  }
  lines.push(line)
  return lines
}

function fillRect(page: PDFPage, x: number, y: number, w: number, h: number, radius: number, color: RGB) {
  page.pushOperators(pushGraphicsState(), setFillingColor(color), ...roundRect(x, y, w, h, radius), fill(), popGraphicsState())
}

/** A rounded rectangle path, in slide units from the top left, as PDF operators. */
function roundRect(x: number, y: number, w: number, h: number, radius: number): PDFOperator[] {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2)) * S
  const l = x * S
  const rt = (x + w) * S
  const t = PAGE_H - y * S
  const b = PAGE_H - (y + h) * S
  if (!r) return [moveTo(l, t), lineTo(rt, t), lineTo(rt, b), lineTo(l, b), closePath()]
  // Control points for a quarter circle drawn with one cubic Bézier.
  const c = r * 0.5523
  return [
    moveTo(l + r, t),
    lineTo(rt - r, t),
    appendBezierCurve(rt - r + c, t, rt, t - r + c, rt, t - r),
    lineTo(rt, b + r),
    appendBezierCurve(rt, b + r - c, rt - r + c, b, rt - r, b),
    lineTo(l + r, b),
    appendBezierCurve(l + r - c, b, l, b + r - c, l, b + r),
    lineTo(l, t - r),
    appendBezierCurve(l, t - r + c, l + r - c, t, l + r, t),
    closePath()
  ]
}

/** PNG and JPEG only, told apart by their bytes; anything else (or a broken file) shows as an empty card. */
async function embedImage(doc: PDFDocument, bytes: Uint8Array | undefined): Promise<PDFImage | null> {
  if (!bytes) return null
  try {
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return await doc.embedPng(bytes)
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return await doc.embedJpg(bytes)
  } catch {
    // A picture pdf-lib can't read costs that picture, not the export.
  }
  return null
}

export function colour(css: string): RGB {
  let hex = css.trim().replace(/^#/, '')
  if (/^[0-9a-f]{3}$/i.test(hex)) hex = [...hex].map((c) => c + c).join('')
  if (!/^[0-9a-f]{6}$/i.test(hex)) return rgb(0, 0, 0)
  const n = parseInt(hex, 16)
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

// Fonts

/** The parts of a fontkit font this file reads, some of them internal (fontkit 2.0.12). */
export interface FontkitFont {
  unitsPerEm: number
  numGlyphs: number
  hhea: { ascent: number; descent: number }
  'OS/2'?: { typoAscender: number; typoDescender: number; fsSelection?: { useTypoMetrics?: boolean } }
  directory: { tables: Record<string, { offset: number; length: number; transformed?: boolean } | undefined> }
  stream: { buffer: Uint8Array }
  _decompress?: () => void
  getGlyph(id: number): { _decode(): DecodedGlyph | null; advanceWidth: number }
  variationAxes?: Record<string, { min: number; max: number; default: number }>
  getVariation?(coords: Record<string, number>): FontkitFont
  layout(text: string): { glyphs: { codePoints: number[]; advanceWidth: number }[]; positions: { xAdvance: number }[] }
}

interface DecodedGlyph {
  numberOfContours: number
  points?: { x: number; y: number; onCurve: boolean; endContour: boolean }[]
  components?: { glyphID: number; dx: number; dy: number; scaleX: number; scaleY: number; scale01: number; scale10: number }[]
}

/**
 * The deck font as a browser would set it: kerned (pdf-lib's drawText leaves kerning out,
 * which made lines about 1.5% wider than in Glance), with ascent and descent as shares of
 * the font size for placing the baseline in a CSS line box.
 */
export interface Typeface {
  ascent: number
  descent: number
  widthOfTextAtSize(text: string, size: number): number
  /** spacing: letter spacing in points; slant: an oblique made from upright glyphs. */
  draw(page: PDFPage, text: string, x: number, y: number, size: number, color: RGB, opts?: { spacing?: number; slant?: boolean }): void
}

/**
 * `face` is the font as embedded; `shaper`, if given, is the variable font it was made
 * from, at the same axes, whose layout has the browser's widths and kerning (fontkit's
 * varied glyphs don't know their characters, so the characters come from `face`).
 */
export function typeface(doc: PDFDocument, face: FontkitFont, font: PDFFont, shaper: FontkitFont = face): Typeface {
  const os2 = face['OS/2']
  const [asc, desc] = os2?.fsSelection?.useTypoMetrics ? [os2.typoAscender, os2.typoDescender] : [face.hhea.ascent, face.hhea.descent]
  const em = face.unitsPerEm
  const keys = new WeakMap<PDFPage, PDFName>()
  return {
    ascent: asc / em,
    descent: Math.abs(desc) / em,
    widthOfTextAtSize: (text, size) => (shaper.layout(text).positions.reduce((n, p) => n + p.xAdvance, 0) / em) * size,
    draw(page, text, x, y, size, color, opts = {}) {
      const run = face.layout(text)
      const shaped = shaper === face ? run : shaper.layout(text)
      const positions = shaped.positions.length === run.glyphs.length ? shaped.positions : run.positions
      // TJ: each glyph, then how far the kerning pulls the next one back, in 1/1000 em.
      const parts: (PDFHexString | number)[] = []
      run.glyphs.forEach((g, i) => {
        if (!g.codePoints.length) return
        parts.push(font.encodeText(String.fromCodePoint(...g.codePoints)))
        const kern = positions[i].xAdvance - g.advanceWidth
        if (kern) parts.push((-kern / em) * 1000)
      })
      if (!keys.has(page)) keys.set(page, page.node.newFontDictionary(font.name, font.ref))
      const key = keys.get(page)!
      page.pushOperators(
        pushGraphicsState(), beginText(), setFillingColor(color), setFontAndSize(key, size),
        ...(opts.spacing ? [setCharacterSpacing(opts.spacing)] : []),
        opts.slant ? setTextMatrix(1, 0, 0.2, 1, x, y) : moveText(x, y),
        PDFOperator.of(PDFOperatorNames.ShowTextAdjusted, [doc.context.obj(parts)]), endText(), popGraphicsState()
      )
    }
  }
}

export const isWoff2 = (b: Uint8Array) => b[0] === 0x77 && b[1] === 0x4f && b[2] === 0x46 && b[3] === 0x32

/**
 * Rebuilds a WOFF2 font as TrueType. fontkit reads WOFF2, but pdf-lib's subsetter copies
 * glyph bytes as stored, and WOFF2 stores them transformed, so text came out blank. Every
 * other table is copied as is; glyf and loca are written again from the decoded glyphs.
 */
export function woff2ToTtf(face: FontkitFont): Uint8Array {
  return rebuildTtf(face, false)
}

/** Tables a plain instance of a variable font leaves out, so viewers don't vary it again. */
const VARIATION_TABLES = ['fvar', 'gvar', 'avar', 'HVAR', 'VVAR', 'MVAR', 'STAT', 'cvar']

/**
 * Writes `face` as TrueType from its decoded glyphs. With `instance`, `face` is a variable
 * font at some coordinates (fontkit's getVariation): its glyphs and advances at those
 * coordinates are written, without the variation tables.
 */
function rebuildTtf(face: FontkitFont, instance: boolean): Uint8Array {
  face._decompress?.()
  const tables = face.directory.tables
  const data = face.stream.buffer
  const out = new Map<string, Uint8Array>()
  for (const [tag, entry] of Object.entries(tables)) {
    if (!entry || tag === 'glyf' || tag === 'loca') continue
    if (instance && (VARIATION_TABLES.includes(tag) || tag === 'hmtx')) continue
    if (entry.transformed) throw new Error(`WOFF2 fonts with a transformed ${tag} table are not supported; use a TTF`)
    out.set(tag, data.slice(entry.offset, entry.offset + entry.length))
  }
  const glyphs: Uint8Array[] = []
  const boxes = new Map<number, number[]>()
  const bbox = (id: number): number[] => {
    if (boxes.has(id)) return boxes.get(id)!
    boxes.set(id, [0, 0, 0, 0]) // guards against a component loop
    const g = face.getGlyph(id)._decode()
    let pts: [number, number][] = []
    if (g?.points?.length) pts = g.points.map((p) => [p.x, p.y])
    for (const c of g?.components ?? []) {
      const [x0, y0, x1, y1] = bbox(c.glyphID)
      for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) pts.push([x * c.scaleX + y * c.scale01 + c.dx, y * c.scaleY + x * c.scale10 + c.dy])
    }
    const b = pts.length ? [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))].map(Math.round) : [0, 0, 0, 0]
    boxes.set(id, b)
    return b
  }
  for (let id = 0; id < face.numGlyphs; id++) glyphs.push(encodeGlyph(face.getGlyph(id)._decode(), bbox(id)))
  const loca = new DataView(new ArrayBuffer((glyphs.length + 1) * 4))
  let at = 0
  glyphs.forEach((g, i) => {
    loca.setUint32(i * 4, at)
    at += g.length
  })
  loca.setUint32(glyphs.length * 4, at)
  out.set('glyf', concat(glyphs))
  out.set('loca', new Uint8Array(loca.buffer))
  if (instance) {
    // Advances at these coordinates, one long metric per glyph.
    const hmtx = new DataView(new ArrayBuffer(face.numGlyphs * 4))
    let widest = 0
    for (let id = 0; id < face.numGlyphs; id++) {
      const adv = Math.max(0, Math.round(face.getGlyph(id).advanceWidth))
      widest = Math.max(widest, adv)
      hmtx.setUint16(id * 4, adv)
      hmtx.setInt16(id * 4 + 2, bbox(id)[0])
    }
    out.set('hmtx', new Uint8Array(hmtx.buffer))
    const hhea = out.get('hhea')
    if (hhea) {
      const v = new DataView(hhea.buffer, hhea.byteOffset, hhea.byteLength)
      v.setUint16(10, widest)
      v.setUint16(34, face.numGlyphs)
    }
  }
  const head = out.get('head')
  if (!head) throw new Error('font has no head table')
  const hv = new DataView(head.buffer, head.byteOffset, head.byteLength)
  hv.setUint32(8, 0) // checkSumAdjustment, filled in below
  hv.setInt16(50, 1) // indexToLocFormat: long offsets
  const font = sfnt(out)
  new DataView(head.buffer, head.byteOffset).setUint32(8, (0xb1b0afba - checksum(font)) >>> 0)
  return sfnt(out)
}

function encodeGlyph(g: DecodedGlyph | null, [x0, y0, x1, y1]: number[]): Uint8Array {
  if (!g || (g.numberOfContours >= 0 && !g.points?.length)) return new Uint8Array(0)
  const bytes: number[] = []
  const u16 = (n: number) => bytes.push((n >> 8) & 255, n & 255)
  u16(g.numberOfContours < 0 ? 0xffff : g.numberOfContours)
  for (const n of [x0, y0, x1, y1]) u16(n & 0xffff)
  if (g.numberOfContours < 0) {
    const comps = g.components ?? []
    comps.forEach((c, i) => {
      const words = [c.dx, c.dy].some((v) => v < -128 || v > 127)
      const two = c.scale01 !== 0 || c.scale10 !== 0
      const xy = !two && c.scaleX !== c.scaleY
      const one = !two && !xy && c.scaleX !== 1
      // ARGS_ARE_XY_VALUES, then words, scale kind and MORE_COMPONENTS as needed.
      u16(0x2 | (words ? 0x1 : 0) | (one ? 0x8 : 0) | (i < comps.length - 1 ? 0x20 : 0) | (xy ? 0x40 : 0) | (two ? 0x80 : 0))
      u16(c.glyphID)
      if (words) {
        u16(c.dx & 0xffff)
        u16(c.dy & 0xffff)
      } else bytes.push(c.dx & 255, c.dy & 255)
      const f2 = (v: number) => u16(Math.round(v * 16384) & 0xffff)
      if (one) f2(c.scaleX)
      if (xy) [c.scaleX, c.scaleY].forEach(f2)
      if (two) [c.scaleX, c.scale01, c.scale10, c.scaleY].forEach(f2)
    })
  } else {
    const pts = g.points!
    pts.forEach((p, i) => p.endContour && u16(i))
    u16(0) // no instructions; PDF viewers don't hint
    const flags: number[] = []
    const xs: number[] = []
    const ys: number[] = []
    let px = 0
    let py = 0
    for (const p of pts) {
      let flag = p.onCurve ? 1 : 0
      const coord = (d: number, short: number, same: number, out: number[]) => {
        if (d === 0) flag |= same
        else if (d > -256 && d < 256) {
          flag |= short | (d > 0 ? same : 0)
          out.push(Math.abs(d))
        } else out.push((d >> 8) & 255, d & 255)
      }
      coord(p.x - px, 0x2, 0x10, xs)
      coord(p.y - py, 0x4, 0x20, ys)
      flags.push(flag)
      px = p.x
      py = p.y
    }
    bytes.push(...flags, ...xs, ...ys)
  }
  while (bytes.length % 4) bytes.push(0)
  return new Uint8Array(bytes)
}

/** Writes a TrueType file from its tables. */
function sfnt(tables: Map<string, Uint8Array>): Uint8Array {
  const tags = [...tables.keys()].sort()
  const n = tags.length
  const pow = 2 ** Math.floor(Math.log2(n))
  const header = new DataView(new ArrayBuffer(12 + n * 16))
  header.setUint32(0, 0x00010000)
  header.setUint16(4, n)
  header.setUint16(6, pow * 16)
  header.setUint16(8, Math.log2(pow))
  header.setUint16(10, n * 16 - pow * 16)
  const parts: Uint8Array[] = [new Uint8Array(header.buffer)]
  let offset = header.byteLength
  tags.forEach((tag, i) => {
    const t = tables.get(tag)!
    const padded = new Uint8Array(Math.ceil(t.length / 4) * 4)
    padded.set(t)
    for (let j = 0; j < 4; j++) header.setUint8(12 + i * 16 + j, tag.charCodeAt(j) || 32)
    header.setUint32(12 + i * 16 + 4, checksum(padded))
    header.setUint32(12 + i * 16 + 8, offset)
    header.setUint32(12 + i * 16 + 12, t.length)
    parts.push(padded)
    offset += padded.length
  })
  return concat(parts)
}

function checksum(b: Uint8Array): number {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  let sum = 0
  for (let i = 0; i + 4 <= b.length; i += 4) sum = (sum + v.getUint32(i)) >>> 0
  return sum
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}
