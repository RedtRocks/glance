import { describe, expect, it } from 'vitest'
import { SENSITIVE_PATTERNS, canvasMeasure, findMatches, termRegex, type TextItem } from '../src/core/findText'

// A 10-pt line at (100, 700): 10 chars span 60 pt.
const line = (str: string, x = 100, y = 700, hasEOL = true): TextItem => ({ str, transform: [10, 0, 0, 10, x, y], width: str.length * 6, height: 10, hasEOL })
const pattern = (id: string) => SENSITIVE_PATTERNS.find((p) => p.id === id)!.re

describe('search and redact', () => {
  it('locates a term inside an item proportionally and pads the box', () => {
    const [m] = findMatches([line('Name: Jane Doe')], [termRegex('jane doe', false, true)!])
    expect(m.text).toBe('Jane Doe')
    const [x1, y1, x2, y2] = m.rects[0]
    expect(x1).toBeLessThan(100 + 6 * 6) // starts at char 6
    expect(x1).toBeGreaterThan(100 + 6 * 5)
    expect(x2).toBeGreaterThan(100 + 14 * 6)
    expect(y1).toBeLessThan(700) // covers descenders
    expect(y2).toBeGreaterThan(709)
  })

  it('finds matches that span two text items', () => {
    const items = [line('SSN 123-45-', 100, 700, false), line('6789 on file', 166, 700)]
    const [m] = findMatches(items, [pattern('id')])
    expect(m.text).toBe('123-45-6789')
    expect(m.rects).toHaveLength(2)
  })

  it('does not join words across lines', () => {
    expect(findMatches([line('Jane'), line('Doe', 100, 680)], [termRegex('JaneDoe', false, false)!])).toHaveLength(0)
  })

  it('whole-word search skips partial words; match case is honored', () => {
    expect(findMatches([line('Janet and Jane')], [termRegex('jane', false, true)!])).toHaveLength(1)
    expect(findMatches([line('JANE jane')], [termRegex('jane', true, false)!])).toHaveLength(1)
  })

  it('recognizes common personal data', () => {
    const items = [line('Mail jane.doe@example.com or call +1 (555) 123-4567.'), line('Card 4111 1111 1111 1111, SSN 078-05-1120')]
    const found = findMatches(items, ['email', 'phone', 'card', 'id'].map(pattern)).map((m) => m.text)
    expect(found).toEqual(expect.arrayContaining(['jane.doe@example.com', '4111 1111 1111 1111', '078-05-1120']))
    expect(found.some((t) => t.includes('555') && t.includes('4567'))).toBe(true)
  })

  it('handles rotated text', () => {
    const up: TextItem = { str: 'SECRET', transform: [0, 10, -10, 0, 50, 100], width: 36, height: 10, hasEOL: true }
    const [m] = findMatches([up], [termRegex('secret', false, true)!])
    const [x1, y1, x2, y2] = m.rects[0]
    expect(y2 - y1).toBeGreaterThan(x2 - x1) // tall box for vertical text
  })

  it('places characters by measured glyph widths when a measurer is given', () => {
    // "iiiiWW": narrow i (1 unit), wide W (4 units): WW starts at 4/12 of the width.
    const ctx = { font: '', measureText: (t: string) => ({ width: [...t].reduce((w, ch) => w + (ch === 'W' ? 4 : 1), 0) }) }
    const item: TextItem = { str: 'iiiiWW', transform: [10, 0, 0, 10, 0, 0], width: 120, height: 10, hasEOL: true }
    const [m] = findMatches([item], [termRegex('WW', true, false)!], canvasMeasure(ctx))
    expect(m.rects[0][0]).toBeGreaterThan(40 - 3)
    expect(m.rects[0][0]).toBeLessThan(40)
  })
})
