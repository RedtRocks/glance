/**
 * Where everything on a slide goes. A layout turns a slide's slots into boxes on a
 * 1920 by 1080 slide, and both the HTML view and the PowerPoint export draw those same
 * boxes, so an exported deck looks like the one in Glance.
 *
 * Text is fitted without a DOM: an estimate of how many lines it wraps to at each size,
 * shrinking until it fits. That keeps layout pure and testable, and the check
 * (check.ts) keeps text short enough that the estimate rarely has to work hard.
 */
import { type ImageRef, type Item, type Slide, type SlotValue } from './model'
import { mix, type DeckTheme } from './themes'

export const SLIDE_W = 1920
export const SLIDE_H = 1080
const M = 120

/** Which slot (and which entry of it) a box shows, so the editor can edit it in place. */
export interface SlotRef {
  slot: string
  index?: number
  part?: 'heading' | 'body'
  col?: number
}

export type Box =
  | {
      type: 'rect'
      x: number
      y: number
      w: number
      h: number
      /** A colour, or 'none' for an outline only. */
      fill: string
      radius: number
      line?: { colour: string; width: number }
      /** Decoration: may run off the slide, and exports may draw it as one picture. */
      decor?: boolean
    }
  | {
      type: 'text'
      x: number
      y: number
      w: number
      h: number
      ref: SlotRef
      paragraphs: string[]
      /** Font size in slide units. */
      size: number
      lineHeight: number
      colour: string
      font: 'heading' | 'body'
      align: 'left' | 'center'
      valign: 'top' | 'middle' | 'bottom'
      bullets: boolean
      /** The slot is empty; the editor shows a hint here, exports leave it out. */
      placeholder: boolean
      /** Text the layout adds, like a card's number: not a slot, so not editable. */
      decor?: boolean
    }
  | { type: 'image'; x: number; y: number; w: number; h: number; ref: SlotRef; image: ImageRef | null; radius: number }

export type TextBox = Extract<Box, { type: 'text' }>

/** Average glyph width as a share of the font size; Urbanist runs a little narrow. */
const CHAR_W = 0.5

/** Lines `paragraphs` wrap to in a box `w` wide at `size`, wrapping at spaces like a browser. */
export function wrappedLines(paragraphs: string[], w: number, size: number, indent = 0, charW = CHAR_W): number {
  const perLine = Math.max(1, Math.floor((w - indent) / (size * charW)))
  let lines = 0
  for (const p of paragraphs) {
    let line = 0
    lines++
    for (const word of p.split(/\s+/).filter(Boolean)) {
      if (!line) line = word.length
      else if (line + 1 + word.length <= perLine) line += 1 + word.length
      else {
        lines++
        line = word.length
      }
      // A word longer than a line breaks across lines.
      if (line > perLine) {
        lines += Math.ceil(line / perLine) - 1
        line = line % perLine || perLine
      }
    }
  }
  return lines
}

/** The largest size from `max` down to `min` at which the text fits the box. */
export function fitSize(paragraphs: string[], w: number, h: number, max: number, min: number, lineHeight: number, gap = 0, bullets = false): number {
  for (let size = max; size > min; size -= 2) {
    const lines = wrappedLines(paragraphs, w, size, bullets ? size * 1.1 : 0)
    if (lines * size * lineHeight + Math.max(0, paragraphs.length - 1) * gap * size <= h) return size
  }
  return min
}

interface TextOpts {
  max: number
  min?: number
  colour?: string
  font?: 'heading' | 'body'
  align?: 'left' | 'center'
  valign?: 'top' | 'middle' | 'bottom'
  bullets?: boolean
  lineHeight?: number
}

/** A small number from the slide id, so slides of one layout don't all look the same. */
function variant(id: string, n: number): number {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h % n
}

/** Builds the layout boxes for one slide. */
export function layoutSlide(slide: Slide, theme: DeckTheme): Box[] {
  const s = slide.slots
  const boxes: Box[] = []
  const pop = (i: number) => theme.pops[i % theme.pops.length]
  const v = variant(slide.id + theme.id, 3)
  const text = (ref: SlotRef, paragraphs: string[], x: number, y: number, w: number, h: number, o: TextOpts) => {
    const lineHeight = o.lineHeight ?? (o.font === 'heading' ? 1.08 : 1.3)
    const placeholder = !paragraphs.some((p) => p.trim())
    const size = placeholder ? o.max : fitSize(paragraphs, w, h, o.max, o.min ?? Math.round(o.max * 0.55), lineHeight, o.bullets ? 0.5 : 0.3, o.bullets)
    boxes.push({
      type: 'text', x, y, w, h, ref, paragraphs: placeholder ? [] : paragraphs, size, lineHeight,
      colour: o.colour ?? theme.text, font: o.font ?? 'body', align: o.align ?? 'left', valign: o.valign ?? 'top',
      bullets: o.bullets ?? false, placeholder
    })
  }
  const label = (words: string, x: number, y: number, w: number, h: number, size: number, colour: string, align: 'left' | 'center' = 'left', valign: 'top' | 'middle' | 'bottom' = 'top') =>
    boxes.push({ type: 'text', x, y, w, h, ref: { slot: '' }, paragraphs: [words], size, lineHeight: 1, colour, font: 'heading', align, valign, bullets: false, placeholder: false, decor: true })
  const image = (ref: SlotRef, x: number, y: number, w: number, h: number, radius = theme.radius) =>
    boxes.push({ type: 'image', x, y, w, h, ref, image: imageOf(s[ref.slot]), radius })
  const rect = (x: number, y: number, w: number, h: number, fill: string, radius = 0) => boxes.push({ type: 'rect', x, y, w, h, fill, radius })
  const dot = (cx: number, cy: number, d: number, fill: string) => boxes.push({ type: 'rect', x: cx - d / 2, y: cy - d / 2, w: d, h: d, fill, radius: d / 2, decor: true })
  const ring = (cx: number, cy: number, d: number, width: number, colour: string) =>
    boxes.push({ type: 'rect', x: cx - d / 2, y: cy - d / 2, w: d, h: d, fill: 'none', radius: d / 2, line: { colour, width }, decor: true })
  const pill = (x: number, y: number, w: number, h: number, fill: string) => boxes.push({ type: 'rect', x, y, w, h, fill, radius: Math.min(w, h) / 2, decor: true })
  const tint = mix(theme.bg, theme.accent, 0.08)
  const title = (y = 96, h = 150, w = SLIDE_W - 2 * M) => text({ slot: 'title' }, str(s.title), M, y, w, h, { max: 84, font: 'heading', valign: 'bottom' })
  const body = { y: 300, h: SLIDE_H - 300 - 110 }
  /** The shapes on a picture-less title slide, right of the text. Three looks, by slide. */
  const titleArt = () => {
    if (v === 0) {
      dot(1640, 260, 760, pop(0).fill)
      dot(1250, 820, 300, pop(1).fill)
      ring(1700, 860, 380, 36, pop(2).fill)
    } else if (v === 1) {
      pill(1180, 120, 900, 300, pop(0).fill)
      dot(1420, 700, 420, pop(1).fill)
      dot(1800, 560, 180, pop(2).fill)
      ring(1800, 1000, 300, 32, pop(0).fill)
    } else {
      dot(1500, 540, 640, pop(1).fill)
      dot(1820, 180, 360, pop(0).fill)
      pill(1180, 860, 520, 160, pop(2).fill)
      ring(1500, 540, 860, 28, pop(0).fill)
    }
  }

  switch (slide.layout) {
    case 'title': {
      const pic = !!s.image
      const w = pic ? 840 : 1000
      if (pic) {
        dot(1860, 1000, 420, pop(1).fill)
        image({ slot: 'image' }, 1080, M, SLIDE_W - 1080 - M, SLIDE_H - 2 * M)
      } else titleArt()
      pill(M, 290, 140, 28, theme.accent)
      text({ slot: 'title' }, str(s.title), M, 350, w, 400, { max: pic ? 120 : 140, font: 'heading', valign: 'top', lineHeight: 1.02 })
      text({ slot: 'subtitle' }, str(s.subtitle), M, 780, w, 180, { max: 44, colour: theme.muted })
      break
    }
    case 'section': {
      const on = theme.onAccent
      rect(0, 0, SLIDE_W, SLIDE_H, theme.accent)
      if (v === 1) {
        dot(1700, 200, 700, pop(1).fill)
        ring(1700, 200, 1000, 30, mix(theme.accent, on, 0.3))
      } else {
        dot(1720, 900, 760, pop(1).fill)
        ring(1300, 980, 360, 30, mix(theme.accent, on, 0.3))
        dot(1880, 120, 200, pop(2).fill)
      }
      text({ slot: 'title' }, str(s.title), M, 260, 1240, 420, { max: 150, font: 'heading', colour: on, valign: 'bottom', lineHeight: 1.02 })
      text({ slot: 'subtitle' }, str(s.subtitle), M, 720, 1140, 220, { max: 44, colour: on })
      break
    }
    case 'bullets': {
      // A coloured column for the title, the points beside it.
      const cw = 720
      rect(0, 0, cw, SLIDE_H, tint)
      dot(v === 2 ? cw - 40 : 140, SLIDE_H - 80, 260, pop(v).fill)
      ring(cw - 120, 140, 160, 22, pop(v + 1).fill)
      text({ slot: 'title' }, str(s.title), M, 220, cw - 2 * M, 520, { max: 92, font: 'heading', valign: 'top' })
      text({ slot: 'bullets' }, list(s.bullets), cw + 120, 160, SLIDE_W - cw - 120 - M, SLIDE_H - 320, { max: 54, min: 28, bullets: true, valign: 'middle' })
      break
    }
    case 'twoColumns': {
      const gap = 48
      const w = (SLIDE_W - 2 * M - gap) / 2
      title()
      for (const [i, slot] of (['left', 'right'] as const).entries()) {
        const x = M + i * (w + gap)
        rect(x, body.y, w, body.h, i === 0 ? theme.surface : tint, theme.radius)
        pill(x + 64, body.y + 64, 120, 20, pop(i + v).fill)
        text({ slot }, list(s[slot]), x + 64, body.y + 130, w - 128, body.h - 190, { max: 46, min: 26, bullets: true })
      }
      break
    }
    case 'imageLeft':
    case 'imageRight': {
      const left = slide.layout === 'imageLeft'
      const pw = 860
      const tx = left ? pw + 120 : M
      const tw = SLIDE_W - pw - 120 - M
      const px = left ? 0 : SLIDE_W - pw
      image({ slot: 'image' }, px, 0, pw, SLIDE_H, 0)
      if (!s.image) {
        // No picture yet: shapes, so the slide isn't half empty.
        dot(px + pw / 2, SLIDE_H / 2, 520, pop(0).fill)
        dot(px + pw / 2 + 260, SLIDE_H / 2 + 300, 220, pop(1).fill)
        ring(px + pw / 2 - 200, SLIDE_H / 2 - 260, 240, 28, pop(2).fill)
      }
      pill(tx, 240, 120, 20, pop(v).fill)
      text({ slot: 'title' }, str(s.title), tx, 290, tw, 300, { max: 92, font: 'heading', valign: 'top' })
      text({ slot: 'body' }, str(s.body), tx, 620, tw, 340, { max: 44, min: 28, colour: theme.muted })
      break
    }
    case 'fullImage': {
      image({ slot: 'image' }, 0, 0, SLIDE_W, SLIDE_H, 0)
      const caption = str(s.caption)
      if (caption.some((c) => c.trim())) rect(M - 40, SLIDE_H - 250, SLIDE_W - 2 * M + 80, 150, theme.bg, theme.radius)
      text({ slot: 'caption' }, caption, M, SLIDE_H - 230, SLIDE_W - 2 * M, 110, { max: 44, min: 30, valign: 'middle' })
      break
    }
    case 'bigNumber': {
      // The number on a big disc of colour, what it means beside it.
      const p = pop(v)
      dot(560, 540, 900, p.fill)
      ring(560, 540, 1080, 26, pop(v + 1).fill)
      dot(1000, 160, 140, pop(v + 2).fill)
      text({ slot: 'stat' }, str(s.stat), 160, 300, 800, 480, { max: 300, min: 120, font: 'heading', colour: p.on, align: 'center', valign: 'middle', lineHeight: 1 })
      text({ slot: 'statLabel' }, str(s.statLabel), 1140, 280, SLIDE_W - 1140 - M, 300, { max: 72, font: 'heading', valign: 'bottom' })
      text({ slot: 'body' }, str(s.body), 1140, 620, SLIDE_W - 1140 - M, 320, { max: 40, min: 26, colour: theme.muted })
      break
    }
    case 'threeCards': {
      title()
      const items = itemsOf(s.items)
      const n = Math.max(3, items.length)
      const gap = 32
      const w = (SLIDE_W - 2 * M - gap * (n - 1)) / n
      for (let i = 0; i < n; i++) {
        const x = M + i * (w + gap)
        // Cards blocked in the theme's colours in turn, every other one plain.
        const c = (i + v) % 2 === 0 ? pop(i + v) : { fill: theme.surface, on: theme.text }
        const sub = c.fill === theme.surface ? theme.muted : c.on
        rect(x, body.y, w, body.h, c.fill, theme.radius)
        label(String(i + 1).padStart(2, '0'), x + 56, body.y + 56, w - 112, 96, 96, c.on)
        text({ slot: 'items', index: i, part: 'heading' }, str(items[i]?.heading), x + 56, body.y + 210, w - 112, 150, { max: 56, min: 32, font: 'heading', colour: c.on })
        text({ slot: 'items', index: i, part: 'body' }, str(items[i]?.body), x + 56, body.y + 380, w - 112, body.h - 430, { max: 36, min: 22, colour: sub })
      }
      break
    }
    case 'quote':
      rect(0, 0, SLIDE_W, SLIDE_H, tint)
      dot(SLIDE_W - 40, 80, 420, pop(v + 1).fill)
      ring(SLIDE_W - 260, 300, 220, 24, pop(v + 2).fill)
      label('\u201c', M - 20, 40, 400, 400, 420, theme.accent)
      text({ slot: 'quote' }, str(s.quote), M, 330, 1400, 460, { max: 92, min: 44, font: 'heading', lineHeight: 1.15 })
      pill(M, 868, 80, 16, theme.accent)
      text({ slot: 'attribution' }, str(s.attribution), M + 112, 840, 1400, 80, { max: 36, colour: theme.muted, valign: 'middle' })
      break
    case 'comparison': {
      title()
      const rows = tableOf(s.table)
      const cols = Math.max(1, ...rows.map((r) => r.length))
      const shown = rows.length ? rows : [[]]
      const rh = Math.min(120, body.h / shown.length)
      const cw = (SLIDE_W - 2 * M) / cols
      shown.forEach((row, r) => {
        // The heading row in the accent colour, the rest striped.
        if (r === 0) rect(M, body.y, SLIDE_W - 2 * M, rh, theme.accent, theme.radius / 2)
        else if (r % 2 === 0) rect(M, body.y + r * rh, SLIDE_W - 2 * M, rh, theme.surface, theme.radius / 2)
        for (let c = 0; c < cols; c++) {
          text({ slot: 'table', index: r, col: c }, str(row[c]), M + c * cw + 32, body.y + r * rh, cw - 64, rh, {
            max: 40, min: 22, valign: 'middle', font: r === 0 || c === 0 ? 'heading' : 'body', colour: r === 0 ? theme.onAccent : theme.text
          })
        }
      })
      break
    }
    case 'timeline': {
      title()
      const items = itemsOf(s.items)
      const n = Math.max(3, items.length)
      const w = (SLIDE_W - 2 * M) / n
      const line = body.y + 110
      rect(M, line - 6, SLIDE_W - 2 * M, 12, mix(theme.bg, theme.text, 0.12), 6)
      for (let i = 0; i < n; i++) {
        const x = M + i * w
        const p = pop(i + v)
        rect(x, line - 6, i < n - 1 ? w : 96, 12, p.fill, 6)
        rect(x, line - 48, 96, 96, p.fill, 48)
        label(String(i + 1), x, line - 48, 96, 96, 48, p.on, 'center', 'middle')
        text({ slot: 'items', index: i, part: 'heading' }, str(items[i]?.heading), x, line + 90, w - 48, 120, { max: 52, min: 28, font: 'heading' })
        text({ slot: 'items', index: i, part: 'body' }, str(items[i]?.body), x, line + 220, w - 48, SLIDE_H - line - 320, { max: 36, min: 22, colour: theme.muted })
      }
      break
    }
  }
  return boxes
}

const str = (v: SlotValue | string | undefined): string[] => {
  if (typeof v === 'string') return [v]
  return v?.kind === 'text' ? [v.value] : []
}
const list = (v: SlotValue | undefined): string[] => (v?.kind === 'list' ? v.value : [])
const itemsOf = (v: SlotValue | undefined): Item[] => (v?.kind === 'items' ? v.value : [])
const tableOf = (v: SlotValue | undefined): string[][] => (v?.kind === 'table' ? v.value : [])
const imageOf = (v: SlotValue | undefined): ImageRef | null => (v?.kind === 'image' ? v.value : null)
