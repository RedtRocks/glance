import { describe, expect, it } from 'vitest'
import { COLORS, DEFAULT_STYLE, type Markup } from '../src/core/markup'
import { colorOf, recolor } from '../src/ui/markup/SelectionActions'

const base = { id: 'm', page: 0, created: 0, style: { ...DEFAULT_STYLE } }

describe('the selected-markup bar on touch screens', () => {
  it('recolors shapes by their outline, text by its ink and notes by their paper', () => {
    const rect: Markup = { ...base, type: 'rect', rect: [0, 0, 10, 10] }
    expect(colorOf(recolor(rect, COLORS.blue))).toEqual(COLORS.blue)
    expect(recolor(rect, COLORS.blue).style.fill).toBeNull()

    const text: Markup = { ...base, type: 'text', rect: [0, 0, 10, 10], text: 'hi', fontSize: 12, color: COLORS.black }
    const blueText = recolor(text, COLORS.blue)
    expect(blueText.type === 'text' && blueText.color).toEqual(COLORS.blue)

    const note: Markup = { ...base, style: { ...base.style, fill: COLORS.yellow }, type: 'note', at: [0, 0], text: '' }
    expect(recolor(note, COLORS.green).style.fill).toEqual(COLORS.green)
  })

  it('recolors a filled shape with no outline by its fill', () => {
    const blob: Markup = { ...base, style: { ...base.style, stroke: null, fill: COLORS.red }, type: 'oval', rect: [0, 0, 10, 10] }
    expect(recolor(blob, COLORS.purple).style).toMatchObject({ stroke: null, fill: COLORS.purple })
  })
})
