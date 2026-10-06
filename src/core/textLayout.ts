/**
 * AI editing (ADR 0015): reading a page's text as lines and paragraphs with their look,
 * and planning an edit so the new text sits where the old text was, in the same font,
 * size, colour and line spacing.
 *
 * Everything is in unrotated PDF user space (points, y up), like markup. Pure, so it can
 * be tested without a renderer: measuring text is passed in.
 */
import type { Color, Rect } from './markup'

export interface RunStyle {
  /** Font family as installed on Windows ("Calibri", "Times New Roman"). */
  family: string
  bold: boolean
  italic: boolean
  size: number
  /** Font ascent and descent as fractions of the size (both positive). */
  ascent: number
  descent: number
  color?: Color
}

/** A piece of text on one baseline in one style (a PDF.js text item, or an OCR word). */
export interface Run {
  str: string
  x: number
  baseline: number
  width: number
  style: RunStyle
}

/** Width of `text` in `style`, in points. */
export type Measurer = (text: string, style: RunStyle) => number

export interface Line {
  text: string
  /** x of each character boundary (text.length + 1 entries). */
  xs: number[]
  /** Run style of each character. */
  styles: RunStyle[]
  x0: number
  x1: number
  baseline: number
  size: number
}

export interface Paragraph {
  id: string
  page: number
  lines: Line[]
  text: string
  left: number
  right: number
  top: number
  bottom: number
  /** The style most of the text has. */
  style: RunStyle
  /** Baseline to baseline, as a multiple of the size. */
  lineHeight: number
  /** For each character of `text`: its line and index there (-1 for joining spaces). */
  map: { line: number; index: number }[]
}

const median = (v: number[]): number => {
  if (!v.length) return 0
  const s = [...v].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

const sameStyle = (a: RunStyle, b: RunStyle): boolean => a.family === b.family && a.bold === b.bold && a.italic === b.italic && Math.abs(a.size - b.size) < 0.5

const lineTop = (l: Line, s: RunStyle) => l.baseline + s.ascent * l.size
const lineBottom = (l: Line, s: RunStyle) => l.baseline - s.descent * l.size

/** Groups runs into lines: same baseline, close together left to right. Columns stay apart. */
export function buildLines(runs: Run[]): Line[] {
  const sorted = runs.filter((r) => r.str.length && r.width > 0).sort((a, b) => b.baseline - a.baseline || a.x - b.x)
  const lines: Line[] = []
  for (const r of sorted) {
    const size = r.style.size
    const line = lines.find((l) => Math.abs(l.baseline - r.baseline) < 0.35 * Math.max(size, l.size) && r.x >= l.x1 - 0.5 * size && r.x - l.x1 < 2 * size)
    const share = r.width / r.str.length
    if (!line) {
      lines.push({ text: r.str, xs: Array.from({ length: r.str.length + 1 }, (_, k) => r.x + k * share), styles: Array(r.str.length).fill(r.style), x0: r.x, x1: r.x + r.width, baseline: r.baseline, size })
      continue
    }
    const gap = r.x - line.x1
    if (gap > 0.15 * size && !/\s$/.test(line.text) && !/^\s/.test(r.str)) {
      line.text += ' '
      line.styles.push(r.style)
      line.xs.push(r.x)
    }
    line.text += r.str
    for (let k = 0; k < r.str.length; k++) line.styles.push(r.style)
    // Boundaries after the first are this run's; its start replaces the previous end.
    line.xs[line.xs.length - 1] = gap > 0.15 * size ? line.xs[line.xs.length - 1] : r.x
    for (let k = 1; k <= r.str.length; k++) line.xs.push(r.x + k * share)
    line.x1 = Math.max(line.x1, r.x + r.width)
    line.size = Math.max(line.size, size)
  }
  return lines
}

/** Places characters by measured width instead of evenly, keeping each run's real extent. */
export function refineLine(line: Line, measure: Measurer): Line {
  const xs = [...line.xs]
  let i = 0
  while (i < line.text.length) {
    let j = i + 1
    while (j < line.text.length && line.styles[j] === line.styles[i] && line.text[j] !== ' ') j++
    const s = line.text.slice(i, j)
    const total = measure(s, line.styles[i])
    if (total > 0 && j - i > 1) {
      const a = line.xs[i]
      const b = line.xs[j]
      for (let k = i + 1; k < j; k++) xs[k] = a + ((b - a) * measure(s.slice(0, k - i), line.styles[i])) / total
    }
    i = j
  }
  return { ...line, xs }
}

const styleKey = (s: RunStyle) => `${s.family}|${s.bold}|${s.italic}|${s.size}|${s.color?.map((v) => Math.round(v * 40)).join(',')}`

function mainStyle(lines: Line[]): RunStyle {
  const count = new Map<string, { style: RunStyle; n: number }>()
  for (const l of lines)
    for (let k = 0; k < l.text.length; k++) {
      if (l.text[k] === ' ') continue
      const key = styleKey(l.styles[k])
      const e = count.get(key) ?? { style: l.styles[k], n: 0 }
      e.n++
      count.set(key, e)
    }
  let best = { style: lines[0].styles[0], n: -1 }
  for (const e of count.values()) if (e.n > best.n) best = e
  return best.style
}

const allBold = (l: Line) => l.styles.every((s, k) => s.bold || l.text[k] === ' ')

/** Groups lines into paragraphs by spacing, size, indent and where lines end. */
export function buildParagraphs(lines: Line[], page = 0): Paragraph[] {
  const groups: Line[][] = []
  const sorted = [...lines].sort((a, b) => b.baseline - a.baseline || a.x0 - b.x0)
  for (const line of sorted) {
    const g = groups.find((g) => {
      const last = g[g.length - 1]
      const size = Math.max(last.size, line.size)
      const gap = last.baseline - line.baseline
      if (gap < 0.3 * size || gap > 1.9 * size) return false
      if (line.size / last.size > 1.25 || last.size / line.size > 1.25) return false
      const left = Math.min(...g.map((l) => l.x0))
      const right = Math.max(...g.map((l) => l.x1))
      if (line.x1 < left || line.x0 > right) return false
      if (g.length >= 2 && gap > 1.3 * (g[g.length - 2].baseline - last.baseline)) return false
      // A first-line indent starts a new paragraph; so does a line after a short one.
      if (line.x0 - left > 0.8 * size) return false
      if (g.length >= 1 && last.x1 < left + 0.7 * (right - left) && right - left > 10 * size && g.length > 1) return false
      if (allBold(last) && !allBold(line)) return false
      return true
    })
    if (g) g.push(line)
    else groups.push([line])
  }
  return groups
    .map((g, n) => paragraph(g, page, `p${page + 1}-${n + 1}`))
    .sort((a, b) => b.top - a.top || a.left - b.left)
    .map((p, n) => ({ ...p, id: `p${page + 1}.${n + 1}` }))
}

function paragraph(lines: Line[], page: number, id: string): Paragraph {
  const style = mainStyle(lines)
  const gaps = lines.slice(1).map((l, i) => (lines[i].baseline - l.baseline) / style.size)
  let text = ''
  const map: Paragraph['map'] = []
  lines.forEach((l, li) => {
    if (li && !/[-­]$/.test(text)) {
      text += ' '
      map.push({ line: li, index: -1 })
    }
    for (let k = 0; k < l.text.length; k++) {
      const ch = /\s/.test(l.text[k]) ? ' ' : l.text[k]
      if (ch === ' ' && (text.endsWith(' ') || !text)) continue
      text += ch
      map.push({ line: li, index: k })
    }
  })
  while (text.endsWith(' ')) {
    text = text.slice(0, -1)
    map.pop()
  }
  return {
    id,
    page,
    lines,
    text,
    left: Math.min(...lines.map((l) => l.x0)),
    right: Math.max(...lines.map((l) => l.x1)),
    top: Math.max(...lines.map((l) => lineTop(l, style))),
    bottom: Math.min(...lines.map((l) => lineBottom(l, style))),
    style,
    lineHeight: gaps.length ? median(gaps) : 1.2,
    map
  }
}

/** Folds case, curly quotes and dashes, keeping the string's length so offsets still line up. */
function fold(s: string): string {
  return s.replace(/[’‘‛`]/g, "'").replace(/[“”„]/g, '"').replace(/[–—‐‑]/g, '-').replace(/\s/g, ' ').toLowerCase()
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim()

export interface Span {
  para: Paragraph
  start: number
  end: number
}

/** Finds `find` in the paragraphs: exact first, then ignoring case, quotes and dashes. */
export function findSpans(paras: Paragraph[], find: string): Span[] {
  const want = squash(find)
  if (!want) return []
  for (const loose of [false, true]) {
    const needle = loose ? fold(want) : want
    const out: Span[] = []
    for (const para of paras) {
      const hay = loose ? fold(para.text) : para.text
      let at = hay.indexOf(needle)
      while (at >= 0) {
        out.push({ para, start: at, end: at + needle.length })
        at = hay.indexOf(needle, at + Math.max(1, needle.length))
      }
    }
    if (out.length) return out
  }
  return []
}

/** A text box to draw: `rect` also covers what it replaces. */
export interface TextBoxPlan {
  rect: Rect
  text: string
  style: RunStyle
  /** Baseline to baseline, as a multiple of the size. */
  lineHeight: number
  /** First baseline sits this far below the top, as a multiple of the size. */
  ascent: number
  /** Left inset of the text, in points. */
  inset: number
}

export interface EditPlan {
  box: TextBoxPlan
  /** Whether the rest of the paragraph had to be laid out again. */
  reflowed: boolean
  /** Lines added beyond the paragraph's original height (0 when it fits). */
  extraLines: number
}

/** Greedy word wrap. Explicit newlines are kept. */
export function wrapText(text: string, width: number, style: RunStyle, measure: Measurer): string[] {
  const out: string[] = []
  for (const para of text.split(/\r?\n/)) {
    let line = ''
    for (const word of para.split(/(\s+)/)) {
      const next = line + word
      if (line.trim() && measure(next.trimEnd(), style) > width) {
        out.push(line.trimEnd())
        line = word.trimStart()
      } else line = next
    }
    out.push(line.trimEnd())
  }
  return out
}

/** Boundary x of paragraph offset `i` (a character's left edge, or the end of the text before it). */
function xAt(p: Paragraph, i: number): { line: number; x: number } {
  if (i >= p.map.length) {
    const last = p.lines.length - 1
    return { line: last, x: p.lines[last].x1 }
  }
  const m = p.map[i]
  if (m.index >= 0) return { line: m.line, x: p.lines[m.line].xs[m.index] }
  return { line: m.line, x: p.lines[m.line].x0 }
}

function styleAt(p: Paragraph, i: number): RunStyle {
  for (let k = Math.min(i, p.map.length - 1); k >= 0; k--) {
    const m = p.map[k]
    if (m.index >= 0 && p.text[k] !== ' ') return p.lines[m.line].styles[m.index]
  }
  return p.style
}

const PAD_Y = 0.08
const PAD_X = 0.06
const SLACK = 1.04

/**
 * Replaces paragraph text `start`..`end` with `text` (empty deletes it). When the new
 * words fit on the same line, only the rest of that line is redrawn; otherwise the
 * paragraph is laid out again from that line down, with its own width and spacing.
 */
export function planReplace(span: Span, text: string, measure: Measurer, override: Partial<RunStyle> = {}): EditPlan {
  const p = span.para
  const style: RunStyle = { ...styleAt(p, span.start), ...override }
  const lh = p.lineHeight
  const from = xAt(p, span.start)
  const to = xAt(p, Math.max(span.start, span.end - 1))
  const line = p.lines[from.line]
  const top = line.baseline + (style.ascent + PAD_Y) * style.size
  const ascent = style.ascent + PAD_Y

  if (from.line === to.line && !text.includes('\n')) {
    // The rest of the line after the replaced words, as it was.
    let restEnd = span.end
    while (restEnd < p.map.length && p.map[restEnd].line === from.line) restEnd++
    let rest = p.text.slice(span.end, restEnd)
    // Deleting a word also drops one of the spaces around it.
    if (!text && rest.startsWith(' ') && (span.start === 0 || p.text[span.start - 1] === ' ')) rest = rest.slice(1)
    const newText = text + rest
    const startX = from.x
    const width = measure(newText, style)
    const room = p.right - startX
    if (width <= room + 0.3 * style.size) {
      const oldEnd = line.x1
      const bottom = line.baseline - (style.descent + PAD_Y) * style.size
      return {
        box: {
          rect: [startX - PAD_X * style.size * 0.3, bottom, Math.max(oldEnd, startX + width * SLACK) + PAD_X * style.size, top],
          text: newText,
          style,
          lineHeight: lh,
          ascent,
          inset: PAD_X * style.size * 0.3
        },
        reflowed: false,
        extraLines: 0
      }
    }
  }

  // Lay out again from the start of the line where the change begins.
  const lineStart = p.map.findIndex((m) => m.line === from.line && m.index >= 0)
  const newPara = p.text.slice(lineStart, span.start) + text + p.text.slice(span.end)
  const x0 = line.x0
  const width = p.right - x0
  const lines = squash(newPara) || text.trim() ? wrapText(newPara.replace(/ {2,}/g, ' ').trim(), width, style, measure) : []
  const oldCount = p.lines.length - from.line
  const last = p.lines[p.lines.length - 1]
  const oldBottom = last.baseline - (style.descent + PAD_Y) * style.size
  const newBottom = line.baseline - (Math.max(1, lines.length) - 1) * lh * style.size - (style.descent + PAD_Y) * style.size
  return {
    box: {
      rect: [x0 - PAD_X * style.size, Math.min(oldBottom, newBottom), p.right + Math.max(PAD_X * style.size, width * (SLACK - 1)), top],
      text: lines.join('\n'),
      style,
      lineHeight: lh,
      ascent,
      inset: PAD_X * style.size
    },
    reflowed: true,
    extraLines: Math.max(0, lines.length - oldCount)
  }
}

/**
 * New text after (or before) paragraph `near`, at its left edge, one paragraph gap away,
 * in the look of `like` (default `near`). `gap` is the space between paragraphs on the page.
 */
export function planInsert(
  near: Paragraph,
  where: 'after' | 'before',
  text: string,
  gap: number,
  measure: Measurer,
  override: Partial<RunStyle> = {},
  like: Paragraph = near
): TextBoxPlan & { height: number } {
  const style: RunStyle = { ...like.style, ...override }
  // A heading is narrow; new body text under it takes the column's width.
  const left = near.left
  const width = Math.max(near.right, like.right) - left
  const lines = wrapText(text.trim(), width, style, measure)
  const lh = like.lineHeight * style.size
  const ascent = style.ascent + PAD_Y
  const height = (lines.length - 1) * lh + (style.ascent + style.descent + 2 * PAD_Y) * style.size
  const top = where === 'after' ? near.bottom - gap + PAD_Y * style.size : near.top + gap + height - PAD_Y * style.size
  return {
    rect: [left - PAD_X * style.size, top - height, left + width * SLACK, top],
    text: lines.join('\n'),
    style,
    lineHeight: like.lineHeight,
    ascent,
    inset: PAD_X * style.size,
    height
  }
}

/** New text at a point: `top` is where the text's top goes; wraps at `width`. */
export function planAt(x: number, top: number, width: number, text: string, style: RunStyle, lineHeight: number, measure: Measurer): TextBoxPlan {
  const lines = wrapText(text.trim(), width, style, measure)
  const height = (lines.length - 1) * lineHeight * style.size + (style.ascent + style.descent + 2 * PAD_Y) * style.size
  return { rect: [x, top - height, x + width * SLACK, top], text: lines.join('\n'), style, lineHeight, ascent: style.ascent + PAD_Y, inset: 0 }
}

/** Usual space between paragraphs on the page (bottom of one to top of the next). */
export function paragraphGap(paras: Paragraph[]): number {
  const gaps: number[] = []
  for (const a of paras)
    for (const b of paras) {
      if (a === b || b.top >= a.bottom) continue
      if (b.left > a.right || b.right < a.left) continue
      const g = a.bottom - b.top
      if (g < 4 * a.style.size && !paras.some((c) => c !== a && c !== b && c.top < a.bottom && c.top > b.top && c.left < a.right && c.right > a.left)) gaps.push(g)
    }
  return gaps.length ? median(gaps) : (paras[0]?.style.size ?? 12) * 0.8
}

/** Paragraphs a rectangle runs into (other than `except`), for warning about overlaps. */
export function overlapping(paras: Paragraph[], rect: Rect, except: Paragraph[] = []): Paragraph[] {
  return paras.filter((p) => !except.includes(p) && p.left < rect[2] && p.right > rect[0] && p.bottom < rect[3] && p.top > rect[1])
}

// ---------------------------------------------------------------------------
// Fonts

const GENERIC: Record<string, string> = {
  helvetica: 'Arial',
  helveticaneue: 'Arial',
  arialmt: 'Arial',
  times: 'Times New Roman',
  timesroman: 'Times New Roman',
  timesnewromanpsmt: 'Times New Roman',
  timesnewromanps: 'Times New Roman',
  courier: 'Courier New',
  couriernewpsmt: 'Courier New',
  symbol: 'Symbol',
  zapfdingbats: 'Wingdings'
}

/** Family, weight and slant from a PDF font name ("ABCDEF+TimesNewRomanPS-BoldItalicMT"). */
export function parseFontName(name: string): { family: string; bold: boolean; italic: boolean } {
  const bare = name.replace(/^[A-Z]{6}\+/, '')
  const [base, ...rest] = bare.split(/[-,]/)
  const tail = rest.join('-')
  const bold = /bold|black|heavy|semibold|demi/i.test(tail) || /bold/i.test(base)
  const italic = /italic|oblique/i.test(tail) || /italic|oblique/i.test(base)
  const key = base.replace(/(PS)?MT$/, '').replace(/PS$/, '').replace(/[^A-Za-z0-9]/g, '').toLowerCase()
  const clean = base.replace(/(PS)?MT$/, '').replace(/PS$/, '').replace(/(Bold|Italic|Oblique)+$/i, '')
  const family = GENERIC[key] ?? GENERIC[base.toLowerCase()] ?? clean.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').trim()
  return { family, bold, italic }
}

const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** The installed family closest to `family`, or a stand-in of the same kind. */
export function pickFamily(family: string, installed: string[], generic: 'serif' | 'sans-serif' | 'monospace' = 'sans-serif'): string {
  const want = compact(family)
  const exact = installed.find((f) => compact(f) === want)
  if (exact) return exact
  const prefix = installed.filter((f) => want.startsWith(compact(f)) && compact(f).length >= 4).sort((a, b) => b.length - a.length)[0]
  if (prefix) return prefix
  const fallback = generic === 'serif' ? 'Times New Roman' : generic === 'monospace' ? 'Consolas' : 'Arial'
  return installed.length && !installed.includes(fallback) ? (installed.find((f) => /segoe ui$/i.test(f)) ?? fallback) : fallback
}

/** Guess the generic kind from a family name, for when it isn't installed. */
export function genericOf(family: string, cssFallback?: string): 'serif' | 'sans-serif' | 'monospace' {
  if (cssFallback === 'serif' || cssFallback === 'monospace') return cssFallback
  if (/mono|courier|consol|code/i.test(family)) return 'monospace'
  if (/times|serif(?!.*sans)|georgia|garamond|cambria|book|minion|palatino|roman/i.test(family) && !/sans/i.test(family)) return 'serif'
  return 'sans-serif'
}

/** CSS font shorthand for a run style at `size` px. */
export function cssFont(style: RunStyle, size = style.size, stack?: string): string {
  return `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}${size}px ${stack ?? `"${style.family}"`}`
}

/** Paragraph rectangles in reading order, as the AI sees them. */
export function rectOf(p: Paragraph): Rect {
  return [p.left, p.bottom, p.right, p.top]
}

export { sameStyle }
