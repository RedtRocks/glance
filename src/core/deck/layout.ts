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
import { type DeckTheme } from './themes'

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
  | { type: 'rect'; x: number; y: number; w: number; h: number; fill: string; radius: number }
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
    }
  | { type: 'image'; x: number; y: number; w: number; h: number; ref: SlotRef; image: ImageRef | null; radius: number }

export type TextBox = Extract<Box, { type: 'text' }>

/** Average glyph width as a share of the font size; Urbanist runs a little narrow. */
const CHAR_W = 0.5

/** Lines `paragraphs` wrap to in a box `w` wide at `size`, wrapping at spaces like a browser. */
export function wrappedLines(paragraphs: string[], w: number, size: number, indent = 0): number {
  const perLine = Math.max(1, Math.floor((w - indent) / (size * CHAR_W)))
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

/** Builds the layout boxes for one slide. */
export function layoutSlide(slide: Slide, theme: DeckTheme): Box[] {
  const s = slide.slots
  const boxes: Box[] = []
  const text = (ref: SlotRef, paragraphs: string[], x: number, y: number, w: number, h: number, o: TextOpts) => {
    const lineHeight = o.lineHeight ?? (o.font === 'heading' ? 1.1 : 1.3)
    const placeholder = !paragraphs.some((p) => p.trim())
    const size = placeholder ? o.max : fitSize(paragraphs, w, h, o.max, o.min ?? Math.round(o.max * 0.55), lineHeight, o.bullets ? 0.5 : 0.3, o.bullets)
    boxes.push({
      type: 'text', x, y, w, h, ref, paragraphs: placeholder ? [] : paragraphs, size, lineHeight,
      colour: o.colour ?? theme.text, font: o.font ?? 'body', align: o.align ?? 'left', valign: o.valign ?? 'top',
      bullets: o.bullets ?? false, placeholder
    })
  }
  const image = (ref: SlotRef, x: number, y: number, w: number, h: number, radius = theme.radius) =>
    boxes.push({ type: 'image', x, y, w, h, ref, image: imageOf(s[ref.slot]), radius })
  const rect = (x: number, y: number, w: number, h: number, fill: string, radius = 0) => boxes.push({ type: 'rect', x, y, w, h, fill, radius })
  const title = (y = 96, h = 150) => text({ slot: 'title' }, str(s.title), M, y, SLIDE_W - 2 * M, h, { max: 76, font: 'heading', valign: 'bottom' })
  const body = { y: 300, h: SLIDE_H - 300 - 110 }

  switch (slide.layout) {
    case 'title': {
      const pic = !!s.image
      const w = pic ? 840 : SLIDE_W - 2 * M
      rect(M, 330, 96, 12, theme.accent, 6)
      text({ slot: 'title' }, str(s.title), M, 380, w, 330, { max: pic ? 110 : 132, font: 'heading', valign: 'top' })
      text({ slot: 'subtitle' }, str(s.subtitle), M, 730, w, 200, { max: 44, colour: theme.muted })
      if (pic) image({ slot: 'image' }, 1080, M, SLIDE_W - 1080 - M, SLIDE_H - 2 * M)
      break
    }
    case 'section':
      rect(0, 0, SLIDE_W, SLIDE_H, theme.accent)
      text({ slot: 'title' }, str(s.title), M, 300, SLIDE_W - 2 * M, 360, { max: 120, font: 'heading', colour: theme.onAccent, valign: 'bottom' })
      text({ slot: 'subtitle' }, str(s.subtitle), M, 700, SLIDE_W - 2 * M, 220, { max: 44, colour: theme.onAccent })
      break
    case 'bullets':
      title()
      text({ slot: 'bullets' }, list(s.bullets), M, body.y, SLIDE_W - 2 * M, body.h, { max: 52, min: 28, bullets: true })
      break
    case 'twoColumns': {
      const w = (SLIDE_W - 2 * M - 96) / 2
      title()
      text({ slot: 'left' }, list(s.left), M, body.y, w, body.h, { max: 46, min: 26, bullets: true })
      text({ slot: 'right' }, list(s.right), M + w + 96, body.y, w, body.h, { max: 46, min: 26, bullets: true })
      break
    }
    case 'imageLeft':
    case 'imageRight': {
      const left = slide.layout === 'imageLeft'
      const pw = 860
      const tx = left ? pw + 120 : M
      const tw = SLIDE_W - pw - 120 - M
      image({ slot: 'image' }, left ? 0 : SLIDE_W - pw, 0, pw, SLIDE_H, 0)
      text({ slot: 'title' }, str(s.title), tx, 200, tw, 300, { max: 76, font: 'heading', valign: 'bottom' })
      text({ slot: 'body' }, str(s.body), tx, 540, tw, 400, { max: 46, min: 28, colour: theme.muted })
      break
    }
    case 'fullImage': {
      image({ slot: 'image' }, 0, 0, SLIDE_W, SLIDE_H, 0)
      const caption = str(s.caption)
      if (caption.some((c) => c.trim())) rect(M - 40, SLIDE_H - 250, SLIDE_W - 2 * M + 80, 150, theme.bg, theme.radius)
      text({ slot: 'caption' }, caption, M, SLIDE_H - 230, SLIDE_W - 2 * M, 110, { max: 44, min: 30, valign: 'middle' })
      break
    }
    case 'bigNumber':
      text({ slot: 'stat' }, str(s.stat), M, 150, SLIDE_W - 2 * M, 400, { max: 320, min: 160, font: 'heading', colour: theme.accent, valign: 'bottom', lineHeight: 1 })
      text({ slot: 'statLabel' }, str(s.statLabel), M, 590, SLIDE_W - 2 * M, 150, { max: 60, font: 'heading' })
      text({ slot: 'body' }, str(s.body), M, 770, 1300, 200, { max: 36, min: 26, colour: theme.muted })
      break
    case 'threeCards': {
      title()
      const items = itemsOf(s.items)
      const n = Math.max(3, items.length)
      const gap = 48
      const w = (SLIDE_W - 2 * M - gap * (n - 1)) / n
      for (let i = 0; i < n; i++) {
        const x = M + i * (w + gap)
        rect(x, body.y, w, body.h, theme.surface, theme.radius)
        rect(x + 56, body.y + 64, 56, 56, theme.accent, 28)
        text({ slot: 'items', index: i, part: 'heading' }, str(items[i]?.heading), x + 56, body.y + 160, w - 112, 150, { max: 54, min: 32, font: 'heading' })
        text({ slot: 'items', index: i, part: 'body' }, str(items[i]?.body), x + 56, body.y + 330, w - 112, body.h - 390, { max: 38, min: 24, colour: theme.muted })
      }
      break
    }
    case 'quote':
      text({ slot: 'quote' }, str(s.quote), 260, 220, SLIDE_W - 260 - M, 560, { max: 84, min: 44, font: 'heading', lineHeight: 1.2 })
      rect(M, 230, 12, 160, theme.accent, 6)
      text({ slot: 'attribution' }, str(s.attribution), 260, 820, SLIDE_W - 260 - M, 100, { max: 36, colour: theme.muted })
      break
    case 'comparison': {
      title()
      const rows = tableOf(s.table)
      const cols = Math.max(1, ...rows.map((r) => r.length))
      const shown = rows.length ? rows : [[]]
      const rh = Math.min(120, body.h / shown.length)
      const cw = (SLIDE_W - 2 * M) / cols
      rect(M, body.y, SLIDE_W - 2 * M, rh, theme.surface, theme.radius / 2)
      shown.forEach((row, r) => {
        if (r > 0) rect(M, body.y + r * rh, SLIDE_W - 2 * M, 2, theme.stroke)
        for (let c = 0; c < cols; c++) {
          text({ slot: 'table', index: r, col: c }, str(row[c]), M + c * cw + 32, body.y + r * rh, cw - 64, rh, {
            max: 40, min: 22, valign: 'middle', font: r === 0 ? 'heading' : 'body', colour: r === 0 ? theme.accent : theme.text
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
      const line = body.y + 120
      rect(M, line - 2, SLIDE_W - 2 * M, 4, theme.stroke, 2)
      for (let i = 0; i < n; i++) {
        const x = M + i * w
        rect(x, line - 18, 36, 36, theme.accent, 18)
        text({ slot: 'items', index: i, part: 'heading' }, str(items[i]?.heading), x, line + 70, w - 48, 120, { max: 48, min: 28, font: 'heading' })
        text({ slot: 'items', index: i, part: 'body' }, str(items[i]?.body), x, line + 200, w - 48, SLIDE_H - line - 300, { max: 36, min: 22, colour: theme.muted })
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
