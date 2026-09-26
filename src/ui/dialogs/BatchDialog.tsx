import { useState } from 'preact/hooks'
import { DEFAULT_BATCH, isNoop, type BatchFormat, type BatchOptions } from '../../core/image/batch'
import { ImageDoc, docs } from '../../state/documents'
import { batchOpen, batchProgress, runBatch } from '../../state/batch'
import { OPEN_FILTERS } from '../../state/actions'
import { alertDialog, toast } from '../../state/ui'
import * as platform from '../../platform'
import { Modal } from './Dialog'
import { msg, t } from '../../i18n'

const FORMATS: [BatchFormat, string][] = [
  ['keep', msg('Same as original')],
  ['jpg', 'JPEG'],
  ['png', 'PNG'],
  ['webp', msg('WebP (lossless)')],
  ['tiff', 'TIFF'],
  ['bmp', 'BMP']
]
const IMAGE_EXTS = OPEN_FILTERS[0].extensions.filter((e) => !['pdf', 'ai', 'ps', 'eps', 'epsf', 'xps', 'oxps', 'cbz'].includes(e))

/** Rotate, resize, convert, strip location or export many images at once. */
export function BatchDialog() {
  const [files, setFiles] = useState<string[]>(() =>
    docs.peek().flatMap((d) => (d instanceof ImageDoc && d.path.peek() && !d.path.peek()!.startsWith('browser:') ? [d.path.peek()!] : []))
  )
  const [o, setO] = useState<BatchOptions>(() => ({ ...DEFAULT_BATCH, suffix: t(DEFAULT_BATCH.suffix) }))
  const set = (patch: Partial<BatchOptions>): void => setO({ ...o, ...patch })
  const progress = batchProgress.value
  const close = (): void => {
    if (!progress) batchOpen.value = false
  }

  const add = async (): Promise<void> => {
    const picked = await platform.openDialog({ multiple: true, filters: [{ name: t('Images'), extensions: IMAGE_EXTS }] })
    setFiles([...new Set([...files, ...picked])])
  }
  const run = async (): Promise<void> => {
    const failed = await runBatch(files, o)
    batchOpen.value = false
    if (failed.length) await alertDialog(t('{failed} of {count, plural, one {# image} other {# images}} failed', { failed: failed.length, count: files.length }), failed.join('\n'))
    else toast(t('{count, plural, one {Processed # image} other {Processed # images}}', { count: files.length }))
  }
  const nothing = files.every((f) => isNoop(o, f))

  return (
    <Modal
      title={t('Batch edit images')}
      wide
      onClose={close}
      footer={
        <>
          <button class="btn" disabled={!!progress} onClick={close}>
            {t('Cancel')}
          </button>
          <button class="btn primary" disabled={!files.length || nothing || !!progress} onClick={() => void run()}>
            {progress
              ? t('Processing {done} of {total}…', { done: progress.done + 1, total: progress.total })
              : t('{count, plural, one {Process # image} other {Process # images}}', { count: files.length })}
          </button>
        </>
      }
    >
      <div class="batch">
        <div class="batch-files">
          <div class="batch-files-head">
            <span class="flyout-label">{files.length ? t('{count, plural, one {# image} other {# images}}', { count: files.length }) : t('No images yet')}</span>
            <button class="btn" onClick={() => void add()}>
              {t('Add images…')}
            </button>
          </div>
          <ul class="match-list" aria-label={t('Images')}>
            {files.map((f) => (
              <li key={f} class="check-row match">
                <span class="match-text" title={f}>
                  {platform.baseName(f)}
                </span>
                <button class="icon-button small" aria-label={t('Remove {file}', { file: platform.baseName(f) })} onClick={() => setFiles(files.filter((x) => x !== f))}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div class="batch-options">
          <label class="field">
            <span>{t('Rotate')}</span>
            <select value={o.rotate} onChange={(e) => set({ rotate: Number((e.target as HTMLSelectElement).value) as BatchOptions['rotate'] })}>
              <option value={0}>{t('Don’t rotate')}</option>
              <option value={270}>{t('Rotate left')}</option>
              <option value={90}>{t('Rotate right')}</option>
              <option value={180}>{t('Rotate 180°')}</option>
            </select>
          </label>
          <label class="field">
            <span>{t('Flip')}</span>
            <select value={o.flip} onChange={(e) => set({ flip: (e.target as HTMLSelectElement).value as BatchOptions['flip'] })}>
              <option value="none">{t('Don’t flip')}</option>
              <option value="horizontal">{t('Flip horizontal')}</option>
              <option value="vertical">{t('Flip vertical')}</option>
            </select>
          </label>
          <label class="field">
            <span>{t('Resize')}</span>
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
              <option value="none">{t('Keep size')}</option>
              <option value="fit:3840x2160">{t('Fit into {width} × {height} (4K)', { width: '3840', height: '2160' })}</option>
              <option value="fit:1920x1080">{t('Fit into {width} × {height} (HD)', { width: '1920', height: '1080' })}</option>
              <option value="fit:1280x1280">{t('Fit into {width} × {height}', { width: '1280', height: '1280' })}</option>
              <option value="fit:800x800">{t('Fit into {width} × {height}', { width: '800', height: '800' })}</option>
              <option value="pct:75">75%</option>
              <option value="pct:50">50%</option>
              <option value="pct:25">25%</option>
            </select>
          </label>
          <label class="field">
            <span>{t('Format')}</span>
            <select value={o.format} onChange={(e) => set({ format: (e.target as HTMLSelectElement).value as BatchFormat })}>
              {FORMATS.map(([id, label]) => (
                <option key={id} value={id}>
                  {t(label)}
                </option>
              ))}
            </select>
          </label>
          {(o.format === 'jpg' || o.format === 'keep') && (
            <label class="field">
              <span>{t('JPEG quality: {quality}', { quality: o.quality })}</span>
              <input type="range" min={10} max={100} value={o.quality} onInput={(e) => set({ quality: Number((e.target as HTMLInputElement).value) })} />
            </label>
          )}
          <label class="check-row">
            <input type="checkbox" checked={o.removeLocation} onChange={(e) => set({ removeLocation: (e.target as HTMLInputElement).checked })} /> {t('Remove location')}
          </label>
          <label class="field">
            <span>{t('Save')}</span>
            <select value={o.output} onChange={(e) => set({ output: (e.target as HTMLSelectElement).value as BatchOptions['output'] })}>
              <option value="suffix">{t('As copies next to the originals, named “… (edited)”')}</option>
              <option value="replace">{t('Replace the originals')}</option>
            </select>
          </label>
          <p class="muted small">
            {t(
              'Rotating, resizing or converting re-encodes the images without their EXIF details (camera, date, location). Only removing location keeps the rest of the details.'
            )}
          </p>
        </div>
      </div>
      {progress && <progress class="batch-progress" value={progress.done} max={progress.total} aria-label={t('Processing {file}', { file: progress.current })} />}
    </Modal>
  )
}
