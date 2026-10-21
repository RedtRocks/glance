/**
 * Works out a parsed formula's value: references and ranges (on any sheet), operators
 * with Excel's coercion rules, and functions from functions.ts (plus any extra ones,
 * like @formulajs/formulajs, registered by src/sheet).
 */
import type { Node, Ref } from './formula'
import { err, isError, type CellError, type Value } from './model'

export interface Matrix {
  m: Value[][]
  /** Where a range came from, for functions that need the cells rather than the values. */
  ref?: { sheet: string; r1: number; c1: number; r2: number; c2: number }
}

export type EvalValue = Value | Matrix

export const isMatrix = (v: unknown): v is Matrix => !!v && typeof v === 'object' && Array.isArray((v as Matrix).m)

export interface EvalContext {
  /** The sheet and cell the formula is in. */
  sheet: string
  r: number
  c: number
  /** A cell's value, worked out first if it holds a formula. Undefined sheet: no such sheet. */
  cell(sheet: string, r: number, c: number): Value
  /** The real name of a sheet (case-insensitive), or undefined. */
  sheetName(name: string): string | undefined
  /** Last used row and column of a sheet, to clip whole-column ranges. */
  bounds(sheet: string): { rows: number; cols: number }
  /** Today as an Excel serial number. */
  today: number
}

export type Fn = (args: EvalValue[], ctx: EvalContext) => EvalValue
export type LazyFn = (args: Node[], ev: Evaluator) => EvalValue

export interface FnTable {
  eager: Record<string, Fn>
  lazy: Record<string, LazyFn>
}

export class Evaluator {
  constructor(
    readonly ctx: EvalContext,
    readonly fns: FnTable
  ) {}

  eval(n: Node): EvalValue {
    switch (n.t) {
      case 'num':
        return n.v
      case 'str':
        return n.v
      case 'bool':
        return n.v
      case 'err':
        return err(n.v)
      case 'empty':
        return null
      case 'ref':
        return this.ref(n.ref)
      case 'name':
        return err('#NAME?')
      case 'arr':
        return { m: n.rows.map((row) => row.map((x) => scalar(this.eval(x)))) }
      case 'pct':
        return map1(this.eval(n.a), (v) => {
          const x = toNumber(v)
          return isError(x) ? x : x / 100
        })
      case 'un':
        return map1(this.eval(n.a), (v) => {
          const x = toNumber(v)
          return isError(x) ? x : n.op === '-' ? -x : x
        })
      case 'bin':
        return map2(this.eval(n.a), this.eval(n.b), (a, b) => binary(n.op, a, b))
      case 'fn': {
        const lazy = this.fns.lazy[n.name]
        if (lazy) return lazy(n.args, this)
        const fn = this.fns.eager[n.name]
        if (!fn) return err('#NAME?')
        return fn(n.args.map((a) => this.eval(a)), this.ctx)
      }
    }
  }

  /** The cells a reference names: one value, or a matrix for a range. */
  ref(ref: Ref): EvalValue {
    const sheet = ref.sheet === undefined ? this.ctx.sheet : this.ctx.sheetName(ref.sheet)
    if (sheet === undefined) return err('#REF!')
    if (!ref.area && ref.kind === 'cell') return this.ctx.cell(sheet, ref.r1, ref.c1)
    const b = this.ctx.bounds(sheet)
    const r2 = ref.kind === 'cols' ? Math.min(ref.r2, Math.max(b.rows, ref.r1)) : ref.r2
    const c2 = ref.kind === 'rows' ? Math.min(ref.c2, Math.max(b.cols, ref.c1)) : ref.c2
    if ((r2 - ref.r1 + 1) * (c2 - ref.c1 + 1) > 5_000_000) return err('#NUM!')
    const m: Value[][] = []
    for (let r = ref.r1; r <= r2; r++) {
      const row: Value[] = []
      for (let c = ref.c1; c <= c2; c++) row.push(this.ctx.cell(sheet, r, c))
      m.push(row)
    }
    return { m, ref: { sheet, r1: ref.r1, c1: ref.c1, r2, c2 } }
  }

  /** A reference argument as written, for functions like ROW() and SUMIF's sum range. */
  refOf(n: Node): (Ref & { sheetName: string }) | null {
    if (n.t !== 'ref') return null
    const sheetName = n.ref.sheet === undefined ? this.ctx.sheet : this.ctx.sheetName(n.ref.sheet)
    return sheetName === undefined ? null : { ...n.ref, sheetName }
  }
}

/** The single value of something that may be a range (its top-left), as a cell shows it. */
export function scalar(v: EvalValue): Value {
  if (!isMatrix(v)) return v
  const x = v.m[0]?.[0]
  return x === undefined ? null : x
}

export function toNumber(v: Value): number | CellError {
  if (v === null) return 0
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  if (isError(v)) return v
  const s = v.trim()
  if (s === '') return err('#VALUE!')
  const pct = s.endsWith('%')
  const n = Number(s.replace(/^[£$€]/, '').replace(/,/g, '').replace(/%$/, ''))
  return isNaN(n) ? err('#VALUE!') : pct ? n / 100 : n
}

export function toText(v: Value): string | CellError {
  if (v === null) return ''
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (typeof v === 'number') return numText(v)
  if (isError(v)) return v
  return v
}

/** A number as text in formulas (=1/3&"" is 0.333333333333333). */
export function numText(n: number): string {
  if (Number.isInteger(n)) return String(n)
  return String(Number(n.toPrecision(15)))
}

export function toBool(v: Value): boolean | CellError {
  if (v === null) return false
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (isError(v)) return v
  const s = v.toUpperCase()
  if (s === 'TRUE') return true
  if (s === 'FALSE') return false
  return err('#VALUE!')
}

function map1(v: EvalValue, fn: (x: Value) => Value): EvalValue {
  return isMatrix(v) ? { m: v.m.map((row) => row.map(fn)) } : fn(v)
}

/** Element by element, stretching a single row, column or value across the other's shape. */
function map2(a: EvalValue, b: EvalValue, fn: (x: Value, y: Value) => Value): EvalValue {
  if (!isMatrix(a) && !isMatrix(b)) return fn(a, b)
  const A = isMatrix(a) ? a.m : [[a]]
  const B = isMatrix(b) ? b.m : [[b]]
  const rows = Math.max(A.length, B.length)
  const cols = Math.max(A[0]?.length ?? 0, B[0]?.length ?? 0)
  const pick = (M: Value[][], r: number, c: number): Value => {
    const row = M.length === 1 ? M[0] : M[r]
    if (!row) return err('#N/A')
    const x = row.length === 1 ? row[0] : row[c]
    return x === undefined ? err('#N/A') : x
  }
  const m: Value[][] = []
  for (let r = 0; r < rows; r++) {
    const row: Value[] = []
    for (let c = 0; c < cols; c++) row.push(fn(pick(A, r, c), pick(B, r, c)))
    m.push(row)
  }
  return { m }
}

/** Excel's ordering across types: numbers, then text, then TRUE/FALSE. Text compares without case. */
export function compare(a: Value, b: Value): number {
  if (a === null) a = typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0
  if (b === null) b = typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0
  const rank = (x: Value) => (typeof x === 'number' ? 0 : typeof x === 'string' ? 1 : 2)
  const ra = rank(a)
  const rb = rank(b)
  if (ra !== rb) return ra - rb
  if (typeof a === 'string' && typeof b === 'string') {
    const x = a.toLowerCase()
    const y = b.toLowerCase()
    return x < y ? -1 : x > y ? 1 : 0
  }
  const x = Number(a)
  const y = Number(b)
  return x < y ? -1 : x > y ? 1 : 0
}

function binary(op: string, a: Value, b: Value): Value {
  if (isError(a)) return a
  if (isError(b)) return b
  switch (op) {
    case '&': {
      const x = toText(a)
      const y = toText(b)
      return isError(x) ? x : isError(y) ? y : x + y
    }
    case '=': return compare(a, b) === 0
    case '<>': return compare(a, b) !== 0
    case '<': return compare(a, b) < 0
    case '>': return compare(a, b) > 0
    case '<=': return compare(a, b) <= 0
    case '>=': return compare(a, b) >= 0
  }
  const x = toNumber(a)
  const y = toNumber(b)
  if (isError(x)) return x
  if (isError(y)) return y
  switch (op) {
    case '+': return clean(x + y)
    case '-': return clean(x - y)
    case '*': return x * y
    case '/': return y === 0 ? err('#DIV/0!') : x / y
    case '^': {
      const r = Math.pow(x, y)
      return isFinite(r) ? r : err('#NUM!')
    }
  }
  return err('#VALUE!')
}

/** Adding money like 2.1 + 0.2 shouldn't show as 2.3000000000000003. */
function clean(n: number): number {
  return Math.abs(n) < 1e15 ? Number(n.toPrecision(15)) : n
}
