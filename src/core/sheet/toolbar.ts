/**
 * What the spreadsheet toolbar's smarter buttons do, worked out without the DOM:
 * more or fewer decimals, AutoSum and a chart from the picked cells.
 */
import { cellName, colName } from './address'
import { colWidth, getCell, plainText, type Sheet } from './model'
import { formatValue } from './format'
import type { ChartInput } from './ops'

export interface Area {
  r1: number
  c1: number
  r2: number
  c2: number
}

/** One more (dir 1) or one fewer (dir -1) decimal place in a number format, as Excel's buttons do. */
export function stepDecimals(fmt: string | undefined, dir: 1 | -1, value?: unknown): string {
  // No format yet: start from what the value shows, like 2.5 -> "0.0".
  const base = fmt && fmt !== 'General' ? fmt : typeof value === 'number' && !Number.isInteger(value) ? `0.${'0'.repeat(Math.min(10, String(value).split('.')[1]?.length ?? 0))}` : '0'
  // The first number placeholder run, like "#,##0.00" in "£#,##0.00".
  const m = /([#0,]*0)(\.0*)?/.exec(base)
  if (!m) return base
  const places = m[2] ? m[2].length - 1 : 0
  const next = Math.max(0, Math.min(10, places + dir))
  const run = m[1] + (next ? `.${'0'.repeat(next)}` : '')
  return base.slice(0, m.index) + run + base.slice(m.index + m[0].length)
}

const isNumber = (s: Sheet, r: number, c: number) => {
  const cell = getCell(s, r, c)
  return typeof cell?.v === 'number' || !!cell?.f
}

/**
 * AutoSum (Σ): the formula to add and where it goes. With one cell picked, it adds up the
 * numbers above it (or to its left); with a range picked, it goes in the cell under it.
 */
export function autoSum(s: Sheet, a: Area): { cell: string; formula: string } | null {
  if (a.r1 === a.r2 && a.c1 === a.c2) {
    const { r1: r, c1: c } = a
    let top = r - 1
    while (top >= 0 && isNumber(s, top, c)) top--
    if (top < r - 1) return { cell: cellName(r, c), formula: `=SUM(${cellName(top + 1, c)}:${cellName(r - 1, c)})` }
    let left = c - 1
    while (left >= 0 && isNumber(s, r, left)) left--
    if (left < c - 1) return { cell: cellName(r, c), formula: `=SUM(${cellName(r, left + 1)}:${cellName(r, c - 1)})` }
    return null
  }
  // A column (or several) picked: one total under each.
  return { cell: cellName(a.r2 + 1, a.c1), formula: `=SUM(${cellName(a.r1, a.c1)}:${cellName(a.r2, a.c1)})` }
}

/** The totals AutoSum adds under a range of several columns: one per column. */
export function autoSums(s: Sheet, a: Area): { cell: string; formula: string }[] {
  if (a.r1 === a.r2 && a.c1 === a.c2) {
    const one = autoSum(s, a)
    return one ? [one] : []
  }
  const out: { cell: string; formula: string }[] = []
  for (let c = a.c1; c <= a.c2; c++) out.push({ cell: cellName(a.r2 + 1, c), formula: `=SUM(${cellName(a.r1, c)}:${cellName(a.r2, c)})` })
  return out
}

/**
 * A column chart of the picked cells: the first column names the bars when it holds words,
 * a first row of words names the series, and the chart sits to the right of the data.
 */
export function chartFor(s: Sheet, a: Area): ChartInput | null {
  const words = (r: number, c: number) => {
    const v = getCell(s, r, c)?.v
    return v !== undefined && typeof v !== 'number' && plainText(v).trim() !== ''
  }
  const labelsCol = a.c2 > a.c1 && words(a.r1 + (a.r2 > a.r1 ? 1 : 0), a.c1)
  const headRow = a.r2 > a.r1 && [...Array(a.c2 - a.c1 + 1).keys()].some((i) => words(a.r1, a.c1 + i) && (!labelsCol || i > 0))
  const r0 = headRow ? a.r1 + 1 : a.r1
  const c0 = labelsCol ? a.c1 + 1 : a.c1
  if (r0 > a.r2 || c0 > a.c2) return null
  // Nothing to draw without a number among the values.
  let numbers = false
  for (let r = r0; r <= a.r2 && !numbers; r++) for (let c = c0; c <= a.c2 && !numbers; c++) numbers = typeof getCell(s, r, c)?.v === 'number'
  if (!numbers) return null
  const series = []
  for (let c = c0; c <= a.c2; c++) {
    const name = headRow ? plainText(getCell(s, a.r1, c)?.v) : undefined
    series.push({ ...(name ? { name } : {}), values: `${cellName(r0, c)}:${cellName(a.r2, c)}` })
  }
  const at = colName(a.c2 + 2)
  const end = colName(a.c2 + 8)
  return {
    type: 'column',
    range: `${at}${a.r1 + 1}:${end}${a.r1 + 16}`,
    ...(labelsCol ? { categories: `${cellName(r0, a.c1)}:${cellName(a.r2, a.c1)}` } : {}),
    series,
    legend: series.length > 1 ? 'bottom' : 'none'
  }
}

/**
 * Columns too narrow for their numbers once a format is applied (they would show ####):
 * how wide each needs to be, as Excel widens them. `size` is the font size in points.
 */
export function widthsForNumbers(s: Sheet, a: Area, fmt: string | null, size = 11): { col: string; width: number }[] {
  const out: { col: string; width: number }[] = []
  for (let c = a.c1; c <= Math.min(a.c2, a.c1 + 200); c++) {
    let need = 0
    for (let r = a.r1; r <= Math.min(a.r2, a.r1 + 5000); r++) {
      const v = getCell(s, r, c)?.v
      if (typeof v !== 'number') continue
      // About 0.62 em a digit in the grid's fonts, plus the cell's padding.
      need = Math.max(need, Math.ceil(formatValue(v, fmt ?? undefined).text.length * size * (96 / 72) * 0.55 + 12))
    }
    if (need > colWidth(s, c)) out.push({ col: colName(c), width: Math.min(400, need) })
  }
  return out
}
