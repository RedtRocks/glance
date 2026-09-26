import { useState } from 'preact/hooks'
import type { CleanupOptions } from '../../core/cleanup'
import type { PdfDoc } from '../../state/documents'
import { cleanup } from '../../state/pdfModules'
import { cleanupOpen, toast, withBusy } from '../../state/ui'
import { Modal } from './Dialog'

const ROWS: [keyof CleanupOptions, string, string][] = [
  ['annotations', 'Comments and markup from other apps', 'Notes, highlights, stamps and drawings (form fields stay).'],
  ['links', 'Links', 'Web and in-document links; tracking links included.'],
  ['metadata', 'Document information', 'Title, author, creating app, dates and hidden XMP metadata.'],
  ['attachments', 'Attached files', 'Files embedded in the PDF.'],
  ['javascript', 'Scripts', 'JavaScript that runs when the PDF opens or a field is used.']
]

function kb(n: number): string {
  return n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** File → Clean Up PDF: remove annotations, links, metadata, attachments and scripts. */
export function CleanupDialog({ doc }: { doc: PdfDoc }) {
  const own = doc.markup.value.length
  const [o, setO] = useState<CleanupOptions>({ annotations: false, links: false, metadata: true, attachments: false, javascript: true })
  const [mine, setMine] = useState(false)
  const close = (): void => void (cleanupOpen.value = false)

  const run = async (): Promise<void> => {
    close()
    let summary = ''
    await withBusy('Cleaning up…', async () => {
      await doc.apply('Clean Up PDF', async (bytes) => {
        const { bytes: out, report } = await (await cleanup()).cleanUp(bytes, o)
        const parts = [
          report.annotations && `${report.annotations} comment${report.annotations === 1 ? '' : 's'}`,
          report.links && `${report.links} link${report.links === 1 ? '' : 's'}`,
          report.metadata && 'document information',
          report.attachments && `${report.attachments} attachment${report.attachments === 1 ? '' : 's'}`,
          report.scripts && `${report.scripts} script${report.scripts === 1 ? '' : 's'}`
        ].filter(Boolean)
        summary = parts.length ? `Removed ${parts.join(', ')} (${kb(report.before)} → ${kb(report.after)})` : `Nothing to remove (${kb(report.before)} → ${kb(report.after)})`
        return { bytes: out }
      })
      if (mine && own) doc.edit('Remove Markup', { markup: [] })
    })
    toast(summary + '. Save to keep the result.')
  }

  const any = Object.values(o).some(Boolean) || (mine && own > 0)
  return (
    <Modal
      title="Clean up PDF"
      onClose={close}
      footer={
        <>
          <button class="btn" onClick={close}>
            Cancel
          </button>
          <button class="btn primary" disabled={!any} onClick={() => void run()}>
            Clean up
          </button>
        </>
      }
    >
      <div class="cleanup">
        <p class="muted">Removed items are deleted from the file itself, not just hidden. Unused data is dropped too, which often makes the file smaller.</p>
        {own > 0 && (
          <label class="check-row cleanup-row">
            <input type="checkbox" checked={mine} onChange={(e) => setMine((e.target as HTMLInputElement).checked)} />
            <span>
              <strong>Your markup</strong>
              <small class="muted">
                {own} item{own === 1 ? '' : 's'} added in Glance.
              </small>
            </span>
          </label>
        )}
        {ROWS.map(([k, title, detail]) => (
          <label key={k} class="check-row cleanup-row">
            <input type="checkbox" checked={o[k]} onChange={(e) => setO({ ...o, [k]: (e.target as HTMLInputElement).checked })} />
            <span>
              <strong>{title}</strong>
              <small class="muted">{detail}</small>
            </span>
          </label>
        ))}
      </div>
    </Modal>
  )
}
