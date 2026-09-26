import { useEffect, useRef, useState } from 'preact/hooks'
import { DEFAULT_ADJUST, autoLevels, histogram, isIdentity, type AdjustParams, type Histogram } from '../../core/image/adjust'
import type { ImageDoc } from '../../state/documents'
import { adjustColorOpen } from '../../state/imageState'
import { applyColorAdjustments } from '../../state/imageActions'
import * as engine from '../../image/engine'
import type { Raster } from '../../core/image/raster'
import { Icon } from '../Icon'

interface SliderDef {
  key: keyof AdjustParams
  label: string
  min: number
  max: number
  step: number
}

const SLIDERS: SliderDef[] = [
  { key: 'exposure', label: 'Exposure', min: -3, max: 3, step: 0.05 },
  { key: 'contrast', label: 'Contrast', min: -1, max: 1, step: 0.01 },
  { key: 'highlights', label: 'Highlights', min: -1, max: 1, step: 0.01 },
  { key: 'shadows', label: 'Shadows', min: -1, max: 1, step: 0.01 },
  { key: 'saturation', label: 'Saturation', min: -1, max: 1, step: 0.01 },
  { key: 'temperature', label: 'Temperature', min: -1, max: 1, step: 0.01 },
  { key: 'tint', label: 'Tint', min: -1, max: 1, step: 0.01 },
  { key: 'sepia', label: 'Sepia', min: 0, max: 1, step: 0.01 },
  { key: 'gamma', label: 'Gamma', min: 0.2, max: 3, step: 0.01 },
  { key: 'definition', label: 'Definition', min: -1, max: 1, step: 0.01 },
  { key: 'sharpness', label: 'Sharpness', min: 0, max: 1, step: 0.01 }
]

function HistogramView({ h, params, onLevels }: { h: Histogram | null; params: AdjustParams; onLevels: (p: Partial<AdjustParams>) => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c || !h) return
    const g = c.getContext('2d')!
    g.clearRect(0, 0, c.width, c.height)
    const max = Math.max(1, ...[h.r, h.g, h.b].map((a) => Math.max(...Array.from(a).slice(2, 254))))
    g.globalCompositeOperation = 'screen'
    for (const [arr, color] of [[h.r, '#e5484d'], [h.g, '#30a46c'], [h.b, '#3e63dd']] as const) {
      g.fillStyle = color
      g.beginPath()
      g.moveTo(0, c.height)
      for (let i = 0; i < 256; i++) g.lineTo((i / 255) * c.width, c.height - Math.min(1, arr[i] / max) * c.height)
      g.lineTo(c.width, c.height)
      g.fill()
    }
  }, [h])
  return (
    <div class="histogram">
      <canvas ref={ref} width={256} height={80} />
      <div class="levels" role="group" aria-label="Levels">
        <input type="range" min={0} max={254} value={params.black} aria-label="Black point" onInput={(e) => onLevels({ black: Math.min(Number((e.target as HTMLInputElement).value), params.white - 1) })} />
        <input type="range" min={0.2} max={5} step={0.01} value={params.gamma} aria-label="Midtones" style={{ direction: 'rtl' }} onInput={(e) => onLevels({ gamma: Number((e.target as HTMLInputElement).value) })} />
        <input type="range" min={1} max={255} value={params.white} aria-label="White point" onInput={(e) => onLevels({ white: Math.max(Number((e.target as HTMLInputElement).value), params.black + 1) })} />
      </div>
    </div>
  )
}

/** Preview's Adjust Color, as a docked Windows side pane with a live preview. */
export function AdjustColorPanel({ doc }: { doc: ImageDoc }) {
  const [params, setParams] = useState<AdjustParams>({ ...DEFAULT_ADJUST })
  const [hist, setHist] = useState<Histogram | null>(null)
  const base = useRef<Raster | null>(null)
  const running = useRef(false)
  const queued = useRef<AdjustParams | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      const full = await engine.ensureRaster(doc)
      const { raster } = await engine.previewCopy(full, 1600)
      if (!alive) return
      base.current = raster
      setHist(histogram(raster, 4))
    })()
    return () => {
      alive = false
      doc.preview.value = null
    }
  }, [])

  // Live preview on a screen-sized copy; coalesce rapid slider moves.
  const render = async (p: AdjustParams): Promise<void> => {
    if (!base.current) return
    if (running.current) {
      queued.current = p
      return
    }
    running.current = true
    const out = isIdentity(p) ? null : await engine.adjust(base.current, p)
    doc.preview.value = out
    setHist(histogram(out ?? base.current, 4))
    running.current = false
    if (queued.current) {
      const next = queued.current
      queued.current = null
      void render(next)
    }
  }

  const update = (patch: Partial<AdjustParams>): void => {
    const next = { ...params, ...patch }
    setParams(next)
    void render(next)
  }

  const close = (): void => {
    doc.preview.value = null
    adjustColorOpen.value = false
  }

  return (
    <aside class="side-pane" aria-label="Adjust Color">
      <header class="side-pane-header">
        <h2>Adjust color</h2>
        <button class="icon-button" aria-label="Close" onClick={close}>
          <Icon name="close" size={16} />
        </button>
      </header>
      <div class="side-pane-body">
        <HistogramView h={hist} params={params} onLevels={update} />
        {SLIDERS.map((s) => (
          <label class="slider-row" key={s.key}>
            <span class="slider-label">
              {s.label}
              <span class="slider-value">{params[s.key] === DEFAULT_ADJUST[s.key] ? '' : params[s.key] > 0 && s.min < 0 ? `+${params[s.key].toFixed(2)}` : params[s.key].toFixed(2)}</span>
            </span>
            <input
              type="range"
              min={s.min}
              max={s.max}
              step={s.step}
              value={params[s.key]}
              onInput={(e) => update({ [s.key]: Number((e.target as HTMLInputElement).value) })}
              onDblClick={() => update({ [s.key]: DEFAULT_ADJUST[s.key] })}
            />
          </label>
        ))}
        <div class="side-pane-actions">
          <button class="btn" onClick={() => base.current && update(autoLevels(histogram(base.current, 2)))}>Auto Levels</button>
          <button class="btn" onClick={() => update({ ...DEFAULT_ADJUST })}>Reset All</button>
        </div>
      </div>
      <footer class="side-pane-footer">
        <button class="btn" onClick={close}>Cancel</button>
        <button
          class="btn primary"
          disabled={isIdentity(params)}
          onClick={async () => {
            const p = params
            close()
            await applyColorAdjustments(doc, p)
          }}
        >
          Apply
        </button>
      </footer>
    </aside>
  )
}
