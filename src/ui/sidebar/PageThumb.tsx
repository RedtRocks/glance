import { useEffect, useRef, useState } from 'preact/hooks'
import type { PdfDoc } from '../../state/documents'
import { thumbnail, thumbViewport } from '../../pdf/thumbs'
import type { PageViewport } from 'pdfjs-dist'
import { MarkupLayer } from '../markup/MarkupLayer'
import { settings, isDark } from '../../state/settings'

/** One lazily rendered page thumbnail. Renders only once scrolled into view. */
export function PageThumb({ doc, index, width }: { doc: PdfDoc; index: number; width: number }) {
  const holder = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [aspect, setAspect] = useState(1.294)
  const [vp, setVp] = useState<PageViewport | null>(null)
  const revision = doc.revision.value
  const hasMarkup = doc.markup.value.some((m) => m.page === index) || doc.redactions.value.some((r) => r.page === index)

  useEffect(() => {
    if (!visible || !hasMarkup) return
    let cancelled = false
    void thumbViewport(doc, index, width).then((v) => !cancelled && setVp(v))
    return () => {
      cancelled = true
    }
  }, [doc, visible, hasMarkup, revision, index, width])

  useEffect(() => {
    const el = holder.current
    if (!el) return
    const io = new IntersectionObserver((entries) => setVisible(entries.some((e) => e.isIntersecting)), { rootMargin: '400px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    thumbnail(doc, index, width)
      .then((src) => {
        if (cancelled || !holder.current) return
        setAspect(src.height / src.width)
        let canvas = holder.current.querySelector('canvas')
        if (!canvas) {
          canvas = document.createElement('canvas')
          holder.current.appendChild(canvas)
        }
        canvas.width = src.width
        canvas.height = src.height
        canvas.getContext('2d')!.drawImage(src, 0, 0)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [doc, visible, revision, index, width])

  const dark = settings.value.darkPdf && isDark()
  return (
    <div class="thumb-frame" style={{ width, height: Math.round(width * aspect) }}>
      <div ref={holder} class={`thumb-canvas ${dark ? 'dark-pdf' : ''}`} style={{ width, height: Math.round(width * aspect) }} />
      {hasMarkup && vp && <MarkupLayer doc={doc} index={index} vp={vp} interactive={false} />}
    </div>
  )
}
