import { useEffect, useState } from 'preact/hooks'
import { COLORS, fontStack, type Color, type Markup } from '../../core/markup'
import { activeDoc, ImageDoc, PdfDoc, type MarkupHost } from '../../state/documents'
import { adjustColorOpen, adjustSizeOpen } from '../../state/imageState'
import { copySubject, cropToSelection, removeBackground } from '../../state/imageActions'
import { runCommand } from '../../state/commands'
import {
  activeSignature,
  css,
  highlightColor,
  markupBar,
  restyle,
  selectedId,
  setTool,
  signatureDialog,
  style,
  textStyle,
  tool,
  WIDTHS,
  type TextStyle,
  type Tool
} from '../../state/markupState'
import { deleteSignature, listFonts, listSignatures, type SavedSignature } from '../../platform'
import { markSelection, type TextMarkupKind } from './textSelection'
import { Icon } from '../Icon'
import type { IconName } from '../icons'
import { Popover } from './Popover'
import { msg, t } from '../../i18n'
import { tip } from '../../state/commands'

const SHAPES: [Tool, IconName, string][] = [
  ['rect', 'square', msg('Rectangle')],
  ['roundRect', 'roundRect', msg('Rounded rectangle')],
  ['oval', 'oval', msg('Oval')],
  ['line', 'line', msg('Line')],
  ['arrow', 'arrow', msg('Arrow')],
  ['star', 'star', msg('Star')],
  ['polygon', 'polygon', msg('Polygon (click points, double-click to finish)')],
  ['bubble', 'bubble', msg('Speech bubble')]
]

const IMAGE_SELECT: [Tool, IconName, string][] = [
  ['selectRect', 'selectRect', msg('Rectangular selection')],
  ['selectEllipse', 'selectEllipse', msg('Elliptical selection')],
  ['lasso', 'lasso', msg('Lasso selection')],
  ['smartLasso', 'smartLasso', msg('Smart lasso (snaps to edges)')]
]

const PALETTE: Color[] = [COLORS.red, COLORS.orange, COLORS.yellow, COLORS.green, COLORS.blue, COLORS.purple, COLORS.black, COLORS.white]

/** The command whose shortcut picks each tool, for tooltips. Tools in a group share a key. */
const TOOL_COMMAND: Partial<Record<Tool, string>> = {
  select: 'tools.select',
  selectRect: 'tools.marquee',
  selectEllipse: 'tools.marquee',
  lasso: 'tools.lasso',
  smartLasso: 'tools.lasso',
  instantAlpha: 'tools.instantAlpha',
  draw: 'tools.brush',
  sketch: 'tools.brush',
  rect: 'tools.rectangle',
  oval: 'tools.oval',
  roundRect: 'tools.shapes',
  line: 'tools.shapes',
  arrow: 'tools.shapes',
  star: 'tools.shapes',
  polygon: 'tools.shapes',
  bubble: 'tools.shapes',
  text: 'tools.text',
  note: 'tools.note'
}
/** `label` is already translated. */
const toolTip = (id: Tool, label: string): string => tip(label, TOOL_COMMAND[id])

function ToolButton({ t: id, icon, label }: { t: Tool; icon: IconName; label: string }) {
  return (
    <button class={`tb-button ${tool.value === id ? 'pressed' : ''}`} title={toolTip(id, label)} aria-label={label} aria-pressed={tool.value === id} onClick={() => setTool(tool.value === id ? 'select' : id)}>
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
        <button class={`swatch none ${value === null ? 'selected' : ''}`} aria-label={t('No color')} onClick={() => onPick(null)} />
      )}
      {colors.map((c) => (
        <button
          key={c.join()}
          class={`swatch ${value && value.join() === c.join() ? 'selected' : ''}`}
          style={{ background: css(c) }}
          aria-label={t('Color {rgb}', { rgb: c.map((v) => Math.round(v * 255)).join(', ') })}
          onClick={() => onPick(c)}
        />
      ))}
      {/* Any other color, through the system color picker. */}
      <label class={`swatch custom ${custom ? 'selected' : ''}`} title={t('More colors')} style={custom ? { background: css(value) } : undefined}>
        <input type="color" aria-label={t('More colors')} value={value ? hex(value) : '#000000'} onChange={(e) => onPick(fromHex((e.target as HTMLInputElement).value))} />
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
      <span>{t('Font')}</span>
      <select
        class="font-select"
        value={value ?? ''}
        style={{ fontFamily: fontStack(value) }}
        onChange={(e) => onPick((e.target as HTMLSelectElement).value || undefined)}
      >
        <option value="" style={{ fontFamily: fontStack() }}>
          {/* i18n-ignore: font family name */}
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
      {sigs === null && <p class="muted">{t('Loading…')}</p>}
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
            aria-label={t('Delete signature {name}', { name: s.name })}
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
      {sigs?.length === 0 && <p class="muted">{t('No saved signatures yet.')}</p>}
      <button
        class="btn"
        onClick={() => {
          close()
          signatureDialog.value = true
        }}
      >
        {t('Create signature…')}
      </button>
      <p class="muted small">{t('Signatures are encrypted with your Windows account and never leave this PC.')}</p>
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
  const selectTool = IMAGE_SELECT.find(([id]) => id === tool.value)
  const sel = selectedMarkup(doc)
  const st = sel?.style ?? style.value
  const ts: TextStyle = sel?.type === 'text' ? { fontSize: sel.fontSize, color: sel.color, font: sel.font } : textStyle.value
  const shapeTool = SHAPES.find(([id]) => id === tool.value)
  const markColor = sel && TEXT_MARKS.includes(sel.type) && sel.style.stroke ? sel.style.stroke : highlightColor.value
  return (
    <div class="markup-toolbar" role="toolbar" aria-label={t('Markup')}>
      <ToolButton t="select" icon="cursor" label={t('Select and move markup')} />
      {image && (
        <>
          <Popover icon={selectTool?.[1] ?? 'selectRect'} label={tip(t('Selection tools'), 'tools.marquee')} pressed={!!selectTool}>
            {(close) => (
              <div class="flyout-col">
                {IMAGE_SELECT.map(([id, icon, label]) => (
                  <button
                    key={id}
                    class="menu-item"
                    title={toolTip(id, t(label))}
                    onClick={() => {
                      setTool(id)
                      close()
                    }}
                  >
                    <Icon name={icon} size={16} /> <span>{t(label)}</span>
                  </button>
                ))}
              </div>
            )}
          </Popover>
          <ToolButton t="instantAlpha" icon="instantAlpha" label={t('Instant Alpha: drag over a color to select it')} />
        </>
      )}
      <span class="tb-sep" />
      <ToolButton t="sketch" icon="sketch" label={t('Sketch: shapes are recognized')} />
      <ToolButton t="draw" icon="draw" label={t('Draw')} />
      <Popover icon={shapeTool?.[1] ?? 'shapes'} label={tip(t('Shapes'), 'tools.shapes')} pressed={!!shapeTool}>
        {(close) => (
          <div class="shape-grid">
            {[...SHAPES, ['loupe', 'zoomIn', msg('Loupe (magnifier)')] as [Tool, IconName, string]].map(([id, icon, label]) => (
              <button
                key={id}
                class={`tb-button ${tool.value === id ? 'pressed' : ''}`}
                title={toolTip(id, t(label))}
                aria-label={t(label)}
                onClick={() => {
                  setTool(id)
                  close()
                }}
              >
                <Icon name={icon} />
              </button>
            ))}
          </div>
        )}
      </Popover>
      <ToolButton t="text" icon="textBox" label={t('Text box')} />
      {!image && <ToolButton t="note" icon="note" label={t('Note')} />}
      <span class="tb-sep" />
      {!image && <button class={`tb-button ${tool.value === 'highlight' ? 'pressed' : ''}`} title={tip(t('Highlight selected text'), 'tools.highlight')} aria-label={t('Highlight')} onClick={() => textMarkup(doc, 'highlight')}>
        <Icon name="highlight" />
        <span class="swatch-bar" style={{ background: css(markColor) }} />
      </button>}
      {!image && (
        <Popover icon="underline" label={t('Highlight color, underline, strikethrough and squiggly underline')}>
          {(close) => (
            <div class="flyout-col">
              <span class="flyout-label">{t('Highlight color')}</span>
              <Swatches colors={HIGHLIGHT_COLORS} value={markColor} onPick={(c) => c && pickMarkColor(doc, c)} />
              <span class="menu-sep" />
              {(
                [
                  ['underline', 'underline', msg('Underline')],
                  ['strike', 'strike', msg('Strikethrough')],
                  ['squiggly', 'squiggly', msg('Squiggly underline')]
                ] as [TextMarkupKind, IconName, string][]
              ).map(([k, icon, label]) => (
                <button key={k} class={`menu-item ${tool.value === k ? 'checked' : ''}`} onClick={() => (textMarkup(doc, k), close())}>
                  <Icon name={icon} size={16} /> <span>{t(label)}</span>
                </button>
              ))}
            </div>
          )}
        </Popover>
      )}
      <Popover icon="signature" label={t('Sign')} pressed={tool.value === 'signature'}>
        {(close) => <Signatures close={close} />}
      </Popover>
      <button
        class={`tb-button ${tool.value === 'redact' ? 'pressed' : ''}`}
        title={tip(t('Redact: drag over an area, or select text'), 'tools.redact')}
        aria-label={t('Redact')}
        onClick={() => textMarkup(doc, 'redact')}
      >
        <Icon name="redact" />
      </button>
      <span class="tb-sep" />
      <Popover icon="lineWidth" label={t('Line width ([ and ])')}>
        {() => (
          <div class="width-list">
            {WIDTHS.map((w) => (
              <button key={w} class={`width-item ${st.width === w ? 'selected' : ''}`} onClick={() => restyle(doc, { width: w })}>
                <span style={{ height: Math.max(1, w), background: 'currentColor' }} />
                <small>{t('{size} pt', { size: w })}</small>
              </button>
            ))}
          </div>
        )}
      </Popover>
      <Popover icon="strokeColor" label={t('Border color')} swatch={css(st.stroke)}>
        {() => <Swatches value={st.stroke} allowNone onPick={(c) => restyle(doc, { stroke: c })} />}
      </Popover>
      <Popover icon="fillColor" label={t('Fill color')} swatch={st.fill ? css(st.fill) : 'transparent'}>
        {() => <Swatches value={st.fill} allowNone onPick={(c) => restyle(doc, { fill: c })} />}
      </Popover>
      <Popover icon="textStyle" label={t('Text style')}>
        {() => (
          <div class="flyout-col">
            <FontPicker value={ts.font} onPick={(font) => restyle(doc, {}, { font })} />
            <label class="field">
              <span>{t('Size')}</span>
              <select value={ts.fontSize} onChange={(e) => restyle(doc, {}, { fontSize: Number((e.target as HTMLSelectElement).value) })}>
                {[8, 9, 10, 11, 12, 14, 16, 18, 24, 32, 48, 72].map((n) => (
                  <option key={n} value={n}>
                    {t('{size} pt', { size: n })}
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
          <ActionButton icon="crop" label={tip(t('Crop to selection'), 'tools.crop')} onClick={() => void cropToSelection(image)} />
          <ActionButton icon="straighten" label={tip(t('Straighten'), 'tools.straighten')} onClick={() => void runCommand('tools.straighten')} />
          <ActionButton icon="adjustColor" label={tip(t('Adjust color'), 'tools.adjustColor')} onClick={() => (adjustColorOpen.value = true)} />
          <ActionButton icon="adjustSize" label={tip(t('Adjust size'), 'tools.adjustSize')} onClick={() => (adjustSizeOpen.value = true)} />
          <ActionButton icon="removeBg" label={tip(t('Remove background'), 'tools.removeBackground')} onClick={() => void removeBackground(image)} />
          <ActionButton icon="copySubject" label={t('Copy subject')} onClick={() => void copySubject(image)} />
        </>
      )}
      <div class="tb-spacer" />
      <button class="tb-button" title={tip(t('Hide markup toolbar'), 'tools.markup')} aria-label={t('Hide markup toolbar')} onClick={() => {
          setTool('select')
          markupBar.value = false
        }}>
        <Icon name="close" />
      </button>
    </div>
  )
}
