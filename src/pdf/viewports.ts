/**
 * Current on-screen viewport of each rendered page, so page-independent code (text
 * selection → highlight) can convert between screen and PDF coordinates.
 */
import type { PageViewport } from 'pdfjs-dist'

const map = new Map<string, PageViewport>()
const key = (docId: string, page: number) => `${docId}:${page}`

export function setViewport(docId: string, page: number, vp: PageViewport | null): void {
  if (vp) map.set(key(docId, page), vp)
  else map.delete(key(docId, page))
}

export function getViewport(docId: string, page: number): PageViewport | undefined {
  return map.get(key(docId, page))
}
