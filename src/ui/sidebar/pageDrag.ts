/**
 * Pointer-driven page dragging shared by the sidebar and the contact sheet:
 * - within a list: reorder
 * - onto another tab: copy there (Shift = move)
 * - out of the window: Drag Out creates a PDF wherever it is dropped
 */
import { activeId, docs, PdfDoc } from '../../state/documents'
import { dragOutPages, movePages, transferPages } from '../../state/actions'
import { toast } from '../../state/ui'
import { dropTabId, pageDrag } from '../dragState'

const THRESHOLD = 5

/** Finds the insertion index from pointer position over a `[data-page-list]` element. */
function insertionAt(x: number, y: number): { docId: string; at: number } | null {
  const el = document.elementFromPoint(x, y)
  const list = el?.closest<HTMLElement>('[data-page-list]')
  if (!list) return null
  const docId = list.dataset.pageList!
  const items = [...list.querySelectorAll<HTMLElement>('[data-page-index]')]
  if (!items.length) return { docId, at: 0 }
  const grid = list.dataset.layout === 'grid'
  for (const item of items) {
    const r = item.getBoundingClientRect()
    const before = grid ? y < r.bottom && (y < r.top || x < r.left + r.width / 2) : y < r.top + r.height / 2
    if (before) return { docId, at: Number(item.dataset.pageIndex) }
  }
  return { docId, at: Number(items.at(-1)!.dataset.pageIndex) + 1 }
}

export function beginPageDrag(e: PointerEvent, doc: PdfDoc, pages: number[], icon: () => HTMLCanvasElement | null): void {
  if (e.button !== 0) return
  const startX = e.clientX
  const startY = e.clientY
  const target = e.currentTarget as HTMLElement
  let dragging = false
  let draggedOut = false
  let ghost: HTMLElement | null = null

  const move = (ev: PointerEvent): void => {
    if (!dragging) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < THRESHOLD) return
      dragging = true
      target.setPointerCapture(e.pointerId)
      ghost = document.createElement('div')
      ghost.className = 'drag-ghost'
      ghost.textContent = pages.length > 1 ? `${pages.length} pages` : `Page ${pages[0] + 1}`
      document.body.appendChild(ghost)
      pageDrag.value = { docId: doc.id, pages, targetDocId: null, insertAt: null }
    }
    ghost!.style.transform = `translate(${ev.clientX + 12}px, ${ev.clientY + 12}px)`

    // Leaving the window hands the drag to the OS (Drag Out).
    const outside = ev.clientX < 0 || ev.clientY < 0 || ev.clientX > window.innerWidth || ev.clientY > window.innerHeight
    if (outside && !draggedOut) {
      draggedOut = true
      cleanup()
      void dragOutPages(doc, pages, icon()).catch((err) => toast(`Drag failed: ${err}`, 'error'))
      return
    }

    const tab = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('[data-tab-id]')
    const tabId = tab?.dataset.tabId ?? null
    dropTabId.value = tabId && tabId !== doc.id ? tabId : null
    const ins = insertionAt(ev.clientX, ev.clientY)
    pageDrag.value = { docId: doc.id, pages, targetDocId: ins?.docId ?? null, insertAt: ins?.at ?? null }
  }

  const up = (ev: PointerEvent): void => {
    const state = pageDrag.peek()
    const tabId = dropTabId.peek()
    cleanup()
    if (!dragging || draggedOut || !state) return
    const move = ev.shiftKey
    if (tabId) {
      const dst = docs.peek().find((d) => d.id === tabId)
      if (dst instanceof PdfDoc) {
        void transferPages(doc, pages, dst, dst.pageCount.peek(), move).then(() => (activeId.value = dst.id))
      } else {
        toast('Pages can only be dropped onto PDF documents.')
      }
      return
    }
    if (state.targetDocId === doc.id && state.insertAt !== null) {
      void movePages(doc, pages, state.insertAt)
    } else if (state.targetDocId && state.insertAt !== null) {
      const dst = docs.peek().find((d) => d.id === state.targetDocId)
      if (dst instanceof PdfDoc) void transferPages(doc, pages, dst, state.insertAt, move)
    }
  }

  function cleanup(): void {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', cleanup)
    ghost?.remove()
    ghost = null
    pageDrag.value = null
    dropTabId.value = null
  }

  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', cleanup)
}

/** Selection semantics shared by page lists: click, Ctrl+click toggle, Shift+click range. */
export function selectPage(doc: { selection: { value: number[] }; current: { value: number } }, index: number, e: MouseEvent): void {
  const sel = doc.selection.value
  if (e.ctrlKey || e.metaKey) {
    doc.selection.value = sel.includes(index) ? sel.filter((i) => i !== index) : [...sel, index]
  } else if (e.shiftKey && sel.length) {
    const anchor = sel[sel.length - 1]
    const [a, b] = anchor < index ? [anchor, index] : [index, anchor]
    doc.selection.value = [...new Set([...sel, ...Array.from({ length: b - a + 1 }, (_, k) => a + k)])]
  } else {
    doc.selection.value = [index]
  }
}
