/**
 * Draws a slide's layout boxes as HTML: the editor's slides, the slide sorter's
 * thumbnails, presenting, and the HTML export all use this. Sizes are in slide units
 * (1920 by 1080); the caller scales the slide to fit with a CSS transform.
 *
 * Text and picture paths come from the deck, which an AI app may have written, so all of
 * it is escaped, and pictures only show when `resolveSrc` maps them to a URL.
 */
import { SLIDE_H, SLIDE_W, layoutSlide, type Box, type SlotRef } from './layout'
import { type Slide } from './model'
import { type DeckTheme } from './themes'

export interface HtmlOptions {
  /** The URL to show a deck media path with, or null when the deck has no such file. */
  resolveSrc: (src: string) => string | null
  /** Hint text for empty slots; leave it out to draw nothing there (exports). */
  placeholder?: (ref: SlotRef) => string
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c])

const px = (n: number) => `${Math.round(n * 100) / 100}px`

/** The `data-ref` the editor finds a box's slot by: slot, then index, part and column if any. */
export function refKey(ref: SlotRef): string {
  return [ref.slot, ref.index, ref.part, ref.col].filter((v) => v !== undefined).join('.')
}

export function slideHtml(slide: Slide, theme: DeckTheme, opts: HtmlOptions): string {
  const boxes = layoutSlide(slide, theme).map((b) => boxHtml(b, theme, opts)).join('')
  const style = `position:relative;overflow:hidden;width:${SLIDE_W}px;height:${SLIDE_H}px;background:${theme.bg};color:${theme.text};font-family:${theme.bodyFont}`
  return `<div class="deck-slide" data-slide="${escapeHtml(slide.id)}" style="${escapeHtml(style)}">${boxes}</div>`
}

function boxHtml(box: Box, theme: DeckTheme, opts: HtmlOptions): string {
  const at = `position:absolute;left:${px(box.x)};top:${px(box.y)};width:${px(box.w)};height:${px(box.h)};`
  switch (box.type) {
    case 'rect':
      return `<div style="${escapeHtml(`${at}background:${box.fill};border-radius:${px(box.radius)}`)}"></div>`
    case 'image': {
      const key = escapeHtml(refKey(box.ref))
      const url = box.image ? opts.resolveSrc(box.image.src) : null
      const round = `border-radius:${px(box.radius)};overflow:hidden;`
      if (!url || !box.image) {
        const hint = opts.placeholder ? `<span>${escapeHtml(opts.placeholder(box.ref))}</span>` : ''
        const look = `${at}${round}display:flex;align-items:center;justify-content:center;background:${theme.surface};color:${theme.muted};font-size:32px`
        return `<div class="deck-box deck-image empty" data-ref="${key}" style="${escapeHtml(look)}">${hint}</div>`
      }
      const f = box.image.focus ?? { x: 0.5, y: 0.5 }
      const img = `width:100%;height:100%;object-fit:cover;object-position:${Math.round(f.x * 100)}% ${Math.round(f.y * 100)}%;display:block`
      return `<div class="deck-box deck-image" data-ref="${key}" style="${escapeHtml(at + round)}"><img src="${escapeHtml(url)}" alt="${escapeHtml(box.image.alt)}" draggable="false" style="${escapeHtml(img)}"></div>`
    }
    case 'text': {
      if (box.placeholder && !opts.placeholder) return ''
      const justify = { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[box.valign]
      const font = box.font === 'heading' ? `font-family:${theme.headingFont};font-weight:${theme.headingWeight};` : 'font-weight:400;'
      const look = `${at}display:flex;flex-direction:column;justify-content:${justify};text-align:${box.align};font-size:${px(box.size)};line-height:${box.lineHeight};color:${box.colour};${font}gap:0.3em;overflow-wrap:anywhere`
      const key = escapeHtml(refKey(box.ref))
      const cls = `deck-box deck-text${box.placeholder ? ' empty' : ''}`
      if (box.placeholder) {
        return `<div class="${cls}" data-ref="${key}" style="${escapeHtml(`${look};opacity:0.4`)}"><p style="margin:0">${escapeHtml(opts.placeholder!(box.ref))}</p></div>`
      }
      if (box.bullets) {
        const dot = `position:absolute;left:0;top:${box.lineHeight / 2}em;width:0.32em;height:0.32em;margin-top:-0.16em;border-radius:50%;background:${theme.accent}`
        const items = box.paragraphs.map((p) => `<li style="position:relative;padding-left:1.1em"><span style="${escapeHtml(dot)}"></span>${escapeHtml(p)}</li>`).join('')
        return `<div class="${cls}" data-ref="${key}" style="${escapeHtml(look)}"><ul style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:0.5em">${items}</ul></div>`
      }
      const paras = box.paragraphs.map((p) => `<p style="margin:0;white-space:pre-wrap">${escapeHtml(p)}</p>`).join('')
      return `<div class="${cls}" data-ref="${key}" style="${escapeHtml(look)}">${paras}</div>`
    }
  }
}
