import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { PageViewport } from 'pdfjs-dist'
import { bounds, COLORS, newId, translate, type Color, type Markup } from '../../core/markup'
import type { MarkupHost } from '../../state/documents'
import { css, editingId, selectedId } from '../../state/markupState'
import { cssBox } from './Shape'
import { Icon } from '../Icon'
import { t } from '../../i18n'

const PALETTE: Color[] = [COLORS.red, COLORS.orange, COLORS.yellow, COLORS.green, COLORS.blue, COLORS.purple, COLORS.black, COLORS.white]
/** Room the bar needs above the markup before it moves underneath instead. */
const ABOVE = 60

/** The colour people think of as the markup's colour. */
export function colorOf(m: Markup): Color | null {
  if (m.type === 'text') return m.color
  if (m.type === 'note') return m.style.fill
  return m.style.stroke ?? m.style.fill
}

export function recolor(m: Markup, c: Color): Markup {
  if (m.type === 'text') return { ...m, color: c }
  if (m.type === 'note') return { ...m, style: { ...m.style, fill: c } }
  if (!m.style.stroke && m.style.fill) return { ...m, style: { ...m.style, fill: c } }
  return { ...m, style: { ...m.style, stroke: c } }
}

/**
 * The bar that floats over selected markup on touch screens, where there is no
 * Delete key or right-click: edit text, change colour, duplicate and delete.
 */
export function SelectionActions({ doc, m, vp }: { doc: MarkupHost; m: Markup; vp: PageViewport }) {
  const [colors, setColors] = useState(false)
  const bar = useRef<HTMLDivElement>(null)
  const b = cssBox(vp, bounds(m))
  const below = b.top < ABOVE
  const replace = (label: string, next: Markup): void => doc.edit(label, { markup: doc.markup.peek().map((i) => (i.id === m.id ? next : i)) })
  const current = colorOf(m)
  const editable = m.type === 'text' || m.type === 'note'
  const centre = (b.left + b.right) / 2
  // Keep the whole bar on the page, even for markup near its edges.
  useLayoutEffect(() => {
    const el = bar.current
    if (!el) return
    const half = el.offsetWidth / 2
    const max = vp.width - half - 8
    el.style.left = `${Math.max(Math.min(half + 8, max), Math.min(centre, max))}px`
  })
  return (
    <div
      ref={bar}
      class={`markup-actions ${below ? 'below' : ''}`}
      role="toolbar"
      aria-label={t('Selected markup')}
      style={{ left: centre, top: below ? b.bottom + 22 : b.top - 22 }}
      onPointerDown={(e) => e.stopPropagation()}
      // Quick taps on the buttons aren't a double-tap zoom of the page underneath.
      onTouchStart={(e) => e.stopPropagation()}
      onTouchEnd={(e) => e.stopPropagation()}
    >
      {colors ? (
        <>
          {PALETTE.map((c) => (
            <button
              key={c.join()}
              class={`ma-swatch ${current?.join() === c.join() ? 'selected' : ''}`}
              style={{ background: css(c) }}
              aria-label={t('Color {rgb}', { rgb: c.map((v) => Math.round(v * 255)).join(', ') })}
              onClick={() => {
                replace('Change Color', recolor(m, c))
                setColors(false)
              }}
            />
          ))}
          <button class="ma-button" aria-label={t('Back')} onClick={() => setColors(false)}>
            <Icon name="close" />
          </button>
        </>
      ) : (
        <>
          {editable && (
            <button class="ma-button" onClick={() => (editingId.value = m.id)}>
              <Icon name="edit" />
              <span>{t('Edit')}</span>
            </button>
          )}
          {m.type !== 'signature' && (
            <button class="ma-button" onClick={() => setColors(true)}>
              <span class="ma-dot" style={{ background: current ? css(current) : 'transparent' }} />
              <span>{t('Color')}</span>
            </button>
          )}
          <button
            class="ma-button"
            onClick={() => {
              const offset = 16 / vp.scale
              const copy = { ...translate(m, offset, -offset), id: newId(), created: Date.now() } as Markup
              doc.edit('Duplicate Markup', { markup: [...doc.markup.peek(), copy] })
              selectedId.value = copy.id
            }}
          >
            <Icon name="copy" />
            <span>{t('Duplicate')}</span>
          </button>
          <button
            class="ma-button danger"
            onClick={() => {
              doc.edit('Delete Markup', { markup: doc.markup.peek().filter((i) => i.id !== m.id) })
              selectedId.value = null
            }}
          >
            <Icon name="trash" />
            <span>{t('Delete')}</span>
          </button>
        </>
      )}
    </div>
  )
}
