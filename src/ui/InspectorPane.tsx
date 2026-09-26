import { useEffect, useState } from 'preact/hooks'
import type { Doc } from '../state/documents'
import { inspectorOpen, toast } from '../state/ui'
import * as platform from '../platform'
import { Icon } from './Icon'
import { intlLocale, locale, t } from '../i18n'

type Rows = [string, string][]

function bytes(n: number): string {
  if (n < 1024) return t('{count, plural, one {# byte} other {# bytes}}', { count: n })
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < 2) {
    v /= 1024
    i++
  }
  const digits = v < 10 ? 1 : 0
  const size = v.toLocaleString(intlLocale.value, { minimumFractionDigits: digits, maximumFractionDigits: digits })
  return i === 0 ? t('{size} KB', { size }) : i === 1 ? t('{size} MB', { size }) : t('{size} GB', { size })
}

const fixed = (v: number, digits: number): string => v.toLocaleString(intlLocale.value, { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false })

/** PDF dates look like D:20240131120000+01'00'. */
function pdfDate(s: unknown): string {
  const m = typeof s === 'string' ? /D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(s) : null
  if (!m) return typeof s === 'string' ? s : ''
  const d = new Date(Number(m[1]), Number(m[2] ?? 1) - 1, Number(m[3] ?? 1), Number(m[4] ?? 0), Number(m[5] ?? 0))
  return d.toLocaleString(intlLocale.value)
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
    const rows: Rows = [
      [t('Name'), doc.name.value],
      [t('Where'), path && !path.startsWith('browser:') ? platform.dirName(path) : '']
    ]
    if (doc.kind === 'image') {
      const nat = doc.natural.value
      const ext = /\.([^.]+)$/.exec(doc.name.value)?.[1]?.toUpperCase()
      rows.push([t('Kind'), ext ? t('{format} image', { format: ext }) : t('Image')])
      rows.push([t('Size'), bytes(doc.probe.size)])
      if (nat) rows.push([t('Dimensions'), t('{width} × {height} pixels', { width: nat.width, height: nat.height })])
      if (doc.pageCount.value > 1) rows.push([t('Pages'), doc.pageCount.value.toLocaleString(intlLocale.value)])
      if (path) void platform.imageMetadata(path).then((m) => alive && setMeta(m)).catch(() => alive && setMeta(null))
    } else if (doc.kind === 'pdf') {
      rows.push([t('Kind'), t('PDF document')], [t('Size'), bytes(doc.bytes.length)], [t('Pages'), doc.pageCount.value.toLocaleString(intlLocale.value)])
      const proxy = doc.proxy.value
      void proxy
        ?.getMetadata()
        .then(async ({ info }) => {
          const i = info as Record<string, unknown>
          const page = await proxy.getPage(doc.current.value + 1)
          const [x1, y1, x2, y2] = page.view
          const inch = (v: number) => fixed(v / 72, 2)
          if (!alive) return
          setPdfRows([
            [t('Title'), String(i.Title ?? '')],
            [t('Author'), String(i.Author ?? '')],
            [t('Subject'), String(i.Subject ?? '')],
            [t('Keywords'), String(i.Keywords ?? '')],
            [t('Created'), pdfDate(i.CreationDate)],
            [t('Modified'), pdfDate(i.ModDate)],
            [t('Application'), String(i.Creator ?? '')],
            [t('PDF producer'), String(i.Producer ?? '')],
            [t('PDF version'), String(i.PDFFormatVersion ?? '')],
            [t('Encrypted'), i.IsEncrypted ? t('Yes') : ''],
            [
              t('Page size'),
              t('{width} × {height} in ({widthPt} × {heightPt} pt)', {
                width: inch(x2 - x1),
                height: inch(y2 - y1),
                widthPt: Math.round(x2 - x1),
                heightPt: Math.round(y2 - y1)
              })
            ]
          ])
        })
        .catch(() => undefined)
    }
    setGeneral(rows)
    return () => {
      alive = false
    }
  }, [doc, path, version, doc.kind === 'image' ? doc.natural.value : null, locale.value])

  const removeLocation = async (): Promise<void> => {
    if (!path) return
    if (doc.dirty.peek()) return toast(t('Save your changes first; removing location rewrites the file.'))
    const ok = await platform.confirmDialog(
      t('Remove the location where this photo was taken from the file? Other details, like the camera and date, are kept. This can’t be undone.'),
      t('Remove location'),
      t('Remove')
    )
    if (!ok) return
    try {
      const failed = await platform.removeLocation([path])
      if (failed.length) toast(failed[0], 'error')
      else toast(t('Location removed'))
      setVersion((v) => v + 1)
    } catch (e) {
      toast(String(e), 'error')
    }
  }

  const loc = meta?.location
  return (
    <aside class="side-pane inspector" aria-label={t('Inspector')}>
      <header class="side-pane-header">
        <h2>{t('Inspector')}</h2>
        <button class="icon-button" aria-label={t('Close')} onClick={close}>
          <Icon name="close" size={16} />
        </button>
      </header>
      <div class="side-pane-body">
        <Section title={t('General')} rows={general} />
        {doc.kind === 'pdf' && <Section title={t('Document')} rows={pdfRows} />}
        {meta && <Section title={t('Color')} rows={[[t('Color profile'), meta.color_profile ?? t('None (sRGB assumed)')]]} />}
        {meta?.has_location && (
          <section class="inspector-section location">
            <h3>{t('Location')}</h3>
            {loc && (
              <p class="coords">
                {t('{latitude}, {longitude}', {
                  latitude: loc[0] >= 0 ? t('{degrees}° N', { degrees: fixed(loc[0], 5) }) : t('{degrees}° S', { degrees: fixed(-loc[0], 5) }),
                  longitude: loc[1] >= 0 ? t('{degrees}° E', { degrees: fixed(loc[1], 5) }) : t('{degrees}° W', { degrees: fixed(-loc[1], 5) })
                })}
              </p>
            )}
            <div class="inline-actions">
              {loc && (
                <button class="btn" onClick={() => void platform.openUrl(`https://www.bing.com/maps?cp=${loc[0]}~${loc[1]}&lvl=15&sp=point.${loc[0]}_${loc[1]}`)}>
                  {t('Show in Maps')}
                </button>
              )}
              {meta.can_remove_location && (
                <button class="btn" onClick={() => void removeLocation()}>
                  {t('Remove Location')}
                </button>
              )}
            </div>
          </section>
        )}
        {meta?.groups
          .filter((g) => g.title !== 'Location') // i18n-ignore: the native side's group id, not shown
          .map((g) => (
            <Section key={g.title} title={g.title} rows={g.fields.map((f) => [f.label, f.value])} />
          ))}
        {doc.kind === 'image' && meta && !meta.groups.length && <p class="muted">{t('No camera or EXIF details in this file.')}</p>}
        {doc.kind === 'image' && !platform.isTauri && <p class="muted">{t('EXIF details are shown in the Windows app.')}</p>}
      </div>
    </aside>
  )
}
