import { useEffect, useRef, useState } from 'preact/hooks'
import type { ImageDoc } from '../../state/documents'
import { straighten } from '../../state/imageState'
import { straightenImage } from '../../state/imageActions'
import { MAX_STRAIGHTEN, straightenGeometry } from '../../core/image/transform'
import { Icon } from '../Icon'
import { t } from '../../i18n'

const clampAngle = (a: number): number => Math.max(-MAX_STRAIGHTEN, Math.min(MAX_STRAIGHTEN, Math.round(a * 10) / 10))

export function setStraightenAngle(angle: number): void {
  const st = straighten.peek()
  if (st) straighten.value = { ...st, angle: clampAngle(angle) }
}

/**
 * How the image page is drawn while straightening: turned by the pending angle and,
 * when the whole rotated image is kept, shrunk so it still fits where the image was.
 */
export function straightenPreview(w: number, h: number, angle: number, crop: boolean): { transform: string; frame: { width: number; height: number } } {
  const g = straightenGeometry(w, h, angle, crop)
  const fit = crop ? 1 : Math.min(1, w / g.width, h / g.height)
  return { transform: `rotate(${angle}deg) scale(${fit})`, frame: { width: g.width * fit, height: g.height * fit } }
}

/**
 * The result frame over the turning image: a rule-of-thirds grid (finer while
 * dragging, like Photos), everything outside it dimmed. Dragging anywhere turns the
 * image around its center.
 */
export function StraightenOverlay({ width, height }: { width: number; height: number }) {
  const frame = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const onPointerDown = (e: PointerEvent): void => {
    const st = straighten.peek()
    const el = frame.current
    if (!st || !el || e.button !== 0) return
    e.preventDefault()
    const r = el.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    const start = Math.atan2(e.clientY - cy, e.clientX - cx)
    const from = st.angle
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    setDragging(true)
    const move = (ev: PointerEvent): void => {
      let d = ((Math.atan2(ev.clientY - cy, ev.clientX - cx) - start) * 180) / Math.PI
      if (d > 180) d -= 360
      if (d < -180) d += 360
      setStraightenAngle(from + d)
    }
    const up = (): void => {
      setDragging(false)
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
      target.removeEventListener('pointercancel', up)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
    target.addEventListener('pointercancel', up)
  }
  return (
    <div class="straighten-catcher" onPointerDown={onPointerDown}>
      <div ref={frame} class={`straighten-frame${dragging ? ' fine' : ''}`} style={{ width, height }} />
    </div>
  )
}

/** Floating command bar for Straighten: slider, exact angle, crop switch, Done/Cancel. */
export function StraightenBar({ doc }: { doc: ImageDoc }) {
  const st = straighten.value
  const slider = useRef<HTMLInputElement>(null)
  useEffect(() => {
    slider.current?.focus()
    return () => void (straighten.value = null)
  }, [])
  const cancel = (): void => void (straighten.value = null)
  const done = (): void => {
    const s = straighten.peek()
    straighten.value = null
    if (s) void straightenImage(doc, s.angle, s.crop)
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        cancel()
      } else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault()
        done()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  if (!st) return null
  return (
    <div class="straighten-bar" role="toolbar" aria-label={t('Straighten')}>
      <Icon name="straighten" />
      <input
        ref={slider}
        type="range"
        min={-MAX_STRAIGHTEN}
        max={MAX_STRAIGHTEN}
        step={0.1}
        value={st.angle}
        aria-label={t('Angle')}
        title={t('Drag the slider, or drag on the image. Double-click to reset.')}
        onInput={(e) => setStraightenAngle(Number((e.target as HTMLInputElement).value))}
        onDblClick={() => setStraightenAngle(0)}
      />
      <label class="straighten-angle">
        <input
          type="number"
          min={-MAX_STRAIGHTEN}
          max={MAX_STRAIGHTEN}
          step={0.1}
          value={st.angle.toFixed(1)}
          aria-label={t('Angle in degrees')}
          onChange={(e) => setStraightenAngle(Number((e.target as HTMLInputElement).value) || 0)}
        />
        °
      </label>
      <label class="toggle-switch" title={t('Crop away the empty corners')}>
        <input type="checkbox" role="switch" checked={st.crop} onChange={(e) => (straighten.value = { ...st, crop: (e.target as HTMLInputElement).checked })} />
        {t('Crop to fill')}
      </label>
      <button class="btn" disabled={st.angle === 0} onClick={() => setStraightenAngle(0)}>
        {t('Reset')}
      </button>
      <span class="tb-sep" />
      <button class="btn" onClick={cancel}>
        {t('Cancel')}
      </button>
      <button class="btn primary" disabled={st.angle === 0} onClick={done}>
        {t('Done')}
      </button>
    </div>
  )
}
