import { describe, expect, it } from 'vitest'
import { applyOps } from '../src/core/sheet/ops'
import { emptyWorkbook } from '../src/core/sheet/model'
import { autoSum, autoSums, chartFor, stepDecimals, widthsForNumbers } from '../src/core/sheet/toolbar'

const sheet = () =>
  applyOps(emptyWorkbook('Budget'), [{ op: 'set', cell: 'A1', values: [['Month', 'Income', 'Bills'], ['Jan', 2400, 1180], ['Feb', 2400, 1240], ['Mar', 2650, 1250]] }]).wb.sheets[0]

describe('spreadsheet toolbar', () => {
  it('adds and removes decimal places like Excel', () => {
    expect(stepDecimals('#,##0.00', 1)).toBe('#,##0.000')
    expect(stepDecimals('#,##0.00', -1)).toBe('#,##0.0')
    expect(stepDecimals('#,##0.0', -1)).toBe('#,##0')
    expect(stepDecimals('£#,##0', 1)).toBe('£#,##0.0')
    expect(stepDecimals('0%', 1)).toBe('0.0%')
    expect(stepDecimals(undefined, 1, 2.5)).toBe('0.00')
    expect(stepDecimals(undefined, -1, 2.5)).toBe('0')
    expect(stepDecimals('General', 1)).toBe('0.0')
  })

  it('sums the numbers above a picked cell, or to its left', () => {
    const s = sheet()
    expect(autoSum(s, { r1: 4, c1: 1, r2: 4, c2: 1 })).toEqual({ cell: 'B5', formula: '=SUM(B2:B4)' })
    expect(autoSum(s, { r1: 1, c1: 3, r2: 1, c2: 3 })).toEqual({ cell: 'D2', formula: '=SUM(B2:C2)' })
    expect(autoSum(s, { r1: 8, c1: 6, r2: 8, c2: 6 })).toBeNull()
  })

  it('puts a total under each picked column', () => {
    expect(autoSums(sheet(), { r1: 1, c1: 1, r2: 3, c2: 2 })).toEqual([
      { cell: 'B5', formula: '=SUM(B2:B4)' },
      { cell: 'C5', formula: '=SUM(C2:C4)' }
    ])
  })

  it('charts the picked cells with their labels and headings', () => {
    const c = chartFor(sheet(), { r1: 0, c1: 0, r2: 3, c2: 2 })
    expect(c).toMatchObject({
      type: 'column',
      categories: 'A2:A4',
      series: [{ name: 'Income', values: 'B2:B4' }, { name: 'Bills', values: 'C2:C4' }],
      legend: 'bottom',
      range: 'E1:K16'
    })
    expect(chartFor(sheet(), { r1: 1, c1: 1, r2: 3, c2: 1 })).toMatchObject({ series: [{ values: 'B2:B4' }], legend: 'none' })
    // Only headings picked: nothing to chart.
    expect(chartFor(sheet(), { r1: 0, c1: 0, r2: 0, c2: 2 })).toBeNull()
  })
})

describe('widening for numbers', () => {
  it('widens a column whose numbers would show #### in the new format', () => {
    const s = sheet()
    const w = widthsForNumbers(s, { r1: 1, c1: 1, r2: 3, c2: 2 }, '£#,##0.000')
    expect(w.map((x) => x.col)).toEqual(['B', 'C'])
    expect(w[0].width).toBeGreaterThan(72)
    expect(widthsForNumbers(s, { r1: 1, c1: 1, r2: 3, c2: 2 }, '0')).toEqual([])
  })
})
