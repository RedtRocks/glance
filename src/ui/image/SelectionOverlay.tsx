import { useEffect, useRef, useState } from 'preact/hooks'
import type { ImageDoc } from '../../state/documents'
import { imageSelection } from '../../state/imageState'
import { tool, IMAGE_SELECT_TOOLS } from '../../state/markupState'
import * as engine from '../../image/engine'
import { maskBounds } from '../../core/image/alpha'
import type { Pt } from '../../core/image/select'
import type { Raster } from '../../core/image/raster'
import { toast } from '../../state/ui'

let hinted = false

/** Rectangle, ellipse, lasso, smart lasso and Instant Alpha, drawn over the image. */
export function SelectionOverlay({ doc, scale }: { doc: ImageDoc; scale: number }) {
  const host = useRef<HTMLDivElement>(null)
  const maskCanvas = useRef<HTMLCanvasElement>(null)
  const sel = imageSelection.value
  const t = tool.value
  const active = IMAGE_SELECT_TOOLS.includes(t)
  const nat = doc.natural.value
  const [draft, setDraft] = useState<Pt[] | null>(null)
  const preview = useRef<{ raster: Raster; scale: number } | null>(null)

  const toImage = (e: PointerEvent): Pt => {
    const r = host.current!.getBoundingClientRect()
    return [(e.clientX - r.left) / scale, (e.clientY - r.top) / scale]
  }

  // Tinted overlay for mask selections (Instant Alpha, inverted selections).
  const drawMask = (mask: Uint8Array | null, w: number, h: number): void => {
    const c = maskCanvas.current
    if (!c) return
    c.width = w
    c.height = h
    const g = c.getContext('2d')!
    g.clearRect(0, 0, w, h)
    if (!mask) return
    const img = g.createImageData(w, h)
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue
      img.data[i * 4] = 0
      img.data[i * 4 + 1] = 120
      img.data[i * 4 + 2] = 215
      img.data[i * 4 + 3] = Math.round(mask[i] * 0.45)
    }
    g.putImageData(img, 0, 0)
  }

  useEffect(() => {
    if (sel?.kind === 'mask') drawMask(sel.mask, sel.width, sel.height)
    else drawMask(null, 1, 1)
  }, [sel])

  const onPointerDown = async (e: PointerEvent): Promise<void> => {
    if (!active || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const start = toImage(e)
    imageSelection.value = null

    if (t === 'instantAlpha') {
      const full = await engine.ensureRaster(doc)
      preview.current ??= await engine.previewCopy(full, 1200)
      const pv = preview.current
      let tolerance = 0.08
      let busy = false
      const run = async (): Promise<void> => {
        if (busy) return
        busy = true
        const mask = await engine.flood(pv.raster, start[0] * pv.scale, start[1] * pv.scale, tolerance)
        drawMask(mask, pv.raster.width, pv.raster.height)
        busy = false
      }
      void run()
      const move = (ev: PointerEvent): void => {
        const p = toImage(ev)
        // Dragging farther widens the color range, like Preview.
        tolerance = Math.min(0.9, 0.04 + Math.hypot(p[0] - start[0], p[1] - start[1]) * scale / 250)
        void run()
      }
      const up = async (): Promise<void> => {
        el.removeEventListener('pointermove', move)
        el.removeEventListener('pointerup', up)
        const mask = await engine.flood(full, start[0], start[1], tolerance)
        const bounds = maskBounds(mask, full.width, full.height) ?? { x: 0, y: 0, width: 0, height: 0 }
        imageSelection.value = { kind: 'mask', mask, width: full.width, height: full.height, bounds }
        if (!hinted) {
          hinted = true
          toast('Press Delete to remove the selected area, or Crop to keep it.')
        }
      }
      el.addEventListener('pointermove', move)
      el.addEventListener('pointerup', up)
      return
    }

    const points: Pt[] = [start]
    const move = (ev: PointerEvent): void => {
      const p = toImage(ev)
      if (t === 'lasso' || t === 'smartLasso') points.push(p)
      else points[1] = p
      setDraft([...points])
    }
    const up = (): void => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      setDraft(null)
      if (points.length < 2) return
      if (t === 'selectRect' || t === 'selectEllipse') {
        const [a, b] = points
        const x = Math.max(0, Math.min(a[0], b[0]))
        const y = Math.max(0, Math.min(a[1], b[1]))
        const w = Math.abs(b[0] - a[0])
        const h = Math.abs(b[1] - a[1])
        if (w < 2 || h < 2) return
        imageSelection.value = { kind: t === 'selectRect' ? 'rect' : 'ellipse', x, y, width: w, height: h }
      } else if (points.length > 3) {
        imageSelection.value = t === 'smartLasso' ? { kind: 'smart', points, band: Math.max(4, 14 / scale) } : { kind: 'lasso', points }
      }
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  useEffect(() => {
    preview.current = null
  }, [doc.raster.value])

  if (!nat) return null
  const shape = draft ?? null
  const outline = (): preact.JSX.Element | null => {
    const s = sel
    const pts = shape
    if (pts && (t === 'selectRect' || t === 'selectEllipse') && pts[1]) {
      const [a, b] = pts
      const x = Math.min(a[0], b[0]) * scale
      const y = Math.min(a[1], b[1]) * scale
      const w = Math.abs(b[0] - a[0]) * scale
      const h = Math.abs(b[1] - a[1]) * scale
      return t === 'selectRect' ? <rect x={x} y={y} width={w} height={h} /> : <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} />
    }
    if (pts && (t === 'lasso' || t === 'smartLasso')) return <polyline points={pts.map((p) => `${p[0] * scale},${p[1] * scale}`).join(' ')} />
    if (!s || s.kind === 'mask') return null
    if (s.kind === 'rect') return <rect x={s.x * scale} y={s.y * scale} width={s.width * scale} height={s.height * scale} />
    if (s.kind === 'ellipse') return <ellipse cx={(s.x + s.width / 2) * scale} cy={(s.y + s.height / 2) * scale} rx={(s.width / 2) * scale} ry={(s.height / 2) * scale} />
    return <polygon points={s.points.map((p) => `${p[0] * scale},${p[1] * scale}`).join(' ')} />
  }
  return (
    <div
      ref={host}
      class={`selection-overlay ${active ? 'active' : ''}`}
      style={{ width: nat.width * scale, height: nat.height * scale }}
      onPointerDown={(e) => void onPointerDown(e)}
    >
      <canvas ref={maskCanvas} class="selection-mask" />
      <svg class="marching-ants" width={nat.width * scale} height={nat.height * scale}>
        <g class="ants-back">{outline()}</g>
        <g class="ants-front">{outline()}</g>
      </svg>
    </div>
  )
}
