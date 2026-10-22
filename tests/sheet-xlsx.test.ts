import { describe, expect, it } from 'vitest'
import { applyOps } from '../src/core/sheet/ops'
import { emptyWorkbook } from '../src/core/sheet/model'
import { readXlsx, writeXlsx } from '../src/sheet/xlsx'
import { csvWorkbook, sheetToCsv } from '../src/core/sheet/csv'
import { checkWorkbook } from '../src/core/sheet/check'

const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))

function sample() {
  return applyOps(emptyWorkbook('October'), [
    { op: 'set', cell: 'B2', values: [['Source', 'Actual'], ['Salary', 2640], ['Cakes', 124], ['Total', '=SUM(C3:C4)']] },
    { op: 'format', range: 'B2:C2', style: { bold: true, font: 'Fraunces', size: 14, color: '#fff8ea', fill: '#2f5d50', border: 'bottom', borderColor: '#22343a' } },
    { op: 'format', range: 'C3:C5', style: { numFmt: '£#,##0' } },
    { op: 'merge', range: 'B1:C1' },
    { op: 'colWidth', cols: 'B', width: 150 },
    { op: 'rowHeight', rows: '1', height: 74 },
    { op: 'freeze', rows: 2 },
    { op: 'tabColor', color: '#2f5d50' },
    { op: 'addValidation', range: 'D3:D4', rule: { type: 'list', values: ['Paid', 'Due'] } },
    { op: 'addValidation', range: 'E3:E4', rule: { type: 'checkbox' } },
    { op: 'addCf', range: 'C3:C4', rule: { type: 'dataBar', color: '#4f93ba' } },
    { op: 'addCf', range: 'C3:C4', rule: { type: 'cellIs', operator: 'lessThan', values: [500], style: { fill: '#fbe2da' } } },
    { op: 'addCf', range: 'C3:C4', rule: { type: 'iconSet', icons: '3Arrows' } },
    { op: 'addImage', range: 'F1:H4', media: 'media/banner.png' },
    { op: 'addChart', chart: { type: 'doughnut', range: 'F6:J16', categories: 'B3:B4', series: [{ values: 'C3:C4' }], colors: ['#8fb59a', '#e3a92f'], centre: '£2,764' } },
    { op: 'addSheet', name: 'Categories' },
    { op: 'set', sheet: 'Categories', cell: 'A1', value: '=October!C5/2' }
  ], { media: new Set(['media/banner.png']) }).wb
}

describe('xlsx', () => {
  it('round-trips values, formulas, styles, merges, validation, rules, pictures and charts', async () => {
    const wb = sample()
    const bytes = await writeXlsx(wb, new Map([['media/banner.png', PNG]]), { chartPicture: async () => PNG })
    const back = await readXlsx(bytes)
    const s = back.wb.sheets[0]
    expect(back.wb.sheets.map((x) => x.name)).toEqual(['October', 'Categories'])
    expect(s.cells.C5).toMatchObject({ f: 'SUM(C3:C4)', v: 2764, s: { numFmt: '£#,##0' } })
    expect(s.cells.B2.s).toMatchObject({ font: { bold: true, name: 'Fraunces', size: 14, color: '#fff8ea' }, fill: '#2f5d50', border: { bottom: { style: 'thin', color: '#22343a' } } })
    expect(s.merges).toEqual(['B1:C1'])
    expect(s.cols[1].size).toBe(150)
    expect(s.rows[0].size).toBe(74)
    expect(s.frozen).toEqual({ rows: 2, cols: 0 })
    expect(s.tabColor).toBe('#2f5d50')
    expect(s.validations).toEqual(expect.arrayContaining([expect.objectContaining({ ref: 'D3:D4', type: 'list', values: ['Paid', 'Due'] }), expect.objectContaining({ ref: 'E3:E4', type: 'checkbox' })]))
    expect(s.cells.E3.v).toBe(false)
    const rules = s.cf.flatMap((c) => c.rules)
    expect(rules).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'dataBar', color: '#4f93ba' }), expect.objectContaining({ type: 'cellIs', operator: 'lessThan', values: [500], style: { fill: '#fbe2da' } }), expect.objectContaining({ type: 'iconSet', icons: '3Arrows' })]))
    // The picture comes back; the chart's picture is dropped and the live chart restored.
    expect(s.images).toHaveLength(1)
    expect(s.images[0].anchor).toMatchObject({ from: { r: 0, c: 5 }, to: { r: 4, c: 8 } })
    expect(back.media.get(s.images[0].media)).toEqual(PNG)
    expect(s.charts).toEqual(wb.sheets[0].charts)
    expect(back.wb.sheets[1].cells.A1).toMatchObject({ f: 'October!C5/2', v: 1382 })
  })
})

describe('csv', () => {
  it('reads and writes CSV', () => {
    const wb = csvWorkbook('Name,Amount,Code\r\n"Smith, Jo",£1,200,0123\r\nAde,"12.5",77\r\n', 'People')
    // The unquoted £1,200 splits into two cells, as any CSV reader would.
    expect(wb.sheets[0].cells.A2.v).toBe('Smith, Jo')
    expect(wb.sheets[0].cells.C2.v).toBe(200)
    expect(wb.sheets[0].cells.D2.v).toBe('0123')
    expect(wb.sheets[0].cells.B3.v).toBe(12.5)
    expect(wb.sheets[0].cells.C3.v).toBe(77)
    const out = sheetToCsv(csvWorkbook('a;b\n1;"x;y"\n', 'S').sheets[0])
    expect(out).toBe('a,b\r\n1,x;y\r\n')
  })
})

describe('check', () => {
  it('finds formula errors, broken references, stray text and invalid entries', () => {
    const wb = applyOps(emptyWorkbook('S'), [
      { op: 'set', cell: 'A1', values: [[1], [2], [3], [4], ["'5"]] },
      { op: 'set', cell: 'B1', value: '=A1/0' },
      { op: 'set', cell: 'B2', value: '=Missing!A1' },
      { op: 'set', cell: 'B3', value: '=SUMM(A1:A3)' },
      { op: 'set', cell: 'C1', value: 'Due [date]' }
    ]).wb
    const kinds = checkWorkbook(wb).map((f) => `${f.cell}:${f.kind}`)
    expect(kinds).toEqual(expect.arrayContaining(['B1:error', 'B2:brokenRef', 'B3:unknownFunction', 'A5:textInNumbers', 'C1:placeholder']))
  })
})
