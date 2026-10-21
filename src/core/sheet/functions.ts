/**
 * The worksheet functions Glance works out itself: the ones templates and everyday
 * sheets use, with Excel's rules for text, blanks and errors in ranges. Anything else is
 * looked up in @formulajs/formulajs once src/sheet has loaded it (see `extend`).
 */
import { compare, isMatrix, scalar, toBool, toNumber, toText, type EvalValue, type Evaluator, type FnTable, type Matrix, type Fn, type LazyFn } from './evaluate'
import { err, isError, type CellError, type Value } from './model'
import { dateFromSerial, formatValue, parseEntry, serialFromDate } from './format'
import type { Node } from './formula'

type V = Value
const NA = () => err('#N/A')
const VALUE = () => err('#VALUE!')
const DIV0 = () => err('#DIV/0!')
const NUM = () => err('#NUM!')

/** Every value of the arguments, ranges flattened, row by row. */
function values(args: EvalValue[]): { v: V; fromRange: boolean }[] {
  const out: { v: V; fromRange: boolean }[] = []
  for (const a of args) {
    if (isMatrix(a)) for (const row of a.m) for (const v of row) out.push({ v, fromRange: true })
    else out.push({ v: a, fromRange: false })
  }
  return out
}

/** Numbers for SUM-like functions: ranges give only their numbers; typed arguments are coerced. */
function numbers(args: EvalValue[]): number[] | CellError {
  const out: number[] = []
  for (const { v, fromRange } of values(args)) {
    if (isError(v)) return v
    if (fromRange) {
      if (typeof v === 'number') out.push(v)
    } else if (v !== null) {
      const n = toNumber(v)
      if (isError(n)) return n
      out.push(n)
    }
  }
  return out
}

const withNums = (fn: (ns: number[]) => V): Fn => (args) => {
  const ns = numbers(args)
  return isError(ns) ? ns : fn(ns)
}

const num1 = (fn: (x: number, ...rest: number[]) => V): Fn => (args) => {
  const xs: number[] = []
  for (const a of args) {
    const n = toNumber(scalar(a))
    if (isError(n)) return n
    xs.push(n)
  }
  return fn(xs[0] ?? 0, ...xs.slice(1))
}

const text1 = (fn: (s: string, ...rest: V[]) => V): Fn => (args) => {
  const s = toText(scalar(args[0] ?? null))
  return isError(s) ? s : fn(s, ...args.slice(1).map(scalar))
}

const matrixOf = (v: EvalValue): V[][] => (isMatrix(v) ? v.m : [[v]])
const flat = (v: EvalValue): V[] => matrixOf(v).flat()

function roundTo(x: number, digits: number, mode: 'near' | 'up' | 'down'): number {
  const f = Math.pow(10, digits)
  const y = Math.abs(x) * f
  const r = mode === 'near' ? Math.round(y + 1e-9) : mode === 'up' ? Math.ceil(y - 1e-9) : Math.floor(y + 1e-9)
  return Math.sign(x) * r / f
}

// ---------------------------------------------------------------------------
// Criteria, as COUNTIF, SUMIF and friends read them.

/** IFERROR and IFNA: the fallback for each failing value, cell by cell over a range. */
function orElse(args: Node[], ev: Evaluator, bad: (x: V) => boolean): EvalValue {
  const v = ev.eval(args[0] ?? { t: 'empty' })
  let other: EvalValue | undefined
  const alt = (): V => scalar((other ??= args[1] ? ev.eval(args[1]) : ''))
  if (isMatrix(v)) return { m: v.m.map((row) => row.map((x) => (bad(x) ? alt() : x))) }
  return bad(v) ? (args[1] ? ev.eval(args[1]) : '') : v
}

export function criterion(c: V): (v: V) => boolean {
  if (typeof c === 'number' || typeof c === 'boolean') return (v) => v !== null && compare(v, c) === 0 && typeof v === typeof c
  if (c === null) return (v) => v === null || v === ''
  if (isError(c)) return (v) => isError(v) && v.error === c.error
  const m = /^(<=|>=|<>|=|<|>)?(.*)$/s.exec(c)!
  const op = m[1] ?? '='
  const rest = m[2]
  const n = rest.trim() === '' ? NaN : Number(rest.replace(/,/g, ''))
  if (!isNaN(n)) {
    return (v) => {
      if (typeof v !== 'number') return op === '<>'
      const d = v - n
      return op === '=' ? d === 0 : op === '<>' ? d !== 0 : op === '<' ? d < 0 : op === '>' ? d > 0 : op === '<=' ? d <= 0 : d >= 0
    }
  }
  const lower = rest.toLowerCase()
  if (op === '=' || op === '<>') {
    if (rest === '') return op === '=' ? (v) => v === null || v === '' : (v) => v !== null && v !== ''
    const re = /[*?~]/.test(rest) ? wildcard(rest) : null
    const hit = (v: V) => typeof v === 'string' && (re ? re.test(v) : v.toLowerCase() === lower) || (typeof v === 'boolean' && String(v).toLowerCase() === lower)
    return op === '=' ? hit : (v) => !hit(v)
  }
  return (v) => {
    if (typeof v !== 'string') return false
    const d = compare(v, rest)
    return op === '<' ? d < 0 : op === '>' ? d > 0 : op === '<=' ? d <= 0 : d >= 0
  }
}

function wildcard(p: string): RegExp {
  let re = ''
  for (let i = 0; i < p.length; i++) {
    const ch = p[i]
    if (ch === '~' && i + 1 < p.length) re += p[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    else if (ch === '*') re += '.*'
    else if (ch === '?') re += '.'
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`, 'is')
}

/** Positions (row, col) in `range` where every (range, criterion) pair matches. */
function matching(pairs: [EvalValue, EvalValue][]): { rows: number; cols: number; hits: boolean[][] } | CellError {
  const first = matrixOf(pairs[0][0])
  const rows = first.length
  const cols = first[0]?.length ?? 0
  const hits = first.map((row) => row.map(() => true))
  for (const [range, crit] of pairs) {
    const m = matrixOf(range)
    if (m.length !== rows || (m[0]?.length ?? 0) !== cols) return VALUE()
    const test = criterion(scalar(crit))
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (hits[r][c] && !test(m[r][c])) hits[r][c] = false
  }
  return { rows, cols, hits }
}

/** SUMIF's sum range is the same shape as its criteria range, starting at its own top-left. */
function sameShape(ev: Evaluator, node: Node | undefined, like: EvalValue): EvalValue {
  if (!node) return like
  const ref = ev.refOf(node)
  const shape = matrixOf(like)
  if (!ref || !isMatrix(like)) return ev.eval(node)
  return ev.ref({ ...ref, sheet: ref.sheet, area: true, kind: 'cell', r2: ref.r1 + shape.length - 1, c2: ref.c1 + (shape[0]?.length ?? 1) - 1 })
}

function aggregate(kind: 'sum' | 'count' | 'avg' | 'min' | 'max', target: EvalValue | null, pairs: [EvalValue, EvalValue][]): V {
  const hit = matching(pairs)
  if (isError(hit)) return hit
  const t = target ? matrixOf(target) : null
  let n = 0
  let sum = 0
  let min = Infinity
  let max = -Infinity
  for (let r = 0; r < hit.rows; r++)
    for (let c = 0; c < hit.cols; c++) {
      if (!hit.hits[r][c]) continue
      if (!t) {
        n++
        continue
      }
      const v = t[r]?.[c] ?? null
      if (isError(v)) return v
      if (typeof v !== 'number') continue
      n++
      sum += v
      if (v < min) min = v
      if (v > max) max = v
    }
  if (kind === 'count') return n
  if (kind === 'sum') return Number(sum.toPrecision(15))
  if (kind === 'avg') return n ? sum / n : DIV0()
  if (kind === 'min') return n ? min : 0
  return n ? max : 0
}

const sumif = (kind: 'sum' | 'avg'): LazyFn => (args, ev) => {
  if (args.length < 2) return VALUE()
  const range = ev.eval(args[0])
  return aggregate(kind, sameShape(ev, args[2], range), [[range, ev.eval(args[1])]])
}

const ifs = (kind: 'sum' | 'avg' | 'min' | 'max' | 'count'): Fn => (args) => {
  const start = kind === 'count' ? 0 : 1
  if ((args.length - start) % 2 !== 0 || args.length - start < 2) return VALUE()
  const pairs: [EvalValue, EvalValue][] = []
  for (let i = start; i < args.length; i += 2) pairs.push([args[i], args[i + 1]])
  return aggregate(kind, kind === 'count' ? null : args[0], pairs)
}

// ---------------------------------------------------------------------------
// Lookups

function matchIn(list: V[], want: V, type: number): number {
  if (type === 0) {
    const test = typeof want === 'string' && /[*?~]/.test(want) ? criterion(want) : (v: V) => v !== null && compare(v, want) === 0 && (typeof v === 'string') === (typeof want === 'string')
    return list.findIndex((v) => test(v))
  }
  // Sorted lists: the last value <= want (type 1) or >= want (type -1).
  let found = -1
  for (let i = 0; i < list.length; i++) {
    const v = list[i]
    if (v === null) continue
    const d = compare(v, want)
    if (type > 0 ? d <= 0 : d >= 0) found = i
    else break
  }
  return found
}

const vlookup = (horizontal: boolean): Fn => (args) => {
  const want = scalar(args[0] ?? null)
  if (isError(want)) return want
  const table = matrixOf(args[1] ?? null)
  const idx = toNumber(scalar(args[2] ?? null))
  if (isError(idx)) return idx
  const approx = args[3] === undefined || args[3] === null ? true : toBool(scalar(args[3]))
  if (isError(approx)) return approx
  const keys = horizontal ? table[0] ?? [] : table.map((r) => r[0])
  const i = matchIn(keys, want, approx ? 1 : 0)
  if (i < 0) return NA()
  const k = Math.trunc(idx) - 1
  const v = horizontal ? table[k]?.[i] : table[i]?.[k]
  return v === undefined ? err('#REF!') : v
}

// ---------------------------------------------------------------------------
// Dates

const ymd = (v: V): ReturnType<typeof dateFromSerial> | CellError => {
  const n = toNumber(v)
  if (isError(n)) return n
  if (n < 0) return NUM()
  return dateFromSerial(n)
}

function dateFn(y: number, m: number, d: number): number {
  if (y < 1900) y += 1900
  const dt = new Date(Date.UTC(y, m - 1, d))
  return serialFromDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())
}

function addMonths(serial: number, months: number, end: boolean): number {
  const d = dateFromSerial(serial)
  const total = d.y * 12 + (d.m - 1) + months
  const y = Math.floor(total / 12)
  const m = (total % 12) + 1
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return serialFromDate(y, m, end ? last : Math.min(d.d, last))
}

function weekday(serial: number, type: number): number {
  const wd = dateFromSerial(serial).wd // 0 Sunday
  if (type === 2) return ((wd + 6) % 7) + 1
  if (type === 3) return (wd + 6) % 7
  return wd + 1
}

function holidays(v: EvalValue | undefined): Set<number> {
  return new Set(v === undefined ? [] : flat(v).filter((x): x is number => typeof x === 'number').map(Math.floor))
}

function networkdays(a: number, b: number, hol: Set<number>): number {
  const sign = a <= b ? 1 : -1
  let n = 0
  for (let d = Math.floor(Math.min(a, b)); d <= Math.floor(Math.max(a, b)); d++) {
    const wd = dateFromSerial(d).wd
    if (wd !== 0 && wd !== 6 && !hol.has(d)) n++
  }
  return n * sign
}

// ---------------------------------------------------------------------------

const eager: Record<string, Fn> = {
  SUM: withNums((ns) => Number(ns.reduce((a, b) => a + b, 0).toPrecision(15))),
  PRODUCT: withNums((ns) => ns.reduce((a, b) => a * b, 1)),
  AVERAGE: withNums((ns) => (ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : DIV0())),
  MIN: withNums((ns) => (ns.length ? Math.min(...ns) : 0)),
  MAX: withNums((ns) => (ns.length ? Math.max(...ns) : 0)),
  MEDIAN: withNums((ns) => {
    if (!ns.length) return NUM()
    const s = [...ns].sort((a, b) => a - b)
    const h = s.length >> 1
    return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2
  }),
  COUNT: (args) => values(args).filter(({ v, fromRange }) => typeof v === 'number' || (!fromRange && v !== null && !isError(toNumber(v)))).length,
  COUNTA: (args) => values(args).filter(({ v }) => v !== null && v !== undefined).length,
  COUNTBLANK: (args) => values(args).filter(({ v }) => v === null || v === '').length,
  AVERAGEA: (args) => {
    const vs = values(args).filter(({ v }) => v !== null)
    if (!vs.length) return DIV0()
    let s = 0
    for (const { v } of vs) {
      if (isError(v)) return v
      s += typeof v === 'number' ? v : v === true ? 1 : 0
    }
    return s / vs.length
  },
  LARGE: (args) => {
    const ns = numbers([args[0]])
    const k = toNumber(scalar(args[1] ?? null))
    if (isError(ns)) return ns
    if (isError(k)) return k
    const s = [...ns].sort((a, b) => b - a)
    return s[Math.ceil(k) - 1] ?? NUM()
  },
  SMALL: (args) => {
    const ns = numbers([args[0]])
    const k = toNumber(scalar(args[1] ?? null))
    if (isError(ns)) return ns
    if (isError(k)) return k
    const s = [...ns].sort((a, b) => a - b)
    return s[Math.ceil(k) - 1] ?? NUM()
  },
  RANK: (args) => rank(args),
  'RANK.EQ': (args) => rank(args),
  COUNTIFS: ifs('count'),
  SUMIFS: ifs('sum'),
  AVERAGEIFS: ifs('avg'),
  MINIFS: ifs('min'),
  MAXIFS: ifs('max'),
  COUNTIF: (args) => aggregate('count', null, [[args[0] ?? null, args[1] ?? null]]),
  SUMPRODUCT: (args) => {
    if (!args.length) return VALUE()
    const ms = args.map(matrixOf)
    const rows = ms[0].length
    const cols = ms[0][0]?.length ?? 0
    if (ms.some((m) => m.length !== rows || (m[0]?.length ?? 0) !== cols)) return VALUE()
    let s = 0
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        let p = 1
        for (const m of ms) {
          const v = m[r][c]
          if (isError(v)) return v
          p *= typeof v === 'number' ? v : typeof v === 'boolean' && ms.length === 1 ? 0 : typeof v === 'boolean' ? (v ? 1 : 0) : 0
        }
        s += p
      }
    return Number(s.toPrecision(15))
  },
  ROUND: num1((x, d = 0) => roundTo(x, Math.trunc(d), 'near')),
  ROUNDUP: num1((x, d = 0) => roundTo(x, Math.trunc(d), 'up')),
  ROUNDDOWN: num1((x, d = 0) => roundTo(x, Math.trunc(d), 'down')),
  TRUNC: num1((x, d = 0) => roundTo(x, Math.trunc(d), 'down')),
  INT: num1((x) => Math.floor(x)),
  ABS: num1((x) => Math.abs(x)),
  SIGN: num1((x) => Math.sign(x)),
  SQRT: num1((x) => (x < 0 ? NUM() : Math.sqrt(x))),
  POWER: num1((x, y = 1) => Math.pow(x, y)),
  EXP: num1((x) => Math.exp(x)),
  LN: num1((x) => (x <= 0 ? NUM() : Math.log(x))),
  LOG10: num1((x) => (x <= 0 ? NUM() : Math.log10(x))),
  LOG: num1((x, b = 10) => (x <= 0 ? NUM() : Math.log(x) / Math.log(b))),
  MOD: num1((x, y = 1) => (y === 0 ? DIV0() : x - y * Math.floor(x / y))),
  PI: () => Math.PI,
  CEILING: num1((x, s = 1) => (s === 0 ? 0 : Math.ceil(x / s - 1e-9) * s)),
  'CEILING.MATH': num1((x, s = 1) => (s === 0 ? 0 : Math.ceil(x / s - 1e-9) * s)),
  FLOOR: num1((x, s = 1) => (s === 0 ? DIV0() : Math.floor(x / s + 1e-9) * s)),
  'FLOOR.MATH': num1((x, s = 1) => (s === 0 ? 0 : Math.floor(x / s + 1e-9) * s)),
  MROUND: num1((x, m = 1) => (m === 0 ? 0 : Math.round(x / m) * m)),
  RAND: () => Math.random(),
  RANDBETWEEN: num1((a, b = a) => Math.floor(Math.random() * (Math.floor(b) - Math.ceil(a) + 1)) + Math.ceil(a)),
  SUBTOTAL: (args) => {
    const code = toNumber(scalar(args[0] ?? null))
    if (isError(code)) return code
    const fn = ({ 1: 'AVERAGE', 2: 'COUNT', 3: 'COUNTA', 4: 'MAX', 5: 'MIN', 6: 'PRODUCT', 9: 'SUM' } as Record<number, string>)[code % 100]
    return fn ? eager[fn](args.slice(1), undefined as never) : VALUE()
  },
  AND: (args) => logic(args, (bs) => bs.every(Boolean)),
  OR: (args) => logic(args, (bs) => bs.some(Boolean)),
  XOR: (args) => logic(args, (bs) => bs.filter(Boolean).length % 2 === 1),
  NOT: (args) => {
    const b = toBool(scalar(args[0] ?? null))
    return isError(b) ? b : !b
  },
  TRUE: () => true,
  FALSE: () => false,
  NA: () => NA(),
  ISBLANK: (args) => scalar(args[0] ?? null) === null,
  ISNUMBER: (args) => typeof scalar(args[0] ?? null) === 'number',
  ISTEXT: (args) => typeof scalar(args[0] ?? null) === 'string',
  ISNONTEXT: (args) => typeof scalar(args[0] ?? null) !== 'string',
  ISLOGICAL: (args) => typeof scalar(args[0] ?? null) === 'boolean',
  ISERROR: (args) => isError(scalar(args[0] ?? null)),
  ISNA: (args) => {
    const v = scalar(args[0] ?? null)
    return isError(v) && v.error === '#N/A'
  },
  ISERR: (args) => {
    const v = scalar(args[0] ?? null)
    return isError(v) && v.error !== '#N/A'
  },
  ISEVEN: num1((x) => Math.trunc(x) % 2 === 0),
  ISODD: num1((x) => Math.abs(Math.trunc(x)) % 2 === 1),
  N: (args) => {
    const v = scalar(args[0] ?? null)
    return typeof v === 'number' ? v : v === true ? 1 : isError(v) ? v : 0
  },
  CONCAT: (args) => joinText(values(args).map((x) => x.v), ''),
  CONCATENATE: (args) => joinText(args.map(scalar), ''),
  TEXTJOIN: (args) => {
    const sep = toText(scalar(args[0] ?? null))
    const skip = toBool(scalar(args[1] ?? null))
    if (isError(sep)) return sep
    if (isError(skip)) return skip
    const vs = values(args.slice(2)).map((x) => x.v).filter((v) => !skip || (v !== null && v !== ''))
    return joinText(vs, sep)
  },
  LEN: text1((s) => s.length),
  UPPER: text1((s) => s.toUpperCase()),
  LOWER: text1((s) => s.toLowerCase()),
  PROPER: text1((s) => s.toLowerCase().replace(/(^|[^\p{L}'’])(\p{L})/gu, (_, a, b) => a + b.toUpperCase())),
  TRIM: text1((s) => s.trim().replace(/ {2,}/g, ' ')),
  LEFT: text1((s, n = 1) => {
    const k = toNumber(n)
    return isError(k) ? k : k < 0 ? VALUE() : s.slice(0, Math.trunc(k))
  }),
  RIGHT: text1((s, n = 1) => {
    const k = toNumber(n)
    return isError(k) ? k : k < 0 ? VALUE() : Math.trunc(k) === 0 ? '' : s.slice(-Math.trunc(k))
  }),
  MID: text1((s, a = 1, n = 0) => {
    const x = toNumber(a)
    const k = toNumber(n)
    if (isError(x)) return x
    if (isError(k)) return k
    return x < 1 || k < 0 ? VALUE() : s.slice(Math.trunc(x) - 1, Math.trunc(x) - 1 + Math.trunc(k))
  }),
  REPT: text1((s, n = 0) => {
    const k = toNumber(n)
    return isError(k) ? k : k < 0 ? VALUE() : s.repeat(Math.min(Math.trunc(k), 32767))
  }),
  SUBSTITUTE: text1((s, from = '', to = '', nth = null) => {
    const a = toText(from)
    const b = toText(to)
    if (isError(a)) return a
    if (isError(b)) return b
    if (!a) return s
    if (nth === null) return s.split(a).join(b)
    const k = toNumber(nth)
    if (isError(k)) return k
    let i = -1
    for (let n = 0; n < k; n++) {
      i = s.indexOf(a, i + 1)
      if (i < 0) return s
    }
    return s.slice(0, i) + b + s.slice(i + a.length)
  }),
  FIND: (args) => findText(args, true),
  SEARCH: (args) => findText(args, false),
  EXACT: (args) => {
    const a = toText(scalar(args[0] ?? null))
    const b = toText(scalar(args[1] ?? null))
    return isError(a) ? a : isError(b) ? b : a === b
  },
  T: (args) => {
    const v = scalar(args[0] ?? null)
    return typeof v === 'string' ? v : isError(v) ? v : ''
  },
  VALUE: (args) => {
    const v = scalar(args[0] ?? null)
    if (typeof v === 'number') return v
    if (typeof v !== 'string') return isError(v) ? v : VALUE()
    const p = parseEntry(v)
    return typeof p.value === 'number' ? p.value : VALUE()
  },
  TEXT: (args) => {
    const v = scalar(args[0] ?? null)
    const fmt = toText(scalar(args[1] ?? null))
    if (isError(v)) return v
    if (isError(fmt)) return fmt
    const n = typeof v === 'string' ? toNumber(v) : v
    return formatValue(isError(n) ? v : n, fmt).text
  },
  FIXED: num1((x, d = 2) => formatValue(x, d > 0 ? `#,##0.${'0'.repeat(d)}` : '#,##0').text),
  CHAR: num1((x) => String.fromCharCode(x)),
  CODE: text1((s) => (s ? s.charCodeAt(0) : VALUE())),
  VLOOKUP: vlookup(false),
  HLOOKUP: vlookup(true),
  MATCH: (args) => {
    const want = scalar(args[0] ?? null)
    const list = flat(args[1] ?? null)
    const type = args[2] === undefined ? 1 : toNumber(scalar(args[2]))
    if (isError(type)) return type
    const i = matchIn(list, want, type)
    return i < 0 ? NA() : i + 1
  },
  LOOKUP: (args) => {
    const want = scalar(args[0] ?? null)
    const keys = flat(args[1] ?? null)
    const result = args[2] === undefined ? keys : flat(args[2])
    const i = matchIn(keys, want, 1)
    return i < 0 || i >= result.length ? NA() : result[i]
  },
  XLOOKUP: (args) => {
    const want = scalar(args[0] ?? null)
    const keys = flat(args[1] ?? null)
    const result = matrixOf(args[2] ?? null)
    const i = matchIn(keys, want, 0)
    if (i < 0) return args[3] !== undefined && args[3] !== null ? scalar(args[3]) : NA()
    const vertical = matrixOf(args[1] ?? null).length > 1
    const row = vertical ? result[i] : result.map((r) => r[i])
    if (!row) return err('#REF!')
    return row.length === 1 ? (row[0] ?? null) : { m: vertical ? [row] : row.map((x) => [x]) }
  },
  INDEX: (args) => {
    const m = matrixOf(args[0] ?? null)
    const r = args[1] === undefined || args[1] === null ? 0 : toNumber(scalar(args[1]))
    const c = args[2] === undefined || args[2] === null ? 0 : toNumber(scalar(args[2]))
    if (isError(r)) return r
    if (isError(c)) return c
    // INDEX(row, n) on a single row picks the column.
    if (m.length === 1 && args[2] === undefined) return m[0][Math.trunc(r) - 1] ?? err('#REF!')
    if (r === 0 && c === 0) return { m }
    if (r === 0) return { m: m.map((row) => [row[Math.trunc(c) - 1] ?? null]) }
    if (c === 0 && (m[0]?.length ?? 0) > 1) return { m: [m[Math.trunc(r) - 1] ?? []] }
    const v = m[Math.trunc(r) - 1]?.[Math.trunc(c || 1) - 1]
    return v === undefined ? err('#REF!') : v
  },
  CHOOSE: (args) => {
    const i = toNumber(scalar(args[0] ?? null))
    if (isError(i)) return i
    const v = args[Math.trunc(i)]
    return i < 1 || v === undefined ? VALUE() : v
  },
  ROWS: (args) => matrixOf(args[0] ?? null).length,
  COLUMNS: (args) => matrixOf(args[0] ?? null)[0]?.length ?? 0,
  TRANSPOSE: (args) => {
    const m = matrixOf(args[0] ?? null)
    return { m: (m[0] ?? []).map((_, c) => m.map((row) => row[c])) }
  },
  UNIQUE: (args) => {
    const seen = new Set<string>()
    const out: V[][] = []
    for (const v of flat(args[0] ?? null)) {
      const k = JSON.stringify(v)
      if (!seen.has(k)) {
        seen.add(k)
        out.push([v])
      }
    }
    return { m: out }
  },
  TODAY: (_a, ctx) => ctx.today,
  NOW: (_a, ctx) => ctx.today,
  DATE: num1((y, m = 1, d = 1) => dateFn(Math.trunc(y), Math.trunc(m), Math.trunc(d))),
  TIME: num1((h, m = 0, s = 0) => ((h * 3600 + m * 60 + s) / 86400) % 1),
  YEAR: (args) => part(args, (d) => d.y),
  MONTH: (args) => part(args, (d) => d.m),
  DAY: (args) => part(args, (d) => d.d),
  HOUR: (args) => part(args, (d) => d.h),
  MINUTE: (args) => part(args, (d) => d.mi),
  SECOND: (args) => part(args, (d) => d.s),
  WEEKDAY: num1((s, type = 1) => weekday(s, type)),
  WEEKNUM: num1((s, type = 1) => {
    const d = dateFromSerial(s)
    const jan1 = serialFromDate(d.y, 1, 1)
    const start = type === 2 ? (weekday(jan1, 2) - 1) : (weekday(jan1, 1) - 1)
    return Math.floor((Math.floor(s) - jan1 + start) / 7) + 1
  }),
  ISOWEEKNUM: num1((s) => {
    const day = Math.floor(s)
    const wd = weekday(day, 2)
    const thursday = day - wd + 4
    const y = dateFromSerial(thursday).y
    return Math.floor((thursday - serialFromDate(y, 1, 1)) / 7) + 1
  }),
  EDATE: num1((s, m = 0) => addMonths(Math.floor(s), Math.trunc(m), false)),
  EOMONTH: num1((s, m = 0) => addMonths(Math.floor(s), Math.trunc(m), true)),
  DAYS: num1((end, start = 0) => Math.floor(end) - Math.floor(start)),
  DATEDIF: (args) => {
    const a = toNumber(scalar(args[0] ?? null))
    const b = toNumber(scalar(args[1] ?? null))
    const unit = toText(scalar(args[2] ?? null))
    if (isError(a)) return a
    if (isError(b)) return b
    if (isError(unit)) return unit
    if (a > b) return NUM()
    const x = dateFromSerial(a)
    const y = dateFromSerial(b)
    const months = (y.y - x.y) * 12 + (y.m - x.m) - (y.d < x.d ? 1 : 0)
    switch (unit.toUpperCase()) {
      case 'D': return Math.floor(b) - Math.floor(a)
      case 'M': return months
      case 'Y': return Math.floor(months / 12)
      case 'YM': return months % 12
      case 'MD': return y.d >= x.d ? y.d - x.d : Math.floor(b) - addMonths(Math.floor(a), months, false)
      case 'YD': return Math.floor(b) - addMonths(Math.floor(a), Math.floor(months / 12) * 12, false)
    }
    return NUM()
  },
  NETWORKDAYS: (args) => {
    const a = toNumber(scalar(args[0] ?? null))
    const b = toNumber(scalar(args[1] ?? null))
    if (isError(a)) return a
    if (isError(b)) return b
    return networkdays(a, b, holidays(args[2]))
  },
  WORKDAY: (args) => {
    const a = toNumber(scalar(args[0] ?? null))
    const n = toNumber(scalar(args[1] ?? null))
    if (isError(a)) return a
    if (isError(n)) return n
    const hol = holidays(args[2])
    let d = Math.floor(a)
    let left = Math.abs(Math.trunc(n))
    const step = n < 0 ? -1 : 1
    while (left > 0) {
      d += step
      const wd = dateFromSerial(d).wd
      if (wd !== 0 && wd !== 6 && !hol.has(d)) left--
    }
    return d
  },
  DATEVALUE: (args) => {
    const v = scalar(args[0] ?? null)
    if (typeof v !== 'string') return VALUE()
    const p = parseEntry(v)
    return typeof p.value === 'number' && p.numFmt && /[dmy]/.test(p.numFmt) ? p.value : VALUE()
  }
}

function rank(args: EvalValue[]): V {
  const x = toNumber(scalar(args[0] ?? null))
  const ns = numbers([args[1] ?? null])
  const order = args[2] === undefined ? 0 : toNumber(scalar(args[2]))
  if (isError(x)) return x
  if (isError(ns)) return ns
  if (isError(order)) return order
  if (!ns.includes(x)) return NA()
  return ns.filter((n) => (order ? n < x : n > x)).length + 1
}

function part(args: EvalValue[], pick: (d: ReturnType<typeof dateFromSerial>) => number): V {
  const d = ymd(scalar(args[0] ?? null))
  return isError(d) ? d : pick(d)
}

function logic(args: EvalValue[], fn: (bs: boolean[]) => boolean): V {
  const bs: boolean[] = []
  for (const { v, fromRange } of values(args)) {
    if (isError(v)) return v
    if (v === null || (fromRange && typeof v === 'string')) continue
    const b = toBool(v)
    if (isError(b)) return b
    bs.push(b)
  }
  return bs.length ? fn(bs) : VALUE()
}

function joinText(vs: V[], sep: string): V {
  const parts: string[] = []
  for (const v of vs) {
    const s = toText(v)
    if (isError(s)) return s
    parts.push(s)
  }
  return parts.join(sep)
}

function findText(args: EvalValue[], exact: boolean): V {
  const needle = toText(scalar(args[0] ?? null))
  const hay = toText(scalar(args[1] ?? null))
  const start = args[2] === undefined ? 1 : toNumber(scalar(args[2]))
  if (isError(needle)) return needle
  if (isError(hay)) return hay
  if (isError(start)) return start
  if (exact) {
    const i = hay.indexOf(needle, start - 1)
    return i < 0 ? VALUE() : i + 1
  }
  const re = wildcard(needle.endsWith('*') ? needle : needle + '*')
  for (let i = start - 1; i < hay.length; i++) if (re.test(hay.slice(i))) return i + 1
  return VALUE()
}

const lazy: Record<string, LazyFn> = {
  IF: (args, ev) => {
    const c = scalar(ev.eval(args[0] ?? { t: 'empty' }))
    const b = toBool(c)
    if (isError(b)) return b
    if (b) return args[1] ? ev.eval(args[1]) : true
    return args[2] ? ev.eval(args[2]) : false
  },
  IFS: (args, ev) => {
    for (let i = 0; i + 1 < args.length; i += 2) {
      const b = toBool(scalar(ev.eval(args[i])))
      if (isError(b)) return b
      if (b) return ev.eval(args[i + 1])
    }
    return NA()
  },
  IFERROR: (args, ev) => orElse(args, ev, (x) => isError(x)),
  IFNA: (args, ev) => orElse(args, ev, (x) => isError(x) && x.error === '#N/A'),
  SWITCH: (args, ev) => {
    const want = scalar(ev.eval(args[0] ?? { t: 'empty' }))
    if (isError(want)) return want
    let i = 1
    for (; i + 1 < args.length; i += 2) if (compare(scalar(ev.eval(args[i])), want) === 0) return ev.eval(args[i + 1])
    return i < args.length ? ev.eval(args[i]) : NA()
  },
  SUMIF: sumif('sum'),
  AVERAGEIF: sumif('avg'),
  ROW: (args, ev) => {
    if (!args.length) return ev.ctx.r + 1
    const r = ev.refOf(args[0])
    return r ? r.r1 + 1 : VALUE()
  },
  COLUMN: (args, ev) => {
    if (!args.length) return ev.ctx.c + 1
    const r = ev.refOf(args[0])
    return r ? r.c1 + 1 : VALUE()
  },
}

/** Glance's own functions. */
export const FUNCTIONS: FnTable = { eager, lazy }

/** Names Glance works out itself, for the check and the formula bar. */
export const knownFunction = (name: string): boolean => name in FUNCTIONS.eager || name in FUNCTIONS.lazy

/**
 * Adds functions from a library like @formulajs/formulajs (functions taking plain values
 * and nested arrays). Glance's own stay in front.
 */
export function extend(table: FnTable, lib: Record<string, unknown>, toDate?: (d: Date) => number): FnTable {
  const extra: Record<string, Fn> = {}
  // Dotted names (STDEV.S) come as members of an object (STDEV: { S, P }).
  const entries = Object.entries(lib).flatMap(([name, fn]) =>
    fn && typeof fn === 'object' ? Object.entries(fn as Record<string, unknown>).map(([sub, f]) => [`${name}.${sub}`, f] as const) : [[name, fn] as const]
  )
  for (const [name, fn] of entries) {
    if (typeof fn !== 'function' || name in table.eager || name in table.lazy || !/^[A-Z][A-Z0-9.]*$/.test(name)) continue
    extra[name] = (args) => {
      const plain: unknown[] = []
      for (const a of args) {
        if (isMatrix(a)) {
          for (const row of a.m) for (const v of row) if (isError(v)) return v
          plain.push(a.m.map((row) => row.map((v) => (v === null ? undefined : v))))
        } else if (isError(a)) return a
        else plain.push(a === null ? undefined : a)
      }
      try {
        return fromLib((fn as (...x: unknown[]) => unknown)(...plain), toDate)
      } catch {
        return VALUE()
      }
    }
  }
  return { eager: { ...table.eager, ...extra }, lazy: table.lazy }
}

function fromLib(r: unknown, toDate?: (d: Date) => number): EvalValue {
  if (r === undefined || r === null) return null
  if (typeof r === 'number') return isFinite(r) ? r : NUM()
  if (typeof r === 'string' || typeof r === 'boolean') return r
  if (r instanceof Date) return toDate ? toDate(r) : VALUE()
  if (r instanceof Error) return err(/^#/.test(r.message) ? r.message : '#VALUE!')
  if (Array.isArray(r)) {
    const rows = (Array.isArray(r[0]) ? r : [r]) as unknown[][]
    return { m: rows.map((row) => row.map((x) => scalar(fromLib(x, toDate)))) } as Matrix
  }
  return VALUE()
}

