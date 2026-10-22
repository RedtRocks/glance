import { describe, expect, it } from 'vitest'
import { SHEET_TEMPLATES, SHEET_TEMPLATE_LOADERS } from '../src/sheet/templates'
import { templateToday, templateWorkbook } from '../src/core/sheet/template'
import { checkWorkbook } from '../src/core/sheet/check'
import { formatValue, parseEntry } from '../src/core/sheet/format'
import { styleAt } from '../src/core/sheet/model'
import { parseCell } from '../src/core/sheet/address'

const squash = (s: string) => s.replace(/\s+/g, '').replace(/-/g, '−')

/** The line of the board's text that holds the number, as drawn. */
function shownNumber(shown: string): string | null {
  for (const line of shown.split('\n')) {
    const t = line.trim()
    if (typeof parseEntry(t, { dayFirst: true }).value === 'number') return t
  }
  return null
}

describe('spreadsheet templates', () => {
  it('lists a loader for every template', () => {
    for (const t of SHEET_TEMPLATES) expect(SHEET_TEMPLATE_LOADERS[t.id], t.id).toBeTypeOf('function')
  })

  for (const info of SHEET_TEMPLATES) {
    it(`${info.id} builds, and its formulas give the board's numbers`, async () => {
      const t = await SHEET_TEMPLATE_LOADERS[info.id]()
      const wb = templateWorkbook(t)
      expect(wb.sheets.length).toBeGreaterThan(0)
      const problems: string[] = []
      let live = 0
      // Board figures the sample data does not add up to, each with the reason.
      const differs = (t.checks.differs ?? {}) as Record<string, string>
      for (const s of t.sheets) {
        const sheet = wb.sheets.find((x) => x.name === s.name)!
        for (const [ref, cell] of Object.entries(sheet.cells)) {
          if (!cell.f) continue
          live++
          const shown = s.cells[ref]?.shown
          const want = shown && shownNumber(shown)
          if (!want || differs[`${s.name}!${ref}`]) continue
          const { r, c } = parseCell(ref)!
          const got = formatValue(cell.v, styleAt(sheet, r, c)?.numFmt).text
          if (squash(got) !== squash(want)) problems.push(`${s.name}!${ref} =${cell.f} gives ${got}, board shows ${want}`)
        }
      }
      // Figures the overlay names where the board can't show them (cells that moved, hidden rows).
      for (const [where, want] of Object.entries((t.checks.values ?? {}) as Record<string, string>)) {
        const [name, ref] = where.split('!')
        const sheet = wb.sheets.find((x) => x.name === name)!
        const { r, c } = parseCell(ref)!
        const got = formatValue(sheet.cells[ref]?.v, styleAt(sheet, r, c)?.numFmt).text
        if (squash(got) !== squash(want)) problems.push(`${where} gives ${got}, should be ${want}`)
      }
      const errors = checkWorkbook(wb).filter((f) => f.kind === 'error' || f.kind === 'brokenRef' || f.kind === 'unknownFunction')
      for (const e of errors) problems.push(`${e.sheet}!${e.cell}: ${e.message}`)
      expect(problems).toEqual([])
      expect(live, 'formulas').toBeGreaterThan(5)
      expect(templateToday(t)).toBeTypeOf('number')
    })
  }
})
