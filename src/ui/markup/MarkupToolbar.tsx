import { useEffect, useState } from 'preact/hooks'
import { COLORS, type Color, type Markup } from '../../core/markup'
import { activeDoc, type PdfDoc } from '../../state/documents'
import {
  activeSignature,
  css,
  highlightColor,
  markupBar,
  selectedId,
  setTool,
  signatureDialog,
  style,
  textStyle,
  tool,
  type Tool
} from '../../state/markupState'
import { deleteSignature, listSignatures, type SavedSignature } from '../../platform'
import { markSelection, type TextMarkupKind } from './textSelection'
import { Icon } from '../Icon'
import type { IconName } from '../icons'
import { Popover } from './Popover'

const SHAPES: [Tool, IconName, string][] = [
  ['rect', 'square', 'Rectangle'],
  ['roundRect', 'roundRect', 'Rounded rectangle'],
  ['oval', 'oval', 'Oval'],
  ['line', 'line', 'Line'],
  ['arrow', 'arrow', 'Arrow'],
  ['star', 'star', 'Star'],
  ['polygon', 'polygon', 'Polygon (click points, double-click to finish)'],
  ['bubble', 'bubble', 'Speech bubble']
]

const PALETTE: Color[] = [COLORS.red, COLORS.orange, COLORS.yellow, COLORS.green, COLORS.blue, COLORS.purple, COLORS.black, COLORS.white]
const WIDTHS = [0.5, 1, 2, 3, 5, 8, 12]

function ToolButton({ t, icon, label }: { t: Tool; icon: IconName; label: string }) {
  return (
    <button class={`tb-button ${tool.value === t ? 'pressed' : ''}`} title={label} aria-label={label} aria-pressed={tool.value === t} onClick={() => setTool(tool.value === t ? 'select' : t)}>
      <Icon name={icon} />
    </button>
  )
}

function Swatches({ value, onPick, allowNone }: { value: Color | null; onPick: (c: Color | null) => void; allowNone?: boolean }) {
  return (
    <div class="swatches" role="listbox">
      {allowNone && (
        <button class={`swatch none ${value === null ? 'selected' : ''}`} aria-label="No color" onClick={() => onPick(null)} />
      )}
      {PALETTE.map((c) => (
        <button
          key={c.join()}
          class={`swatch ${value && value.join() === c.join() ? 'selected' : ''}`}
          style={{ background: css(c) }}
          aria-label={`Color ${c.map((v) => Math.round(v * 255)).join(', ')}`}
          onClick={() => onPick(c)}
        />
      ))}
    </div>
  )
}

/** Updates the default style and, if something is selected, that markup too. */
function restyle(doc: PdfDoc | null, patch: Partial<Markup['style']>, textPatch?: Partial<{ fontSize: number; color: Color }>): void {
  style.value = { ...style.value, ...patch }
  if (textPatch) textStyle.value = { ...textStyle.value, ...textPatch }
  const id = selectedId.peek()
  if (!doc || !id) return
  const list = doc.markup.peek()
  const next = list.map((m) => {
    if (m.id !== id) return m
    const out = { ...m, style: { ...m.style, ...patch } } as Markup
    if (out.type === 'text' && textPatch) Object.assign(out, textPatch)
    return out
  })
  doc.edit('Change Style', { markup: next })
}

function selectedMarkup(doc: PdfDoc | null): Markup | undefined {
  return doc?.markup.value.find((m) => m.id === selectedId.value)
}

function textMarkup(doc: PdfDoc | null, kind: TextMarkupKind): void {
  const root = document.querySelector<HTMLElement>('.pdf-scroller')
  if (doc && root && markSelection(doc, root, kind)) return
  setTool(tool.value === kind ? 'select' : kind)
}

function Signatures({ close }: { close: () => void }) {
  const [sigs, setSigs] = useState<SavedSignature[] | null>(null)
  useEffect(() => {
    void listSignatures().then(setSigs)
  }, [signatureDialog.value])
  return (
    <div class="sig-menu">
      {sigs === null && <p class="muted">Loading…</p>}
      {sigs?.map((s) => (
        <div class="sig-item" key={s.id}>
          <button
            class="sig-pick"
            onClick={() => {
              activeSignature.value = s
              setTool('signature')
              close()
            }}
          >
            <img src={`data:image/png;base64,${s.png}`} alt={s.name} />
            <span>{s.name}</span>
          </button>
          <button
            class="icon-button"
            aria-label={`Delete signature ${s.name}`}
            onClick={async () => {
              await deleteSignature(s.id)
              if (activeSignature.peek()?.id === s.id) activeSignature.value = null
              setSigs(await listSignatures())
            }}
          >
            <Icon name="trash" size={16} />
          </button>
        </div>
      ))}
      {sigs?.length === 0 && <p class="muted">No saved signatures yet.</p>}
      <button
        class="btn"
        onClick={() => {
          close()
          signatureDialog.value = true
        }}
      >
        Create signature…
      </button>
      <p class="muted small">Signatures are encrypted with your Windows account and never leave this PC.</p>
    </div>
  )
}

export function MarkupToolbar() {
  const doc = activeDoc.value
  if (!markupBar.value || doc?.kind !== 'pdf') return null
  const sel = selectedMarkup(doc)
  const st = sel?.style ?? style.value
  const ts = sel?.type === 'text' ? { fontSize: sel.fontSize, color: sel.color } : textStyle.value
  const shapeTool = SHAPES.find(([t]) => t === tool.value)
  return (
    <div class="markup-toolbar" role="toolbar" aria-label="Markup">
      <ToolButton t="select" icon="cursor" label="Select and move markup" />
      <span class="tb-sep" />
      <ToolButton t="sketch" icon="sketch" label="Sketch (shapes are recognized)" />
      <ToolButton t="draw" icon="draw" label="Draw" />
      <Popover icon={shapeTool?.[1] ?? 'shapes'} label="Shapes" pressed={!!shapeTool}>
        {(close) => (
          <div class="shape-grid">
            {SHAPES.map(([t, icon, label]) => (
              <button
                key={t}
                class={`tb-button ${tool.value === t ? 'pressed' : ''}`}
                title={label}
                aria-label={label}
                onClick={() => {
                  setTool(t)
                  close()
                }}
              >
                <Icon name={icon} />
              </button>
            ))}
          </div>
        )}
      </Popover>
      <ToolButton t="text" icon="textBox" label="Text box" />
      <ToolButton t="note" icon="note" label="Note" />
      <span class="tb-sep" />
      <button class={`tb-button ${tool.value === 'highlight' ? 'pressed' : ''}`} title="Highlight selected text" aria-label="Highlight" onClick={() => textMarkup(doc, 'highlight')}>
        <Icon name="highlight" />
        <span class="swatch-bar" style={{ background: css(highlightColor.value) }} />
      </button>
      <Popover icon="underline" label="Highlight color, underline and strikethrough">
        {(close) => (
          <div class="flyout-col">
            <Swatches value={highlightColor.value} onPick={(c) => c && (highlightColor.value = c)} />
            <button class="menu-item" onClick={() => (textMarkup(doc, 'underline'), close())}>
              <Icon name="underline" size={16} /> <span>Underline</span>
            </button>
            <button class="menu-item" onClick={() => (textMarkup(doc, 'strike'), close())}>
              <Icon name="strike" size={16} /> <span>Strikethrough</span>
            </button>
          </div>
        )}
      </Popover>
      <Popover icon="signature" label="Sign" pressed={tool.value === 'signature'}>
        {(close) => <Signatures close={close} />}
      </Popover>
      <button
        class={`tb-button ${tool.value === 'redact' ? 'pressed' : ''}`}
        title="Redact: drag over an area, or select text"
        aria-label="Redact"
        onClick={() => textMarkup(doc, 'redact')}
      >
        <Icon name="redact" />
      </button>
      <span class="tb-sep" />
      <Popover icon="lineWidth" label="Line width">
        {() => (
          <div class="width-list">
            {WIDTHS.map((w) => (
              <button key={w} class={`width-item ${st.width === w ? 'selected' : ''}`} onClick={() => restyle(doc, { width: w })}>
                <span style={{ height: Math.max(1, w), background: 'currentColor' }} />
                <small>{w} pt</small>
              </button>
            ))}
          </div>
        )}
      </Popover>
      <Popover icon="strokeColor" label="Border color" swatch={css(st.stroke)}>
        {() => <Swatches value={st.stroke} allowNone onPick={(c) => restyle(doc, { stroke: c })} />}
      </Popover>
      <Popover icon="fillColor" label="Fill color" swatch={st.fill ? css(st.fill) : 'transparent'}>
        {() => <Swatches value={st.fill} allowNone onPick={(c) => restyle(doc, { fill: c })} />}
      </Popover>
      <Popover icon="textStyle" label="Text style">
        {() => (
          <div class="flyout-col">
            <label class="field">
              <span>Size</span>
              <select value={ts.fontSize} onChange={(e) => restyle(doc, {}, { fontSize: Number((e.target as HTMLSelectElement).value) })}>
                {[8, 9, 10, 11, 12, 14, 16, 18, 24, 32, 48, 72].map((n) => (
                  <option key={n} value={n}>
                    {n} pt
                  </option>
                ))}
              </select>
            </label>
            <Swatches value={ts.color} onPick={(c) => c && restyle(doc, {}, { color: c })} />
          </div>
        )}
      </Popover>
      <div class="tb-spacer" />
      <button class="tb-button" title="Hide markup toolbar (Ctrl+Shift+A)" aria-label="Hide markup toolbar" onClick={() => {
          setTool('select')
          markupBar.value = false
        }}>
        <Icon name="close" />
      </button>
    </div>
  )
}
