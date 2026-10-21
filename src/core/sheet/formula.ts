/**
 * Excel formulas: a tokenizer that keeps each token's place (so references can be moved
 * without reformatting the formula), a parser to a small tree, and the reference
 * rewriting that copying, filling and inserting or deleting rows and columns need.
 */
import { colIndex, colName, MAX_COLS, MAX_ROWS, sheetRef } from './address'

export interface Ref {
  sheet?: string
  /** cell: one cell or an area; cols: whole columns (A:C); rows: whole rows (3:5). */
  kind: 'cell' | 'cols' | 'rows'
  r1: number
  c1: number
  r2: number
  c2: number
  /** Which parts carry a $. */
  abs: { r1: boolean; c1: boolean; r2: boolean; c2: boolean }
  /** Whether it was written as a range (A1:A1 stays a range). */
  area: boolean
}

export type TokenType = 'num' | 'str' | 'err' | 'ref' | 'func' | 'name' | 'op' | 'paren' | 'comma' | 'semi' | 'brace' | 'ws'

export interface Token {
  type: TokenType
  text: string
  start: number
  ref?: Ref
}

export class FormulaError extends Error {}

const ERRORS = /^#(NULL!|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A|CIRC!|SPILL!|CALC!|GETTING_DATA)/i
const SHEET = /^(?:'((?:[^']|'')+)'|([A-Za-z_À-￿][\w.À-￿]*))!/
const CELLREF = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})(?::(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7}))?(?![\w(])/
const COLS = /^(\$?)([A-Za-z]{1,3}):(\$?)([A-Za-z]{1,3})(?![\w(])/
const ROWS = /^(\$?)(\d{1,7}):(\$?)(\d{1,7})(?![\w.(])/
const NUM = /^(\d+\.?\d*|\.\d+)([Ee][+-]?\d+)?/
const FUNC = /^([A-Za-z_][\w.]*)\s*\(/
const NAME = /^[A-Za-z_\\][\w.]*/
const OPS = /^(<=|>=|<>|[-+*/^&=<>%:])/

function refAt(s: string, sheet: string | undefined): { ref: Ref; len: number } | null {
  let m = CELLREF.exec(s)
  if (m) {
    const c1 = colIndex(m[2])
    const r1 = Number(m[4]) - 1
    const area = !!m[6]
    const c2 = area ? colIndex(m[6]) : c1
    const r2 = area ? Number(m[8]) - 1 : r1
    if (c1 >= MAX_COLS || c2 >= MAX_COLS || r1 < 0 || r2 < 0 || r1 >= MAX_ROWS || r2 >= MAX_ROWS) return null
    return { len: m[0].length, ref: { sheet, kind: 'cell', r1, c1, r2, c2, abs: { c1: !!m[1], r1: !!m[3], c2: area ? !!m[5] : !!m[1], r2: area ? !!m[7] : !!m[3] }, area } }
  }
  m = COLS.exec(s)
  if (m) return { len: m[0].length, ref: { sheet, kind: 'cols', r1: 0, c1: colIndex(m[2]), r2: MAX_ROWS - 1, c2: colIndex(m[4]), abs: { c1: !!m[1], r1: true, c2: !!m[3], r2: true }, area: true } }
  m = ROWS.exec(s)
  if (m) return { len: m[0].length, ref: { sheet, kind: 'rows', r1: Number(m[2]) - 1, c1: 0, r2: Number(m[4]) - 1, c2: MAX_COLS - 1, abs: { r1: !!m[1], c1: true, r2: !!m[3], c2: true }, area: true } }
  return null
}

/** Splits a formula (without its "=") into tokens, keeping whitespace so it can be put back together exactly. */
export function tokenize(f: string): Token[] {
  const out: Token[] = []
  let i = 0
  while (i < f.length) {
    const rest = f.slice(i)
    const ch = f[i]
    let m: RegExpExecArray | null
    if (/\s/.test(ch)) {
      const w = /^\s+/.exec(rest)![0]
      out.push({ type: 'ws', text: w, start: i })
      i += w.length
      continue
    }
    if (ch === '"') {
      let j = i + 1
      while (j < f.length) {
        if (f[j] === '"') {
          if (f[j + 1] === '"') j += 2
          else break
        } else j++
      }
      if (j >= f.length) throw new FormulaError('a text in quotes is missing its closing quote')
      out.push({ type: 'str', text: f.slice(i, j + 1), start: i })
      i = j + 1
      continue
    }
    if ((m = ERRORS.exec(rest))) {
      out.push({ type: 'err', text: m[0].toUpperCase(), start: i })
      i += m[0].length
      continue
    }
    // A reference can't follow a value directly (that's "A1 B1", an intersection, which Glance doesn't do).
    const prev = [...out].reverse().find((t) => t.type !== 'ws')
    const canStartValue = !prev || prev.type === 'op' || prev.type === 'paren' && prev.text === '(' || prev.type === 'comma' || prev.type === 'semi' || prev.type === 'func' || prev.type === 'brace' && prev.text === '{'
    if ((m = SHEET.exec(rest)) && canStartValue) {
      const sheet = m[1] !== undefined ? m[1].replace(/''/g, "'") : m[2]
      const r = refAt(rest.slice(m[0].length), sheet)
      if (r) {
        out.push({ type: 'ref', text: rest.slice(0, m[0].length + r.len), start: i, ref: r.ref })
        i += m[0].length + r.len
        continue
      }
      if (/^#REF!/i.test(rest.slice(m[0].length))) {
        const len = m[0].length + 5
        out.push({ type: 'err', text: '#REF!', start: i }) // i18n-ignore
        i += len
        continue
      }
    }
    if (canStartValue && (m = FUNC.exec(rest))) {
      out.push({ type: 'func', text: m[0], start: i })
      i += m[0].length
      continue
    }
    if (canStartValue) {
      const r = refAt(rest, undefined)
      if (r) {
        out.push({ type: 'ref', text: rest.slice(0, r.len), start: i, ref: r.ref })
        i += r.len
        continue
      }
    }
    if ((m = NUM.exec(rest))) {
      out.push({ type: 'num', text: m[0], start: i })
      i += m[0].length
      continue
    }
    if ((m = NAME.exec(rest))) {
      out.push({ type: 'name', text: m[0], start: i })
      i += m[0].length
      continue
    }
    if ((m = OPS.exec(rest))) {
      out.push({ type: 'op', text: m[0], start: i })
      i += m[0].length
      continue
    }
    if (ch === '(' || ch === ')') out.push({ type: 'paren', text: ch, start: i })
    else if (ch === ',') out.push({ type: 'comma', text: ch, start: i })
    else if (ch === ';') out.push({ type: 'semi', text: ch, start: i })
    else if (ch === '{' || ch === '}') out.push({ type: 'brace', text: ch, start: i })
    else throw new FormulaError(`"${ch}" can't be used here`)
    i++
  }
  return out
}

// ---------------------------------------------------------------------------
// Parsing

export type Node =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'bool'; v: boolean }
  | { t: 'err'; v: string }
  | { t: 'ref'; ref: Ref }
  | { t: 'fn'; name: string; args: Node[] }
  | { t: 'un'; op: '-' | '+'; a: Node }
  | { t: 'bin'; op: string; a: Node; b: Node }
  | { t: 'pct'; a: Node }
  | { t: 'arr'; rows: Node[][] }
  | { t: 'name'; name: string }
  | { t: 'empty' }

const BINARY: Record<string, number> = { '=': 1, '<>': 1, '<': 1, '>': 1, '<=': 1, '>=': 1, '&': 2, '+': 3, '-': 3, '*': 4, '/': 4, '^': 5 }

export function parse(f: string): Node {
  const toks = tokenize(f).filter((t) => t.type !== 'ws')
  let i = 0
  const peek = () => toks[i]
  const next = () => toks[i++]
  const expect = (type: TokenType, text?: string) => {
    const t = next()
    if (!t || t.type !== type || (text && t.text !== text)) throw new FormulaError(t ? `unexpected "${t.text}"` : `the formula ends too soon${text ? ` (missing "${text}")` : ''}`)
    return t
  }

  function primary(): Node {
    const t = next()
    if (!t) throw new FormulaError('the formula ends too soon')
    switch (t.type) {
      case 'num':
        return { t: 'num', v: Number(t.text) }
      case 'str':
        return { t: 'str', v: t.text.slice(1, -1).replace(/""/g, '"') }
      case 'err':
        return { t: 'err', v: t.text }
      case 'ref':
        return { t: 'ref', ref: t.ref! }
      case 'name': {
        const up = t.text.toUpperCase()
        if (up === 'TRUE' || up === 'FALSE') return { t: 'bool', v: up === 'TRUE' }
        return { t: 'name', name: t.text }
      }
      case 'func': {
        const name = t.text.replace(/\s*\($/, '').toUpperCase().replace(/^_XLFN\./, '').replace(/^_XLWS\./, '')
        const args: Node[] = []
        if (peek()?.type === 'paren' && peek().text === ')') {
          next()
          return { t: 'fn', name, args }
        }
        for (;;) {
          const p = peek()
          if (p && (p.type === 'comma' || p.type === 'semi' || (p.type === 'paren' && p.text === ')'))) args.push({ t: 'empty' })
          else args.push(expr(0))
          const sep = next()
          if (!sep) throw new FormulaError(`${name}( is missing its closing bracket`)
          if (sep.type === 'paren' && sep.text === ')') break
          if (sep.type !== 'comma' && sep.type !== 'semi') throw new FormulaError(`unexpected "${sep.text}" in ${name}()`)
        }
        return { t: 'fn', name, args }
      }
      case 'paren': {
        if (t.text !== '(') throw new FormulaError('unexpected ")"')
        const e = expr(0)
        expect('paren', ')')
        return e
      }
      case 'brace': {
        if (t.text !== '{') throw new FormulaError('unexpected "}"')
        const rows: Node[][] = [[]]
        for (;;) {
          rows[rows.length - 1].push(unary())
          const sep = next()
          if (!sep) throw new FormulaError('an array is missing its closing "}"')
          if (sep.type === 'brace' && sep.text === '}') break
          if (sep.type === 'semi') rows.push([])
          else if (sep.type !== 'comma') throw new FormulaError(`unexpected "${sep.text}" in an array`)
        }
        return { t: 'arr', rows }
      }
      case 'op':
        if (t.text === '-' || t.text === '+') {
          i--
          return unary()
        }
        throw new FormulaError(`unexpected "${t.text}"`)
      default:
        throw new FormulaError(`unexpected "${t.text}"`)
    }
  }

  function postfix(): Node {
    let n = primary()
    while (peek()?.type === 'op' && peek().text === '%') {
      next()
      n = { t: 'pct', a: n }
    }
    return n
  }

  // Excel binds the sign tighter than ^, so -2^2 is 4.
  function unary(): Node {
    const t = peek()
    if (t?.type === 'op' && (t.text === '-' || t.text === '+')) {
      next()
      return { t: 'un', op: t.text as '-' | '+', a: unary() }
    }
    return postfix()
  }

  function expr(minPrec: number): Node {
    let left = unary()
    for (;;) {
      const t = peek()
      if (!t || t.type !== 'op' || !(t.text in BINARY)) break
      const prec = BINARY[t.text]
      if (prec < minPrec) break
      next()
      // ^ is left-associative in Excel too.
      const right = expr(prec + 1)
      left = { t: 'bin', op: t.text, a: left, b: right }
    }
    return left
  }

  if (!toks.length) throw new FormulaError('the formula is empty')
  const tree = expr(0)
  if (i < toks.length) throw new FormulaError(`unexpected "${toks[i].text}"`)
  return tree
}

// ---------------------------------------------------------------------------
// Writing references back

export function refText(ref: Ref, withSheet = true): string {
  const sh = withSheet && ref.sheet !== undefined ? `${sheetRef(ref.sheet)}!` : ''
  const d = (b: boolean) => (b ? '$' : '')
  if (ref.kind === 'cols') return `${sh}${d(ref.abs.c1)}${colName(ref.c1)}:${d(ref.abs.c2)}${colName(ref.c2)}`
  if (ref.kind === 'rows') return `${sh}${d(ref.abs.r1)}${ref.r1 + 1}:${d(ref.abs.r2)}${ref.r2 + 1}`
  const a = `${d(ref.abs.c1)}${colName(ref.c1)}${d(ref.abs.r1)}${ref.r1 + 1}`
  if (!ref.area) return sh + a
  return `${sh}${a}:${d(ref.abs.c2)}${colName(ref.c2)}${d(ref.abs.r2)}${ref.r2 + 1}`
}

/**
 * Rewrites every reference in a formula. `fn` returns the new reference, or null when it
 * no longer points anywhere (it becomes #REF!). Text, spacing and everything else stay.
 */
export function mapRefs(f: string, fn: (ref: Ref) => Ref | null): string {
  let toks: Token[]
  try {
    toks = tokenize(f)
  } catch {
    return f
  }
  return toks
    .map((t) => {
      if (t.type !== 'ref' || !t.ref) return t.text
      const next = fn(t.ref)
      if (!next) return t.ref.sheet !== undefined ? `${sheetRef(t.ref.sheet)}!#REF!` : '#REF!'
      if (next === t.ref) return t.text
      return refText(next, next.sheet !== undefined)
    })
    .join('')
}

/** The formula copied `dr` rows down and `dc` columns across: relative parts move, $ parts stay. */
export function shiftFormula(f: string, dr: number, dc: number): string {
  if (!dr && !dc) return f
  return mapRefs(f, (ref) => {
    const r1 = ref.abs.r1 || ref.kind === 'cols' ? ref.r1 : ref.r1 + dr
    const r2 = ref.abs.r2 || ref.kind === 'cols' ? ref.r2 : ref.r2 + dr
    const c1 = ref.abs.c1 || ref.kind === 'rows' ? ref.c1 : ref.c1 + dc
    const c2 = ref.abs.c2 || ref.kind === 'rows' ? ref.c2 : ref.c2 + dc
    if (r1 < 0 || r2 < 0 || c1 < 0 || c2 < 0 || r1 >= MAX_ROWS || r2 >= MAX_ROWS || c1 >= MAX_COLS || c2 >= MAX_COLS) return null
    return { ...ref, r1, r2, c1, c2 }
  })
}

/**
 * Rows (axis 'r') or columns (axis 'c') inserted (count > 0) or deleted (count < 0) at
 * `at` on sheet `sheet`, seen from a formula on sheet `home`. References into deleted
 * cells become #REF!; ranges that span the change grow or shrink.
 */
export function adjustFormula(f: string, home: string, sheet: string, axis: 'r' | 'c', at: number, count: number): string {
  const same = (a: string | undefined) => (a ?? home).toLowerCase() === sheet.toLowerCase()
  return mapRefs(f, (ref) => (same(ref.sheet) ? adjustRef(ref, axis, at, count) : ref))
}

export function adjustRef<T extends { r1: number; c1: number; r2: number; c2: number; kind?: Ref['kind'] }>(ref: T, axis: 'r' | 'c', at: number, count: number): T | null {
  if ((axis === 'r' && ref.kind === 'cols') || (axis === 'c' && ref.kind === 'rows')) return ref
  const k1 = axis === 'r' ? 'r1' : 'c1'
  const k2 = axis === 'r' ? 'r2' : 'c2'
  let a = ref[k1]
  let b = ref[k2]
  if (count > 0) {
    if (a >= at) a += count
    if (b >= at) b += count
  } else {
    const n = -count
    const end = at + n - 1
    if (a >= at && b <= end) return null
    const move = (x: number, isEnd: boolean) => (x < at ? x : x > end ? x - n : isEnd ? at - 1 : at)
    a = move(a, false)
    b = move(b, true)
    if (b < a) return null
  }
  if (a === ref[k1] && b === ref[k2]) return ref
  return { ...ref, [k1]: a, [k2]: b }
}

/** Sheet references renamed from `from` to `to`. */
export function renameSheetIn(f: string, from: string, to: string): string {
  return mapRefs(f, (ref) => (ref.sheet !== undefined && ref.sheet.toLowerCase() === from.toLowerCase() ? { ...ref, sheet: to } : ref))
}

/** References to a deleted sheet become #REF!. */
export function dropSheetIn(f: string, name: string): string {
  return mapRefs(f, (ref) => (ref.sheet !== undefined && ref.sheet.toLowerCase() === name.toLowerCase() ? null : ref))
}

/** Every reference in a formula, for the check and for drawing what a formula reads. */
export function refsIn(f: string): Ref[] {
  try {
    return tokenize(f).flatMap((t) => (t.type === 'ref' && t.ref ? [t.ref] : []))
  } catch {
    return []
  }
}
