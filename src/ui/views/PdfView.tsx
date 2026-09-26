import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { PdfDoc } from '../../state/documents'
import { wheelZoom } from '../gestures'
import { isDark, settings } from '../../state/settings'
import { PdfPage } from './PdfPage'
import { ContactSheet } from './ContactSheet'
import { markSelection } from '../markup/textSelection'
import { tool } from '../../state/markupState'
import { pageDrag } from '../dragState'

const PAD = 24
const GAP = 16

interface Size {
  w: number
  h: number
}

/** Loads every page's size (at scale 1, rotation applied) in the background. */
function usePageSizes(doc: PdfDoc): Size[] {
  const revision = doc.revision.value
  const [sizes, setSizes] = useState<Size[]>([])
  useEffect(() => {
    const proxy = doc.proxy.peek()
    if (!proxy) return
    let cancelled = false
    ;(async () => {
      const first = (await proxy.getPage(1)).getViewport({ scale: 1 })
      const list: Size[] = Array.from({ length: proxy.numPages }, () => ({ w: first.width, h: first.height }))
      if (!cancelled) setSizes([...list])
      for (let i = 2; i <= proxy.numPages && !cancelled; i++) {
        const v = (await proxy.getPage(i)).getViewport({ scale: 1 })
        list[i - 1] = { w: v.width, h: v.height }
        if (i % 50 === 0 || i === proxy.numPages) setSizes([...list])
      }
    })().catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [revision])
  return sizes
}

function useElementSize(ref: { current: HTMLElement | null }): Size {
  const [size, setSize] = useState<Size>({ w: 0, h: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return size
}

export function PdfView({ doc }: { doc: PdfDoc }) {
  if (doc.contactSheet.value) return <ContactSheet doc={doc} />
  return <PdfScroller doc={doc} />
}

function PdfScroller({ doc }: { doc: PdfDoc }) {
  const scroller = useRef<HTMLDivElement>(null)
  const viewport = useElementSize(scroller)
  const sizes = usePageSizes(doc)
  const mode = doc.viewMode.value
  const zoom = doc.zoom.value
  const current = doc.current.value
  const cols = mode === 'two' ? 2 : 1

  const rows = useMemo(() => {
    const out: number[][] = []
    for (let i = 0; i < sizes.length; i += cols) out.push(sizes.slice(i, i + cols).map((_, k) => i + k))
    return out
  }, [sizes.length, cols])

  const scale = useMemo(() => {
    if (typeof zoom === 'number') return zoom
    if (!sizes.length || !viewport.w) return 1
    const rowW = Math.max(...rows.map((r) => r.reduce((s, i) => s + sizes[i].w, 0) + GAP * (r.length - 1)))
    const rowH = Math.max(...sizes.map((s) => s.h))
    const fitW = (viewport.w - PAD * 2) / rowW
    if (zoom === 'fit-width') return Math.max(0.1, fitW)
    return Math.max(0.1, Math.min(fitW, (viewport.h - PAD * 2) / rowH))
  }, [zoom, sizes, viewport.w, viewport.h, rows])

  useEffect(() => {
    doc.effectiveScale.value = scale
  }, [scale])

  const shownRows = mode === 'single' ? rows.filter((r) => r.includes(current)) : rows

  // Keep the reader's place while zooming: remember the page and offset at the top.
  const anchor = useRef<{ page: number; frac: number }>({ page: 0, frac: 0 })
  const onScroll = (): void => {
    const el = scroller.current
    if (!el || mode === 'single') return
    const pages = el.querySelectorAll<HTMLElement>('[data-page]')
    const probe = el.scrollTop + el.clientHeight * 0.35
    let top: HTMLElement | null = null
    for (const p of pages) {
      if (p.offsetTop + p.offsetHeight > el.scrollTop) {
        top ??= p
      }
      if (p.offsetTop <= probe) doc.current.value = Number(p.dataset.page)
    }
    if (top) anchor.current = { page: Number(top.dataset.page), frac: (el.scrollTop - top.offsetTop) / top.offsetHeight }
  }

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el || mode === 'single') return
    const target = el.querySelector<HTMLElement>(`[data-page="${anchor.current.page}"]`)
    if (target) el.scrollTop = target.offsetTop + anchor.current.frac * target.offsetHeight
  }, [scale, mode])

  // Explicit navigation (page controls, sidebar, search, shortcuts).
  const jump = doc.jump.value
  useLayoutEffect(() => {
    if (!jump) return
    const el = scroller.current
    const target = el?.querySelector<HTMLElement>(`[data-page="${jump.page}"]`)
    if (el && target) {
      el.scrollTop = target.offsetTop - PAD
      anchor.current = { page: jump.page, frac: 0 }
    }
  }, [jump?.seq, rows.length])

  const onWheel = (e: WheelEvent): void => {
    // Ctrl+wheel, or a touchpad pinch (which arrives as one).
    if (e.ctrlKey) {
      e.preventDefault()
      // Several pinch events can land before a render: build on the latest zoom.
      const z = doc.zoom.peek()
      doc.zoom.value = wheelZoom(typeof z === 'number' ? z : scale, e)
      return
    }
    // Single-page mode: scrolling past the edge turns the page.
    const el = scroller.current
    if (mode === 'single' && el) {
      const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 2
      const atStart = el.scrollTop <= 0
      if (e.deltaY > 0 && atEnd && current < doc.pageCount.value - 1) doc.goTo(current + 1)
      else if (e.deltaY < 0 && atStart && current > 0) doc.goTo(current - 1)
    }
  }

  const dark = settings.value.darkPdf && isDark()

  // With a text-markup tool active, releasing a text selection marks it.
  const onPointerUp = (): void => {
    const t = tool.peek()
    if ((t === 'highlight' || t === 'underline' || t === 'strike' || t === 'squiggly' || t === 'redact') && scroller.current) {
      markSelection(doc, scroller.current, t)
    }
  }

  const drag = pageDrag.value
  const drop = drag && drag.docId !== doc.id && drag.targetDocId === doc.id ? drag.insertAt : null
  return (
    <div
      class={`pdf-scroller tool-${tool.value} ${drop ? 'page-drop' : ''}`}
      data-page-drop={doc.id}
      data-page-count={doc.pageCount.value}
      ref={scroller} onScroll={onScroll} onWheel={onWheel} onPointerUp={onPointerUp} tabIndex={-1}>
      <div class="pdf-pages" style={{ padding: PAD, gap: GAP }}>
        {shownRows.map((row) => (
          <div class="pdf-row" key={row[0]} style={{ gap: GAP }}>
            {row.map((i) => (
              <PdfPage
                key={i}
                doc={doc}
                index={i}
                scale={scale}
                width={Math.round(sizes[i].w * scale)}
                height={Math.round(sizes[i].h * scale)}
                root={scroller.current}
                dark={dark}
                drop={drop === i ? 'before' : drop === i + 1 && i === doc.pageCount.value - 1 ? 'after' : undefined}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
