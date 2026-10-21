/**
 * Every change to a workbook is an operation here, shared by the grid, the menus and AI
 * apps (glance_sheet_edit). A list of operations applies as one step: if any is invalid,
 * nothing changes and the error says which one and why.
 */
import { cellName, cellsOf, colIndex, colName, contains, inRange, MAX_COLS, MAX_ROWS, overlaps, parseCell, parseRange, rangeName, splitSheet, type Range } from './address'
import { adjustFormula, adjustRef, dropSheetIn, mapRefs, renameSheetIn, shiftFormula, tokenize } from './formula'
import { compare } from './evaluate'
import { parseEntry } from './format'
import { emptySheet, findSheet, isError, type Anchor, type Cell, type CfRule, type Chart, type ChartType, type Sheet, type Style, type Validation, type Value, type Workbook, type BorderStyle, type IconSetName, type CfOperator } from './model'
import { recalc, type RecalcOptions } from './recalc'
import { validationProblem } from './validate'

export class SheetError extends Error {}

/** Style in the flat shape people and AI apps write. */
export interface StyleInput {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  font?: string
  size?: number
  color?: string
  fill?: string | null
  align?: 'left' | 'center' | 'right' | null
  valign?: 'top' | 'middle' | 'bottom'
  wrap?: boolean
  indent?: number
  numFmt?: string | null
  /** Borders: all cells' edges, just the outline, one side, or none. */
  border?: 'all' | 'outline' | 'top' | 'bottom' | 'left' | 'right' | 'none'
  borderStyle?: BorderStyle
  borderColor?: string
}

export interface ChartInput {
  type: ChartType
  title?: string
  /** Where it sits, like "G18:J30". */
  range: string
  categories?: string
  series: { name?: string; values: string; color?: string }[]
  colors?: string[]
  legend?: 'right' | 'bottom' | 'none'
  stacked?: boolean
  labels?: boolean
  target?: { value: number; label?: string; color?: string }
  centre?: string
}

type On = { sheet?: string }
export type SheetOp =
  | (On & { op: 'set'; cell?: string; range?: string; value?: unknown; values?: unknown[][]; formula?: string; style?: StyleInput })
  | (On & { op: 'clear'; range: string; what?: 'all' | 'contents' | 'formats' })
  | (On & { op: 'fill'; from: string; to: string })
  | (On & { op: 'insertRows' | 'deleteRows'; at: number; count?: number })
  | (On & { op: 'insertCols' | 'deleteCols'; at: string; count?: number })
  | { op: 'addSheet'; name: string; after?: string; copyOf?: string }
  | { op: 'deleteSheet'; name: string }
  | { op: 'renameSheet'; from?: string; sheet?: string; to: string }
  | { op: 'moveSheet'; name: string; index: number }
  | (On & { op: 'format'; range: string; style: StyleInput })
  | (On & { op: 'merge' | 'unmerge'; range: string })
  | (On & { op: 'colWidth'; cols: string; width: number })
  | (On & { op: 'rowHeight'; rows: string; height: number })
  | (On & { op: 'hide' | 'show'; cols?: string; rows?: string })
  | (On & { op: 'addCf'; range: string; rule: CfRule })
  | (On & { op: 'clearCf'; range: string })
  | (On & { op: 'addValidation'; range: string; rule: Omit<Validation, 'ref'> })
  | (On & { op: 'clearValidation'; range: string })
  | (On & { op: 'addChart'; chart: ChartInput; id?: string })
  | (On & { op: 'updateChart'; id: string; chart: Partial<ChartInput> })
  | (On & { op: 'deleteChart'; id: string })
  | (On & { op: 'addImage'; range: string; media: string; alt?: string; id?: string })
  | (On & { op: 'deleteImage'; id: string })
  | (On & { op: 'sort'; range: string; by: { col: string; desc?: boolean }[]; header?: boolean })
  | (On & { op: 'filter'; range?: string | null; col?: string; values?: string[] | null })
  | (On & { op: 'freeze'; rows?: number; cols?: number })
  | (On & { op: 'tabColor'; color: string | null })
  | { op: 'activate'; sheet: string }

export interface ApplyResult {
  wb: Workbook
  /** Ids of charts and pictures added. */
  added: string[]
  /** The sheet the last operation worked on, for showing it. */
  sheet: string
}

export interface ApplyOptions extends RecalcOptions {
  /** Media keys the workbook has, so addImage can check them. */
  media?: Set<string>
  /** Typed dates are day first (03/10 is 3 October). Default true. */
  dayFirst?: boolean
}

const OPS = new Set(['set', 'clear', 'fill', 'insertRows', 'deleteRows', 'insertCols', 'deleteCols', 'addSheet', 'deleteSheet', 'renameSheet', 'moveSheet', 'format', 'merge', 'unmerge', 'colWidth', 'rowHeight', 'hide', 'show', 'addCf', 'clearCf', 'addValidation', 'clearValidation', 'addChart', 'updateChart', 'deleteChart', 'addImage', 'deleteImage', 'sort', 'filter', 'freeze', 'tabColor', 'activate'])
const BAD_SHEET_NAME = /[\\/?*[\]:]/
const COLOR = /^#[0-9a-fA-F]{6}$/

export function applyOps(wb: Workbook, ops: SheetOp[], opts: ApplyOptions = {}): ApplyResult {
  const d = new Draft(wb, opts)
  ops.forEach((op, i) => {
    try {
      d.apply(op)
    } catch (e) {
      if (e instanceof SheetError) throw new SheetError(`Operation ${i + 1} (${(op as { op?: string })?.op ?? '?'}): ${e.message}`)
      throw e
    }
  })
  const out = withFilters(recalc(d.result(), opts))
  return { wb: out, added: d.added, sheet: d.lastSheet }
}

/** Works out which rows each sheet's filter hides. */
export function withFilters(wb: Workbook): Workbook {
  let changed = false
  const sheets = wb.sheets.map((s) => {
    const hidden = filterHidden(s)
    const before = s.filterHidden
    if (!hidden.size && !before?.size) return s
    if (before && before.size === hidden.size && [...hidden].every((r) => before.has(r))) return s
    changed = true
    return { ...s, filterHidden: hidden }
  })
  return changed ? { ...wb, sheets } : wb
}

function filterHidden(s: Sheet): Set<number> {
  const out = new Set<number>()
  const f = s.filter
  const r = f && parseRange(f.ref)
  if (!f?.shown || !r) return out
  for (let row = r.r1 + 1; row <= r.r2; row++) {
    for (const [col, keep] of Object.entries(f.shown)) {
      const v = s.cells[cellName(row, Number(col))]?.v
      const text = v === null || v === undefined ? '' : typeof v === 'object' ? v.error : String(v)
      if (!keep.includes(text)) {
        out.add(row)
        break
      }
    }
  }
  return out
}

class Draft {
  private sheets: Sheet[]
  private active: number | undefined
  private readonly cloned = new Set<Sheet>()
  readonly added: string[] = []
  lastSheet: string

  constructor(
    wb: Workbook,
    readonly opts: ApplyOptions
  ) {
    this.sheets = [...wb.sheets]
    this.active = wb.active
    this.lastSheet = wb.sheets[wb.active ?? 0]?.name ?? wb.sheets[0]?.name ?? ''
  }

  result(): Workbook {
    return { sheets: this.sheets, ...(this.active !== undefined ? { active: this.active } : {}) }
  }

  /** The sheet an op names (default: the active one), copied once so it can be changed. */
  private sheet(name: string | undefined): Sheet {
    const i = name === undefined || name === '' ? (this.active ?? 0) : this.sheets.findIndex((s) => s.name.toLowerCase() === String(name).toLowerCase())
    if (i < 0 || !this.sheets[i]) throw new SheetError(`no sheet "${name}"; sheets are ${this.sheets.map((s) => s.name).join(', ')}`)
    return this.mutable(i)
  }

  private mutable(i: number): Sheet {
    let s = this.sheets[i]
    if (!this.cloned.has(s)) {
      s = { ...structuredClone({ ...s, filterHidden: undefined }), filterHidden: s.filterHidden }
      if (s.filterHidden === undefined) delete s.filterHidden
      this.sheets[i] = s
      this.cloned.add(s)
    }
    this.lastSheet = s.name
    return s
  }

  private allMutable(): Sheet[] {
    return this.sheets.map((_, i) => this.mutable(i))
  }

  apply(op: SheetOp): void {
    if (!op || typeof op !== 'object' || !OPS.has((op as { op: string }).op)) throw new SheetError(`unknown op; use one of ${[...OPS].join(', ')}`)
    switch (op.op) {
      case 'set': return this.set(op)
      case 'clear': return this.clear(op)
      case 'fill': return this.fill(op)
      case 'insertRows':
      case 'deleteRows': {
        const at = Number(op.at)
        const n = Math.trunc(Number(op.count ?? 1))
        if (!Number.isInteger(at) || at < 1 || at > MAX_ROWS) throw new SheetError('at must be a row number from 1')
        if (!(n >= 1 && n <= 10_000)) throw new SheetError('count must be from 1 to 10000')
        return this.shift(this.sheet(op.sheet).name, 'r', at - 1, op.op === 'insertRows' ? n : -n)
      }
      case 'insertCols':
      case 'deleteCols': {
        const at = typeof op.at === 'number' ? Number(op.at) - 1 : /^[A-Za-z]{1,3}$/.test(String(op.at)) ? colIndex(String(op.at)) : -1
        const n = Math.trunc(Number(op.count ?? 1))
        if (at < 0 || at >= MAX_COLS) throw new SheetError('at must be a column letter like "C"')
        if (!(n >= 1 && n <= 1000)) throw new SheetError('count must be from 1 to 1000')
        return this.shift(this.sheet(op.sheet).name, 'c', at, op.op === 'insertCols' ? n : -n)
      }
      case 'addSheet': return this.addSheet(op)
      case 'deleteSheet': {
        if (this.sheets.length <= 1) throw new SheetError('a workbook needs at least one sheet')
        const s = this.sheet(op.name)
        this.sheets = this.sheets.filter((x) => x !== s)
        for (const o of this.allMutable()) this.mapFormulas(o, (f) => dropSheetIn(f, s.name))
        this.active = Math.min(this.active ?? 0, this.sheets.length - 1)
        this.lastSheet = this.sheets[this.active].name
        return
      }
      case 'renameSheet': {
        const s = this.sheet(op.from ?? op.sheet)
        const to = String(op.to ?? '').trim()
        this.checkName(to, s)
        const from = s.name
        s.name = to
        for (const o of this.allMutable()) {
          this.mapFormulas(o, (f) => renameSheetIn(f, from, to))
          for (const ch of o.charts) {
            ch.categories &&= renameRef(ch.categories, from, to)
            for (const se of ch.series) se.values = renameRef(se.values, from, to)
          }
          for (const v of o.validations) v.source &&= renameRef(v.source, from, to)
        }
        this.lastSheet = to
        return
      }
      case 'moveSheet': {
        const s = this.sheet(op.name)
        const at = Math.max(0, Math.min(this.sheets.length - 1, Math.trunc(Number(op.index) - 1)))
        const was = this.sheets[this.active ?? 0]
        this.sheets = this.sheets.filter((x) => x !== s)
        this.sheets.splice(at, 0, s)
        this.active = this.sheets.indexOf(was)
        return
      }
      case 'format': {
        const s = this.sheet(op.sheet)
        const r = this.range(op.range)
        this.format(s, r, op.style)
        return
      }
      case 'merge': {
        const s = this.sheet(op.sheet)
        const r = this.range(op.range)
        if (r.r1 === r.r2 && r.c1 === r.c2) throw new SheetError('merge needs more than one cell')
        if (r.r2 - r.r1 > 500 || r.c2 - r.c1 > 200) throw new SheetError('that range is too big to merge')
        s.merges = s.merges.filter((m) => !overlaps(parseRange(m)!, r))
        // Like Excel, the merged cell keeps the top-left value.
        for (const a of cellsOf(r)) if (a.r !== r.r1 || a.c !== r.c1) {
          const k = cellName(a.r, a.c)
          if (s.cells[k]) s.cells[k] = { ...(s.cells[k].s ? { s: s.cells[k].s } : {}) }
        }
        s.merges.push(rangeName(r))
        return
      }
      case 'unmerge': {
        const s = this.sheet(op.sheet)
        const r = this.range(op.range)
        s.merges = s.merges.filter((m) => !overlaps(parseRange(m)!, r))
        return
      }
      case 'colWidth':
      case 'rowHeight': {
        const s = this.sheet(op.sheet)
        const isCol = op.op === 'colWidth'
        const spec = String(isCol ? (op as { cols: string }).cols : (op as { rows: string }).rows)
        const px = Number(isCol ? (op as { width: number }).width : (op as { height: number }).height)
        if (!(px >= 0 && px <= 2000)) throw new SheetError(`${isCol ? 'width' : 'height'} must be from 0 to 2000 pixels`)
        const r = parseRange(isCol && /^[A-Za-z]+$/.test(spec) ? `${spec}:${spec}` : !isCol && /^\d+$/.test(spec) ? `${spec}:${spec}` : spec)
        if (!r) throw new SheetError(isCol ? 'cols must be like "B" or "B:D"' : 'rows must be like "3" or "3:5"')
        const [a, b] = isCol ? [r.c1, r.c2] : [r.r1, r.r2]
        if (b - a > 5000) throw new SheetError('too many at once')
        const map = isCol ? s.cols : s.rows
        for (let i = a; i <= b; i++) map[i] = { ...map[i], size: Math.round(px) }
        return
      }
      case 'hide':
      case 'show': {
        const s = this.sheet(op.sheet)
        const set = (map: Sheet['cols'], a: number, b: number) => {
          for (let i = a; i <= b; i++) {
            const { hidden: _h, ...rest } = map[i] ?? {}
            void _h
            map[i] = op.op === 'hide' ? { ...rest, hidden: true } : rest
          }
        }
        if (op.cols) {
          const r = parseRange(/^[A-Za-z]+$/.test(op.cols) ? `${op.cols}:${op.cols}` : op.cols)
          if (!r || r.c2 - r.c1 > 5000) throw new SheetError('cols must be like "B" or "B:D"')
          set(s.cols, r.c1, r.c2)
        }
        if (op.rows) {
          const r = parseRange(/^\d+$/.test(String(op.rows)) ? `${op.rows}:${op.rows}` : String(op.rows))
          if (!r || r.r2 - r.r1 > 5000) throw new SheetError('rows must be like "3" or "3:5"')
          set(s.rows, r.r1, r.r2)
        }
        if (!op.cols && !op.rows) throw new SheetError('say which cols or rows')
        return
      }
      case 'addCf': {
        const s = this.sheet(op.sheet)
        const r = this.range(op.range)
        s.cf.push({ ref: rangeName(r), rules: [checkRule(op.rule)] })
        return
      }
      case 'clearCf': {
        const s = this.sheet(op.sheet)
        const r = this.range(op.range)
        s.cf = s.cf.filter((c) => !overlaps(parseRange(c.ref.split(' ')[0])!, r))
        return
      }
      case 'addValidation': {
        const s = this.sheet(op.sheet)
        const r = this.range(op.range)
        const rule = checkValidation(op.rule, (name) => !!this.sheets.find((x) => x.name.toLowerCase() === name.toLowerCase()))
        s.validations = s.validations.filter((v) => !contains(r, parseRange(v.ref.split(' ')[0])!))
        s.validations.push({ ...rule, ref: rangeName(r) })
        if (rule.type === 'checkbox') for (const a of cellsOf(r)) {
          const k = cellName(a.r, a.c)
          if (s.cells[k]?.v === undefined || s.cells[k]?.v === null) s.cells[k] = { ...s.cells[k], v: false }
        }
        return
      }
      case 'clearValidation': {
        const s = this.sheet(op.sheet)
        const r = this.range(op.range)
        s.validations = s.validations.filter((v) => !overlaps(parseRange(v.ref.split(' ')[0])!, r))
        return
      }
      case 'addChart': {
        const s = this.sheet(op.sheet)
        const id = op.id && !this.allIds().has(op.id) ? op.id : this.newId('chart')
        s.charts.push(this.chart(id, op.chart, s))
        this.added.push(id)
        return
      }
      case 'updateChart': {
        const s = this.sheet(op.sheet)
        const i = s.charts.findIndex((c) => c.id === op.id)
        if (i < 0) throw new SheetError(`no chart ${op.id} on ${s.name}; charts are ${s.charts.map((c) => c.id).join(', ') || 'none'}`)
        const old = s.charts[i]
        const base: ChartInput = { type: old.type, title: old.title, range: anchorRange(old.anchor), categories: old.categories, series: old.series, colors: old.colors, legend: old.legend, stacked: old.stacked, labels: old.labels, target: old.target, centre: old.centre }
        const next = this.chart(old.id, { ...base, ...op.chart }, s)
        s.charts[i] = { ...old, ...next, anchor: op.chart.range ? next.anchor : old.anchor }
        return
      }
      case 'deleteChart': {
        const s = this.sheet(op.sheet)
        if (!s.charts.some((c) => c.id === op.id)) throw new SheetError(`no chart ${op.id} on ${s.name}`)
        s.charts = s.charts.filter((c) => c.id !== op.id)
        return
      }
      case 'addImage': {
        const s = this.sheet(op.sheet)
        const r = this.range(op.range)
        if (this.opts.media && !this.opts.media.has(op.media)) throw new SheetError(`no picture ${op.media} in this workbook`)
        const id = op.id && !this.allIds().has(op.id) ? op.id : this.newId('picture')
        s.images.push({ id, media: op.media, anchor: { from: { r: r.r1, c: r.c1 }, to: { r: r.r2 + 1, c: r.c2 + 1 } }, ...(op.alt ? { alt: op.alt } : {}) })
        this.added.push(id)
        return
      }
      case 'deleteImage': {
        const s = this.sheet(op.sheet)
        if (!s.images.some((c) => c.id === op.id)) throw new SheetError(`no picture ${op.id} on ${s.name}`)
        s.images = s.images.filter((c) => c.id !== op.id)
        return
      }
      case 'sort': return this.sort(op)
      case 'filter': {
        const s = this.sheet(op.sheet)
        if (op.range === null) {
          delete s.filter
          return
        }
        if (op.range !== undefined) {
          const r = this.range(op.range)
          if (r.r2 === r.r1) throw new SheetError('a filter needs a header row and rows under it')
          s.filter = { ref: rangeName(r) }
        }
        if (op.col !== undefined) {
          if (!s.filter) throw new SheetError('add a filter with range first')
          const r = parseRange(s.filter.ref)!
          const c = colIndex(String(op.col))
          if (!/^[A-Za-z]{1,3}$/.test(String(op.col)) || c < r.c1 || c > r.c2) throw new SheetError(`col must be a column letter inside ${s.filter.ref}`)
          const shown = { ...(s.filter.shown ?? {}) }
          if (op.values === null || op.values === undefined) delete shown[c]
          else if (!Array.isArray(op.values)) throw new SheetError('values must be the list of values to show')
          else shown[c] = op.values.map(String)
          s.filter = { ...s.filter, shown }
          if (!Object.keys(shown).length) s.filter = { ref: s.filter.ref }
        }
        return
      }
      case 'freeze': {
        const s = this.sheet(op.sheet)
        const rows = Math.trunc(Number(op.rows ?? 0))
        const cols = Math.trunc(Number(op.cols ?? 0))
        if (!(rows >= 0 && rows <= 200 && cols >= 0 && cols <= 50)) throw new SheetError('freeze up to 200 rows and 50 columns')
        if (rows || cols) s.frozen = { rows, cols }
        else delete s.frozen
        return
      }
      case 'tabColor': {
        const s = this.sheet(op.sheet)
        if (op.color === null) delete s.tabColor
        else if (!COLOR.test(String(op.color))) throw new SheetError('color must be like #2f5d50')
        else s.tabColor = op.color.toLowerCase()
        return
      }
      case 'activate': {
        const i = this.sheets.findIndex((s) => s.name.toLowerCase() === String(op.sheet).toLowerCase())
        if (i < 0) throw new SheetError(`no sheet "${op.sheet}"`)
        this.active = i
        this.lastSheet = this.sheets[i].name
        return
      }
    }
  }

  private range(ref: unknown): Range {
    const text = String(ref ?? '')
    const r = parseRange(splitSheet(text).ref)
    if (!r) throw new SheetError(`"${text}" isn't a range like B2 or B2:D9`)
    return r
  }

  private checkName(name: string, self?: Sheet): void {
    if (!name || name.length > 31 || BAD_SHEET_NAME.test(name) || /^'|'$/.test(name)) throw new SheetError('a sheet name must be 1 to 31 characters, without \\ / ? * [ ] : or a quote at either end')
    if (name.toLowerCase() === 'history') throw new SheetError('Excel keeps the name History for itself')
    const clash = this.sheets.find((s) => s !== self && s.name.toLowerCase() === name.toLowerCase())
    if (clash) throw new SheetError(`there is already a sheet called ${clash.name}`)
  }

  private allIds(): Set<string> {
    return new Set(this.sheets.flatMap((s) => [...s.charts.map((c) => c.id), ...s.images.map((c) => c.id)]))
  }

  private newId(kind: string): string {
    const ids = this.allIds()
    let n = 1
    while (ids.has(`${kind}${n}`)) n++
    return `${kind}${n}`
  }

  private mapFormulas(s: Sheet, fn: (f: string) => string): void {
    for (const [k, c] of Object.entries(s.cells)) if (c.f) {
      const f = fn(c.f)
      if (f !== c.f) s.cells[k] = { ...c, f }
    }
    for (const cf of s.cf) for (const rule of cf.rules) if (rule.type === 'expression') rule.formula = fn(rule.formula)
  }

  // -------------------------------------------------------------------------

  private set(op: Extract<SheetOp, { op: 'set' }>): void {
    const s = this.sheet(op.sheet)
    const target = op.cell ?? op.range
    if (!target) throw new SheetError('say which cell or range')
    const r = this.range(target)
    if ((r.r2 - r.r1 + 1) * (r.c2 - r.c1 + 1) > 200_000) throw new SheetError('that range is too big; set at most 200000 cells at once')
    const put = (row: number, col: number, raw: unknown) => {
      const k = cellName(row, col)
      const old = s.cells[k]
      const next = this.cellFrom(raw, old)
      if (!next.f) {
        const v = s.validations.find((x) => inRange(parseRange(x.ref.split(' ')[0])!, row, col))
        const problem = v && validationProblem(v, next.v ?? null, (ref) => this.listValues(s, ref))
        if (problem) throw new SheetError(`${k}: ${problem}`)
      }
      if (next.v === undefined && !next.f && !next.s && !next.rich && !next.label) delete s.cells[k]
      else s.cells[k] = next
    }
    if (op.formula !== undefined) {
      // One formula, written for the top-left cell, filled across the range.
      const f = String(op.formula).replace(/^=/, '')
      this.checkFormula(f)
      for (const a of cellsOf(r)) put(a.r, a.c, '=' + shiftFormula(f, a.r - r.r1, a.c - r.c1))
    } else if (op.values !== undefined) {
      if (!Array.isArray(op.values) || !op.values.every(Array.isArray)) throw new SheetError('values must be rows of cells, like [["Name", "Total"], ["Ade", 12]]')
      const rows = op.values.length
      const cols = Math.max(0, ...op.values.map((v) => v.length))
      if (op.range && (rows !== r.r2 - r.r1 + 1 || cols > r.c2 - r.c1 + 1)) throw new SheetError(`values has ${rows} rows of up to ${cols} cells but ${rangeName(r)} is ${r.r2 - r.r1 + 1} by ${r.c2 - r.c1 + 1}; give just the top-left cell to fit the values`)
      for (const [i, row] of op.values.entries()) for (const [j, raw] of row.entries()) if (raw !== undefined) {
        if (r.r1 + i >= MAX_ROWS || r.c1 + j >= MAX_COLS) throw new SheetError('the values run off the sheet')
        if (typeof raw === 'string' && raw.startsWith('=')) this.checkFormula(raw.slice(1))
        put(r.r1 + i, r.c1 + j, raw)
      }
    } else if ('value' in op) {
      if (typeof op.value === 'string' && op.value.startsWith('=')) this.checkFormula(op.value.slice(1))
      for (const a of cellsOf(r)) put(a.r, a.c, op.value)
    } else if (!op.style) throw new SheetError('give value, values or formula')
    if (op.style) this.format(s, op.values && !op.range ? { r1: r.r1, c1: r.c1, r2: r.r1 + op.values.length - 1, c2: r.c1 + Math.max(1, ...op.values.map((v) => v.length)) - 1 } : r, op.style)
  }

  private checkFormula(f: string): void {
    try {
      tokenize(f)
    } catch (e) {
      throw new SheetError(`=${f}: ${(e as Error).message}`)
    }
    if (!f.trim()) throw new SheetError('the formula is empty')
    let depth = 0
    for (const ch of f.replace(/"[^"]*"/g, '')) {
      if (ch === '(') depth++
      if (ch === ')') depth--
      if (depth < 0) break
    }
    if (depth !== 0) throw new SheetError(`=${f}: the brackets don't match`)
  }

  /** A typed or AI-given value as a cell, keeping the old cell's style. */
  private cellFrom(raw: unknown, old: Cell | undefined): Cell {
    const keep: Cell = { ...(old?.s ? { s: old.s } : {}), ...(old?.label ? { label: old.label } : {}) }
    if (raw === null || raw === undefined || raw === '') return keep
    if (typeof raw === 'string' && raw.startsWith('=') && raw.length > 1) return { ...keep, f: raw.slice(1) }
    if (typeof raw === 'number') {
      if (!isFinite(raw)) throw new SheetError('numbers must be finite')
      return { ...keep, v: raw }
    }
    if (typeof raw === 'boolean') return { ...keep, v: raw }
    if (typeof raw === 'string') {
      // Text that starts with an apostrophe stays text, as in Excel.
      if (raw.startsWith("'")) return { ...keep, v: raw.slice(1) }
      const p = parseEntry(raw, { dayFirst: this.opts.dayFirst ?? true })
      const fmt = p.numFmt && !old?.s?.numFmt ? p.numFmt : undefined
      return { ...keep, v: p.value, ...(fmt ? { s: { ...keep.s, numFmt: fmt } } : {}) }
    }
    throw new SheetError('a cell takes text, a number, true/false, null or a formula starting with =')
  }

  private listValues(s: Sheet, ref: string): string[] {
    const { sheet, ref: inner } = splitSheet(ref.replace(/^=/, ''))
    const src = sheet ? this.sheets.find((x) => x.name.toLowerCase() === sheet.toLowerCase()) : s
    const r = parseRange(inner)
    if (!src || !r) return []
    const out: string[] = []
    for (const a of cellsOf(r, Math.min(r.r2, r.r1 + 2000), Math.min(r.c2, r.c1 + 50))) {
      const v = src.cells[cellName(a.r, a.c)]?.v
      if (v !== null && v !== undefined && !isError(v)) out.push(String(v))
    }
    return out
  }

  private clear(op: Extract<SheetOp, { op: 'clear' }>): void {
    const s = this.sheet(op.sheet)
    const r = this.range(op.range)
    const what = op.what ?? 'contents'
    if (!['all', 'contents', 'formats'].includes(what)) throw new SheetError('what must be all, contents or formats')
    for (const [k, c] of Object.entries(s.cells)) {
      const a = parseCell(k)!
      if (!inRange(r, a.r, a.c)) continue
      if (what === 'all') delete s.cells[k]
      else if (what === 'contents') {
        if (c.s) s.cells[k] = { s: c.s, ...(c.label ? { label: c.label } : {}) }
        else delete s.cells[k]
      } else {
        const { s: _s, ...rest } = c
        void _s
        if (rest.v === undefined && !rest.f) delete s.cells[k]
        else s.cells[k] = rest
      }
    }
    if (what === 'all') s.merges = s.merges.filter((m) => !contains(r, parseRange(m)!))
  }

  private fill(op: Extract<SheetOp, { op: 'fill' }>): void {
    const s = this.sheet(op.sheet)
    const src = this.range(op.from)
    const dst = this.range(op.to)
    const h = src.r2 - src.r1 + 1
    const w = src.c2 - src.c1 + 1
    if ((dst.r2 - dst.r1 + 1) * (dst.c2 - dst.c1 + 1) > 200_000) throw new SheetError('that range is too big to fill')
    for (const a of cellsOf(dst)) {
      if (inRange(src, a.r, a.c)) continue
      const sr = src.r1 + ((((a.r - src.r1) % h) + h) % h)
      const sc = src.c1 + ((((a.c - src.c1) % w) + w) % w)
      const from = s.cells[cellName(sr, sc)]
      const k = cellName(a.r, a.c)
      if (!from) {
        delete s.cells[k]
        continue
      }
      s.cells[k] = from.f ? { ...from, f: shiftFormula(from.f, a.r - sr, a.c - sc) } : { ...from }
    }
  }

  private addSheet(op: Extract<SheetOp, { op: 'addSheet' }>): void {
    const name = String(op.name ?? '').trim()
    this.checkName(name)
    if (this.sheets.length >= 250) throw new SheetError('a workbook can have at most 250 sheets here')
    let sheet = emptySheet(name)
    if (op.copyOf !== undefined) {
      const src = this.sheet(op.copyOf)
      const copy = structuredClone({ ...src, filterHidden: undefined })
      delete copy.filterHidden
      const ids = this.allIds()
      for (const c of copy.charts) if (ids.has(c.id)) c.id = this.newId('chart')
      for (const c of copy.images) if (ids.has(c.id)) c.id = this.newId('picture')
      sheet = { ...copy, name }
    }
    let at = this.sheets.length
    if (op.after !== undefined) {
      const i = this.sheets.findIndex((s) => s.name.toLowerCase() === String(op.after).toLowerCase())
      if (i < 0) throw new SheetError(`no sheet "${op.after}"`)
      at = i + 1
    }
    this.sheets.splice(at, 0, sheet)
    this.cloned.add(sheet)
    if (this.active !== undefined && at <= this.active) this.active++
    this.lastSheet = name
  }

  /** Rows or columns inserted (n > 0) or deleted (n < 0) at index `at` on `name`. */
  private shift(name: string, axis: 'r' | 'c', at: number, n: number): void {
    const s = this.sheet(name)
    const del = n < 0 ? -n : 0
    const cells: Sheet['cells'] = {}
    for (const [k, c] of Object.entries(s.cells)) {
      const a = parseCell(k)!
      const x = axis === 'r' ? a.r : a.c
      if (del && x >= at && x < at + del) continue
      const nx = x >= at ? x + n : x
      if (nx >= (axis === 'r' ? MAX_ROWS : MAX_COLS)) continue
      cells[axis === 'r' ? cellName(nx, a.c) : cellName(a.r, nx)] = c
    }
    s.cells = cells
    const sizes = axis === 'r' ? s.rows : s.cols
    const moved: Record<number, (typeof sizes)[number]> = {}
    for (const [k, v] of Object.entries(sizes)) {
      const x = Number(k)
      if (del && x >= at && x < at + del) continue
      moved[x >= at ? x + n : x] = v
    }
    if (axis === 'r') s.rows = moved
    else s.cols = moved
    // Formulas everywhere that point at this sheet.
    for (const o of this.allMutable()) {
      this.mapFormulas(o, (f) => adjustFormula(f, o.name, s.name, axis, at, n))
      for (const ch of o.charts) {
        ch.categories &&= adjustRefText(ch.categories, o.name, s.name, axis, at, n)
        for (const se of ch.series) se.values = adjustRefText(se.values, o.name, s.name, axis, at, n)
      }
      for (const v of o.validations) v.source &&= adjustRefText(v.source, o.name, s.name, axis, at, n)
    }
    const adj = (ref: string): string | null => {
      const r = parseRange(ref)
      if (!r) return null
      const out = adjustRef(r, axis, at, n)
      return out ? rangeName(out) : null
    }
    s.merges = s.merges.map(adj).filter((m): m is string => {
      const r = m ? parseRange(m) : null
      return !!r && (r.r1 !== r.r2 || r.c1 !== r.c2)
    })
    s.cf = s.cf.flatMap((c) => {
      const ref = c.ref.split(' ').map(adj).filter((x): x is string => !!x)
      return ref.length ? [{ ...c, ref: ref.join(' ') }] : []
    })
    s.validations = s.validations.flatMap((v) => {
      const ref = v.ref.split(' ').map(adj).filter((x): x is string => !!x)
      return ref.length ? [{ ...v, ref: ref.join(' ') }] : []
    })
    if (s.filter) {
      const ref = adj(s.filter.ref)
      if (!ref) delete s.filter
      else {
        const shown: Record<number, string[]> = {}
        for (const [c, vals] of Object.entries(s.filter.shown ?? {})) {
          const x = Number(c)
          if (axis === 'c' && del && x >= at && x < at + del) continue
          shown[axis === 'c' && x >= at ? x + n : x] = vals
        }
        s.filter = { ref, ...(Object.keys(shown).length ? { shown } : {}) }
      }
    }
    const moveAnchor = (an: Anchor): Anchor => {
      const mv = (p: Anchor['from']) => {
        const x = axis === 'r' ? p.r : p.c
        const nx = x >= at ? Math.max(at, x + n) : x
        return axis === 'r' ? { ...p, r: nx } : { ...p, c: nx }
      }
      return { from: mv(an.from), to: mv(an.to) }
    }
    for (const im of s.images) im.anchor = moveAnchor(im.anchor)
    for (const ch of s.charts) ch.anchor = moveAnchor(ch.anchor)
    if (s.frozen) {
      const k = axis === 'r' ? 'rows' : 'cols'
      if (s.frozen[k] > at) s.frozen = { ...s.frozen, [k]: Math.max(at, s.frozen[k] + n) }
    }
  }

  private format(s: Sheet, r: Range, input: StyleInput): void {
    if (!input || typeof input !== 'object') throw new SheetError('style must be an object like {"bold": true, "fill": "#fbe2da"}')
    for (const key of ['color', 'fill', 'borderColor'] as const) {
      const v = input[key]
      if (v !== undefined && v !== null && !COLOR.test(String(v))) throw new SheetError(`${key} must be like #2f5d50`)
    }
    if (input.size !== undefined && !(input.size >= 6 && input.size <= 96)) throw new SheetError('size must be from 6 to 96 points')
    if (input.border && !['all', 'outline', 'top', 'bottom', 'left', 'right', 'none'].includes(input.border)) throw new SheetError('border must be all, outline, top, bottom, left, right or none')
    const whole = r.r2 - r.r1 >= MAX_ROWS - 1 || r.c2 - r.c1 >= MAX_COLS - 1
    if (whole) {
      // Whole columns or rows: style the column (or row) itself, like Excel.
      if (r.r2 - r.r1 >= MAX_ROWS - 1 && r.c2 - r.c1 < MAX_COLS - 1) for (let c = r.c1; c <= r.c2; c++) s.cols[c] = { ...s.cols[c], s: styled(s.cols[c]?.s, input, false, false, false, false) }
      else if (r.c2 - r.c1 >= MAX_COLS - 1 && r.r2 - r.r1 < MAX_ROWS - 1) for (let row = r.r1; row <= r.r2; row++) s.rows[row] = { ...s.rows[row], s: styled(s.rows[row]?.s, input, false, false, false, false) }
      const b = { r1: r.r1, c1: r.c1, r2: Math.min(r.r2, r.r1 + 2000), c2: Math.min(r.c2, r.c1 + 200) }
      for (const [k, c] of Object.entries(s.cells)) {
        const a = parseCell(k)!
        if (inRange(r, a.r, a.c) && c.s) s.cells[k] = { ...c, s: styled(c.s, input, a.r === b.r1, a.c === b.c2, a.r === b.r2, a.c === b.c1) }
      }
      return
    }
    if ((r.r2 - r.r1 + 1) * (r.c2 - r.c1 + 1) > 200_000) throw new SheetError('that range is too big to format at once')
    for (const a of cellsOf(r)) {
      const k = cellName(a.r, a.c)
      const c = s.cells[k] ?? {}
      const base = c.s ?? s.rows[a.r]?.s ?? s.cols[a.c]?.s
      const next = styled(base, input, a.r === r.r1, a.c === r.c2, a.r === r.r2, a.c === r.c1)
      s.cells[k] = { ...c, s: next }
      if (!Object.keys(next).length) {
        const { s: _x, ...rest } = s.cells[k]
        void _x
        if (rest.v === undefined && !rest.f) delete s.cells[k]
        else s.cells[k] = rest
      }
    }
  }

  private chart(id: string, input: ChartInput, s: Sheet): Chart {
    if (!input || typeof input !== 'object') throw new SheetError('chart must be an object')
    const types: ChartType[] = ['column', 'bar', 'line', 'pie', 'doughnut', 'area']
    if (!types.includes(input.type)) throw new SheetError(`chart type must be one of ${types.join(', ')}`)
    const r = this.range(input.range)
    if (r.r2 - r.r1 < 3 || r.c2 - r.c1 < 1) throw new SheetError('give the chart at least 4 rows and 2 columns to sit in')
    if (!Array.isArray(input.series) || !input.series.length) throw new SheetError('series must list at least one {values: "D10:D25"}')
    const refOk = (ref: string) => {
      const { sheet, ref: inner } = splitSheet(ref)
      if (sheet && !findSheet({ sheets: this.sheets }, sheet)) return false
      return !!parseRange(inner)
    }
    const qualify = (ref: string) => (splitSheet(ref).sheet ? ref : `${sheetName(s.name)}!${ref}`)
    for (const se of input.series) if (!se || typeof se.values !== 'string' || !refOk(se.values)) throw new SheetError(`series values must be a range like "D10:D25" or "Workouts!D10:D25"`)
    if (input.categories !== undefined && (typeof input.categories !== 'string' || !refOk(input.categories))) throw new SheetError('categories must be a range like "B10:B25"')
    for (const c of [...(input.colors ?? []), ...input.series.map((x) => x.color).filter(Boolean)]) if (!COLOR.test(String(c))) throw new SheetError('colours must be like #2f5d50')
    return {
      id,
      type: input.type,
      ...(input.title ? { title: String(input.title) } : {}),
      anchor: { from: { r: r.r1, c: r.c1 }, to: { r: r.r2 + 1, c: r.c2 + 1 } },
      ...(input.categories ? { categories: qualify(input.categories) } : {}),
      series: input.series.map((x) => ({ values: qualify(x.values), ...(x.name ? { name: String(x.name) } : {}), ...(x.color ? { color: x.color } : {}) })),
      ...(input.colors?.length ? { colors: input.colors } : {}),
      ...(input.legend ? { legend: input.legend } : {}),
      ...(input.stacked ? { stacked: true } : {}),
      ...(input.labels ? { labels: true } : {}),
      ...(input.target ? { target: input.target } : {}),
      ...(input.centre ? { centre: String(input.centre) } : {})
    }
  }

  private sort(op: Extract<SheetOp, { op: 'sort' }>): void {
    const s = this.sheet(op.sheet)
    let r = this.range(op.range)
    if (op.header) r = { ...r, r1: r.r1 + 1 }
    if (r.r2 - r.r1 > 100_000) throw new SheetError('that range is too big to sort')
    if (!Array.isArray(op.by) || !op.by.length) throw new SheetError('by must list columns, like [{"col": "C", "desc": true}]')
    const keys = op.by.map((b) => {
      const c = /^[A-Za-z]{1,3}$/.test(String(b?.col)) ? colIndex(String(b.col)) : -1
      if (c < r.c1 || c > r.c2) throw new SheetError(`sort column ${b?.col} must be inside ${rangeName(r)}`)
      return { c, desc: !!b.desc }
    })
    for (const m of s.merges) {
      const mr = parseRange(m)!
      if (overlaps(mr, r) && !(mr.r1 === mr.r2)) throw new SheetError(`can't sort across the merged cells ${m}`)
    }
    const rows: { row: number; cells: (Cell | undefined)[] }[] = []
    for (let row = r.r1; row <= r.r2; row++) {
      const cells: (Cell | undefined)[] = []
      for (let c = r.c1; c <= r.c2; c++) cells.push(s.cells[cellName(row, c)])
      rows.push({ row, cells })
    }
    const v = (x: (typeof rows)[number], c: number): Value => x.cells[c - r.c1]?.v ?? null
    rows.sort((a, b) => {
      for (const k of keys) {
        const x = v(a, k.c)
        const y = v(b, k.c)
        // Blanks always last, as in Excel.
        if (x === null && y === null) continue
        if (x === null) return 1
        if (y === null) return -1
        const d = compare(isError(x) ? '' : x, isError(y) ? '' : y)
        if (d) return k.desc ? -d : d
      }
      return a.row - b.row
    })
    rows.forEach((x, i) => {
      const to = r.r1 + i
      for (let c = r.c1; c <= r.c2; c++) {
        const cell = x.cells[c - r.c1]
        const k = cellName(to, c)
        if (!cell) delete s.cells[k]
        else s.cells[k] = cell.f ? { ...cell, f: shiftFormula(cell.f, to - x.row, 0) } : cell
      }
    })
  }
}

const sheetName = (n: string) => (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(n) ? n : `'${n.replace(/'/g, "''")}'`)

function renameRef(ref: string, from: string, to: string): string {
  const { sheet, ref: inner } = splitSheet(ref)
  return sheet && sheet.toLowerCase() === from.toLowerCase() ? `${sheetName(to)}!${inner}` : ref
}

function adjustRefText(ref: string, home: string, sheet: string, axis: 'r' | 'c', at: number, n: number): string {
  const out = adjustFormula(ref, home, sheet, axis, at, n)
  return out.includes('#REF!') ? ref : out
}

export function anchorRange(a: Anchor): string {
  return rangeName({ r1: a.from.r, c1: a.from.c, r2: Math.max(a.from.r, a.to.r - (a.to.dy ? 0 : 1)), c2: Math.max(a.from.c, a.to.c - (a.to.dx ? 0 : 1)) })
}

/** The style with the input's changes merged in; border sides depend on where the cell sits in the range. */
function styled(base: Style | undefined, i: StyleInput, top: boolean, right: boolean, bottom: boolean, left: boolean): Style {
  const s: Style = structuredClone(base ?? {})
  const font = { ...s.font }
  if (i.bold !== undefined) font.bold = !!i.bold
  if (i.italic !== undefined) font.italic = !!i.italic
  if (i.underline !== undefined) font.underline = !!i.underline
  if (i.strike !== undefined) font.strike = !!i.strike
  if (i.font !== undefined) font.name = String(i.font)
  if (i.size !== undefined) font.size = Number(i.size)
  if (i.color !== undefined) font.color = i.color.toLowerCase()
  for (const k of Object.keys(font) as (keyof typeof font)[]) if (font[k] === false || font[k] === undefined) delete font[k]
  if (Object.keys(font).length) s.font = font
  else delete s.font
  if (i.fill !== undefined) {
    if (i.fill === null) delete s.fill
    else s.fill = i.fill.toLowerCase()
  }
  const align = { ...s.align }
  if (i.align !== undefined) {
    if (i.align === null) delete align.h
    else align.h = i.align
  }
  if (i.valign !== undefined) align.v = i.valign
  if (i.wrap !== undefined) align.wrap = !!i.wrap
  if (i.indent !== undefined) align.indent = Math.max(0, Math.min(15, Math.trunc(i.indent)))
  if (!align.wrap) delete align.wrap
  if (!align.indent) delete align.indent
  if (Object.keys(align).length) s.align = align
  else delete s.align
  if (i.numFmt !== undefined) {
    if (i.numFmt === null || i.numFmt === 'General') delete s.numFmt
    else s.numFmt = String(i.numFmt)
  }
  if (i.border === 'none') delete s.border
  else if (i.border) {
    const side = { style: i.borderStyle ?? 'thin', ...(i.borderColor ? { color: i.borderColor.toLowerCase() } : {}) } as const
    const edge = { top, right, bottom, left }
    const b = { ...s.border }
    for (const k of ['top', 'right', 'bottom', 'left'] as const) {
      // all: every cell's edges; outline: the range's edge; a side: that edge of the range.
      if (i.border === 'all' || (i.border === 'outline' && edge[k]) || (i.border === k && edge[k])) b[k] = { ...side }
    }
    s.border = b
  }
  return s
}

const ICONS: IconSetName[] = ['3TrafficLights1', '3Arrows', '3Symbols', '3Symbols2', '3Flags', '3Stars', '4Rating', '5Rating', '3Signs', '4Arrows', '5Arrows']
const OPERATORS: CfOperator[] = ['greaterThan', 'lessThan', 'between', 'equal', 'notEqual', 'greaterThanOrEqual', 'lessThanOrEqual', 'notBetween']

function checkStyle(s: unknown): Style {
  if (!s || typeof s !== 'object') throw new SheetError('a rule needs style, like {"fill": "#fbe2da", "font": {"color": "#b8452f"}}')
  const st = s as Style & StyleInput
  // Accept the flat shape too.
  if (st.bold !== undefined || st.color !== undefined || typeof st.fill === 'string') {
    const out: Style = {}
    if (st.fill) out.fill = String(st.fill)
    const font: Style['font'] = {}
    if (st.bold) font.bold = true
    if (st.italic) font.italic = true
    if (st.color) font.color = String(st.color)
    if (st.font && typeof st.font === 'object') Object.assign(font, st.font)
    if (Object.keys(font).length) out.font = font
    for (const c of [out.fill, out.font?.color]) if (c && !COLOR.test(c)) throw new SheetError('colours must be like #2f5d50')
    return out
  }
  return st
}

export function checkRule(rule: CfRule): CfRule {
  if (!rule || typeof rule !== 'object') throw new SheetError('rule must be an object with a type')
  switch (rule.type) {
    case 'dataBar':
      if (!COLOR.test(String(rule.color))) throw new SheetError('a data bar needs color, like #4f93ba')
      return rule
    case 'colorScale':
      if (!Array.isArray(rule.colors) || rule.colors.length < 2 || rule.colors.length > 3 || !rule.colors.every((c) => COLOR.test(c))) throw new SheetError('a colour scale needs 2 or 3 colors, like ["#f8696b", "#63be7b"]')
      return rule
    case 'iconSet':
      if (!ICONS.includes(rule.icons)) throw new SheetError(`icons must be one of ${ICONS.join(', ')}`)
      return rule
    case 'cellIs':
      if (!OPERATORS.includes(rule.operator)) throw new SheetError(`operator must be one of ${OPERATORS.join(', ')}`)
      if (!Array.isArray(rule.values) || !rule.values.length) throw new SheetError('cellIs needs values, like [500]')
      return { ...rule, style: checkStyle(rule.style) }
    case 'expression':
      if (typeof rule.formula !== 'string' || !rule.formula.trim()) throw new SheetError('an expression rule needs a formula, like "=$H6<500" written for the range\'s top-left cell')
      try {
        tokenize(rule.formula.replace(/^=/, ''))
      } catch (e) {
        throw new SheetError(`formula: ${(e as Error).message}`)
      }
      return { ...rule, formula: rule.formula.replace(/^=/, ''), style: checkStyle(rule.style) }
    case 'text':
      if (!['contains', 'notContains', 'beginsWith', 'endsWith'].includes(rule.operator) || typeof rule.text !== 'string') throw new SheetError('a text rule needs operator (contains, notContains, beginsWith or endsWith) and text')
      return { ...rule, style: checkStyle(rule.style) }
  }
  throw new SheetError('rule type must be dataBar, colorScale, iconSet, cellIs, expression or text')
}

export function checkValidation(v: Omit<Validation, 'ref'>, hasSheet: (name: string) => boolean): Omit<Validation, 'ref'> {
  if (!v || typeof v !== 'object') throw new SheetError('rule must be an object with a type')
  const types = ['list', 'whole', 'decimal', 'date', 'textLength', 'checkbox']
  if (!types.includes(v.type)) throw new SheetError(`type must be one of ${types.join(', ')}`)
  if (v.type === 'list') {
    if (v.source !== undefined) {
      const { sheet, ref } = splitSheet(String(v.source).replace(/^=/, ''))
      if (!parseRange(ref) || (sheet && !hasSheet(sheet))) throw new SheetError('source must be a range like "Categories!B2:B12"')
      return { ...v, source: String(v.source).replace(/^=/, '') }
    }
    if (!Array.isArray(v.values) || !v.values.length) throw new SheetError('a list needs values (the choices) or source (a range)')
    if (v.values.join(',').length > 255) throw new SheetError('Excel takes at most 255 characters of choices; put them on a sheet and use source')
    return { ...v, values: v.values.map(String) }
  }
  if (v.type !== 'checkbox' && v.min === undefined && v.max === undefined) throw new SheetError('give min, max or both')
  return v
}

/** Text Excel shows for a CF ref list ("B2:B9 D2:D9"), split into ranges. */
export const refsOf = (ref: string): Range[] => ref.split(/\s+/).map((x) => parseRange(x)).filter((x): x is Range => !!x)

export { colName, mapRefs }
