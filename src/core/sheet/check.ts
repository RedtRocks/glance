/**
 * The spreadsheet check: what to fix before anyone relies on the numbers. Formula errors
 * (#REF!, #DIV/0!, …), references to sheets that don't exist, text typed where a column
 * holds numbers, values a cell's validation doesn't allow, and [placeholders] left in.
 * Messages are English; AI apps read them, the grid shows them through t().
 */
import { cellName, parseCell, parseRange, cellsOf } from './address'
import { refsIn } from './formula'
import { dataBounds, findSheet, isError, type Sheet, type Workbook } from './model'
import { knownFunction } from './functions'
import { validationProblem } from './validate'
import { tokenize } from './formula'

export interface SheetFinding {
  sheet: string
  cell: string
  kind: 'error' | 'brokenRef' | 'unknownFunction' | 'textInNumbers' | 'invalid' | 'placeholder'
  message: string
}

const MAX = 200

export function checkWorkbook(wb: Workbook, extraFunctions: (name: string) => boolean = () => false): SheetFinding[] {
  const out: SheetFinding[] = []
  for (const s of wb.sheets) {
    if (s.hidden) continue
    checkSheet(wb, s, out, extraFunctions)
    if (out.length >= MAX) break
  }
  return out.slice(0, MAX)
}

function checkSheet(wb: Workbook, s: Sheet, out: SheetFinding[], extra: (name: string) => boolean): void {
  const add = (cell: string, kind: SheetFinding['kind'], message: string) => out.push({ sheet: s.name, cell, kind, message })
  for (const [k, c] of Object.entries(s.cells)) {
    if (c.f) {
      if (/#REF!/i.test(c.f)) {
        add(k, 'brokenRef', `=${c.f} points at cells that were deleted; write the reference again`)
        continue
      }
      const missing = refsIn(c.f).find((r) => r.sheet !== undefined && !findSheet(wb, r.sheet))
      if (missing) {
        add(k, 'brokenRef', `=${c.f} reads sheet "${missing.sheet}", which doesn't exist`)
        continue
      }
      let unknown: string | undefined
      try {
        unknown = tokenize(c.f).filter((t) => t.type === 'func').map((t) => t.text.replace(/\s*\($/, '').toUpperCase().replace(/^_XLFN\./, '')).find((n) => !knownFunction(n) && !extra(n))
      } catch {
        add(k, 'error', `=${c.f} can't be read; check its quotes and brackets`)
        continue
      }
      if (unknown) {
        add(k, 'unknownFunction', `=${c.f} uses ${unknown}, which Glance doesn't know; check the spelling`)
        continue
      }
      if (isError(c.v)) add(k, 'error', `=${c.f} gives ${c.v.error}${hint(c.v.error)}`)
    } else if (typeof c.v === 'string' && /\[[^\]\n]{1,40}\]/.test(c.v)) add(k, 'placeholder', `"${c.v}" still has a placeholder to fill in`)
  }
  // Validation: entries the rule doesn't allow.
  for (const v of s.validations) {
    for (const part of v.ref.split(/\s+/)) {
      const r = parseRange(part)
      if (!r) continue
      const b = dataBounds(s)
      for (const a of cellsOf(r, Math.min(r.r2, b.rows), Math.min(r.c2, b.cols))) {
        const k = cellName(a.r, a.c)
        const c = s.cells[k]
        if (!c || c.f) continue
        const why = validationProblem(v, c.v ?? null, (ref) => rangeValues(wb, s, ref))
        if (why) add(k, 'invalid', `${JSON.stringify(c.v)} isn't allowed here: ${why}`)
      }
    }
  }
  // Text in a column of numbers (a column with at least 4 numbers and fewer texts below its header).
  const cols = new Map<number, { nums: number; texts: string[] }>()
  for (const [k, c] of Object.entries(s.cells)) {
    const a = parseCell(k)!
    const e = cols.get(a.c) ?? { nums: 0, texts: [] }
    if (typeof c.v === 'number') e.nums++
    else if (typeof c.v === 'string' && /^\s*[-+£$€]?\s*\d[\d,]*(\.\d+)?\s*%?\s*$/.test(c.v) && !c.f) e.texts.push(k)
    cols.set(a.c, e)
  }
  for (const e of cols.values()) if (e.nums >= 4) for (const k of e.texts) add(k, 'textInNumbers', `${JSON.stringify(s.cells[k].v)} is text that looks like a number, so totals skip it; set it as a number`)
}

function hint(code: string): string {
  switch (code) {
    case '#DIV/0!': return '; it divides by an empty or zero cell (wrap it in IFERROR or check the divisor)'
    case '#VALUE!': return '; it does sums on text'
    case '#N/A': return '; a lookup found nothing'
    case '#NAME?': return '; a function or name is misspelt'
    case '#CIRC!': return '; it reads its own result (a circular reference)'
    case '#NUM!': return '; the number is out of range'
    default: return ''
  }
}

function rangeValues(wb: Workbook, s: Sheet, ref: string): string[] {
  const m = /^(?:'?(.+?)'?!)?(.+)$/.exec(ref)!
  const src = m[1] ? findSheet(wb, m[1]) : s
  const r = parseRange(m[2])
  if (!src || !r) return []
  const out: string[] = []
  for (const a of cellsOf(r, Math.min(r.r2, r.r1 + 2000), r.c2)) {
    const v = src.cells[cellName(a.r, a.c)]?.v
    if (v !== null && v !== undefined && !isError(v)) out.push(String(v))
  }
  return out
}
