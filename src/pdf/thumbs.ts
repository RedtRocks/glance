/**
 * Page thumbnails, rendered through a small queue so a 500-page PDF never floods the
 * PDF.js worker, and cached per document revision.
 */
import type { PdfDoc } from '../state/documents'

type Job = () => Promise<void>
const queue: Job[] = []
let active = 0
const MAX_CONCURRENT = 2

function pump(): void {
  while (active < MAX_CONCURRENT && queue.length) {
    const job = queue.shift()!
    active++
    void job().finally(() => {
      active--
      pump()
    })
  }
}

const cache = new Map<string, Promise<HTMLCanvasElement>>()

function key(doc: PdfDoc, page: number, width: number): string {
  return `${doc.id}:${doc.revision.peek()}:${page}:${width}`
}

/** Drops cached thumbnails from older revisions of a document. */
export function pruneThumbs(doc: PdfDoc): void {
  const prefix = `${doc.id}:`
  const current = `${doc.id}:${doc.revision.peek()}:`
  for (const k of cache.keys()) if (k.startsWith(prefix) && !k.startsWith(current)) cache.delete(k)
}

/** Renders page `index` (0-based) at a CSS width, returning a device-pixel canvas. */
export function thumbnail(doc: PdfDoc, index: number, cssWidth: number): Promise<HTMLCanvasElement> {
  const k = key(doc, index, cssWidth)
  const hit = cache.get(k)
  if (hit) return hit
  const proxy = doc.proxy.peek()
  const promise = new Promise<HTMLCanvasElement>((resolve, reject) => {
    queue.push(async () => {
      try {
        if (!proxy) throw new Error('document closed')
        const page = await proxy.getPage(index + 1)
        const base = page.getViewport({ scale: 1 })
        const scale = (cssWidth * (window.devicePixelRatio || 1)) / base.width
        const viewport = page.getViewport({ scale })
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(viewport.width))
        canvas.height = Math.max(1, Math.round(viewport.height))
        await page.render({ canvas, viewport, background: 'white' }).promise
        resolve(canvas)
      } catch (e) {
        cache.delete(k)
        reject(e)
      }
    })
    pump()
  })
  cache.set(k, promise)
  return promise
}
