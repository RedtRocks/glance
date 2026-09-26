import { useEffect, useState } from 'preact/hooks'
import * as platform from '../../platform'
import { importFromScanner, type ScanSource } from '../../state/scanActions'
import { scanOpen, toast, withBusy } from '../../state/ui'
import { Modal } from './Dialog'

const RESOLUTIONS = [150, 200, 300, 600]

/** File → Import from Scanner. */
export function ScanDialog() {
  const [scanners, setScanners] = useState<platform.ScannerInfo[] | null>(null)
  const [id, setId] = useState('')
  const [source, setSource] = useState<ScanSource>('auto')
  const [dpi, setDpi] = useState(300)
  const [asPdf, setAsPdf] = useState(true)
  const close = (): void => void (scanOpen.value = false)

  const refresh = (): void => {
    setScanners(null)
    platform
      .listScanners()
      .then((list) => {
        setScanners(list)
        setId((cur) => (list.some((s) => s.id === cur) ? cur : (list[0]?.id ?? '')))
      })
      .catch((e) => {
        setScanners([])
        toast(`Couldn’t look for scanners: ${(e as Error).message ?? e}`, 'error')
      })
  }
  useEffect(refresh, [])

  const scanner = scanners?.find((s) => s.id === id)
  useEffect(() => {
    if (scanner && source !== 'auto' && !scanner.sources.includes(source)) setSource('auto')
  }, [scanner, source])

  const run = async (): Promise<void> => {
    close()
    try {
      await withBusy('Scanning…', () => importFromScanner(id, source, dpi, asPdf))
    } catch (e) {
      toast(`Scanning failed: ${(e as Error).message ?? e}`, 'error')
    }
  }

  return (
    <Modal
      title="Import from scanner"
      onClose={close}
      footer={
        <>
          <button class="btn" onClick={refresh}>
            Refresh
          </button>
          <button class="btn" onClick={close}>
            Cancel
          </button>
          <button class="btn primary" disabled={!scanner} onClick={() => void run()}>
            Scan
          </button>
        </>
      }
    >
      <div class="batch-options scan-options">
        {scanners === null && <p class="muted">Looking for scanners…</p>}
        {scanners?.length === 0 && (
          <p class="muted">
            No scanners found. Make sure the scanner is on and connected, and that it appears in Settings → Bluetooth &amp; devices → Printers &amp;
            scanners.
          </p>
        )}
        {scanners && scanners.length > 0 && (
          <>
            <label class="field">
              <span>Scanner</span>
              <select value={id} onChange={(e) => setId((e.target as HTMLSelectElement).value)}>
                {scanners.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label class="field">
              <span>Source</span>
              <select value={source} onChange={(e) => setSource((e.target as HTMLSelectElement).value as ScanSource)}>
                <option value="auto">Automatic</option>
                {scanner?.sources.includes('flatbed') && <option value="flatbed">Flatbed (glass)</option>}
                {scanner?.sources.includes('feeder') && <option value="feeder">Document feeder (all pages)</option>}
              </select>
            </label>
            <label class="field">
              <span>Resolution</span>
              <select value={dpi} onChange={(e) => setDpi(Number((e.target as HTMLSelectElement).value))}>
                {RESOLUTIONS.map((r) => (
                  <option key={r} value={r}>
                    {r} dpi{r === 300 ? ' (documents)' : r === 600 ? ' (photos)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label class="check-row">
              <input type="checkbox" checked={asPdf} onChange={(e) => setAsPdf((e.target as HTMLInputElement).checked)} />
              <span>Combine pages into one PDF</span>
            </label>
          </>
        )}
      </div>
    </Modal>
  )
}
