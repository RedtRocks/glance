/**
 * Markup ↔ PDF annotations (ADR 0003).
 *
 * Each markup becomes a standard annotation with its own appearance stream, so every
 * viewer shows it identically. Glance also stores its exact geometry in a private
 * /GlanceData entry, so reopening a file in Glance makes its markup editable again.
 * Annotations from other apps are left untouched in the page.
 */
import {
  LineCapStyle,
  LineJoinStyle,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFRef,
  PDFString,
  StandardFonts,
  beginText,
  concatTransformationMatrix,
  decodePDFRawStream,
  drawObject,
  drawSvgPath,
  endText,
  moveText,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setFillingRgbColor,
  setFontAndSize,
  setGraphicsState,
  setLineJoin,
  showText,
  type PDFFont,
  type PDFOperator
} from '@cantoo/pdf-lib'
import { collectGarbage } from './gc'
import { NOTE_SIZE, headPath, outlinePath, paintBounds, type Color, type Markup, type Rect } from './markup'

const FLIP: [number, number, number, number, number, number] = [1, 0, 0, -1, 0, 0]
const rgbOf = (c: Color) => rgb(c[0], c[1], c[2])

interface Ctx {
  doc: PDFDocument
  font: PDFFont | null
}

/** Paths from core/markup are in PDF space; drawSvgPath assumes SVG's y-down, so pre-flip. */
function path(d: string, opts: { stroke?: Color | null; fill?: Color | null; width?: number; gs?: string; round?: boolean }): PDFOperator[] {
  if (!d) return []
  const ops = drawSvgPath(d, {
    x: 0,
    y: 0,
    scale: 1,
    matrix: FLIP,
    color: opts.fill ? rgbOf(opts.fill) : undefined,
    borderColor: opts.stroke ? rgbOf(opts.stroke) : undefined,
    borderWidth: opts.stroke ? (opts.width ?? 1) : 0,
    borderLineCap: opts.round ? LineCapStyle.Round : undefined,
    graphicsState: opts.gs
  })
  return opts.round ? [pushGraphicsState(), setLineJoin(LineJoinStyle.Round), ...ops, popGraphicsState()] : ops
}

/** Characters the standard Helvetica font can't encode are replaced for the appearance only. */
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

function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const lines: string[] = []
  for (const para of text.split(/\r?\n/)) {
    let line = ''
    for (const word of para.split(/(\s+)/)) {
      const next = line + word
      if (line && font.widthOfTextAtSize(next.trimEnd(), size) > width) {
        lines.push(line.trimEnd())
        line = word.trimStart()
      } else {
        line = next
      }
    }
    lines.push(line.trimEnd())
  }
  return lines
}

async function appearance(ctx: Ctx, m: Markup, bbox: Rect): Promise<{ ops: PDFOperator[]; resources: Record<string, unknown> }> {
  const { doc } = ctx
  const s = m.style
  const ext: Record<string, unknown> = {}
  const resources: Record<string, unknown> = { ExtGState: ext }
  let gs: string | undefined
  if (s.opacity < 1 || m.type === 'highlight') {
    ext.GS0 = doc.context.obj({ Type: 'ExtGState', CA: s.opacity, ca: s.opacity, ...(m.type === 'highlight' ? { BM: 'Multiply' } : {}) })
    gs = 'GS0'
  }
  const ops: PDFOperator[] = []
  if (gs) ops.push(pushGraphicsState(), setGraphicsState(gs))

  switch (m.type) {
    case 'highlight':
      ops.push(...path(outlinePath(m), { fill: s.stroke ?? [1, 0.85, 0.2] }))
      break
    case 'underline':
    case 'strike':
    case 'line':
    case 'ink':
    case 'polygon':
      ops.push(...path(outlinePath(m), { stroke: s.stroke, fill: m.type === 'polygon' && m.closed ? s.fill : null, width: s.width, round: true }))
      break
    case 'arrow':
      ops.push(...path(outlinePath(m), { stroke: s.stroke, width: s.width, round: true }))
      ops.push(...path(headPath(m), { fill: s.stroke }))
      break
    case 'note': {
      const [x, y] = m.at
      const icon = `M${x} ${y - NOTE_SIZE}h${NOTE_SIZE}v${NOTE_SIZE}h${-NOTE_SIZE}Z`
      ops.push(...path(icon, { fill: s.fill ?? [1, 0.85, 0.2], stroke: [0.6, 0.45, 0], width: 0.8 }))
      for (let i = 0; i < 3; i++) {
        const ly = y - 6 - i * 4
        ops.push(...path(`M${x + 4} ${ly}H${x + NOTE_SIZE - 4}`, { stroke: [0.45, 0.35, 0], width: 1 }))
      }
      break
    }
    case 'text': {
      if (s.fill || s.stroke) ops.push(...path(outlinePath({ ...m, type: 'rect' }), { fill: s.fill, stroke: s.stroke, width: s.width }))
      ctx.font ??= await doc.embedFont(StandardFonts.Helvetica)
      const font = ctx.font
      resources.Font = { Helv: font.ref }
      const pad = 4
      const lines = wrap(font, encodable(font, m.text), m.fontSize, m.rect[2] - m.rect[0] - pad * 2)
      const lineH = m.fontSize * 1.2
      ops.push(beginText(), setFontAndSize('Helv', m.fontSize), setFillingRgbColor(...m.color))
      ops.push(moveText(m.rect[0] + pad, m.rect[3] - pad - m.fontSize))
      lines.forEach((line, i) => {
        if (i) ops.push(moveText(0, -lineH))
        ops.push(showText(font.encodeText(line)))
      })
      ops.push(endText())
      break
    }
    case 'signature': {
      const img = await doc.embedPng(m.png)
      resources.XObject = { Sig: img.ref }
      const [x1, y1, x2, y2] = m.rect
      ops.push(pushGraphicsState(), concatTransformationMatrix(x2 - x1, 0, 0, y2 - y1, x1, y1), drawObject('Sig'), popGraphicsState())
      break
    }
    default:
      ops.push(...path(outlinePath(m), { stroke: s.stroke, fill: s.fill, width: s.width, round: m.type !== 'rect' }))
  }
  if (gs) ops.push(popGraphicsState())
  void bbox
  return { ops, resources }
}

const SUBTYPE: Record<Markup['type'], string> = {
  rect: 'Square',
  roundRect: 'Polygon',
  oval: 'Circle',
  star: 'Polygon',
  bubble: 'Polygon',
  line: 'Line',
  arrow: 'Line',
  polygon: 'Polygon',
  ink: 'Ink',
  text: 'FreeText',
  note: 'Text',
  highlight: 'Highlight',
  underline: 'Underline',
  strike: 'StrikeOut',
  signature: 'Stamp'
}

function pdfDate(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
}

/** Portable, standards-based fields other viewers use; Glance itself reads /GlanceData. */
function standardFields(m: Markup, ctx: Ctx): Record<string, unknown> {
  const c = ctx.doc.context
  const fields: Record<string, unknown> = {}
  if (m.style.stroke && m.type !== 'text') fields.C = c.obj(m.style.stroke)
  if (m.style.fill && ['rect', 'oval', 'polygon', 'roundRect', 'star', 'bubble'].includes(m.type)) fields.IC = c.obj(m.style.fill)
  fields.BS = c.obj({ Type: 'Border', W: m.style.width, S: 'S' })
  switch (m.type) {
    case 'line':
    case 'arrow':
      fields.L = c.obj([...m.from, ...m.to])
      if (m.type === 'arrow') fields.LE = c.obj(['None', 'OpenArrow'])
      break
    case 'ink':
      fields.InkList = c.obj(m.strokes.map((s) => s.flat()))
      break
    case 'polygon':
      fields.Vertices = c.obj(m.points.flat())
      break
    case 'highlight':
    case 'underline':
    case 'strike':
      fields.QuadPoints = c.obj(m.quads.flat())
      break
    case 'text':
      fields.DA = PDFString.of(`/Helv ${m.fontSize} Tf ${m.color.join(' ')} rg`)
      break
    case 'note':
      fields.Name = PDFName.of('Comment')
      fields.Open = false
      break
    case 'signature':
      fields.Name = PDFName.of('Signature')
      break
  }
  return fields
}

function contentsOf(m: Markup): string | undefined {
  if (m.type === 'text' || m.type === 'note') return m.text
  return m.contents
}

/** Adds markup to the PDF as annotations and returns the saved bytes. */
export async function writeMarkup(bytes: Uint8Array, markup: Markup[], options: { objectStreams?: boolean } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
  const ctx: Ctx = { doc, font: null }
  const pages = doc.getPages()
  for (const m of markup) {
    const page = pages[m.page]
    if (!page) continue
    const rect = paintBounds(m)
    const { ops, resources } = await appearance(ctx, m, rect)
    const ap = doc.context.register(doc.context.formXObject(ops, { BBox: rect, Resources: resources as never }))
    const { png, ...geometry } = m as Markup & { png?: Uint8Array }
    const data: Record<string, unknown> = {
      Type: 'Annot',
      Subtype: SUBTYPE[m.type],
      Rect: rect,
      F: 4, // Print
      NM: PDFString.of(m.id),
      M: PDFString.of(pdfDate(m.created)),
      T: PDFHexString.fromText('Glance'),
      CA: m.style.opacity,
      AP: { N: ap },
      P: page.ref,
      GlanceData: PDFHexString.fromText(JSON.stringify(geometry)),
      ...standardFields(m, ctx)
    }
    const text = contentsOf(m)
    if (text) data.Contents = PDFHexString.fromText(text)
    if (png) data.GlanceImage = doc.context.register(doc.context.flateStream(png))
    const annot = doc.context.register(doc.context.obj(data as never))
    page.node.addAnnot(annot)
  }
  collectGarbage(doc)
  return doc.save({ useObjectStreams: options.objectStreams ?? true, updateFieldAppearances: false })
}

function streamBytes(obj: unknown): Uint8Array | null {
  if (obj instanceof PDFRawStream) {
    const filter = obj.dict.get(PDFName.of('Filter'))
    return filter ? decodePDFRawStream(obj).decode() : obj.contents
  }
  return null
}

/**
 * Pulls Glance-authored annotations out of a PDF so they can be edited as markup.
 * Returns the PDF without them; foreign annotations stay in place.
 */
export async function extractMarkup(bytes: Uint8Array): Promise<{ bytes: Uint8Array; markup: Markup[] }> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
  const markup: Markup[] = []
  let removed = false
  doc.getPages().forEach((page, pageIndex) => {
    const annots = page.node.Annots()
    if (!annots) return
    for (let i = annots.size() - 1; i >= 0; i--) {
      const entry = annots.get(i)
      const dict = doc.context.lookup(entry)
      if (!(dict instanceof PDFDict)) continue
      const raw = dict.get(PDFName.of('GlanceData'))
      if (!(raw instanceof PDFHexString || raw instanceof PDFString)) continue
      try {
        const m = JSON.parse(raw.decodeText()) as Markup
        m.page = pageIndex
        if (m.type === 'signature') {
          const img = streamBytes(doc.context.lookup(dict.get(PDFName.of('GlanceImage'))))
          if (!img) continue
          ;(m as Extract<Markup, { type: 'signature' }>).png = img
        }
        markup.unshift(m)
        annots.remove(i)
        if (entry instanceof PDFRef) doc.context.delete(entry)
        removed = true
      } catch {
        // Corrupt Glance data: leave the annotation as a regular (read-only) one.
      }
    }
    if (annots.size() === 0) page.node.delete(PDFName.of('Annots'))
  })
  if (!removed) return { bytes, markup }
  collectGarbage(doc)
  return { bytes: await doc.save({ useObjectStreams: true, updateFieldAppearances: false }), markup }
}

