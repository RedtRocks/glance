import { useState } from 'preact/hooks'
import type { CleanupOptions } from '../../core/cleanup'
import type { PdfDoc } from '../../state/documents'
import { cleanup } from '../../state/pdfModules'
import { cleanupOpen, toast, withBusy } from '../../state/ui'
import { Modal } from './Dialog'
import { intlLocale, msg, t } from '../../i18n'

const ROWS: [keyof CleanupOptions, string, string][] = [
  ['annotations', msg('Comments and markup from other apps'), msg('Notes, highlights, stamps and drawings (form fields stay).')],
  ['links', msg('Links'), msg('Web and in-document links; tracking links included.')],
  ['metadata', msg('Document information'), msg('Title, author, creating app, dates and hidden XMP metadata.')],
  ['attachments', msg('Attached files'), msg('Files embedded in the PDF.')],
  ['javascript', msg('Scripts'), msg('JavaScript that runs when the PDF opens or a field is used.')]
]

function kb(n: number): string {
  return n < 1024 * 1024 ? t('{size} KB', { size: Math.round(n / 1024) }) : t('{size} MB', { size: (n / 1024 / 1024).toLocaleString(intlLocale.value, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })
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
    await withBusy(t('Cleaning up…'), async () => {
      await doc.apply('Clean Up PDF', async (bytes) => {
        const { bytes: out, report } = await (await cleanup()).cleanUp(bytes, o)
        const parts = [
          report.annotations && t('{count, plural, one {# comment} other {# comments}}', { count: report.annotations }),
          report.links && t('{count, plural, one {# link} other {# links}}', { count: report.links }),
          report.metadata && t('document information'),
          report.attachments && t('{count, plural, one {# attachment} other {# attachments}}', { count: report.attachments }),
          report.scripts && t('{count, plural, one {# script} other {# scripts}}', { count: report.scripts })
        ].filter((p): p is string => !!p)
        const sizes = { before: kb(report.before), after: kb(report.after) }
        summary = parts.length
          ? t('Removed {items} ({before} → {after}). Save to keep the result.', { items: new Intl.ListFormat(intlLocale.value, { type: 'unit' }).format(parts), ...sizes })
          : t('Nothing to remove ({before} → {after}). Save to keep the result.', sizes)
        return { bytes: out }
      })
      if (mine && own) doc.edit('Remove Markup', { markup: [] })
    })
    toast(summary)
  }

  const any = Object.values(o).some(Boolean) || (mine && own > 0)
  return (
    <Modal
      title={t('Clean up PDF')}
      onClose={close}
      footer={
        <>
          <button class="btn" onClick={close}>
            {t('Cancel')}
          </button>
          <button class="btn primary" disabled={!any} onClick={() => void run()}>
            {t('Clean up')}
          </button>
        </>
      }
    >
      <div class="cleanup">
        <p class="muted">
          {t('Removed items are deleted from the file itself, not just hidden. Unused data is dropped too, which often makes the file smaller.')}
        </p>
        {own > 0 && (
          <label class="check-row cleanup-row">
            <input type="checkbox" checked={mine} onChange={(e) => setMine((e.target as HTMLInputElement).checked)} />
            <span>
              <strong>{t('Your markup')}</strong>
              <small class="muted">{t('{count, plural, one {# item added in Glance.} other {# items added in Glance.}}', { count: own })}</small>
            </span>
          </label>
        )}
        {ROWS.map(([k, title, detail]) => (
          <label key={k} class="check-row cleanup-row">
            <input type="checkbox" checked={o[k]} onChange={(e) => setO({ ...o, [k]: (e.target as HTMLInputElement).checked })} />
            <span>
              <strong>{t(title)}</strong>
              <small class="muted">{t(detail)}</small>
            </span>
          </label>
        ))}
      </div>
    </Modal>
  )
}
