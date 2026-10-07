/**
 * Headers, footers, page numbers and watermarks drawn into PDF pages
 * (Pages → Header, Footer & Watermark). The text becomes part of the page content,
 * like Acrobat's "Add Header & Footer", so every viewer and printer shows it.
 */
export * from './stampOptions'
import { expandTokens, parsePageRange, type Slot, type StampEnv, type StampFont, type StampOptions } from './stampOptions'
import { concatTransformationMatrix, degrees, PDFDocument, PDFFont, PDFPage, popGraphicsState, pushGraphicsState, rgb, StandardFonts } from '@cantoo/pdf-lib'

function hexColor(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  const n = m ? parseInt(m[1], 16) : 0
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

const STANDARD: Record<StampFont, StandardFonts> = {
  Helvetica: StandardFonts.Helvetica,
  Times: StandardFonts.TimesRoman,
  Courier: StandardFonts.Courier
}
const SYSTEM_FALLBACK: Record<StampFont, string[]> = {
  Helvetica: ['Segoe UI', 'DejaVu Sans', 'Noto Sans', 'Noto Sans CJK SC', 'Noto Color Emoji'],
  Times: ['Times New Roman', 'DejaVu Serif', 'Noto Serif', 'Noto Sans CJK SC', 'Noto Color Emoji'],
  Courier: ['Consolas', 'DejaVu Sans Mono', 'Noto Sans Mono', 'Noto Sans CJK SC', 'Noto Color Emoji']
}

function encodes(font: PDFFont, text: string): boolean {
  try {
    font.encodeText(text)
    return true
  } catch {
    return false
  }
}

/**
 * Maps a page's visible area, as the reader sees it (origin bottom left, rotation
 * applied), onto the page's own coordinates, so a header lands at the top of a
 * page stored sideways.
 */
export function displayTransform(page: PDFPage): { width: number; height: number; matrix: [number, number, number, number, number, number] } {
  const { x, y, width: w, height: h } = page.getCropBox()
  const r = (((page.getRotation().angle % 360) + 360) % 360) as 0 | 90 | 180 | 270
  switch (r) {
    case 90:
      return { width: h, height: w, matrix: [0, 1, -1, 0, x + w, y] }
    case 180:
      return { width: w, height: h, matrix: [-1, 0, 0, -1, x + w, y + h] }
    case 270:
      return { width: h, height: w, matrix: [0, -1, 1, 0, x, y + h] }
    default:
      return { width: w, height: h, matrix: [1, 0, 0, 1, x, y] }
  }
}

interface Fonts {
  get(text: string): Promise<PDFFont>
}

function fontSource(doc: PDFDocument, o: StampOptions, env: StampEnv): Fonts {
  let standard: PDFFont | null = null
  let system: Promise<PDFFont | null> | null = null
  return {
    async get(text) {
      standard ??= await doc.embedFont(STANDARD[o.font])
      if (encodes(standard, text) || !env.loadFont) return standard
      system ??= (async () => {
        let bytes: Uint8Array | null = null
        for (const family of SYSTEM_FALLBACK[o.font]) {
          bytes = await env.loadFont!(family)
          if (bytes) break
        }
        if (!bytes) return null
        const fontkit = (await import('@cantoo/fontkit')).default
        doc.registerFontkit(fontkit as never)
        return doc.embedFont(bytes, { subset: true })
      })()
      return (await system) ?? standard
    }
  }
}

/** Drops characters a font can't draw instead of failing the whole operation. */
function drawable(font: PDFFont, text: string): string {
  if (encodes(font, text)) return text
  return [...text].filter((c) => encodes(font, c)).join('')
}

async function stampPage(
  doc: PDFDocument,
  page: PDFPage,
  o: StampOptions,
  fonts: Fonts,
  image: Awaited<ReturnType<PDFDocument['embedPng']>> | null,
  vars: { page: number; pages: number; date: string; file: string }
): Promise<void> {
  const { width, height, matrix } = displayTransform(page)
  const color = hexColor(o.color)
  // Isolate the existing content, so a transform it leaves behind can't move the stamps.
  const ctx = doc.context
  page.node.normalize()
  page.node.wrapContentStreams(ctx.register(ctx.contentStream([pushGraphicsState()])), ctx.register(ctx.contentStream([popGraphicsState()])))
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...matrix))

  const wm = o.watermark
  if (wm?.kind === 'text' && wm.text.trim()) {
    const raw = expandTokens(wm.text, vars)
    const font = await fonts.get(raw)
    const text = drawable(font, raw)
    const rad = (wm.angle * Math.PI) / 180
    let size = wm.size
    if (!size) {
      // Fit along the rotated baseline, inside the page with some room.
      const unit = font.widthOfTextAtSize(text, 1) || 1
      const along = Math.min(Math.abs(Math.cos(rad)) > 1e-3 ? width / Math.abs(Math.cos(rad)) : Infinity, Math.abs(Math.sin(rad)) > 1e-3 ? height / Math.abs(Math.sin(rad)) : Infinity)
      size = Math.max(6, Math.min(200, (along * 0.8) / unit))
    }
    const w = font.widthOfTextAtSize(text, size)
    const capH = font.heightAtSize(size, { descender: false }) * 0.7
    // drawText rotates around its start point: offset so the text's center is the page's.
    const cx = width / 2 - (Math.cos(rad) * w) / 2 + (Math.sin(rad) * capH) / 2
    const cy = height / 2 - (Math.sin(rad) * w) / 2 - (Math.cos(rad) * capH) / 2
    page.drawText(text, { x: cx, y: cy, size, font, color: hexColor(wm.color), opacity: o.opacity, rotate: degrees(wm.angle) })
  } else if (wm?.kind === 'image' && image) {
    const w = width * Math.min(Math.max(wm.scale, 0.05), 1)
    const h = (w * image.height) / image.width
    const fit = Math.min(1, height / h)
    page.drawImage(image, { x: (width - w * fit) / 2, y: (height - h * fit) / 2, width: w * fit, height: h * fit, opacity: o.opacity })
  }

  const rows: [Record<Slot, string>, number][] = [
    [o.header, height - o.margin - o.size * 0.75],
    [o.footer, o.margin]
  ]
  for (const [row, y] of rows) {
    for (const slot of ['left', 'center', 'right'] as Slot[]) {
      if (!row[slot].trim()) continue
      const raw = expandTokens(row[slot], vars)
      const font = await fonts.get(raw)
      const text = drawable(font, raw)
      const w = font.widthOfTextAtSize(text, o.size)
      const x = slot === 'left' ? o.margin : slot === 'right' ? width - o.margin - w : (width - w) / 2
      page.drawText(text, { x, y, size: o.size, font, color })
    }
  }
  page.pushOperators(popGraphicsState())
}

/**
 * Stamps the selected pages. `numbering` makes a one-page document look like page
 * `index` of `pageCount` (the dialog's preview).
 */
export async function stampPdf(
  bytes: Uint8Array,
  o: StampOptions,
  env: StampEnv,
  numbering?: { index: number; pageCount: number }
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
  const pageCount = numbering?.pageCount ?? doc.getPageCount()
  const selected = parsePageRange(o.pages, pageCount)
  if (!selected) throw new Error(`“${o.pages}” isn’t a page range. Use something like 1-3, 5, 8-.`)
  const total = o.startNumber + selected.length - 1
  const fonts = fontSource(doc, o, env)
  const wm = o.watermark
  const image = wm?.kind === 'image' ? await (wm.type === 'png' ? doc.embedPng(wm.bytes) : doc.embedJpg(wm.bytes)) : null
  const pages = doc.getPages()
  for (const [k, index] of selected.entries()) {
    const page = numbering ? (index === numbering.index ? pages[0] : null) : pages[index]
    if (!page) continue
    await stampPage(doc, page, o, fonts, image, { page: o.startNumber + k, pages: total, date: env.date, file: env.fileName })
  }
  return doc.save({ useObjectStreams: true, updateFieldAppearances: false })
}

/** Page `index` alone, for previewing stamps without reprocessing the whole file. */
export async function extractPage(bytes: Uint8Array, index: number): Promise<Uint8Array> {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
  const out = await PDFDocument.create({ updateMetadata: false })
  const [page] = await out.copyPages(src, [index])
  out.addPage(page)
  return out.save()
}
