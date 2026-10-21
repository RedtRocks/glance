import { describe, expect, it } from 'vitest'
import { applyOps, SheetError } from '../src/core/sheet/ops'
import { emptyWorkbook, type Workbook } from '../src/core/sheet/model'

const base = (): Workbook =>
  applyOps(emptyWorkbook('Budget'), [
    { op: 'set', cell: 'B2', values: [['Item', 'Cost'], ['Rent', 1150], ['Food', '£512'], ['Total', '=SUM(C3:C4)']] },
    { op: 'addSheet', name: 'Notes' },
    { op: 'set', sheet: 'Notes', cell: 'A1', value: '=Budget!C5*2' }
  ]).wb

describe('sheet operations', () => {
  it('sets values, parses typed money and recalculates', () => {
    const wb = base()
    const s = wb.sheets[0]
    expect(s.cells.C4).toMatchObject({ v: 512, s: { numFmt: '£#,##0' } })
    expect(s.cells.C5).toMatchObject({ f: 'SUM(C3:C4)', v: 1662 })
    expect(wb.sheets[1].cells.A1.v).toBe(3324)
  })

  it('moves formulas when rows are inserted and deleted', () => {
    let wb = applyOps(base(), [{ op: 'insertRows', at: 4, count: 1 }, { op: 'set', cell: 'C4', value: 10 }]).wb
    expect(wb.sheets[0].cells.C6).toMatchObject({ f: 'SUM(C3:C5)', v: 1672 })
    expect(wb.sheets[1].cells.A1).toMatchObject({ f: 'Budget!C6*2', v: 3344 })
    wb = applyOps(wb, [{ op: 'deleteRows', at: 3, count: 3 }]).wb
    expect(wb.sheets[0].cells.C3).toMatchObject({ f: 'SUM(#REF!)', v: { error: '#REF!' } })
  })

  it('renames sheets inside formulas', () => {
    const wb = applyOps(base(), [{ op: 'renameSheet', from: 'Budget', to: 'Oct 2026' }]).wb
    expect(wb.sheets[1].cells.A1.f).toBe("'Oct 2026'!C5*2")
  })

  it('fills formulas and sorts rows', () => {
    let wb = applyOps(base(), [{ op: 'set', range: 'D3:D4', formula: '=C3*2' }]).wb
    expect(wb.sheets[0].cells.D4).toMatchObject({ f: 'C4*2', v: 1024 })
    wb = applyOps(wb, [{ op: 'sort', range: 'B3:D4', by: [{ col: 'C' }] }]).wb
    expect(wb.sheets[0].cells.B3.v).toBe('Food')
    expect(wb.sheets[0].cells.D3).toMatchObject({ f: 'C3*2', v: 1024 })
  })

  it('changes nothing and says why when an operation is invalid', () => {
    const wb = base()
    expect(() => applyOps(wb, [{ op: 'set', cell: 'A1', value: 1 }, { op: 'set', cell: 'Z', value: 2 }])).toThrow(/Operation 2 \(set\)/)
    expect(() => applyOps(wb, [{ op: 'renameSheet', from: 'Notes', to: 'Budget' }])).toThrow(SheetError)
    expect(() => applyOps(wb, [{ op: 'format', range: 'A1', style: { fill: 'red' } }])).toThrow(/#2f5d50/)
    expect(wb.sheets[0].cells.A1).toBeUndefined()
  })

  it('keeps entries to a drop-down list', () => {
    const wb = applyOps(base(), [{ op: 'addValidation', range: 'E3:E4', rule: { type: 'list', values: ['Paid', 'Due'] } }]).wb
    expect(applyOps(wb, [{ op: 'set', cell: 'E3', value: 'paid' }]).wb.sheets[0].cells.E3.v).toBe('paid')
    expect(() => applyOps(wb, [{ op: 'set', cell: 'E3', value: 'Maybe' }])).toThrow(/pick one of Paid, Due/)
  })

  it('formats, merges, freezes and adds charts and rules', () => {
    const r = applyOps(base(), [
      { op: 'format', range: 'B2:C2', style: { bold: true, fill: '#2f5d50', border: 'bottom' } },
      { op: 'merge', range: 'B1:C1' },
      { op: 'freeze', rows: 2 },
      { op: 'addCf', range: 'C3:C4', rule: { type: 'dataBar', color: '#4f93ba' } },
      { op: 'addChart', chart: { type: 'doughnut', range: 'F2:J12', categories: 'B3:B4', series: [{ values: 'C3:C4' }] } },
      { op: 'filter', range: 'B2:C4', col: 'B', values: ['Rent'] }
    ])
    const s = r.wb.sheets[0]
    expect(s.cells.B2.s).toMatchObject({ font: { bold: true }, fill: '#2f5d50', border: { bottom: { style: 'thin' } } })
    expect(s.merges).toEqual(['B1:C1'])
    expect(s.frozen).toEqual({ rows: 2, cols: 0 })
    expect(s.charts[0]).toMatchObject({ id: 'chart1', series: [{ values: 'Budget!C3:C4' }] })
    expect(r.added).toEqual(['chart1'])
    expect([...s.filterHidden!]).toEqual([3])
  })
})
