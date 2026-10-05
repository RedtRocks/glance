import { useEffect, useRef, useState } from 'preact/hooks'
import type { PreviewDoc } from '../../state/documents'
import type { PreviewRendering } from '../../preview/render'
import * as platform from '../../platform'
import { t } from '../../i18n'
import { openFiles } from '../../state/actions'
import { useTouchZoom } from '../touchGestures'

/** Office files, text, Markdown, media, books, fonts and email, previewed read-only (preview/render.ts, loaded on demand). */
export function PreviewView({ doc }: { doc: PreviewDoc }) {
  const scroller = useRef<HTMLDivElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const rendering = useRef<PreviewRendering | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | string>('loading')
  /** Set while the view itself moves the current page, so scrolling doesn't fight it. */
  const following = useRef(-1)
  /** The zoom the file opened at, which a double-tap returns to. */
  const startZoom = useRef(1)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const { renderPreview } = await import('../../preview/render')
        if (cancelled || !host.current || !scroller.current) return
        const r = await renderPreview(doc.flavor, doc.probe, host.current, {
          scroller: scroller.current,
          onCurrent: (i) => {
            following.current = i
            doc.current.value = i
          },
          openLink: (href) => void platform.openUrl(href),
          openAttachment: (name, bytes) => void platform.writeTemp(name, bytes).then((path) => openFiles([path]))
        })
        if (cancelled) return r.dispose()
        rendering.current = r
        doc.pageCount.value = r.pageCount
        doc.sheetNames.value = r.sheetNames
        // A Word page wider than the window (a phone) starts zoomed to fit its width.
        const page = host.current.querySelector<HTMLElement>('section.docx')
        if (page && page.offsetWidth > scroller.current.clientWidth - 32) doc.zoom.value = Math.max(0.25, (scroller.current.clientWidth - 32) / page.offsetWidth)
        r.setZoom(doc.zoom.peek())
        startZoom.current = doc.zoom.peek()
        setState('ready')
      } catch (e) {
        console.error(e)
        if (!cancelled) setState(String((e as Error).message ?? e))
      }
    })()
    return () => {
      cancelled = true
      rendering.current?.dispose()
      rendering.current = null
    }
  }, [doc])

  const zoom = doc.zoom.value
  useTouchZoom(
    scroller,
    {
      content: () => host.current,
      scale: () => doc.zoom.peek(),
      zoom: (s) => (doc.zoom.value = s),
      min: 0.25,
      max: 5,
      doubleTap: (s) => (s <= startZoom.current * 1.01 ? s * 2 : null),
      fit: () => (doc.zoom.value = startZoom.current)
    },
    [doc]
  )
  useEffect(() => rendering.current?.setZoom(zoom), [zoom])

  // Go menu, page counter and sheet tabs move the view; scrolling moves them back.
  const current = doc.current.value
  useEffect(() => {
    if (following.current === current) return
    following.current = current
    rendering.current?.goTo(current)
  }, [current])

  return (
    <div class={`office-view office-view-${doc.flavor}`}>
      {/* Links open in the browser, never inside Glance (preview/render.ts keeps only web and mail links). */}
      <div
        class="office-scroller"
        ref={scroller}
        onClick={(e) => {
          const a = (e.target as HTMLElement).closest('a')
          const href = a?.getAttribute('href')
          if (!a || !href) return
          e.preventDefault()
          // A spot in the same file (a book's table of contents) scrolls there.
          if (href.startsWith('#')) host.current?.querySelector(`[id="${CSS.escape(decodeURIComponent(href.slice(1)))}"]`)?.scrollIntoView({ block: 'start' })
          else void platform.openUrl(href)
        }}
      >
        <div ref={host} class="office-host" />
      </div>
      {doc.flavor === 'sheets' && doc.sheetNames.value.length > 1 && (
        <div class="sheet-tabs" role="tablist" aria-label={t('Sheets')}>
          {doc.sheetNames.value.map((name, i) => (
            <button key={name} role="tab" aria-selected={i === current} onClick={() => (doc.current.value = i)}>
              {name}
            </button>
          ))}
        </div>
      )}
      {state === 'loading' && (
        <div class="office-status">
          <div class="spinner" />
          <p>{t('Opening…')}</p>
        </div>
      )}
      {state !== 'loading' && state !== 'ready' && (
        <div class="office-status">
          <h2>{t('Glance can’t show this file')}</h2>
          <p>{t('It may be damaged, or use features the preview doesn’t support yet: {error}', { error: state })}</p>
        </div>
      )}
    </div>
  )
}
