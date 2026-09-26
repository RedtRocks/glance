import { signal } from '@preact/signals'
import type { PdfDoc } from '../state/documents'

export interface Hit {
  page: number
  snippet: string
}

export const hits = signal<Hit[]>([])
export const hitIndex = signal(-1)
export const searching = signal(false)

const textCache = new WeakMap<PdfDoc, { revision: number; pages: string[] }>()

async function pageTexts(doc: PdfDoc): Promise<string[]> {
  const rev = doc.revision.peek()
  const cached = textCache.get(doc)
  if (cached && cached.revision === rev) return cached.pages
  const proxy = doc.proxy.peek()
  if (!proxy) return []
  const pages: string[] = []
  for (let i = 1; i <= proxy.numPages; i++) {
    const page = await proxy.getPage(i)
    const content = await page.getTextContent()
    pages.push(content.items.map((it) => ('str' in it ? it.str + (it.hasEOL ? '\n' : '') : '')).join(''))
  }
  textCache.set(doc, { revision: rev, pages })
  return pages
}

let searchSeq = 0

/** Finds every occurrence of `query` (case-insensitive) and returns page + context. */
export async function runSearch(doc: PdfDoc, query: string): Promise<void> {
  const seq = ++searchSeq
  const q = query.trim().toLowerCase()
  if (!q) {
    hits.value = []
    hitIndex.value = -1
    return
  }
  searching.value = true
  try {
    const texts = await pageTexts(doc)
    if (seq !== searchSeq) return
    const out: Hit[] = []
    texts.forEach((text, page) => {
      const lower = text.toLowerCase()
      let from = 0
      for (;;) {
        const at = lower.indexOf(q, from)
        if (at < 0) break
        const start = Math.max(0, at - 30)
        const snippet = (start > 0 ? '…' : '') + text.slice(start, at + q.length + 30).replace(/\s+/g, ' ')
        out.push({ page, snippet })
        from = at + q.length
      }
    })
    hits.value = out
    hitIndex.value = out.length ? 0 : -1
    if (out.length) doc.goTo(out[0].page)
  } finally {
    if (seq === searchSeq) searching.value = false
  }
}

export function stepHit(doc: PdfDoc, dir: 1 | -1): void {
  const list = hits.value
  if (!list.length) return
  hitIndex.value = (hitIndex.value + dir + list.length) % list.length
  doc.goTo(list[hitIndex.value].page)
}
