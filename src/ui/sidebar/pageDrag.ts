/**
 * Pointer-driven page dragging shared by the sidebar and the contact sheet:
 * - within a list: reorder
 * - onto another tab: copy there (Shift = move). Hovering a tab briefly switches to it
 *   (spring-loaded, like Explorer), so pages can be dropped at an exact spot in its
 *   sidebar or page view.
 * - well outside the window: Drag Out creates a PDF wherever it is dropped
 */
import { activeId, docs, PdfDoc } from '../../state/documents'
import { deletePages, dragOutPages, duplicatePages, exportSelectedPages, movePages, rotatePages, sendPagesTo, splitDocument, transferPages } from '../../state/actions'
import { contextMenu, toast } from '../../state/ui'
import { dropTabId, pageDrag } from '../dragState'
import { t } from '../../i18n'

const THRESHOLD = 5
/** How far past the window edge the pointer must go before the drag leaves Glance. */
const OUT_MARGIN = 32
/** Hover time on a tab before it opens under the drag. */
const SPRING_MS = 600

/** Finds the insertion index from pointer position over a `[data-page-list]` element. */
function insertionAt(x: number, y: number, sourceId: string): { docId: string; at: number } | null {
  const el = document.elementFromPoint(x, y)
  const list = el?.closest<HTMLElement>('[data-page-list]')
  if (!list) {
    // Over the page view: before or after the page under the pointer.
    // (Only for other documents; reordering stays in the sidebar, where it is visible.)
    const view = el?.closest<HTMLElement>('[data-page-drop]')
    if (!view || view.dataset.pageDrop === sourceId) return null
    const page = el?.closest<HTMLElement>('[data-page]')
    const docId = view.dataset.pageDrop!
    if (!page) return { docId, at: Number(view.dataset.pageCount ?? 0) }
    const r = page.getBoundingClientRect()
    return { docId, at: Number(page.dataset.page) + (y > r.top + r.height / 2 ? 1 : 0) }
  }
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
  let spring: { tabId: string; timer: number } | null = null
  const single = pages.length === 1
  const vars = { count: pages.length, page: pages[0] + 1 }
  const what = single ? t('Page {page}', vars) : t('{count, plural, one {# page} other {# pages}}', vars)

  const move = (ev: PointerEvent): void => {
    if (!dragging) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < THRESHOLD) return
      dragging = true
      target.setPointerCapture(e.pointerId)
      ghost = document.createElement('div')
      ghost.className = 'drag-ghost'
      ghost.textContent = what
      document.body.appendChild(ghost)
      pageDrag.value = { docId: doc.id, pages, targetDocId: null, insertAt: null }
    }
    ghost!.style.transform = `translate(${ev.clientX + 12}px, ${ev.clientY + 12}px)`

    // Leaving the window hands the drag to the OS (Drag Out).
    const m = OUT_MARGIN
    const outside = ev.clientX < -m || ev.clientY < -m || ev.clientX > window.innerWidth + m || ev.clientY > window.innerHeight + m
    if (outside && !draggedOut) {
      draggedOut = true
      cleanup()
      void dragOutPages(doc, pages, icon()).catch((err) => toast(t('Drag failed: {error}', { error: String(err) }), 'error'))
      return
    }

    const tab = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('[data-tab-id]')
    const tabId = tab?.dataset.tabId ?? null
    dropTabId.value = tabId && tabId !== doc.id ? tabId : null
    springTab(tabId)
    const ins = insertionAt(ev.clientX, ev.clientY, doc.id)
    pageDrag.value = { docId: doc.id, pages, targetDocId: ins?.docId ?? null, insertAt: ins?.at ?? null }
    ghost!.textContent = hint(ins?.docId ?? dropTabId.peek(), ev.shiftKey)
  }

  /** Tells the user what releasing here will do. */
  function hint(targetId: string | null, shift: boolean): string {
    if (!targetId || targetId === doc.id) return what
    const dst = docs.peek().find((d) => d.id === targetId)
    if (!(dst instanceof PdfDoc)) return single ? t('Page {page} — can’t drop here', vars) : t('{count, plural, one {# page} other {# pages}} — can’t drop here', vars)
    const to = { ...vars, name: dst.name.peek() }
    if (shift) return single ? t('Move page {page} to “{name}”', to) : t('Move {count, plural, one {# page} other {# pages}} to “{name}”', to)
    return single ? t('Copy page {page} to “{name}” (Shift to move)', to) : t('Copy {count, plural, one {# page} other {# pages}} to “{name}” (Shift to move)', to)
  }

  function springTab(tabId: string | null): void {
    if (spring?.tabId === tabId) return
    if (spring) clearTimeout(spring.timer)
    spring = null
    if (!tabId || tabId === activeId.peek()) return
    spring = {
      tabId,
      timer: window.setTimeout(() => {
        activeId.value = tabId
        dropTabId.value = null
      }, SPRING_MS)
    }
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
        toast(t('Pages can only be dropped onto PDF documents.'))
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
    if (spring) clearTimeout(spring.timer)
    spring = null
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

/** Right-click on a page thumbnail: page commands, including copying to other open PDFs. */
export function pageContextMenu(e: MouseEvent, doc: PdfDoc, index: number): void {
  e.preventDefault()
  if (!doc.selection.peek().includes(index)) doc.selection.value = [index]
  const n = doc.selection.peek().length
  const others = docs.peek().filter((d): d is PdfDoc => d instanceof PdfDoc && d !== doc)
  const target = (move: boolean) => others.map((d) => ({ label: d.name.peek(), run: () => sendPagesTo(d, move, doc) }))
  const count = { count: n }
  contextMenu.value = {
    x: e.clientX,
    y: e.clientY,
    items: [
      { label: t('{count, plural, one {Copy Page To} other {Copy # Pages To}}', count), items: target(false), disabled: !others.length },
      { label: t('{count, plural, one {Move Page To} other {Move # Pages To}}', count), items: target(true), disabled: !others.length },
      '-',
      { label: t('{count, plural, one {Duplicate Page} other {Duplicate # Pages}}', count), run: () => duplicatePages(doc) },
      { label: t('Rotate Left'), run: () => rotatePages(-90, doc) },
      { label: t('Rotate Right'), run: () => rotatePages(90, doc) },
      '-',
      { label: t('{count, plural, one {Export Page…} other {Export # Pages…}}', count), run: () => exportSelectedPages(doc) },
      { label: t('Split PDF…'), run: () => splitDocument(doc), disabled: doc.pageCount.peek() < 2 },
      '-',
      { label: t('{count, plural, one {Delete Page} other {Delete # Pages}}', count), run: () => deletePages(doc) }
    ]
  }
}
