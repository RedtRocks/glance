/**
 * Spreadsheet templates (src/sheet/templates, built from the template boards by
 * scripts/build-sheet-templates.mjs): the board's sheets as drawn, plus the sheet
 * operations that make them live (formulas, formats, rules, drop-downs, charts),
 * applied when the template is used so they go through the same checks as any edit.
 */
import { applyOps, type SheetOp } from './ops'
import { dateFromSerial, parseEntry, serialFromDate } from './format'
import type { Cell, Run, Sheet, Workbook } from './model'

export type Purpose = 'School' | 'Work' | 'Events' | 'Personal' | 'Clubs'

export interface SheetTemplateInfo {
  id: string
  name: string
  blurb: string
  purpose: Purpose
  look: string
  fonts: string[]
  /** What each sheet is for, in order. */
  sheets: string[]
}

/** A cell as the board showed it: `shown` is its text there, for checking the formulas. */
export type TemplateCell = Cell & { shown?: string; pill?: string }

export interface SheetTemplate {
  id: string
  sheets: (Omit<Sheet, 'cells'> & { cells: Record<string, TemplateCell> })[]
  ops: SheetOp[]
  /** The date the sample data is "as of", yyyy-mm-dd; formulas use it as today. */
  today: string | null
  checks: Record<string, unknown>
}

export function templateToday(t: SheetTemplate): number | undefined {
  const m = t.today && /^(\d{4})-(\d{2})-(\d{2})$/.exec(t.today)
  return m ? serialFromDate(+m[1], +m[2], +m[3]) : undefined
}

/** The template's workbook, with its sample text in the person's language when `translate` is given. */
export function templateWorkbook(t: SheetTemplate, translate: (s: string) => string = (s) => s): Workbook {
  const today = templateToday(t)
  const year = today !== undefined ? dateFromSerial(today).y : undefined
  const sheets: Sheet[] = t.sheets.map((s) => {
    const cells: Record<string, Cell> = {}
    for (const [k, c] of Object.entries(s.cells)) {
      const { shown: _s, pill: _p, ...cell } = c
      void _s
      void _p
      if (typeof cell.v === 'string' && !cell.f) Object.assign(cell, typed(cell, translate, year))
      cells[k] = cell
    }
    return { ...structuredClone({ ...s, cells: {} }), cells }
  })
  return applyOps({ sheets }, t.ops, { today: templateToday(t) }).wb
}

/** Splits rich text into lines of runs. */
function lines(rich: Run[]): Run[][] {
  const out: Run[][] = [[]]
  for (const r of rich) {
    const parts = r.text.split('\n')
    parts.forEach((p, i) => {
      if (i > 0) out.push([])
      if (p) out[out.length - 1].push({ ...r, text: p })
    })
  }
  return out.filter((l) => l.length)
}

const lineText = (l: Run[]) => l.map((r) => r.text).join('').trim()

/**
 * The board's text as a value: numbers, money, percents and dates become numbers with a
 * format, and a tile's one number line becomes its value with the other lines as its label.
 * Text that stays text is translated.
 */
function typed(cell: Cell, translate: (s: string) => string, year: number | undefined): Partial<Cell> {
  const text = cell.v as string
  if (!cell.rich) {
    const p = parseEntry(text, { dayFirst: true, year })
    if (typeof p.value === 'number' || typeof p.value === 'boolean') return { v: p.value, s: p.numFmt && !cell.s?.numFmt ? { ...cell.s, numFmt: p.numFmt } : cell.s }
    return { v: translate(text) }
  }
  const ls = lines(cell.rich)
  const nums = ls.map((l) => parseEntry(lineText(l), { dayFirst: true, year })).map((p) => (typeof p.value === 'number' ? p : null))
  const at = nums.findIndex((p) => p)
  if (ls.length > 1 && at >= 0 && nums.filter((p) => p).length === 1) {
    const p = nums[at]!
    const tr = (l: Run[]) => l.map((r) => ({ ...r, text: translate(r.text) }))
    const join = (group: Run[][]) => group.flatMap((l, i) => tr(l).map((r, j) => (i > 0 && j === 0 ? { ...r, text: '\n' + r.text } : r)))
    const above = ls.slice(0, at)
    const below = ls.slice(at + 1)
    const font = ls[at].reduce((a, b) => ((b.font?.size ?? 0) > (a.font?.size ?? 0) ? b : a)).font
    return {
      v: p.value as number,
      rich: undefined,
      s: { ...cell.s, ...(font ? { font } : {}), ...(p.numFmt && !cell.s?.numFmt ? { numFmt: p.numFmt } : {}), align: { ...cell.s?.align, wrap: false } },
      label: { ...(above.length ? { above: join(above) } : {}), ...(below.length ? { below: join(below) } : {}) }
    }
  }
  const rich = cell.rich.map((r) => ({ ...r, text: r.text.replace(/[^\n]+/g, (x) => (x.trim() ? x.replace(x.trim(), translate(x.trim())) : x)) }))
  return { rich, v: rich.map((r) => r.text).join('') }
}
