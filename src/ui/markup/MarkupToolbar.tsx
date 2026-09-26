import { useEffect, useState } from 'preact/hooks'
import { COLORS, fontStack, type Color, type Markup } from '../../core/markup'
import { activeDoc, ImageDoc, PdfDoc, type MarkupHost } from '../../state/documents'
import { adjustColorOpen, adjustSizeOpen } from '../../state/imageState'
import { copySubject, cropToSelection, removeBackground } from '../../state/imageActions'
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
  type TextStyle,
  type Tool
} from '../../state/markupState'
import { deleteSignature, listFonts, listSignatures, type SavedSignature } from '../../platform'
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

const IMAGE_SELECT: [Tool, IconName, string][] = [
  ['selectRect', 'selectRect', 'Rectangular selection'],
  ['selectEllipse', 'selectEllipse', 'Elliptical selection'],
  ['lasso', 'lasso', 'Lasso selection'],
  ['smartLasso', 'smartLasso', 'Smart lasso (snaps to edges)']
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

const HIGHLIGHT_COLORS: Color[] = [COLORS.yellow, [0.47, 0.87, 0.36], [0.4, 0.73, 1], [1, 0.5, 0.75], [0.75, 0.55, 1], COLORS.orange]
const TEXT_MARKS = ['highlight', 'underline', 'strike', 'squiggly']

const hex = (c: Color) => '#' + c.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')
const fromHex = (h: string): Color => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as Color

function Swatches({ value, onPick, allowNone, colors = PALETTE }: { value: Color | null; onPick: (c: Color | null) => void; allowNone?: boolean; colors?: Color[] }) {
  const custom = value && !colors.some((c) => c.join() === value.join())
  return (
    <div class="swatches" role="listbox">
      {allowNone && (
        <button class={`swatch none ${value === null ? 'selected' : ''}`} aria-label="No color" onClick={() => onPick(null)} />
      )}
      {colors.map((c) => (
        <button
          key={c.join()}
          class={`swatch ${value && value.join() === c.join() ? 'selected' : ''}`}
          style={{ background: css(c) }}
          aria-label={`Color ${c.map((v) => Math.round(v * 255)).join(', ')}`}
          onClick={() => onPick(c)}
        />
      ))}
      {/* Any other color, through the system color picker. */}
      <label class={`swatch custom ${custom ? 'selected' : ''}`} title="More colors" style={custom ? { background: css(value) } : undefined}>
        <input type="color" aria-label="More colors" value={value ? hex(value) : '#000000'} onChange={(e) => onPick(fromHex((e.target as HTMLInputElement).value))} />
      </label>
    </div>
  )
}

/** Installed font families; the first entry is Helvetica, the PDF standard font. */
function FontPicker({ value, onPick }: { value?: string; onPick: (font: string | undefined) => void }) {
  const [fonts, setFonts] = useState<string[]>([])
  useEffect(() => {
    void listFonts().then(setFonts)
  }, [])
  const list = value && !fonts.includes(value) ? [value, ...fonts] : fonts
  return (
    <label class="field">
      <span>Font</span>
      <select
        class="font-select"
        value={value ?? ''}
        style={{ fontFamily: fontStack(value) }}
        onChange={(e) => onPick((e.target as HTMLSelectElement).value || undefined)}
      >
        <option value="" style={{ fontFamily: fontStack() }}>
          Helvetica
        </option>
        {list.map((f) => (
          <option key={f} value={f} style={{ fontFamily: fontStack(f) }}>
            {f}
          </option>
        ))}
      </select>
    </label>
  )
}

/** Updates the default style and, if something is selected, that markup too. */
function restyle(doc: MarkupHost | null, patch: Partial<Markup['style']>, textPatch?: Partial<TextStyle>): void {
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

/** Picks the highlight color; a selected highlight/underline is recolored too. */
function pickMarkColor(doc: MarkupHost | null, c: Color): void {
  const sel = selectedMarkup(doc)
  if (!sel || sel.type === 'highlight') highlightColor.value = c
  if (doc && sel && TEXT_MARKS.includes(sel.type)) {
    doc.edit('Change Color', { markup: doc.markup.peek().map((m) => (m.id === sel.id ? { ...m, style: { ...m.style, stroke: c } } : m)) })
  }
}

function selectedMarkup(doc: MarkupHost | null): Markup | undefined {
  return doc?.markup.value.find((m) => m.id === selectedId.value)
}

function textMarkup(doc: MarkupHost | null, kind: TextMarkupKind): void {
  const root = document.querySelector<HTMLElement>('.pdf-scroller')
  if (doc instanceof PdfDoc && root && markSelection(doc, root, kind)) return
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

function ActionButton({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) {
  return (
    <button class="tb-button" title={label} aria-label={label} onClick={onClick}>
      <Icon name={icon} />
    </button>
  )
}

export function MarkupToolbar() {
  const active = activeDoc.value
  const image = active instanceof ImageDoc && active.editable ? active : null
  const doc = active?.kind === 'pdf' ? active : image
  if (!markupBar.value || !doc) return null
  const selectTool = IMAGE_SELECT.find(([t]) => t === tool.value)
  const sel = selectedMarkup(doc)
  const st = sel?.style ?? style.value
  const ts: TextStyle = sel?.type === 'text' ? { fontSize: sel.fontSize, color: sel.color, font: sel.font } : textStyle.value
  const shapeTool = SHAPES.find(([t]) => t === tool.value)
  const markColor = sel && TEXT_MARKS.includes(sel.type) && sel.style.stroke ? sel.style.stroke : highlightColor.value
  return (
    <div class="markup-toolbar" role="toolbar" aria-label="Markup">
      <ToolButton t="select" icon="cursor" label="Select and move markup" />
      {image && (
        <>
          <Popover icon={selectTool?.[1] ?? 'selectRect'} label="Selection tools" pressed={!!selectTool}>
            {(close) => (
              <div class="flyout-col">
                {IMAGE_SELECT.map(([t, icon, label]) => (
                  <button
                    key={t}
                    class="menu-item"
                    onClick={() => {
                      setTool(t)
                      close()
                    }}
                  >
                    <Icon name={icon} size={16} /> <span>{label}</span>
                  </button>
                ))}
              </div>
            )}
          </Popover>
          <ToolButton t="instantAlpha" icon="instantAlpha" label="Instant Alpha: drag over a color to select it" />
        </>
      )}
      <span class="tb-sep" />
      <ToolButton t="sketch" icon="sketch" label="Sketch (shapes are recognized)" />
      <ToolButton t="draw" icon="draw" label="Draw" />
      <Popover icon={shapeTool?.[1] ?? 'shapes'} label="Shapes" pressed={!!shapeTool}>
        {(close) => (
          <div class="shape-grid">
            {[...SHAPES, ...(image ? ([['loupe', 'zoomIn', 'Loupe (magnifier)']] as [Tool, IconName, string][]) : [])].map(([t, icon, label]) => (
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
      {!image && <ToolButton t="note" icon="note" label="Note" />}
      <span class="tb-sep" />
      {!image && <button class={`tb-button ${tool.value === 'highlight' ? 'pressed' : ''}`} title="Highlight selected text" aria-label="Highlight" onClick={() => textMarkup(doc, 'highlight')}>
        <Icon name="highlight" />
        <span class="swatch-bar" style={{ background: css(markColor) }} />
      </button>}
      {!image && (
        <Popover icon="underline" label="Highlight color, underline, strikethrough and squiggly underline">
          {(close) => (
            <div class="flyout-col">
              <span class="flyout-label">Highlight color</span>
              <Swatches colors={HIGHLIGHT_COLORS} value={markColor} onPick={(c) => c && pickMarkColor(doc, c)} />
              <span class="menu-sep" />
              {(
                [
                  ['underline', 'underline', 'Underline'],
                  ['strike', 'strike', 'Strikethrough'],
                  ['squiggly', 'squiggly', 'Squiggly underline']
                ] as [TextMarkupKind, IconName, string][]
              ).map(([k, icon, label]) => (
                <button key={k} class={`menu-item ${tool.value === k ? 'checked' : ''}`} onClick={() => (textMarkup(doc, k), close())}>
                  <Icon name={icon} size={16} /> <span>{label}</span>
                </button>
              ))}
            </div>
          )}
        </Popover>
      )}
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
            <FontPicker value={ts.font} onPick={(font) => restyle(doc, {}, { font })} />
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
      {image && (
        <>
          <span class="tb-sep" />
          <ActionButton icon="crop" label="Crop to selection (Ctrl+K)" onClick={() => void cropToSelection(image)} />
          <ActionButton icon="adjustColor" label="Adjust color (Ctrl+Shift+C)" onClick={() => (adjustColorOpen.value = true)} />
          <ActionButton icon="adjustSize" label="Adjust size (Ctrl+Shift+U)" onClick={() => (adjustSizeOpen.value = true)} />
          <ActionButton icon="removeBg" label="Remove background (Ctrl+Shift+K)" onClick={() => void removeBackground(image)} />
          <ActionButton icon="copySubject" label="Copy subject" onClick={() => void copySubject(image)} />
        </>
      )}
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
