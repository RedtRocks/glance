/**
 * Slides as pictures: for AI apps to look at their work (glance_deck_render), PNG export
 * and anything else that needs pixels. The slide's HTML (core/deck/html.ts) goes into an
 * SVG foreignObject with the font and pictures inlined, so nothing outside the SVG is
 * loaded and the canvas it is drawn on stays readable.
 */
import { slideHtml } from '../core/deck/html'
import { boardOf, type Design } from '../core/deck/design'
import { SLIDE_H, SLIDE_W } from '../core/deck/layout'
import type { Deck, Slide } from '../core/deck/model'
import { themeOf } from '../core/deck/themes'
import { toBase64 } from '../core/mcp/helpers'
import { findDesign, loadDesigns, loadedBoard } from '../state/designs'
import { inlineFontCss } from './fonts'
import { measureDesignText } from './measure'

const TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', svg: 'image/svg+xml' }

/** Loads a board's fonts into the page (web.css names them), for measuring. */
async function fontsLoaded(fonts: { family: string; weight: number; italic: boolean }[]): Promise<void> {
  await Promise.all(fonts.map((f) => document.fonts.load(`${f.italic ? 'italic ' : ''}${f.weight} 16px '${f.family}'`).catch(() => [])))
}

const fontCss = new Map<string, Promise<string>>()

/** The fonts a slide needs, inlined: Urbanist for layouts, a designed slide's template's own. */
async function fontsFor(slide: Slide): Promise<string> {
  let families = ['Urbanist']
  if (slide.layout === 'design' && slide.design) {
    await loadDesigns([slide.design])
    const board = loadedBoard(boardOf(slide.design))
    if (board) {
      families = [...new Set(board.fonts.map((f) => f.family))]
      // Measuring the text needs the fonts in the page too.
      await fontsLoaded(board.fonts)
    }
  }
  const key = families.join('|')
  let css = fontCss.get(key)
  if (!css) {
    css = inlineFontCss(families).catch(() => '')
    fontCss.set(key, css)
  }
  return css
}

const dataUrl = (src: string, bytes: Uint8Array) => `data:${TYPES[src.slice(src.lastIndexOf('.') + 1).toLowerCase()] ?? 'application/octet-stream'};base64,${toBase64(bytes)}`

/** Draws one slide `width` pixels wide. */
export async function slideCanvas(deck: Deck, slide: Slide, media: Map<string, Uint8Array>, width: number): Promise<HTMLCanvasElement> {
  const urls = new Map<string, string>()
  const fonts = await fontsFor(slide)
  const html = slideHtml(slide, themeOf(deck.theme), {
    designs: findDesign,
    measure: measureDesignText,
    resolveSrc: (src) => {
      const bytes = media.get(src)
      if (!bytes) return null
      if (!urls.has(src)) urls.set(src, dataUrl(src, bytes))
      return urls.get(src)!
    }
  })
  // foreignObject content must be XHTML: close void elements.
  const xhtml = html.replace(/<img([^>]*?)>/g, '<img$1/>')
  return drawXhtml(xhtml, fonts, width)
}

/** Draws slide-sized XHTML onto a canvas `width` pixels wide, through an SVG foreignObject. */
async function drawXhtml(xhtml: string, fonts: string, width: number): Promise<HTMLCanvasElement> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SLIDE_W}" height="${SLIDE_H}"><style>${fonts}</style><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml">${xhtml}</div></foreignObject></svg>`
  const img = new Image()
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  await img.decode()
  const c = document.createElement('canvas')
  c.width = Math.round(width)
  c.height = Math.round((width * SLIDE_H) / SLIDE_W)
  const g = c.getContext('2d')!
  g.drawImage(img, 0, 0, c.width, c.height)
  return c
}

const png = async (c: HTMLCanvasElement): Promise<Uint8Array> => {
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'))
  if (!blob) throw new Error('couldn’t draw the slide’s art')
  return new Uint8Array(await blob.arrayBuffer())
}

/**
 * A design's art without its text, as PNG `width` pixels wide, for PDF and PowerPoint:
 * the art on the design's background, and `over` (if the design has it) on a clear one.
 */
export async function designArt(design: Design, width: number): Promise<{ art: Uint8Array; over?: Uint8Array }> {
  const board = loadedBoard(boardOf(design.id))
  const fonts = await inlineFontCss(board ? new Set(board.fonts.map((f) => f.family)) : [])
  const frame = (bg: string, html: string) => `<div style="position:relative;overflow:hidden;width:${SLIDE_W}px;height:${SLIDE_H}px;background:${bg}">${html}</div>`
  const art = await png(await drawXhtml(frame(design.bg, design.art), fonts, width))
  const over = design.over ? await png(await drawXhtml(frame('transparent', design.over), fonts, width)) : undefined
  return { art, over }
}
