import { useState } from 'preact/hooks'
import type { PdfDoc } from '../../state/documents'
import { REDUCE_PRESETS } from '../../core/reduce'
import { reduceOpen, toast, withBusy } from '../../state/ui'
import { Modal } from './Dialog'

type Preset = keyof typeof REDUCE_PRESETS
const LABELS: Record<Preset, [string, string]> = {
  smaller: ['Smallest file', 'Images up to 1200 pixels, stronger compression. Good for email.'],
  balanced: ['Balanced', 'Images up to 2000 pixels. Good for sharing and on-screen reading.'],
  quality: ['Higher quality', 'Images up to 3000 pixels. Good for printing.']
}

function mb(n: number): string {
  return n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** File → Reduce File Size: recompress the PDF's large images. */
export function ReduceDialog({ doc }: { doc: PdfDoc }) {
  const [preset, setPreset] = useState<Preset>('balanced')
  const close = (): void => void (reduceOpen.value = false)
  const run = async (): Promise<void> => {
    close()
    let msg = ''
    await withBusy('Reducing file size…', () =>
      doc.apply('Reduce File Size', async (bytes) => {
        const [{ reduceFileSize }, { canvasRecompress }] = await Promise.all([import('../../core/reduce'), import('../../image/recompress')])
        const r = await reduceFileSize(bytes, REDUCE_PRESETS[preset], canvasRecompress)
        msg = r.images
          ? `Recompressed ${r.images} image${r.images === 1 ? '' : 's'}: ${mb(r.before)} → ${mb(r.after)}. Save to keep the result.`
          : `No images could be made smaller (${mb(r.before)} → ${mb(r.after)}).`
        return { bytes: r.bytes }
      })
    )
    toast(msg)
  }
  return (
    <Modal
      title="Reduce file size"
      onClose={close}
      footer={
        <>
          <button class="btn" onClick={close}>
            Cancel
          </button>
          <button class="btn primary" onClick={() => void run()}>
            Reduce
          </button>
        </>
      }
    >
      <div class="cleanup">
        {(Object.keys(LABELS) as Preset[]).map((k) => (
          <label key={k} class="check-row cleanup-row">
            <input type="radio" name="reduce" checked={preset === k} onChange={() => setPreset(k)} />
            <span>
              <strong>{LABELS[k][0]}</strong>
              <small class="muted">{LABELS[k][1]}</small>
            </span>
          </label>
        ))}
        <p class="muted small">Text and drawings stay sharp; only photos and scans are recompressed. You can undo this until you save.</p>
      </div>
    </Modal>
  )
}
