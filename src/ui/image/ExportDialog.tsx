import { useState } from 'preact/hooks'
import type { ImageDoc } from '../../state/documents'
import { exportOpen } from '../../state/imageState'
import { EXPORT_FORMATS, saveImageAs, type ExportFormat } from '../../state/imageActions'
import { Modal } from '../dialogs/Dialog'
import type { ColorProfile } from '../../platform'

/** File → Export for images: another format, without changing the open document. */
export function ExportDialog({ doc }: { doc: ImageDoc }) {
  const [format, setFormat] = useState<ExportFormat>('png')
  const [quality, setQuality] = useState(90)
  const [profile, setProfile] = useState<ColorProfile>('srgb')
  const profiles = ['png', 'jpg', 'tiff'].includes(format)
  const close = (): void => void (exportOpen.value = false)
  return (
    <Modal
      title="Export"
      onClose={close}
      footer={
        <>
          <button class="btn" onClick={close}>Cancel</button>
          <button
            class="btn primary"
            onClick={() => {
              close()
              void saveImageAs(doc, format, quality, false, profiles && profile !== 'srgb' ? profile : undefined)
            }}
          >
            Export…
          </button>
        </>
      }
    >
      <label class="field">
        <span>Format</span>
        <select value={format} onChange={(e) => setFormat((e.target as HTMLSelectElement).value as ExportFormat)}>
          {EXPORT_FORMATS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
      {format === 'jpg' && (
        <label class="field">
          <span>Quality: {quality}</span>
          <input type="range" min={10} max={100} value={quality} onInput={(e) => setQuality(Number((e.target as HTMLInputElement).value))} />
          <small>Higher quality means a larger file. JPEG has no transparency: transparent areas become white.</small>
        </label>
      )}
      {profiles && (
        <label class="field">
          <span>Color profile</span>
          <select value={profile} onChange={(e) => setProfile((e.target as HTMLSelectElement).value as ColorProfile)}>
            <option value="srgb">sRGB (web and most screens)</option>
            <option value="p3">Display P3 (wide color)</option>
            <option value="adobergb">Adobe RGB (1998) (print workflows)</option>
            <option value="gray">Gray (black and white)</option>
          </select>
          {profile !== 'srgb' && <small>Colors are converted into this profile and the profile is embedded in the file.</small>}
        </label>
      )}
      <p class="muted">Markup is flattened into the exported image. Metadata such as camera details and location isn’t copied.</p>
    </Modal>
  )
}
