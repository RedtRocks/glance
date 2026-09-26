/**
 * Finding text on a PDF page for search-and-redact ("Remove sensitive text").
 *
 * Works on PDF.js text items: each has a string, a transform placing its baseline
 * in PDF user space, and an advance width. Characters are located proportionally
 * within their item and rects are padded, so redaction boxes fully cover the glyphs.
 */
import type { Rect } from './markup'

export interface TextItem {
  str: string
  /** [a, b, c, d, e, f]: text matrix in PDF user space (e, f = baseline origin). */
  transform: number[]
  width: number
  height: number
  hasEOL?: boolean
  /** CSS family of the item's font (PDF.js text styles), for measuring glyph widths. */
  fontFamily?: string
}

/**
 * Cumulative advance of each character boundary as a fraction of the item width
 * (length str.length + 1, from 0 to 1). Without one, characters are spread evenly.
 */
export type Measure = (item: TextItem) => number[]

const uniform: Measure = (it) => Array.from({ length: it.str.length + 1 }, (_, k) => k / Math.max(1, it.str.length))

/** Measures with a 2D canvas in the item's font family, normalized to the item's real width. */
export function canvasMeasure(ctx: { font: string; measureText(t: string): { width: number } }): Measure {
  const cache = new Map<string, number[]>()
  return (it) => {
    const key = `${it.fontFamily}\u0000${it.str}`
    let out = cache.get(key)
    if (!out) {
      ctx.font = `100px ${it.fontFamily || 'sans-serif'}`
      const total = ctx.measureText(it.str).width
      out = total > 0 ? Array.from({ length: it.str.length + 1 }, (_, k) => ctx.measureText(it.str.slice(0, k)).width / total) : uniform(it)
      cache.set(key, out)
    }
    return out
  }
}

export interface SensitivePattern {
  id: string
  label: string
  re: RegExp
}

/** Common kinds of personal data, like Preview's "Remove sensitive text" suggestions. */
export const SENSITIVE_PATTERNS: SensitivePattern[] = [
  { id: 'email', label: 'Email addresses', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { id: 'phone', label: 'Phone numbers', re: /(?<![\w-])(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{2,4}(?:[\s.-]\d{2,4}){1,4}(?![\w-])/g },
  { id: 'card', label: 'Card numbers', re: /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g },
  { id: 'id', label: 'ID numbers (SSN, national ID)', re: /(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)|(?<![A-Za-z0-9])[A-Z]{2}\d{6}[A-D](?![A-Za-z0-9])/g },
  { id: 'iban', label: 'Bank accounts (IBAN)', re: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b/g },
  { id: 'date', label: 'Dates', re: /\b(?:\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2})\b/g }
]

/** A literal search term as a global regex. */
export function termRegex(term: string, matchCase: boolean, wholeWord: boolean): RegExp | null {
  const t = term.trim()
  if (!t) return null
  const body = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
  return new RegExp(wholeWord ? `(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])` : body, matchCase ? 'gu' : 'giu')
}

/** Whether `b` starts where `a` ends on the same baseline (no visible gap). */
function touching(a: TextItem, b: TextItem): boolean {
  const [aa, ab, , , ae, af] = a.transform
  const len = Math.hypot(aa, ab) || 1
  const ux = aa / len
  const uy = ab / len
  const endX = ae + ux * a.width
  const endY = af + uy * a.width
  const dx = b.transform[4] - endX
  const dy = b.transform[5] - endY
  const h = a.height || len
  const along = dx * ux + dy * uy
  const across = -dx * uy + dy * ux
  return Math.abs(across) < h * 0.3 && along > -h * 0.3 && along < h * 0.15
}

/** Page text with a map from each character back to its item and offset. */
function joinItems(items: TextItem[]): { text: string; at: [number, number][] } {
  let text = ''
  const at: [number, number][] = []
  items.forEach((it, i) => {
    for (let k = 0; k < it.str.length; k++) {
      text += it.str[k]
      at.push([i, k])
    }
    // Items continuing the same word (e.g. kerning splits) join directly; separate
    // words and lines get a separator so they don't run together.
    const next = items[i + 1]
    const sep = it.hasEOL || !next ? '\n' : /\s$/.test(it.str) || /^\s/.test(next.str) ? '' : touching(it, next) ? '' : ' '
    if (sep) {
      text += sep
      at.push([-1, 0])
    }
  })
  return { text, at }
}

/** Bounding box of characters [from, to) of one item, padded to cover ascenders/descenders. */
function itemRect(it: TextItem, from: number, to: number, measure: Measure): Rect {
  const [a, b, c, d, e, f] = it.transform
  const len = Math.hypot(a, b) || 1
  const ux = a / len
  const uy = b / len
  // Glyph height follows the text matrix; PDF.js reports it as `height` (or |d| when 0).
  const h = it.height || Math.hypot(c, d) || len
  const vx = -uy
  const vy = ux
  const pos = measure(it)
  // Widen by a fraction of a glyph each side: measured fonts may differ from the embedded one.
  const slack = h * 0.12
  const x0 = Math.max(0, it.width * pos[from] - slack)
  const x1 = Math.min(it.width, it.width * pos[to] + slack)
  const pts: [number, number][] = []
  for (const t of [x0, x1]) {
    for (const s of [-0.25 * h, 1.0 * h]) pts.push([e + ux * t + vx * s, f + uy * t + vy * s])
  }
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const pad = h * 0.08
  return [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad]
}

export interface TextMatch {
  text: string
  rects: Rect[]
}

/** All matches of the regexes on one page, each with one rect per text item it spans. */
export function findMatches(items: TextItem[], regexes: RegExp[], measure: Measure = uniform): TextMatch[] {
  const { text, at } = joinItems(items)
  const out: TextMatch[] = []
  const seen = new Set<string>()
  for (const src of regexes) {
    const re = new RegExp(src.source, src.flags.includes('g') ? src.flags : src.flags + 'g')
    for (const m of text.matchAll(re)) {
      const start = m.index!
      const end = start + m[0].replace(/\s+$/, '').length
      if (end <= start) continue
      const key = `${start}:${end}`
      if (seen.has(key)) continue
      seen.add(key)
      // Split the match into runs per item.
      const runs = new Map<number, [number, number]>()
      for (let p = start; p < end; p++) {
        const [item, off] = at[p]
        if (item < 0) continue
        const r = runs.get(item)
        runs.set(item, r ? [Math.min(r[0], off), Math.max(r[1], off + 1)] : [off, off + 1])
      }
      out.push({ text: m[0].trim(), rects: [...runs].map(([i, [from, to]]) => itemRect(items[i], from, to, measure)) })
    }
  }
  return out
}
