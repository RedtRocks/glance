import { useState } from 'preact/hooks'
import { DEFAULT_BATCH, isNoop, type BatchFormat, type BatchOptions } from '../../core/image/batch'
import { ImageDoc, docs } from '../../state/documents'
import { batchOpen, batchProgress, runBatch } from '../../state/batch'
import { OPEN_FILTERS } from '../../state/actions'
import { alertDialog, toast } from '../../state/ui'
import * as platform from '../../platform'
import { Modal } from './Dialog'

const FORMATS: [BatchFormat, string][] = [
  ['keep', 'Same as original'],
  ['jpg', 'JPEG'],
  ['png', 'PNG'],
  ['webp', 'WebP (lossless)'],
  ['tiff', 'TIFF'],
  ['bmp', 'BMP']
]
const IMAGE_EXTS = OPEN_FILTERS[0].extensions.filter((e) => !['pdf', 'ai', 'ps', 'eps', 'epsf', 'xps', 'oxps', 'cbz'].includes(e))

/** Rotate, resize, convert, strip location or export many images at once. */
export function BatchDialog() {
  const [files, setFiles] = useState<string[]>(() =>
    docs.peek().flatMap((d) => (d instanceof ImageDoc && d.path.peek() && !d.path.peek()!.startsWith('browser:') ? [d.path.peek()!] : []))
  )
  const [o, setO] = useState<BatchOptions>(DEFAULT_BATCH)
  const set = (patch: Partial<BatchOptions>): void => setO({ ...o, ...patch })
  const progress = batchProgress.value
  const close = (): void => {
    if (!progress) batchOpen.value = false
  }

  const add = async (): Promise<void> => {
    const picked = await platform.openDialog({ multiple: true, filters: [{ name: 'Images', extensions: IMAGE_EXTS }] })
    setFiles([...new Set([...files, ...picked])])
  }
  const run = async (): Promise<void> => {
    const failed = await runBatch(files, o)
    batchOpen.value = false
    if (failed.length) await alertDialog(`${failed.length} of ${files.length} images failed`, failed.join('\n'))
    else toast(`Processed ${files.length} ${files.length === 1 ? 'image' : 'images'}`)
  }
  const nothing = files.every((f) => isNoop(o, f))

  return (
    <Modal
      title="Batch edit images"
      wide
      onClose={close}
      footer={
        <>
          <button class="btn" disabled={!!progress} onClick={close}>
            Cancel
          </button>
          <button class="btn primary" disabled={!files.length || nothing || !!progress} onClick={() => void run()}>
            {progress ? `Processing ${progress.done + 1} of ${progress.total}…` : `Process ${files.length} ${files.length === 1 ? 'image' : 'images'}`}
          </button>
        </>
      }
    >
      <div class="batch">
        <div class="batch-files">
          <div class="batch-files-head">
            <span class="flyout-label">{files.length ? `${files.length} ${files.length === 1 ? 'image' : 'images'}` : 'No images yet'}</span>
            <button class="btn" onClick={() => void add()}>
              Add images…
            </button>
          </div>
          <ul class="match-list" aria-label="Images">
            {files.map((f) => (
              <li key={f} class="check-row match">
                <span class="match-text" title={f}>
                  {platform.baseName(f)}
                </span>
                <button class="icon-button small" aria-label={`Remove ${platform.baseName(f)}`} onClick={() => setFiles(files.filter((x) => x !== f))}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div class="batch-options">
          <label class="field">
            <span>Rotate</span>
            <select value={o.rotate} onChange={(e) => set({ rotate: Number((e.target as HTMLSelectElement).value) as BatchOptions['rotate'] })}>
              <option value={0}>Don’t rotate</option>
              <option value={270}>Rotate left</option>
              <option value={90}>Rotate right</option>
              <option value={180}>Rotate 180°</option>
            </select>
          </label>
          <label class="field">
            <span>Flip</span>
            <select value={o.flip} onChange={(e) => set({ flip: (e.target as HTMLSelectElement).value as BatchOptions['flip'] })}>
              <option value="none">Don’t flip</option>
              <option value="horizontal">Flip horizontal</option>
              <option value="vertical">Flip vertical</option>
            </select>
          </label>
          <label class="field">
            <span>Resize</span>
            <select
              value={o.resize.mode === 'fit' ? `fit:${o.resize.width}x${o.resize.height}` : o.resize.mode === 'percent' ? `pct:${o.resize.percent}` : 'none'}
              onChange={(e) => {
                const v = (e.target as HTMLSelectElement).value
                if (v === 'none') set({ resize: { mode: 'none' } })
                else if (v.startsWith('pct:')) set({ resize: { mode: 'percent', percent: Number(v.slice(4)) } })
                else {
                  const [w, h] = v.slice(4).split('x').map(Number)
                  set({ resize: { mode: 'fit', width: w, height: h } })
                }
              }}
            >
              <option value="none">Keep size</option>
              <option value="fit:3840x2160">Fit into 3840 × 2160 (4K)</option>
              <option value="fit:1920x1080">Fit into 1920 × 1080 (HD)</option>
              <option value="fit:1280x1280">Fit into 1280 × 1280</option>
              <option value="fit:800x800">Fit into 800 × 800</option>
              <option value="pct:75">75%</option>
              <option value="pct:50">50%</option>
              <option value="pct:25">25%</option>
            </select>
          </label>
          <label class="field">
            <span>Format</span>
            <select value={o.format} onChange={(e) => set({ format: (e.target as HTMLSelectElement).value as BatchFormat })}>
              {FORMATS.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {(o.format === 'jpg' || o.format === 'keep') && (
            <label class="field">
              <span>JPEG quality: {o.quality}</span>
              <input type="range" min={10} max={100} value={o.quality} onInput={(e) => set({ quality: Number((e.target as HTMLInputElement).value) })} />
            </label>
          )}
          <label class="check-row">
            <input type="checkbox" checked={o.removeLocation} onChange={(e) => set({ removeLocation: (e.target as HTMLInputElement).checked })} /> Remove location
          </label>
          <label class="field">
            <span>Save</span>
            <select value={o.output} onChange={(e) => set({ output: (e.target as HTMLSelectElement).value as BatchOptions['output'] })}>
              <option value="suffix">As copies next to the originals, named “… (edited)”</option>
              <option value="replace">Replace the originals</option>
            </select>
          </label>
          <p class="muted small">
            Rotating, resizing or converting re-encodes the images without their EXIF details (camera, date, location). Only removing location keeps the
            rest of the details.
          </p>
        </div>
      </div>
      {progress && <progress class="batch-progress" value={progress.done} max={progress.total} aria-label={`Processing ${progress.current}`} />}
    </Modal>
  )
}
