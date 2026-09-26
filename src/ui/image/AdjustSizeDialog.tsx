import { useState } from 'preact/hooks'
import { FIT_PRESETS, describeBytes, fitInto, fromPixels, proportional, toPixels, type Unit } from '../../core/image/size'
import type { ImageDoc } from '../../state/documents'
import { adjustSizeOpen } from '../../state/imageState'
import { adjustSize } from '../../state/imageActions'
import { Modal } from '../dialogs/Dialog'

const UNITS: [Unit, string][] = [
  ['px', 'pixels'],
  ['percent', 'percent'],
  ['in', 'inches'],
  ['cm', 'cm'],
  ['mm', 'mm'],
  ['pt', 'points']
]

const round = (v: number, unit: Unit): number => (unit === 'px' ? Math.round(v) : Math.round(v * 100) / 100)

/** Preview's Adjust Size: fit-into presets, units, resolution, proportional scaling. */
export function AdjustSizeDialog({ doc }: { doc: ImageDoc }) {
  const nat = doc.natural.value ?? { width: 1, height: 1 }
  const [pxW, setPxW] = useState(nat.width)
  const [pxH, setPxH] = useState(nat.height)
  const [unit, setUnit] = useState<Unit>('px')
  const [dpi, setDpi] = useState(72)
  const [keep, setKeep] = useState(true)
  const [preset, setPreset] = useState('custom')
  const close = (): void => void (adjustSizeOpen.value = false)

  const setWidth = (v: number): void => {
    const px = Math.max(1, Math.round(toPixels(v, unit, dpi, nat.width)))
    setPxW(px)
    if (keep) setPxH(proportional(px, nat.width, nat.height))
    setPreset('custom')
  }
  const setHeight = (v: number): void => {
    const px = Math.max(1, Math.round(toPixels(v, unit, dpi, nat.height)))
    setPxH(px)
    if (keep) setPxW(proportional(px, nat.height, nat.width))
    setPreset('custom')
  }
  const choosePreset = (id: string): void => {
    setPreset(id)
    const p = FIT_PRESETS.find(([label]) => label === id)
    if (!p) return
    const [w, h] = fitInto(nat.width, nat.height, p[1], p[2])
    setPxW(w)
    setPxH(h)
  }
  const unchanged = pxW === nat.width && pxH === nat.height

  return (
    <Modal
      title="Adjust size"
      onClose={close}
      footer={
        <>
          <button class="btn" onClick={close}>Cancel</button>
          <button
            class="btn primary"
            disabled={unchanged}
            onClick={() => {
              close()
              void adjustSize(doc, pxW, pxH)
            }}
          >
            Resize
          </button>
        </>
      }
    >
      <label class="field">
        <span>Fit into</span>
        <select value={preset} onChange={(e) => choosePreset((e.target as HTMLSelectElement).value)}>
          <option value="custom">Custom</option>
          {FIT_PRESETS.map(([label]) => (
            <option key={label} value={label}>
              {label} pixels
            </option>
          ))}
        </select>
      </label>
      <div class="size-grid">
        <label class="field">
          <span>Width</span>
          <input type="number" min={0} step="any" value={round(fromPixels(pxW, unit, dpi, nat.width), unit)} onChange={(e) => setWidth(Number((e.target as HTMLInputElement).value))} />
        </label>
        <label class="field">
          <span>Height</span>
          <input type="number" min={0} step="any" value={round(fromPixels(pxH, unit, dpi, nat.height), unit)} onChange={(e) => setHeight(Number((e.target as HTMLInputElement).value))} />
        </label>
        <label class="field">
          <span>Units</span>
          <select value={unit} onChange={(e) => setUnit((e.target as HTMLSelectElement).value as Unit)}>
            {UNITS.map(([u, label]) => (
              <option key={u} value={u}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label class="field">
          <span>Resolution (pixels/inch)</span>
          <input type="number" min={1} value={dpi} onChange={(e) => setDpi(Math.max(1, Number((e.target as HTMLInputElement).value) || 72))} />
        </label>
      </div>
      <label class="check-row">
        <input type="checkbox" checked={keep} onChange={(e) => setKeep((e.target as HTMLInputElement).checked)} />
        <span>Scale proportionally</span>
      </label>
      <p class="muted">
        Current: {nat.width} × {nat.height} px ({describeBytes(nat.width, nat.height)}). New: {pxW} × {pxH} px ({describeBytes(pxW, pxH)}).
      </p>
    </Modal>
  )
}
