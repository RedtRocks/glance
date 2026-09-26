import { useState } from 'preact/hooks'
import type { PdfDoc } from '../../state/documents'
import { REDUCE_PRESETS } from '../../core/reduce'
import { reduceOpen, toast, withBusy } from '../../state/ui'
import { Modal } from './Dialog'
import { intlLocale, msg, t } from '../../i18n'

type Preset = keyof typeof REDUCE_PRESETS
const LABELS: Record<Preset, [string, string]> = {
  smaller: [msg('Smallest file'), msg('Images up to 1200 pixels, stronger compression. Good for email.')],
  balanced: [msg('Balanced'), msg('Images up to 2000 pixels. Good for sharing and on-screen reading.')],
  quality: [msg('Higher quality'), msg('Images up to 3000 pixels. Good for printing.')]
}

function mb(n: number): string {
  return n < 1024 * 1024
    ? t('{size} KB', { size: Math.round(n / 1024) })
    : t('{size} MB', { size: (n / 1024 / 1024).toLocaleString(intlLocale.value, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })
}

/** File → Reduce File Size: recompress the PDF's large images. */
export function ReduceDialog({ doc }: { doc: PdfDoc }) {
  const [preset, setPreset] = useState<Preset>('balanced')
  const close = (): void => void (reduceOpen.value = false)
  const run = async (): Promise<void> => {
    close()
    let result = ''
    await withBusy(t('Reducing file size…'), () =>
      doc.apply('Reduce File Size', async (bytes) => {
        const [{ reduceFileSize }, { canvasRecompress }] = await Promise.all([import('../../core/reduce'), import('../../image/recompress')])
        const r = await reduceFileSize(bytes, REDUCE_PRESETS[preset], canvasRecompress)
        const sizes = { before: mb(r.before), after: mb(r.after) }
        result = r.images
          ? t('{count, plural, one {Recompressed # image} other {Recompressed # images}}: {before} → {after}. Save to keep the result.', { count: r.images, ...sizes })
          : t('No images could be made smaller ({before} → {after}).', sizes)
        return { bytes: r.bytes }
      })
    )
    toast(result)
  }
  return (
    <Modal
      title={t('Reduce file size')}
      onClose={close}
      footer={
        <>
          <button class="btn" onClick={close}>
            {t('Cancel')}
          </button>
          <button class="btn primary" onClick={() => void run()}>
            {t('Reduce')}
          </button>
        </>
      }
    >
      <div class="cleanup">
        {(Object.keys(LABELS) as Preset[]).map((k) => (
          <label key={k} class="check-row cleanup-row">
            <input type="radio" name="reduce" checked={preset === k} onChange={() => setPreset(k)} />
            <span>
              <strong>{t(LABELS[k][0])}</strong>
              <small class="muted">{t(LABELS[k][1])}</small>
            </span>
          </label>
        ))}
        <p class="muted small">{t('Text and drawings stay sharp; only photos and scans are recompressed. You can undo this until you save.')}</p>
      </div>
    </Modal>
  )
}
