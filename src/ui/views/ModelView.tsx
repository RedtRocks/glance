import { useEffect, useRef, useState } from 'preact/hooks'
import type { ModelDoc } from '../../state/documents'
import type { ModelStats, ModelViewer } from '../../model/viewer'
import { isDark } from '../../state/settings'
import { toast } from '../../state/ui'
import * as platform from '../../platform'
import { Icon } from '../Icon'
import { intlLocale, t } from '../../i18n'

/** A file next to the model, referenced by name (textures, .bin buffers, .mtl materials). */
function sibling(modelPath: string, relative: string): string {
  if (!platform.isTauri) return relative
  const dir = platform.dirName(modelPath)
  const sep = dir.includes('\\') ? '\\' : '/'
  return platform.schemeUrl('file', { path: `${dir}${sep}${relative.replace(/^\.\//, '').replace(/[\\/]/g, sep)}` })
}

function fmt(n: number): string {
  return new Intl.NumberFormat(intlLocale.value, { notation: 'compact', maximumFractionDigits: 1 }).format(n)
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
  useEffect(() => viewer.current?.setDark(dark), [dark])

  // Commands (zoom, reset, export snapshot) arrive as requests.
  const req = doc.viewRequest.value
  useEffect(() => {
    const v = viewer.current
    if (!req || !v) return
    doc.viewRequest.value = null
    if (req.kind === 'reset') v.resetView()
    else if (req.kind === 'zoom') canvas.current?.dispatchEvent(new WheelEvent('wheel', { deltaY: req.dir > 0 ? -240 : 240, bubbles: true, cancelable: true }))
    else if (req.kind === 'snapshot') void snapshot()
  }, [req])

  const snapshot = async (): Promise<void> => {
    const v = viewer.current
    if (!v) return
    const base = doc.name.peek().replace(/\.[^.]+$/, '')
    const target = await platform.saveDialog(`${base}.png`, [{ name: t('PNG image'), extensions: ['png'] }])
    if (!target) return
    await platform.writeFile(target, new Uint8Array(await (await v.snapshot()).arrayBuffer()))
    toast(t('Snapshot saved'))
  }

  return (
    <div class="model-view">
      <canvas ref={canvas} class="model-canvas" aria-label={t('3D view of {name}', { name: doc.name.value })} />
      {error ? (
        <div class="notice model-error">
          <h2>{t('Glance can’t show this model')}</h2>
          <p>{error}</p>
        </div>
      ) : (
        !stats && <div class="model-loading muted">{t('Loading model…')}</div>
      )}
      {stats && (
        <div class="model-controls" role="toolbar" aria-label={t('3D view')}>
          <button class="tb-button" title={t('Reset view (Ctrl+9)')} aria-label={t('Reset view')} onClick={() => viewer.current?.resetView()}>
            <Icon name="zoomFit" />
          </button>
          <button class={`tb-button ${doc.wireframe.value ? 'pressed' : ''}`} title={t('Wireframe (W)')} aria-label={t('Wireframe')} aria-pressed={doc.wireframe.value} onClick={() => (doc.wireframe.value = !doc.wireframe.value)}>
            <Icon name="grid" />
          </button>
          <button class={`tb-button ${doc.autoRotate.value ? 'pressed' : ''}`} title={t('Turntable (T)')} aria-label={t('Turntable')} aria-pressed={doc.autoRotate.value} onClick={() => (doc.autoRotate.value = !doc.autoRotate.value)}>
            <Icon name="rotateRight" />
          </button>
          <button class="tb-button" title={t('Save snapshot (Ctrl+E)')} aria-label={t('Save snapshot')} onClick={() => void snapshot()}>
            <Icon name="exportIcon" />
          </button>
          <span class="model-stats muted">
            {stats.animations
              ? t('{count, plural, one {{triangles} triangle} other {{triangles} triangles}} · {meshes, plural, one {# mesh} other {# meshes}} · {animations, plural, one {# animation} other {# animations}}', {
                  count: stats.triangles,
                  triangles: fmt(stats.triangles),
                  meshes: stats.meshes,
                  animations: stats.animations
                })
              : t('{count, plural, one {{triangles} triangle} other {{triangles} triangles}} · {meshes, plural, one {# mesh} other {# meshes}}', { count: stats.triangles, triangles: fmt(stats.triangles), meshes: stats.meshes })}
          </span>
        </div>
      )}
    </div>
  )
}
