import { useEffect, useState } from 'preact/hooks'
import type { Doc } from '../../state/documents'
import { removeDoc } from '../../state/documents'
import { openFiles } from '../../state/actions'
import { afterWrite, versionsOpen } from '../../state/versions'
import { toast } from '../../state/ui'
import { openPdf } from '../../pdf/engine'
import * as platform from '../../platform'
import { Modal } from './Dialog'

function bytes(n: number): string {
  return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`
}

function day(t: number): string {
  const d = new Date(t)
  const today = new Date()
  const yesterday = new Date(Date.now() - 86_400_000)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
}

/** First page (PDF) or the image itself, from a version's bytes. */
function Preview({ data, isPdf }: { data: Uint8Array | null; isPdf: boolean }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    let made: string | null = null
    setUrl(null)
    if (!data) return
    void (async () => {
      if (isPdf) {
        const proxy = await openPdf(data.slice())
        try {
          const page = await proxy.getPage(1)
          const base = page.getViewport({ scale: 1 })
          const vp = page.getViewport({ scale: 420 / Math.max(base.width, base.height) })
          const canvas = document.createElement('canvas')
          canvas.width = Math.ceil(vp.width)
          canvas.height = Math.ceil(vp.height)
          await page.render({ canvas, viewport: vp, background: 'white' }).promise
          made = canvas.toDataURL('image/png')
        } finally {
          await proxy.loadingTask.destroy()
        }
      } else {
        made = URL.createObjectURL(new Blob([data as BlobPart]))
      }
      if (alive) setUrl(made)
    })().catch(() => undefined)
    return () => {
      alive = false
      if (made?.startsWith('blob:')) URL.revokeObjectURL(made)
    }
  }, [data])
  return <div class="version-preview">{url ? <img src={url} alt="Preview of the selected version" /> : <span class="muted">{data ? 'Loading preview…' : 'Select a version'}</span>}</div>
}

/** File → Browse Versions: every saved version of this file, like Preview's Browse All Versions. */
export function VersionsDialog({ doc }: { doc: Doc }) {
  const path = doc.path.value
  const [list, setList] = useState<platform.VersionInfo[] | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [data, setData] = useState<Uint8Array | null>(null)
  const [tick, setTick] = useState(0)
  const close = (): void => void (versionsOpen.value = false)
  const isPdf = doc.kind === 'pdf'

  useEffect(() => {
    if (!path) return
    void platform.historyList(path).then((l) => {
      setList(l)
      setSel((s) => (s && l.some((v) => v.id === s) ? s : (l[0]?.id ?? null)))
    })
  }, [path, tick])
  useEffect(() => {
    setData(null)
    if (path && sel) void platform.historyRead(path, sel).then(setData).catch((e) => toast(String(e), 'error'))
  }, [path, sel])

  if (!path) return null
  const current = list?.find((v) => v.id === sel)
  const stamp = (v: platform.VersionInfo) => new Date(v.time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

  const openCopy = async (): Promise<void> => {
    if (!data || !current) return
    const ext = /\.([^.\\/]+)$/.exec(path)?.[1] ?? 'pdf'
    const base = platform.baseName(path).replace(/\.[^.]+$/, '')
    const when = new Date(current.time).toISOString().slice(0, 16).replace('T', ' ').replace(':', '.')
    const tmp = await platform.writeTemp(`${base} (${when}).${ext}`, data)
    close()
    await openFiles([tmp])
  }
  const restore = async (): Promise<void> => {
    if (!data || !current) return
    const ok = await platform.confirmDialog(
      `Replace “${doc.name.peek()}” with the version from ${day(current.time).toLowerCase()} at ${stamp(current)}? The current file is kept as a version, so you can switch back.${doc.dirty.peek() ? ' Your unsaved changes will be discarded.' : ''}`,
      'Restore version',
      'Restore'
    )
    if (!ok) return
    await afterWrite(path, 'Before restoring')
    await platform.writeFile(path, data)
    await afterWrite(path, 'Restored', data)
    close()
    removeDoc(doc.id)
    await openFiles([path])
    toast('Version restored')
  }
  const remove = async (ids?: string[]): Promise<void> => {
    const n = await platform.historyDelete(path, ids)
    toast(`Deleted ${n} ${n === 1 ? 'version' : 'versions'}`)
    setTick((t) => t + 1)
  }

  let lastDay = ''
  return (
    <Modal
      title={`Versions of “${doc.name.value}”`}
      wide
      onClose={close}
      footer={
        <>
          <button class="btn" disabled={!list?.length} onClick={() => void remove()}>
            Delete all versions
          </button>
          <span class="tb-spacer" />
          <button class="btn" disabled={!data} onClick={() => void openCopy()}>
            Open as copy
          </button>
          <button class="btn primary" disabled={!data} onClick={() => void restore()}>
            Restore
          </button>
        </>
      }
    >
      <div class="versions">
        <ul class="version-list" role="listbox" aria-label="Versions">
          {list === null && <li class="muted">Loading…</li>}
          {list?.length === 0 && <li class="muted">No versions yet. Every save of this file keeps one.</li>}
          {list?.map((v) => {
            const d = day(v.time)
            const heading = d !== lastDay ? d : null
            lastDay = d
            return (
              <li key={v.id}>
                {heading && <div class="version-day">{heading}</div>}
                <button role="option" aria-selected={v.id === sel} class={`version-item ${v.id === sel ? 'selected' : ''}`} onClick={() => setSel(v.id)}>
                  <span class="version-time">{stamp(v)}</span>
                  <span class="version-label">{v.label || 'Saved'}</span>
                  <span class="muted">{bytes(v.size)}</span>
                </button>
              </li>
            )
          })}
        </ul>
        <div class="version-side">
          <Preview data={data} isPdf={isPdf} />
          {current && (
            <button class="btn" onClick={() => void remove([current.id])}>
              Delete this version
            </button>
          )}
        </div>
      </div>
      <p class="muted small">Versions are kept in Glance’s app data on this PC: every version from the last day, then one a day for a month, then one a week. The oldest go first when space is needed.</p>
    </Modal>
  )
}
