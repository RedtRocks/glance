import { describe, expect, it } from 'vitest'
import { formatValue, parseEntry, serialFromDate, isDateFmt } from '../src/core/sheet/format'

const f = (v: number | string | boolean | null, fmt?: string) => formatValue(v, fmt).text

describe('number formats', () => {
  it('formats numbers like Excel', () => {
    expect(f(4180, '£#,##0')).toBe('£4,180')
    expect(f(1284.5, '£#,##0.00')).toBe('£1,284.50')
    expect(f(-1946, '£#,##0;−£#,##0')).toBe('−£1,946')
    expect(f(-62, '£#,##0.00;[Red]-£#,##0.00')).toBe('-£62.00')
    expect(formatValue(-62, '£#,##0.00;[Red]-£#,##0.00').color).toBe('#ff0000')
    expect(f(0.93, '0%')).toBe('93%')
    expect(f(0.4789, '0.0%')).toBe('47.9%')
    expect(f(1234.5678, '#,##0.00')).toBe('1,234.57')
    expect(f(0.5, '0.00')).toBe('0.50')
    expect(f(2.5, '0')).toBe('3')
    expect(f(89.3, '0.0 "km"')).toBe('89.3 km')
    expect(f(5, '0" tasks"')).toBe('5 tasks')
    expect(f(0, '£#,##0;-£#,##0;"–"')).toBe('–')
    expect(f(12345, '0.00E+00')).toBe('1.23E+04')
    expect(f(1500000, '#,##0,"k"')).toBe('1,500k')
    expect(f(7, 'General')).toBe('7')
    expect(f(1 / 3)).toBe('0.333333333')
    expect(f('hi', '@')).toBe('hi')
    expect(f(true)).toBe('TRUE')
    expect(f(0.25, '#,##0.0')).toBe('0.3')
    expect(f(0.4, '#.0')).toBe('.4')
  })

  it('formats dates and times', () => {
    const d = serialFromDate(2026, 10, 1)
    expect(f(d, 'ddd dd mmm')).toBe('Thu 01 Oct')
    expect(f(d, 'd mmmm yyyy')).toBe('1 October 2026')
    expect(f(d, 'dd/mm/yyyy')).toBe('01/10/2026')
    expect(f(d + 0.5, 'h:mm')).toBe('12:00')
    expect(f(d + 0.25 + 1 / 1440 * 5, 'h:mm AM/PM')).toBe('6:05 AM')
    expect(f(30 / 1440 + 24 / 86400, 'mm:ss')).toBe('30:24')
    expect(f(1 + 2 / 24, '[h]:mm')).toBe('26:00')
    expect(isDateFmt('d mmm')).toBe(true)
    expect(isDateFmt('£#,##0')).toBe(false)
  })
})

describe('typed entries', () => {
  it('reads numbers, money, percents and dates', () => {
    expect(parseEntry('42')).toEqual({ value: 42 })
    expect(parseEntry('£1,200')).toEqual({ value: 1200, numFmt: '£#,##0' })
    expect(parseEntry('£12.5')).toEqual({ value: 12.5, numFmt: '£#,##0.00' })
    expect(parseEntry('12%')).toEqual({ value: 0.12, numFmt: '0%' })
    expect(parseEntry('-3.5')).toEqual({ value: -3.5 })
    expect(parseEntry('true')).toEqual({ value: true })
    expect(parseEntry('3 Oct 2026')).toEqual({ value: serialFromDate(2026, 10, 3), numFmt: 'd mmm yyyy' })
    expect(parseEntry('03/10/2026')).toEqual({ value: serialFromDate(2026, 10, 3), numFmt: 'dd/mm/yyyy' })
    expect(parseEntry('2026-10-03').value).toBe(serialFromDate(2026, 10, 3))
    expect(parseEntry('Salary · Ade')).toEqual({ value: 'Salary · Ade' })
    expect(parseEntry('')).toEqual({ value: null })
    expect(parseEntry('31/02/2026')).toEqual({ value: '31/02/2026' })
  })
})
