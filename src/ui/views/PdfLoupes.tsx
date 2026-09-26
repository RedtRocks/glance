import { useEffect, useRef } from 'preact/hooks'
import type { PageViewport } from 'pdfjs-dist'
import type { Markup } from '../../core/markup'
import type { PdfDoc } from '../../state/documents'
import { cssBox } from '../markup/Shape'

type Loupe = Extract<Markup, { type: 'loupe' }>

/** One loupe's magnified view: only its region, rendered crisply at the loupe's zoom. */
function LoupeView({ doc, index, vp, m }: { doc: PdfDoc; index: number; vp: PageViewport; m: Loupe }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const box = cssBox(vp, m.rect)
  const size = { w: box.right - box.left, h: box.bottom - box.top }
  const revision = doc.revision.value
  useEffect(() => {
    const canvas = ref.current
    const proxy = doc.proxy.peek()
    if (!canvas || !proxy) return
    let task: { cancel(): void; promise: Promise<void> } | null = null
    let cancelled = false
    void (async () => {
      const page = await proxy.getPage(index + 1)
      if (cancelled) return
      const dpr = window.devicePixelRatio || 1
      const zoomed = page.getViewport({ scale: vp.scale * m.zoom * dpr, rotation: vp.rotation })
      const [cx, cy] = zoomed.convertToViewportPoint((m.rect[0] + m.rect[2]) / 2, (m.rect[1] + m.rect[3]) / 2)
      const w = Math.max(1, Math.round(size.w * dpr))
      const h = Math.max(1, Math.round(size.h * dpr))
      // Shift the page so the loupe's center lands in the middle of this small canvas.
      const shifted = page.getViewport({ scale: vp.scale * m.zoom * dpr, rotation: vp.rotation, offsetX: w / 2 - cx, offsetY: h / 2 - cy })
      canvas.width = w
      canvas.height = h
      const t = page.render({ canvas, viewport: shifted, annotationMode: 0 /* DISABLE */, background: 'white' })
      task = t
      await t.promise.catch(() => undefined)
    })()
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [doc, index, vp, m.rect.join(), m.zoom, revision])
  return <canvas ref={ref} class="pdf-loupe" style={{ left: box.left, top: box.top, width: size.w, height: size.h }} />
}

/** Magnified content under the loupe rings (the ring itself is drawn by the markup layer). */
export function PdfLoupes({ doc, index, vp }: { doc: PdfDoc; index: number; vp: PageViewport }) {
  const loupes = doc.markup.value.filter((m): m is Loupe => m.type === 'loupe' && m.page === index)
  return (
    <>
      {loupes.map((m) => (
        <LoupeView key={m.id} doc={doc} index={index} vp={vp} m={m} />
      ))}
    </>
  )
}
