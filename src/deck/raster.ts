/**
 * Slides as pictures: for AI apps to look at their work (glance_deck_render), PNG export
 * and anything else that needs pixels. The slide's HTML (core/deck/html.ts) goes into an
 * SVG foreignObject with the font and pictures inlined, so nothing outside the SVG is
 * loaded and the canvas it is drawn on stays readable.
 */
import fontUrl from '../styles/fonts/urbanist.woff2?url'
import { slideHtml } from '../core/deck/html'
import { SLIDE_H, SLIDE_W } from '../core/deck/layout'
import type { Deck, Slide } from '../core/deck/model'
import { themeOf } from '../core/deck/themes'
import { toBase64 } from '../core/mcp/helpers'

const TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', svg: 'image/svg+xml' }

let fontCss: Promise<string> | null = null

function loadFont(): Promise<string> {
  fontCss ??= fetch(fontUrl)
    .then((r) => r.arrayBuffer())
    .then((b) => `@font-face{font-family:Urbanist;src:url(data:font/woff2;base64,${toBase64(new Uint8Array(b))}) format('woff2');font-weight:100 900}`)
    .catch(() => '')
  return fontCss
}

const dataUrl = (src: string, bytes: Uint8Array) => `data:${TYPES[src.slice(src.lastIndexOf('.') + 1).toLowerCase()] ?? 'application/octet-stream'};base64,${toBase64(bytes)}`

/** Draws one slide `width` pixels wide. */
export async function slideCanvas(deck: Deck, slide: Slide, media: Map<string, Uint8Array>, width: number): Promise<HTMLCanvasElement> {
  const urls = new Map<string, string>()
  const html = slideHtml(slide, themeOf(deck.theme), {
    resolveSrc: (src) => {
      const bytes = media.get(src)
      if (!bytes) return null
      if (!urls.has(src)) urls.set(src, dataUrl(src, bytes))
      return urls.get(src)!
    }
  })
  // foreignObject content must be XHTML: close void elements.
  const xhtml = html.replace(/<img([^>]*?)>/g, '<img$1/>')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SLIDE_W}" height="${SLIDE_H}"><style>${await loadFont()}</style><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml">${xhtml}</div></foreignObject></svg>`
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
