import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { ImageDoc } from '../../state/documents'
import { stepZoom } from '../../state/commands'
import { imageUrl } from '../../platform'
import { tool } from '../../state/markupState'
import { MarkupLayer } from '../markup/MarkupLayer'
import { imageViewport } from '../../image/viewport'
import { SelectionOverlay } from '../image/SelectionOverlay'
import { InfoBar } from '../InfoBar'
import { t } from '../../i18n'
import { dragPan, usePanZoom } from '../usePanZoom'

/** Draws the magnified content of loupe markup (the ring itself is SVG in the markup layer). */
function LoupeLayer({ doc, source, scale }: { doc: ImageDoc; source: HTMLCanvasElement | HTMLImageElement | null; scale: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const nat = doc.natural.value
  const loupes = doc.markup.value.filter((m): m is Extract<typeof m, { type: 'loupe' }> => m.type === 'loupe')
  useEffect(() => {
    // Child effects run before the parent paints new pixels into `source`; wait a frame.
    const frame = requestAnimationFrame(() => draw())
    return () => cancelAnimationFrame(frame)
  }, [loupes, source, scale, nat, doc.raster.value, doc.preview.value])
  const draw = (): void => {
    const c = ref.current
    if (!c || !nat || !source) return
    const dpr = window.devicePixelRatio || 1
    c.width = Math.round(nat.width * scale * dpr)
    c.height = Math.round(nat.height * scale * dpr)
    const g = c.getContext('2d')!
    g.clearRect(0, 0, c.width, c.height)
    g.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0)
    for (const m of loupes) {
      const [x1, y1, x2, y2] = m.rect
      const cx = (x1 + x2) / 2
      const cy = nat.height - (y1 + y2) / 2
      const r = (x2 - x1) / 2
      const src = r / m.zoom
      g.save()
      g.beginPath()
      g.arc(cx, cy, r, 0, Math.PI * 2)
      g.clip()
      const sx = source instanceof HTMLCanvasElement ? source.width / nat.width : 1
      g.drawImage(source, (cx - src) * sx, (cy - src) * sx, src * 2 * sx, src * 2 * sx, cx - r, cy - r, r * 2, r * 2)
      g.restore()
    }
  }
  if (!loupes.length || !nat) return null
  return <canvas ref={ref} class="loupe-layer" style={{ width: nat.width * scale, height: nat.height * scale }} />
}

export function ImageView({ doc }: { doc: ImageDoc }) {
  const box = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const img = useRef<HTMLImageElement>(null)
  const [view, setView] = useState({ w: 0, h: 0 })
  const [error, setError] = useState<string | null>(null)
  const natural = doc.natural.value
  const raster = doc.preview.value ?? doc.raster.value
  const rotation = doc.raster.value ? 0 : doc.rotation.value
  const zoom = doc.zoom.value
  const page = doc.current.value
  const src = useMemo(() => imageUrl(doc.probe, page), [doc.probe, page])

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setView({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Edited images render from their pixels.
  useEffect(() => {
    const c = canvas.current
    if (!c || !raster) return
    c.width = raster.width
    c.height = raster.height
    c.getContext('2d')!.putImageData(new ImageData(raster.data as unknown as Uint8ClampedArray<ArrayBuffer>, raster.width, raster.height), 0, 0)
  }, [raster])

  const turned = rotation % 180 !== 0
  const nw = natural ? (turned ? natural.height : natural.width) : 0
  const nh = natural ? (turned ? natural.width : natural.height) : 0
  const fit = nw && view.w ? Math.min(1, (view.w - 48) / nw, (view.h - 48) / nh) : 1
  const scale = zoom === 'fit' ? fit : zoom

  useEffect(() => {
    doc.effectiveScale.value = scale
  }, [scale])

  // Drag to pan (Select tool only; drawing tools own the pointer).
  const onPointerDown = (e: PointerEvent): void => {
    const el = box.current
    if (!el || e.button !== 0 || tool.peek() !== 'select' || e.defaultPrevented) return
    if ((e.target as HTMLElement).closest('.text-box.editing, .note-editor')) return
    dragPan(el, e)
  }
  const panZoom = usePanZoom(box, doc)

  const w = natural ? natural.width * scale : 0
  const h = natural ? natural.height * scale : 0
  const boxW = turned ? h : w
  const boxH = turned ? w : h
  const vp = useMemo(() => (natural ? imageViewport(natural.width, natural.height, scale) : null), [natural?.width, natural?.height, scale])

  return (
    <div class="image-view-wrap">
      {doc.notice && <InfoBar title={t('Preview only')}>{doc.notice}</InfoBar>}
      <div
        class={`image-view ${panZoom}`}
        ref={box}
        onPointerDown={onPointerDown}
        onWheel={(e) => {
          if (!e.ctrlKey) return
          e.preventDefault()
          doc.zoom.value = stepZoom(scale, e.deltaY < 0 ? 1 : -1)
        }}
      >
        {error ? (
          <div class="notice">
            <h2>{t('Glance couldn’t display this image')}</h2>
            <p>{error}</p>
          </div>
        ) : (
          <div class="image-stage" style={{ width: Math.max(boxW + 48, view.w), height: Math.max(boxH + 48, view.h) }}>
            <div class="image-page checkerboard" style={{ width: w || undefined, height: h || undefined, transform: `rotate(${rotation}deg)` }}>
              {raster ? (
                <canvas ref={canvas} class="image-pixels" style={{ width: w, height: h, imageRendering: scale >= 3 ? 'pixelated' : 'auto' }} />
              ) : (
                <img
                  ref={img}
                  src={src}
                  alt={doc.name.value}
                  draggable={false}
                  style={{ width: w || undefined, height: h || undefined, imageRendering: scale >= 3 ? 'pixelated' : 'auto' }}
                  onLoad={(e) => {
                    const el = e.currentTarget as HTMLImageElement
                    if (!doc.raster.peek()) doc.natural.value = { width: el.naturalWidth, height: el.naturalHeight }
                    setError(null)
                  }}
                  onError={async () => {
                    const res = await fetch(src).catch(() => null)
                    setError(res && !res.ok ? await res.text() : t('The file may be damaged or use an unsupported variant of its format.'))
                  }}
                />
              )}
              {vp && <LoupeLayer doc={doc} source={raster ? canvas.current : img.current} scale={scale} />}
              {vp && doc.editable && <MarkupLayer doc={doc} index={0} vp={vp} />}
              {doc.editable && <SelectionOverlay doc={doc} scale={scale} />}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
