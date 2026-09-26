import { useEffect } from 'preact/hooks'
import { onFileDrop } from '../platform'
import { docs, PdfDoc } from '../state/documents'
import { insertFiles, openFiles } from '../state/actions'
import { fileDragOver, pageDrag } from './dragState'

/**
 * Files dropped from Explorer, the desktop, or another Glance window (Drag Out):
 * - onto a PDF's page list: inserted at that position (merging)
 * - anywhere else: opened in new tabs
 */
export function useFileDrop(): void {
  useEffect(() => {
    let dispose: (() => void) | undefined
    void onFileDrop((e) => {
      if (e.type === 'leave') {
        fileDragOver.value = false
        pageDrag.value = null
        return
      }
      const el = document.elementFromPoint(e.x, e.y)
      const list = el?.closest<HTMLElement>('[data-page-list]')
      if (e.type === 'enter' || e.type === 'over') {
        fileDragOver.value = true
        if (list) {
          const items = [...list.querySelectorAll<HTMLElement>('[data-page-index]')]
          const hit = items.find((it) => {
            const r = it.getBoundingClientRect()
            return e.y < r.top + r.height / 2
          })
          const at = hit ? Number(hit.dataset.pageIndex) : items.length
          pageDrag.value = { docId: '__files', pages: [], targetDocId: list.dataset.pageList!, insertAt: at }
        } else if (pageDrag.peek()?.docId === '__files') {
          pageDrag.value = null
        }
        return
      }
      // drop
      fileDragOver.value = false
      const target = pageDrag.peek()
      pageDrag.value = null
      if (!e.paths.length) return
      if (list && target?.targetDocId) {
        const doc = docs.peek().find((d) => d.id === target.targetDocId)
        if (doc instanceof PdfDoc) {
          void insertFiles(doc, e.paths, target.insertAt ?? doc.pageCount.peek())
          return
        }
      }
      void openFiles(e.paths)
    }).then((d) => (dispose = d))
    return () => dispose?.()
  }, [])
}
