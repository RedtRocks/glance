import { useEffect, useRef, useState } from 'preact/hooks'
import type { Doc } from '../../state/documents'
import * as ai from '../../state/ai'
import { toast } from '../../state/ui'
import { t } from '../../i18n'

interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** The page under a point: a PDF page (data-page holds its index) or the image. */
function pageAt(x: number, y: number): { el: HTMLElement; index: number | null } | null {
  for (const el of document.elementsFromPoint(x, y)) {
    const pdf = (el as HTMLElement).closest<HTMLElement>('[data-page]')
    if (pdf) return { el: pdf, index: Number(pdf.dataset.page) }
    const image = (el as HTMLElement).closest<HTMLElement>('.image-page')
    if (image) return { el: image, index: null }
  }
  return null
}

const clamp = (v: number): number => Math.min(1, Math.max(0, v))

/** Select area for Ask AI: drag a box on the document; it's attached to the next question. */
export function AreaSelect({ doc }: { doc: Doc }) {
  const layer = useRef<HTMLDivElement>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const [box, setBox] = useState<Box | null>(null)

  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') ai.selectingArea.value = false
    }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [])

  const finish = async (b: Box, origin: DOMRect): Promise<void> => {
    ai.selectingArea.value = false
    if (b.w < 6 || b.h < 6) return
    const cx = origin.left + b.x + b.w / 2
    const cy = origin.top + b.y + b.h / 2
    const page = pageAt(cx, cy)
    if (!page) return toast(t('Drag the box over a page.'))
    const r = page.el.getBoundingClientRect()
    const x0 = clamp((origin.left + b.x - r.left) / r.width)
    const y0 = clamp((origin.top + b.y - r.top) / r.height)
    const x1 = clamp((origin.left + b.x + b.w - r.left) / r.width)
    const y1 = clamp((origin.top + b.y + b.h - r.top) / r.height)
    if (x1 - x0 < 0.005 || y1 - y0 < 0.005) return toast(t('Drag the box over a page.'))
    const index = page.index ?? ('current' in doc ? doc.current.peek() : 0)
    try {
      await ai.attachArea(doc, index, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 })
    } catch (e) {
      toast(String(e), 'error')
    }
  }

  return (
    <div
      ref={layer}
      class="ai-area-layer"
      role="application"
      aria-label={t('Select an area to ask about')}
      onPointerDown={(e) => {
        const r = layer.current!.getBoundingClientRect()
        start.current = { x: e.clientX - r.left, y: e.clientY - r.top }
        setBox({ ...start.current, w: 0, h: 0 })
        layer.current!.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        const s = start.current
        if (!s) return
        const r = layer.current!.getBoundingClientRect()
        const x = e.clientX - r.left
        const y = e.clientY - r.top
        setBox({ x: Math.min(s.x, x), y: Math.min(s.y, y), w: Math.abs(x - s.x), h: Math.abs(y - s.y) })
      }}
      onPointerUp={() => {
        const b = box
        start.current = null
        // Hide the layer first so the page underneath can be found.
        if (b) {
          const origin = layer.current!.getBoundingClientRect()
          layer.current!.style.pointerEvents = 'none'
          void finish(b, origin)
        } else ai.selectingArea.value = false
      }}
    >
      <div class="ai-area-tip">{t('Drag a box around what you want to ask about. Esc cancels.')}</div>
      {box && <div class="ai-area-box" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />}
    </div>
  )
}
