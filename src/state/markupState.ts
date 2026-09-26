import { signal } from '@preact/signals'
import { COLORS, DEFAULT_STYLE, type Color, type Markup, type Style } from '../core/markup'
import type { SavedSignature } from '../platform'
import type { MarkupHost } from './documents'

export type Tool =
  | 'select'
  | 'highlight'
  | 'underline'
  | 'strike'
  | 'squiggly'
  | 'sketch'
  | 'draw'
  | 'rect'
  | 'roundRect'
  | 'oval'
  | 'line'
  | 'arrow'
  | 'star'
  | 'polygon'
  | 'bubble'
  | 'text'
  | 'note'
  | 'signature'
  | 'redact'
  | 'loupe'
  // Image selection tools
  | 'selectRect'
  | 'selectEllipse'
  | 'lasso'
  | 'smartLasso'
  | 'instantAlpha'
  // View tools: pan and zoom without drawing
  | 'hand'
  | 'zoom'

export const SHAPE_TOOLS: Tool[] = ['rect', 'roundRect', 'oval', 'line', 'arrow', 'star', 'polygon', 'bubble']
export const TEXT_MARKUP_TOOLS: Tool[] = ['highlight', 'underline', 'strike', 'squiggly']

/** The markup toolbar row (Preview's "Show Markup Toolbar"). */
export const markupBar = signal(false)
export const tool = signal<Tool>('select')
export const selectedId = signal<string | null>(null)
/** Text box or note currently being typed into. */
export const editingId = signal<string | null>(null)

export const style = signal<Style>({ ...DEFAULT_STYLE })
export interface TextStyle {
  fontSize: number
  color: Color
  /** System font family; undefined = Helvetica. */
  font?: string
}
export const textStyle = signal<TextStyle>({ fontSize: 14, color: COLORS.black })
export const highlightColor = signal<Color>(COLORS.yellow)
export const activeSignature = signal<SavedSignature | null>(null)
export const signatureDialog = signal(false)

/** Space held down: the hand tool takes over until it is released, as in Photoshop. */
export const spaceHeld = signal(false)

export const VIEW_TOOLS: Tool[] = ['hand', 'zoom']

export function setTool(t: Tool): void {
  tool.value = t
  if (t !== 'select') selectedId.value = null
  editingId.value = null
  // Picking a markup tool shows its row; Select, Hand and Zoom leave it as it is.
  if (t !== 'select' && !VIEW_TOOLS.includes(t)) markupBar.value = true
}

export const WIDTHS = [0.5, 1, 2, 3, 5, 8, 12]

/** Updates the default style and, if something is selected, that markup too. */
export function restyle(doc: MarkupHost | null, patch: Partial<Markup['style']>, textPatch?: Partial<TextStyle>): void {
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

/** CSS color from a markup color. */
export function css(c: Color | null, alpha = 1): string {
  if (!c) return 'none'
  const [r, g, b] = c.map((v) => Math.round(v * 255))
  return alpha < 1 ? `rgba(${r},${g},${b},${alpha})` : `rgb(${r},${g},${b})`
}

export const IMAGE_SELECT_TOOLS: Tool[] = ['selectRect', 'selectEllipse', 'lasso', 'smartLasso', 'instantAlpha']
