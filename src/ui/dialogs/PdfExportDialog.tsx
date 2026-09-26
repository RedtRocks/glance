import { useState } from 'preact/hooks'
import type { PdfDoc } from '../../state/documents'
import { exportOpen } from '../../state/imageState'
import { exportPagesAsImages, exportSelectedPages, type PageImageFormat } from '../../state/actions'
import { Modal } from './Dialog'

type Format = 'pdf' | PageImageFormat
const FORMATS: [Format, string][] = [
  ['pdf', 'PDF document'],
  ['png', 'PNG image'],
  ['jpg', 'JPEG image'],
  ['tiff', 'TIFF image']
]
const DPIS = [72, 150, 300, 600]

/** File → Export for PDFs: pages as a new PDF, or as images at a chosen resolution. */
export function PdfExportDialog({ doc }: { doc: PdfDoc }) {
  const selected = doc.selection.value.length
  const [format, setFormat] = useState<Format>('png')
  const [which, setWhich] = useState<'all' | 'selected' | 'current'>(selected > 1 ? 'selected' : 'current')
  const [dpi, setDpi] = useState(150)
  const [quality, setQuality] = useState(90)
  const close = (): void => void (exportOpen.value = false)
  const count = which === 'all' ? doc.pageCount.value : which === 'selected' ? Math.max(1, selected) : 1

  const run = (): void => {
    close()
    if (format === 'pdf') {
      if (which === 'all') doc.selection.value = [...Array(doc.pageCount.value).keys()]
      else if (which === 'current') doc.selection.value = [doc.current.value]
      void exportSelectedPages(doc)
    } else {
      void exportPagesAsImages(doc, { format, dpi, quality, which })
    }
  }

  return (
    <Modal
      title="Export"
      onClose={close}
      footer={
        <>
          <button class="btn" onClick={close}>
            Cancel
          </button>
          <button class="btn primary" onClick={run}>
            Export…
          </button>
        </>
      }
    >
      <label class="field">
        <span>Format</span>
        <select value={format} onChange={(e) => setFormat((e.target as HTMLSelectElement).value as Format)}>
          {FORMATS.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label class="field">
        <span>Pages</span>
        <select value={which} onChange={(e) => setWhich((e.target as HTMLSelectElement).value as typeof which)}>
          <option value="current">Current page ({doc.current.value + 1})</option>
          {selected > 1 && <option value="selected">Selected pages ({selected})</option>}
          <option value="all">All pages ({doc.pageCount.value})</option>
        </select>
      </label>
      {format !== 'pdf' && (
        <label class="field">
          <span>Resolution</span>
          <select value={dpi} onChange={(e) => setDpi(Number((e.target as HTMLSelectElement).value))}>
            {DPIS.map((d) => (
              <option key={d} value={d}>
                {d} pixels/inch{d === 150 ? ' (screen)' : d === 300 ? ' (print)' : ''}
              </option>
            ))}
          </select>
        </label>
      )}
      {format === 'jpg' && (
        <label class="field">
          <span>Quality: {quality}</span>
          <input type="range" min={10} max={100} value={quality} onInput={(e) => setQuality(Number((e.target as HTMLInputElement).value))} />
        </label>
      )}
      <p class="muted">
        {format === 'pdf'
          ? 'Creates a new PDF with these pages; markup and form entries are included.'
          : count > 1
            ? `Creates ${count} images, one per page, named “… (page N)”. Markup and form entries are included.`
            : 'Markup and form entries are included in the image.'}
      </p>
    </Modal>
  )
}
