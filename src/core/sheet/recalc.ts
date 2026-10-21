/**
 * Recalculation: works out every formula in a workbook and stores each result as the
 * cell's value, so what is drawn, exported and read by AI apps always matches the
 * formulas. Circular references give #CIRC! (Excel shows 0 and warns).
 */
import { cellName, parseCell } from './address'
import { Evaluator, scalar, type EvalContext, type FnTable } from './evaluate'
import { FormulaError, parse, type Node } from './formula'
import { FUNCTIONS } from './functions'
import { dataBounds, err, findSheet, isError, type Sheet, type Value, type Workbook } from './model'
import { serialFromDate } from './format'

const parsed = new Map<string, Node | FormulaError>()

/** A formula's tree, cached by its text (the tree holds where it points, not where it sits). */
export function parseCached(f: string): Node | FormulaError {
  let n = parsed.get(f)
  if (!n) {
    try {
      n = parse(f)
    } catch (e) {
      n = e instanceof FormulaError ? e : new FormulaError(String(e))
    }
    if (parsed.size > 20_000) parsed.clear()
    parsed.set(f, n)
  }
  return n
}

let functions: FnTable = FUNCTIONS

/** Swaps in a larger function table (Glance's own plus @formulajs/formulajs). */
export function useFunctions(table: FnTable): void {
  functions = table
}

export function todaySerial(d = new Date()): number {
  return serialFromDate(d.getFullYear(), d.getMonth() + 1, d.getDate())
}

export interface RecalcOptions {
  today?: number
}

/** Evaluates one formula as if it sat in `sheet` at (r, c), against the workbook as it is. */
export function evaluateFormula(wb: Workbook, sheet: string, r: number, c: number, f: string, opts: RecalcOptions = {}): Value {
  const calc = new Calc(wb, opts)
  return calc.formula(sheet, r, c, f)
}

class Calc {
  private readonly memo = new Map<string, Value>()
  private readonly busy = new Set<string>()
  private readonly bounds = new Map<string, { rows: number; cols: number }>()
  private readonly sheets = new Map<string, Sheet>()

  constructor(
    readonly wb: Workbook,
    readonly opts: RecalcOptions
  ) {
    for (const s of wb.sheets) this.sheets.set(s.name.toLowerCase(), s)
  }

  cell(sheet: string, r: number, c: number): Value {
    const s = this.sheets.get(sheet.toLowerCase())
    if (!s) return err('#REF!')
    const name = cellName(r, c)
    const cell = s.cells[name]
    if (!cell) return null
    if (!cell.f) return cell.v === undefined ? null : cell.v
    const key = `${s.name}!${name}`
    const have = this.memo.get(key)
    if (have !== undefined) return have
    if (this.busy.has(key)) return err('#CIRC!')
    this.busy.add(key)
    let v: Value
    try {
      v = this.formula(s.name, r, c, cell.f)
    } catch (e) {
      v = e instanceof RangeError ? err('#CIRC!') : err('#VALUE!')
    }
    this.busy.delete(key)
    this.memo.set(key, v)
    return v
  }

  formula(sheet: string, r: number, c: number, f: string): Value {
    const tree = parseCached(f)
    if (tree instanceof FormulaError) return err('#NAME?')
    const ctx: EvalContext = {
      sheet,
      r,
      c,
      cell: (sh, rr, cc) => this.cell(sh, rr, cc),
      sheetName: (n) => findSheet(this.wb, n)?.name,
      bounds: (sh) => {
        let b = this.bounds.get(sh)
        if (!b) {
          const s = this.sheets.get(sh.toLowerCase())
          b = s ? dataBounds(s) : { rows: -1, cols: -1 }
          this.bounds.set(sh, b)
        }
        return b
      },
      today: this.opts.today ?? todaySerial()
    }
    const v = scalar(new Evaluator(ctx, functions).eval(tree))
    if (typeof v === 'number' && !isFinite(v)) return err('#NUM!')
    return v
  }
}

const same = (a: Value | undefined, b: Value): boolean => a === b || (isError(a) && isError(b) && a.error === b.error)

/**
 * Every formula worked out. Returns the same workbook when nothing changed, else a new one
 * sharing every sheet and cell whose value stayed the same.
 */
export function recalc(wb: Workbook, opts: RecalcOptions = {}): Workbook {
  const calc = new Calc(wb, opts)
  let changed = false
  const sheets = wb.sheets.map((s) => {
    // Top to bottom, so running totals that read the row above don't recurse deeply.
    const keys = Object.keys(s.cells).filter((k) => s.cells[k].f)
    keys.sort((a, b) => {
      const x = parseCell(a)!
      const y = parseCell(b)!
      return x.r - y.r || x.c - y.c
    })
    let cells: Sheet['cells'] | null = null
    for (const k of keys) {
      const a = parseCell(k)!
      const v = calc.cell(s.name, a.r, a.c)
      if (!same(s.cells[k].v, v)) {
        cells ??= { ...s.cells }
        cells[k] = { ...s.cells[k], v }
      }
    }
    if (!cells) return s
    changed = true
    return { ...s, cells }
  })
  return changed ? { ...wb, sheets } : wb
}
