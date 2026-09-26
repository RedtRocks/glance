import { signal } from '@preact/signals'
import { COLORS, DEFAULT_STYLE, type Color, type Style } from '../core/markup'
import type { SavedSignature } from '../platform'

export type Tool =
  | 'select'
  | 'highlight'
  | 'underline'
  | 'strike'
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

export const SHAPE_TOOLS: Tool[] = ['rect', 'roundRect', 'oval', 'line', 'arrow', 'star', 'polygon', 'bubble']
export const TEXT_MARKUP_TOOLS: Tool[] = ['highlight', 'underline', 'strike']

/** The markup toolbar row (Preview's "Show Markup Toolbar"). */
export const markupBar = signal(false)
export const tool = signal<Tool>('select')
export const selectedId = signal<string | null>(null)
/** Text box or note currently being typed into. */
export const editingId = signal<string | null>(null)

export const style = signal<Style>({ ...DEFAULT_STYLE })
export const textStyle = signal<{ fontSize: number; color: Color }>({ fontSize: 14, color: COLORS.black })
export const highlightColor = signal<Color>(COLORS.yellow)
export const activeSignature = signal<SavedSignature | null>(null)
export const signatureDialog = signal(false)

export function setTool(t: Tool): void {
  tool.value = t
  if (t !== 'select') selectedId.value = null
  editingId.value = null
  markupBar.value = true
}

/** CSS color from a markup color. */
export function css(c: Color | null, alpha = 1): string {
  if (!c) return 'none'
  const [r, g, b] = c.map((v) => Math.round(v * 255))
  return alpha < 1 ? `rgba(${r},${g},${b},${alpha})` : `rgb(${r},${g},${b})`
}
