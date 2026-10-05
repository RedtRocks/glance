import { describe, expect, it } from 'vitest'
import { columnName, parseDelimited } from '../src/office/render'
import { formatValue, parseRef } from '../src/office/xlsx'
import { officeFlavor } from '../src/core/office'

describe('office files', () => {
  it('sorts extensions into Word, slides and sheets', () => {
    expect(officeFlavor('DOCX')).toBe('word')
    expect(officeFlavor('ppsx')).toBe('slides')
    expect(officeFlavor('csv')).toBe('sheets')
    expect(officeFlavor('doc')).toBeNull()
  })
})

describe('CSV', () => {
  it('handles quotes, doubled quotes and line endings', () => {
    expect(parseDelimited('a,b\r\n"x, y","say ""hi"""\n1,\n', ',')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
      ['1', '']
    ])
  })
  it('keeps a last line without a newline', () => {
    expect(parseDelimited('a\tb\n1\t2', '\t')).toEqual([
      ['a', 'b'],
      ['1', '2']
    ])
  })
})

describe('spreadsheet cells', () => {
  it('names columns like Excel', () => {
    expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA'])
    expect(parseRef('B12')).toEqual([11, 1])
    expect(parseRef('$AA$3')).toEqual([2, 26])
  })

  it('formats numbers the way their format says', () => {
    expect(formatValue(1234.5, undefined)).toBe('1234.5')
    expect(formatValue(12400, '"$"#,##0')).toBe('$12,400')
    expect(formatValue(12400, '$#,##0')).toBe('$12,400')
    expect(formatValue(0.256, '0.0%')).toBe('25.6%')
    expect(formatValue(-3.5, '0.00')).toBe('-3.50')
    expect(formatValue(-3.5, '#,##0.00;(#,##0.00)')).toBe('(3.50)')
    expect(formatValue(1500, '[$€-407]#,##0.00')).toBe('€1,500.00')
  })

  it('formats dates from Excel serial numbers', () => {
    // 45566 is 2024-10-01.
    expect(formatValue(45566, 'yyyy-mm-dd')).toBe('2024-10-01')
    expect(formatValue(45566, 'm/d/yyyy')).toBe('10/1/2024')
    expect(formatValue(45566, 'd-mmm-yy')).toBe('1-Oct-24')
    expect(formatValue(45566.75, 'h:mm AM/PM')).toBe('6:00 PM')
    expect(formatValue(45566.5, 'hh:mm:ss')).toBe('12:00:00')
  })
})
