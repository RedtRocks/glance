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
import { placeholderRuns } from '../ai/guide'
import { DESIGN_SCALE, fontStack, noDesigns, placeTexts, type Design, type DesignLookup, type DesignText, type MeasureText } from './design'

export interface HtmlOptions {
  /** The URL to show a deck media path with, or null when the deck has no such file. */
  resolveSrc: (src: string) => string | null
  /** Hint text for empty slots; leave it out to draw nothing there (exports). */
  placeholder?: (ref: SlotRef, sample?: string) => string
  /** The designs a deck's designed slides are drawn from. */
  designs?: DesignLookup
  /** Measures design text in its real font, so longer text shrinks just enough (see fitDesignText). */
  measure?: MeasureText
  /** Highlights placeholders like [date] for the person to fill (the editor, not exports). */
  markPlaceholders?: boolean
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c])

/** Escaped text, with placeholders wrapped in a mark when asked. */
function textHtml(s: string, opts: HtmlOptions): string {
  if (!opts.markPlaceholders) return escapeHtml(s)
  return placeholderRuns(s).map((r) => (r.placeholder ? `<mark class="deck-placeholder">${escapeHtml(r.text)}</mark>` : escapeHtml(r.text))).join('')
}

const px = (n: number) => `${Math.round(n * 100) / 100}px`

/** The `data-ref` the editor finds a box's slot by: slot, then index, part and column if any. */
export function refKey(ref: SlotRef): string {
  return [ref.slot, ref.index, ref.part, ref.col].filter((v) => v !== undefined).join('.')
}

export function slideHtml(slide: Slide, theme: DeckTheme, opts: HtmlOptions): string {
  if (slide.layout === 'design') return designedHtml(slide, slide.design ? (opts.designs ?? noDesigns)(slide.design) : undefined, theme, opts)
  const boxes = layoutSlide(slide, theme).map((b) => boxHtml(b, theme, opts)).join('')
  const style = `position:relative;overflow:hidden;width:${SLIDE_W}px;height:${SLIDE_H}px;background:${theme.bg};color:${theme.text};font-family:${theme.bodyFont}`
  return `<div class="deck-slide" data-slide="${escapeHtml(slide.id)}" style="${escapeHtml(style)}">${boxes}</div>`
}

function boxHtml(box: Box, theme: DeckTheme, opts: HtmlOptions): string {
  const at = `position:absolute;left:${px(box.x)};top:${px(box.y)};width:${px(box.w)};height:${px(box.h)};`
  switch (box.type) {
    case 'rect': {
      // Outlines are drawn inside the box, as the exports draw them.
      const line = box.line ? `box-sizing:border-box;border:${px(box.line.width)} solid ${box.line.colour};` : ''
      return `<div style="${escapeHtml(`${at}${line}background:${box.fill === 'none' ? 'transparent' : box.fill};border-radius:${px(box.radius)};pointer-events:none`)}"></div>`
    }
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
      if (box.decor) return `<div style="${escapeHtml(`${look};pointer-events:none`)}">${box.paragraphs.map((p) => `<p style="margin:0">${escapeHtml(p)}</p>`).join('')}</div>`
      const key = escapeHtml(refKey(box.ref))
      const cls = `deck-box deck-text${box.placeholder ? ' empty' : ''}`
      if (box.placeholder) {
        return `<div class="${cls}" data-ref="${key}" style="${escapeHtml(`${look};opacity:0.4`)}"><p style="margin:0">${escapeHtml(opts.placeholder!(box.ref))}</p></div>`
      }
      if (box.bullets) {
        const dot = `position:absolute;left:0;top:${box.lineHeight / 2}em;width:0.32em;height:0.32em;margin-top:-0.16em;border-radius:50%;background:${theme.accent}`
        const items = box.paragraphs.map((p) => `<li style="position:relative;padding-left:1.1em"><span style="${escapeHtml(dot)}"></span>${textHtml(p, opts)}</li>`).join('')
        return `<div class="${cls}" data-ref="${key}" style="${escapeHtml(look)}"><ul style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:0.5em">${items}</ul></div>`
      }
      const paras = box.paragraphs.map((p) => `<p style="margin:0;white-space:pre-wrap">${textHtml(p, opts)}</p>`).join('')
      return `<div class="${cls}" data-ref="${key}" style="${escapeHtml(look)}">${paras}</div>`
    }
  }
}

/**
 * A designed slide: the design's art (a trusted app asset, see design.ts), then a text
 * box per slot. The text comes from the deck, so it is escaped like any other.
 */
function designedHtml(slide: Slide, design: Design | undefined, theme: DeckTheme, opts: HtmlOptions): string {
  const id = escapeHtml(slide.id)
  if (!design) {
    // A design this Glance doesn't have (or hasn't loaded yet): the text, plainly, so nothing is lost.
    const texts = Object.entries(slide.slots).flatMap(([name, v]) => (v.kind === 'text' ? [`<p style="margin:0" data-ref="${escapeHtml(name)}" class="deck-box deck-text">${escapeHtml(v.value)}</p>`] : []))
    const style = `position:relative;overflow:hidden;width:${SLIDE_W}px;height:${SLIDE_H}px;background:${theme.bg};color:${theme.text};font-family:${theme.bodyFont};font-size:48px;display:flex;flex-direction:column;gap:24px;padding:120px;box-sizing:border-box;white-space:pre-wrap`
    return `<div class="deck-slide" data-slide="${id}" style="${escapeHtml(style)}">${texts.join('')}</div>`
  }
  const placed = placeTexts(slide, design, opts.measure)
  const draw = (under: boolean) => placed.filter((p) => !!p.box.under === under).map((p) => designTextHtml(p.box, p.text, p.size, p.placeholder, opts)).join('')
  const style = `position:relative;overflow:hidden;width:${SLIDE_W}px;height:${SLIDE_H}px;background:${design.bg}`
  return `<div class="deck-slide" data-slide="${id}" data-design="${escapeHtml(design.id)}" style="${escapeHtml(style)}">${design.art}${draw(true)}${design.over ?? ''}${draw(false)}</div>`
}

/** The CSS for one design text box at `size`, shared with the editor's typing box. */
export function designTextStyle(t: DesignText, size: number): string {
  const justify = { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[t.valign]
  const ws = t.wrap === 'nowrap' ? 'pre' : t.wrap === 'pre' ? 'pre' : 'pre-wrap'
  return [
    `position:absolute;left:${px(t.x)};top:${px(t.y)};width:${px(t.w)};height:${px(t.h)}`,
    t.rotate ? `transform:rotate(${t.rotate}deg)` : '',
    `display:flex;flex-direction:column;justify-content:${justify};text-align:${t.align}`,
    `font-family:${fontStack(t.font)};font-size:${px(size)};font-weight:${t.weight};font-style:${t.italic ? 'italic' : 'normal'}`,
    // The design's optical size is its size on the 640 by 360 board, not on the scaled-up slide.
    `font-optical-sizing:none;font-variation-settings:'opsz' ${Math.round((size / DESIGN_SCALE) * 10) / 10}`,
    `line-height:${t.lineHeight};letter-spacing:${Math.round((t.letterSpacing / t.size) * 1000) / 1000}em;color:${t.colour}`,
    t.opacity < 1 ? `opacity:${t.opacity}` : '',
    t.transform ? `text-transform:${t.transform}` : '',
    t.indent ? `text-indent:${px((t.indent * size) / t.size)}` : '',
    t.shadow ? `text-shadow:${t.shadow}` : '',
    t.gradient ? `background:${t.gradient};-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent` : '',
    `white-space:${ws};overflow-wrap:anywhere;overflow:visible`
  ].filter(Boolean).join(';')
}

function designTextHtml(t: DesignText, text: string, size: number, placeholder: boolean, opts: HtmlOptions): string {
  if (placeholder && !opts.placeholder) return ''
  const key = escapeHtml(t.name)
  const look = designTextStyle(t, size)
  if (placeholder) {
    const hint = opts.placeholder!({ slot: t.name }, t.sample)
    return `<div class="deck-box deck-text empty" data-ref="${key}" style="${escapeHtml(`${look};opacity:${0.35 * t.opacity}`)}"><p style="margin:0">${escapeHtml(hint)}</p></div>`
  }
  return `<div class="deck-box deck-text" data-ref="${key}" style="${escapeHtml(look)}"><p style="margin:0">${textHtml(text, opts)}</p></div>`
}
