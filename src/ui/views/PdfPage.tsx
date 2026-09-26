import { useEffect, useRef, useState } from 'preact/hooks'
import type { PDFPageProxy, RenderTask } from 'pdfjs-dist'
import type { PdfDoc } from '../../state/documents'
import { pdfjs } from '../../pdf/engine'
import { findQuery } from '../../state/ui'
import { openUrl } from '../../platform'

/** Largest backing store we allocate for one page canvas (~64 MB of RGBA). */
const MAX_PIXELS = 16_000_000

interface Props {
  doc: PdfDoc
  index: number
  scale: number
  width: number
  height: number
  root: HTMLElement | null
  dark: boolean
}

function markHits(layer: HTMLElement | null, query: string): void {
  if (!layer) return
  const q = query.trim().toLowerCase()
  for (const span of layer.querySelectorAll('span')) {
    span.classList.toggle('hit', !!q && (span.textContent ?? '').toLowerCase().includes(q))
  }
}

async function buildLinks(page: PDFPageProxy, scale: number, host: HTMLElement, doc: PdfDoc): Promise<void> {
  host.replaceChildren()
  const viewport = page.getViewport({ scale })
  const annots = await page.getAnnotations({ intent: 'display' })
  for (const a of annots) {
    if (a.subtype !== 'Link' || (!a.url && !a.dest)) continue
    const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(a.rect)
    const el = document.createElement('a')
    el.className = 'pdf-link'
    Object.assign(el.style, {
      left: `${Math.min(x1, x2)}px`,
      top: `${Math.min(y1, y2)}px`,
      width: `${Math.abs(x2 - x1)}px`,
      height: `${Math.abs(y2 - y1)}px`
    })
    if (a.url) {
      el.href = a.url
      el.title = a.url
      el.onclick = (e) => {
        e.preventDefault()
        void openUrl(a.url)
      }
    } else {
      el.href = '#'
      el.onclick = async (e) => {
        e.preventDefault()
        const proxy = doc.proxy.peek()
        if (!proxy) return
        const dest = typeof a.dest === 'string' ? await proxy.getDestination(a.dest) : a.dest
        if (!dest?.[0]) return
        const ref = dest[0]
        const idx = typeof ref === 'number' ? ref : await proxy.getPageIndex(ref)
        doc.goTo(idx)
      }
    }
    host.appendChild(el)
  }
}

export function PdfPage({ doc, index, scale, width, height, root, dark }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const linkRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [rendered, setRendered] = useState<string | null>(null)
  const revision = doc.revision.value
  const query = findQuery.value

  useEffect(() => {
    const el = box.current
    if (!el) return
    const io = new IntersectionObserver((entries) => setVisible(entries.some((e) => e.isIntersecting)), {
      root,
      rootMargin: '100% 0px'
    })
    io.observe(el)
    return () => io.disconnect()
  }, [root])

  // Render (or re-render at a new scale) while visible; free memory when far away.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!visible) {
      if (canvas && rendered) {
        canvas.width = 0
        canvas.height = 0
        textRef.current?.replaceChildren()
        setRendered(null)
      }
      return
    }
    const key = `${revision}:${scale}`
    if (rendered === key) return
    const proxy = doc.proxy.peek()
    if (!proxy || !canvas) return
    let task: RenderTask | null = null
    let textLayer: { cancel(): void } | null = null
    let cancelled = false
    ;(async () => {
      const page = await proxy.getPage(index + 1)
      if (cancelled) return
      const dpr = window.devicePixelRatio || 1
      const css = page.getViewport({ scale })
      let ratio = dpr
      if (css.width * css.height * ratio * ratio > MAX_PIXELS) ratio = Math.sqrt(MAX_PIXELS / (css.width * css.height))
      const viewport = page.getViewport({ scale: scale * ratio })
      // Draw into an offscreen canvas first so the old image stays until the new one is ready.
      const off = document.createElement('canvas')
      off.width = Math.floor(viewport.width)
      off.height = Math.floor(viewport.height)
      task = page.render({ canvas: off, viewport, annotationMode: 2 /* ENABLE_FORMS */, background: 'white' })
      await task.promise
      if (cancelled) return
      canvas.width = off.width
      canvas.height = off.height
      canvas.getContext('2d')!.drawImage(off, 0, 0)
      setRendered(key)

      const lib = await pdfjs()
      const host = textRef.current
      if (host && !cancelled) {
        host.replaceChildren()
        const tl = new lib.TextLayer({ textContentSource: page.streamTextContent(), container: host, viewport: css })
        textLayer = tl
        await tl.render().catch(() => undefined)
        markHits(host, findQuery.peek())
      }
      if (linkRef.current && !cancelled) await buildLinks(page, scale, linkRef.current, doc).catch(() => undefined)
    })().catch((e) => {
      if (e?.name !== 'RenderingCancelledException') console.warn('render failed', e)
    })
    return () => {
      cancelled = true
      task?.cancel()
      textLayer?.cancel()
    }
  }, [visible, scale, revision, index])

  useEffect(() => markHits(textRef.current, query), [query])

  return (
    <div
      ref={box}
      class="pdf-page"
      data-page={index}
      style={{ width, height, '--scale-factor': scale, '--total-scale-factor': scale } as never}
    >
      <canvas ref={canvasRef} class={dark ? 'dark-pdf' : ''} />
      <div ref={textRef} class="textLayer" />
      <div ref={linkRef} class="link-layer" />
      {!rendered && <div class="page-placeholder" aria-hidden="true" />}
    </div>
  )
}
