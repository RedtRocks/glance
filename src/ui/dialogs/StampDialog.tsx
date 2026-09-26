import { useEffect, useRef, useState } from 'preact/hooks'
import type { PdfDoc } from '../../state/documents'
import { DEFAULT_STAMPS, hasStamps, parsePageRange, type Slot, type StampEnv, type StampFont, type StampOptions, type TextWatermark } from '../../core/stampOptions'
import { openPdf } from '../../pdf/engine'
import * as platform from '../../platform'
import { stampOpen, toast, withBusy } from '../../state/ui'
import { Modal } from './Dialog'

const KEY = 'glance.stamps.v1'
const PREVIEW_WIDTH = 300
const TOKENS: [string, string][] = [
  ['{page}', 'Page number'],
  ['{pages}', 'Page count'],
  ['{date}', 'Date'],
  ['{file}', 'File name']
]
const TEXT_WATERMARK: TextWatermark = { kind: 'text', text: 'CONFIDENTIAL', size: 0, angle: 45, color: '#808080' }

/** Last used options (without an image watermark, which isn't worth storing). */
function loadOptions(): StampOptions {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...DEFAULT_STAMPS, ...JSON.parse(raw), pages: '', startNumber: 1 }
  } catch {
    /* storage unavailable */
  }
  return DEFAULT_STAMPS
}
function saveOptions(o: StampOptions): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...o, watermark: o.watermark?.kind === 'image' ? null : o.watermark }))
  } catch {
    /* storage unavailable */
  }
}

function env(doc: PdfDoc): StampEnv {
  return { fileName: doc.name.peek(), date: new Date().toLocaleDateString(), loadFont: platform.fontBytes }
}

/** Pages → Header, Footer & Watermark: page numbers, running text and a watermark. */
export function StampDialog({ doc }: { doc: PdfDoc }) {
  const [o, setO] = useState<StampOptions>(loadOptions)
  const [tab, setTab] = useState<'text' | 'watermark' | 'pages'>('text')
  const [focused, setFocused] = useState<[ 'header' | 'footer', Slot]>(['footer', 'center'])
  const [lastText, setLastText] = useState<TextWatermark>(o.watermark?.kind === 'text' ? o.watermark : TEXT_WATERMARK)
  const [previewPage, setPreviewPage] = useState(0)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const inputs = useRef(new Map<string, HTMLInputElement>())
  const pageBytes = useRef(new Map<number, Promise<Uint8Array>>())
  const close = (): void => void (stampOpen.value = false)
  const set = (patch: Partial<StampOptions>): void => setO((prev) => ({ ...prev, ...patch }))
  const pageCount = doc.pageCount.peek()
  const selected = parsePageRange(o.pages, pageCount)
  const shown = selected?.includes(previewPage) ? previewPage : (selected?.[0] ?? 0)

  // Live preview: stamp just the shown page and render it.
  useEffect(() => {
    let alive = true
    const timer = setTimeout(async () => {
      try {
        const { extractPage, stampPdf } = await import('../../core/stamps')
        let page = pageBytes.current.get(shown)
        if (!page) pageBytes.current.set(shown, (page = doc.currentBytes().then((b) => extractPage(b, shown))))
        const stamped = await stampPdf(await page, { ...o, pages: selected ? o.pages : '' }, env(doc), { index: shown, pageCount })
        const proxy = await openPdf(stamped)
        try {
          const p = await proxy.getPage(1)
          const scale = (PREVIEW_WIDTH * (window.devicePixelRatio || 1)) / p.getViewport({ scale: 1 }).width
          const viewport = p.getViewport({ scale })
          const c = canvas.current
          if (!alive || !c) return
          const off = document.createElement('canvas')
          off.width = Math.round(viewport.width)
          off.height = Math.round(viewport.height)
          await p.render({ canvas: off, viewport, background: 'white' }).promise
          if (!alive) return
          c.width = off.width
          c.height = off.height
          c.style.width = `${PREVIEW_WIDTH}px`
          c.getContext('2d')!.drawImage(off, 0, 0)
          setPreviewError(null)
        } finally {
          void proxy.loadingTask.destroy()
        }
      } catch (e) {
        if (alive) setPreviewError((e as Error).message ?? String(e))
      }
    }, 150)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [o, shown])

  const insertToken = (token: string): void => {
    const [row, slot] = focused
    const el = inputs.current.get(`${row}.${slot}`)
    const value = o[row][slot]
    const at = el?.selectionStart ?? value.length
    const end = el?.selectionEnd ?? at
    set({ [row]: { ...o[row], [slot]: value.slice(0, at) + token + value.slice(end) } })
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(at + token.length, at + token.length)
    })
  }

  const pickImage = async (): Promise<void> => {
    const [path] = await platform.openDialog({ multiple: false, filters: [{ name: 'PNG or JPEG images', extensions: ['png', 'jpg', 'jpeg'] }] })
    if (!path) return
    const bytes = await platform.readFile(path)
    const type = bytes[0] === 0x89 && bytes[1] === 0x50 ? 'png' : bytes[0] === 0xff && bytes[1] === 0xd8 ? 'jpg' : null
    if (!type) return toast('Choose a PNG or JPEG image.', 'error')
    set({ watermark: { kind: 'image', bytes, type, scale: 0.5 } })
  }

  const apply = async (): Promise<void> => {
    close()
    saveOptions(o)
    try {
      await withBusy('Adding header, footer and watermark…', () =>
        doc.apply('Header, Footer & Watermark', async (bytes) => (await import('../../core/stamps')).stampPdf(bytes, o, env(doc)))
      )
      toast('Added to the pages. Save to keep the result, or undo to remove it.')
    } catch (e) {
      toast((e as Error).message ?? String(e), 'error')
    }
  }

  const row = (name: 'header' | 'footer', label: string) => (
    <div class="field">
      <span>{label}</span>
      <div class="stamp-row">
        {(['left', 'center', 'right'] as Slot[]).map((slot) => (
          <input
            key={slot}
            type="text"
            aria-label={`${label} ${slot}`}
            placeholder={slot[0].toUpperCase() + slot.slice(1)}
            value={o[name][slot]}
            ref={(el) => void (el ? inputs.current.set(`${name}.${slot}`, el) : inputs.current.delete(`${name}.${slot}`))}
            onFocus={() => setFocused([name, slot])}
            onInput={(e) => set({ [name]: { ...o[name], [slot]: (e.target as HTMLInputElement).value } })}
          />
        ))}
      </div>
    </div>
  )

  const wm = o.watermark
  const index = selected?.indexOf(shown) ?? -1
  return (
    <Modal
      title="Header, footer & watermark"
      wide
      class="stamp-modal"
      onClose={close}
      footer={
        <>
          <button class="btn" onClick={close}>
            Cancel
          </button>
          <button class="btn primary" disabled={!selected?.length || !hasStamps(o)} onClick={() => void apply()}>
            Add
          </button>
        </>
      }
    >
      <div class="stamp">
        <div class="stamp-preview">
          <canvas ref={canvas} aria-label="Preview" />
          {previewError && <p class="field-error small">{previewError}</p>}
          {selected && selected.length > 1 && (
            <div class="stamp-pager">
              <button class="btn" disabled={index <= 0} onClick={() => setPreviewPage(selected[index - 1])}>
                Previous
              </button>
              <span class="muted">Page {shown + 1}</span>
              <button class="btn" disabled={index >= selected.length - 1} onClick={() => setPreviewPage(selected[index + 1])}>
                Next
              </button>
            </div>
          )}
        </div>
        <div class="batch-options">
          <div class="segmented" role="tablist">
            <button role="tab" aria-selected={tab === 'text'} onClick={() => setTab('text')}>Header & footer</button>
            <button role="tab" aria-selected={tab === 'watermark'} onClick={() => setTab('watermark')}>Watermark</button>
            <button role="tab" aria-selected={tab === 'pages'} onClick={() => setTab('pages')}>Pages</button>
          </div>
          {tab === 'text' && (
            <>
              {row('header', 'Header')}
              {row('footer', 'Footer')}
              <div class="stamp-tokens" aria-label="Insert into the selected box">
                {TOKENS.map(([token, label]) => (
                  <button key={token} class="btn" title={`Insert ${token}`} onPointerDown={(e) => e.preventDefault()} onClick={() => insertToken(token)}>
                    {label}
                  </button>
                ))}
              </div>
              <div class="stamp-row">
                <label class="field">
                  <span>Font</span>
                  <select value={o.font} onChange={(e) => set({ font: (e.target as HTMLSelectElement).value as StampFont })}>
                    <option value="Helvetica">Sans serif</option>
                    <option value="Times">Serif</option>
                    <option value="Courier">Monospace</option>
                  </select>
                </label>
                <label class="field">
                  <span>Size</span>
                  <select value={o.size} onChange={(e) => set({ size: Number((e.target as HTMLSelectElement).value) })}>
                    {[8, 9, 10, 11, 12, 14, 16, 18, 24].map((n) => (
                      <option key={n} value={n}>
                        {n} pt
                      </option>
                    ))}
                  </select>
                </label>
                <label class="field">
                  <span>Color</span>
                  <input type="color" value={o.color} onInput={(e) => set({ color: (e.target as HTMLInputElement).value })} />
                </label>
              </div>
              <label class="field">
                <span>Distance from edge</span>
                <select value={o.margin} onChange={(e) => set({ margin: Number((e.target as HTMLSelectElement).value) })}>
                  {[
                    [14, 'Small (5 mm)'],
                    [28, 'Medium (10 mm)'],
                    [43, 'Large (15 mm)'],
                    [72, 'Extra large (25 mm)']
                  ].map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          {tab === 'watermark' && (
            <>
              <label class="field">
                <span>Watermark</span>
                <select
                  value={wm?.kind ?? 'none'}
                  onChange={(e) => {
                    const v = (e.target as HTMLSelectElement).value
                    if (v === 'none') set({ watermark: null })
                    else if (v === 'text') set({ watermark: lastText })
                    else void pickImage()
                  }}
                >
                  <option value="none">None</option>
                  <option value="text">Text</option>
                  <option value="image">Image…</option>
                </select>
              </label>
              {wm?.kind === 'text' && (
                <>
                  <label class="field">
                    <span>Text</span>
                    <input
                      type="text"
                      value={wm.text}
                      onInput={(e) => {
                        const next = { ...wm, text: (e.target as HTMLInputElement).value }
                        setLastText(next)
                        set({ watermark: next })
                      }}
                    />
                  </label>
                  <div class="stamp-row">
                    <label class="field">
                      <span>Angle</span>
                      <select value={wm.angle} onChange={(e) => set({ watermark: { ...wm, angle: Number((e.target as HTMLSelectElement).value) } })}>
                        <option value={45}>Diagonal</option>
                        <option value={0}>Horizontal</option>
                        <option value={90}>Vertical</option>
                      </select>
                    </label>
                    <label class="field">
                      <span>Size</span>
                      <select value={wm.size} onChange={(e) => set({ watermark: { ...wm, size: Number((e.target as HTMLSelectElement).value) } })}>
                        <option value={0}>Fit page</option>
                        {[24, 36, 48, 72, 96].map((n) => (
                          <option key={n} value={n}>
                            {n} pt
                          </option>
                        ))}
                      </select>
                    </label>
                    <label class="field">
                      <span>Color</span>
                      <input type="color" value={wm.color} onInput={(e) => set({ watermark: { ...wm, color: (e.target as HTMLInputElement).value } })} />
                    </label>
                  </div>
                </>
              )}
              {wm?.kind === 'image' && (
                <div class="stamp-row">
                  <label class="field">
                    <span>Width</span>
                    <select value={wm.scale} onChange={(e) => set({ watermark: { ...wm, scale: Number((e.target as HTMLSelectElement).value) } })}>
                      {[0.25, 0.5, 0.75, 1].map((n) => (
                        <option key={n} value={n}>
                          {n * 100}% of page
                        </option>
                      ))}
                    </select>
                  </label>
                  <button class="btn stamp-change" onClick={() => void pickImage()}>
                    Change image…
                  </button>
                </div>
              )}
              {wm && (
                <label class="field">
                  <span>Opacity: {Math.round(o.opacity * 100)}%</span>
                  <input type="range" min={5} max={100} step={5} value={Math.round(o.opacity * 100)} onInput={(e) => set({ opacity: Number((e.target as HTMLInputElement).value) / 100 })} />
                </label>
              )}
            </>
          )}
          {tab === 'pages' && (
            <>
              <label class="field">
                <span>Pages</span>
                <input type="text" placeholder={`All ${pageCount} pages`} value={o.pages} onInput={(e) => set({ pages: (e.target as HTMLInputElement).value })} />
                {selected ? <small>For example 2-10 to skip a cover page, or 1, 3, 5-.</small> : <small class="field-error">Use page numbers and ranges, like 2-10 or 1, 3, 5-.</small>}
              </label>
              <label class="field">
                <span>Number the first page</span>
                <input type="number" min={0} value={o.startNumber} onInput={(e) => set({ startNumber: Math.max(0, Math.floor(Number((e.target as HTMLInputElement).value) || 0)) })} />
              </label>
            </>
          )}
          <p class="muted small">The text becomes part of the pages, so it prints and shows in every PDF app. You can undo this until you save.</p>
        </div>
      </div>
    </Modal>
  )
}
