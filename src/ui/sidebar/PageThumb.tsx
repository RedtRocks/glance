import { useEffect, useRef, useState } from 'preact/hooks'
import type { PdfDoc } from '../../state/documents'
import { thumbnail } from '../../pdf/thumbs'
import { settings, isDark } from '../../state/settings'

/** One lazily rendered page thumbnail. Renders only once scrolled into view. */
export function PageThumb({ doc, index, width }: { doc: PdfDoc; index: number; width: number }) {
  const holder = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [aspect, setAspect] = useState(1.294)
  const revision = doc.revision.value

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
  }, [visible, revision, index, width])

  const dark = settings.value.darkPdf && isDark()
  return <div ref={holder} class={`thumb-canvas ${dark ? 'dark-pdf' : ''}`} style={{ width, height: Math.round(width * aspect) }} />
}
