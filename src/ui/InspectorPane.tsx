import { useEffect, useState } from 'preact/hooks'
import type { Doc } from '../state/documents'
import { inspectorOpen, toast } from '../state/ui'
import * as platform from '../platform'
import { Icon } from './Icon'

type Rows = [string, string][]

function bytes(n: number): string {
  if (n < 1024) return `${n} bytes`
  const units = ['KB', 'MB', 'GB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`
}

/** PDF dates look like D:20240131120000+01'00'. */
function pdfDate(s: unknown): string {
  const m = typeof s === 'string' ? /D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(s) : null
  if (!m) return typeof s === 'string' ? s : ''
  const d = new Date(Number(m[1]), Number(m[2] ?? 1) - 1, Number(m[3] ?? 1), Number(m[4] ?? 0), Number(m[5] ?? 0))
  return d.toLocaleString()
}

function Section({ title, rows }: { title: string; rows: Rows }) {
  const shown = rows.filter(([, v]) => v)
  if (!shown.length) return null
  return (
    <section class="inspector-section">
      <h3>{title}</h3>
      <dl>
        {shown.map(([k, v]) => (
          <div key={k} class="inspector-row">
            <dt>{k}</dt>
            <dd title={v}>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/** Preview's Inspector (Ctrl+I): general info plus EXIF for images or document properties for PDFs. */
export function InspectorPane({ doc }: { doc: Doc }) {
  const [general, setGeneral] = useState<Rows>([])
  const [pdfRows, setPdfRows] = useState<Rows>([])
  const [meta, setMeta] = useState<platform.ImageMetadata | null>(null)
  const [version, setVersion] = useState(0)
  const close = (): void => void (inspectorOpen.value = false)
  const path = doc.path.value

  useEffect(() => {
    let alive = true
    const rows: Rows = [['Name', doc.name.value], ['Where', path && !path.startsWith('browser:') ? platform.dirName(path) : '']]
    if (doc.kind === 'image') {
      const nat = doc.natural.value
      rows.push(['Kind', `${/\.([^.]+)$/.exec(doc.name.value)?.[1]?.toUpperCase() ?? 'Image'} image`])
      rows.push(['Size', bytes(doc.probe.size)])
      if (nat) rows.push(['Dimensions', `${nat.width} × ${nat.height} pixels`])
      if (doc.pageCount.value > 1) rows.push(['Pages', String(doc.pageCount.value)])
      if (path) void platform.imageMetadata(path).then((m) => alive && setMeta(m)).catch(() => alive && setMeta(null))
    } else if (doc.kind === 'pdf') {
      rows.push(['Kind', 'PDF document'], ['Size', bytes(doc.bytes.length)], ['Pages', String(doc.pageCount.value)])
      const proxy = doc.proxy.value
      void proxy
        ?.getMetadata()
        .then(async ({ info }) => {
          const i = info as Record<string, unknown>
          const page = await proxy.getPage(doc.current.value + 1)
          const [x1, y1, x2, y2] = page.view
          const inch = (v: number) => (v / 72).toFixed(2)
          if (!alive) return
          setPdfRows([
            ['Title', String(i.Title ?? '')],
            ['Author', String(i.Author ?? '')],
            ['Subject', String(i.Subject ?? '')],
            ['Keywords', String(i.Keywords ?? '')],
            ['Created', pdfDate(i.CreationDate)],
            ['Modified', pdfDate(i.ModDate)],
            ['Application', String(i.Creator ?? '')],
            ['PDF producer', String(i.Producer ?? '')],
            ['PDF version', String(i.PDFFormatVersion ?? '')],
            ['Encrypted', i.IsEncrypted ? 'Yes' : ''],
            ['Page size', `${inch(x2 - x1)} × ${inch(y2 - y1)} in (${Math.round(x2 - x1)} × ${Math.round(y2 - y1)} pt)`]
          ])
        })
        .catch(() => undefined)
    }
    setGeneral(rows)
    return () => {
      alive = false
    }
  }, [doc, path, version, doc.kind === 'image' ? doc.natural.value : null])

  const removeLocation = async (): Promise<void> => {
    if (!path) return
    if (doc.dirty.peek()) return toast('Save your changes first; removing location rewrites the file.')
    const ok = await platform.confirmDialog(
      'Remove the location where this photo was taken from the file? Other details, like the camera and date, are kept. This can’t be undone.',
      'Remove location',
      'Remove'
    )
    if (!ok) return
    try {
      const failed = await platform.removeLocation([path])
      if (failed.length) toast(failed[0], 'error')
      else toast('Location removed')
      setVersion((v) => v + 1)
    } catch (e) {
      toast(String(e), 'error')
    }
  }

  const loc = meta?.location
  return (
    <aside class="side-pane inspector" aria-label="Inspector">
      <header class="side-pane-header">
        <h2>Inspector</h2>
        <button class="icon-button" aria-label="Close" onClick={close}>
          <Icon name="close" size={16} />
        </button>
      </header>
      <div class="side-pane-body">
        <Section title="General" rows={general} />
        {doc.kind === 'pdf' && <Section title="Document" rows={pdfRows} />}
        {meta?.has_location && (
          <section class="inspector-section location">
            <h3>Location</h3>
            {loc && <p class="coords">{`${Math.abs(loc[0]).toFixed(5)}° ${loc[0] >= 0 ? 'N' : 'S'}, ${Math.abs(loc[1]).toFixed(5)}° ${loc[1] >= 0 ? 'E' : 'W'}`}</p>}
            <div class="inline-actions">
              {loc && (
                <button class="btn" onClick={() => void platform.openUrl(`https://www.bing.com/maps?cp=${loc[0]}~${loc[1]}&lvl=15&sp=point.${loc[0]}_${loc[1]}`)}>
                  Show in Maps
                </button>
              )}
              {meta.can_remove_location && (
                <button class="btn" onClick={() => void removeLocation()}>
                  Remove Location
                </button>
              )}
            </div>
          </section>
        )}
        {meta?.groups
          .filter((g) => g.title !== 'Location')
          .map((g) => (
            <Section key={g.title} title={g.title} rows={g.fields.map((f) => [f.label, f.value])} />
          ))}
        {doc.kind === 'image' && meta && !meta.groups.length && <p class="muted">No camera or EXIF details in this file.</p>}
        {doc.kind === 'image' && !platform.isTauri && <p class="muted">EXIF details are shown in the Windows app.</p>}
      </div>
    </aside>
  )
}
