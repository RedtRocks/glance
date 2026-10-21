import { describe, expect, it } from 'vitest'
import * as formulajs from '@formulajs/formulajs'
import { adjustFormula, parse, renameSheetIn, shiftFormula, tokenize } from '../src/core/sheet/formula'
import { emptySheet, type Sheet, type Value, type Workbook } from '../src/core/sheet/model'
import { evaluateFormula, recalc, useFunctions } from '../src/core/sheet/recalc'
import { extend, FUNCTIONS } from '../src/core/sheet/functions'
import { serialFromDate } from '../src/core/sheet/format'
import { parseCell } from '../src/core/sheet/address'

function book(data: Record<string, Record<string, Value | string>>): Workbook {
  const sheets: Sheet[] = Object.entries(data).map(([name, cells]) => {
    const s = emptySheet(name)
    for (const [k, v] of Object.entries(cells)) s.cells[k] = typeof v === 'string' && v.startsWith('=') ? { f: v.slice(1) } : { v: v as Value }
    return s
  })
  return { sheets }
}

const today = serialFromDate(2026, 10, 20)
const calc = (wb: Workbook, f: string, sheet = wb.sheets[0].name) => evaluateFormula(wb, sheet, 99, 99, f.replace(/^=/, ''), { today })
const val = (wb: Workbook, ref: string, sheet = 0) => recalc(wb, { today }).sheets[sheet].cells[ref]?.v

describe('formula parsing', () => {
  it('reads references, ranges and sheets', () => {
    expect(tokenize("SUM(Savings!C:C)/1800").find((t) => t.type === 'ref')?.ref).toMatchObject({ sheet: 'Savings', kind: 'cols', c1: 2, c2: 2 })
    expect(tokenize("'Habit List'!$B$2:B9").find((t) => t.type === 'ref')?.ref).toMatchObject({ sheet: 'Habit List', r1: 1, r2: 8, abs: { r1: true, c1: true, r2: false, c2: false } })
    expect(parse('-2^2')).toMatchObject({ t: 'bin', op: '^' })
    expect(() => parse('SUM(1,')).toThrow()
    expect(() => parse('"abc')).toThrow()
    expect(tokenize('LOG10(100)')[0].type).toBe('func')
  })

  it('moves relative references when filled, keeping $ ones', () => {
    expect(shiftFormula('H6+F7-G7', 1, 0)).toBe('H7+F8-G8')
    expect(shiftFormula('$A$1*B2+C$3', 2, 1)).toBe('$A$1*C4+D$3')
    expect(shiftFormula('SUM(A:A)', 5, 0)).toBe('SUM(A:A)')
    expect(shiftFormula('A1', -1, 0)).toBe('#REF!')
    expect(shiftFormula('IF(D7="Done", 1, 0)', 1, 0)).toBe('IF(D8="Done", 1, 0)')
  })

  it('follows inserted and deleted rows and columns', () => {
    expect(adjustFormula('SUM(D7:D10)', 'S', 'S', 'r', 8, 2)).toBe('SUM(D7:D12)')
    expect(adjustFormula('SUM(D7:D10)', 'S', 'S', 'r', 7, -2)).toBe('SUM(D7:D8)')
    expect(adjustFormula('D9*2', 'S', 'S', 'r', 7, -3)).toBe('#REF!*2')
    expect(adjustFormula('Other!B5+B5', 'S', 'Other', 'r', 0, 1)).toBe('Other!B6+B5')
    expect(adjustFormula('SUM(B2:F2)', 'S', 'S', 'c', 2, 1)).toBe('SUM(B2:G2)')
    expect(renameSheetIn("SUM(Savings!C:C)+'Savings'!A1", 'Savings', 'Holiday Fund')).toBe("SUM('Holiday Fund'!C:C)+'Holiday Fund'!A1")
  })
})

describe('formula evaluation', () => {
  const wb = book({
    Budget: {
      B7: 'Salary', C7: 2640, D7: 2640,
      B8: 'Jo', C8: 1200, D8: 1240,
      B9: 'Benefit', C9: 176, D9: 176,
      B10: 'Cakes', C10: 80, D10: 124,
      D11: '=SUM(D7:D10)', E11: '=D11-SUM(C7:C10)',
      F1: 'Done', F2: 'Done', F3: 'At risk', F4: null, F5: 'done',
      G1: 0.5, G2: 1, G3: 0.25, G4: 'x', G5: 0
    },
    Savings: { C1: 400, C2: 566, C3: 150, D1: 'Jar' }
  })

  it('does arithmetic like Excel', () => {
    expect(calc(wb, '1+2*3^2')).toBe(19)
    expect(calc(wb, '-2^2')).toBe(4)
    expect(calc(wb, '2.1+0.2')).toBe(2.3)
    expect(calc(wb, '10%')).toBe(0.1)
    expect(calc(wb, '"a"&1&TRUE')).toBe('a1TRUE')
    expect(calc(wb, '1/0')).toEqual({ error: '#DIV/0!' })
    expect(calc(wb, '"x"+1')).toEqual({ error: '#VALUE!' })
    expect(calc(wb, '"10"+1')).toBe(11)
    expect(calc(wb, '"abc"="ABC"')).toBe(true)
    expect(calc(wb, 'Budget!D7>Budget!C9')).toBe(true)
    expect(calc(wb, 'NOPE(1)')).toEqual({ error: '#NAME?' })
  })

  it('sums, counts and averages ranges', () => {
    expect(val(wb, 'D11')).toBe(4180)
    expect(val(wb, 'E11')).toBe(84)
    expect(calc(wb, 'SUM(Savings!C:C)/1800')).toBeCloseTo(0.62)
    expect(calc(wb, 'COUNTIF(F1:F5,"Done")')).toBe(3)
    expect(calc(wb, 'COUNTIF(F1:F5,"<>Done")')).toBe(2)
    expect(calc(wb, 'COUNTIF(G1:G5,">=0.5")')).toBe(2)
    expect(calc(wb, 'COUNTIF(F1:F5,"At*")')).toBe(1)
    expect(calc(wb, 'COUNTA(F1:F5)')).toBe(4)
    expect(calc(wb, 'COUNTBLANK(F1:F5)')).toBe(1)
    expect(calc(wb, 'AVERAGE(G1:G5)')).toBeCloseTo(0.4375)
    expect(calc(wb, 'SUMIF(F1:F5,"Done",G1:G5)')).toBe(1.5)
    expect(calc(wb, 'SUMIF(F1:F5,"Done",G1)')).toBe(1.5)
    expect(calc(wb, 'SUMIFS(G1:G5,F1:F5,"Done",G1:G5,">0.6")')).toBe(1)
    expect(calc(wb, 'AVERAGEIF(F1:F5,"Done",G1:G5)')).toBe(0.5)
    expect(calc(wb, 'SUMPRODUCT((F1:F5="Done")*G1:G5)')).toEqual({ error: '#VALUE!' })
    expect(calc(wb, 'SUMPRODUCT((F1:F5="Done")*(G1:G5>0))')).toBe(2)
    expect(calc(wb, 'MAX(C7:D10)')).toBe(2640)
    expect(calc(wb, 'ROUND(2.345,2)')).toBe(2.35)
    expect(calc(wb, 'ROUND(-2.5,0)')).toBe(-3)
  })

  it('looks things up', () => {
    expect(calc(wb, 'VLOOKUP("Jo",B7:D10,3,FALSE)')).toBe(1240)
    expect(calc(wb, 'VLOOKUP("Nobody",B7:D10,3,FALSE)')).toEqual({ error: '#N/A' })
    expect(calc(wb, 'INDEX(D7:D10,MATCH("Cakes",B7:B10,0))')).toBe(124)
    expect(calc(wb, 'XLOOKUP("Benefit",B7:B10,C7:C10)')).toBe(176)
    expect(calc(wb, 'IFERROR(1/0,"none")')).toBe('none')
    expect(calc(wb, 'IF(C7>D7,"over",IF(C7=D7,"on plan","under"))')).toBe('on plan')
  })

  it('works with dates and text', () => {
    expect(calc(wb, 'DATE(2026,11,26)-TODAY()')).toBe(37)
    expect(calc(wb, 'TEXT(DATE(2026,10,1),"ddd d mmm")')).toBe('Thu 1 Oct')
    expect(calc(wb, 'WEEKDAY(DATE(2026,10,20),2)')).toBe(2)
    expect(calc(wb, 'EOMONTH(DATE(2026,2,10),0)')).toBe(serialFromDate(2026, 2, 28))
    expect(calc(wb, 'NETWORKDAYS(DATE(2026,10,19),DATE(2026,10,25))')).toBe(5)
    expect(calc(wb, 'DATEDIF(DATE(2026,1,15),DATE(2026,10,20),"m")')).toBe(9)
    expect(calc(wb, 'TEXT(0.62,"0%")&" there"')).toBe('62% there')
    expect(calc(wb, 'LEFT("Kofi Mensah",4)&"-"&UPPER(MID("abc",2,1))')).toBe('Kofi-B')
    expect(calc(wb, 'TEXTJOIN(", ",TRUE,F1:F5)')).toBe('Done, Done, At risk, done')
  })

  it('reports circular references', () => {
    const c = book({ S: { A1: '=B1+1', B1: '=A1+1' } })
    expect(val(c, 'A1')).toEqual({ error: '#CIRC!' })
  })

  it('handles long running balances', () => {
    const cells: Record<string, Value | string> = { H1: 100 }
    for (let r = 2; r <= 3000; r++) cells['H' + r] = `=H${r - 1}+1`
    expect(val(book({ S: cells }), 'H3000')).toBe(3099)
  })

  it('uses @formulajs/formulajs for the rest', () => {
    useFunctions(extend(FUNCTIONS, formulajs as unknown as Record<string, unknown>))
    expect(calc(wb, 'STDEV.S(C7:C10)')).toBeCloseTo(1190.61, 1)
    expect(calc(wb, 'PMT(0.05/12,12,1000)')).toBeCloseTo(-85.61, 2)
    useFunctions(FUNCTIONS)
  })
})

it('parseCell round trip', () => {
  expect(parseCell('AA10')).toEqual({ r: 9, c: 26 })
})
