/**
 * AI editing (ADR 0015): the tools that let the AI change the text of the PDF or image
 * open in Glance, in the look of the text around it.
 *
 * Edits are markup (ADR 0003): a text box in the page's own font, size, colour and line
 * spacing, drawn over what it replaces with the background colour (or, on photos and
 * textured backgrounds, a patch filled in from the surrounding pixels). Each tool call is
 * one undoable step, and every change stays outlined on the page until the user keeps or
 * undoes it from the sidebar. Messages here are read by the AI, so they're English.
 */
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { ToolError, type ToolHandler, type ToolResult } from '../core/mcp/protocol'
import { fontStack, newId, textBoxLayout, type Color, type Markup, type Rect, type TextMarkup } from '../core/markup'
import { samePath } from '../core/paths'
import {
  buildLines,
  buildParagraphs,
  cssFont,
  findSpans,
  genericOf,
  overlapping,
  paragraphGap,
  parseFontName,
  pickFamily,
  planAt,
  planInsert,
  planReplace,
  refineLine,
  wrapText,
  type Measurer,
  type Paragraph,
  type Run,
  type RunStyle,
  type Span,
  type TextBoxPlan
} from '../core/textLayout'
import * as engine from '../image/engine'
import * as platform from '../platform'
import { openPdf } from '../pdf/engine'
import { serialize } from './actions'
import { activeDoc, docs, ImageDoc, PdfDoc, type Doc } from './documents'

import { record, reveal, type AiChange } from './aiChanges'

// ---------------------------------------------------------------------------
// Measuring and sampling

let measureCtx: OffscreenCanvasRenderingContext2D | null = null

const stackFor = (s: RunStyle) => fontStack(s.family)

/** Width in points, measured by the WebView with the installed font. */
export const measure: Measurer = (text, style) => {
  measureCtx ??= new OffscreenCanvas(1, 1).getContext('2d')
  if (!measureCtx) return text.length * style.size * 0.5
  measureCtx.font = cssFont(style, 100, stackFor(style))
  return (measureCtx.measureText(text).width * style.size) / 100
}

interface Snapshot {
  pixels: ImageData
  /** Markup space to pixels. */
  toPx: (x: number, y: number) => [number, number]
  /** Pixels per markup unit. */
  scale: number
}

function px(s: Snapshot, x: number, y: number): [number, number, number] {
  const ix = Math.min(s.pixels.width - 1, Math.max(0, Math.round(x)))
  const iy = Math.min(s.pixels.height - 1, Math.max(0, Math.round(y)))
  const o = (iy * s.pixels.width + ix) * 4
  return [s.pixels.data[o], s.pixels.data[o + 1], s.pixels.data[o + 2]]
}

function pxRect(s: Snapshot, r: Rect): { x0: number; y0: number; x1: number; y1: number } {
  const [ax, ay] = s.toPx(r[0], r[3])
  const [bx, by] = s.toPx(r[2], r[1])
  return { x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) }
}

const dist = (a: number[], b: number[]) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])

/** The colour around a rectangle, and whether it's plain enough to cover with that colour. */
function background(s: Snapshot, r: Rect): { color: Color; flat: boolean } {
  const b = pxRect(s, r)
  const ring: [number, number, number][] = []
  const step = Math.max(1, Math.round((b.x1 - b.x0 + b.y1 - b.y0) / 160))
  for (let x = b.x0; x <= b.x1; x += step) ring.push(px(s, x, b.y0 - 2), px(s, x, b.y1 + 2))
  for (let y = b.y0; y <= b.y1; y += step) ring.push(px(s, b.x0 - 2, y), px(s, b.x1 + 2, y))
  const med = [0, 1, 2].map((k) => ring.map((p) => p[k]).sort((a, c) => a - c)[ring.length >> 1])
  const near = ring.filter((p) => dist(p, med) < 24).length / Math.max(1, ring.length)
  return { color: med.map((v) => v / 255) as Color, flat: near > 0.9 }
}

/** The ink colour inside a rectangle: the pixels furthest from its background. */
function inkColor(s: Snapshot, r: Rect): Color | undefined {
  const bg = background(s, r).color.map((v) => v * 255)
  const b = pxRect(s, r)
  const found: { d: number; p: [number, number, number] }[] = []
  const step = Math.max(1, Math.round(Math.sqrt(((b.x1 - b.x0) * (b.y1 - b.y0)) / 4000)))
  for (let y = b.y0; y < b.y1; y += step) for (let x = b.x0; x < b.x1; x += step) found.push({ d: dist(px(s, x, y), bg), p: px(s, x, y) })
  if (!found.length) return undefined
  found.sort((a, c) => c.d - a.d)
  const top = found.slice(0, Math.max(3, Math.floor(found.length * 0.08))).filter((f) => f.d > 60)
  if (!top.length) return undefined
  return [0, 1, 2].map((k) => top.reduce((n, f) => n + f.p[k], 0) / top.length / 255) as Color
}

/** Fills a rectangle from its surroundings (a smooth blend of the edges), as a PNG. */
async function patch(s: Snapshot, r: Rect): Promise<Uint8Array> {
  const b = pxRect(s, r)
  const w = Math.max(1, Math.round(b.x1 - b.x0))
  const h = Math.max(1, Math.round(b.y1 - b.y0))
  const out = new ImageData(w, h)
  for (let y = 0; y < h; y++) {
    const left = px(s, b.x0 - 2, b.y0 + y)
    const right = px(s, b.x1 + 2, b.y0 + y)
    for (let x = 0; x < w; x++) {
      const top = px(s, b.x0 + x, b.y0 - 2)
      const bottom = px(s, b.x0 + x, b.y1 + 2)
      const fx = (x + 0.5) / w
      const fy = (y + 0.5) / h
      // Nearer edges count more.
      const wx = 1 / Math.max(0.02, Math.min(fx, 1 - fx))
      const wy = 1 / Math.max(0.02, Math.min(fy, 1 - fy))
      const o = (y * w + x) * 4
      for (let k = 0; k < 3; k++) {
        const hz = left[k] * (1 - fx) + right[k] * fx
        const vt = top[k] * (1 - fy) + bottom[k] * fy
        out.data[o + k] = (hz * wx + vt * wy) / (wx + wy)
      }
      out.data[o + 3] = 255
    }
  }
  const c = new OffscreenCanvas(w, h)
  c.getContext('2d')!.putImageData(out, 0, 0)
  return new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer())
}

// ---------------------------------------------------------------------------
// Reading a page

interface PageModel {
  doc: PdfDoc | ImageDoc
  page: number
  /** Page size in markup units. */
  width: number
  height: number
  paras: Paragraph[]
  snap: Snapshot
}

const PX_PER_PT = 3

async function pdfSnapshot(d: PdfDoc, page: number): Promise<Snapshot> {
  const proxy: PDFDocumentProxy = d.markup.peek().some((m) => m.page === page) ? await openPdf(await serialize(d), d.password) : d.proxy.peek()!
  try {
    const pg = await proxy.getPage(page + 1)
    const base = pg.getViewport({ scale: 1, rotation: 0 })
    const scale = Math.min(PX_PER_PT, 3600 / Math.max(base.width, base.height))
    const vp = pg.getViewport({ scale, rotation: 0 })
    const c = document.createElement('canvas')
    c.width = Math.ceil(vp.width)
    c.height = Math.ceil(vp.height)
    await pg.render({ canvas: c, viewport: vp, background: 'white' }).promise
    const pixels = c.getContext('2d')!.getImageData(0, 0, c.width, c.height)
    c.width = c.height = 0
    return { pixels, scale, toPx: (x, y) => vp.convertToViewportPoint(x, y) as [number, number] }
  } finally {
    if (proxy !== d.proxy.peek()) await proxy.loadingTask.destroy()
  }
}

/** Text runs of a PDF page, with each font's real family, weight and slant. */
async function pdfRuns(d: PdfDoc, page: number): Promise<{ runs: Run[]; width: number; height: number }> {
  const proxy = d.proxy.peek()
  if (!proxy) throw new ToolError(`${d.name.peek()} is still loading`)
  const pg = await proxy.getPage(page + 1)
  const view = pg.view
  const content = await pg.getTextContent()
  // Fonts are only loaded (with their names) once the page's drawing commands are read.
  await pg.getOperatorList().catch(() => null)
  const installed = await platform.listFonts()
  const styles = new Map<string, RunStyle>()
  const runs: Run[] = []
  for (const it of content.items) {
    if (!('str' in it) || !it.str) continue
    const [a, b, c, dd, e, f] = it.transform as number[]
    if (Math.abs(b) > 0.01 || Math.abs(c) > 0.01 || a <= 0 || dd <= 0) continue // rotated or mirrored text isn't edited
    const size = Math.round(Math.hypot(c, dd) * 100) / 100
    const key = `${it.fontName}|${size}`
    let style = styles.get(key)
    if (!style) {
      const css = content.styles[it.fontName]
      let font: { name?: string; bold?: boolean; italic?: boolean; black?: boolean } | null = null
      try {
        if (pg.commonObjs.has(it.fontName)) font = pg.commonObjs.get(it.fontName)
      } catch {
        font = null
      }
      const parsed = parseFontName(font?.name ?? css?.fontFamily ?? 'sans-serif')
      const family = pickFamily(parsed.family, installed, genericOf(parsed.family, css?.fontFamily))
      style = {
        family,
        bold: parsed.bold || !!font?.bold || !!font?.black,
        italic: parsed.italic || !!font?.italic,
        size,
        ascent: Math.min(1.1, Math.max(0.6, css?.ascent ?? 0.8)),
        descent: Math.min(0.4, Math.max(0.1, Math.abs(css?.descent ?? 0.2)))
      }
      styles.set(key, style)
    }
    runs.push({ str: it.str, x: e, baseline: f, width: it.width, style })
  }
  return { runs, width: view[2] - view[0], height: view[3] - view[1] }
}

/** Text of an image, read with Windows OCR, as runs in markup space (y up, pixels). */
async function imageRuns(snap: Snapshot, height: number): Promise<Run[]> {
  if (!platform.ocrAvailable) throw new ToolError('Reading text in images uses the Windows OCR engine, available in the Windows app.')
  const max = Math.min(await platform.ocrMaxDimension(), 4000) || 2600
  const k = Math.min(1, max / Math.max(snap.pixels.width, snap.pixels.height))
  let data = snap.pixels
  if (k < 1) {
    const c = new OffscreenCanvas(snap.pixels.width, snap.pixels.height)
    c.getContext('2d')!.putImageData(snap.pixels, 0, 0)
    const small = new OffscreenCanvas(Math.round(c.width * k), Math.round(c.height * k))
    small.getContext('2d')!.drawImage(c, 0, 0, small.width, small.height)
    data = small.getContext('2d')!.getImageData(0, 0, small.width, small.height)
  }
  const result = await platform.ocrImage(data.data, data.width, data.height)
  const installed = await platform.listFonts()
  const family = pickFamily('Segoe UI', installed)
  const runs: Run[] = []
  for (const line of result.lines) {
    const words = line.words.map((w) => ({ ...w, x: w.x / k, y: w.y / k, w: w.w / k, h: w.h / k }))
    if (!words.length) continue
    const top = Math.min(...words.map((w) => w.y))
    const bottom = Math.max(...words.map((w) => w.y + w.h))
    const text = words.map((w) => w.text).join('')
    // Ink height covers ascenders and descenders when the line has them.
    const desc = /[gjpqy,;]/.test(text)
    const asc = /[A-Zbdfhklt0-9]/.test(text)
    const size = (bottom - top) / ((asc ? 0.74 : 0.52) + (desc ? 0.22 : 0))
    const baseline = bottom - (desc ? 0.22 * size : 0)
    const style: RunStyle = { family, bold: false, italic: false, size: Math.round(size * 10) / 10, ascent: 0.78, descent: 0.22 }
    for (const w of words) runs.push({ str: w.text + ' ', x: w.x, baseline: height - baseline, width: w.w + 0.25 * size, style })
  }
  return runs
}

/** Runs the AI drew earlier stand in for what they cover, so edits build on each other. */
function overlay(runs: Run[], markup: Markup[], page: number): Run[] {
  const boxes = markup.filter((m): m is TextMarkup => m.type === 'text' && m.page === page && m.ascent !== undefined)
  const covers = markup.filter((m) => m.page === page && ((m.type === 'text' && m.style.fill) || (m.type === 'signature' && m.patch) || (m.type === 'rect' && m.contents === COVER)))
  const hidden = (r: Run) =>
    covers.some((m) => {
      const b = m.type === 'text' || m.type === 'signature' || m.type === 'rect' ? m.rect : null
      const cx = r.x + r.width / 2
      return b && cx > b[0] && cx < b[2] && r.baseline > b[1] && r.baseline < b[3]
    })
  const out = runs.filter((r) => !hidden(r))
  for (const m of boxes) {
    const lay = textBoxLayout(m)
    const style: RunStyle = { family: m.font ?? 'Arial', bold: !!m.bold, italic: !!m.italic, size: m.fontSize, ascent: (m.ascent ?? 0.9) - 0.08, descent: 0.22, color: m.color }
    wrapText(m.text, m.rect[2] - m.rect[0] - lay.inset * 2, style, measure).forEach((line, i) => {
      if (!line) return
      out.push({ str: line, x: m.rect[0] + lay.inset, baseline: m.rect[3] - lay.baseline! - i * lay.lineHeight, width: measure(line, style), style })
    })
  }
  return out
}

/** Marks covers made by erasing, so later reads skip what they hide. */
const COVER = 'Glance AI cover'

/** Markup an AI edit drew: text matched to the page, a background patch, or a cover. */
const isAi = (m: Markup): boolean => (m.type === 'text' && m.ascent !== undefined) || (m.type === 'signature' && !!m.patch) || (m.type === 'rect' && m.contents === COVER)

async function model(d: PdfDoc | ImageDoc, page: number): Promise<PageModel> {
  if (d instanceof PdfDoc) {
    const { runs, width, height } = await pdfRuns(d, page)
    const snap = await pdfSnapshot(d, page)
    return finish(d, page, width, height, overlay(runs, d.markup.peek(), page), snap)
  }
  if (!d.editable) throw new ToolError(`${d.name.peek()} can’t be edited in Glance (multi-page images and previews are view-only)`)
  const flat = await engine.flatten(d)
  const pixels = engine.toCanvas(flat).getContext('2d')!.getImageData(0, 0, flat.width, flat.height)
  const snap: Snapshot = { pixels, scale: 1, toPx: (x, y) => [x, flat.height - y] }
  const runs = await imageRuns(snap, flat.height)
  return finish(d, page, flat.width, flat.height, overlay(runs, d.markup.peek(), page), snap)
}

function finish(d: PdfDoc | ImageDoc, page: number, width: number, height: number, runs: Run[], snap: Snapshot): PageModel {
  const lines = buildLines(runs).map((l) => refineLine(l, measure))
  // Colour is sampled per line and style: one font can be grey in the body and black elsewhere.
  for (const l of lines) {
    const own = new Map<RunStyle, RunStyle>()
    l.styles = l.styles.map((s, k) => {
      let c = own.get(s)
      if (!c) {
        let a = k
        let b = k
        while (b < l.styles.length && l.styles[b] === s) b++
        while (a > 0 && l.styles[a - 1] === s) a--
        c = { ...s, color: s.color ?? inkColor(snap, [l.xs[a], l.baseline - s.descent * s.size, l.xs[b], l.baseline + s.ascent * s.size * 0.9]) }
        own.set(s, c)
      }
      return c
    })
  }
  const paras = buildParagraphs(lines, page)
  return { doc: d, page, width, height, paras, snap }
}

// ---------------------------------------------------------------------------
// Applying an edit

interface Piece {
  plan: TextBoxPlan
  color?: Color
  /** Background to cover with, when already known (moved text spans other text). */
  bg?: Color
}

/** Markup for one box: its cover (fill or patch) and its text. */
async function draw(m: PageModel, { plan, color, bg: known }: Piece): Promise<Markup[]> {
  const { color: bg, flat } = known ? { color: known, flat: true } : background(m.snap, plan.rect)
  const added: Markup[] = []
  const base = { page: m.page, created: Date.now() }
  if (!flat) {
    added.push({ ...base, id: newId('ai'), type: 'signature', rect: plan.rect, png: await patch(m.snap, plan.rect), patch: true, style: { stroke: null, fill: null, width: 0, opacity: 1 } })
  }
  if (plan.text.trim()) {
    added.push({
      ...base,
      id: newId('ai'),
      type: 'text',
      rect: plan.rect,
      text: plan.text,
      fontSize: plan.style.size,
      color: color ?? plan.style.color ?? [0, 0, 0],
      font: plan.style.family,
      ...(plan.style.bold ? { bold: true } : {}),
      ...(plan.style.italic ? { italic: true } : {}),
      lineHeight: plan.lineHeight,
      ascent: plan.ascent,
      inset: plan.inset,
      style: { stroke: null, fill: flat ? bg : null, width: 0, opacity: 1 }
    })
  } else if (flat) {
    added.push({ ...base, id: newId('ai'), type: 'rect', rect: plan.rect, contents: COVER, style: { stroke: null, fill: bg, width: 0, opacity: 1 } })
  }
  return added
}

/** Draws the pieces in order (later ones on top) as one undoable step and one change to review. */
async function apply(m: PageModel, pieces: Piece[], label: string, what: AiChange['what']): Promise<AiChange> {
  const added: Markup[] = []
  for (const p of pieces) added.push(...(await draw(m, p)))
  // Earlier AI boxes the new ones fully cover are redrawn by them, so they go (text boxes
  // would otherwise show through: the page draws all text above all fills).
  const area = (r: Rect) => Math.max(0, r[2] - r[0]) * Math.max(0, r[3] - r[1])
  const inside = (a: Rect, b: Rect) => area([Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])]) >= 0.85 * area(a)
  const rects = pieces.map((p) => p.plan.rect)
  const old = m.doc.markup.peek()
  const removed = old.filter((x) => x.page === m.page && isAi(x) && rects.some((r) => inside((x as { rect: Rect }).rect, r)))
  m.doc.edit(label, { markup: [...old.filter((x) => !removed.includes(x)), ...added] })
  // The outline marks the edit itself (the last piece), not the text that moved for it.
  const rect = rects[rects.length - 1]
  const change: AiChange = { id: newId('change'), doc: m.doc, page: m.page, ids: added.map((a) => a.id), removed, rect, label, what }
  record(change)
  reveal(change)
  return change
}

/**
 * Moves the paragraphs below `y` in the column `left`..`right` down by `delta`, so text
 * that grew doesn't run into them. Returns the moves to draw underneath the edit, bottom
 * first, or a reason when they can't move (a coloured box, or the end of the page).
 */
function makeRoom(m: PageModel, y: number, left: number, right: number, delta: number, except: Paragraph[]): { pieces: Piece[]; problem?: string } {
  const below = m.paras.filter((p) => !except.includes(p) && p.top <= y + 0.5 && p.left < right && p.right > left).sort((a, b) => a.top - b.top)
  if (!below.length || delta <= 0) return { pieces: [] }
  const lowest = below[0]
  const margin = Math.min(36 * (m.doc instanceof PdfDoc ? 1 : m.width / 612), lowest.bottom)
  if (lowest.bottom - delta < margin) return { pieces: [], problem: 'the text below would run off the page' }
  const pieces: Piece[] = []
  for (const p of below) {
    const box = planReplace({ para: p, start: 0, end: p.text.length }, p.text, measure).box
    const rect: Rect = [box.rect[0], box.rect[1] - delta, box.rect[2], box.rect[3]]
    const bg = background(m.snap, box.rect)
    if (!bg.flat) return { pieces: [], problem: `${p.id} sits on a coloured background` }
    pieces.push({ plan: { ...box, rect, ascent: box.ascent + delta / box.style.size }, color: box.style.color, bg: bg.color })
  }
  return { pieces }
}

// ---------------------------------------------------------------------------
// Tool arguments

function editableTab(tab: unknown): PdfDoc | ImageDoc {
  let d: Doc | null | undefined
  if (tab === undefined || tab === null || tab === '') d = activeDoc.value
  else d = docs.value.find((x) => x.id === tab || (x.path.peek() !== null && samePath(x.path.peek()!, String(tab), platform.pathPolicy)))
  if (!d) throw new ToolError(tab ? `No open tab "${String(tab)}". glance_list_open lists the tabs.` : 'No document is open in Glance.')
  if (!(d instanceof PdfDoc || d instanceof ImageDoc)) throw new ToolError(`${d.name.peek()} isn’t a PDF or image, so its text can’t be edited here`)
  return d
}

function pageOf(d: PdfDoc | ImageDoc, page: unknown): number {
  if (page === undefined || page === null) return d.current.peek()
  const n = Number(page)
  const count = d.pageCount.peek()
  if (!Number.isInteger(n) || n < 1 || n > count) throw new ToolError(`page must be from 1 to ${count}`)
  return n - 1
}

const hex = (c?: Color) => (c ? '#' + c.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('') : undefined)

function parseColor(v: unknown): Color | undefined {
  if (typeof v !== 'string') return undefined
  const m = /^#?([0-9a-f]{6})$/i.exec(v.trim())
  if (!m) throw new ToolError('color must look like #1a2b3c')
  const n = parseInt(m[1], 16)
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

async function styleOverride(args: Record<string, unknown>): Promise<Partial<RunStyle>> {
  const o: Partial<RunStyle> = {}
  if (typeof args.font === 'string' && args.font.trim()) o.family = pickFamily(args.font, await platform.listFonts(), genericOf(args.font))
  if (args.size !== undefined) {
    const n = Number(args.size)
    if (!(n > 1 && n < 1000)) throw new ToolError('size is in points, from 2 to 999')
    o.size = n
  }
  if (typeof args.bold === 'boolean') o.bold = args.bold
  if (typeof args.italic === 'boolean') o.italic = args.italic
  const color = parseColor(args.color)
  if (color) o.color = color
  return o
}

/** Fractions of the page (0..1, top-left origin) to markup space, and back. */
function fromFraction(m: PageModel, x: number, y: number): [number, number] {
  return [x * m.width, m.height - y * m.height]
}

function toFraction(m: PageModel, r: Rect): number[] {
  const round = (v: number) => Math.round(v * 1000) / 1000
  return [round(r[0] / m.width), round(1 - r[3] / m.height), round(r[2] / m.width), round(1 - r[1] / m.height)]
}

function findParagraph(m: PageModel, ref: unknown): Paragraph {
  const s = String(ref ?? '').trim()
  const byId = m.paras.find((p) => p.id === s)
  if (byId) return byId
  const spans = findSpans(m.paras, s)
  if (spans.length) return spans[0].para
  throw new ToolError(`No paragraph "${s}" on page ${m.page + 1}. glance_text_layout lists the paragraphs and their ids.`)
}

const quote = (s: string) => `“${s.length > 60 ? s.slice(0, 57) + '…' : s}”`

function overlapNote(m: PageModel, rect: Rect, except: Paragraph[]): string {
  const hit = overlapping(m.paras, rect, except)
  return hit.length ? ` Warning: the new text now overlaps ${hit.map((p) => `${p.id} (${quote(p.text)})`).join(', ')}. Shorten it, or move that text.` : ''
}

// ---------------------------------------------------------------------------
// Tools

function json(value: Record<string, unknown>): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: value }
}

const textLayout: ToolHandler = async ({ tab, page }) => {
  const d = editableTab(tab)
  const m = await model(d, pageOf(d, page))
  return json({
    document: d.name.peek(),
    page: m.page + 1,
    note: 'box is [left, top, right, bottom] as fractions of the page from its top-left corner. Edit with glance_edit_text, add with glance_add_text.',
    paragraphs: m.paras.map((p) => ({
      id: p.id,
      text: p.text,
      box: toFraction(m, [p.left, p.bottom, p.right, p.top]),
      font: p.style.family,
      size: p.style.size,
      ...(p.style.bold ? { bold: true } : {}),
      ...(p.style.italic ? { italic: true } : {}),
      color: hex(p.style.color),
      lines: p.lines.length,
      line_height: Math.round(p.lineHeight * 100) / 100
    }))
  })
}

const editText: ToolHandler = async (args) => {
  const d = editableTab(args.tab)
  const replace = String(args.replace ?? '')
  const override = await styleOverride(args)
  const pages = args.page !== undefined && args.page !== null ? [pageOf(d, args.page)] : [d.current.peek(), ...Array.from({ length: d.pageCount.peek() }, (_, i) => i).filter((i) => i !== d.current.peek())]
  for (const page of pages.slice(0, 60)) {
    const m = await model(d, page)
    let spans
    if (args.paragraph) {
      const p = findParagraph(m, args.paragraph)
      spans = [{ para: p, start: 0, end: p.text.length }]
    } else {
      if (typeof args.find !== 'string' || !args.find.trim()) throw new ToolError('find (the exact text to change) or paragraph is required')
      spans = findSpans(m.paras, args.find)
    }
    if (!spans.length) continue
    const which = args.occurrence === 'all' ? spans : [spans[Math.max(0, Math.min(spans.length - 1, Number(args.occurrence ?? 1) - 1))]]
    // Several matches in one paragraph become one change from the first to the last.
    const byPara = new Map<Paragraph, Span[]>()
    for (const sp of which) byPara.set(sp.para, [...(byPara.get(sp.para) ?? []), sp])
    const notes: string[] = []
    for (const [para, list] of byPara) {
      const start = list[0].start
      const end = list[list.length - 1].end
      let middle = ''
      list.forEach((sp, i) => (middle += (i ? para.text.slice(list[i - 1].end, sp.start) : '') + replace))
      const plan = planReplace({ para, start, end }, middle, measure, override)
      const old = para.text.slice(list[0].start, list[0].end)
      const label = replace ? `Changed ${quote(old)} to ${quote(replace)}` : `Deleted ${quote(old)}`
      let note = ''
      let moves: Piece[] = []
      if (plan.extraLines && args.make_room !== false) {
        const delta = plan.extraLines * plan.box.lineHeight * plan.box.style.size
        const room = makeRoom(m, para.bottom, para.left, para.right, delta, [para])
        moves = room.pieces
        note = room.problem ? overlapNote(m, plan.box.rect, [para]) + ` (Glance couldn’t move the text below: ${room.problem}.)` : moves.length ? ` The text below moved down ${plan.extraLines} line${plan.extraLines === 1 ? '' : 's'} to make room.` : ''
      }
      await apply(m, [...moves, { plan: plan.box, color: override.color ?? plan.box.style.color }], label, replace ? { kind: 'replace', old, text: replace } : { kind: 'delete', old })
      notes.push(`${label}${list.length > 1 ? ` (${list.length} times)` : ''} on page ${page + 1}${plan.reflowed ? ' (the rest of the paragraph was laid out again)' : ''}.${note}`)
    }
    const more = spans.length > which.length ? ` ${spans.length - which.length} more match${spans.length - which.length === 1 ? '' : 'es'} on this page were left as they are (occurrence: "all" changes every one).` : ''
    return notes.join('\n') + more + '\nShown to the user for review; they can undo it from the sidebar or with Ctrl+Z.'
  }
  throw new ToolError(`Couldn’t find ${quote(String(args.find ?? args.paragraph))}${args.page ? ` on page ${args.page}` : ''}. Text must be within one paragraph; check the exact wording with glance_text_layout.`)
}

const addText: ToolHandler = async (args) => {
  const d = editableTab(args.tab)
  const m = await model(d, pageOf(d, args.page))
  const text = String(args.text ?? '').trim()
  if (!text) throw new ToolError('text is required')
  const override = await styleOverride(args)
  let plan: TextBoxPlan
  let near: Paragraph | null = null
  if (args.after || args.before) {
    near = findParagraph(m, args.after ?? args.before)
    const look = args.like ? findParagraph(m, args.like) : near
    // Right under a heading, keep the heading's own spacing to the text that follows it.
    const n = near
    const under = m.paras.filter((p) => p !== n && p.top < n.bottom && p.left < n.right + 200 && p.right > n.left).sort((a, b) => b.top - a.top)[0]
    const localGap = args.after && under && n.bottom - under.top < 3 * n.style.size ? n.bottom - under.top : paragraphGap(m.paras)
    plan = planInsert(near, args.after ? 'after' : 'before', text, localGap, measure, override, look)
  } else if (args.at && typeof args.at === 'object') {
    const at = args.at as { x?: number; y?: number; width?: number }
    const like = args.like ? findParagraph(m, args.like) : m.paras.slice().sort((a, b) => b.text.length - a.text.length)[0]
    const base: RunStyle = { ...(like?.style ?? { family: 'Arial', bold: false, italic: false, size: d instanceof PdfDoc ? 11 : 32, ascent: 0.8, descent: 0.2 }), ...override }
    const [x, top] = fromFraction(m, Number(at.x ?? 0.1), Number(at.y ?? 0.1))
    const width = Number(at.width ?? (like ? (like.right - like.left) / m.width : 0.8)) * m.width
    plan = planAt(x, top, width, text, base, like?.lineHeight ?? 1.2, measure)
  } else {
    throw new ToolError('Say where: after or before (a paragraph id or text in it), or at {x, y, width} as fractions of the page')
  }
  const color = override.color ?? plan.style.color
  // The new text's spot may still hold text that moves away, so take the column's background.
  const bgNear = near ? background(m.snap, [near.left, near.bottom, near.right, near.top]) : null
  let note = ''
  let moves: Piece[] = []
  if (args.after && near && args.make_room !== false) {
    const gap = paragraphGap(m.paras)
    const hits = overlapping(m.paras, plan.rect, [near])
    if (hits.length) {
      // The first paragraph below ends up one paragraph gap under the new text.
      const next = Math.max(...hits.map((h) => h.top))
      const room = makeRoom(m, near.bottom, plan.rect[0], plan.rect[2], next - (plan.rect[1] + 0.08 * plan.style.size - gap), [near])
      moves = room.pieces
      note = room.problem ? overlapNote(m, plan.rect, [near]) + ` (Glance couldn’t move the text below: ${room.problem}.)` : ' The text below moved down to make room.'
    }
  } else note = overlapNote(m, plan.rect, near ? [near] : [])
  await apply(m, [...moves, { plan, color, bg: moves.length && bgNear?.flat ? bgNear.color : undefined }], `Added ${quote(text)}`, { kind: 'add', text })
  const off = plan.rect[1] < 0 ? ' Warning: it runs past the bottom of the page.' : ''
  return `Added the text on page ${m.page + 1} in ${plan.style.family} ${plan.style.size} pt.${note}${off}\nShown to the user for review; they can undo it from the sidebar or with Ctrl+Z.`
}

const erase: ToolHandler = async (args) => {
  const d = editableTab(args.tab)
  const m = await model(d, pageOf(d, args.page))
  let rect: Rect
  let what: string
  let old: string | undefined
  if (args.paragraph) {
    const p = findParagraph(m, args.paragraph)
    const pad = 0.1 * p.style.size
    rect = [p.left - pad, p.bottom - pad, p.right + pad, p.top + pad]
    what = `Removed ${quote(p.text)}`
    old = p.text
  } else if (args.area && typeof args.area === 'object') {
    const a = args.area as { x?: number; y?: number; width?: number; height?: number }
    const [x1, y2] = fromFraction(m, Number(a.x ?? 0), Number(a.y ?? 0))
    const [x2, y1] = fromFraction(m, Number(a.x ?? 0) + Number(a.width ?? 0), Number(a.y ?? 0) + Number(a.height ?? 0))
    if (!(x2 > x1 && y2 > y1)) throw new ToolError('area needs a width and height')
    rect = [x1, y1, x2, y2]
    what = 'Erased an area'
  } else throw new ToolError('Give a paragraph (id or text in it) or an area {x, y, width, height} as fractions of the page')
  await apply(m, [{ plan: { rect, text: '', style: m.paras[0]?.style ?? { family: 'Arial', bold: false, italic: false, size: 12, ascent: 0.8, descent: 0.2 }, lineHeight: 1.2, ascent: 0.9, inset: 0 } }], what, { kind: 'erase', old })
  return `${what} on page ${m.page + 1}, filled in with the background.\nShown to the user for review; they can undo it from the sidebar or with Ctrl+Z.`
}

export const editHandlers: Record<string, ToolHandler> = {
  glance_text_layout: textLayout,
  glance_edit_text: editText,
  glance_add_text: addText,
  glance_erase: erase
}
