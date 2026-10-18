/**
 * Deck to PDF: one page per shown slide, drawn from the same layout boxes as the HTML
 * view (src/core/deck/html.ts), so the export looks like the deck in Glance. Text is real
 * text in the deck's font, wrapped here with the font's own widths.
 *
 * Only call this through a dynamic import: it pulls in pdf-lib and fontkit.
 */
import {
  PDFDocument, PDFOperator, PDFOperatorNames, appendBezierCurve, beginText, clip, closePath, endPath, endText, fill, lineTo,
  moveText, moveTo, popGraphicsState, pushGraphicsState, rgb, setFillingColor, setFontAndSize,
  type PDFFont, type PDFHexString, type PDFImage, type PDFName, type PDFPage, type RGB
} from '@cantoo/pdf-lib'
import fontkit from '@cantoo/fontkit'
import { SLIDE_H, SLIDE_W, layoutSlide, type Box, type TextBox } from '../core/deck/layout'
import { type Deck } from '../core/deck/model'
import { themeOf, type DeckTheme } from '../core/deck/themes'

/** PDF points per slide unit: a 1920 by 1080 slide becomes a 960 by 540 pt page. */
const S = 0.5
const PAGE_W = SLIDE_W * S
const PAGE_H = SLIDE_H * S

export async function deckToPdf(deck: Deck, media: Map<string, Uint8Array>, fonts: { regular: Uint8Array }): Promise<Uint8Array> {
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
  for (const slide of shown) {
    const page = doc.addPage([PAGE_W, PAGE_H])
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
      fillRect(page, box.x, box.y, box.w, box.h, box.radius, colour(box.fill))
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

function colour(css: string): RGB {
  let hex = css.trim().replace(/^#/, '')
  if (/^[0-9a-f]{3}$/i.test(hex)) hex = [...hex].map((c) => c + c).join('')
  if (!/^[0-9a-f]{6}$/i.test(hex)) return rgb(0, 0, 0)
  const n = parseInt(hex, 16)
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

// Fonts

/** The parts of a fontkit font this file reads, some of them internal (fontkit 2.0.12). */
interface FontkitFont {
  unitsPerEm: number
  numGlyphs: number
  hhea: { ascent: number; descent: number }
  'OS/2'?: { typoAscender: number; typoDescender: number; fsSelection?: { useTypoMetrics?: boolean } }
  directory: { tables: Record<string, { offset: number; length: number; transformed?: boolean } | undefined> }
  stream: { buffer: Uint8Array }
  _decompress?: () => void
  getGlyph(id: number): { _decode(): DecodedGlyph | null }
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
interface Typeface {
  ascent: number
  descent: number
  widthOfTextAtSize(text: string, size: number): number
  draw(page: PDFPage, text: string, x: number, y: number, size: number, color: RGB): void
}

function typeface(doc: PDFDocument, face: FontkitFont, font: PDFFont): Typeface {
  const os2 = face['OS/2']
  const [asc, desc] = os2?.fsSelection?.useTypoMetrics ? [os2.typoAscender, os2.typoDescender] : [face.hhea.ascent, face.hhea.descent]
  const em = face.unitsPerEm
  const keys = new WeakMap<PDFPage, PDFName>()
  return {
    ascent: asc / em,
    descent: Math.abs(desc) / em,
    widthOfTextAtSize: (text, size) => (face.layout(text).positions.reduce((n, p) => n + p.xAdvance, 0) / em) * size,
    draw(page, text, x, y, size, color) {
      const run = face.layout(text)
      // TJ: each glyph, then how far the kerning pulls the next one back, in 1/1000 em.
      const parts: (PDFHexString | number)[] = []
      run.glyphs.forEach((g, i) => {
        if (!g.codePoints.length) return
        parts.push(font.encodeText(String.fromCodePoint(...g.codePoints)))
        const kern = run.positions[i].xAdvance - g.advanceWidth
        if (kern) parts.push((-kern / em) * 1000)
      })
      if (!keys.has(page)) keys.set(page, page.node.newFontDictionary(font.name, font.ref))
      const key = keys.get(page)!
      page.pushOperators(
        pushGraphicsState(), beginText(), setFillingColor(color), setFontAndSize(key, size), moveText(x, y),
        PDFOperator.of(PDFOperatorNames.ShowTextAdjusted, [doc.context.obj(parts)]), endText(), popGraphicsState()
      )
    }
  }
}

const isWoff2 = (b: Uint8Array) => b[0] === 0x77 && b[1] === 0x4f && b[2] === 0x46 && b[3] === 0x32

/**
 * Rebuilds a WOFF2 font as TrueType. fontkit reads WOFF2, but pdf-lib's subsetter copies
 * glyph bytes as stored, and WOFF2 stores them transformed, so text came out blank. Every
 * other table is copied as is; glyf and loca are written again from the decoded glyphs.
 */
export function woff2ToTtf(face: FontkitFont): Uint8Array {
  face._decompress?.()
  const tables = face.directory.tables
  const data = face.stream.buffer
  const out = new Map<string, Uint8Array>()
  for (const [tag, entry] of Object.entries(tables)) {
    if (!entry || tag === 'glyf' || tag === 'loca') continue
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
