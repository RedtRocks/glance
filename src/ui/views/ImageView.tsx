import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { ImageDoc } from '../../state/documents'
import { stepZoom } from '../../state/commands'
import { imageUrl } from '../../platform'

export function ImageView({ doc }: { doc: ImageDoc }) {
  const box = useRef<HTMLDivElement>(null)
  const [view, setView] = useState({ w: 0, h: 0 })
  const [error, setError] = useState<string | null>(null)
  const natural = doc.natural.value
  const rotation = doc.rotation.value
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

  const turned = rotation % 180 !== 0
  const nw = natural ? (turned ? natural.height : natural.width) : 0
  const nh = natural ? (turned ? natural.width : natural.height) : 0
  const fit = nw && view.w ? Math.min(1, (view.w - 32) / nw, (view.h - 32) / nh) : 1
  const scale = zoom === 'fit' ? fit : zoom

  useEffect(() => {
    doc.effectiveScale.value = scale
  }, [scale])

  // Drag to pan when the image is larger than the window.
  const onPointerDown = (e: PointerEvent): void => {
    const el = box.current
    if (!el || e.button !== 0) return
    const sx = e.clientX
    const sy = e.clientY
    const { scrollLeft, scrollTop } = el
    el.setPointerCapture(e.pointerId)
    el.classList.add('panning')
    const move = (ev: PointerEvent): void => {
      el.scrollLeft = scrollLeft - (ev.clientX - sx)
      el.scrollTop = scrollTop - (ev.clientY - sy)
    }
    const up = (): void => {
      el.classList.remove('panning')
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  const w = natural ? natural.width * scale : 0
  const h = natural ? natural.height * scale : 0
  const boxW = turned ? h : w
  const boxH = turned ? w : h

  return (
    <div class="image-view-wrap">
      {doc.notice && <div class="info-bar">{doc.notice}</div>}
      <div
        class="image-view"
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
            <h2>Glance couldn’t display this image</h2>
            <p>{error}</p>
          </div>
        ) : (
          <div class="image-stage" style={{ width: Math.max(boxW, view.w), height: Math.max(boxH, view.h) }}>
            <img
              src={src}
              alt={doc.name.value}
              draggable={false}
              class="checkerboard"
              style={{
                width: w || undefined,
                height: h || undefined,
                transform: `rotate(${rotation}deg)`,
                imageRendering: scale >= 3 ? 'pixelated' : 'auto'
              }}
              onLoad={(e) => {
                const img = e.currentTarget as HTMLImageElement
                doc.natural.value = { width: img.naturalWidth, height: img.naturalHeight }
                setError(null)
              }}
              onError={async () => {
                const res = await fetch(src).catch(() => null)
                setError(res && !res.ok ? await res.text() : 'The file may be damaged or use an unsupported variant of its format.')
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
