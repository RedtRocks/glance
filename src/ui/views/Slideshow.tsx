import { useEffect, useRef } from 'preact/hooks'
import { activeDoc } from '../../state/documents'
import { imageUrl, toggleFullscreen } from '../../platform'
import { slideshow } from '../../state/ui'

/** Full-screen, one page at a time. Arrows/space advance, Esc exits. */
export function Slideshow() {
  const doc = activeDoc.value
  const canvas = useRef<HTMLCanvasElement>(null)
  const page = doc && doc.kind !== 'notice' ? doc.current.value : 0

  useEffect(() => {
    void toggleFullscreen()
    const key = (e: KeyboardEvent): void => {
      if (!doc || doc.kind === 'notice') return
      const n = doc.pageCount.value
      if (e.key === 'Escape') slideshow.value = false
      else if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) doc.current.value = Math.min(n - 1, doc.current.value + 1)
      else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) doc.current.value = Math.max(0, doc.current.value - 1)
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', key, true)
    return () => {
      window.removeEventListener('keydown', key, true)
      void toggleFullscreen()
    }
  }, [])

  useEffect(() => {
    if (doc?.kind !== 'pdf' || !canvas.current) return
    let cancelled = false
    ;(async () => {
      const proxy = doc.proxy.peek()
      if (!proxy) return
      const p = await proxy.getPage(page + 1)
      const base = p.getViewport({ scale: 1 })
      const dpr = window.devicePixelRatio || 1
      const scale = Math.min(window.innerWidth / base.width, window.innerHeight / base.height)
      const vp = p.getViewport({ scale: scale * dpr })
      const c = canvas.current
      if (!c || cancelled) return
      c.width = vp.width
      c.height = vp.height
      c.style.width = `${vp.width / dpr}px`
      c.style.height = `${vp.height / dpr}px`
      await p.render({ canvas: c, viewport: vp, background: 'white' }).promise
    })()
    return () => {
      cancelled = true
    }
  }, [doc, page])

  if (!doc || doc.kind === 'notice') return null
  return (
    <div class="slideshow" onClick={() => (doc.current.value = Math.min(doc.pageCount.value - 1, doc.current.value + 1))}>
      {doc.kind === 'pdf' ? <canvas ref={canvas} /> : <img src={imageUrl(doc.probe, page)} alt="" />}
      <div class="slideshow-hint">{page + 1} / {doc.pageCount.value} · Esc to exit</div>
    </div>
  )
}
