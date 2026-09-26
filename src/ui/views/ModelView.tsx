import { useEffect, useRef, useState } from 'preact/hooks'
import type { ModelDoc } from '../../state/documents'
import type { Backdrop, CameraView, Lighting, Look, ModelStats, ModelViewer } from '../../model/viewer'
import { isDark } from '../../state/settings'
import { toast } from '../../state/ui'
import * as platform from '../../platform'
import { Icon } from '../Icon'
import { Popover } from '../markup/Popover'

/** A file next to the model, referenced by name (textures, .bin buffers, .mtl materials). */
function sibling(modelPath: string, relative: string): string {
  if (!platform.isTauri) return relative
  const dir = platform.dirName(modelPath)
  const sep = dir.includes('\\') ? '\\' : '/'
  return platform.schemeUrl('file', { path: `${dir}${sep}${relative.replace(/^\.\//, '').replace(/[\\/]/g, sep)}` })
}

const LIGHTING: [Lighting, string][] = [
  ['studio', 'Studio'],
  ['soft', 'Soft'],
  ['sunlight', 'Sunlight'],
  ['dramatic', 'Dramatic'],
  ['flat', 'Flat']
]
const BACKDROPS: [Backdrop, string][] = [
  ['theme', 'Default'],
  ['white', 'White'],
  ['black', 'Black'],
  ['gradient', 'Gradient'],
  ['room', 'Studio room']
]
const LOOKS: [Look, string][] = [
  ['original', 'Original'],
  ['clay', 'Clay'],
  ['normals', 'Normals'],
  ['xray', 'X-ray']
]
const VIEWS: [CameraView, string][] = [
  ['front', 'Front'],
  ['back', 'Back'],
  ['left', 'Left'],
  ['right', 'Right'],
  ['top', 'Top'],
  ['bottom', 'Bottom'],
  ['home', 'Three-quarter']
]

/** A labeled row of choices in the Effects flyout. */
function Choices<T extends string>({ label, options, value, onPick }: { label: string; options: [T, string][]; value: T; onPick: (v: T) => void }) {
  return (
    <div class="effect-group" role="radiogroup" aria-label={label}>
      <span class="flyout-label">{label}</span>
      <div class="effect-chips">
        {options.map(([v, text]) => (
          <button key={v} class={`effect-chip ${value === v ? 'pressed' : ''}`} role="radio" aria-checked={value === v} onClick={() => onPick(v)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  )
}

function fmt(n: number): string {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)} M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)} K` : String(n)
}

function resetEffects(doc: ModelDoc): void {
  doc.lighting.value = 'studio'
  doc.backdrop.value = 'theme'
  doc.look.value = 'original'
  doc.shadow.value = false
  doc.grid.value = false
}

/** Orbit (drag), pan (right-drag or Shift+drag), zoom (wheel); floating controls like Preview's 3D view. */
export function ModelView({ doc }: { doc: ModelDoc }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const viewer = useRef<ModelViewer | null>(null)
  const [stats, setStats] = useState<ModelStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const dark = isDark()

  useEffect(() => {
    let alive = true
    let v: ModelViewer | null = null
    const c = canvas.current!
    const ro = new ResizeObserver(() => v?.resize())
    ro.observe(c)
    void (async () => {
      try {
        const bytes = await platform.readFile(doc.probe.path)
        const { createViewer } = await import('../../model/viewer')
        const created = await createViewer(c, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, doc.name.peek(), {
          resolve: (rel) => sibling(doc.probe.path, rel),
          dark
        })
        if (!alive) return created.dispose()
        v = created
        viewer.current = created
        setStats(created.stats)
        created.setWireframe(doc.wireframe.peek())
        created.setAutoRotate(doc.autoRotate.peek())
        created.setLighting(doc.lighting.peek())
        created.setBackdrop(doc.backdrop.peek())
        created.setLook(doc.look.peek())
        created.setShadow(doc.shadow.peek())
        created.setGrid(doc.grid.peek())
      } catch (e) {
        if (alive) setError((e as Error).message || String(e))
      }
    })()
    return () => {
      alive = false
      ro.disconnect()
      v?.dispose()
      viewer.current = null
    }
  }, [doc])

  useEffect(() => viewer.current?.setWireframe(doc.wireframe.value), [doc.wireframe.value])
  useEffect(() => viewer.current?.setAutoRotate(doc.autoRotate.value), [doc.autoRotate.value])
  useEffect(() => viewer.current?.setLighting(doc.lighting.value), [doc.lighting.value])
  useEffect(() => viewer.current?.setBackdrop(doc.backdrop.value), [doc.backdrop.value])
  useEffect(() => viewer.current?.setLook(doc.look.value), [doc.look.value])
  useEffect(() => viewer.current?.setShadow(doc.shadow.value), [doc.shadow.value])
  useEffect(() => viewer.current?.setGrid(doc.grid.value), [doc.grid.value])
  useEffect(() => viewer.current?.setDark(dark), [dark])

  // Commands (zoom, reset, export snapshot) arrive as requests.
  const effectsOn = doc.lighting.value !== 'studio' || doc.backdrop.value !== 'theme' || doc.look.value !== 'original' || doc.shadow.value || doc.grid.value

  const req = doc.viewRequest.value
  useEffect(() => {
    const v = viewer.current
    if (!req || !v) return
    doc.viewRequest.value = null
    if (req.kind === 'reset') v.resetView()
    else if (req.kind === 'view') v.setView(req.view)
    else if (req.kind === 'zoom') canvas.current?.dispatchEvent(new WheelEvent('wheel', { deltaY: req.dir > 0 ? -240 : 240, bubbles: true, cancelable: true }))
    else if (req.kind === 'snapshot') void snapshot()
  }, [req])

  const snapshot = async (): Promise<void> => {
    const v = viewer.current
    if (!v) return
    const base = doc.name.peek().replace(/\.[^.]+$/, '')
    const target = await platform.saveDialog(`${base}.png`, [{ name: 'PNG image', extensions: ['png'] }])
    if (!target) return
    await platform.writeFile(target, new Uint8Array(await (await v.snapshot()).arrayBuffer()))
    toast('Snapshot saved')
  }

  return (
    <div class="model-view">
      <canvas ref={canvas} class="model-canvas" aria-label={`3D view of ${doc.name.value}`} />
      {error ? (
        <div class="notice model-error">
          <h2>Glance can’t show this model</h2>
          <p>{error}</p>
        </div>
      ) : (
        !stats && <div class="model-loading muted">Loading model…</div>
      )}
      {stats && (
        <div class="model-controls" role="toolbar" aria-label="3D view">
          <button class="tb-button" title="Reset view (Ctrl+9)" aria-label="Reset view" onClick={() => viewer.current?.resetView()}>
            <Icon name="zoomFit" />
          </button>
          <button class={`tb-button ${doc.wireframe.value ? 'pressed' : ''}`} title="Wireframe (W)" aria-label="Wireframe" aria-pressed={doc.wireframe.value} onClick={() => (doc.wireframe.value = !doc.wireframe.value)}>
            <Icon name="grid" />
          </button>
          <button class={`tb-button ${doc.autoRotate.value ? 'pressed' : ''}`} title="Turntable (T)" aria-label="Turntable" aria-pressed={doc.autoRotate.value} onClick={() => (doc.autoRotate.value = !doc.autoRotate.value)}>
            <Icon name="rotateRight" />
          </button>
          <Popover icon="cube" label="Camera views">
            {(close) => (
              <div class="flyout-col">
                {VIEWS.map(([view, label]) => (
                  <button
                    key={view}
                    class="menu-item"
                    onClick={() => {
                      viewer.current?.setView(view)
                      close()
                    }}
                  >
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            )}
          </Popover>
          <Popover icon="sparkle" label="Effects" pressed={effectsOn}>
            {() => (
              <div class="effects">
                <Choices label="Lighting" options={LIGHTING} value={doc.lighting.value} onPick={(v) => (doc.lighting.value = v)} />
                <Choices label="Background" options={BACKDROPS} value={doc.backdrop.value} onPick={(v) => (doc.backdrop.value = v)} />
                <Choices label="Material" options={LOOKS} value={doc.look.value} onPick={(v) => (doc.look.value = v)} />
                <div class="effect-toggles">
                  <label>
                    <input type="checkbox" checked={doc.shadow.value} onChange={(e) => (doc.shadow.value = (e.target as HTMLInputElement).checked)} /> Ground shadow
                  </label>
                  <label>
                    <input type="checkbox" checked={doc.grid.value} onChange={(e) => (doc.grid.value = (e.target as HTMLInputElement).checked)} /> Floor grid
                  </label>
                </div>
                <button class="btn effect-reset" disabled={!effectsOn} onClick={() => resetEffects(doc)}>
                  Reset effects
                </button>
              </div>
            )}
          </Popover>
          <button class="tb-button" title="Save snapshot (Ctrl+E)" aria-label="Save snapshot" onClick={() => void snapshot()}>
            <Icon name="exportIcon" />
          </button>
          <span class="model-stats muted">
            {fmt(stats.triangles)} {stats.triangles === 1 ? 'triangle' : 'triangles'} · {stats.meshes} {stats.meshes === 1 ? 'mesh' : 'meshes'}
            {stats.animations ? ` · ${stats.animations} animation${stats.animations === 1 ? '' : 's'}` : ''}
          </span>
        </div>
      )}
    </div>
  )
}
