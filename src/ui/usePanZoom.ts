import { useEffect } from 'preact/hooks'
import type { ImageDoc, PdfDoc } from '../state/documents'
import { stepZoom } from '../state/commands'
import { spaceHeld, tool } from '../state/markupState'

/** Drags the view's scroll position with the pointer, like a hand on paper. */
export function dragPan(el: HTMLElement, e: PointerEvent): void {
  const sx = e.clientX
  const sy = e.clientY
  const { scrollLeft, scrollTop } = el
  el.classList.add('panning')
  const move = (ev: PointerEvent): void => {
    el.scrollLeft = scrollLeft - (ev.clientX - sx)
    el.scrollTop = scrollTop - (ev.clientY - sy)
  }
  const up = (): void => {
    el.classList.remove('panning')
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', up)
}

/** One zoom step in or out, keeping the clicked point under the pointer. */
function zoomAt(el: HTMLElement, doc: PdfDoc | ImageDoc, e: PointerEvent, dir: 1 | -1): void {
  const old = doc.effectiveScale.peek()
  const next = stepZoom(old, dir)
  if (next === old) return
  const r = el.getBoundingClientRect()
  const x = e.clientX - r.left
  const y = e.clientY - r.top
  const px = el.scrollLeft + x
  const py = el.scrollTop + y
  doc.zoom.value = next
  // Wait for the new layout (and the PDF view's own scroll anchoring) before moving.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      el.scrollLeft = (px * next) / old - x
      el.scrollTop = (py * next) / old - y
    })
  )
}

/**
 * The Hand tool (H, or Space held with any tool) and the Zoom tool (Z; Alt+click
 * zooms out) for a scrolling document view. Returns the class that sets the cursor.
 */
export function usePanZoom(ref: { current: HTMLElement | null }, doc: PdfDoc | ImageDoc): string {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    // Capture phase, so drawing tools and text selection underneath never see the press.
    const onDown = (e: PointerEvent): void => {
      if (e.button !== 0) return
      const t = tool.peek()
      if (!spaceHeld.peek() && t !== 'hand' && t !== 'zoom') return
      e.preventDefault()
      e.stopPropagation()
      // A finger already pans natively; the Hand tool only needs to stop drawing.
      if (spaceHeld.peek() || t === 'hand') {
        if (e.pointerType !== 'touch') dragPan(el, e)
      }
      else zoomAt(el, doc, e, e.altKey ? -1 : 1)
    }
    el.addEventListener('pointerdown', onDown, true)
    return () => el.removeEventListener('pointerdown', onDown, true)
  }, [doc])
  if (spaceHeld.value || tool.value === 'hand') return 'view-hand'
  return tool.value === 'zoom' ? 'view-zoom' : ''
}
