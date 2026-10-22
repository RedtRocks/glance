/**
 * Document pages as pictures: PNG export, glance_doc_render, and the PDF export's art.
 * The page's HTML (core/doc/html.ts) goes into an SVG foreignObject with its fonts and
 * pictures inlined, so nothing outside the SVG is loaded and the canvas stays readable.
 */
import { pageHtml } from '../core/doc/html'
import { PAGE_H, PAGE_W, type DocBoard } from '../core/doc/look'
import type { PageLayout } from '../core/doc/layout'
import { toBase64 } from '../core/mcp/helpers'
import { inlineFontCss } from '../deck/fonts'

const TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', svg: 'image/svg+xml' }

const fontCss = new Map<string, Promise<string>>()

function fontsOf(board: DocBoard | undefined): Promise<string> {
  const families = [...new Set(['Urbanist', ...(board?.fonts.map((f) => f.family) ?? [])])]
  const key = families.join('|')
  let css = fontCss.get(key)
  if (!css) {
    css = inlineFontCss(families).catch(() => '')
    fontCss.set(key, css)
  }
  return css
}

/** Draws one laid-out page `width` pixels wide. `artOnly` leaves the text out, for the PDF. */
export async function pageCanvas(page: PageLayout, board: DocBoard | undefined, media: Map<string, Uint8Array>, width: number, artOnly = false): Promise<HTMLCanvasElement> {
  const urls = new Map<string, string>()
  const html = pageHtml(page, board, {
    artOnly,
    resolveSrc: (src) => {
      const bytes = media.get(src)
      if (!bytes) return null
      if (!urls.has(src)) urls.set(src, `data:${TYPES[src.slice(src.lastIndexOf('.') + 1).toLowerCase()] ?? 'application/octet-stream'};base64,${toBase64(bytes)}`)
      return urls.get(src)!
    }
  })
  // foreignObject content must be XHTML: close void elements.
  const xhtml = html.replace(/<img([^>]*?)>/g, '<img$1/>').replace(/<br>/g, '<br/>')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_W}" height="${PAGE_H}"><style>${await fontsOf(board)}</style><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml">${xhtml}</div></foreignObject></svg>`
  const img = new Image()
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  await img.decode()
  const c = document.createElement('canvas')
  c.width = Math.round(width)
  c.height = Math.round((width * PAGE_H) / PAGE_W)
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
  return c
}

export async function canvasPng(c: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'))
  if (!blob) throw new Error('couldn’t draw the page')
  return new Uint8Array(await blob.arrayBuffer())
}
