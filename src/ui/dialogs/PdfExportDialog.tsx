import { useState } from 'preact/hooks'
import type { PdfDoc } from '../../state/documents'
import { exportOpen } from '../../state/imageState'
import { exportPagesAsImages, exportSelectedPages, type PageImageFormat } from '../../state/actions'
import { Modal } from './Dialog'
import { msg, t } from '../../i18n'

type Format = 'pdf' | PageImageFormat
const FORMATS: [Format, string][] = [
  ['pdf', msg('PDF document')],
  ['png', msg('PNG image')],
  ['jpg', msg('JPEG image')],
  ['tiff', msg('TIFF image')]
]
const DPIS = [72, 150, 300, 600]

/** File → Export for PDFs: pages as a new PDF, or as images at a chosen resolution. */
export function PdfExportDialog({ doc }: { doc: PdfDoc }) {
  const selected = doc.selection.value.length
  const [format, setFormat] = useState<Format>('png')
  const [which, setWhich] = useState<'all' | 'selected' | 'current'>(selected > 1 ? 'selected' : 'current')
  const [dpi, setDpi] = useState(150)
  const [quality, setQuality] = useState(90)
  const [lock, setLock] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [allow, setAllow] = useState({ printing: true, copying: true, editing: false })
  const passwordProblem = lock && (!password ? t('Enter a password.') : password !== confirm ? t('The passwords don’t match.') : null)
  const close = (): void => void (exportOpen.value = false)
  const count = which === 'all' ? doc.pageCount.value : which === 'selected' ? Math.max(1, selected) : 1

  const run = (): void => {
    close()
    if (format === 'pdf') {
      if (which === 'all') doc.selection.value = [...Array(doc.pageCount.value).keys()]
      else if (which === 'current') doc.selection.value = [doc.current.value]
      void exportSelectedPages(doc, lock ? { protect: { password, allowPrinting: allow.printing, allowCopying: allow.copying, allowEditing: allow.editing } } : {})
    } else {
      void exportPagesAsImages(doc, { format, dpi, quality, which })
    }
  }

  return (
    <Modal
      title={t('Export')}
      onClose={close}
      footer={
        <>
          <button class="btn" onClick={close}>
            {t('Cancel')}
          </button>
          <button class="btn primary" disabled={format === 'pdf' && !!passwordProblem} onClick={run}>
            {t('Export…')}
          </button>
        </>
      }
    >
      <label class="field">
        <span>{t('Format')}</span>
        <select value={format} onChange={(e) => setFormat((e.target as HTMLSelectElement).value as Format)}>
          {FORMATS.map(([id, label]) => (
            <option key={id} value={id}>
              {t(label)}
            </option>
          ))}
        </select>
      </label>
      <label class="field">
        <span>{t('Pages')}</span>
        <select value={which} onChange={(e) => setWhich((e.target as HTMLSelectElement).value as typeof which)}>
          <option value="current">{t('Current page ({page})', { page: doc.current.value + 1 })}</option>
          {selected > 1 && <option value="selected">{t('Selected pages ({count})', { count: selected })}</option>}
          <option value="all">{t('All pages ({count})', { count: doc.pageCount.value })}</option>
        </select>
      </label>
      {format === 'pdf' && (
        <div class="protect">
          <label class="check-row">
            <input type="checkbox" checked={lock} onChange={(e) => setLock((e.target as HTMLInputElement).checked)} /> {t('Encrypt with a password')}
          </label>
          {lock && (
            <>
              <label class="field">
                <span>{t('Password')}</span>
                <input type="password" autocomplete="new-password" value={password} onInput={(e) => setPassword((e.target as HTMLInputElement).value)} />
              </label>
              <label class="field">
                <span>{t('Verify')}</span>
                <input type="password" autocomplete="new-password" value={confirm} onInput={(e) => setConfirm((e.target as HTMLInputElement).value)} />
              </label>
              <div class="check-line">
                {(
                  [
                    ['printing', t('Allow printing')],
                    ['copying', t('Allow copying text')],
                    ['editing', t('Allow editing')]
                  ] as const
                ).map(([k, label]) => (
                  <label key={k} class="check-row">
                    <input type="checkbox" checked={allow[k]} onChange={(e) => setAllow({ ...allow, [k]: (e.target as HTMLInputElement).checked })} /> {label}
                  </label>
                ))}
              </div>
              <small class={passwordProblem ? 'field-error' : 'muted'}>
                {passwordProblem ?? t('AES-256. Keep the password somewhere safe: without it the file can’t be opened.')}
              </small>
            </>
          )}
        </div>
      )}
      {format !== 'pdf' && (
        <label class="field">
          <span>{t('Resolution')}</span>
          <select value={dpi} onChange={(e) => setDpi(Number((e.target as HTMLSelectElement).value))}>
            {DPIS.map((d) => (
              <option key={d} value={d}>
                {d === 150
                  ? t('{dpi} pixels/inch (screen)', { dpi: d })
                  : d === 300
                    ? t('{dpi} pixels/inch (print)', { dpi: d })
                    : t('{dpi} pixels/inch', { dpi: d })}
              </option>
            ))}
          </select>
        </label>
      )}
      {format === 'jpg' && (
        <label class="field">
          <span>{t('Quality: {quality}', { quality })}</span>
          <input type="range" min={10} max={100} value={quality} onInput={(e) => setQuality(Number((e.target as HTMLInputElement).value))} />
        </label>
      )}
      <p class="muted">
        {format === 'pdf'
          ? t('Creates a new PDF with these pages; markup and form entries are included.')
          : count > 1
            ? t('Creates {count} images, one per page, named “… (page N)”. Markup and form entries are included.', { count })
            : t('Markup and form entries are included in the image.')}
      </p>
    </Modal>
  )
}
