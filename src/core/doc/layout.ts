/**
 * Where everything on a document's pages goes. A fixed page is its design: art, text boxes
 * and tables. A flowing section's blocks are laid out line by line in its look's styles
 * and poured into the frames of as many A4 pages as they need: the first page is the
 * section's design, the ones after it the design's `next` (or the same design again).
 * Long text never shrinks to fit; it moves on to a new page in the same look.
 *
 * Every view and export draws these same items, so a PDF looks like the page in Glance.
 * Text widths come from `measure`: the real fonts in the browser, an estimate in tests.
 */
import { fitDesignText, shownText, type DesignText, type MeasureText } from '../deck/design'
import { type Block, type ChartKind, type Doc, type Run, type Section } from './model'
import { findDocDesign, PAGE_H, PAGE_W, type BoxStyle, type ColSpec, type DocBoard, type DocDesign, type TableRegion, type TableStyle, type TextStyle } from './look'
import { boxValues, computeRows } from './calc'

export interface FontSpec {
  font: string
  size: number
  weight: number
  italic: boolean
  /** Extra room after each character, in page units. */
  letterSpacing: number
}

/** The width of `text` set in `f`, in page units. */
export type Measure = (f: FontSpec, text: string) => number

/** Average glyph widths as a share of the size, for estimating without fonts (tests, the MCP server). */
const CHAR_W: Record<string, number> = { Urbanist: 0.5, Fraunces: 0.52, 'Space Grotesk': 0.55, 'Bricolage Grotesque': 0.52, Caveat: 0.42, 'DM Serif Display': 0.5 }

export const estimate: Measure = (f, text) => {
  const n = [...text].length
  return n * f.size * (CHAR_W[f.font] ?? 0.52) * (f.weight >= 700 ? 1.05 : 1) + n * f.letterSpacing
}

export interface Seg {
  text: string
  /** From the line's left edge. */
  x: number
  w: number
  font: FontSpec
  colour: string
  href?: string
  underline?: boolean
}

export type Item =
  /** One line of text: its box (y is the top of the CSS line box, h its height). */
  | { kind: 'text'; x: number; y: number; w: number; h: number; segs: Seg[]; transform?: TextStyle['transform'] }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; fill?: string; radius?: number; stroke?: { w: number; colour: string; dashed?: boolean } }
  /** An SVG path in page units. */
  | { kind: 'path'; d: string; fill?: string; stroke?: { w: number; colour: string } }
  | { kind: 'image'; x: number; y: number; w: number; h: number; src: string; alt: string }
  /** One of the look's drawings, scaled to the box. */
  | { kind: 'art'; x: number; y: number; w: number; h: number; art: string }
  /** A design's text box, drawn as the design draws it (see html.ts and the exports). */
  | { kind: 'box'; box: DesignText; text: string; size: number; placeholder: boolean }

/** Where something editable is on a page, for clicks. */
export interface Hit {
  x: number
  y: number
  w: number
  h: number
  /** A block (its first piece on this page), a text box, a table cell or the empty frame. */
  target:
    | { kind: 'block'; id: string; item?: number; row?: number; col?: number; first: boolean }
    | { kind: 'box'; name: string }
    | { kind: 'cell'; table: string; row: number; col: number }
    | { kind: 'empty' }
}

export interface PageLayout {
  section: string
  /** The design drawn under the page: its art, background and boxes. */
  design: DocDesign | null
  /** 1 for the document's first page. */
  number: number
  /** The section's first page, or a following one. */
  first: boolean
  bg: string
  items: Item[]
  hits: Hit[]
  /** Text that couldn't fit: a fixed table with too many rows, a block taller than a page. */
  overflow: string[]
}

export interface LayoutOptions {
  measure?: Measure
  /** A picture's width over its height, when known. */
  aspect?: (src: string) => number | undefined
  /** Translates a style's sample hints and the like; not used for content. */
  pageNumbers?: boolean
}

// ---------------------------------------------------------------------------
// Styles: a look's own, or ones made from its body and headings for blocks it has none for.

const DEFAULT_BODY: TextStyle = { font: 'Urbanist', size: 11, weight: 400, italic: false, colour: '#222222', lineHeight: 1.5, letterSpacing: 0, align: 'left', before: 8, after: 0 }

export function styleOf(board: DocBoard | undefined, key: string): TextStyle {
  const s = board?.styles ?? {}
  const body = s.body ?? DEFAULT_BODY
  if (s[key]) return s[key]
  const accent = s.h1?.colour ?? body.colour
  switch (key) {
    case 'h1':
      return { ...body, size: Math.round(body.size * 2), weight: 700, lineHeight: 1.15, before: 20, after: 6 }
    case 'h2':
      return { ...(s.h1 ?? styleOf(board, 'h1')), size: Math.round((s.h1?.size ?? body.size * 2) * 0.75 * 10) / 10, before: 16, after: 4, lineHeight: 1.2, bar: undefined, lead: s.h1?.lead }
    case 'h3':
      return { ...(s.h2 ?? styleOf(board, 'h2')), size: Math.round(Math.max(body.size * 1.2, (s.h2?.size ?? body.size * 1.5) * 0.8) * 10) / 10, before: 12, after: 2, lineHeight: 1.25, trail: undefined, rule: undefined, bar: undefined, bg: undefined }
    case 'quote':
      return { ...body, font: s.h1?.font ?? body.font, italic: true, weight: 400, size: Math.round(body.size * 1.35 * 10) / 10, lineHeight: 1.35, colour: accent, before: 12, after: 8, bar: { w: 4, colour: accent, gap: 12 } }
    case 'cite':
      return { ...body, size: Math.max(8, body.size - 1), before: 6, after: 0, colour: s.small?.colour ?? body.colour }
    case 'caption':
      return s.small ?? { ...body, size: Math.max(8, body.size - 1), before: 4, after: 0 }
    case 'list':
      return { ...body, padLeft: 16, before: Math.max(body.before, 6) }
    default:
      return body
  }
}

const DEFAULT_TABLE = (board: DocBoard | undefined): TableStyle => {
  const body = styleOf(board, 'body')
  const h1 = styleOf(board, 'h1')
  return {
    text: { ...body, lineHeight: 1.35, before: 0, after: 0 },
    head: { bg: h1.colour, colour: '#ffffff', size: Math.max(8, body.size - 1), weight: 700, letterSpacing: 0.4, h: 24, radius: 0, transform: 'uppercase' },
    rowH: 22,
    padX: 8,
    line: { w: 1, colour: '#dddddd' },
    cols: [],
    before: 12,
    after: 8
  }
}

export function tableStyleOf(board: DocBoard | undefined, key?: string): TableStyle {
  return (key && board?.tables[key]) || board?.tables.table || DEFAULT_TABLE(board)
}

export function boxStyleOf(board: DocBoard | undefined, key: string): BoxStyle {
  if (board?.boxes[key]) return board.boxes[key]
  const body = styleOf(board, 'body')
  if (key.startsWith('columns')) return { radius: 0, pad: [0, 0, 0, 0], before: body.before, after: body.after, gap: 18 }
  if (key === 'divider') return { bg: '#d6d6d6', radius: 0, pad: [0, 0, 0, 0], before: 12, after: 12, gap: 1 }
  return { bg: mixColour(styleOf(board, 'h1').colour, '#ffffff', 0.88), radius: 6, pad: [12, 14, 12, 14], before: 12, after: 8, gap: 6 }
}

/** a and b mixed, `t` of the way to b. */
export function mixColour(a: string, b: string, t: number): string {
  const p = (h: string) => {
    const n = parseInt(h.replace('#', '').padEnd(6, '0').slice(0, 6), 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const [x, y] = [p(a), p(b)]
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')
}

// ---------------------------------------------------------------------------
// Lines of text.

interface Line {
  segs: Seg[]
  w: number
  /** Where the line starts, past an indent. */
  x: number
}

const fontOf = (st: TextStyle, run: Run | null): FontSpec => ({
  font: st.font,
  size: st.size,
  weight: run?.b ? Math.max(700, st.weight >= 700 ? Math.min(900, st.weight + 100) : 700) : st.weight,
  italic: run?.i ? true : st.italic,
  letterSpacing: st.letterSpacing
})

/** Words and spaces of some runs, each with its font, for filling lines. */
function tokens(runs: Run[], st: TextStyle, palette: Record<string, string>, link: string) {
  const out: { text: string; font: FontSpec; colour: string; href?: string; u: boolean; space: boolean; br: boolean }[] = []
  for (const r of runs) {
    const font = fontOf(st, r)
    const colour = r.href ? link : (r.c && palette[r.c]) || st.colour
    const text = st.transform === 'uppercase' ? r.text.toUpperCase() : st.transform === 'lowercase' ? r.text.toLowerCase() : r.text
    for (const part of text.split(/(\n|[ \t]+)/)) {
      if (!part) continue
      out.push({ text: part === '\n' ? '' : part.replace(/\t/g, ' '), font, colour, href: r.href, u: !!r.u || !!r.href, space: /^[ \t]+$/.test(part), br: part === '\n' })
    }
  }
  return out
}

/**
 * Breaks runs into lines no wider than `width`, at spaces, or inside a word too long for a
 * line. `first` is how far in the first line starts (an indent), `rest` the others.
 */
export function breakLines(runs: Run[], st: TextStyle, width: number, measure: Measure, palette: Record<string, string> = {}, first = 0, rest = 0, link = st.colour): Line[] {
  const lines: Line[] = []
  let cur: Line = { segs: [], w: 0, x: first }
  const room = () => width - cur.x
  const push = () => {
    // Spaces at the end of a line take no room.
    while (cur.segs.length && /^\s+$/.test(cur.segs.at(-1)!.text)) cur.w -= cur.segs.pop()!.w
    lines.push(cur)
    cur = { segs: [], w: 0, x: rest }
  }
  const add = (text: string, font: FontSpec, colour: string, href?: string, u = false) => {
    const w = measure(font, text)
    const last = cur.segs.at(-1)
    if (last && last.font === font && last.colour === colour && last.href === href && !!last.underline === u) {
      last.text += text
      last.w = measure(font, last.text)
      cur.w = last.x + last.w
    } else {
      cur.segs.push({ text, x: cur.w, w, font, colour, ...(href ? { href } : {}), ...(u ? { underline: true } : {}) })
      cur.w += w
    }
  }
  for (const t of tokens(runs, st, palette, link)) {
    if (t.br) {
      push()
      continue
    }
    if (t.space) {
      if (cur.segs.length) add(' ', t.font, t.colour, t.href, t.u)
      continue
    }
    let word = t.text
    const w = measure(t.font, word)
    if (cur.w + w <= room() + 0.01 || (!cur.segs.length && w <= room() + 0.01)) {
      add(word, t.font, t.colour, t.href, t.u)
      continue
    }
    if (cur.segs.some((s) => /\S/.test(s.text))) push()
    else cur.segs = []
    // A word wider than the line breaks between characters.
    while (measure(t.font, word) > room() + 0.01 && word.length > 1) {
      const chars = [...word]
      let n = 1
      while (n < chars.length && measure(t.font, chars.slice(0, n + 1).join('')) <= room()) n++
      add(chars.slice(0, n).join(''), t.font, t.colour, t.href, t.u)
      push()
      word = chars.slice(n).join('')
    }
    add(word, t.font, t.colour, t.href, t.u)
  }
  push()
  return lines
}

/** Text items for some lines, aligned in a column `w` wide at x. */
function placeLines(lines: Line[], st: TextStyle, x: number, y: number, w: number, out: Item[]): number {
  const lh = st.size * st.lineHeight
  for (const line of lines) {
    const off = st.align === 'center' ? (w - line.w) / 2 : st.align === 'right' ? w - line.w : line.x
    out.push({ kind: 'text', x: x + off, y, w: line.w, h: lh, segs: line.segs })
    y += lh
  }
  return y
}

// ---------------------------------------------------------------------------
// Blocks as units: pieces of a fixed height that pages are filled with.

interface Out {
  items: Item[]
  hits: Hit[]
}

interface Unit {
  h: number
  /** Draws the unit with its top left at x, y. */
  place: (x: number, y: number, out: Out) => void
  /** Stays on the same page as the next unit (a heading and what follows it). */
  keep?: boolean
  /** Drawn again first when a page starts with this unit (a table's header). */
  repeat?: Unit
  /** The block the unit belongs to, and whether it is the block's first piece. */
  block: string
  first: boolean
}

interface Laid {
  before: number
  after: number
  units: Unit[]
  pageBreak?: boolean
}

interface Ctx {
  board: DocBoard | undefined
  measure: Measure
  palette: Record<string, string>
  aspect: (src: string) => number | undefined
  /** The page's height for blocks, so a block taller than a page can be split instead. */
  frameH: number
}

const hitOf = (u: Unit, x: number, y: number, w: number, extra: Partial<Extract<Hit['target'], { kind: 'block' }>> = {}): Hit => ({ x, y, w, h: u.h, target: { kind: 'block', id: u.block, first: u.first, ...extra } })

/** A block of text (heading, paragraph): one unit per line, or one for all with a tint, a bar, an icon or a line under. */
function textUnits(id: string, runs: Run[], st: TextStyle, width: number, ctx: Ctx, opts: { icon?: string; heading?: boolean; item?: number } = {}): Unit[] {
  const icon = opts.icon ? ctx.board?.arts[opts.icon] : undefined
  const lead = st.lead && ctx.board?.arts[st.lead.art] ? st.lead : icon ? { art: opts.icon!, w: icon.w, h: icon.h, gap: 10 } : undefined
  const barW = st.bar ? st.bar.w + st.bar.gap : 0
  const pad = st.bg?.pad ?? [0, 0, 0, 0]
  const inset = barW + (lead ? lead.w + lead.gap : 0) + pad[3]
  const avail = Math.max(10, width - inset - pad[1])
  const pl = st.padLeft ?? 0
  const lines = breakLines(runs, st, avail, ctx.measure, ctx.palette, pl + (st.indent ?? 0), pl, ctx.palette.link ?? linkColour(ctx.board))
  const lh = st.size * st.lineHeight
  const ruleH = st.rule ? st.rule.gap + st.rule.w : 0
  const whole = !!(st.bg || st.bar || lead || st.rule || st.trail || opts.heading || st.mark)
  const markH = st.mark ? st.mark.h : 0
  if (whole) {
    const textH = lines.length * lh
    const h = Math.max(textH, lead ? lead.h : 0) + pad[0] + pad[2] + ruleH + markH
    return [{
      h,
      block: id,
      first: true,
      keep: !!opts.heading,
      place: (x, y, out) => {
        const u = { h } as Unit
        if (st.bg) out.items.push({ kind: 'rect', x, y, w: width, h: h - ruleH, fill: st.bg.colour, radius: st.bg.radius })
        if (st.bar) out.items.push({ kind: 'rect', x, y, w: st.bar.w, h: h - ruleH, fill: st.bar.colour })
        if (st.mark) {
          const f: FontSpec = { font: st.mark.font, size: st.mark.size, weight: 400, italic: false, letterSpacing: 0 }
          const w = ctx.measure(f, st.mark.text)
          // The mark's glyph sits high in its line; its box is cropped to `h` on the board.
          out.items.push({ kind: 'text', x: x + barW + pad[3], y: y - st.mark.size * 0.1, w, h: st.mark.size * 0.6, segs: [{ text: st.mark.text, x: 0, w, font: f, colour: st.mark.colour }] })
        }
        const top = y + pad[0] + markH + Math.max(0, ((lead?.h ?? 0) - textH) / 2)
        if (lead) out.items.push({ kind: 'art', x: x + barW + pad[3], y: y + pad[0] + markH + Math.max(0, (Math.min(textH, lh) - lead.h) / 2), w: lead.w, h: lead.h, art: lead.art })
        const end = placeLines(lines, st, x + inset, top, avail, out.items)
        if (st.trail && lines.length) {
          const last = lines.at(-1)!
          const from = x + inset + last.x + last.w + st.trail.gap
          if (x + width - from > 8) out.items.push({ kind: 'rect', x: from, y: end - lh / 2 - st.trail.h / 2, w: x + width - from, h: st.trail.h, fill: st.trail.colour })
        }
        if (st.rule) out.items.push({ kind: 'rect', x, y: end + pad[2] + st.rule.gap, w: width, h: st.rule.w, fill: st.rule.colour })
        out.hits.push(hitOf({ ...u, block: id, first: true } as Unit, x, y, width, opts.item !== undefined ? { item: opts.item } : {}))
      }
    }]
  }
  return lines.map((line, i) => ({
    h: lh,
    block: id,
    first: i === 0,
    // Orphans and widows: the first two lines and the last two stay together.
    keep: lines.length >= 3 && (i === 0 || i === lines.length - 2),
    place: (x: number, y: number, out: Out) => {
      placeLines([line], st, x + inset, y, avail, out.items)
      out.hits.push({ x, y, w: width, h: lh, target: { kind: 'block', id, first: i === 0, ...(opts.item !== undefined ? { item: opts.item } : {}) } })
    }
  }))
}

const linkColour = (board: DocBoard | undefined) => board?.styles.h1?.colour ?? '#1a5fb4'

function layoutBlock(block: Block, width: number, ctx: Ctx): Laid {
  const st = (key: string) => styleOf(ctx.board, key)
  switch (block.type) {
    case 'heading': {
      const s = st(block.style ?? `h${block.level}`)
      return { before: s.before, after: s.after, units: textUnits(block.id, block.runs, s, width, ctx, { heading: true }) }
    }
    case 'paragraph': {
      const s = st(block.style ?? 'body')
      return { before: s.before, after: s.after, units: textUnits(block.id, block.runs, s, width, ctx, { icon: block.icon }) }
    }
    case 'list': {
      const s = st(block.style ?? 'list')
      const indent = s.padLeft || 16
      const item: TextStyle = { ...s, padLeft: 0, indent: 0, bar: undefined }
      const units: Unit[] = []
      block.items.forEach((runs, n) => {
        const marker = block.ordered ? `${n + 1}.` : '•'
        const lines = textUnits(block.id, runs, item, width - indent, ctx, { item: n })
        lines.forEach((u, i) => {
          units.push({
            ...u,
            first: n === 0 && i === 0,
            place: (x, y, out) => {
              if (i === 0) {
                const f = fontOf(s, null)
                const w = ctx.measure(f, marker)
                out.items.push({ kind: 'text', x: x + indent - w - (block.ordered ? 5 : 7), y, w, h: s.size * s.lineHeight, segs: [{ text: marker, x: 0, w, font: f, colour: ctx.palette.c1 && !block.ordered ? s.colour : s.colour }] })
              }
              u.place(x + indent, y, out)
            }
          })
        })
        // A little room between entries.
        if (n < block.items.length - 1 && units.length) {
          const last = units.at(-1)!
          units[units.length - 1] = { ...last, h: last.h + Math.max(2, s.size * 0.25) }
        }
      })
      return { before: s.before, after: s.after, units }
    }
    case 'quote': {
      const s = st(block.style ?? 'quote')
      const units = textUnits(block.id, block.runs, s, width, ctx)
      if (block.cite) {
        const c = st('cite')
        const bar = s.bar ? s.bar.w + s.bar.gap : 0
        const cite = textUnits(block.id, [{ text: block.cite }], { ...c, bar: undefined }, width - bar, ctx)
        const h = cite.reduce((n, u) => n + u.h, 0) + c.before
        units.push({
          h,
          block: block.id,
          first: false,
          place: (x, y, out) => {
            if (s.bar) out.items.push({ kind: 'rect', x, y, w: s.bar.w, h: h, fill: s.bar.colour })
            let at = y + c.before
            for (const u of cite) {
              u.place(x + bar, at, out)
              at += u.h
            }
          }
        })
        // The quote and who said it stay together.
        units[units.length - 2] = { ...units[units.length - 2], keep: true }
      }
      return { before: s.before, after: s.after, units }
    }
    case 'callout': {
      const box = boxStyleOf(ctx.board, block.style ?? 'callout')
      const inner = width - box.pad[1] - box.pad[3] - (box.bar?.w ?? 0)
      const laid = flowLayout(block.blocks, inner, ctx, box.gap)
      const h = laid.h + box.pad[0] + box.pad[2]
      if (h > ctx.frameH) return { before: box.before, after: box.after, units: laid.units }
      return {
        before: box.before,
        after: box.after,
        units: [{
          h,
          block: block.id,
          first: true,
          place: (x, y, out) => {
            if (box.bg || box.border) out.items.push({ kind: 'rect', x, y, w: width, h, fill: box.bg, radius: box.radius, ...(box.border ? { stroke: box.border } : {}) })
            if (box.bar) out.items.push({ kind: 'rect', x, y, w: box.bar.w, h, fill: box.bar.colour, radius: 0 })
            out.hits.push({ x, y, w: width, h, target: { kind: 'block', id: block.id, first: true } })
            laid.place(x + box.pad[3] + (box.bar?.w ?? 0), y + box.pad[0], out)
          }
        }]
      }
    }
    case 'columns': {
      const box = boxStyleOf(ctx.board, block.style ?? 'columns')
      const n = Math.max(1, block.columns.length)
      const gap = box.gap
      const shares = block.widths?.length === n ? block.widths : Array(n).fill(1 / n)
      const total = shares.reduce((a, b) => a + b, 0) || 1
      const free = width - gap * (n - 1)
      const ws = shares.map((s) => (free * s) / total)
      const cols = block.columns.map((col, i) => flowLayout(col, ws[i], ctx, 0))
      const h = Math.max(0, ...cols.map((c) => c.h))
      // Columns taller than a page are read one after another instead.
      if (h > ctx.frameH) return { before: box.before, after: box.after, units: cols.flatMap((c) => c.units) }
      return {
        before: box.before,
        after: box.after,
        units: [{
          h,
          block: block.id,
          first: true,
          place: (x, y, out) => {
            let at = x
            cols.forEach((c, i) => {
              c.place(at, y, out)
              at += ws[i] + gap
            })
          }
        }]
      }
    }
    case 'table':
      return tableLaid(block.id, block.rows, block.header, !!block.footer, tableStyleOf(ctx.board, block.style), width, ctx)
    case 'picture': {
      const w = width * Math.min(1, Math.max(0.1, block.width ?? 1))
      const h = w / (ctx.aspect(block.src) ?? 4 / 3)
      const units: Unit[] = [{
        h,
        block: block.id,
        first: true,
        keep: !!block.caption,
        place: (x, y, out) => {
          out.items.push({ kind: 'image', x, y, w, h, src: block.src, alt: block.alt })
          out.hits.push({ x, y, w, h, target: { kind: 'block', id: block.id, first: true } })
        }
      }]
      if (block.caption) units.push(...captionUnits(block.id, block.caption, width, ctx))
      return { before: st('body').before + 4, after: 6, units }
    }
    case 'art': {
      const art = ctx.board?.arts[block.art]
      const k = art ? Math.min(1, width / art.w) : 1
      const w = art ? art.w * k : width
      const h = art ? art.h * k : 40
      const units: Unit[] = [{
        h,
        block: block.id,
        first: true,
        keep: !!block.caption,
        place: (x, y, out) => {
          if (art) out.items.push({ kind: 'art', x, y, w, h, art: block.art })
          out.hits.push({ x, y, w, h, target: { kind: 'block', id: block.id, first: true } })
        }
      }]
      if (block.caption) units.push(...captionUnits(block.id, block.caption, width, ctx))
      return { before: 10, after: 4, units }
    }
    case 'chart':
      return chartLaid(block.id, block.chart, block.rows, block.title, block.caption, width, ctx)
    case 'divider': {
      const box = boxStyleOf(ctx.board, block.style ?? 'divider')
      const h = Math.max(1, box.gap)
      return {
        before: box.before,
        after: box.after,
        units: [{ h, block: block.id, first: true, place: (x, y, out) => {
          out.items.push({ kind: 'rect', x, y, w: width, h, fill: box.bg ?? '#cccccc' })
          out.hits.push({ x, y: y - 4, w: width, h: h + 8, target: { kind: 'block', id: block.id, first: true } })
        } }]
      }
    }
    case 'pageBreak':
      return { before: 0, after: 0, units: [], pageBreak: true }
  }
}

function captionUnits(id: string, text: string, width: number, ctx: Ctx): Unit[] {
  const s = styleOf(ctx.board, 'caption')
  const units = textUnits(id, [{ text }], { ...s, before: 0 }, width, ctx)
  return units.map((u, i) => (i === 0 ? { ...u, first: false, h: u.h + Math.min(6, s.before), place: (x: number, y: number, out: Out) => u.place(x, y + Math.min(6, s.before), out) } : { ...u, first: false }))
}

/** Blocks laid out top to bottom in a column, for callouts and columns. */
function flowLayout(blocks: Block[], width: number, ctx: Ctx, gap: number): { h: number; units: Unit[]; place: (x: number, y: number, out: Out) => void } {
  const parts: { laid: Laid; y: number }[] = []
  let y = 0
  let prevAfter = 0
  blocks.forEach((b, i) => {
    const laid = layoutBlock(b, width, ctx)
    if (laid.pageBreak) return
    if (i > 0) y += Math.max(prevAfter, laid.before, gap)
    parts.push({ laid, y })
    y += laid.units.reduce((n, u) => n + u.h, 0)
    prevAfter = laid.after
  })
  return {
    h: y,
    units: parts.flatMap((p) => p.laid.units),
    place: (x, y0, out) => {
      for (const p of parts) {
        let at = y0 + p.y
        for (const u of p.laid.units) {
          u.place(x, at, out)
          at += u.h
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Tables, for blocks and for fixed pages' table regions.

const numeric = (s: string) => /^\s*[-+(]?[£$€¥]?\s?[-+]?[\d,.]+\s?(%|[a-zA-Z]{0,3})\)?\s*$/.test(s) && /\d/.test(s)

/** Columns for a table whose look doesn't say: the first one wider, numbers on the right. */
export function guessCols(rows: string[][], base: ColSpec[] = []): ColSpec[] {
  const n = Math.max(1, ...rows.map((r) => r.length))
  if (base.length === n) return base
  const body = rows.slice(1)
  const len = Array.from({ length: n }, (_, c) => Math.min(40, Math.max(4, ...rows.map((r) => (r[c] ?? '').length))))
  const total = len.reduce((a, b) => a + b, 0)
  return len.map((l, c) => ({
    w: l / total,
    align: c > 0 && body.length > 0 && body.every((r) => !r[c] || numeric(r[c])) ? 'right' : 'left',
    ...(c === 0 && base[0]?.bold ? { bold: true } : {})
  }))
}

interface CellBox {
  x: number
  w: number
  col: ColSpec
}

/** One row's lines in each cell, and the row's height. */
function rowLines(row: string[], cells: CellBox[], text: TextStyle, padX: number, ctx: Ctx, bold: boolean, colour?: string, size?: number) {
  const parts = cells.map((c, i) => {
    const value = row[i] ?? ''
    const [main, ...subs] = value.split('\n')
    const st: TextStyle = { ...text, size: size ?? c.col.size ?? text.size, weight: bold || c.col.bold ? Math.max(700, text.weight) : text.weight, colour: colour ?? c.col.colour ?? text.colour, align: c.col.align, before: 0, after: 0, padLeft: 0, indent: 0, bar: undefined, rule: undefined, bg: undefined }
    const inner = Math.max(4, c.w - 2 * padX)
    const pill = c.col.pills?.[value.trim()]
    const bar = c.col.bar && numeric(main) ? c.col.bar : undefined
    const lines = breakLines([{ text: main }], st, pill ? inner * 2 : bar ? inner * 0.45 : inner, ctx.measure, ctx.palette)
    const sub = subs.length && c.col.sub ? { ...st, size: c.col.sub.size, colour: c.col.sub.colour, weight: c.col.sub.weight, italic: c.col.sub.italic } : null
    const subLines = subs.length ? breakLines([{ text: subs.join(' ') }], sub ?? st, inner, ctx.measure, ctx.palette) : []
    const h = lines.length * st.size * st.lineHeight + subLines.length * (sub ?? st).size * (sub ?? st).lineHeight
    return { st, sub: sub ?? st, lines, subLines, h, pill, bar, value: main }
  })
  return { parts, h: Math.max(0, ...parts.map((p) => p.h)) }
}

function drawRow(r: ReturnType<typeof rowLines>, cells: CellBox[], x: number, y: number, h: number, padX: number, out: Out, bars: number[][]) {
  r.parts.forEach((p, i) => {
    const c = cells[i]
    const inner = c.w - 2 * padX
    let top = y + (h - p.h) / 2
    if (p.pill) {
      const line = p.lines[0]
      const ph = p.st.size * 1.5
      const pw = Math.min(inner, Math.max(line.w + p.st.size * 1.4, inner * (c.col.align === 'right' ? 0.85 : 0)))
      const px = x + c.x + padX + (c.col.align === 'right' ? inner - pw : c.col.align === 'center' ? (inner - pw) / 2 : 0)
      const py = y + (h - ph) / 2
      out.items.push({ kind: 'rect', x: px, y: py, w: pw, h: ph, fill: p.pill.bg, radius: ph / 2 })
      out.items.push({ kind: 'text', x: px + (pw - line.w) / 2, y: py + (ph - p.st.size * p.st.lineHeight) / 2, w: line.w, h: p.st.size * p.st.lineHeight, segs: line.segs.map((s) => ({ ...s, colour: p.pill!.colour })) })
      return
    }
    let lx = x + c.x + padX
    if (p.bar) {
      const max = Math.max(...(bars[i] ?? []).filter((v) => Number.isFinite(v)), 1)
      const v = parseFloat(p.value.replace(/[^\d.-]/g, ''))
      const bw = Number.isFinite(v) ? Math.max(2, (v / max) * inner * 0.5) : 0
      out.items.push({ kind: 'rect', x: lx, y: y + h / 2 - 3, w: bw, h: 6, fill: p.bar, radius: 3 })
      lx += bw + 4
    }
    top = placeLines(p.lines, p.st, lx, top, inner - (lx - (x + c.x + padX)), out.items)
    placeLines(p.subLines, p.sub, lx, top, inner, out.items)
  })
}

function tableUnits(id: string | null, region: string | null, rows: string[][], header: boolean, footer: boolean, style: TableStyle, width: number, ctx: Ctx, fixedCols: boolean, rowH?: number): Unit[] {
  const cols = fixedCols ? style.cols : guessCols(rows, style.cols)
  const total = fixedCols ? 1 : cols.reduce((a, c) => a + c.w, 0) || 1
  let at = 0
  const cells: CellBox[] = cols.map((col) => {
    const box = fixedCols ? { x: col.x ?? at, w: col.w, col } : { x: at, w: (col.w / total) * width, col }
    at = box.x + box.w
    return box
  })
  const padX = style.padX
  const text = style.text
  const minRow = rowH ?? style.rowH
  const body = header ? rows.slice(1) : rows
  const bars = cols.map((_, c) => body.map((r) => parseFloat((r[c] ?? '').replace(/[^\d.-]/g, ''))))
  const units: Unit[] = []
  const target = (row: number, col: number): Hit['target'] => (region !== null ? { kind: 'cell', table: region, row, col } : { kind: 'block', id: id!, first: row === 0 && col === 0, row, col })
  const cellHits = (y: number, h: number, row: number, out: Out) => cells.forEach((c, col) => out.hits.push({ x: c.x, y, w: c.w, h, target: target(row, col) }))
  let headUnit: Unit | undefined
  if (header && rows[0]) {
    const hd = style.head
    const hs = hd ? { ...text, size: hd.size, weight: hd.weight, colour: hd.colour, letterSpacing: hd.letterSpacing, transform: hd.transform } : { ...text, weight: 700 }
    const r = rowLines(rows[0], cells, hs, padX, ctx, false, hs.colour, hs.size)
    r.parts.forEach((p) => (p.st.transform = hs.transform))
    const h = Math.max(hd?.h ?? minRow, r.h + 6)
    headUnit = {
      h,
      block: id ?? '',
      first: true,
      keep: true,
      place: (x, y, out) => {
        if (hd?.bg) out.items.push({ kind: 'rect', x, y, w: width, h, fill: hd.bg, radius: hd.radius })
        if (hd?.line) out.items.push({ kind: 'rect', x, y: y + h - hd.line.w, w: width, h: hd.line.w, fill: hd.line.colour })
        const start = out.items.length
        drawRow(r, cells.map((c) => ({ ...c, x: c.x })), x, y, h, padX, out, [])
        for (const it of out.items.slice(start)) if (it.kind === 'text') it.transform = hs.transform
        cellHits(y, h, 0, { items: [], hits: out.hits })
        out.hits.slice(-cells.length).forEach((hit) => (hit.x += x))
      }
    }
    units.push(headUnit)
  }
  body.forEach((row, n) => {
    const isFoot = footer && n === body.length - 1
    const r = rowLines(row, cells, text, padX, ctx, isFoot && (style.foot?.weight ?? 700) >= 600, isFoot ? style.foot?.colour : undefined)
    const h = Math.max(minRow, r.h + Math.max(6, minRow - text.size * text.lineHeight))
    const index = n + (header ? 1 : 0)
    units.push({
      h,
      block: id ?? '',
      first: !header && n === 0,
      repeat: headUnit,
      place: (x, y, out) => {
        const stripe = style.stripe && !isFoot && n % 2 === 1 ? style.stripe : undefined
        if (stripe) out.items.push({ kind: 'rect', x, y, w: width, h, fill: stripe })
        if (isFoot && style.foot?.line?.w) out.items.push({ kind: 'rect', x, y, w: width, h: style.foot.line.w, fill: style.foot.line.colour })
        else if (style.line && !isFoot) out.items.push({ kind: 'rect', x, y: y + h - style.line.w, w: width, h: style.line.w, fill: style.line.colour })
        if (style.colLine) for (const c of cells.slice(1)) out.items.push({ kind: 'rect', x: x + c.x, y, w: style.colLine.w, h, fill: style.colLine.colour })
        drawRow(r, cells, x, y, h, padX, out, bars)
        const before = out.hits.length
        cellHits(y, h, index, out)
        for (const hit of out.hits.slice(before)) hit.x += x
      }
    })
  })
  // Bars compare within their own column.
  for (const u of units) {
    const place = u.place
    u.place = (x, y, out) => place(x, y, out)
  }
  void bars
  return units
}

function tableLaid(id: string, rows: string[][], header: boolean, footer: boolean, style: TableStyle, width: number, ctx: Ctx): Laid {
  return { before: style.before || 10, after: style.after || 8, units: tableUnits(id, null, rows, header, footer, style, width, ctx, false) }
}

// ---------------------------------------------------------------------------
// Charts, drawn from their rows with rectangles, paths and text.

export function chartData(rows: string[][]): { series: string[]; labels: string[]; values: number[][] } {
  const [head = [], ...body] = rows
  const series = head.slice(1).map((s) => s || '')
  const labels = body.map((r) => r[0] ?? '')
  const values = series.map((_, s) => body.map((r) => {
    const v = parseFloat(String(r[s + 1] ?? '').replace(/[^\d.-]/g, ''))
    return Number.isFinite(v) ? v : 0
  }))
  return { series: series.length ? series : [''], labels, values: values.length ? values : [body.map(() => 0)] }
}

/** Round steps for an axis up to `max`. */
function ticks(max: number): number[] {
  if (max <= 0) return [0, 1]
  const raw = max / 4
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw
  const out: number[] = []
  for (let v = 0; v <= max + step * 0.001; v += step) out.push(Math.round(v * 1e6) / 1e6)
  if (out.at(-1)! < max) out.push(out.at(-1)! + step)
  return out
}

const fmt = (v: number) => (Math.abs(v) >= 1000 ? v.toLocaleString('en-GB') : String(Math.round(v * 100) / 100))

function chartLaid(id: string, kind: ChartKind, rows: string[][], title: string | undefined, caption: string | undefined, width: number, ctx: Ctx): Laid {
  const look = ctx.board?.chart
  const colours = look?.colours.length ? look.colours : ['#3b6ea5', '#e07a3f', '#4c9a5c', '#b5487a', '#c9a227']
  const text: TextStyle = look?.text ?? { ...styleOf(ctx.board, 'body'), size: 9, lineHeight: 1.2 }
  const grid = look?.grid ?? '#dddddd'
  const head = styleOf(ctx.board, 'h3')
  const titleSt: TextStyle = { ...head, size: Math.min(head.size, text.size + 4), lineHeight: 1.25, before: 0, after: 0, bar: undefined, lead: undefined, rule: undefined, trail: undefined, bg: undefined }
  const data = chartData(rows)
  const titleLines = title ? breakLines([{ text: title }], titleSt, width, ctx.measure) : []
  const titleH = titleLines.length * titleSt.size * titleSt.lineHeight + (title ? 6 : 0)
  const plotH = Math.round(Math.min(220, Math.max(120, width * 0.42)))
  const legendH = data.series.length > 1 || kind === 'pie' ? text.size * 1.8 : 0
  const h = titleH + legendH + plotH + text.size * 1.6
  const units: Unit[] = [{
    h,
    block: id,
    first: true,
    keep: !!caption,
    place: (x, y, out) => {
      const items = out.items
      placeLines(titleLines, titleSt, x, y, width, items)
      const label = (s: string, lx: number, ly: number, align: 'left' | 'center' | 'right', colour = text.colour) => {
        const f = fontOf(text, null)
        const w = ctx.measure(f, s)
        const sx = align === 'center' ? lx - w / 2 : align === 'right' ? lx - w : lx
        items.push({ kind: 'text', x: sx, y: ly, w, h: text.size * text.lineHeight, segs: [{ text: s, x: 0, w, font: f, colour }] })
        return w
      }
      let top = y + titleH
      if (legendH) {
        let lx = x
        const names = kind === 'pie' ? data.labels : data.series
        names.forEach((name, i) => {
          items.push({ kind: 'rect', x: lx, y: top + 2, w: text.size * 0.9, h: text.size * 0.9, fill: colours[i % colours.length], radius: 2 })
          lx += text.size * 1.3
          lx += label(name, lx, top, 'left') + text.size * 1.2
        })
        top += legendH
      }
      if (kind === 'pie') {
        const values = data.values[0]
        const sum = values.reduce((a, b) => a + Math.max(0, b), 0) || 1
        const r = Math.min(plotH, width) / 2 - 4
        const cx = x + width / 2
        const cy = top + plotH / 2
        let a0 = -Math.PI / 2
        values.forEach((v, i) => {
          const a1 = a0 + (Math.max(0, v) / sum) * Math.PI * 2
          const large = a1 - a0 > Math.PI ? 1 : 0
          const p = (a: number) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`
          const d = values.length === 1 ? `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0 Z` : `M ${cx.toFixed(2)} ${cy.toFixed(2)} L ${p(a0)} A ${r} ${r} 0 ${large} 1 ${p(a1)} Z`
          items.push({ kind: 'path', d, fill: colours[i % colours.length], stroke: { w: 1, colour: '#ffffff' } })
          a0 = a1
        })
      } else {
        const max = Math.max(0, ...data.values.flat())
        const ts = ticks(max)
        const top0 = ts.at(-1)!
        const axisW = Math.max(...ts.map((t) => ctx.measure(fontOf(text, null), fmt(t)))) + 6
        const px = x + axisW
        const pw = width - axisW
        const base = top + plotH
        for (const t of ts) {
          const ty = base - (t / top0) * plotH
          items.push({ kind: 'rect', x: px, y: ty, w: pw, h: t === 0 ? 1 : 0.5, fill: grid })
          label(fmt(t), px - 6, ty - (text.size * text.lineHeight) / 2, 'right', mixColour(text.colour, '#ffffff', 0.35))
        }
        const n = Math.max(1, data.labels.length)
        const slot = pw / n
        data.labels.forEach((l, i) => label(l, px + slot * (i + 0.5), base + 3, 'center'))
        if (kind === 'bar') {
          const k = data.series.length
          const bw = Math.min(28, (slot * 0.7) / k)
          data.values.forEach((vals, s) => vals.forEach((v, i) => {
            const bh = (Math.max(0, v) / top0) * plotH
            const bx = px + slot * (i + 0.5) - (bw * k) / 2 + s * bw
            items.push({ kind: 'rect', x: bx, y: base - bh, w: bw - (k > 1 ? 1.5 : 0), h: bh, fill: colours[s % colours.length], radius: 1.5 })
            if (k === 1) label(fmt(v), bx + bw / 2, base - bh - text.size * text.lineHeight - 1, 'center')
          }))
        } else {
          data.values.forEach((vals, s) => {
            const pts = vals.map((v, i) => [px + slot * (i + 0.5), base - (Math.max(0, v) / top0) * plotH])
            items.push({ kind: 'path', d: pts.map((p, i) => `${i ? 'L' : 'M'} ${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(' '), stroke: { w: 2, colour: colours[s % colours.length] } })
            for (const p of pts) items.push({ kind: 'rect', x: p[0] - 2.5, y: p[1] - 2.5, w: 5, h: 5, fill: colours[s % colours.length], radius: 2.5 })
          })
        }
      }
      out.hits.push({ x, y, w: width, h, target: { kind: 'block', id, first: true } })
    }
  }]
  if (caption) units.push(...captionUnits(id, caption, width, ctx))
  return { before: 12, after: 6, units }
}

// ---------------------------------------------------------------------------
// Pages.

/** Pours units into frames, starting a page when the next unit (and what it keeps with) doesn't fit. */
function pour(laid: Laid[], frames: (n: number) => { x: number; y: number; w: number; h: number }): Out[] {
  const pages: Out[] = [{ items: [], hits: [] }]
  let n = 0
  let frame = frames(0)
  let y = frame.y
  let empty = true
  let prevAfter = 0
  const newPage = () => {
    pages.push({ items: [], hits: [] })
    frame = frames(++n)
    y = frame.y
    empty = true
  }
  const flat: { unit: Unit; gap: number; startsBlock: boolean }[] = []
  const breaks = new Set<number>()
  for (const l of laid) {
    if (l.pageBreak) {
      breaks.add(flat.length)
      prevAfter = 0
      continue
    }
    l.units.forEach((u, i) => flat.push({ unit: u, gap: i === 0 ? Math.max(prevAfter, l.before) : 0, startsBlock: i === 0 }))
    if (l.units.length) prevAfter = l.after
  }
  for (let i = 0; i < flat.length; i++) {
    if (breaks.has(i) && !empty) newPage()
    const { unit } = flat[i]
    const gap = empty ? 0 : flat[i].gap
    // What has to go on the same page: this unit and those it keeps with (up to a page's worth).
    let need = gap + unit.h
    for (let j = i; flat[j]?.unit.keep && flat[j + 1] && need < frame.h * 0.5 && !breaks.has(j + 1); j++) need += flat[j + 1].gap + flat[j + 1].unit.h
    if (y + need > frame.y + frame.h + 0.5 && !empty) {
      newPage()
      if (unit.repeat && !flat[i].startsBlock && unit.repeat !== unit) {
        unit.repeat.place(frame.x, y, pages[n])
        y += unit.repeat.h
        empty = false
      }
    }
    y += empty ? 0 : gap
    unit.place(frame.x, y, pages[n])
    y += unit.h
    empty = false
  }
  return pages
}

/** A design's text boxes with their text, sized to fit, in the order they are drawn. */
function boxItems(design: DocDesign, texts: Record<string, string>, values: Record<string, string>, measure: MeasureText): Item[] {
  return design.texts.map((box) => {
    const text = values[box.name] ?? texts[box.name] ?? ''
    const placeholder = !text.trim()
    return { kind: 'box' as const, box, text, size: placeholder ? box.size : fitDesignText(box, text, measure), placeholder }
  })
}

/** A table region on a fixed page: its rows, squeezed a little if there are more than fit, never past its room. */
function regionUnits(region: TableRegion, rows: string[][], ctx: Ctx): { units: Unit[]; overflow: boolean } {
  const style = region.style
  const all = region.header ? [region.header, ...rows] : rows
  const headH = region.header ? (style.head?.h ?? style.rowH) : 0
  const room = region.h - headH
  const rowH = rows.length ? Math.max(style.rowH * 0.75, Math.min(style.rowH, room / rows.length)) : style.rowH
  const units = tableUnits(null, region.name, all, !!region.header, false, style, region.w, ctx, true, rowH)
  const h = units.reduce((n, u) => n + u.h, 0)
  return { units, overflow: h > region.h + 0.5 }
}

export interface DocLayout {
  pages: PageLayout[]
}

/** The text boxes' measure in the same fonts as everything else. */
export const boxMeasure = (measure: Measure): MeasureText => (box, line, size) =>
  measure({ font: box.font, size, weight: box.weight, italic: box.italic, letterSpacing: (box.letterSpacing / box.size) * size }, shownText(box, line))

/** Lays out a whole document: every section's pages, numbered from 1. */
export function layoutDoc(doc: Doc, board: DocBoard | undefined, opts: LayoutOptions = {}): PageLayout[] {
  const measure = opts.measure ?? estimate
  const ctx: Ctx = { board, measure, palette: board?.palette ?? {}, aspect: opts.aspect ?? (() => undefined), frameH: PAGE_H }
  const pages: PageLayout[] = []
  for (const section of doc.sections) pages.push(...layoutSection(section, board, ctx, pages.length + 1))
  return pages
}

export function layoutSection(section: Section, board: DocBoard | undefined, ctx: Ctx, number: number): PageLayout[] {
  const design = findDocDesign(board, section.design)
  const bm = boxMeasure(ctx.measure)
  if (!design) return [unknownPage(section, board, ctx, number)]
  const values = design.calcs ? boxValues(design, section) : {}
  const decorate = (page: Out, d: DocDesign, first: boolean, num: number): PageLayout => {
    const auto: Record<string, string> = {}
    for (const [name, what] of Object.entries(d.auto ?? {})) if (what === 'page') auto[name] = String(num)
    // A following page drawn from the same design keeps the section's text boxes (a running header).
    const texts = first || d.id === section.design ? section.texts : {}
    const boxes = boxItems(d, texts, { ...values, ...auto }, bm)
    const overflow: string[] = []
    const items: Item[] = [...page.items]
    const hits: Hit[] = [...page.hits]
    if (first || d.id !== design.id) {
      for (const region of d.tables) {
        const rows = computeRows(region, (first ? section.tables[region.name] : undefined) ?? [])
        const r = regionUnits(region, rows, ctx)
        if (r.overflow) overflow.push(`table ${region.name}`)
        let y = region.y
        const out: Out = { items, hits }
        for (const u of r.units) {
          u.place(region.x, y, out)
          y += u.h
        }
      }
    }
    for (const b of boxes) if (b.kind === 'box') hits.push({ x: b.box.x, y: b.box.y, w: b.box.w, h: b.box.h, target: { kind: 'box', name: b.box.name } })
    return { section: section.id, design: d, number: num, first, bg: d.bg, items: [...items, ...boxes], hits: d.auto ? hits.filter((h) => !(h.target.kind === 'box' && d.auto![h.target.name])) : hits, overflow }
  }
  if (!design.flow) return [decorate({ items: [], hits: [] }, design, true, number)]
  const nextDesign = design.flow.next ? findDocDesign(board, design.flow.next) ?? design : design
  const frameOf = (n: number) => (n === 0 ? design : nextDesign).flow ?? design.flow!
  ctx.frameH = design.flow.h
  const blocks = section.blocks ?? []
  const laid = blocks.map((b) => layoutBlock(b, design.flow!.w, ctx))
  const outs = pour(laid, frameOf)
  return outs.map((out, i) => {
    if (i === 0 && !blocks.length) {
      const f = design.flow!
      out.hits.push({ x: f.x, y: f.y, w: f.w, h: Math.min(f.h, 60), target: { kind: 'empty' } })
    }
    return decorate(out, i === 0 ? design : nextDesign, i === 0, number + i)
  })
}

/** A design this Glance doesn't have: its text, plainly, so nothing is lost. */
function unknownPage(section: Section, board: DocBoard | undefined, ctx: Ctx, number: number): PageLayout {
  const out: Out = { items: [], hits: [] }
  const body = styleOf(board, 'body')
  let y = 64
  for (const [name, text] of Object.entries(section.texts)) {
    if (!text.trim()) continue
    y = placeLines(breakLines([{ text }], body, PAGE_W - 112, ctx.measure), body, 56, y, PAGE_W - 112, out.items) + 6
    out.hits.push({ x: 56, y: 64, w: PAGE_W - 112, h: y - 64, target: { kind: 'box', name } })
  }
  return { section: section.id, design: null, number, first: true, bg: board?.plain.bg ?? '#ffffff', items: out.items, hits: out.hits, overflow: [] }
}
