import { useEffect, useRef, useState } from 'preact/hooks'
import type { ImageDoc } from '../../state/documents'
import { imageSelection } from '../../state/imageState'
import { tool, IMAGE_SELECT_TOOLS } from '../../state/markupState'
import * as engine from '../../image/engine'
import { InstantAlphaGesture, alphaMode } from '../../image/instantAlpha'
import type { Pt } from '../../core/image/select'
import type { Raster } from '../../core/image/raster'
import { toast } from '../../state/ui'
import { t } from '../../i18n'

let hinted = false

/** Rectangle, ellipse, lasso, smart lasso and Instant Alpha, drawn over the image. */
export function SelectionOverlay({ doc, scale }: { doc: ImageDoc; scale: number }) {
  const host = useRef<HTMLDivElement>(null)
  const maskCanvas = useRef<HTMLCanvasElement>(null)
  const sel = imageSelection.value
  const cur = tool.value
  const active = IMAGE_SELECT_TOOLS.includes(cur)
  const nat = doc.natural.value
  const [draft, setDraft] = useState<Pt[] | null>(null)
  const preview = useRef<{ raster: Raster; scale: number } | null>(null)
  const gesture = useRef<InstantAlphaGesture | null>(null)

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

  const drawSelection = (): void => {
    const s = imageSelection.peek()
    if (s?.kind === 'mask') drawMask(s.mask, s.width, s.height)
    else drawMask(null, 1, 1)
  }

  useEffect(drawSelection, [sel])

  // Switching tools or documents (or unmounting) abandons a drag in progress.
  useEffect(() => () => gesture.current?.cancel(), [cur, doc])

  const onPointerDown = (e: PointerEvent): void => {
    if (!active || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const start = toImage(e)
    // Shift-drag adds to the selection and Alt-drag subtracts from it, like Preview.
    const mode = cur === 'instantAlpha' ? alphaMode(e) : 'replace'
    const base = mode === 'replace' ? null : imageSelection.peek()
    if (mode === 'replace') imageSelection.value = null

    if (cur === 'instantAlpha') {
      gesture.current?.cancel()
      // Listeners go on before anything async, so a quick click can't lose its pointerup.
      const g = new InstantAlphaGesture(start, {
        prepare: async () => {
          const full = await engine.ensureRaster(doc)
          preview.current ??= await engine.previewCopy(full, 1200)
          let baseMask: Uint8Array | null = null
          if (base?.kind === 'mask') baseMask = base.width === full.width && base.height === full.height ? base.mask : null
          else if (base) baseMask = await engine.selectionToMask(full, base)
          return { full, preview: preview.current, base: baseMask }
        },
        flood: engine.flood,
        show: (mask, w, h) => (mask ? drawMask(mask, w, h) : drawSelection()),
        commit: (selection) => {
          imageSelection.value = selection
          if (!selection) return
          if (!hinted) {
            hinted = true
            toast(t('Press Delete to remove the selected area, or Crop to keep it. Hold Shift to add more, or Alt to take some away.'))
          }
        }
      }, mode)
      gesture.current = g
      const move = (ev: PointerEvent): void => {
        const p = toImage(ev)
        g.move(Math.hypot(p[0] - start[0], p[1] - start[1]) * scale)
      }
      const detach = (): void => {
        el.removeEventListener('pointermove', move)
        el.removeEventListener('pointerup', up)
        el.removeEventListener('pointercancel', cancel)
        window.removeEventListener('keydown', key, true)
      }
      const up = (): void => {
        detach()
        void g.end()
      }
      const cancel = (): void => {
        detach()
        g.cancel()
      }
      // Escape mid-drag cancels this drag only (capture phase, ahead of the global shortcuts).
      const key = (ev: KeyboardEvent): void => {
        if (ev.key !== 'Escape') return
        ev.preventDefault()
        ev.stopPropagation()
        cancel()
      }
      el.addEventListener('pointermove', move)
      el.addEventListener('pointerup', up)
      el.addEventListener('pointercancel', cancel)
      window.addEventListener('keydown', key, true)
      return
    }

    const points: Pt[] = [start]
    const move = (ev: PointerEvent): void => {
      const p = toImage(ev)
      if (cur === 'lasso' || cur === 'smartLasso') points.push(p)
      else points[1] = p
      setDraft([...points])
    }
    const up = (): void => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      setDraft(null)
      if (points.length < 2) return
      if (cur === 'selectRect' || cur === 'selectEllipse') {
        const [a, b] = points
        const x = Math.max(0, Math.min(a[0], b[0]))
        const y = Math.max(0, Math.min(a[1], b[1]))
        const w = Math.abs(b[0] - a[0])
        const h = Math.abs(b[1] - a[1])
        if (w < 2 || h < 2) return
        imageSelection.value = { kind: cur === 'selectRect' ? 'rect' : 'ellipse', x, y, width: w, height: h }
      } else if (points.length > 3) {
        imageSelection.value = cur === 'smartLasso' ? { kind: 'smart', points, band: Math.max(4, 14 / scale) } : { kind: 'lasso', points }
      }
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  const pixels = doc.raster.value
  useEffect(() => {
    preview.current = null
    // Undo/redo can swap in pixels of another size; a mask for the old size would misalign.
    const s = imageSelection.peek()
    if (pixels && s?.kind === 'mask' && (s.width !== pixels.width || s.height !== pixels.height)) imageSelection.value = null
  }, [pixels])

  if (!nat) return null
  const shape = draft ?? null
  const outline = (): preact.JSX.Element | null => {
    const s = sel
    const pts = shape
    if (pts && (cur === 'selectRect' || cur === 'selectEllipse') && pts[1]) {
      const [a, b] = pts
      const x = Math.min(a[0], b[0]) * scale
      const y = Math.min(a[1], b[1]) * scale
      const w = Math.abs(b[0] - a[0]) * scale
      const h = Math.abs(b[1] - a[1]) * scale
      return cur === 'selectRect' ? <rect x={x} y={y} width={w} height={h} /> : <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} />
    }
    if (pts && (cur === 'lasso' || cur === 'smartLasso')) return <polyline points={pts.map((p) => `${p[0] * scale},${p[1] * scale}`).join(' ')} />
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
      onPointerDown={onPointerDown}
    >
      <canvas ref={maskCanvas} class="selection-mask" />
      <svg class="marching-ants" width={nat.width * scale} height={nat.height * scale}>
        <g class="ants-back">{outline()}</g>
        <g class="ants-front">{outline()}</g>
      </svg>
    </div>
  )
}
